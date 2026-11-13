import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";

import { describe, expect, it } from "vitest";
import * as webPush from "web-push";

// The real web-push package, without a mock. web-push 4 is an ES module with named exports only (no default
// export), so this file proves the import shape the delivery worker uses, and that the request the package builds
// is an RFC 8291 aes128gcm message the subscriber can decrypt, signed with an RFC 8292 VAPID token.

const subjectUrl = "mailto:operator@example.org";

function subscriber() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    subscription: {
      endpoint: "https://push.example.test/device/1",
      keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    },
  };
}

function decrypt(body: Buffer, ecdh: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20] ?? 0;
  const serverPublic = body.subarray(21, 21 + idLength);
  const cipher = body.subarray(21 + idLength);
  const secret = ecdh.computeSecret(serverPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), serverPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", secret, auth, keyInfo, 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString("utf8");
}

describe("web-push package (real module)", () => {
  it("exports the functions the delivery worker calls", () => {
    expect(typeof webPush.setVapidDetails).toBe("function");
    expect(typeof webPush.sendNotification).toBe("function");
    expect(typeof webPush.generateRequestDetails).toBe("function");
  });

  it("builds an encrypted, VAPID-signed request the subscriber can read", () => {
    const { ecdh, auth, subscription } = subscriber();
    const vapid = webPush.generateVAPIDKeys();
    const payload = JSON.stringify({ schemaVersion: "mk8dx.web-push.v1", notificationId: "41", title: "Overtaken" });
    const details = webPush.generateRequestDetails(subscription, payload, {
      vapidDetails: { subject: subjectUrl, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: 6 * 60 * 60,
      urgency: "high",
      topic: "n41",
    });

    expect(details.method).toBe("POST");
    expect(details.endpoint).toBe(subscription.endpoint);
    const headers = details.headers as Record<string, string | number>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(Number(headers.TTL)).toBe(21_600);
    expect(headers.Urgency).toBe("high");
    expect(headers.Topic).toBe("n41");
    expect(decrypt(Buffer.from(details.body as Buffer), ecdh, auth)).toBe(payload);

    const match = /^vapid t=([^,]+), k=(.+)$/.exec(String(headers.Authorization));
    expect(match).not.toBeNull();
    const [token, key] = [match?.[1] ?? "", match?.[2] ?? ""];
    expect(key).toBe(vapid.publicKey);
    const [header, claims, signature] = token.split(".");
    const point = Buffer.from(key, "base64url");
    const publicKey = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") },
      format: "jwk",
    });
    const signed = verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature ?? "", "base64url"));
    expect(signed).toBe(true);
    const body = JSON.parse(Buffer.from(claims ?? "", "base64url").toString("utf8")) as { aud: string; sub: string; exp: number };
    expect(body.aud).toBe("https://push.example.test");
    expect(body.sub).toBe(subjectUrl);
    expect(body.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it("lets the real delivery worker send and record a transport failure", async () => {
    // The worker module itself, linked against the real package: a wrong import shape fails here, not in production.
    const { WebPushDeliveryWorker } = await import("../src/notifications/web-push-delivery.js");
    const { subscription } = subscriber();
    const vapid = webPush.generateVAPIDKeys();
    const failed: unknown[] = [];
    const target = {
      materialize: async () => undefined,
      claim: async () => [{
        deliveryId: 9, subscriptionId: 4, notificationId: "41", eventRevision: 2,
        subscription: { ...subscription, endpoint: "https://127.0.0.1:1/push" },
        kind: "overtaken", actorDisplayName: "Floyd", trackId: "track.mario_circuit", mode: 150,
        actorTimeMs: 116_200, recipientTimeMs: 116_942, recipientRank: 4, unreadCount: 1,
      }],
      delivered: async () => { throw new Error("nothing listens on port 1"); },
      failed: async (outcome: unknown) => { failed.push(outcome); },
    };
    await new WebPushDeliveryWorker(target as never, {
      subject: subjectUrl, publicKey: vapid.publicKey, privateKey: vapid.privateKey,
    }, () => 1_900_000_000_000).tick();
    expect(failed).toEqual([expect.objectContaining({
      deliveryId: 9, subscriptionId: 4, permanent: false, expiredSubscription: false, errorCode: "transport_error",
    })]);
  });

  it("reports a push service refusal with its status code", async () => {
    const { subscription } = subscriber();
    // Nothing listens on port 1: a transport failure must reject without a status code, like before.
    const refused = webPush.sendNotification({ ...subscription, endpoint: "https://127.0.0.1:1/push" }, "x", { timeout: 2000 });
    await expect(refused).rejects.toBeDefined();
    const error = new webPush.WebPushError("Gone", 410, {}, "", subscription.endpoint);
    expect(error.statusCode).toBe(410);
  });
});
