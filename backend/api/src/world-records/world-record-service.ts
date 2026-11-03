import type { WorldRecordEntry } from "./mkwrs-parser.js";
import { parseCompleteMkwrsSnapshot } from "./mkwrs-parser.js";

export interface WorldRecordRepository {
  latestImportAtMs(): Promise<number | null>;
  replaceComplete(records: readonly WorldRecordEntry[], nowMs: number): Promise<number>;
  list(): Promise<readonly WorldRecordEntry[]>;
}
export type WorldRecordFetch = (url: string) => Promise<string>;
export class WorldRecordService {
  public constructor(private readonly repository: WorldRecordRepository, private readonly fetchPage: WorldRecordFetch, private readonly now: () => number = () => Date.now()) {}
  public list(): Promise<readonly WorldRecordEntry[]> { return this.repository.list(); }
  public async refreshIfDue(force = false): Promise<Readonly<{ refreshed: boolean; changed: number }>> {
    const now = this.now(), latest = await this.repository.latestImportAtMs();
    if (!force && latest !== null && now - latest < 86_400_000) return { refreshed: false, changed: 0 };
    // Fetch both first; no database write is possible until both parsers have
    // proved their complete, ordered set of 96 canonical tracks.
    const [html150, html200] = await Promise.all([
      this.fetchPage("https://mkwrs.com/mk8dx/wrs.php"),
      this.fetchPage("https://mkwrs.com/mk8dx/wrs_200.php"),
    ]);
    const records = parseCompleteMkwrsSnapshot(html150, html200);
    return { refreshed: true, changed: await this.repository.replaceComplete(records, now) };
  }
}
