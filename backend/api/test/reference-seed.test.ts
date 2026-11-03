import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readReferenceSeed } from "../src/composition/reference-seed-main.js";

const seedRoot = resolve("../../infrastructure/mysql/reference");
const staff = join(seedRoot, "nintendo-staff-v1.json");
const world = join(seedRoot, "world-records-v1.json");

describe("field-allowlisted reference seeds", () => {
  it("accepts exactly the reviewed Staff and World Record dimensions", async () => {
    const a = await readReferenceSeed(staff, "nintendo_staff");
    const b = await readReferenceSeed(world, "world_records");
    expect(a.rows).toHaveLength(192);
    expect(b.rows).toHaveLength(192);
    expect(a.rows.filter((row) => row.mode === 150)).toHaveLength(96);
    expect(b.rows.filter((row) => row.mode === 200)).toHaveLength(96);
  });

  it("rejects private siblings, spoofed categories and incomplete snapshots", async () => {
    const folder = await mkdtemp(join(resolve("test"), "reference-negative-"));
    const path = join(folder, "candidate.json");
    try {
      const base = JSON.parse(await readFile(world, "utf8")) as Record<string, unknown> & { records: Array<Record<string, unknown>> };
      for (const mutate of [
        (x: typeof base) => { x["accounts"] = [{ email: "synthetic@example.invalid" }]; },
        (x: typeof base) => { x.records[0]!["userAccountId"] = "user_account.synthetic"; },
        (x: typeof base) => { (x.records[0]!["holders"] as Array<Record<string, unknown>>)[0]!["email"] = "synthetic@example.invalid"; },
        (x: typeof base) => { x.records[0]!["kind"] = "nintendo_staff"; },
        (x: typeof base) => { x.records.pop(); },
      ]) {
        const candidate = structuredClone(base);
        mutate(candidate);
        await writeFile(path, JSON.stringify(candidate), "utf8");
        await expect(readReferenceSeed(path, "world_records")).rejects.toThrow();
      }
    } finally {
      if (dirname(resolve(folder)) !== resolve("test") || !basename(folder).startsWith("reference-negative-")) {
        throw new Error("negative fixture escaped the test directory");
      }
      await rm(folder, { recursive: true, force: true });
    }
  });
});
