import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, expect, test } from "vitest";
import { registerPublicBundleRoutes } from "../src/runtime/public-bundle.js";

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

test("closed public inventory serves scanner/assets and no private file or HTML fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "mk8dx-public-bundle-")); directories.push(root);
  await mkdir(join(root, "scanner")); await mkdir(join(root, "assets"));
  await writeFile(join(root, "scanner/index.html"), "<p>scanner</p>");
  await writeFile(join(root, "scanner/model.wasm"), "wasm");
  await mkdir(join(root, "scanner/shared-icon"));
  await writeFile(join(root, "scanner/shared-icon/mask.bin"), "mask");
  await writeFile(join(root, "assets/logo.png"), "png");
  await writeFile(join(root, "secrets.json"), "private");
  const app = Fastify();
  try {
    await registerPublicBundleRoutes(app, root, "https://example.invalid");
    const scanner = await app.inject("/scanner/");
    expect(scanner.statusCode).toBe(200);
    expect(scanner.headers["cross-origin-embedder-policy"]).toBe("require-corp");
    expect((await app.inject("/scanner/model.wasm")).headers["content-type"]).toContain("application/wasm");
    const mask = await app.inject("/scanner/shared-icon/mask.bin");
    expect(mask.statusCode).toBe(200);
    expect(mask.headers["content-type"]).toContain("application/octet-stream");
    expect((await app.inject("/assets/logo.png")).statusCode).toBe(200);
    const config = await app.inject("/client-config.json");
    expect(config.json()).toEqual({ schemaVersion: "mk8dx.public-client.v1", websiteOrigin: "https://example.invalid" });
    expect(config.body).not.toContain("password");
    for (const path of ["/secrets.json", "/scanner/missing.json", "/assets/missing.json"])
      expect((await app.inject(path)).statusCode).toBe(404);
  } finally { await app.close(); }
});

test("offline public client config advertises invitations without changing the online shape", async () => {
  const root = await mkdtemp(join(tmpdir(), "mk8dx-offline-bundle-")); directories.push(root);
  await mkdir(join(root, "scanner")); await mkdir(join(root, "assets"));
  await writeFile(join(root, "scanner/index.html"), "<p>scanner</p>");
  const app = Fastify();
  try {
    await registerPublicBundleRoutes(app, root, "https://192.168.50.20", true);
    expect((await app.inject("/client-config.json")).json()).toEqual({
      schemaVersion: "mk8dx.public-client.v1", websiteOrigin: "https://192.168.50.20",
      authenticationMode: "offline-invitation",
    });
  } finally { await app.close(); }
});

test("binary files outside the scanner mask tree remain refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "mk8dx-public-bin-")); directories.push(root);
  await mkdir(join(root, "assets")); await mkdir(join(root, "scanner"));
  await writeFile(join(root, "scanner/index.html"), "scanner");
  await writeFile(join(root, "assets/unexpected.bin"), "private");
  const app = Fastify();
  try { await expect(registerPublicBundleRoutes(app, root, "https://example.invalid")).rejects.toThrow("unsupported public file type"); }
  finally { await app.close(); }
});

test("unexpected scanner input is refused before routes register", async () => {
  const root = await mkdtemp(join(tmpdir(), "mk8dx-public-link-")); directories.push(root);
  await mkdir(join(root, "assets")); await mkdir(join(root, "scanner"));
  await writeFile(join(root, "scanner/index.html"), "scanner");
  await writeFile(join(root, "scanner/.secret"), "private");
  const app = Fastify();
  try { await expect(registerPublicBundleRoutes(app, root, "https://example.invalid")).rejects.toThrow(); }
  finally { await app.close(); }
});
