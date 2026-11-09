// Product-UI-tests via de echte camera-API (Chromium fake device met een
// y4m-video van een eindscherm/paneel): richtgids -> SCAN -> burst -> freeze
// -> Rainbow Road-voortgang -> Finish -> resultaat; STOP; galerij; falen.
// Schermafbeeldingen = visueel bewijs (eis §49) in test-results/screens/.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { testkit, webRoot } from './helpers';

const screens = path.join(webRoot, 'test-results', 'screens');
const fake = (name: string) => path.join(webRoot, 'testkit', 'fake', name);

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(screens, { recursive: true });
  await page.screenshot({ path: path.join(screens, `${name}.png`) });
}

async function launchWith(browserType: any, video: string, lang = 'nl') {
  const browser = await browserType.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      ...(video ? [`--use-file-for-fake-video-capture=${video}`] : [])],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: lang === 'nl' ? 'nl-NL' : 'en-GB', permissions: ['camera'] });
  const page = await context.newPage();
  page.on('pageerror', (e: Error) => console.log('[pageerror]', e.message));
  return { browser, page };
}

async function waitReady(page: Page, href = '/'): Promise<void> {
  await page.goto(href, { waitUntil: 'load' });
  await expect(page.locator('.status')).toContainText(/richt op|aim at/, { timeout: 120_000 });
}

test('camera uses its automatic maximum and zoom has a digital fallback', async ({ playwright }) => {
  const { browser, page } = await launchWith(playwright.chromium, '', 'en');
  try {
    await waitReady(page, '/?track=track.gcn_baby_park&mode=150&handoff=mk8dx.scan-handoff.v1&return=%2F%3Fpost%3Dtrack.gcn_baby_park%26mode%3D150&layout=endscreen&laps=7');
    await expect(page.locator('.controls button', { hasText: 'LAPS' })).toBeHidden();
    const zoom = page.locator('.controls button', { hasText: '1.0x' });
    await zoom.click();
    await expect(page.locator('.controls button', { hasText: '1.5x' })).toBeVisible();
    await expect(page.locator('.stage video')).toHaveCSS('transform', /matrix\(1\.5, 0, 0, 1\.5, 0, 0\)/);
    await page.locator('.controls button', { hasText: '1.5x' }).click();
    await expect(page.locator('.controls button', { hasText: '2.0x' })).toBeVisible();
    await page.locator('.controls button', { hasText: '2.0x' }).click();
    await expect(page.locator('.controls button', { hasText: '2.5x' })).toBeVisible();
    await expect(page.locator('.stage video')).toHaveCSS('transform', /matrix\(2\.5, 0, 0, 2\.5, 0, 0\)/);
    await shot(page, 'camera_zoom_2p5');
    await page.locator('.controls button.scan').click();
    await expect(page.locator('.stage')).toHaveClass(/frozen/, { timeout: 10_000 });
    await expect(page.locator('.stage img.frozen')).toHaveAttribute('src', /^data:image\/jpeg/);
    await shot(page, 'camera_zoom_2p5_capture');
    await page.locator('.controls button.scan').click();
    await page.locator('.controls button', { hasText: '2.5x' }).click();
    await expect(page.locator('.controls button', { hasText: '3.0x' })).toBeVisible();
    await page.locator('.controls button', { hasText: '3.0x' }).click();
    await expect(page.locator('.controls button', { hasText: '1.0x' })).toBeVisible();
    await page.locator('.controls button.settings').click();
    await expect(page.locator('.modal')).toContainText('Automatic maximum');
    await expect(page.locator('.modal')).toContainText(/\d+ × \d+/);
  } finally {
    await browser.close();
  }
});

test('scan waits until a hardware zoom change settles', async ({ playwright }) => {
  const { browser, page } = await launchWith(playwright.chromium, '', 'en');
  try {
    await waitReady(page);
    await page.evaluate(() => {
      const video = document.querySelector('.stage video') as HTMLVideoElement;
      const track = (video.srcObject as MediaStream).getVideoTracks()[0];
      const originalSettings = track.getSettings.bind(track);
      let appliedZoom = 1;
      Object.defineProperty(track, 'getCapabilities', {
        value: () => ({ zoom: { min: 1, max: 3, step: 1 } }),
      });
      Object.defineProperty(track, 'getSettings', {
        value: () => ({ ...originalSettings(), zoom: appliedZoom }),
      });
      Object.defineProperty(track, 'applyConstraints', {
        value: async (constraints: any) => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          appliedZoom = Number(constraints.advanced?.[0]?.zoom ?? 1);
        },
      });
    });
    await page.locator('.controls button', { hasText: '1.0x' }).click();
    await expect(page.locator('.controls button.scan')).toBeDisabled();
    await expect(page.locator('.controls button', { hasText: '1.0x' })).toBeDisabled();
    await expect(page.locator('.controls button', { hasText: '1.5x' })).toBeVisible();
    await expect(page.locator('.controls button.scan')).toBeEnabled();
    await expect(page.locator('.stage video')).toHaveCSS('transform', /matrix\(1\.5, 0, 0, 1\.5, 0, 0\)/);
  } finally {
    await browser.close();
  }
});

