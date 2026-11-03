import { sanitizeReportMarkup } from "./tournament-report-markup.js";
import type { TournamentDocument } from "./tournament-operation-client.js";
import { localized } from "./product-language.js";
import { displayTournamentGroupLabel } from "./tournaments-view-labels.js";

export type TournamentInsightPlayer = Readonly<{
  playerId: string; displayName: string; points: number; races: number;
  wins: number; podiums: number; averagePoints: number; averageFinish: number;
  consistency: number; closingDelta: number; finalWins: number; finalPodiums: number;
  bestTrack?: string; worstTrack?: string;
}>;

export type TournamentInsights = Readonly<{
  raceCount: number; voidedRaceCount: number; participantCount: number;
  players: readonly TournamentInsightPlayer[];
  tracks: readonly Readonly<{ trackId: string; races: number; averageFinish: number; topPlayer: string }>[];
  headToHead: readonly Readonly<{ left: string; right: string; sharedRaces: number; leftWins: number; rightWins: number; ties: number }>[];
}>;

const mean = (values: readonly number[]): number => values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
const deviation = (values: readonly number[]): number => {
  const average = mean(values);
  return values.length === 0 ? 0 : Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

export function buildTournamentInsights(document_: TournamentDocument): TournamentInsights {
  type Mutable = { playerId: string; displayName: string; points: number; finishes: number[]; racePoints: number[]; wins: number; podiums: number; finalWins: number; finalPodiums: number; tracks: Map<string, number[]> };
  const players = new Map<string, Mutable>();
  const tracks = new Map<string, { races: number; finishes: Map<string, number[]>; names: Map<string, string> }>();
  const pairs = new Map<string, { left: string; right: string; leftName: string; rightName: string; shared: number; leftWins: number; rightWins: number; ties: number }>();
  let raceCount = 0; let voidedRaceCount = 0;
  for (const group of document_.groups) for (const race of group.races) {
    if (!race.countsTowardStandings) { voidedRaceCount += 1; continue; }
    raceCount += 1;
    const track = tracks.get(race.trackId) ?? { races: 0, finishes: new Map(), names: new Map() };
    track.races += 1;
    for (const placement of race.placements) {
      const row: Mutable = players.get(placement.playerId) ?? { playerId: placement.playerId, displayName: placement.displayName, points: 0, finishes: [], racePoints: [], wins: 0, podiums: 0, finalWins: 0, finalPodiums: 0, tracks: new Map() };
      row.points += placement.racePoints; row.finishes.push(placement.finishPosition); row.racePoints.push(placement.racePoints);
      if (placement.finishPosition === 1) { row.wins += 1; if (group.stage === "final") { row.finalWins += 1; } }
      if (placement.finishPosition <= 3) { row.podiums += 1; if (group.stage === "final") { row.finalPodiums += 1; } }
      const trackFinishes = row.tracks.get(race.trackId) ?? []; trackFinishes.push(placement.finishPosition); row.tracks.set(race.trackId, trackFinishes);
      players.set(placement.playerId, row);
      const finishes = track.finishes.get(placement.playerId) ?? []; finishes.push(placement.finishPosition); track.finishes.set(placement.playerId, finishes); track.names.set(placement.playerId, placement.displayName);
    }
    tracks.set(race.trackId, track);
    for (let leftIndex = 0; leftIndex < race.placements.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < race.placements.length; rightIndex += 1) {
      const a = race.placements[leftIndex]!; const b = race.placements[rightIndex]!;
      const [left, right] = a.playerId < b.playerId ? [a, b] : [b, a]; const key = `${left.playerId}|${right.playerId}`;
      const pair = pairs.get(key) ?? { left: left.playerId, right: right.playerId, leftName: left.displayName, rightName: right.displayName, shared: 0, leftWins: 0, rightWins: 0, ties: 0 };
      pair.shared += 1;
      if (left.finishPosition < right.finishPosition) { pair.leftWins += 1; } else if (right.finishPosition < left.finishPosition) { pair.rightWins += 1; } else { pair.ties += 1; }
      pairs.set(key, pair);
    }
  }
  const playerRows = [...players.values()].map((row): TournamentInsightPlayer => {
    const trackAverages = [...row.tracks].map(([trackId, values]) => ({ trackId, average: mean(values) })).sort((a, b) => a.average - b.average || a.trackId.localeCompare(b.trackId));
    const opening = mean(row.racePoints.slice(0, 4)); const closing = mean(row.racePoints.slice(-4));
    return { playerId: row.playerId, displayName: row.displayName, points: row.points, races: row.finishes.length,
      wins: row.wins, podiums: row.podiums, averagePoints: mean(row.racePoints), averageFinish: mean(row.finishes),
      consistency: deviation(row.finishes), closingDelta: closing - opening, finalWins: row.finalWins, finalPodiums: row.finalPodiums,
      ...(trackAverages[0] === undefined ? {} : { bestTrack: trackAverages[0].trackId }),
      ...(trackAverages.length === 0 ? {} : { worstTrack: trackAverages[trackAverages.length - 1]!.trackId }) };
  }).sort((a, b) => b.points - a.points || b.wins - a.wins || a.displayName.localeCompare(b.displayName));
  const trackRows = [...tracks].map(([trackId, track]) => {
    const performers = [...track.finishes].map(([playerId, values]) => ({ playerId, average: mean(values), name: track.names.get(playerId) ?? playerId })).sort((a, b) => a.average - b.average || a.name.localeCompare(b.name));
    return { trackId, races: track.races, averageFinish: mean(performers.flatMap((row) => track.finishes.get(row.playerId) ?? [])), topPlayer: performers[0]?.name ?? "-" };
  }).sort((a, b) => b.races - a.races || a.trackId.localeCompare(b.trackId));
  const headToHead = [...pairs.values()].filter((row) => row.shared >= 1).sort((a, b) => b.shared - a.shared).slice(0, 24).map((row) => ({ left: row.leftName, right: row.rightName, sharedRaces: row.shared, leftWins: row.leftWins, rightWins: row.rightWins, ties: row.ties }));
  return { raceCount, voidedRaceCount, participantCount: document_.participants.length, players: playerRows, tracks: trackRows, headToHead };
}

export type UtpMovementAudit = Readonly<{ donations: number; moves: number; cost: number; outstanding: number; sequence: readonly string[] }>;

export function buildUtpMovementAudit(document_: TournamentDocument): UtpMovementAudit {
  const qualifier = new Map<string, string>(); const final = new Map<string, { group: string; owner: string; ownerPresent: boolean }>(); let outstanding = 0;
  for (const group of document_.groups) {
    const memberIds = new Set(group.members.map((member) => member.playerId));
    for (const member of group.members) {
      if (member.station === undefined) { outstanding += 1; continue; }
      const key = `${member.station.ownerPlayerId}|${member.station.switchType}`;
      const label = displayTournamentGroupLabel(group.name, group.tierKey);
      if (group.stage === "qualifier") { qualifier.set(key, label); }
      else { final.set(key, { group: label, owner: member.station.ownerDisplayName, ownerPresent: memberIds.has(member.station.ownerPlayerId) }); }
    }
  }
  const sequence: string[] = []; let donations = 0; let moves = 0;
  for (const [key, target] of final) {
    const origin = qualifier.get(key);
    if (!target.ownerPresent) {
      donations += 1;
      sequence.push(localized(
        `${target.owner} lends a Switch to ${target.group}.`,
        `${target.owner} staat een Switch af aan ${target.group}.`,
      ));
    }
    if (origin !== undefined && origin !== target.group) {
      moves += 1;
      sequence.push(localized(
        `Move ${target.owner}'s Switch from ${origin} to ${target.group}.`,
        `Verplaats de Switch van ${target.owner} van ${origin} naar ${target.group}.`,
      ));
    }
  }
  return { donations, moves, cost: donations * 3 + moves, outstanding, sequence };
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export function wordpressReportHtml(document_: TournamentDocument, draft: Readonly<{ introText: string; tracksIntroText: string; playerNotes: Readonly<Record<string, string>> }> | null): string {
  const insights = buildTournamentInsights(document_);
  const playerRows = insights.players.map((row) => `<tr><td>${escapeHtml(row.displayName)}</td><td>${row.points}</td><td>${row.wins}</td><td>${row.podiums}</td><td>${row.averageFinish.toFixed(2)}</td><td>${row.consistency.toFixed(2)}</td></tr>`).join("");
  const trackRows = insights.tracks.map((row) => `<tr><td>${escapeHtml(row.trackId)}</td><td>${row.races}</td><td>${row.averageFinish.toFixed(2)}</td><td>${escapeHtml(row.topPlayer)}</td></tr>`).join("");
  const notes = insights.players.map((row) => { const note = draft?.playerNotes[row.playerId] ?? ""; return note.length === 0 ? "" : `<h3>${escapeHtml(row.displayName)}</h3>${sanitizeReportMarkup(note)}`; }).join("");
  const maxPoints = Math.max(1, ...insights.players.map((row) => row.points));
  const chart = insights.players.map((row, index) => `<rect x="0" y="${index * 26}" width="${Math.round(row.points / maxPoints * 640)}" height="18" fill="#d64b2a"/><text x="6" y="${index * 26 + 14}" fill="#fff">${escapeHtml(row.displayName)} - ${row.points}</text>`).join("");
  const summary = localized(
    `${insights.participantCount} participants · ${insights.raceCount} races · ${insights.voidedRaceCount} voided`,
    `${insights.participantCount} deelnemers · ${insights.raceCount} races · ${insights.voidedRaceCount} ongeldig`,
  );
  return `<article class="mk8dx-tournament-report"><h1>${escapeHtml(document_.summary.name)}</h1>${sanitizeReportMarkup(draft?.introText ?? "")}<p>${summary}</p><h2>${localized("Player performance", "Spelerprestaties")}</h2><svg viewBox="0 0 660 ${Math.max(40, insights.players.length * 26)}" role="img" aria-label="${localized("Points per player", "Punten per speler")}">${chart}</svg><table><thead><tr><th>${localized("Player", "Speler")}</th><th>${localized("Points", "Punten")}</th><th>${localized("Wins", "Overwinningen")}</th><th>Podiums</th><th>${localized("Avg finish", "Gem. finish")}</th><th>${localized("Consistency", "Consistentie")}</th></tr></thead><tbody>${playerRows}</tbody></table><h2>${localized("Tracks", "Circuits")}</h2>${sanitizeReportMarkup(draft?.tracksIntroText ?? "")}<table><thead><tr><th>${localized("Track", "Circuit")}</th><th>Races</th><th>${localized("Avg finish", "Gem. finish")}</th><th>${localized("Top performer", "Beste speler")}</th></tr></thead><tbody>${trackRows}</tbody></table>${notes}</article>`;
}
