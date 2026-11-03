/**
 * The WhatsApp export picture, drawn the way the APK draws it.
 *
 * A source-faithful port of `AndroidTournamentExportImage.kt` (itself a port
 * of the Manager's `buildWhatsappPreviewModel` / `downloadWhatsappPreviewPng`):
 * the same four pictures for Steps 4, 6, 8 and 10, the same geometry at the
 * same render scale, the same colours, pills, medals, Nintendo Switch icons
 * and Dutch labels. The owner keeps the APK's picture; the Web draws the
 * same one, so a group chat cannot tell which client sent it.
 *
 * The renderer reads a neutral source so the operator's TournamentDocument
 * and the public event page feed the same code.
 */
import type {
  PublicTournamentEvent,
  TournamentDocument,
  TournamentGroupStage,
} from "./tournament-operation-client.js";
import { tournamentStationKey, tournamentUtpByStation } from "./tournament-group-board.js";
import { TOURNAMENT_EXPORT_TOKENS } from "./tournament-export-tokens.generated.js";

export type TournamentExportMode = "layout" | "results";

export type TournamentExportStation = Readonly<{
  ownerKey: string;
  ownerDisplayName: string;
  switchType: "ns1" | "ns2";
  seatNumber: number;
  utpCableNumber?: number;
}>;

export type TournamentExportMember = Readonly<{
  playerId?: string;
  displayName: string;
  seedRank?: number;
  seedScore?: number;
  station?: TournamentExportStation;
}>;

export type TournamentExportStanding = Readonly<{
  rank: number;
  playerId?: string;
  displayName: string;
  points: number;
  seedRank?: number;
  seedScore?: number;
}>;

export type TournamentExportGroup = Readonly<{
  stage: TournamentGroupStage;
  sequence: number;
  name: string;
  tierKey?: string;
  members: readonly TournamentExportMember[];
  standings: readonly TournamentExportStanding[];
}>;

export type TournamentExportSource = Readonly<{
  name: string;
  eventDate?: string;
  startAtMs?: number;
  timezone?: string;
  groups: readonly TournamentExportGroup[];
}>;

export type TournamentExportRow = Readonly<{
  values: readonly string[];
  switchType?: "ns1" | "ns2";
  switchDotColor?: string;
  rankTierKeys: Readonly<Record<number, string>>;
  positionRank?: number;
  medal: string;
}>;

export type TournamentExportTable = Readonly<{
  heading: string;
  participantCount: number;
  averageSkill: number;
  spreadPlus: number;
  spreadMinus: number;
  /** False when no Player in the group had an SP that night; then no average is drawn. */
  skillKnown: boolean;
  borderStart: string;
  borderEnd: string;
  rows: readonly TournamentExportRow[];
  groupTierKey?: string;
}>;

export type TournamentExportImageModel = Readonly<{
  title: string;
  subtitle: string;
  headers: readonly string[];
  groups: readonly TournamentExportTable[];
  mode: TournamentExportMode;
  isQualifier: boolean;
}>;

// ----------------------------------------------------------------- palette

const {
  page: PAGE_COLOR,
  card: CARD_COLOR,
  header: HEADER_COLOR,
  group: GROUP_COLOR,
  stats: STATS_COLOR,
  column: COLUMN_COLOR,
  title: TITLE_COLOR,
  cell: CELL_COLOR,
  subtitle: SUBTITLE_COLOR,
  headerText: HEADER_TEXT_COLOR,
  line: LINE_COLOR,
  plus: PLUS_COLOR,
  minus: MINUS_COLOR,
  groupName: GROUP_NAME_COLOR,
  badge: BADGE_COLOR,
  badgeText: BADGE_TEXT_COLOR,
  statsText: STATS_TEXT_COLOR,
  pillText: PILL_TEXT_COLOR,
} = TOURNAMENT_EXPORT_TOKENS.colors;

const HEADER_HEIGHT = 80;
const GROUP_HEAD_HEIGHT = 32;
const STATS_HEIGHT = 26;
const COLUMN_HEAD_HEIGHT = 24;
const ROW_HEIGHT = 28;
const GROUP_GAP = 7;
const CELL_PADDING = 10;
const MARGIN = 14;
export const TOURNAMENT_EXPORT_RENDER_SCALE = 2;

/**
 * The narrowest table the picture is drawn around.
 *
 * The columns are measured from the longest text in them, so the picture used
 * to be a different width every night: a final standing with short names came
 * out 328 px wide, a qualifier 410, a seating 404. Shared one after another in
 * a chat, they read as pictures of different things.
 *
 * The widest of the three minimums is the floor, so an export never comes out
 * narrower than a qualifier's - a table under it is centred in the frame
 * rather than shrinking the whole card. One column and one width: the shape
 * the owner asked for, because that is what a phone shows whole.
 */
