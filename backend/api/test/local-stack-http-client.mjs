import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/** Minimal cookie-jar client for the disposable local Tournament stack. */
export function createLocalStackClient(baseUrl, tls) {
  const jar = new Map();
  const origin = new URL(baseUrl);
  const request = tls === null ? httpRequest : httpsRequest;
  async function call(method, path, body, bearer, csrf) {
    const headers = { accept: "application/json", origin: baseUrl, referer: `${baseUrl}/` };
    if (jar.size > 0) {
      headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
    if (csrf !== undefined) headers["x-mk8dx-csrf"] = csrf;
    if (body !== undefined) headers["content-type"] = "application/json";
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) headers["content-length"] = Buffer.byteLength(payload);
    // Trust only this disposable gateway's certificate for this client.
    const response = await new Promise((accept, reject) => {
      const outgoing = request({
        hostname: origin.hostname,
        port: origin.port,
        path,
        method,
        headers,
        ...(tls === null ? {} : { ca: tls.cert }),
      }, (incoming) => {
        const chunks = [];
        incoming.on("data", (chunk) => chunks.push(chunk));
        incoming.on("end", () => accept({
          status: incoming.statusCode ?? 0,
          headers: incoming.headers,
          text: Buffer.concat(chunks).toString("utf8"),
        }));
        incoming.on("error", reject);
      });
      outgoing.on("error", reject);
      outgoing.end(payload);
    });
    for (const raw of response.headers["set-cookie"] ?? []) {
      const [pair] = raw.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    let parsed;
    try { parsed = response.text === "" ? undefined : JSON.parse(response.text); } catch { parsed = undefined; }
    return { ...response, body: parsed };
  }
  return { call, jar };
}
