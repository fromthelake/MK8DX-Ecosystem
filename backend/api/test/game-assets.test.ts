import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import { GameAssetConfigurationError, validateGameAssetRoot } from
  "../src/runtime/game-assets.js";

const emptyRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};

let root: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "mk8dx-game-assets-"));
  outside = mkdtempSync(join(tmpdir(), "mk8dx-outside-assets-"));
  writeFileSync(join(outside, "secret.png"), "not an asset");
  mkdirSync(join(root, "images", "cups"), { recursive: true });
  symlinkSync(outside, join(root, "images", "linked"),
    process.platform === "win32" ? "junction" : "dir");
  writeFileSync(
    join(root, "images", "cups", "000_mushroom_cup.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );
  mkdirSync(join(root, "images", "system"), { recursive: true });
  writeFileSync(
    join(root, "images", "system", "Nintendo_red_logo.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
  );
  writeFileSync(
    join(root, "images", "system", "unreviewed.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
  );
  writeFileSync(join(root, "secret.txt"), "not an asset");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("game asset serving", () => {
  it("fails closed on a missing root", () => {
    expect(() => validateGameAssetRoot(join(root, "absent")))
      .toThrow(GameAssetConfigurationError);
  });

  it("streams valid assets and 404s everything outside the closed grammar", async () => {
    const app = await buildApp({
      identityRepository: emptyRepository,
      gameAssets: { rootDirectory: root },
    });
    try {
      const asset = await app.inject({
        method: "GET",
        url: "/assets/images/cups/000_mushroom_cup.png",
      });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["content-type"]).toBe("image/png");
      expect(asset.headers["cache-control"]).toBe("public, max-age=86400");
      expect(asset.rawPayload.subarray(0, 4))
        .toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const reviewedSvg = await app.inject({
        method: "GET",
        url: "/assets/images/system/Nintendo_red_logo.svg",
      });
      expect(reviewedSvg.statusCode).toBe(200);
      expect(reviewedSvg.headers["content-type"]).toBe("image/svg+xml");

      const etag = asset.headers["etag"] as string;
      const revalidated = await app.inject({
        method: "GET",
        url: "/assets/images/cups/000_mushroom_cup.png",
        headers: { "if-none-match": etag },
      });
      expect(revalidated.statusCode).toBe(304);

      for (const url of [
        "/assets/secret.txt",
        "/assets/images/cups/absent.png",
        "/assets/images/linked/secret.png",
        "/assets/../package.json",
        "/assets/images/..%2F..%2Fsecret.png",
        "/assets/images/cups/000_mushroom_cup.PNG",
        "/assets/images/system/unreviewed.svg",
        "/assets/images/cups/",
      ]) {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode, url).toBe(404);
      }
    } finally {
      await app.close();
    }
  });
});