export const TOURNAMENT_EXPORT_MIN_TABLE_WIDTH = 354;

/**
 * The measured columns, widened to fill the frame when the table falls under
 * the floor.
 *
 * Centring a narrow table in a wide card left it floating in the middle of
 * empty panel; the columns take the room instead, in proportion to what they
 * measured, so the picture is the same width every night and the table still
 * fills it. A table already at or over the floor is left exactly as measured -
 * the floor is a floor, never a cap.
 */
export function tournamentExportStretchedWidths(
  widths: readonly number[],
  minimum: number = TOURNAMENT_EXPORT_MIN_TABLE_WIDTH,
): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (widths.length === 0 || total <= 0 || total >= minimum) { return [...widths]; }
  const stretched = widths.map((width) => width + Math.floor(((minimum - total) * width) / total));
  // Rounding leaves a pixel or two over; the widest column absorbs it.
  const widest = stretched.reduce((best, width, index) => (width > stretched[best]! ? index : best), 0);
  stretched[widest] = stretched[widest]! + minimum - stretched.reduce((sum, width) => sum + width, 0);
  return stretched;
}

const SEAT_PALETTES: readonly (readonly string[])[] = TOURNAMENT_EXPORT_TOKENS.seatPalettes;

/** The operator tiers as the APK names them; the picture is Dutch. */
const EXPORT_TIERS: readonly Readonly<{ key: string; name: string }>[] = [
  { key: "champion", name: "Kampioen" },
  { key: "talent", name: "Talent" },
  { key: "wild", name: "Wild" },
  { key: "adventure", name: "Avontuur" },
  { key: "feest", name: "Feest" },
];

const TIER_COLORS: Readonly<Record<string, string>> = TOURNAMENT_EXPORT_TOKENS.tiers;

const DUTCH_MONTHS = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

function tierForRank(rank: number | undefined): string {
  if (rank === undefined || !Number.isSafeInteger(rank) || rank < 1) { return "unknown"; }
  return EXPORT_TIERS[Math.floor((rank - 1) / 12)]?.key ?? "unknown";
}

function tierStyle(key: string | undefined, soft = false): Readonly<{ background: string; foreground: string }> {
  const base = TIER_COLORS[key ?? ""] ?? TOURNAMENT_EXPORT_TOKENS.tiers.unknown;
  return { background: soft ? `${base}A6` : base, foreground: PILL_TEXT_COLOR };
}

function podiumStyle(rank: number | undefined): Readonly<{ background: string; foreground: string }> | null {
  if (rank === 1) { return { background: TOURNAMENT_EXPORT_TOKENS.colors.podiumGold, foreground: PILL_TEXT_COLOR }; }
  if (rank === 2) { return { background: TOURNAMENT_EXPORT_TOKENS.colors.podiumSilver, foreground: PILL_TEXT_COLOR }; }
  if (rank === 3) { return { background: TOURNAMENT_EXPORT_TOKENS.colors.podiumBronze, foreground: PILL_TEXT_COLOR }; }
  return null;
}

