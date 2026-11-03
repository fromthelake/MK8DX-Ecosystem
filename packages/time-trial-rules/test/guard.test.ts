// T-CONF guard: a rule id may not exist in one place and not the others
// (rules.json, the TypeScript implementation, the Kotlin implementation), every
// message key has English and Dutch text whose placeholders are declared
// params, and the case file covers every required category and every rule.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { RULE_IDS } from "../src/index.ts";

const root = join(import.meta.dirname, "..");
const repo = join(root, "..", "..");
const kotlinPath = join(repo, "apps", "timetrials-android", "app", "src", "main", "java",
  "nl", "mariokart8", "mk8dxtimetrials", "rules", "TimeTrialRules.kt");

type Rule = {
  id: string;
  field: string;
  messageKey: string;
  alternateMessageKeys?: string[];
  params: string[];
};
const rules = JSON.parse(readFileSync(join(root, "rules.json"), "utf8")) as {
  rulesVersion: string;
  submissionContract: string;
  rules: Rule[];
  messages: Record<string, { en: string; nl: string }>;
};
const cases = JSON.parse(readFileSync(join(root, "conformance", "cases.json"), "utf8")) as {
  rulesVersion: string;
  submissionContract: string;
  categories: string[];
  cases: { id: string; category: string; deferred?: string;
    expect: { errors: { rule: string; messageKey?: string }[] } }[];
};
const specText = readFileSync(join(root, "SPEC.md"), "utf8");
const kotlinText = readFileSync(kotlinPath, "utf8");

function kotlinRuleIds(): string[] {
  const block = /val RULE_IDS: List<String> = listOf\(([\s\S]*?)\)/.exec(kotlinText);
  assert.ok(block, "Kotlin RULE_IDS listOf(...) block not found");
  return [...block[1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
}

const specIds = rules.rules.map((rule) => rule.id);

describe("rule id guard", () => {
  it("rules.json, TypeScript and Kotlin declare the same rule ids in the same order", () => {
    assert.equal(new Set(specIds).size, specIds.length, "duplicate id in rules.json");
    assert.deepEqual([...RULE_IDS], specIds, "TypeScript RULE_IDS");
    assert.deepEqual(kotlinRuleIds(), specIds, "Kotlin RULE_IDS");
  });

  it("every rule id is used by both implementations, not only declared", () => {
    const tsText = readFileSync(join(root, "src", "index.ts"), "utf8");
    for (const id of specIds) {
      const tsUses = tsText.split(`"${id}"`).length - 1;
      const ktUses = kotlinText.split(`"${id}"`).length - 1;
      assert.ok(tsUses >= 2, `TypeScript declares but never raises ${id}`);
      assert.ok(ktUses >= 2, `Kotlin declares but never raises ${id}`);
    }
  });

  it("the versions agree and SPEC.md documents every rule", () => {
    assert.equal(cases.rulesVersion, rules.rulesVersion);
    assert.equal(cases.submissionContract, rules.submissionContract);
    assert.ok(specText.includes(`Rules version: **${rules.rulesVersion}**`), "SPEC.md version line");
    assert.ok(kotlinText.includes(`RULES_VERSION = "${rules.rulesVersion}"`), "Kotlin RULES_VERSION");
    for (const id of specIds) { assert.ok(specText.includes(`\`${id}\``), `SPEC.md lacks ${id}`); }
  });
});

describe("messages", () => {
  it("every message key has English and Dutch text using only declared params", () => {
    const used = new Set<string>();
    for (const rule of rules.rules) {
      const params = new Set(rule.params.map((p) => p.replace(/\?$/, "")));
      for (const key of [rule.messageKey, ...(rule.alternateMessageKeys ?? [])]) {
        used.add(key);
        const message = rules.messages[key];
        assert.ok(message, `missing messages for ${key}`);
        for (const language of ["en", "nl"] as const) {
          const text = message[language];
          assert.ok(typeof text === "string" && text.length > 0, `${key}.${language}`);
          for (const [, name] of text.matchAll(/\{([A-Za-z]+)\}/g)) {
            assert.ok(params.has(name!), `${key}.${language} uses undeclared {${name}}`);
          }
        }
      }
    }
    assert.deepEqual(Object.keys(rules.messages).sort(), [...used].sort(), "orphan message keys");
  });
});

describe("case file coverage", () => {
  const active = cases.cases.filter((c) => c.deferred === undefined);

  it("covers every required category with at least one runnable case", () => {
    const required = ["valid", "invalid", "edge_times", "lap_totals", "engine_context",
      "required_fields", "optional_fields", "scanner_populated", "corrected_scanner_fields",
      "offline"];
    assert.deepEqual(cases.categories, required);
    for (const category of required) {
      assert.ok(cases.cases.some((c) => c.category === category), `no case for ${category}`);
    }
    for (const c of cases.cases) { assert.ok(required.includes(c.category), c.id); }
  });

  it("every rule id is exercised by at least one runnable case and every case rule exists", () => {
    const exercised = new Set(active.flatMap((c) => c.expect.errors.map((e) => e.rule)));
    for (const id of specIds) { assert.ok(exercised.has(id), `no runnable case raises ${id}`); }
    for (const c of cases.cases) {
      for (const error of c.expect.errors) {
        assert.ok(specIds.includes(error.rule), `${c.id} uses unknown rule ${error.rule}`);
        if (error.messageKey !== undefined) {
          assert.ok(rules.messages[error.messageKey], `${c.id} uses unknown ${error.messageKey}`);
        }
      }
    }
  });

  it("deferrals name a known later phase", () => {
    const allowed = ["phase-8-adr-0204", "phase-7-offline", "phase-7-form-state"];
    for (const c of cases.cases) {
      if (c.deferred !== undefined) { assert.ok(allowed.includes(c.deferred), c.id); }
    }
  });
});
