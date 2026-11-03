import type { Pool, RowDataPacket } from "mysql2/promise";
import type { WorldRecordEntry, WorldRecordHolder } from "./mkwrs-parser.js";
import type { WorldRecordRepository } from "./world-record-service.js";
import { MKWRS_TRACKS } from "./mkwrs-track-map.js";

interface ImportRow extends RowDataPacket { importedAtMs: unknown; }
interface TimeRow extends RowDataPacket { modeCc: unknown; trackId: unknown; totalTimeMs: unknown; }
interface RecordRow extends RowDataPacket {
  modeCc: unknown; trackId: unknown; totalTimeMs: unknown; playerName: unknown; nationName: unknown;
  recordDate: unknown; durationDays: unknown; characterName: unknown; bodyName: unknown; tireName: unknown; gliderName: unknown;
  videoUrl: unknown; lapTimesJson: unknown; coinsJson: unknown; mushroomsJson: unknown; holdersJson: unknown; sourceUrl: unknown;
}
const jsonVector = (value: unknown): number[] => {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed) || ![3,7].includes(parsed.length) || parsed.some((part) => !Number.isSafeInteger(Number(part)))) throw new Error("invalid world record vector");
  return parsed.map(Number);
};
// Coins and mushrooms: one per lap, or empty when the source groups them differently (migration 0075).
const itemVector = (value: unknown): number[] => {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (Array.isArray(parsed) && parsed.length === 0) return [];
  return jsonVector(parsed);
};
const trackNames = new Map<string, string>(MKWRS_TRACKS.map((track) => [track.trackId, track.name]));
const holders = (value: unknown): WorldRecordHolder[] => {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 3) throw new Error("invalid world record holders");
  return parsed.map((candidate) => {
    if (candidate === null || typeof candidate !== "object") throw new Error("invalid world record holder");
    const holder = candidate as Record<string, unknown>;
    for (const key of ["playerName","recordDate","characterName","bodyName","tireName","gliderName"])
      if (typeof holder[key] !== "string" || holder[key].length === 0) throw new Error("invalid world record holder");
    const durationDays = Number(holder["durationDays"]);
    if (!Number.isSafeInteger(durationDays) || durationDays < 0) throw new Error("invalid world record holder");
    return { playerName: holder["playerName"] as string, ...(typeof holder["nationName"] === "string" ? { nationName: holder["nationName"] } : {}),
      recordDate: holder["recordDate"] as string, durationDays, characterName: holder["characterName"] as string,
      bodyName: holder["bodyName"] as string, tireName: holder["tireName"] as string, gliderName: holder["gliderName"] as string,
      ...(typeof holder["videoUrl"] === "string" ? { videoUrl: holder["videoUrl"] } : {}), lapTimesMs: jsonVector(holder["lapTimesMs"]),
      coinsPerLap: itemVector(holder["coinsPerLap"]), mushroomsPerLap: itemVector(holder["mushroomsPerLap"]) };
  });
};