/** `formatRankMetric`: two decimals with the Dutch comma. */
export function tournamentExportMetric(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export function tournamentExportDutchDate(source: Pick<TournamentExportSource, "eventDate" | "startAtMs" | "timezone">): string | null {
  const parts = source.eventDate?.split("-") ?? [];
  if (parts.length === 3) {
    const [year, month, day] = parts.map((part) => Number(part));
    if (Number.isSafeInteger(year) && month !== undefined && month >= 1 && month <= 12 &&
        day !== undefined && day >= 1 && day <= 31) {
      return `${day} ${DUTCH_MONTHS[month - 1]} ${year}`;
    }
  }
  if (source.startAtMs === undefined) { return null; }
  try {
    const formatter = new Intl.DateTimeFormat("nl-NL", {
      timeZone: source.timezone ?? "Europe/Amsterdam", day: "numeric", month: "numeric", year: "numeric",
    });
    const fields = Object.fromEntries(formatter.formatToParts(source.startAtMs)
      .filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const month = fields["month"];
    if (month === undefined || month < 1 || month > 12) { return null; }
    return `${fields["day"]} ${DUTCH_MONTHS[month - 1]} ${fields["year"]}`;
  } catch {
    return null;
  }
}

/** "20:00" in the night's own timezone, when a start time was recorded. */
export function tournamentExportDutchTime(
  source: Pick<TournamentExportSource, "startAtMs" | "timezone">,
): string | null {
  if (source.startAtMs === undefined) { return null; }
  try {
    return new Intl.DateTimeFormat("nl-NL", {
      timeZone: source.timezone ?? "Europe/Amsterdam",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(source.startAtMs);
  } catch {
    return null;
  }
}

/**
 * The message a shared picture travels with.
 *
 * The picture already carries every name, every seat and every score, drawn
 * to be read. Repeating all of that as text underneath it filled the chat
 * with a wall nobody reads twice, so the message says only what the picture
 * cannot: which tournament, when, and which of the four boards this is.
 *
 * "Deel als tekst" is still there for whoever wants the roster as text - it
 * is a different act, and it keeps the format the group chat has read for
 * years.
 */
export function tournamentExportShareCaption(
  source: Pick<TournamentExportSource, "name" | "eventDate" | "startAtMs" | "timezone">,
  stage: TournamentGroupStage,
  mode: TournamentExportMode,
): string {
  const date = tournamentExportDutchDate(source);
  const time = tournamentExportDutchTime(source);
  const when = [date, time].filter((part): part is string => part !== null).join(" · ");
  return [source.name, when, `🏁 ${phaseLabel(stage, mode)}`]
    .filter((line) => line !== "")
    .join("\n");
}

function phaseLabel(stage: TournamentGroupStage, mode: TournamentExportMode): string {
  if (stage === "final" && mode === "layout") { return "Eind Groep Indeling"; }
  if (stage === "final") { return "Resultaat Eind Groep"; }
  if (mode === "layout") { return "Kwalificatie Indeling"; }
  return "Resultaat Kwalificatie";
}

function exportHeader(source: TournamentExportSource, stage: TournamentGroupStage, mode: TournamentExportMode): [string, string] {
  const date = tournamentExportDutchDate(source);
  return [`🏁 ${phaseLabel(stage, mode)}`, source.name + (date === null ? "" : ` · ${date}`)];
}

function groupPalette(index: number): [string, string] {
  const palette = SEAT_PALETTES[index % SEAT_PALETTES.length]!;
  return [palette[0]!, palette[palette.length - 1]!];
}

function groupStats(group: TournamentExportGroup): Readonly<{ averageSkill: number; spreadPlus: number; spreadMinus: number; skillKnown: boolean }> {
  const pool: readonly Readonly<{ seedScore?: number }>[] = group.members.length > 0 ? group.members : group.standings;
  const scores = pool.map((entry) => entry.seedScore).filter((score): score is number => score !== undefined);
  // Nobody in this group carried a rating: TN4 is the first rated night, so
  // there is no average to print. Zero would read as a measurement.
  if (scores.length === 0) { return { averageSkill: 0, spreadPlus: 0, spreadMinus: 0, skillKnown: false }; }
  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return { averageSkill: average, spreadPlus: Math.max(...scores) - average, spreadMinus: average - Math.min(...scores), skillKnown: true };
}

function stageGroups(source: TournamentExportSource, stage: TournamentGroupStage): readonly TournamentExportGroup[] {
  return source.groups.filter((group) => group.stage === stage).slice().sort((a, b) => a.sequence - b.sequence);
}

function participantCount(group: TournamentExportGroup): number {
  return Math.max(group.members.length, group.standings.length);
}

// ------------------------------------------------------------------ sources

/**
 * UTP numbers on the pictures are this Tournament's wiring positions, 1..N in
 * qualifier board order with final-only consoles appended - the APK's
 * derivation (ADR-0176). The document's `utpCableNumber` is the server's
 * lifetime number for a console and is deliberately not used here.
 */
export function tournamentExportSourceFromDocument(document_: TournamentDocument): TournamentExportSource {
  const participants = new Map(document_.participants.map((participant) => [participant.playerId, participant]));
  const cables = tournamentUtpByStation(document_);
  return {
    name: document_.summary.name,
    ...(document_.summary.eventDate === undefined ? {} : { eventDate: document_.summary.eventDate }),
    ...(document_.summary.startAtMs === undefined ? {} : { startAtMs: document_.summary.startAtMs }),
    ...(document_.summary.timezone === undefined ? {} : { timezone: document_.summary.timezone }),
    groups: document_.groups.map((group) => ({
      stage: group.stage,
      sequence: group.sequence,
      name: group.name,
      ...(group.tierKey === undefined ? {} : { tierKey: group.tierKey }),
      members: group.members.map((member) => {
        const participant = participants.get(member.playerId);
        const station = member.station;
        return {
          playerId: member.playerId,
          displayName: member.displayName,
          ...(participant?.seedRank === undefined ? {} : { seedRank: participant.seedRank }),
          ...(participant?.seedScore === undefined ? {} : { seedScore: participant.seedScore }),
          ...(station === undefined ? {} : {
            station: {
              ownerKey: station.ownerPlayerId,
              ownerDisplayName: station.ownerDisplayName,
              switchType: station.switchType,
              seatNumber: station.seatNumber,
              ...(cables.get(tournamentStationKey(station.ownerPlayerId, station.switchType)) === undefined
                ? {}
                : { utpCableNumber: cables.get(tournamentStationKey(station.ownerPlayerId, station.switchType))! }),
            },
          }),
        };
      }),
      standings: group.standings.rows.map((row) => {
        const participant = participants.get(row.playerId);
        return {
          rank: row.rank,
          playerId: row.playerId,
          displayName: row.displayName,
          points: row.points,
          ...(participant?.seedRank === undefined ? {} : { seedRank: participant.seedRank }),
          ...(participant?.seedScore === undefined ? {} : { seedScore: participant.seedScore }),
        };
      }),
    })),
  };
}

/**
 * The public event carries no station owner id, so a console is keyed by its
 * owner's name and Switch model; UTP numbers follow the same first-appearance
 * order as the operator board (qualifiers first, by group, by seat order).
 */
export function tournamentExportSourceFromPublicEvent(event: PublicTournamentEvent): TournamentExportSource {
  const ordered: string[] = [];
  for (const stage of ["qualifier", "final"] as const) {
    for (const group of event.groups.filter((candidate) => candidate.stage === stage).slice().sort((a, b) => a.sequence - b.sequence)) {
      for (const seat of [...group.seating].sort((a, b) => a.seatOrder - b.seatOrder)) {
        const key = `${seat.stationOwnerDisplayName}|${seat.switchType}`;
        if (!ordered.includes(key)) { ordered.push(key); }
      }
    }
  }
  const cables = new Map(ordered.map((key, index) => [key, index + 1]));
  return {
    name: event.name,
    ...(event.eventDate === undefined ? {} : { eventDate: event.eventDate }),
    ...(event.startAtMs === undefined ? {} : { startAtMs: event.startAtMs }),
    ...(event.timezone === undefined ? {} : { timezone: event.timezone }),
    groups: event.groups.map((group) => ({
      stage: group.stage,
      sequence: group.sequence,
      name: group.name,
      ...(group.tierKey === undefined ? {} : { tierKey: group.tierKey }),
      members: [...group.seating].sort((a, b) => a.seatOrder - b.seatOrder).map((seat) => ({
        ...(seat.playerId === undefined ? {} : { playerId: seat.playerId }),
        displayName: seat.displayName,
        ...(seat.seedRank === undefined ? {} : { seedRank: seat.seedRank }),
        ...(seat.seedScore === undefined ? {} : { seedScore: seat.seedScore }),
        station: {
          ownerKey: `${seat.stationOwnerDisplayName}|${seat.switchType}`,
          ownerDisplayName: seat.stationOwnerDisplayName,
          switchType: seat.switchType,
          seatNumber: seat.seatNumber,
          utpCableNumber: cables.get(`${seat.stationOwnerDisplayName}|${seat.switchType}`)!,
        },
      })),
      standings: group.standings.map((row) => ({
        rank: row.rank,
        ...(row.playerId === undefined ? {} : { playerId: row.playerId }),
        displayName: row.displayName,
        points: row.points,
        ...(row.seedRank === undefined ? {} : { seedRank: row.seedRank }),
        ...(row.seedScore === undefined ? {} : { seedScore: row.seedScore }),
      })),
    })),
  };
}

// ------------------------------------------------------------------- models

export function tournamentLayoutImageModel(source: TournamentExportSource, stage: TournamentGroupStage): TournamentExportImageModel {
  const [title, subtitle] = exportHeader(source, stage, "layout");
  const rankText = (member: TournamentExportMember | undefined): string =>
    member === undefined ? "-" : member.seedRank === undefined ? "#?" : `#${member.seedRank}`;
  const groups = stageGroups(source, stage).map((group, groupIndex) => {
    const consoles: string[] = [];
    for (const member of group.members) {
      if (member.station === undefined) { continue; }
      const key = `${member.station.ownerKey}|${member.station.switchType}`;
      if (!consoles.includes(key)) { consoles.push(key); }
    }
    const palette = SEAT_PALETTES[groupIndex % SEAT_PALETTES.length]!;
    const rows = consoles.map((key, consoleIndex) => {
      const seats = group.members
        .filter((member) => member.station !== undefined && `${member.station.ownerKey}|${member.station.switchType}` === key)
        .sort((a, b) => (a.station?.seatNumber ?? 0) - (b.station?.seatNumber ?? 0));
      const station = seats[0]?.station;
      const first = seats.find((member) => member.station?.seatNumber === 1);
      const second = seats.find((member) => member.station?.seatNumber === 2);
      return {
        values: [
          station?.ownerDisplayName ?? key,
          station?.utpCableNumber === undefined ? "-" : String(station.utpCableNumber),
          rankText(first), first?.displayName ?? "-",
          rankText(second), second?.displayName ?? "-",
        ],
        switchType: station?.switchType ?? "ns1",
        switchDotColor: palette[consoleIndex % palette.length]!,
        rankTierKeys: { 2: tierForRank(first?.seedRank), 4: tierForRank(second?.seedRank) },
        medal: "",
      } satisfies TournamentExportRow;
    });
    const stats = groupStats(group);
    const [borderStart, borderEnd] = groupPalette(groupIndex);
    return {
      heading: group.name, participantCount: participantCount(group),
      ...stats, borderStart, borderEnd, rows,
      ...(group.tierKey === undefined ? {} : { groupTierKey: group.tierKey }),
    } satisfies TournamentExportTable;
  });
  return {
    title, subtitle,
    headers: ["Nintendo Switch", "UTP", "SP Rank", "Deelnemer 1", "SP Rank", "Deelnemer 2"],
    groups, mode: "layout", isQualifier: stage !== "final",
  };
}

function qualifierDestinations(source: TournamentExportSource): Map<string, [string, string]> {
  const destinations = new Map<string, [string, string]>();
  const finals = stageGroups(source, "final");
  if (finals.length > 0) {
    finals.forEach((group, index) => {
      const tier = group.tierKey ?? EXPORT_TIERS[index]?.key ?? "unknown";
      for (const member of group.members) {
        if (member.playerId !== undefined) { destinations.set(member.playerId, [group.name, tier]); }
      }
      for (const row of group.standings) {
        if (row.playerId !== undefined && !destinations.has(row.playerId)) { destinations.set(row.playerId, [group.name, tier]); }
      }
    });
    return destinations;
  }
  const qualifiers = stageGroups(source, "qualifier");
  const tierCount = Math.min(Math.max(qualifiers.length, 1), EXPORT_TIERS.length);
  const tiers = EXPORT_TIERS.slice(0, tierCount);
  for (const group of qualifiers) {
    const rows = group.standings.slice().sort((a, b) => a.rank - b.rank);
    const base = Math.floor(rows.length / tierCount);
    let rowIndex = 0;
    tiers.forEach((tier, tierIndex) => {
      const count = base + (tierIndex < rows.length % tierCount ? 1 : 0);
      for (let step = 0; step < count; step += 1) {
        const row = rows[rowIndex];
        rowIndex += 1;
        if (row?.playerId !== undefined) { destinations.set(row.playerId, [tier.name, tier.key]); }
      }
    });
  }
  return destinations;
}

export function tournamentResultsImageModel(source: TournamentExportSource, stage: TournamentGroupStage): TournamentExportImageModel {
  const isQualifier = stage !== "final";
  const destinations = isQualifier ? qualifierDestinations(source) : new Map<string, [string, string]>();
  const [title, subtitle] = exportHeader(source, stage, "results");
  const groups = stageGroups(source, stage).map((group, groupIndex) => {
    const rows = group.standings.slice().sort((a, b) => a.rank - b.rank).map((standing, index) => {
      const position = index + 1;
      const rankText = standing.seedRank === undefined ? "#?" : `#${standing.seedRank}`;
      const rankTier = tierForRank(standing.seedRank);
      const destination = (standing.playerId === undefined ? undefined : destinations.get(standing.playerId)) ?? ["-", "unknown"];
      return {
        values: isQualifier
          ? [`#${position}`, rankText, standing.displayName, destination[0], String(standing.points)]
          : [`#${position}`, rankText, standing.displayName, String(standing.points)],
        rankTierKeys: isQualifier ? { 1: rankTier, 3: destination[1] } : { 1: rankTier },
        positionRank: position,
        medal: isQualifier ? "" : position === 1 ? "🏆" : position === 2 ? "🥈" : position === 3 ? "🥉" : "",
      } satisfies TournamentExportRow;
    });
    const stats = groupStats(group);
    const [borderStart, borderEnd] = groupPalette(groupIndex);
    const groupTierKey = group.tierKey ?? EXPORT_TIERS[groupIndex]?.key;
    return {
      heading: group.name, participantCount: participantCount(group),
      ...stats, borderStart, borderEnd, rows,
      ...(groupTierKey === undefined ? {} : { groupTierKey }),
    } satisfies TournamentExportTable;
  });
  return {
    title, subtitle,
    headers: isQualifier
      ? ["Positie", "SP Rank", "Deelnemer", "Naar Eindgroep", "Score"]
      : ["Positie", "SP Rank", "Deelnemer", "Score"],
    groups, mode: "results", isQualifier,
  };
}

export function tournamentExportImageModel(
  source: TournamentExportSource, stage: TournamentGroupStage, mode: TournamentExportMode,
): TournamentExportImageModel {
  return mode === "layout" ? tournamentLayoutImageModel(source, stage) : tournamentResultsImageModel(source, stage);
}

export function tournamentExportMinimums(mode: TournamentExportMode, isQualifier: boolean): readonly number[] {
  if (mode === "layout") { return [84, 36, 42, 72, 42, 72]; }
  return isQualifier ? [72, 54, 94, 82, 52] : [72, 54, 94, 52];
}

export function tournamentExportFileName(name: string, stage: TournamentGroupStage, mode: TournamentExportMode): string {
  const tournament = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "mk8dx_toernooi";
  const phase = stage === "final" ? "eindgroepen" : "kwalificatie";
  const kind = mode === "layout" ? "indeling" : "uitslag";
  return `${tournament}_${phase}_${kind}.png`;
}

export function tournamentExportColumnWidths(
  model: TournamentExportImageModel,
  minimums: readonly number[],
  measure: (text: string, header: boolean) => number,
): number[] {
  const widths = model.headers.map((header) => measure(header, true) + CELL_PADDING);
  for (const group of model.groups) {
    for (const row of group.rows) {
      row.values.forEach((value, index) => {
        if (index >= widths.length) { return; }
        const iconAllowance = model.mode === "layout" && index === 0 ? 22 : 0;
        widths[index] = Math.max(widths[index]!, measure(value, false) + CELL_PADDING + iconAllowance);
      });
    }
  }
  return widths.map((width, index) => Math.max(minimums[index] ?? 48, Math.ceil(width)));
}

// ----------------------------------------------------------------- drawing

type Icons = Readonly<{ ns1?: CanvasImageSource; ns2?: CanvasImageSource }>;

function font(size: number, weight: number): string {
  return `${weight >= 700 ? "bold" : "normal"} ${size}px sans-serif`;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, fill: string | CanvasGradient): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
}

function drawText(context: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, weight: number, color: string, align: CanvasTextAlign = "left"): void {
  context.font = font(size, weight);
  context.fillStyle = color;
  context.textAlign = align;
  context.fillText(text, x, y);
  context.textAlign = "left";
}

function measure(context: CanvasRenderingContext2D, text: string, size: number, weight: number): number {
  context.font = font(size, weight);
  return context.measureText(text).width;
}

function ellipsize(context: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight: number): string {
  if (measure(context, text, size, weight) <= maxWidth) { return text; }
  let value = text;
  while (value.length > 1 && measure(context, `${value}…`, size, weight) > maxWidth) { value = value.slice(0, -1); }
  return `${value}…`;
}

function emptyRow(model: TournamentExportImageModel): TournamentExportRow {
  if (model.mode === "layout") { return { values: ["-", "-", "-", "-", "-", "-"], switchType: "ns1", rankTierKeys: {}, medal: "" }; }
  return model.isQualifier
    ? { values: ["—", "#?", "Geen uitslag", "-", "-"], rankTierKeys: {}, medal: "" }
    : { values: ["—", "#?", "Geen uitslag", "-"], rankTierKeys: {}, medal: "" };
}

function drawTierPill(context: CanvasRenderingContext2D, value: string, tierKey: string | undefined, x: number, y: number, width: number, soft = true, alignLeft = false): void {
  const style = tierStyle(tierKey, soft);
  roundRect(context, x + 6, y + 5, width - 12, 18, 9, style.background);
  const text = ellipsize(context, value, width - 16, 10, 800);
  drawText(context, text, alignLeft ? x + 12 : x + width / 2, y + ROW_HEIGHT / 2 + 4, 10, 800, style.foreground, alignLeft ? "left" : "center");
}

function drawLayoutRow(context: CanvasRenderingContext2D, row: TournamentExportRow, y: number, left: number, widths: readonly number[], icons: Icons): void {
  const centreY = y + ROW_HEIGHT / 2;
  let x = left;
  context.beginPath();
  context.arc(x + 11, centreY, 4, 0, Math.PI * 2);
  context.fillStyle = row.switchDotColor ?? SEAT_PALETTES[0]![1]!;
  context.fill();
  const icon = row.switchType === "ns2" ? icons.ns2 : icons.ns1;
  if (icon !== undefined) {
    context.drawImage(icon, x + 20, centreY - 6, 12, 12);
    drawText(context, ellipsize(context, row.values[0]!, widths[0]! - 42, 10, 600), x + 36, centreY + 4, 10, 600, CELL_COLOR);
  } else {
    const marker = row.switchType === "ns2" ? "[NS2]" : "[NS1]";
    drawText(context, ellipsize(context, `${marker} ${row.values[0]!}`, widths[0]! - 24, 10, 600), x + 18, centreY + 4, 10, 600, CELL_COLOR);
  }
  x += widths[0]!;
  drawText(context, row.values[1]!, x + widths[1]! / 2, centreY + 4, 10, 800, CELL_COLOR, "center");
  x += widths[1]!;
  drawTierPill(context, row.values[2]!, row.rankTierKeys[2], x, y, widths[2]!);
  x += widths[2]!;
  drawText(context, ellipsize(context, row.values[3]!, widths[3]! - 16, 10, 600), x + 8, centreY + 4, 10, 600, CELL_COLOR);
  x += widths[3]!;
  drawTierPill(context, row.values[4]!, row.rankTierKeys[4], x, y, widths[4]!);
  x += widths[4]!;
  drawText(context, ellipsize(context, row.values[5]!, widths[5]! - 16, 10, 600), x + 8, centreY + 4, 10, 600, CELL_COLOR);
}

function drawResultsRow(context: CanvasRenderingContext2D, row: TournamentExportRow, y: number, left: number, widths: readonly number[], qualifier: boolean): void {
  const centreY = y + ROW_HEIGHT / 2;
  let x = left;
  const position = [row.medal, row.values[0]!].filter((part) => part.trim().length > 0).join(" ");
  const podium = podiumStyle(row.positionRank);
  if (podium !== null) {
    roundRect(context, x + 6, y + 5, widths[0]! - 12, 18, 9, podium.background);
    drawText(context, position, x + 12, centreY + 4, 10, 800, podium.foreground);
  } else {
    drawText(context, position, x + 8, centreY + 4, 10, 800, CELL_COLOR);
  }
  x += widths[0]!;
  drawTierPill(context, row.values[1]!, row.rankTierKeys[1], x, y, widths[1]!);
  x += widths[1]!;
  drawText(context, ellipsize(context, row.values[2]!, widths[2]! - 16, 10, 600), x + 8, centreY + 4, 10, 600, CELL_COLOR);
  x += widths[2]!;
  if (qualifier) {
    drawTierPill(context, row.values[3]!, row.rankTierKeys[3], x, y, widths[3]!, false, true);
    x += widths[3]!;
    drawText(context, `${row.values[4]!} pt`, x + 8, centreY + 4, 10, 800, CELL_COLOR);
  } else {
    drawText(context, `${row.values[3]!} pt`, x + 8, centreY + 4, 10, 800, CELL_COLOR);
  }
}

/**
 * Draws the picture onto a canvas at twice the logical size, exactly like the
 * APK's bitmap. Returns null when the browser offers no 2D context.
 */
export function renderTournamentExportImage(
  document: Document,
  model: TournamentExportImageModel,
  icons: Icons = {},
): HTMLCanvasElement | null {
  const minimums = tournamentExportMinimums(model.mode, model.isQualifier);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context === null) { return null; }
  const widths = tournamentExportStretchedWidths(tournamentExportColumnWidths(model, minimums, (text, header) =>
    measure(context, text, 10, header ? 700 : 800)));
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const logicalWidth = 56 + tableWidth;
  const groupsHeight = model.groups.reduce((sum, group) =>
    sum + GROUP_HEAD_HEIGHT + STATS_HEIGHT + COLUMN_HEAD_HEIGHT + Math.max(1, group.rows.length) * ROW_HEIGHT + GROUP_GAP, 0);
  const logicalHeight = 32 + HEADER_HEIGHT + groupsHeight + 20;
  canvas.width = Math.ceil(logicalWidth * TOURNAMENT_EXPORT_RENDER_SCALE);
  canvas.height = Math.ceil(logicalHeight * TOURNAMENT_EXPORT_RENDER_SCALE);
  // Deliberately no inline size. An inline width beats the stylesheet, and
  // with a `max-height` bound above it the picture was drawn into a box of
  // the wrong shape: a six-group results picture is 0.29 wide-to-tall and
  // was shown at 0.81, stretched sideways. How large it appears is the
  // page's business; the drawing only says how large it is.
  context.scale(TOURNAMENT_EXPORT_RENDER_SCALE, TOURNAMENT_EXPORT_RENDER_SCALE);
  context.fillStyle = PAGE_COLOR;
  context.fillRect(0, 0, logicalWidth, logicalHeight);
  context.textBaseline = "alphabetic";

  const x0 = MARGIN;
  roundRect(context, x0, 16, tableWidth + 40, logicalHeight - 24 - 16, 10, CARD_COLOR);
  roundRect(context, x0 + 1, 17, tableWidth + 38, HEADER_HEIGHT - 3, 9, HEADER_COLOR);
  const centre = x0 + 20 + tableWidth / 2;
  drawText(context, model.title, centre, 48, 18, 700, TITLE_COLOR, "center");
  drawText(context, model.subtitle, centre, 70, 12, 600, SUBTITLE_COLOR, "center");

  let y = 16 + HEADER_HEIGHT + 8;
  for (const group of model.groups) {
    const rowCount = Math.max(1, group.rows.length);
    const groupHeight = GROUP_HEAD_HEIGHT + STATS_HEIGHT + COLUMN_HEAD_HEIGHT + rowCount * ROW_HEIGHT;
    const groupLeft = x0 + 20;
    roundRect(context, groupLeft, y, tableWidth, groupHeight, 8, GROUP_COLOR);
    const gradient = context.createLinearGradient(groupLeft, y, groupLeft, y + groupHeight);
    gradient.addColorStop(0, group.borderStart);
    gradient.addColorStop(1, group.borderEnd);
    context.fillStyle = gradient;
    context.fillRect(groupLeft, y, 6, groupHeight);
    if (model.isQualifier) {
      drawText(context, group.heading, groupLeft + 12, y + 23, 13, 700, GROUP_NAME_COLOR);
    } else {
      const style = tierStyle(group.groupTierKey);
      const labelWidth = Math.max(74, measure(context, group.heading, 10, 800) + 16);
      roundRect(context, groupLeft + 12, y + 7, labelWidth, 18, 9, style.background);
      drawText(context, group.heading, groupLeft + 20, y + 20, 10, 800, style.foreground);
    }
    const participantsText = `${group.participantCount} deelnemers`;
    const participantWidth = measure(context, participantsText, 10, 700) + 12;
    const participantLeft = groupLeft + tableWidth - participantWidth - 8;
    roundRect(context, participantLeft, y + 7, participantWidth, 18, 9, BADGE_COLOR);
    drawText(context, participantsText, participantLeft + 6, y + 20, 10, 700, BADGE_TEXT_COLOR);

    const statsY = y + GROUP_HEAD_HEIGHT;
    context.fillStyle = STATS_COLOR;
    context.fillRect(groupLeft + 8, statsY, tableWidth - 16, STATS_HEIGHT);
    let statsX = groupLeft + 18;
    if (!group.skillKnown) {
      drawText(context, "Geen SP bekend voor deze avond", statsX, statsY + 18, 10, 600, STATS_TEXT_COLOR);
    } else {
      const prefix = `Gem. SP: ${tournamentExportMetric(group.averageSkill)} · Spreiding: `;
      drawText(context, prefix, statsX, statsY + 18, 10, 600, STATS_TEXT_COLOR);
      statsX += measure(context, prefix, 10, 600);
      const plusText = `+${tournamentExportMetric(group.spreadPlus)}`;
      drawText(context, plusText, statsX, statsY + 18, 10, 700, PLUS_COLOR);
      statsX += measure(context, plusText, 10, 700) + 8;
      drawText(context, "/", statsX, statsY + 18, 10, 600, STATS_TEXT_COLOR);
      statsX += measure(context, "/", 10, 600) + 8;
      drawText(context, `-${tournamentExportMetric(group.spreadMinus)}`, statsX, statsY + 18, 10, 700, MINUS_COLOR);
    }

    const columnY = statsY + STATS_HEIGHT;
    context.fillStyle = COLUMN_COLOR;
    context.fillRect(groupLeft, columnY, tableWidth, COLUMN_HEAD_HEIGHT);
    let columnX = groupLeft;
    model.headers.forEach((header, index) => {
      if (model.mode === "layout" && index === 1) {
        drawText(context, header, columnX + widths[index]! / 2, columnY + 17, 10, 700, HEADER_TEXT_COLOR, "center");
      } else {
        drawText(context, header, columnX + 8, columnY + 17, 10, 700, HEADER_TEXT_COLOR);
      }
      columnX += widths[index]!;
    });
    let rowY = columnY + COLUMN_HEAD_HEIGHT;
    const rows = group.rows.length > 0 ? group.rows : [emptyRow(model)];
    rows.forEach((row, rowIndex) => {
      if (rowIndex > 0) {
        context.strokeStyle = LINE_COLOR;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(groupLeft + 8, rowY);
        context.lineTo(groupLeft + tableWidth, rowY);
        context.stroke();
      }
      if (model.mode === "layout") { drawLayoutRow(context, row, rowY, groupLeft, widths, icons); }
      else { drawResultsRow(context, row, rowY, groupLeft, widths, model.isQualifier); }
      rowY += ROW_HEIGHT;
    });
    y += groupHeight + GROUP_GAP;
  }
  return canvas;
}

let iconCache: Promise<Icons> | null = null;

/** The source Nintendo Switch marks, loaded once; a failure means text markers. */
export function loadTournamentExportIcons(document: Document): Promise<Icons> {
  if (iconCache !== null) { return iconCache; }
  const load = (path: string): Promise<CanvasImageSource | undefined> => new Promise((resolve) => {
    const view = document.defaultView;
    if (view === null || typeof view.Image !== "function") { resolve(undefined); return; }
    const image = new view.Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = path;
  });
  iconCache = Promise.all([load("/styles/mk8dx_ns1.png"), load("/styles/mk8dx_ns2.png")])
    .then(([ns1, ns2]) => ({ ...(ns1 === undefined ? {} : { ns1 }), ...(ns2 === undefined ? {} : { ns2 }) }));
  return iconCache;
}

export function tournamentExportImageBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => { canvas.toBlob(resolve, "image/png"); });
}
