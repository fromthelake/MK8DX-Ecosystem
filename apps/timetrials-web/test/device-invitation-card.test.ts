import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebAuthenticationError, type WebDeviceInvitation } from "../src/authentication-client.js";
import { useDocument } from "../src/ds-components.js";
import { openDeviceInvitationDialog, qrSvg } from "../src/device-invitation-card.js";
import { byClass, descendants, FakeDocument, type FakeNode } from "./dom-double.js";

function card(token: string, expiresAtMs = 10_000): WebDeviceInvitation {
  return {
    invitationUrl: `https://192.168.1.20/offline-invite#token=${token}`,
    expiresAtMs,
    qr: { size: 21, modules: Array.from({ length: 21 * 21 }, (_value, index) => index % 3 === 0) },
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) { await Promise.resolve(); }
}

function qrOf(root: FakeNode): FakeNode | undefined {
  return descendants(root).find((node) => node.getAttribute("class") === "ds-device-card__qr");
}
function text(root: FakeNode): string { return String(root.textContent); }
function linkInput(root: FakeNode): FakeNode {
  const input = descendants(root).find((node) => node.tagName === "input");
  if (input === undefined) { throw new Error("link input missing"); }
  return input;
}
function buttonNamed(root: FakeNode, label: string): FakeNode {
  const found = descendants(root).find((node) => node.tagName === "button" && node.textContent === label);
  if (found === undefined) { throw new Error(`button missing: ${label}`); }
  return found;
}

let document: FakeDocument;
beforeEach(() => {
  document = new FakeDocument();
  useDocument(document as unknown as Document);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => { vi.useRealTimers(); });

describe("the Add another device card (ADR-0224)", () => {
  it("draws the QR from the module matrix on its own white field, without markup", () => {
    const svg = qrSvg(card("A".repeat(43)).qr, "QR") as unknown as FakeNode;
    expect(svg.getAttribute("viewBox")).toBe("0 0 29 29");
    const [field, path] = svg.children;
    expect(field?.getAttribute("fill")).toBe("#ffffff");
    expect(path?.getAttribute("fill")).toBe("#000000");
    // 147 of the 441 modules are dark in this synthetic matrix, one unit square each.
    expect(path?.getAttribute("d")?.match(/M/g)).toHaveLength(147);
    expect(path?.getAttribute("d")).toMatch(/^M4 4h1v1h-1z/);
  });

  it("asks for a card on open and shows the QR, the link and its expiry", async () => {
    const createInvitation = vi.fn(async () => card("A".repeat(43)));
    const dialog = openDeviceInvitationDialog(createInvitation, { nowMs: () => 0 });
    dialog.open();
    const root = dialog.root as unknown as FakeNode;
    expect(text(root)).toContain("Making a card");
    await settle();
    expect(createInvitation).toHaveBeenCalledTimes(1);
    expect(linkInput(root).value).toBe(`https://192.168.1.20/offline-invite#token=${"A".repeat(43)}`);
    expect(qrOf(root)).toBeDefined();
    expect(byClass(root, "ds-device-card")?.hidden).toBe(false);
    expect(text(root)).toContain("Works once, valid until");
    expect(text(root)).toContain("whoever scans it is signed in as you");
  });

  it("replaces the card on New card and says the previous one stopped working", async () => {
    let count = 0;
    const createInvitation = vi.fn(async () => card(String(++count).repeat(43)));
    const dialog = openDeviceInvitationDialog(createInvitation, { nowMs: () => 0 });
    dialog.open();
    await settle();
    const root = dialog.root as unknown as FakeNode;
    buttonNamed(root, "New card").click();
    await settle();
    expect(createInvitation).toHaveBeenCalledTimes(2);
    expect(linkInput(root).value).toContain("2".repeat(43));
    expect(text(root)).toContain("The previous card no longer works.");
  });

  it("removes the card when it expires and when the dialog closes", async () => {
    const dialog = openDeviceInvitationDialog(async () => card("A".repeat(43), 900_000), { nowMs: () => 0 });
    dialog.open();
    await settle();
    const root = dialog.root as unknown as FakeNode;
    await vi.advanceTimersByTimeAsync(900_000);
    expect(linkInput(root).value).toBe("");
    expect(qrOf(root)).toBeUndefined();
    expect(text(root)).toContain("This card has expired.");

    const second = openDeviceInvitationDialog(async () => card("B".repeat(43)), { nowMs: () => 0 });
    second.open();
    await settle();
    const secondRoot = second.root as unknown as FakeNode;
    expect(linkInput(secondRoot).value).toContain("B".repeat(43));
    buttonNamed(secondRoot, "Close").click();
    expect(linkInput(secondRoot).value).toBe("");
    expect(secondRoot.isConnected).toBe(false);
  });

  it("explains a refusal without showing a card", async () => {
    const dialog = openDeviceInvitationDialog(async () => {
      throw new WebAuthenticationError("not_available", false);
    });
    dialog.open();
    await settle();
    const root = dialog.root as unknown as FakeNode;
    expect(text(root)).toContain("This account cannot add a device here.");
    expect(byClass(root, "ds-device-card")?.hidden).toBe(true);
    expect(linkInput(root).value).toBe("");
  });
});
