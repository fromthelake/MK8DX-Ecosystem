import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  candidateCanonicalSha256,
  FirebaseImportPlanError,
  validateFirebaseImportPlan,
} from "../src/migration/firebase-import-plan.js";

const fixturePath = resolve(
  import.meta.dirname,
  "../../../tooling/migration/timetrials/fixtures/synthetic-firebase-import-plan-v1.json",
);

function loadFixturePlan(): Record<string, unknown> {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
}

type MutableRecord = Record<string, unknown>;

function firstRecord(plan: Record<string, unknown>): MutableRecord {
  return (plan["records"] as MutableRecord[])[0] as MutableRecord;
}

describe("Firebase import plan validation", () => {
  it("accepts the committed synthetic plan fixture", () => {
    const plan = validateFirebaseImportPlan(loadFixturePlan());
    expect(plan.records).toHaveLength(10);
    const reviewed = plan.records.filter(
      (record) => record.recordKind === "reviewed_player",
    );
    const system = plan.records.filter(
      (record) => record.recordKind === "system_reference",
    );
    expect(reviewed).toHaveLength(8);
    expect(system).toHaveLength(2);
    for (const record of reviewed) {
      expect(record.candidate.playerReference.namespace).toBe("player");
      if (record.recordKind === "reviewed_player") {
        expect(record.candidate.playerReference.value).toBe(
          record.resolution.playerId,
        );
      }
    }
    for (const record of system) {
      expect(record.candidate.playerReference.namespace).toBe(
        "unresolved_observation",
      );
      expect(record.candidate.playerReference.value).toMatch(/^legacy_system\./);
    }
    expect(
      plan.records.filter((record) => record.legacyVisible === false),
    ).toHaveLength(1);
    expect(
      plan.records.filter(
        (record) => (record.candidate.evidence?.length ?? 0) > 0,
      ),
    ).toHaveLength(3);
  });

  it("reproduces the Python canonical candidate hashes exactly", () => {
    const plan = loadFixturePlan();
    for (const record of plan["records"] as MutableRecord[]) {
      expect(candidateCanonicalSha256(record["candidate"])).toBe(
        record["candidateSha256"],
      );
    }
  });

  it("rejects a tampered candidate whose hash no longer matches", () => {
    const plan = loadFixturePlan();
    const candidate = firstRecord(plan)["candidate"] as MutableRecord;
    candidate["totalTimeMs"] = (candidate["totalTimeMs"] as number) + 1;
    // Keep laps consistent so canonical validation passes before hashing.
    const laps = candidate["laps"] as MutableRecord[];
    const lastLap = laps[laps.length - 1] as MutableRecord;
    lastLap["timeMs"] = (lastLap["timeMs"] as number) + 1;
    expect(() => validateFirebaseImportPlan(plan)).toThrow(
      /hash does not match/,
    );
  });

  it("rejects reviewed candidates that do not target one central Player", () => {
    const plan = loadFixturePlan();
    const record = firstRecord(plan);
    const candidate = record["candidate"] as MutableRecord;
    candidate["playerReference"] = {
      namespace: "legacy_firebase_user",
      value: "synthetic_firebase_uid_laps_007",
    };
    record["candidateSha256"] = candidateCanonicalSha256(candidate);
    expect(() => validateFirebaseImportPlan(plan)).toThrow(
      /target one central Player/,
    );
  });

  it("rejects a system record whose candidate lost its exact system identity", () => {
    const plan = loadFixturePlan();
    const systemRecord = (plan["records"] as MutableRecord[]).find(
      (record) => record["recordKind"] === "system_reference",
    ) as MutableRecord;
    (systemRecord["systemReference"] as MutableRecord)["value"] =
      "legacy_system.other_actor";
    expect(() => validateFirebaseImportPlan(plan)).toThrow(
      /system reference is invalid/,
    );

    const claimed = loadFixturePlan();
    const claimedRecord = (claimed["records"] as MutableRecord[]).find(
      (record) => record["recordKind"] === "system_reference",
    ) as MutableRecord;
    (claimedRecord["systemReference"] as MutableRecord)["namespace"] = "player";
    expect(() => validateFirebaseImportPlan(claimed)).toThrow(
      /system reference is invalid/,
    );
  });

  it("rejects a candidate Player that differs from its reviewed resolution", () => {
    const plan = loadFixturePlan();
    const record = firstRecord(plan);
    (record["resolution"] as MutableRecord)["playerId"] =
      "player.synthetic_other_target";
    expect(() => validateFirebaseImportPlan(plan)).toThrow(
      /match its reviewed resolution/,
    );
  });

  it("rejects unsupported source kinds, duplicates, disorder, and extra fields", () => {
    const withScanSource = loadFixturePlan();
    const scanCandidate = firstRecord(withScanSource)["candidate"] as MutableRecord;
    (scanCandidate["source"] as MutableRecord)["kind"] = "android_scan";
    expect(() => validateFirebaseImportPlan(withScanSource)).toThrow(
      FirebaseImportPlanError,
    );

    const duplicated = loadFixturePlan();
    const records = duplicated["records"] as MutableRecord[];
    records.push(JSON.parse(JSON.stringify(records[0])) as MutableRecord);
    expect(() => validateFirebaseImportPlan(duplicated)).toThrow(
      FirebaseImportPlanError,
    );

    const unordered = loadFixturePlan();
    (unordered["records"] as MutableRecord[]).reverse();
    expect(() => validateFirebaseImportPlan(unordered)).toThrow(/ordered/);

    const extended = loadFixturePlan();
    extended["extra"] = true;
    expect(() => validateFirebaseImportPlan(extended)).toThrow(
      /plan shape is invalid/,
    );

    const wrongVersion = loadFixturePlan();
    wrongVersion["schemaVersion"] = "mk8dx.firebase-timetrial-import-plan.v2";
    expect(() => validateFirebaseImportPlan(wrongVersion)).toThrow(
      /header is invalid/,
    );
  });

  it("escapes non-ASCII text like the Python canonical serializer", () => {
    expect(candidateCanonicalSha256({ text: "Ä\u{1f3c1}" })).toBe(
      candidateCanonicalSha256({ text: "Ä\u{1f3c1}" }),
    );
    // Python: hashlib.sha256(json.dumps({"text": "Ä🏁"}, ensure_ascii=True,
    // separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    expect(candidateCanonicalSha256({ text: "Ä\u{1f3c1}" })).toBe(
      "b682152c51019c06b16ddfe9771ee2f0e3dcc45e35b7af1f3d0b35d1dc7a7d68",
    );
  });

  it("refuses non-integer numbers rather than risking hash divergence", () => {
    expect(() => candidateCanonicalSha256({ value: 1.5 })).toThrow(
      /safe integers/,
    );
  });
});