test('RESULT aiming, camera burst, freeze, progress, Finish, result screen (NL)', async ({ playwright }) => {
  const { browser, page } = await launchWith(playwright.chromium, fake('endscreen.y4m'), 'nl');
  try {
    await waitReady(page);
    await expect(page.locator('.controls button.scan')).toHaveText(/SCAN/);
    await shot(page, '01_result_aiming_3laps');
    await page.locator('.controls button', { hasText: 'LAPS' }).click();
    await expect(page.locator('.controls button', { hasText: '7 LAPS' })).toBeVisible();
    await shot(page, '02_result_aiming_7laps');
    await page.locator('.controls button', { hasText: '7 LAPS' }).click();
    await page.locator('.controls button.scan').click();
    // STOP-toestand + bevroren frame
    await expect(page.locator('.controls button.scan')).toHaveText(/STOP/);
    await expect(page.locator('.stage')).toHaveClass(/frozen/, { timeout: 10_000 });
    await shot(page, '03_frozen_frame');
    await expect(page.locator('.progress')).toHaveClass(/visible/, { timeout: 10_000 });
    await expect(page.locator('.progress .phase')).toContainText(/Kaart zoeken|Tijdvakken|Tijden lezen|Setup/);
    await shot(page, '04_early_analysis');
    await expect(page.locator('.progress .attempt')).toContainText(/poging 1\/5 · \d+%/, { timeout: 20_000 });
    await shot(page, '05_attempt_progress');
    // Finish-moment en resultaat
    await expect(page.locator('.progress .phase')).toContainText('Finish', { timeout: 120_000 });
    await shot(page, '06_finish');
    await expect(page.locator('.result')).toHaveClass(/visible/, { timeout: 15_000 });
    await expect(page.locator('.result .hero .delta')).toContainText(/[-+]\d:\d\d\.\d\d\d/);
    const manifest = JSON.parse(await fs.readFile(path.join(testkit, 'manifest.json'), 'utf8'));
    const gt = manifest.frames.find((f: any) => f.id.startsWith('2025062717540300'));
    await expect(page.locator('.result')).toContainText(gt.gt.player.total);
    await expect(page.locator('.result .footer-row .note')).toContainText(/rondesom klopt/);
    await expect(page.locator('.controls button.scan')).toHaveText(/RESCAN/);
    await shot(page, '07_result_screen_nl');
    // verificatieweergave + specs
    await page.locator('.result .footer-row .btn', { hasText: 'Frame' }).click();
    await expect(page.locator('.result .verify')).toBeVisible();
    await shot(page, '08_verify_view');
    await page.locator('.result .back').click();
    await page.locator('.result .specs-entry').click();
    await expect(page.locator('.result .specs')).toBeVisible();
    await shot(page, '09_detail_specs');
  } finally {
    await browser.close();
  }
});

test('STOP really cancels; scan again works', async ({ playwright }) => {
  const { browser, page } = await launchWith(playwright.chromium, fake('endscreen.y4m'), 'nl');
  try {
    await waitReady(page);
    await page.locator('.controls button.scan').click();
    await expect(page.locator('.progress')).toHaveClass(/visible/, { timeout: 15_000 });
    await page.locator('.controls button.scan').click(); // ■ STOP
    await expect(page.locator('.status')).toContainText(/gestopt/);
    await expect(page.locator('.progress')).not.toHaveClass(/visible/);
    await expect(page.locator('.controls button.scan')).toHaveText(/SCAN/);
    await shot(page, '10_stopped');
    // na stop mag er geen resultaat verschijnen
    await page.waitForTimeout(8000);
    await expect(page.locator('.result')).not.toHaveClass(/visible/);
    // opnieuw scannen werkt
    await page.locator('.controls button.scan').click();
    await expect(page.locator('.result')).toHaveClass(/visible/, { timeout: 150_000 });
  } finally {
    await browser.close();
  }
});

