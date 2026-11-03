import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_APPEARANCE,
  hydrateAppearance,
  resolveAppearance,
  type AppearanceState,
} from "../src/appearance.js";

const boot = readFileSync(
  new URL("../styles/ds-appearance-boot.js", import.meta.url),
  "utf8",
);

type Attributes = Record<string, string>;

/** The smallest document the boot script touches, plus a storage area that can refuse. */
function bootEnvironment(options: Readonly<{
  stored?: string | null;
  storageThrows?: boolean;
  prefersLight?: boolean;
  withMeta?: boolean;
}> = {}) {
  const attributes: Attributes = {};
  const style: Attributes = {};
  const meta = { content: "unset" };
  const documentRef = {
    documentElement: {
      setAttribute(name: string, value: string) { attributes[name] = value; },
      style: { fontSize: "", set(_v: string) { /* unused */ } },
    },
    querySelector(selector: string) {
      return selector === 'meta[name="theme-color"]' && options.withMeta !== false
        ? { setAttribute(_n: string, value: string) { meta.content = value; } }
        : null;
    },
  };
  Object.defineProperty(documentRef.documentElement, "style", {
    value: new Proxy(style, {
      set(target, key: string, value: string) { target[key] = value; return true; },
      get(target, key: string) { return target[key]; },
    }),
  });
  const localStorage = {
    getItem(): string | null {
      if (options.storageThrows === true) { throw new Error("blocked"); }
      return options.stored ?? null;
    },
  };
  const windowRef = {
    matchMedia: (query: string) => ({ matches: query.includes("light") && options.prefersLight === true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("document", "localStorage", "window", boot)(documentRef, localStorage, windowRef);
  return { attributes, style, meta };
}

describe("appearance boot script (ADR-0205 §3)", () => {
  it("uses System when the device has never chosen", () => {
    const { attributes, meta } = bootEnvironment();
    expect(attributes["data-appearance-choice"]).toBe("system");
    expect(meta.content).toBe("#080C1C");
  });

  it("paints the stored choice before the stylesheets, including the page colour", () => {
    const { attributes, meta } = bootEnvironment({ stored: JSON.stringify({ choice: "light" }) });
    expect(attributes["data-appearance-choice"]).toBe("light");
    expect(meta.content).toBe("#EEF1F7");
  });

  it("lets a device on System follow its own operating system", () => {
    expect(bootEnvironment({ stored: '{"choice":"system"}', prefersLight: true }).meta.content)
      .toBe("#EEF1F7");
    expect(bootEnvironment({ stored: '{"choice":"system"}', prefersLight: false }).meta.content)
      .toBe("#080C1C");
    // An explicit Dark is never overruled by a light operating system.
    expect(bootEnvironment({ stored: '{"choice":"dark"}', prefersLight: true }).meta.content)
      .toBe("#080C1C");
  });

  it("applies the device-local text size and reduced motion", () => {
    const { attributes, style } = bootEnvironment({
      stored: JSON.stringify({ choice: "dark", textScale: 130, reducedMotion: "on" }),
    });
    expect(style["fontSize"]).toBe("130%");
    expect(attributes["data-reduced-motion"]).toBe("on");
    expect(bootEnvironment({ stored: '{"choice":"dark"}' }).style["fontSize"]).toBeUndefined();
  });

  it("survives blocked storage and unparseable records without throwing", () => {
    expect(bootEnvironment({ storageThrows: true }).attributes["data-appearance-choice"]).toBe("system");
    expect(bootEnvironment({ stored: "not json" }).attributes["data-appearance-choice"]).toBe("system");
    expect(bootEnvironment({ stored: '{"choice":"sepia","textScale":999}' })
      .attributes["data-appearance-choice"]).toBe("system");
    expect(() => bootEnvironment({ withMeta: false })).not.toThrow();
  });
});

describe("resolving a choice on a device", () => {
  it("never renders the stored value directly: System is resolved per device", () => {
    const env = (prefersLight: boolean) => ({ prefersLight, prefersMoreContrast: false });
    expect(resolveAppearance("system", env(true))).toBe("light");
    expect(resolveAppearance("system", env(false))).toBe("dark");
    expect(resolveAppearance("light", env(false))).toBe("light");
    expect(resolveAppearance("dark", env(true))).toBe("dark");
  });

  it("gives the operating system the last word on high contrast", () => {
    for (const choice of ["system", "light", "dark"] as const) {
      expect(resolveAppearance(choice, { prefersLight: true, prefersMoreContrast: true })).toBe("hc");
    }
  });
});

describe("the hydration conflict rule (ADR-0205 §4)", () => {
  const local = (over: Partial<AppearanceState> = {}): AppearanceState =>
    ({ ...DEFAULT_APPEARANCE, ...over });

  it("adopts the account value, once, when it differs", () => {
    const result = hydrateAppearance(local({ choice: "system" }), "dark");
    expect(result.next.choice).toBe("dark");
    expect(result.next.synced).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.upload).toBeNull();
    // Hydrating the result again is a no-op: it never flips back and forth.
    const again = hydrateAppearance(result.next, "dark");
    expect(again.changed).toBe(false);
    expect(again.upload).toBeNull();
  });

  it("sends an unsynced explicit local change instead: last explicit change wins", () => {
    const result = hydrateAppearance(
      local({ choice: "light", updatedAt: 1_000, synced: false }),
      "dark",
    );
    expect(result.next.choice).toBe("light");
    expect(result.upload).toBe("light");
    expect(result.changed).toBe(false);
  });

  it("leaves a device alone when the account never chose, and uploads nothing", () => {
    const result = hydrateAppearance(local({ choice: "light", updatedAt: 5, synced: true }), null);
    expect(result.next.choice).toBe("light");
    expect(result.upload).toBeNull();
    expect(result.changed).toBe(false);
  });

  it("never syncs text size or reduced motion", () => {
    const result = hydrateAppearance(
      local({ choice: "system", textScale: 130, reducedMotion: "on" }),
      "dark",
    );
    expect(result.next.textScale).toBe(130);
    expect(result.next.reducedMotion).toBe("on");
  });
});
