// The guard that keeps the scanner from becoming a second product again (ADR-0206,
// LEGACY_RETIREMENT §2 rows "Separate scanner application as a UX system" and "Duplicate forms").
//
// ADR-0206's transition state is precise about what may still live under /scanner/: the engine, the
// camera, and a diagnostics harness. What may NOT live there is a Player-facing review, a second
// form, a second validator or a second mapping from a recognised result into a submission. This
// test reads the actual import graph and the actual sources of both applications and says so.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, "..", "src");
const scannerRoot = join(here, "..", "..", "timetrials-scanner-web");
const scannerApp = join(scannerRoot, "src", "app");

const webFiles = readdirSync(webSrc).filter((name) => name.endsWith(".ts"));
const read = (dir: string, name: string): string => readFileSync(join(dir, name), "utf8");

/** Every module in the product web application that names a symbol. */
function webModulesMentioning(pattern: RegExp): readonly string[] {
  return webFiles.filter((name) => pattern.test(read(webSrc, name)));
}

describe("one form, one review, one mapping (ADR-0206)", () => {
  it("has exactly one module that mounts the Post-a-Time task", () => {
    expect(webModulesMentioning(/export function mountPostTimeTask\b/)).toEqual(["post-time-task.ts"]);
  });

  it("no longer has the retired manual-entry form modules at all", () => {
    for (const retired of [
      "manual-entry-state.ts", "manual-entry-dom.ts", "manual-entry-mount.ts",
      "manual-entry-shell.ts", "manual-details.ts", "manual-document-host.ts",
      "manual-product-page.ts", "manual-publication-host.ts",
    ]) {
      expect(webFiles, `${retired} is retired`).not.toContain(retired);
    }
  });

  it("maps a recognised result into a draft in exactly one place", () => {
    expect(webModulesMentioning(/export function scanFillFromHandoff\b/)).toEqual(["scan-service.ts"]);
    // The task and the page consume the service; neither rebuilds the mapping.
    expect(read(webSrc, "post-time-task.ts")).not.toMatch(/observedPlayerName:\s*handoff\./);
  });

  it("builds the handoff payload in exactly one place in the scanner", () => {
    const scannerFiles = readdirSync(scannerApp).filter((name) => name.endsWith(".ts"));
    const builders = scannerFiles.filter((name) =>
      /export function buildEcosystemHandoff\b/.test(read(scannerApp, name)));
    expect(builders).toEqual(["ecosystem.ts"]);
  });

  it("imports nothing of the scanner application into the product", () => {
    for (const name of webFiles) {
      expect(read(webSrc, name), `${name} imports the scanner`)
        .not.toMatch(/from\s+["'][^"']*timetrials-scanner-web/);
    }
  });
});

describe("the scanner's own result view is diagnostics, not the Player's review", () => {
  const main = read(scannerApp, "main.ts");

  it("is rendered by the scanner application only", () => {
    const importers = readdirSync(scannerApp)
      .filter((name) => name.endsWith(".ts") && name !== "resultView.ts")
      .filter((name) => /from '\.\/resultView'/.test(read(scannerApp, name)));
    expect(importers).toEqual(["main.ts"]);
  });

  it("hands a scan started from the task straight back to the task", () => {
    // The Player who came from the Post-a-Time task never meets the scanner's own review: the
    // result goes into their draft and they check it in the one form.
    expect(main).toMatch(/if \(this\.ecosystem && !this\.devVisible\) \{[\s\S]{0,400}?handOverToEcosystem/);
  });

  it("never validates or publishes anything itself", () => {
    for (const name of readdirSync(scannerApp).filter((file) => file.endsWith(".ts"))) {
      const source = read(scannerApp, name);
      expect(source, `${name} publishes`).not.toMatch(/time-trial-submissions/);
      expect(source, `${name} speaks the submission contract`)
        .not.toMatch(/mk8dx\.time-trial-submission/);
    }
  });
});

describe("the scanner palette is retired (LEGACY_RETIREMENT §2)", () => {
  const appCss = readFileSync(join(scannerApp, "app.css"), "utf8");

  it("defines no colours of its own any more", () => {
    const definitions = [...appCss.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1]);
    expect(definitions).toEqual([]);
  });

  it("takes its colours from the generated token subset", () => {
    const tokens = readFileSync(join(scannerApp, "ds-tokens.generated.css"), "utf8");
    const used = new Set([...appCss.matchAll(/var\((--ds-[a-z0-9-]+)\)/g)].map((match) => match[1]));
    expect(used.size).toBeGreaterThan(0);
    for (const token of used) {
      expect(tokens, `${token} is in the scanner token subset`).toContain(`${token}:`);
    }
  });

  it("no longer carries the yellow scanner mark or forces an orientation", () => {
    const index = readFileSync(join(scannerRoot, "index.html"), "utf8");
    expect(index).not.toMatch(/user-scalable=no/);
    expect(index).toContain("ds-tokens.generated.css");
    expect(readFileSync(join(scannerRoot, "vite.config.ts"), "utf8"))
      .not.toMatch(/orientation:\s*'landscape'/);
  });
});
