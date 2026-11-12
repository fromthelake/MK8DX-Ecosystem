/** A2 management listener: never register these routes on the public API. */
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { isIP } from "node:net";
import QRCode from "qrcode";

import { OfflineHostSessions } from "./offline-host-session.js";
import { OfflineHostUnlockStore } from "./offline-host-unlock.js";
import { OfflineHostAccountError, type MysqlOfflineHostAccounts } from "./offline-host-accounts.js";
import type { OfflineInvitationTicketService } from "../authentication/offline-invitation-ticket.js";

const cookieName = "mk8dx_host_session";

function cookie(value: string | undefined): string | undefined {
  if (value === undefined) { return undefined; }
  const values = value.split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`));
  return values.length === 1 ? values[0]!.slice(cookieName.length + 1) : undefined;
}

const page = `<!doctype html><html lang="nl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MK8DX — lokaal beheer</title><link rel="stylesheet" href="/host.css">
<main><header><h1>MK8DX lokaal beheer</h1><p>Alleen op deze computer. Deel de beheercode nooit via het netwerk.</p>
<button id="logout" type="button" hidden>Afmelden</button></header>
<p id="message" role="status" aria-live="polite"></p>
<section id="access"><h2>Ontgrendelen</h2>
<form id="unlock"><label>Eenmalige beheercode (niet de certificaatvingerafdruk) <input id="code" type="password" autocomplete="off" required></label>
<button type="submit">Ontgrendelen</button></form></section>
<section id="management" hidden>
<section><h2>Installatie koppelen</h2><p>Vergelijk de certificaatvingerafdruk hieronder met /setup voordat je het certificaat vertrouwt.</p>
<img id="setup-qr" alt="QR naar de publieke setup-pagina, ook om de app te koppelen" width="220" height="220">
<p>Scan deze QR met de telefooncamera voor de setup-pagina, of in de MK8DX-app om de app te koppelen.</p>
<p>Setupadres: <a id="setup-link"></a></p>
<dl><dt>Rootcertificaat SHA-256</dt><dd id="cert-fingerprint"></dd>
<dt>Root publieke sleutel SHA-256 (SPKI)</dt><dd id="spki-fingerprint"></dd></dl></section>
<section id="bootstrap-panel" hidden><h2>Eerste beheerder</h2>
<form id="bootstrap"><label>Naam op deze installatie <input id="bootstrap-label" maxlength="80" required></label>
<button type="submit">Eerste beheerder maken</button></form></section>
<section id="accounts-panel" hidden><h2>Lokale accounts</h2>
<form id="create-account"><label>Weergavenaam <input id="account-label" maxlength="80" required></label>
<label>Rol <select id="account-role"><option value="account">Speleraccount</option>
<option value="administrator">Beheerder</option></select></label>
<button type="submit">Account maken</button></form>
<ul id="account-list"></ul></section>
<section id="invitations-panel" hidden><h2>Uitnodiging voor een account</h2>
<p>De speler moet eerst het CA-certificaat vertrouwen. De uitnodiging is 15 minuten geldig en werkt eenmaal.</p>
<form id="issue-invitation"><label>Account <select id="invitation-account"></select></label>
<button type="submit">Uitnodiging maken</button></form>
<div id="issued" hidden><img id="invitation-qr" alt="Eenmalige uitnodigings-QR" width="220" height="220">
<label>Uitnodigingslink <input id="invitation-url" readonly></label>
<button id="copy-invitation" type="button">Link kopiëren</button>
<button id="revoke-invitation" type="button">Deze uitnodiging intrekken</button>
<p id="invitation-expiry"></p></div></section>
</section></main><script src="/host.js" defer></script></html>`;

const style = `:root{font-family:system-ui,Segoe UI,sans-serif;color:#17263a;background:#f5f8fc}
*{box-sizing:border-box}body{margin:0}main{max-width:860px;margin:0 auto;padding:24px}
header,section{background:white;border:1px solid #d8e1ec;border-radius:12px;padding:20px;margin-bottom:16px}
header{display:flex;flex-wrap:wrap;align-items:center;gap:12px}h1{margin:0}header p{flex-basis:100%;margin:0}
form{display:flex;flex-wrap:wrap;align-items:end;gap:12px}label{display:grid;gap:5px;min-width:180px;flex:1}
input,select,button{font:inherit;padding:10px;border:1px solid #9daec2;border-radius:7px;min-height:44px}
button{background:#0757a6;color:white;border-color:#0757a6;cursor:pointer}button:hover{background:#004682}
img{display:block;margin:12px 0;max-width:100%;height:auto}dd{overflow-wrap:anywhere;margin:0 0 10px}
ul{padding-left:20px}li{margin:8px 0}#message{min-height:1.5em}a{overflow-wrap:anywhere}
[hidden]{display:none!important}@media(max-width:480px){main{padding:10px}header,section{padding:14px}form{display:grid}label{min-width:0}}`;

const script = `"use strict";
const $=(id)=>document.getElementById(id);let accounts=[],latestInvitation=null;
const request=async(path,body)=>fetch(path,{method:body===undefined?"GET":"POST",
  headers:body===undefined?{}:{"Content-Type":"application/json"},
  body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",referrerPolicy:"no-referrer"});
const say=(value)=>{$("message").textContent=value};
async function loadManagement(){
  const sessionResponse=await request("/api/session");
  const active=sessionResponse.ok;$("access").hidden=active;$("management").hidden=!active;$("logout").hidden=!active;
  if(!active)return;
  const session=await sessionResponse.json();
  $("bootstrap-panel").hidden=session.role!=="bootstrap";
  $("accounts-panel").hidden=session.role!=="administrator";
  $("invitations-panel").hidden=session.role!=="administrator";
  const setupResponse=await request("/api/setup");
  if(!setupResponse.ok){say("Setupgegevens zijn niet beschikbaar.");return}
  const setup=await setupResponse.json();
  $("setup-qr").src=setup.qrDataUrl;$("setup-link").href=setup.pairingUrl;
  $("setup-link").textContent=setup.pairingUrl;
  $("cert-fingerprint").textContent=setup.rootCertificateSha256;
  $("spki-fingerprint").textContent=setup.rootSpkiSha256;
  if(session.role!=="administrator")return;
  const response=await request("/api/accounts");if(!response.ok){say("Accounts konden niet worden geladen.");return}
  accounts=(await response.json()).accounts;
  const list=$("account-list"),select=$("invitation-account");list.replaceChildren();select.replaceChildren();
  for(const account of accounts){
    const item=document.createElement("li");item.textContent=account.displayLabel+" ("+account.role+")";
    list.append(item);const option=document.createElement("option");option.value=account.accountKey;
    option.textContent=account.displayLabel+" ("+account.role+")";select.append(option);
  }
}
$("unlock").addEventListener("submit",async(event)=>{
  event.preventDefault();const code=$("code").value;$("code").value="";
  const response=await request("/api/unlock",{code});
  say(response.ok?"Ontgrendeld.":"De code is ongeldig of verlopen.");if(response.ok)await loadManagement();
});
$("bootstrap").addEventListener("submit",async(event)=>{
  event.preventDefault();const displayLabel=$("bootstrap-label").value;
  const response=await request("/api/accounts",{displayLabel,role:"administrator"});
  if(!response.ok){say("Eerste beheerder kon niet worden gemaakt.");return}
  const {account}=await response.json();
  await loadManagement();say("Beheerder gemaakt. Gebruik de lokale ontgrendelopdracht met account-ID: "+account.userAccountId);
});
$("create-account").addEventListener("submit",async(event)=>{
  event.preventDefault();const displayLabel=$("account-label").value,role=$("account-role").value;
  const response=await request("/api/accounts",{displayLabel,role});
  say(response.ok?"Account gemaakt.":"Account kon niet worden gemaakt.");
  if(response.ok){$("account-label").value="";await loadManagement()}
});
$("issue-invitation").addEventListener("submit",async(event)=>{
  event.preventDefault();const account=accounts.find((value)=>value.accountKey===$("invitation-account").value);
  if(!account)return;
  const response=await request("/api/invitations",{accountKey:account.accountKey,role:account.role});
  if(!response.ok){say("Uitnodiging kon niet worden gemaakt.");return}
  latestInvitation=await response.json();$("issued").hidden=false;
  $("invitation-qr").src=latestInvitation.qrDataUrl;
  $("invitation-url").value=latestInvitation.invitationUrl;
  $("invitation-expiry").textContent="Geldig tot "+new Date(latestInvitation.expiresAtMs).toLocaleString();
  say("Eenmalige uitnodiging gemaakt. Deel de QR alleen met de bedoelde speler.");
});
$("copy-invitation").addEventListener("click",async()=>{
  if(!latestInvitation)return;await navigator.clipboard.writeText(latestInvitation.invitationUrl);
  say("Uitnodigingslink gekopieerd.");
});
$("revoke-invitation").addEventListener("click",async()=>{
  if(!latestInvitation)return;
  const response=await request("/api/invitations/revoke",{invitationId:latestInvitation.invitationId});
  say(response.ok?"Uitnodiging ingetrokken.":"Intrekken is niet gelukt.");
  if(response.ok){latestInvitation=null;$("issued").hidden=true;$("invitation-url").value=""}
});
$("logout").addEventListener("click",async()=>{
  await request("/api/logout",{});latestInvitation=null;$("issued").hidden=true;
  $("invitation-url").value="";await loadManagement();say("Afgemeld.");
});
void loadManagement();`;

export async function createOfflineHostApp(options: Readonly<{
  origin: string;
  unlocks: OfflineHostUnlockStore;
  sessions: OfflineHostSessions;
  accounts: Pick<MysqlOfflineHostAccounts, "create" | "list" | "signOutEverywhere">;
  tickets: Pick<OfflineInvitationTicketService, "issue" | "revoke">;
  publicOrigin: string;
  rootCertificateSha256: string;
  rootSpkiSha256: string;
}>): Promise<FastifyInstance> {
  const parsed = new URL(options.origin);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" ||
      !parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("offline host origin must be exact loopback HTTP with a port");
  }
  const publicUrl = new URL(options.publicOrigin);
  if (publicUrl.protocol !== "https:" || isIP(publicUrl.hostname) !== 4 ||
      publicUrl.origin !== options.publicOrigin || publicUrl.pathname !== "/" ||
      !/^[0-9a-f]{64}$/.test(options.rootCertificateSha256) ||
      !/^[0-9a-f]{64}$/.test(options.rootSpkiSha256)) {
    throw new Error("offline host public trust metadata is invalid");
  }
  const host = parsed.host;
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: 1024 });
  await app.register(rateLimit, { global: true, max: 60, timeWindow: "1 minute" });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (request.headers.host !== host || request.url.includes("?")) {
      return reply.code(404).send();
    }
    if (request.method !== "GET" && request.headers.origin !== options.origin) {
      return reply.code(403).send();
    }
  });
  app.get("/health/ready", async () => ({ ready: true }));
  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(page));
  app.get("/host.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(script));
  app.get("/host.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(style));
  app.get("/api/session", async (request, reply) => {
    const session = await options.sessions.read(cookie(request.headers.cookie));
    if (session === null) { return reply.code(401).send({ active: false }); }
    return { active: true, role: session.accountId === null ? "bootstrap" : "administrator" };
  });
  app.post("/api/unlock", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const body = request.body;
    if (typeof body !== "object" || body === null || Array.isArray(body) ||
        Object.keys(body).length !== 1 || typeof (body as Record<string, unknown>)["code"] !== "string") {
      return reply.code(400).send({ active: false });
    }
    try {
      const code = (body as { code: string }).code;
      const accountId = await options.unlocks.verify(code);
      if (accountId !== null) { await options.unlocks.consume(code); }
      const token = await options.sessions.create(accountId, accountId === null ? code : undefined);
      if (token === null) { return reply.code(401).send({ active: false }); }
      reply.header("Set-Cookie", `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
      return { active: true };
    } catch {
      return reply.code(401).send({ active: false });
    }
    });
  app.post("/api/logout", async (request, reply) => {
    options.sessions.revoke(cookie(request.headers.cookie));
    reply.header("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { active: false };
  });
  app.get("/api/setup", async (request, reply) => {
    const session = await options.sessions.read(cookie(request.headers.cookie));
    if (session === null) { return reply.code(401).send(); }
    const setupUrl = `http://${publicUrl.hostname}/setup`;
    // One QR for both: a phone camera opens /setup (a fragment never reaches the server), the
    // app reads the exact origin and CA key fingerprint from it to pair (ADR-0223 decision 7).
    const pairingUrl = `${setupUrl}#mk8dx-pair=1&origin=${encodeURIComponent(options.publicOrigin)}` +
      `&spki=${options.rootSpkiSha256}`;
    return { setupUrl, pairingUrl, origin: options.publicOrigin,
      rootCertificateSha256: options.rootCertificateSha256,
      rootSpkiSha256: options.rootSpkiSha256,
      qrDataUrl: await QRCode.toDataURL(pairingUrl, { errorCorrectionLevel: "M", margin: 2 }) };
  });
  app.get("/api/accounts", async (request, reply) => {
    const session = await options.sessions.read(cookie(request.headers.cookie));
    if (session?.accountId === undefined || session.accountId === null) {
      return reply.code(403).send();
    }
    return { accounts: await options.accounts.list(session.accountId) };
  });
  app.post("/api/accounts", async (request, reply) => {
    const sessionToken = cookie(request.headers.cookie);
    const session = await options.sessions.read(sessionToken);
    if (session === null) { return reply.code(401).send(); }
    const body = request.body;
    if (typeof body !== "object" || body === null || Array.isArray(body) ||
        Object.keys(body).length !== 2 ||
        typeof (body as Record<string, unknown>)["displayLabel"] !== "string" ||
        !["account", "administrator"].includes(String((body as Record<string, unknown>)["role"]))) {
      return reply.code(400).send();
    }
    const { displayLabel, role } = body as { displayLabel: string; role: "account" | "administrator" };
    if (session.accountId === null) {
      if (role !== "administrator") { return reply.code(403).send(); }
      const bootstrapCode = await options.sessions.bootstrapCode(sessionToken);
      if (bootstrapCode === null) { return reply.code(401).send(); }
      try { await options.unlocks.verify(bootstrapCode); }
      catch { return reply.code(401).send(); }
      try {
        const account = await options.accounts.create(null, displayLabel, role);
        // The transaction has committed. A concurrent replacement of the
        // unlock code cannot undo the account; the grant now invalidates it.
        await options.unlocks.consume(bootstrapCode).catch(() => undefined);
        options.sessions.revoke(sessionToken);
        reply.header("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
        return { account };
      } catch { return reply.code(409).send({ code: "account_creation_unavailable" }); }
    }
    try {
      return { account: await options.accounts.create(session.accountId, displayLabel, role) };
    } catch { return reply.code(409).send({ code: "account_creation_unavailable" }); }
  });
  app.post("/api/invitations", async (request, reply) => {
    const session = await options.sessions.read(cookie(request.headers.cookie));
    if (session?.accountId === undefined || session.accountId === null) {
      return reply.code(403).send();
    }
    const body = request.body;
    if (typeof body !== "object" || body === null || Array.isArray(body) ||
        Object.keys(body).length !== 2 ||
        typeof (body as Record<string, unknown>)["accountKey"] !== "string" ||
        !["account", "administrator"].includes(String((body as Record<string, unknown>)["role"]))) {
      return reply.code(400).send();
    }
    const { accountKey, role } = body as { accountKey: string; role: "account" | "administrator" };
    const actor = { role: "administrator" as const, userAccountId: session.accountId };
    try {
      const ticket = await options.tickets.issue(actor, accountKey, role);
      const invitationUrl = `${options.publicOrigin}/offline-invite#token=${ticket.token}`;
      try {
        return { invitationId: ticket.invitationId, expiresAtMs: ticket.expiresAtMs,
          invitationUrl,
          qrDataUrl: await QRCode.toDataURL(invitationUrl, { errorCorrectionLevel: "M", margin: 2 }) };
      } catch {
        await options.tickets.revoke(actor, ticket.invitationId).catch(() => undefined);
        return reply.code(500).send({ code: "invitation_unavailable" });
      }
    } catch { return reply.code(404).send({ code: "invitation_unavailable" }); }
  });
  app.post("/api/accounts/sign-out", async (request, reply) => {
    const session = await options.sessions.read(cookie(request.headers.cookie));
    if (session?.accountId === undefined || session.accountId === null) {
      return reply.code(403).send();
    }
    const body = request.body;
    if (typeof body !== "object" || body === null || Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        typeof (body as Record<string, unknown>)["accountKey"] !== "string") {
      return reply.code(400).send();
    }
    try {
      return await options.accounts.signOutEverywhere(session.accountId,
        (body as { accountKey: string }).accountKey);
    } catch (error) {
      if (error instanceof OfflineHostAccountError && error.code === "forbidden") {
        return reply.code(403).send({ code: "sign_out_forbidden" });
      }
      return reply.code(404).send({ code: "account_unavailable" });
    }
  });
  app.post("/api/invitations/revoke", async (request, reply) => {
    const session = await options.sessions.read(cookie(request.headers.cookie));
    if (session?.accountId === undefined || session.accountId === null) {
      return reply.code(403).send();
    }
    const body = request.body;
    if (typeof body !== "object" || body === null || Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        typeof (body as Record<string, unknown>)["invitationId"] !== "string") {
      return reply.code(400).send();
    }
    try {
      await options.tickets.revoke({ role: "administrator", userAccountId: session.accountId },
        (body as { invitationId: string }).invitationId);
      return { revoked: true };
    } catch { return reply.code(404).send({ code: "invitation_unavailable" }); }
  });
  return app;
}
