"""Build the browser's reference projection from the two versioned seeds."""

import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEEDS = ROOT / "infrastructure" / "mysql" / "reference"
TARGET = ROOT / "apps" / "timetrials-web" / "src" / "benchmark-manifest.ts"
STAFF_LOADOUTS = SEEDS / "nintendo-staff-loadouts-v1.json"
LOADOUT_CATALOG = ROOT / "apps" / "timetrials-web" / "src" / "loadout-manifest.ts"
VARIANT_CATALOG = ROOT / "apps" / "timetrials-web" / "src" / "loadout-variants.ts"

# The seed uses display names. These are the reviewed schema-9 identities for
# names that are not an exact, unique match in the public loadout catalogue.
CHARACTER_ALIASES = {
    "Champion Link": "character.champion_link",
    "Link": "character.link",
    "Inkling Boy Teal": "character.inkling_boy",
    "Heavy Mii": "character.mii_heavy",
    "Light Mii Moo Moo": "character.mii_light",
}
for outfit in ("Birdo", "Cheep Cheep", "Cpt Falcon", "DK", "Dolphin",
               "Dry Bowser", "Koopa Clown", "Moo Moo", "Para-Biddybud", "Yoshi"):
    CHARACTER_ALIASES[f"Heavy Mii {outfit}"] = "character.mii_heavy"
for colour in ("Black", "Blue", "Light-blue", "Orange", "Pink", "Red",
               "White", "Yellow"):
    CHARACTER_ALIASES[f"{colour} Yoshi"] = "character.yoshi"
YOSHI_COLOURS = {"Black": "018_black", "Blue": "022_blue",
                 "Light-blue": "017_light_blue", "Orange": "024_orange",
                 "Pink": "023_pink", "Red": "019_red",
                 "White": "021_white", "Yellow": "020_yellow"}


def loadout_catalog():
    content = LOADOUT_CATALOG.read_text(encoding="utf-8")
    names = {}
    identities = set()
    for part_id, name in re.findall(r'\{ id: "([^"]+)", name: "([^"]+)",', content):
        identities.add(part_id)
        names.setdefault(name.casefold(), []).append(part_id)
    if len(identities) < 100:
        raise ValueError("Public loadout catalog is incomplete")
    variant_ids = set(re.findall(r'"id": "(character_variant\.[^"]+)"',
                                 VARIANT_CATALOG.read_text(encoding="utf-8")))
    return names, identities, variant_ids


def world_record_loadout(row, names, identities, variant_ids):
    loadout = {}
    for field, prefix in (("characterName", "character"), ("bodyName", "body"),
                          ("tireName", "tire"), ("gliderName", "glider")):
        name = row[field]
        alias = CHARACTER_ALIASES.get(name) if prefix == "character" else None
        # Any Mii outfit ("Heavy Mii Crossing") is the Mii of that weight class.
        for weight in ("Heavy", "Medium", "Light"):
            if prefix == "character" and alias is None and name.startswith(f"{weight} Mii "):
                alias = f"character.mii_{weight.lower()}"
        matches = [item for item in names.get(name.casefold(), ())
                   if item.startswith(prefix + ".")]
        selected = alias or (matches[0] if len(matches) == 1 else None)
        if not selected or selected not in identities:
            raise ValueError(f"Unreviewed World Record loadout name: {field}={name}")
        loadout[prefix + "Id"] = selected
    for colour, suffix in YOSHI_COLOURS.items():
        if row["characterName"] == f"{colour} Yoshi":
            variant_id = f"character_variant.yoshi.{suffix}"
            if variant_id not in variant_ids:
                raise ValueError("Yoshi variant is missing from the public catalog")
            loadout["characterVariantId"] = variant_id
            break
    # The public catalog has no exact match for Mii outfit names or "Teal".
    # Keep the reviewed base character, without inventing an appearance variant.
    return loadout


def records(name):
    value = json.loads((SEEDS / name).read_text(encoding="utf-8"))
    rows = value["records"]
    if len(rows) != 192 or len({(row["trackId"], row["mode"]) for row in rows}) != 192:
        raise ValueError("reference seed is incomplete")
    return rows


