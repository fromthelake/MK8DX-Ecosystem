// ADR-0218: display names may repeat; usernames stay unique.
//
// Where two equal names can meet - a ranking, a statistics table - the page
// adds the username to those names only. Everywhere else a name stays as it
// is, and links already carry the unique username.

type Named = Readonly<{ playerId: string; displayName: string }>;

const nameKey = (value: string): string => value.trim().toLocaleLowerCase();

/** The display names that more than one Player in `entries` carries. */
export function repeatedDisplayNames(entries: readonly Named[]): ReadonlySet<string> {
  const owners = new Map<string, Set<string>>();
  for (const entry of entries) {
    const key = nameKey(entry.displayName);
    const set = owners.get(key) ?? new Set<string>();
    set.add(entry.playerId);
    owners.set(key, set);
  }
  return new Set([...owners.entries()].filter(([, players]) => players.size > 1).map(([key]) => key));
}

/** "Marc" stays "Marc" unless another Marc is on the same page: then "Marc (@marc-2)". */
export function disambiguatedName(
  entry: Readonly<{ displayName: string; username?: string | null }>,
  repeated: ReadonlySet<string>,
): string {
  if (entry.username === undefined || entry.username === null || entry.username.length === 0) { return entry.displayName; }
  return repeated.has(nameKey(entry.displayName)) ? `${entry.displayName} (@${entry.username})` : entry.displayName;
}
