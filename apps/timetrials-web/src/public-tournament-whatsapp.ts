// The WhatsApp text a participant can paste, built from the night's own public
// document.
//
// The Director has always produced this from the operator tools. Everybody else
// had to wait for it to appear in the chat, including the person who only
// wanted to know which console they were on. The public document now carries
// the seating, so the same text can be produced by anyone looking at the night.
//
// The shape is not ours to restyle: it is the format the group chat has read
// for years, and `tournamentWhatsAppText` in the operator view is the original.
// Both must keep producing the same text for the same night.

import type { PublicTournamentEvent } from "./tournament-operation-client.js";

export type PublicExportMode = "layout" | "results" | "auto";

/**
 * "Nintendo Switch van Bas" - the owner's own name, with any stored prefix
 * removed first so it is never written twice.
 */
function stationLabel(ownerDisplayName: string): string {
  const owner = ownerDisplayName
    .replace(/^(Nintendo Switch van|Switch van|Console)\s+/i, "")
    .trim();
  return owner === "" ? "Nintendo Switch" : `Nintendo Switch van ${owner}`;
}

function groupTitle(group: PublicTournamentEvent["groups"][number]): string {
  const index = group.name.replace(/\D+/g, "");
  const prefix = group.stage === "final" ? "Eindgroep " : "Kwalificatiegroep ";
  return prefix + (index !== "" ? index : group.name);
}

export function publicTournamentWhatsAppText(
  event: PublicTournamentEvent,
  stage: "qualifier" | "final" | null,
  mode: PublicExportMode = "auto",
): string {
  const includeSeating = mode === "layout" || mode === "auto";
  const includeResults = mode === "results" || mode === "auto";
  const groups = stage === null
    ? event.groups
    : event.groups.filter((group) => group.stage === stage);
  const chunks: string[] = [];
  for (const group of groups) {
    const lines: string[] = [groupTitle(group)];
    let hasSeatingLines = false;
    if (includeSeating) {
      const stations = new Map<string, { label: string; marker: string; seats: string[] }>();
      for (const seat of group.seating) {
        const key = `${seat.stationOwnerDisplayName}|${seat.switchType}`;
        const station = stations.get(key) ?? {
          label: stationLabel(seat.stationOwnerDisplayName),
          marker: seat.switchType === "ns2" ? "[NS2]" : "[NS1]",
          seats: [],
        };
        station.seats[seat.seatNumber - 1] = seat.displayName;
        stations.set(key, station);
      }
      for (const station of stations.values()) {
        const entries = station.seats
          .map((name, index) => (name === undefined ? null : `#${index + 1} ${name}`))
          .filter((entry): entry is string => entry !== null);
        if (entries.length === 0) { continue; }
        lines.push(`— ${station.marker} ${station.label}: ${entries.join(" & ")}`);
        hasSeatingLines = true;
      }
      if (!hasSeatingLines && mode === "layout") { lines.push("— Nog geen plaatsing"); }
    }
    if (includeResults) {
      if (group.standings.length > 0) {
        if (hasSeatingLines && includeSeating) { lines.push(""); }
        lines.push("Uitslag:");
        group.standings.forEach((row, index) => {
          lines.push(`#${index + 1} ${row.displayName} (${row.points} pt)`);
        });
      } else if (mode === "results") {
        lines.push("Uitslag: nog niet beschikbaar");
      }
    }
    chunks.push(lines.join("\n"));
  }
  if (chunks.length === 0) {
    const isFinal = stage === "final";
    const isQualifier = stage === "qualifier";
    if (mode === "layout") {
      return isFinal
        ? "Geen eindgroep-indeling gevonden."
        : isQualifier ? "Geen kwalificatie-indeling gevonden." : "Geen indelingen gevonden.";
    }
    if (mode === "results") {
      return isFinal
        ? "Geen eindgroep-uitslagen gevonden."
        : isQualifier ? "Geen kwalificatie-uitslagen gevonden." : "Geen uitslagen gevonden.";
    }
    return isFinal
      ? "Geen eindgroepen gevonden."
      : isQualifier ? "Geen kwalificatiegroepen gevonden." : "Geen groepen gevonden.";
  }
  return chunks.join("\n\n");
}

/**
 * What the night is at right now decides what is worth pasting: the seating
 * while it is being set up, the qualifier results once they are being raced,
 * the whole night once it is over.
 */
export function stageExport(
  event: PublicTournamentEvent,
): Readonly<{ stage: "qualifier" | "final" | null; mode: PublicExportMode; label: string }> {
  switch (event.stage) {
    case "setup":
      return { stage: "qualifier", mode: "layout", label: "layout" };
    case "qualifiers":
      return { stage: "qualifier", mode: "auto", label: "qualifiers" };
    case "finals":
      return { stage: "final", mode: "auto", label: "finals" };
    default:
      return { stage: null, mode: "results", label: "results" };
  }
}
