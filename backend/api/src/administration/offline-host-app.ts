/** A2 management listener: never register these routes on the public API. */
import Fastify, { type FastifyInstance } from "fastify";

import { OfflineHostSessions } from "./offline-host-session.js";
import { OfflineHostUnlockStore } from "./offline-host-unlock.js";

const cookieName = "mk8dx_host_session";

function cookie(value: string | undefined): string | undefined {
  if (value === undefined) { return undefined; }
  const values = value.split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`));
  return values.length === 1 ? values[0]!.slice(cookieName.length + 1) : undefined;
}

const page = `<!doctype html><html lang="nl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MK8DX — lokaal beheer</title><main><h1>Lokaal beheer</h1>
<p>Deze pagina is alleen op deze computer bereikbaar. Gebruik de eenmalige code uit de lokale installatieopdracht.</p>
<form id="unlock"><label>Eenmalige code <input id="code" type="password" autocomplete="off" required></label>
<button type="submit">Ontgrendelen</button></form><p id="message" role="status"></p>
<button id="logout" type="button" hidden>Afmelden</button></main><script src="/host.js" defer></script></html>`;

const script = `"use strict";
const form=document.getElementById("unlock"), message=document.getElementById("message");
const logout=document.getElementById("logout"), input=document.getElementById("code");
async function status(){
  const response=await fetch("/api/session",{cache:"no-store",referrerPolicy:"no-referrer"});
  const signedIn=response.ok; form.hidden=signedIn; logout.hidden=!signedIn;
  message.textContent=signedIn?"Beheersessie actief. Accountbeheer volgt in de A2-installatie.":"";
}
form.addEventListener("submit",async(event)=>{
  event.preventDefault();const code=input.value;input.value="";
  const response=await fetch("/api/unlock",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({code}),cache:"no-store",referrerPolicy:"no-referrer"});
  message.textContent=response.ok?"Ontgrendeld.":"De code is ongeldig of verlopen.";
  if(response.ok)await status();
});
logout.addEventListener("click",async()=>{
  await fetch("/api/logout",{method:"POST",cache:"no-store",referrerPolicy:"no-referrer"});
  await status();
});
void status();`;

export function createOfflineHostApp(options: Readonly<{
  origin: string;
  unlocks: OfflineHostUnlockStore;
  sessions: OfflineHostSessions;
}>): FastifyInstance {
  const parsed = new URL(options.origin);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" ||
      !parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("offline host origin must be exact loopback HTTP with a port");
  }
  const host = parsed.host;
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: 1024 });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
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
  app.get("/api/session", async (request, reply) => {
    const session = await options.sessions.read(cookie(request.headers.cookie));
    if (session === null) { return reply.code(401).send({ active: false }); }
    return { active: true, role: session.accountId === null ? "bootstrap" : "administrator" };
  });
  app.post("/api/unlock", async (request, reply) => {
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
  return app;
}
