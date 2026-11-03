import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const webRoot = resolve(root, "apps/timetrials-web");
const tournament = {
  schemaVersion: "mk8dx.tournament-operation.v1",
  summary: { tournamentId: "tournament.synthetic_browser_parity", name: "Synthetic Source Tournament", eventDate: "2026-08-22", stage: "finals", workflowStep: 9, revision: 7, participantCount: 4, presentCount: 4, publicResults: true, affectsRating: true, updatedAtMs: 1 },
  participants: [
    { playerId: "player.alpha", username: "alpha", displayName: "Alpha", attendance: "present", hasSwitch1: true, hasSwitch2: false, seedRank: 1 },
    { playerId: "player.beta", username: "beta", displayName: "Beta", attendance: "present", hasSwitch1: false, hasSwitch2: true, seedRank: 2 },
    { playerId: "player.gamma", username: "gamma", displayName: "Gamma", attendance: "present", hasSwitch1: true, hasSwitch2: false, seedRank: 3 },
    { playerId: "player.delta", username: "delta", displayName: "Delta", attendance: "present", hasSwitch1: false, hasSwitch2: false, seedRank: 4 },
  ],
  stations: [], overall: [], lifecycle: [{ sequence: 1, eventType: "incident_recorded", detail: "equipment|player.beta|Capture interruption recovered", occurredAtMs: 1 }],
  groups: [
    { groupId: "tournament_group.browser_q", stage: "qualifier", sequence: 1, name: "Qualifier A", locked: true, manualScoreSegments: 1, manualScores: [], standings: { source: "races", rows: [{ rank: 1, playerId: "player.alpha", displayName: "Alpha", points: 27, races: 2, wins: 1, bestRace: 1, complete: true }] }, members: [
      { playerId: "player.alpha", displayName: "Alpha", seatOrder: 1, station: { ownerPlayerId: "player.alpha", ownerDisplayName: "Alpha", switchType: "ns1", seatNumber: 1 } },
      { playerId: "player.beta", displayName: "Beta", seatOrder: 2, station: { ownerPlayerId: "player.beta", ownerDisplayName: "Beta", switchType: "ns2", seatNumber: 1 } },
    ], races: [
      { raceNumber: 1, raceResultId: "tournament_race_result.browser_live", revision: 1, trackId: "track.mario_kart_stadium", mode: 150, countsTowardStandings: true, placements: [{ finishPosition: 1, playerId: "player.alpha", displayName: "Alpha", racePoints: 15 }, { finishPosition: 2, playerId: "player.beta", displayName: "Beta", racePoints: 12 }] },
      { raceNumber: 2, raceResultId: "tournament_race_result.browser_processor", revision: 2, trackId: "track.water_park", mode: 150, countsTowardStandings: true, placements: [{ finishPosition: 1, playerId: "player.beta", displayName: "Beta", racePoints: 15 }, { finishPosition: 2, playerId: "player.alpha", displayName: "Alpha", racePoints: 12 }] },
    ] },
    { groupId: "tournament_group.browser_f", stage: "final", sequence: 1, name: "Final A", locked: false, manualScoreSegments: 1, manualScores: [], standings: { source: "none", rows: [] }, members: [
      { playerId: "player.gamma", displayName: "Gamma", seatOrder: 1, station: { ownerPlayerId: "player.alpha", ownerDisplayName: "Alpha", switchType: "ns1", seatNumber: 1 } },
      { playerId: "player.delta", displayName: "Delta", seatOrder: 2, station: { ownerPlayerId: "player.beta", ownerDisplayName: "Beta", switchType: "ns2", seatNumber: 1 } },
    ], races: [] },
  ],
};

const harness = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/product-page.css"><main id="app" class="page-shell page-shell--timing-tower page-shell--tournament-control"></main><script type="module">import { mountTournamentOperation } from '/dist/tournament-operation-view.js'; const doc=${JSON.stringify(tournament)}; const client={list:async()=>[doc.summary],load:async()=>doc,previewFinalization:async()=>({}),create:async()=>doc.summary,addParticipant:async()=>doc,addHistoricalParticipants:async()=>doc,removeParticipant:async()=>doc,updateParticipant:async()=>doc,generateGroups:async()=>doc,setGroupLocked:async()=>doc,moveParticipant:async()=>doc,attachRace:async()=>doc,createManualRace:async()=>doc,correctRace:async()=>doc,voidRace:async()=>doc,setManualScores:async()=>doc,recordIncident:async()=>doc,finalize:async()=>({})}; mountTournamentOperation(document.querySelector('#app'),{client,tournamentId:doc.summary.tournamentId,players:{search:async()=>[],createGuest:async()=>({})}});</script>`;
const reportHarness = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/product-page.css"><main id="app" class="page-shell page-shell--timing-tower page-shell--tournament-control"></main><script type="module">import { mountTournamentReport } from '/dist/tournament-report-view.js'; mountTournamentReport(document.querySelector('#app'),'${tournament.summary.tournamentId}');</script>`;