def generate():
    entries = []
    catalog_names, catalog_ids, variant_ids = loadout_catalog()
    staff = records("nintendo-staff-v1.json")
    loadout_data = json.loads(STAFF_LOADOUTS.read_text(encoding="utf-8"))
    loadout_rows = loadout_data["records"]
    checksum = hashlib.sha256(json.dumps(loadout_rows, sort_keys=True, separators=(",", ":"),
                                         ensure_ascii=False).encode("utf-8")).hexdigest()
    if (loadout_data["schemaVersion"] != "mk8dx.nintendo-staff-loadouts.v1"
            or loadout_data["count"] != 192 or len(loadout_rows) != 192
            or loadout_data["recordsSha256"] != checksum):
        raise ValueError("Staff loadout dataset identity mismatch")
    loadouts = {(row["trackId"], row["mode"]): row for row in loadout_rows}
    if len(loadouts) != 192:
        raise ValueError("Staff loadout keys overlap")
    for row in staff:
        detail = loadouts[(row["trackId"], row["mode"])]
        if detail["playerName"] != row["playerName"] or detail["timeMs"] != row["timeMs"]:
            raise ValueError("Staff loadout does not match reviewed reference seed")
        loadout = detail["loadout"]
        if set(loadout) != {"characterId", "bodyId", "tireId", "gliderId"}:
            raise ValueError("Staff loadout fields changed")
        entries.append({"kind": "nintendo_staff", "trackId": row["trackId"], "mode": row["mode"],
                        "name": row["playerName"], "timeMs": row["timeMs"],
                        "countryId": row["countryId"], "flagPath": None, "loadout": loadout})
    for row in records("world-records-v1.json"):
        laps = row["lapTimesMs"]
        mushrooms = row["mushroomsPerLap"]
        coins = row["coinsPerLap"]
        # Coins and mushrooms are one per lap, or empty when the source groups them differently.
        if len(laps) not in (3, 7) or any(len(items) not in (0, len(laps)) for items in (mushrooms, coins)):
            raise ValueError("World Record lap readings are incomplete")
        entry = {"kind": "world_record", "trackId": row["trackId"], "mode": row["mode"],
                 "name": row["playerName"], "timeMs": row["totalTimeMs"],
                 "countryId": None, "flagPath": None,
                 "loadout": world_record_loadout(row, catalog_names, catalog_ids, variant_ids),
                 "lapTimesMs": laps}
        if mushrooms:
            entry["mushroomsPerLap"] = mushrooms
        if coins:
            entry["coinsPerLap"] = coins
        entries.append(entry)
    entries.sort(key=lambda row: (row["trackId"], row["mode"], row["kind"]))
    if len({(row["kind"], row["trackId"], row["mode"]) for row in entries}) != 384:
        raise ValueError("reference kinds overlap")
    return """// GENERATED by tooling/reference/generate_benchmark_manifest.py. Do not edit.
export type BenchmarkKind = \"world_record\" | \"nintendo_staff\";
export type BenchmarkEntry = Readonly<{
  kind: BenchmarkKind;
  trackId: string;
  mode: 150 | 200;
  name: string;
  timeMs: number;
  countryId: string | null;
  flagPath: string | null;
  loadout?: Readonly<Record<string, string>>;
  lapTimesMs?: readonly number[];
  mushroomsPerLap?: readonly number[];
  coinsPerLap?: readonly number[];
}>;

const BENCHMARKS: readonly BenchmarkEntry[] = """ + json.dumps(entries, ensure_ascii=False, indent=1) + """;

const index = new Map<string, BenchmarkEntry[]>();
for (const entry of BENCHMARKS) {
  const key = `${entry.trackId}#${entry.mode}`;
  const bucket = index.get(key) ?? [];
  bucket.push(entry);
  index.set(key, bucket);
}

export function trackBenchmarks(
  trackId: string,
  mode: 150 | 200,
): readonly BenchmarkEntry[] {
  return index.get(`${trackId}#${mode}`) ?? [];
}

export function benchmarksByKind(
  kind: BenchmarkKind,
  mode: 150 | 200,
): readonly BenchmarkEntry[] {
  return BENCHMARKS.filter((entry) => entry.kind === kind && entry.mode === mode);
}
"""


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = generate()
    if args.check:
        if TARGET.read_text(encoding="utf-8") != expected:
            raise SystemExit("benchmark manifest is out of date")
    else:
        TARGET.write_text(expected, encoding="utf-8")