test('failure: unreadable camera image -> honest failure text, no result', async ({ playwright }) => {
  const { browser, page } = await launchWith(playwright.chromium, fake('black.y4m'), 'nl');
  try {
    await waitReady(page);
    await page.locator('.controls button.scan').click();
    await expect(page.locator('.progress')).toHaveClass(/visible/, { timeout: 15_000 });
    await expect(page.locator('.progress .attempt')).toContainText(/beeld is lastig/, { timeout: 60_000 });
    await shot(page, '11_difficult_image');
    await expect(page.locator('.status')).toContainText(/niet gelukt/, { timeout: 120_000 });
    await expect(page.locator('.result')).not.toHaveClass(/visible/);
    await expect(page.locator('.controls button.scan')).toHaveText(/RESCAN/);
    await shot(page, '12_failure');
  } finally {
    await browser.close();
  }
});

test('GHOST aiming guide + gallery scan of a Select-a-Ghost panel (EN)', async ({ playwright }) => {
  const { browser, page } = await launchWith(playwright.chromium, fake('ghost3.y4m'), 'en');
  try {
    await waitReady(page);
    await page.locator('.controls button', { hasText: 'RESULT' }).click();
    await expect(page.locator('.controls button', { hasText: 'GHOST' })).toBeVisible();
    await expect(page.locator('.status')).toContainText(/Select-a-Ghost/);
    await shot(page, '13_ghost_aiming_3laps');
    await page.locator('.controls button', { hasText: 'LAPS' }).click();
    await shot(page, '14_ghost_aiming_7laps');
    await page.locator('.controls button', { hasText: 'LAPS' }).click();
    // galerij-route (zelfde pipeline)
    await page.locator('input[type=file]').setInputFiles(path.join(webRoot, 'testkit', 'frames_ghost', 'vlcsnap-2026-09-02-09h04m34s410.png'));
    await expect(page.locator('.progress')).toHaveClass(/visible/, { timeout: 15_000 });
    await expect(page.locator('.progress .phase')).toContainText(/Finding card|Finding time|Reading|Identifying|Confirming|Finish/);
    await expect(page.locator('.result')).toHaveClass(/visible/, { timeout: 150_000 });
    await expect(page.locator('.result')).toContainText('1:26.574');
    // enkele rijder: JIJ/YOU-kolom leeg ("—"), ghost-kolom gevuld
    await expect(page.locator('.result .setup .col').nth(0)).toContainText('—');
    await expect(page.locator('.result .setup .col').nth(1)).toContainText(/Dry Bowser/);
    await shot(page, '15_ghost_result_en');
    // persistentie van de layout-keuze
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('.controls button', { hasText: 'GHOST' })).toBeVisible({ timeout: 120_000 });
  } finally {
    await browser.close();
  }
});

test('gallery scan of a 7-lap end screen result (RESULT 7)', async ({ playwright }) => {
  const { browser, page } = await launchWith(playwright.chromium, fake('endscreen.y4m'), 'en');
  try {
    await waitReady(page);
    const manifest = JSON.parse(await fs.readFile(path.join(testkit, 'manifest.json'), 'utf8'));
    const f7 = manifest.frames.find((f: any) => f.category === '7laps_both');
    await page.locator('input[type=file]').setInputFiles(path.join(testkit, 'frames', `${f7.id}.jpg`));
    await expect(page.locator('.result')).toHaveClass(/visible/, { timeout: 150_000 });
    await expect(page.locator('.result table.laps tr')).toHaveCount(8); // kop + 7 ronden
    await expect(page.locator('.result')).toContainText(f7.gt.player.total);
    await shot(page, '16_result7_en');
  } finally {
    await browser.close();
  }
});

test('opened from the website: a 7-lap gallery scan hands the central scan result back (phase 4)', async ({ playwright }) => {
  const { browser, page } = await launchWith(playwright.chromium, fake('endscreen.y4m'), 'en');
  try {
    const key = 'mk8dx.scan-handoff.v1';
    await waitReady(page, `/?track=track.gcn_baby_park&mode=150&handoff=${key}&return=%2F%3Fhanded%3D1&layout=endscreen&laps=7`);
    const manifest = JSON.parse(await fs.readFile(path.join(testkit, 'manifest.json'), 'utf8'));
    const f7 = manifest.frames.find((f: any) => f.category === '7laps_both');
    await page.locator('input[type=file]').setInputFiles(path.join(testkit, 'frames', `${f7.id}.jpg`));
    await page.waitForURL(/handed=1/, { timeout: 150_000 });
    const payload = JSON.parse(await page.evaluate((k: string) => window.sessionStorage.getItem(k) ?? 'null', key));
    const digits = (t: string) => t[0] + t.substring(2, 4) + t.substring(5, 8);
    expect(payload.totalDigits).toBe(digits(f7.gt.player.total));
    expect(payload.laps).toHaveLength(7);
    expect(payload.layout).toBe('endscreen');
    expect(payload.lapSumMatches).toBe(true);
    expect(payload.producerVersion).toMatch(/^tt-scan-web\//);
  } finally {
    await browser.close();
  }
});
