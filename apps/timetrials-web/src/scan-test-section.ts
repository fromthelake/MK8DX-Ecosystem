import {
  dataTable,
  el,
  engineMark,
  panel,
  statusMessage,
  type DataRow,
} from "./ds-components.js";
import { localized, productLocaleTag } from "./product-language.js";

const path = "/v1/time-trial-scan-tests";
const maximumResponseBytes = 131_072;

type ScanTest = Readonly<{
  submissionId: string;
  playerId: string;
  mode: 150 | 200;
  trackId: string;
  totalTimeMs: number;
  expiresAtMs: number;
}>;

function formatTime(value: number): string {
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor(value % 60_000 / 1_000);
  const milliseconds = value % 1_000;
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${
    milliseconds.toString().padStart(3, "0")}`;
}

function parse(input: unknown): readonly ScanTest[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error();
  const root = input as Record<string, unknown>;
  if (Object.keys(root).length !== 1 || !Array.isArray(root["results"])) throw new Error();
  return root["results"].map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    const row = value as Record<string, unknown>;
    const required = ["submissionId", "revision", "playerId", "mode", "trackId",
      "totalTimeMs", "createdAtMs", "expiresAtMs"];
    if (Object.keys(row).length !== required.length || required.some((key) => !(key in row)) ||
      typeof row["submissionId"] !== "string" || typeof row["playerId"] !== "string" ||
      typeof row["trackId"] !== "string" ||
      (row["mode"] !== 150 && row["mode"] !== 200) ||
      !Number.isSafeInteger(row["totalTimeMs"]) || !Number.isSafeInteger(row["expiresAtMs"])) {
      throw new Error();
    }
    return {
      submissionId: row["submissionId"],
      playerId: row["playerId"],
      mode: row["mode"],
      trackId: row["trackId"],
      totalTimeMs: row["totalTimeMs"] as number,
      expiresAtMs: row["expiresAtMs"] as number,
    };
  });
}

export function mountScanTestSection(root: HTMLElement, playerId: string): void {
  const body = el("div", "ds-stack", { "data-gap": "md" });
  const setStatus = (tone: "info" | "error", text: string): void => {
    body.replaceChildren(statusMessage(tone, text));
  };
  setStatus("info", localized(
    "Checking your temporary scanner tests…",
    "Je tijdelijke scannertests worden gecontroleerd…",
  ));
  const section = panel({
    title: localized("Scanner test results", "Resultaten van scannertests"),
    titleLevel: 2,
    children: [body],
  });
  root.append(section);
  void fetch(path, { headers: { Accept: "application/json" }, credentials: "same-origin" })
    .then(async (response) => {
      const declared = Number(response.headers.get("content-length"));
      if (!response.ok || (Number.isFinite(declared) && declared > maximumResponseBytes)) throw new Error();
      const responseText = await response.text();
      if (new TextEncoder().encode(responseText).length > maximumResponseBytes) throw new Error();
      return parse(JSON.parse(responseText)).filter((entry) => entry.playerId === playerId);
    })
    .then((results) => {
      if (!section.isConnected) return;
      if (results.length === 0) {
        setStatus("info", localized(
          "No active test results. Use Try a test scan in Android to verify your phone.",
          "Geen actieve testresultaten. Gebruik Probeer een testscan in Android om je telefoon te controleren.",
        ));
        return;
      }
      const rows = results.map((result): DataRow => ({
        key: result.submissionId,
        cells: [
          el("span", "ds-table__name-inner", {},
            el("span", "ds-table__name-text", { title: result.trackId },
              result.trackId.substring("track.".length).replaceAll("_", " "))),
          engineMark(result.mode, "plain"),
          el("span", "ds-table__num-inner", {}, formatTime(result.totalTimeMs)),
          new Date(result.expiresAtMs).toLocaleString(productLocaleTag()),
        ],
      }));
      body.replaceChildren(
        statusMessage("info", localized(
          "These verify Android sync. They never affect rankings and are deleted automatically.",
          "Hiermee wordt Android-synchronisatie gecontroleerd. Ze hebben nooit invloed op ranglijsten en worden automatisch verwijderd.",
        )),
        dataTable({
          caption: localized("Temporary scanner test results", "Tijdelijke resultaten van scannertests"),
          density: "timing",
          columns: [
            { key: "track", label: localized("Track", "Circuit"), align: "name" },
            { key: "engine", label: localized("Engine", "Motorklasse"), phone: 1 },
            { key: "time", label: localized("Time", "Tijd"), align: "num", phone: 2 },
            { key: "expiry", label: localized("Deletes", "Verwijderd"), phone: 3, tablet: "drop" },
          ],
          rows,
        }),
      );
    })
    .catch(() => {
      if (section.isConnected) {
        setStatus("error", localized(
          "Temporary scanner tests could not be loaded.",
          "Tijdelijke scannertests konden niet worden geladen.",
        ));
      }
    });
}