function type(path) { return path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : "text/html"; }
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/") { response.setHeader("content-type", "text/html; charset=utf-8"); response.end(harness); return; }
  if (pathname === "/report") { response.setHeader("content-type", "text/html; charset=utf-8"); response.end(reportHarness); return; }
  if (pathname === `/v1/tournament-reports/${tournament.summary.tournamentId}` && request.method === "GET") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ schemaVersion: "mk8dx.tournament-night-report.v1", mayManageAccess: false, tournament, draft: null })); return; }
  if (pathname === `/v1/administrator/tournaments/${tournament.summary.tournamentId}/incoming-results` && request.method === "GET") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ results: [] })); return; }
  if (pathname === `/v1/administrator/tournaments/${tournament.summary.tournamentId}/evidence-records` && request.method === "GET") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ records: [] })); return; }
  if (pathname === `/v1/tournament-reports/${tournament.summary.tournamentId}/draft` && request.method === "PUT") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ revision: 1, introText: "Saved", tracksIntroText: "", playerNotes: {}, updatedAtMs: 2 })); return; }
  if (pathname === "/v1/session/csrf" && request.method === "GET") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ headerName: "x-mk8dx-csrf", value: "browser-proof" })); return; }
  if (pathname === "/v1/administrator/tournament-report-capabilities") { response.statusCode = 403; response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ message: "Administrator required" })); return; }
  if (pathname === "/assets/images/misc/site_background.jpg" || pathname === "/favicon.ico") { response.statusCode = 204; response.end(); return; }
  const candidate = pathname.startsWith("/dist/") ? resolve(webRoot, pathname.slice(1)) : pathname.startsWith("/styles/") ? resolve(webRoot, pathname.slice(1)) : null;
  if (candidate === null || !candidate.startsWith(webRoot)) { response.statusCode = 404; response.end(); return; }
  try { response.setHeader("content-type", type(candidate)); response.end(readFileSync(candidate)); } catch { response.statusCode = 404; response.end(); }
});
await new Promise((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
const address = server.address(); if (address === null || typeof address === "string") { throw new Error("browser server did not bind"); }
const browser = await chromium.launch({ channel: process.env.MK8DX_TEST_BROWSER_CHANNEL ?? "msedge", headless: true });
try {
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") { errors.push(message.text()); } });
  page.on("requestfailed", (request) => errors.push(`${request.url()} · ${request.failure()?.errorText ?? "request failed"}`));
  page.on("response", (response) => { if (response.status() >= 400) { errors.push(`${response.status()} ${response.url()}`); } });
  for (const width of [390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Synthetic Source Tournament" }).waitFor({ timeout: 10_000 }).catch((error) => {
      throw new Error(`${error.message}\nBrowser diagnostics: ${errors.join(" | ")}`);
    });
    await page.locator(".tournament-op__helpers").evaluate((element) => { element.open = true; });
    for (const text of ["Participants", "Qualifier A", "Final A", "Incidents", "UTP cable planner", "Finals movement audit", "Tournament analytics", "Build WordPress / Evan report", "Export"]) { await page.getByText(text, { exact: false }).first().waitFor(); }
    const overflow = await page.evaluate(() => ({
      overflowing: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      widest: [...document.querySelectorAll("body *")].map((element) => ({
        tag: element.tagName,
        className: element.className,
        width: element.getBoundingClientRect().width,
        right: element.getBoundingClientRect().right,
      })).filter((row) => row.right > document.documentElement.clientWidth + 2).sort((left, right) => right.right - left.right).slice(0, 5),
      edge: [...document.querySelectorAll("body *")].map((element) => ({ tag: element.tagName, className: element.className, width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right })).filter((row) => row.right >= document.documentElement.clientWidth + 2 && row.right <= document.documentElement.scrollWidth + 2).slice(0, 12),
    }));
    assert.equal(overflow.overflowing, false, `horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`);
    const controls = await page.locator("button, a.tt-auth__button").evaluateAll((nodes) => nodes.map((node) => { const box = node.getBoundingClientRect(); return { width: box.width, height: box.height, text: node.textContent }; }));
    assert.equal(controls.some((control) => control.width < 36 || control.height < 30), false, `undersized control at ${width}px`);
  }
  for (const width of [390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`http://127.0.0.1:${address.port}/report`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Synthetic Source Tournament · WordPress report" }).waitFor();
    await page.getByPlaceholder("Tournament introduction").fill("A source-derived tournament recap.");
    await page.getByRole("button", { name: "Save report draft" }).click();
    await page.getByText("Draft saved.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Copy WordPress HTML" }).waitFor();
    await page.getByRole("button", { name: "Download WordPress HTML" }).waitFor();
    assert.equal(await page.locator(".tournament-report__preview svg").count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2), false, `report overflow at ${width}px`);
  }
  assert.deepEqual(errors, []);
  console.log("Tournament source-parity browser validation passed at 390, 430, 768, and 1280 px.");
} finally { await browser.close(); await new Promise((accept) => server.close(accept)); }