export class MysqlWorldRecordRepository implements WorldRecordRepository {
  public constructor(private readonly pool: Pool) {}
  public async latestImportAtMs(): Promise<number | null> {
    const [rows] = await this.pool.execute<ImportRow[]>(`SELECT imported_at_ms importedAtMs FROM world_record_import_runs ORDER BY imported_at_ms DESC LIMIT 1`);
    const value = Number(rows[0]?.importedAtMs); return Number.isSafeInteger(value) ? value : null;
  }
  public async replaceComplete(records: readonly WorldRecordEntry[], nowMs: number): Promise<number> {
    if (records.length !== 192 || records.filter((r) => r.mode === 150).length !== 96 || records.filter((r) => r.mode === 200).length !== 96 || new Set(records.map((r) => `${r.mode}|${r.trackId}`)).size !== 192) throw new Error("incomplete world record snapshot");
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [oldRows] = await connection.execute<TimeRow[]>(`SELECT mode_cc modeCc,track_id trackId,total_time_ms totalTimeMs FROM world_records FOR UPDATE`);
      const old = new Map(oldRows.map((row) => [`${Number(row.modeCc)}|${String(row.trackId)}`, Number(row.totalTimeMs)]));
      const broken = records.filter((record) => { const previous = old.get(`${record.mode}|${record.trackId}`); return previous !== undefined && record.totalTimeMs < previous; });
      for (const record of records) {
        await connection.execute(
          `INSERT INTO world_records(mode_cc,track_id,total_time_ms,player_name,nation_name,record_date,duration_days,character_name,body_name,tire_name,glider_name,video_url,lap_times_json,coins_per_lap_json,mushrooms_per_lap_json,holders_json,source_url,imported_at_ms)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE total_time_ms=VALUES(total_time_ms),player_name=VALUES(player_name),nation_name=VALUES(nation_name),record_date=VALUES(record_date),duration_days=VALUES(duration_days),character_name=VALUES(character_name),body_name=VALUES(body_name),tire_name=VALUES(tire_name),glider_name=VALUES(glider_name),video_url=VALUES(video_url),lap_times_json=VALUES(lap_times_json),coins_per_lap_json=VALUES(coins_per_lap_json),mushrooms_per_lap_json=VALUES(mushrooms_per_lap_json),holders_json=VALUES(holders_json),source_url=VALUES(source_url),imported_at_ms=VALUES(imported_at_ms)`,
          [record.mode,record.trackId,record.totalTimeMs,record.playerName,record.nationName??null,record.recordDate,record.durationDays,record.characterName,record.bodyName,record.tireName,record.gliderName,record.videoUrl??null,JSON.stringify(record.lapTimesMs),JSON.stringify(record.coinsPerLap),JSON.stringify(record.mushroomsPerLap),JSON.stringify(record.holders),record.sourceUrl,nowMs]);
      }
      await connection.execute(`INSERT INTO world_record_import_runs(imported_at_ms,records_150,records_200,changed_records) VALUES(?,96,96,?)`,[nowMs,broken.length]);
      // One unread notification for all of them, not one per track. The
      // aggregation key used to carry the mode and the track, so an import that
      // broke eight records sent eight separate notifications - and eight
      // pushes to a phone. The unread aggregation key is unique per account
      // only while unread, so a single 'world_record' key collapses every break
      // into one entry that counts them and points at the most recent track;
      // once the owner has read it, the next break opens a fresh one.
      for (const record of broken) {
        await connection.execute(
          `INSERT INTO notifications(user_account_id,notification_kind,aggregation_key,track_id,mode_cc,event_count,first_event_at_ms,last_event_at_ms)
           SELECT claim.user_account_id,'world_record','world_record',?,?,1,?,? FROM player_claims claim
           INNER JOIN players player ON player.player_id=claim.player_id AND player.record_status='active' AND player.player_kind='human'
           WHERE claim.claim_status='verified' GROUP BY claim.user_account_id
           ON DUPLICATE KEY UPDATE event_count=event_count+1,last_event_at_ms=VALUES(last_event_at_ms),track_id=VALUES(track_id),mode_cc=VALUES(mode_cc)`,
          [record.trackId,record.mode,nowMs,nowMs]);
        // The aggregate counts the breaks and names the most recent one; this
        // keeps the ones it folded away, so "49 new World Records" can be
        // opened and read track by track. Every unread world_record entry is
        // exactly the set the statement above just touched, because it upserts
        // one per verified claim and the unread aggregation key is unique per
        // account.
        await connection.execute(
          `INSERT INTO notification_events(notification_id,occurred_at_ms,track_id,mode_cc)
           SELECT notification.notification_id,?,?,? FROM notifications notification
           WHERE notification.notification_kind='world_record'
             AND notification.aggregation_key='world_record'
             AND notification.read_at_ms IS NULL`,
          [nowMs,record.trackId,record.mode]);
      }
      await connection.commit(); return broken.length;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
  public async list(): Promise<readonly WorldRecordEntry[]> {
    const [rows] = await this.pool.execute<RecordRow[]>(
      `SELECT mode_cc modeCc,track_id trackId,total_time_ms totalTimeMs,player_name playerName,nation_name nationName,
       DATE_FORMAT(record_date,'%Y-%m-%d') recordDate,duration_days durationDays,character_name characterName,body_name bodyName,
       tire_name tireName,glider_name gliderName,video_url videoUrl,lap_times_json lapTimesJson,coins_per_lap_json coinsJson,
       mushrooms_per_lap_json mushroomsJson,holders_json holdersJson,source_url sourceUrl FROM world_records ORDER BY mode_cc,track_id`);
    return rows.map((row) => ({ mode: Number(row.modeCc) as 150|200, trackId: String(row.trackId), trackName: trackNames.get(String(row.trackId)) ?? String(row.trackId),
      totalTimeMs:Number(row.totalTimeMs),playerName:String(row.playerName),...(typeof row.nationName==="string"?{nationName:row.nationName}:{}),recordDate:String(row.recordDate),durationDays:Number(row.durationDays),
      characterName:String(row.characterName),bodyName:String(row.bodyName),tireName:String(row.tireName),gliderName:String(row.gliderName),...(typeof row.videoUrl==="string"?{videoUrl:row.videoUrl}:{}),
      lapTimesMs:jsonVector(row.lapTimesJson),coinsPerLap:itemVector(row.coinsJson),mushroomsPerLap:itemVector(row.mushroomsJson),holders:holders(row.holdersJson),sourceUrl:String(row.sourceUrl) }));
  }
}
