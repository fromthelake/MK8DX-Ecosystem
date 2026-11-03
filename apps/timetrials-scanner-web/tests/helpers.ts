import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
export const webRoot = path.resolve(here, '..');
export const repoRoot = path.resolve(webRoot, '..');
// Optional task-owned recognition corpus; never a runtime or release input.
export const testkit = process.env.MK8DX_SCANNER_TESTKIT || path.join(repoRoot, 'testkit');

export async function frameBytes(file: string): Promise<string> {
  return (await fs.readFile(file)).toString('base64');
}

export async function manifestFrames(): Promise<any[]> {
  return JSON.parse(await fs.readFile(path.join(testkit, 'manifest.json'), 'utf8')).frames;
}

export async function referenceFor(id: string): Promise<any> {
  return JSON.parse(await fs.readFile(path.join(testkit, 'reference', `${id}.json`), 'utf8'));
}

export async function openParity(page: Page, query = ''): Promise<void> {
  await page.goto(`/parity.html?${query}`, { waitUntil: 'load' });
  await page.evaluate(() => (window as any).mk8Parity.ready);
}

/** Eén frame door de pipeline (galerij/scanfile-route). */
export async function runFrame(page: Page, file: string, layout: 'endscreen' | 'ghost_detail'): Promise<any> {
  const b64 = await frameBytes(file);
  return page.evaluate(async ({ b64, layout }) => {
    const arr = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return (window as any).mk8Parity.runFile(arr.buffer, layout);
  }, { b64, layout });
}

/** Burst-scan (ScanSession-ladder, identity-only stemframes, voortgang), optioneel STOP. */
export async function scanFrames(page: Page, files: string[], layout: 'endscreen' | 'ghost_detail', stopAfterMs = 0): Promise<{ result: any; events: any[] }> {
  const items = await Promise.all(files.map(async (f) => ({ b64: await frameBytes(f), layout })));
  return page.evaluate(async ({ items, stopAfterMs }) => {
    const frames = items.map((i) => ({ bytes: Uint8Array.from(atob(i.b64), (c) => c.charCodeAt(0)).buffer, layout: i.layout }));
    return (window as any).mk8Parity.scanFrames(frames, stopAfterMs);
  }, { items, stopAfterMs });
}

export function decisionSummary(rec: any): Record<string, unknown> {
  const out: Record<string, unknown> = { fields: rec.fields, lap_sum_ok: rec.lapSumOk ?? rec.lap_sum_ok };
  const owners = rec.kartConfig?.owners ?? rec.kart_config ?? {};
  for (const [owner, ow] of Object.entries<any>(owners)) {
    for (const kind of ['character', 'kart', 'wheel', 'glider', 'flag']) {
      const e = ow?.[kind] ?? {};
      out[`${owner}.${kind}`] = { id: e.id ?? null, index: e.index ?? null, name: e.name ?? null, ok: !!e.ok };
    }
  }
  return out;
}
