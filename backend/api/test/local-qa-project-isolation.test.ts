import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("isolated local Compose installation", () => {
  it("generates an explicit task project and refuses to regenerate persistent keys", () => {
    const root = mkdtempSync(join(tmpdir(), "mk8dx-install-test-"));
    const state = join(root, "private-state");
    const python = process.platform === "win32" ? "python" : "python3";
    const script = resolve("../../tooling/install.py");
    try {
      execFileSync(python, [script, "init", "--state-dir", state], { stdio: "pipe" });
      const compose = readFileSync(join(state, "compose.env"), "utf8");
      const runtime = readFileSync(join(state, "operator.json"), "utf8");
      expect(compose).toMatch(/MK8DX_PROJECT_NAME='mk8dx-os-[a-f0-9]{10}'/);
      expect(compose).toContain("MK8DX_BIND_ADDRESS='127.0.0.1'");
      expect(runtime).toContain("MK8DX_HOSTED_AUTHENTICATION_LOOKUP_HMAC_KEY_BASE64");
      expect(() => execFileSync(python, [script, "init", "--state-dir", state],
        { stdio: "pipe" })).toThrow();
      expect(readFileSync(join(state, "operator.json"), "utf8")).toBe(runtime);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps databases unexposed and mounts only the generated operator file", () => {
    const compose = readFileSync(resolve("../../compose.yaml"), "utf8");
    expect(compose).toContain("name: ${MK8DX_PROJECT_NAME:?");
    expect(compose).toContain("${MK8DX_STATE_DIR:?}/operator.json:/run/mk8dx/operator.json:ro");
    expect(compose).toContain("- database:/var/lib/mysql");
    expect(compose).not.toMatch(/docker\.sock|privileged:|network_mode:\s*host/);
  });
});
