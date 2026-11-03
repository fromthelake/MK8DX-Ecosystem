import { describe, expect, it, vi } from "vitest";

import { SITE_BACKDROP_CLASS, requestSiteBackdrop } from "../src/site-backdrop.js";

/**
 * The decorative page photo is 669 KB and is deliberately not asked for while
 * the landing is still painting. What matters is that it is asked for at all:
 * a visitor must end up with the same page, only sooner.
 */
function fakeWindow(): Window & { fire: (name: string) => void } {
  const listeners = new Map<string, Array<() => void>>();
  return {
    addEventListener(name: string, handler: () => void) {
      listeners.set(name, [...(listeners.get(name) ?? []), handler]);
    },
    setTimeout: ((handler: () => void) => { handler(); return 0; }),
    fire(name: string) { for (const h of listeners.get(name) ?? []) { h(); } },
  } as unknown as Window & { fire: (name: string) => void };
}

function fakeDocument(readyState: DocumentReadyState): Document {
  const classes = new Set<string>();
  return {
    readyState,
    documentElement: { classList: { add: (c: string) => classes.add(c), has: (c: string) => classes.has(c) } },
    get __classes() { return classes; },
  } as unknown as Document;
}

describe("requestSiteBackdrop", () => {
  it("waits for the page to finish loading before asking for the photo", () => {
    const document_ = fakeDocument("loading");
    const window_ = fakeWindow();
    requestSiteBackdrop(document_, window_);
    const classes = (document_ as unknown as { __classes: Set<string> }).__classes;
    expect(classes.has(SITE_BACKDROP_CLASS)).toBe(false);
    window_.fire("load");
    expect(classes.has(SITE_BACKDROP_CLASS)).toBe(true);
  });

  it("adopts it straight away on a document that already finished", () => {
    const document_ = fakeDocument("complete");
    requestSiteBackdrop(document_, fakeWindow());
    expect((document_ as unknown as { __classes: Set<string> }).__classes
      .has(SITE_BACKDROP_CLASS)).toBe(true);
  });

  it("prefers an idle moment when the browser offers one", () => {
    const document_ = fakeDocument("loading");
    const window_ = fakeWindow();
    const idle = vi.fn((callback: () => void) => { callback(); return 1; });
    (window_ as unknown as { requestIdleCallback: unknown }).requestIdleCallback = idle;
    requestSiteBackdrop(document_, window_);
    window_.fire("load");
    expect(idle).toHaveBeenCalledOnce();
    expect((document_ as unknown as { __classes: Set<string> }).__classes
      .has(SITE_BACKDROP_CLASS)).toBe(true);
  });
});
