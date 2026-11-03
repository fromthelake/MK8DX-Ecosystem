import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  argumentsByName.set(process.argv[index], process.argv[index + 1]);
}

const cleanAssetsPath = argumentsByName.get("--clean-assets");
const gameCatalogPath = argumentsByName.get("--game-catalog");
if (!cleanAssetsPath || !gameCatalogPath) {
  throw new Error("Usage: node generate_dutch_presentation_catalog.mjs --clean-assets <database.json> --game-catalog <game_catalog.json>");
}

const cleanAssets = JSON.parse(readFileSync(cleanAssetsPath, "utf8"));
const gameCatalog = JSON.parse(readFileSync(gameCatalogPath, "utf8"));
const expectedCounts = {
  cups: 24,
  tracks: 96,
  characters: 54,
  vehicleBodies: 41,
  vehicleTires: 22,
  vehicleGliders: 15,
  countries: 249,
};
for (const [collectionName, count] of Object.entries(expectedCounts)) {
  const rows = cleanAssets.collections?.[collectionName];
  if (!Array.isArray(rows) || rows.length !== count) {
    throw new Error(`Clean Assets ${collectionName} must contain exactly ${count} records`);
  }
}
if (!Array.isArray(gameCatalog.characters) || gameCatalog.characters.length !== 82) {
  throw new Error("The preserved character catalog must contain exactly 82 presentation records");
}

// Clean Assets carries one misspelled Dutch presentation name. Nintendo's own
// Dutch label is "Tour Singapore-Skyline"; the preserved record reads
// "Signapore". The external store stays untouched, so the correction lives here
// where it survives every regeneration, keyed by the stable ID it belongs to.
const DUTCH_SPELLING_CORRECTIONS = {
  "track.tour_singapore_speedway": { from: "Tour Signapore-Skyline", to: "Tour Singapore-Skyline" },
};

const categoryDefinitions = [
  ["cups", "cups"],
  ["tracks", "tracks"],
  ["characters", "characters"],
  ["bodies", "vehicleBodies"],
  ["tires", "vehicleTires"],
  ["gliders", "vehicleGliders"],
  ["countries", "countries"],
];
const categories = {};
const byId = {};
const byEnglish = {};

for (const [outputName, collectionName] of categoryDefinitions) {
  const records = cleanAssets.collections[collectionName].map((record) => {
    const english = record.names?.["en-US"] ?? record.names?.["en-GB"];
    const dutch = record.names?.["nl-NL"];
    if (typeof record.id !== "string" || !english || !dutch) {
      throw new Error(`${collectionName} contains a record without stable English/Dutch presentation metadata`);
    }
    const correction = DUTCH_SPELLING_CORRECTIONS[record.id];
    if (correction !== undefined && dutch !== correction.from && dutch !== correction.to) {
      throw new Error(`${record.id} no longer reads "${correction.from}"; review the correction`);
    }
    return { id: record.id, en: english, nl: correction === undefined ? dutch : correction.to };
  });
  categories[outputName] = records;
  for (const record of records) {
    byId[record.id] = record.nl;
    byEnglish[record.en] = record.nl;
  }
}

// Clean Assets contains the canonical base character IDs. The preserved game
// catalog additionally carries official Dutch labels for selectable colour
// variants. They are name aliases only and never become canonical IDs.
for (const character of gameCatalog.characters) {
  const english = character.nameUS || character.nameUK;
  const dutch = character.nameNL;
  if (!english || !dutch) throw new Error("The preserved character catalog contains an incomplete name record");
  byEnglish[english] = dutch;
}

const sortedObject = (value) => Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
const presentation = {
  schema: "mk8dx.presentation-names.v1",
  locale: "nl-NL",
  provenance: {
    cleanAssets: "Clean Assets schema-9 database.json",
    characterVariants: "Video Result Extractor game_catalog.json",
  },
  categories,
  byId: sortedObject(byId),
  byEnglish: sortedObject(byEnglish),
};
const mk8Countries = cleanAssets.collections.countries
  .filter((country) => country.isMk8Country === true)
  .map((country) => presentation.categories.countries.find((row) => row.id === country.id));
if (mk8Countries.length !== 110 || mk8Countries.some((country) => country === undefined)) {
  throw new Error("Clean Assets must contain exactly 110 selectable MK8DX countries with presentation metadata");
}

const outputs = {
  json: resolve(repositoryRoot, "packages/domain/presentation/mk8dx-nl-NL.json"),
  kotlin: resolve(repositoryRoot, "apps/timetrials-android/app/src/main/java/nl/mariokart8/mk8dxtimetrials/ui/AndroidDutchPresentationCatalog.generated.kt"),
  typescript: resolve(repositoryRoot, "apps/timetrials-web/src/dutch-presentation.generated.ts"),
  javascript: resolve(repositoryRoot, "apps/timetrials-desktop/dashboard/dutch-presentation.generated.js"),
};
Object.values(outputs).forEach((path) => mkdirSync(dirname(path), { recursive: true }));
writeFileSync(outputs.json, `${JSON.stringify(presentation, null, 2)}\n`);

const kotlinString = (value) => `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("$", "\\$")}"`;
const kotlinMap = (name, value) => `    private val ${name}: Map<String, String> = mapOf(\n${Object.entries(value).map(([key, translated]) => `        ${kotlinString(key)} to ${kotlinString(translated)},`).join("\n")}\n    )`;
writeFileSync(outputs.kotlin, `// Generated by tooling/assets/generate_dutch_presentation_catalog.mjs. Do not edit.\npackage nl.mariokart8.mk8dxtimetrials.ui\n\ninternal data class AndroidPresentationCountry(val id: String, val english: String, val dutch: String)\n\ninternal object AndroidDutchPresentationCatalog {\n${kotlinMap("byId", presentation.byId)}\n\n${kotlinMap("byEnglish", presentation.byEnglish)}\n\n    val countries: List<AndroidPresentationCountry> = listOf(\n${mk8Countries.map((country) => `        AndroidPresentationCountry(${kotlinString(country.id)}, ${kotlinString(country.en)}, ${kotlinString(country.nl)}),`).join("\n")}\n    )\n\n    fun translate(value: String): String = byId[value] ?: byEnglish[value] ?: value\n}\n`);

writeFileSync(outputs.typescript, `// Generated by tooling/assets/generate_dutch_presentation_catalog.mjs. Do not edit.\nexport const DUTCH_PRESENTATION_BY_ID: Readonly<Record<string, string>> = ${JSON.stringify(presentation.byId, null, 2)};\nexport const DUTCH_PRESENTATION_BY_ENGLISH: Readonly<Record<string, string>> = ${JSON.stringify(presentation.byEnglish, null, 2)};\n`);

writeFileSync(outputs.javascript, `// Generated by tooling/assets/generate_dutch_presentation_catalog.mjs. Do not edit.\nglobalThis.MK8DX_DUTCH_PRESENTATION = Object.freeze({\n  byId: Object.freeze(${JSON.stringify(presentation.byId, null, 2)}),\n  byEnglish: Object.freeze(${JSON.stringify(presentation.byEnglish, null, 2)})\n});\n`);

console.log(`Generated Dutch presentation catalog: ${Object.keys(presentation.byId).length} stable IDs, ${Object.keys(presentation.byEnglish).length} English aliases.`);
