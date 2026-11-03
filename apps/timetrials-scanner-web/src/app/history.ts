// Scan-geschiedenis (MainActivity.archiveScanBurst + showHistoryView):
// laatste 10 scans lokaal in IndexedDB (result + lock-frame-JPEG). Geen
// netwerk, geen account — uitsluitend op het toestel.
import type { ScanResult } from '../engine/types';

export interface HistoryEntry {
  id: number;
  timestamp: number;
  result: ScanResult;
  frameJpeg: string;
}

const KEEP = 10;
// Version 2: flags carry the schema-9 country index instead of TT Scan's one-based number
// (ADR-0214). Scans saved before keep their name; their flag numbers move down by one.
const DB_VERSION = 2;

const shiftFlagRef = (ref: unknown): unknown =>
  typeof ref === 'string' ? ref.replace(/(mk8_flags\/)(\d+)(\.png)$/, (_m, dir, n, ext) => `${dir}${Number(n) - 1}${ext}`) : ref;

/** A scan saved with TT Scan flag numbers, on the schema-9 country index. */
export function migrateFlagIndices(result: ScanResult): ScanResult {
  for (const owner of Object.values(result.identity ?? {})) {
    const flag = (owner as Record<string, unknown> | undefined)?.flag as Record<string, unknown> | undefined;
    if (!flag) continue;
    if (typeof flag.index === 'number') flag.index -= 1;
    flag.asset_ref = shiftFlagRef(flag.asset_ref);
    for (const alternative of (Array.isArray(flag.alternatives) ? flag.alternatives : []) as Record<string, unknown>[]) {
      if (typeof alternative.index === 'number') alternative.index -= 1;
      alternative.asset_ref = shiftFlagRef(alternative.asset_ref);
    }
  }
  return result;
}

export class History {
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private open(): Promise<IDBDatabase | null> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open('mk8_scanner', DB_VERSION);
          req.onupgradeneeded = (event) => {
            if (event.oldVersion < 1) {
              req.result.createObjectStore('scans', { keyPath: 'id' });
              return;
            }
            if (event.oldVersion < 2) {
              const cursor = req.transaction!.objectStore('scans').openCursor();
              cursor.onsuccess = () => {
                const at = cursor.result;
                if (!at) return;
                const entry = at.value as HistoryEntry;
                at.update({ ...entry, result: migrateFlagIndices(entry.result) });
                at.continue();
              };
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return this.dbPromise;
  }

  async add(result: ScanResult, frameJpeg: string): Promise<void> {
    const db = await this.open();
    if (!db) return;
    const slim: ScanResult = { ...result, frames: [], timing: [] };
    const entry: HistoryEntry = { id: Date.now(), timestamp: Date.now(), result: slim, frameJpeg };
    await new Promise<void>((resolve) => {
      const tx = db.transaction('scans', 'readwrite');
      tx.objectStore('scans').put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    const all = await this.list();
    if (all.length > KEEP) {
      const tx = db.transaction('scans', 'readwrite');
      for (const old of all.slice(KEEP)) tx.objectStore('scans').delete(old.id);
    }
  }

  async list(): Promise<HistoryEntry[]> {
    const db = await this.open();
    if (!db) return [];
    return new Promise((resolve) => {
      const tx = db.transaction('scans', 'readonly');
      const req = tx.objectStore('scans').getAll();
      req.onsuccess = () => resolve((req.result as HistoryEntry[]).sort((a, b) => b.id - a.id));
      req.onerror = () => resolve([]);
    });
  }
}
