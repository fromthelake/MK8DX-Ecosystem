import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_SWITCH_PATH,
  ACCOUNT_SWITCH_PIN_CLEAR_PATH,
  ACCOUNT_SWITCH_PIN_PATH,
  AUTH_SIGN_OUT_PATH,
  createWebAuthenticationClient,
  parseRememberedAccounts,
  parseSwitchPinState,
  REMEMBERED_ACCOUNTS_PATH,
  WebAuthenticationError,
  type WebRememberedAccount,
} from "../src/authentication-client.js";
import { accountChooser, openAccountSwitchDialog } from "../src/account-switch-chooser.js";
import { mountAccountSwitchPinSettings } from "../src/account-switch-pin-settings.js";
import { useDocument } from "../src/ds-components.js";
import { descendants, FakeDocument, type FakeNode } from "./dom-double.js";

function json(document: unknown, status = 200): Response {
  return new Response(JSON.stringify(document), { status, headers: { "Content-Type": "application/json" } });
}
function port(answers: Readonly<Record<string, Response | (() => Response)>>) {
  return vi.fn(async (input: string, _init: RequestInit) => {
    const answer = answers[input];
    if (answer === undefined) { throw new Error(`unexpected ${input}`); }
    return typeof answer === "function" ? answer() : answer.clone();
  });
}
const csrf = { schemaVersion: "mk8dx.web-csrf.v1", headerName: "X-MK8DX-CSRF", value: "proof-1" };
const ann = "A".repeat(22);
const bob = "B".repeat(22);
// Exactly the closed shapes account-switch-routes.ts declares.
const remembered = {
  schemaVersion: "mk8dx.remembered-accounts.v1",
  accounts: [
    { entryId: ann, label: "Ann", pinRequired: false, current: true },
    { entryId: bob, pinRequired: true, current: false },
  ],
};
const pinState = { schemaVersion: "mk8dx.account-switch-pin.v1", enabled: true, currentPinRequired: false };

describe("account switching: the web client (ADR-0224 phase 2)", () => {
  it("parses the remembered accounts key for key and rejects anything extra", () => {
    expect(parseRememberedAccounts(200, remembered)).toEqual([
      { entryId: ann, label: "Ann", pinRequired: false, current: true },
      { entryId: bob, label: null, pinRequired: true, current: false },
    ]);
    for (const bad of [
      { ...remembered, extra: 1 },
      { ...remembered, accounts: [{ ...remembered.accounts[0], token: "x" }] },
      { ...remembered, accounts: [{ ...remembered.accounts[0], entryId: "short" }] },
      { ...remembered, schemaVersion: "mk8dx.remembered-accounts.v2" },
    ]) {
      expect(() => parseRememberedAccounts(200, bad)).toThrow(WebAuthenticationError);
    }
    expect(parseSwitchPinState(200, pinState)).toEqual({ enabled: true, currentPinRequired: false });
    expect(() => parseSwitchPinState(200, { ...pinState, pin: "1234" })).toThrow(WebAuthenticationError);
  });

  it("switches by entry id (and PIN), and maps the server's refusals", async () => {
    const answers: Array<Response> = [
      json({ schemaVersion: "mk8dx.account-switch.v1", switched: true }),
      json({ code: "account_switch_pin_required", message: "x" }, 403),
      json({ code: "account_switch_pin_invalid", message: "x" }, 403),
      json({ code: "account_switch_rate_limited", message: "x" }, 429),
      json({ code: "account_switch_unavailable", message: "x" }, 404),
    ];
    const fetchPort = port({ [ACCOUNT_SWITCH_PATH]: () => answers.shift()! });
    const client = createWebAuthenticationClient(fetchPort);
    await client.switchAccount!(bob, "1234");
    const sent = fetchPort.mock.calls[0]![1];
    expect(sent).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(JSON.parse(String(sent.body))).toEqual({ entryId: bob, pin: "1234" });
    for (const code of ["pin_required", "pin_invalid", "rate_limited", "not_available"]) {
      await expect(client.switchAccount!(bob)).rejects.toMatchObject({ code });
    }
    await expect(client.switchAccount!("bad")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.switchAccount!(bob, "12")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("keeps the account remembered only when signing out to use another account", async () => {
    const fetchPort = port({ [AUTH_SIGN_OUT_PATH]: json({ success: true }) });
    const client = createWebAuthenticationClient(fetchPort);
    await client.signOut();
    await client.signOut(undefined, { keepRemembered: true });
    expect(fetchPort.mock.calls[0]![1].headers).not.toHaveProperty("X-MK8DX-Keep-Remembered");
    expect(fetchPort.mock.calls[1]![1].headers).toMatchObject({ "X-MK8DX-Keep-Remembered": "1" });
  });

  it("sets and clears the PIN with a CSRF proof", async () => {
    const fetchPort = port({
      "/v1/session/csrf": json(csrf), [ACCOUNT_SWITCH_PIN_PATH]: json(pinState),
      [ACCOUNT_SWITCH_PIN_CLEAR_PATH]: json({ ...pinState, enabled: false }),
      [REMEMBERED_ACCOUNTS_PATH]: json(remembered),
    });
    const client = createWebAuthenticationClient(fetchPort);
    expect(await client.setSwitchPin!("4821", "1234")).toEqual({ enabled: true, currentPinRequired: false });
    const put = fetchPort.mock.calls.find(([path]) => path === ACCOUNT_SWITCH_PIN_PATH)![1];
    expect(put).toMatchObject({ method: "PUT" });
    expect(put.headers).toMatchObject({ "X-MK8DX-CSRF": "proof-1" });
    expect(JSON.parse(String(put.body))).toEqual({ pin: "4821", currentPin: "1234" });
    expect((await client.clearSwitchPin!()).enabled).toBe(false);
    expect(await client.rememberedAccounts!()).toHaveLength(2);
  });
});

async function settle(): Promise<void> { for (let index = 0; index < 8; index += 1) { await Promise.resolve(); } }
function buttonNamed(root: FakeNode, label: string): FakeNode {
  const found = descendants(root).find((node) => node.tagName === "button" && node.textContent === label);
  if (found === undefined) { throw new Error(`button missing: ${label}`); }
  return found;
}
function input(root: FakeNode, index = 0): FakeNode {
  const found = descendants(root).filter((node) => node.tagName === "input")[index];
  if (found === undefined) { throw new Error("input missing"); }
  return found;
}

describe("the Switch account chooser", () => {
  let document: FakeDocument;
  beforeEach(() => { document = new FakeDocument(); useDocument(document as unknown as Document); });

  const accounts: readonly WebRememberedAccount[] = [
    { entryId: ann, label: "Ann", pinRequired: false, current: true },
    { entryId: bob, label: "Bob", pinRequired: false, current: false },
    { entryId: "C".repeat(22), label: "Cy", pinRequired: true, current: false },
  ];

  it("offers every remembered account except the current one and switches with one tap", async () => {
    const switchTo = vi.fn(async () => undefined);
    const onSwitched = vi.fn();
    const dialog = openAccountSwitchDialog({ load: async () => accounts, switchTo },
      { onSwitched, onUseAnother: vi.fn() });
    dialog.open();
    await settle();
    const root = dialog.root as unknown as FakeNode;
    expect(descendants(root).some((node) => node.tagName === "button" && node.textContent === "Ann")).toBe(false);
    buttonNamed(root, "Bob").click();
    await settle();
    expect(switchTo).toHaveBeenCalledWith(bob, undefined, expect.anything());
    expect(onSwitched).toHaveBeenCalledTimes(1);
  });

  it("asks for the PIN, says when it is wrong and never keeps it", async () => {
    const switchTo = vi.fn(async (_entry: string, pin?: string) => {
      if (pin !== "4821") { throw new WebAuthenticationError("pin_invalid", false); }
    });
    const onSwitched = vi.fn();
    const chooser = accountChooser({ load: async () => accounts, switchTo }, onSwitched);
    document.body.append(chooser.root as unknown as FakeNode);
    expect(await chooser.refresh()).toBe(2);
    const root = chooser.root as unknown as FakeNode;
    buttonNamed(root, "Cy · PIN").click();
    expect(switchTo).not.toHaveBeenCalled();
    input(root).value = "0000";
    buttonNamed(root, "Switch").click();
    await settle();
    expect(String(root.textContent)).toContain("That PIN is not right.");
    expect(input(root).value).toBe("");
    input(root).value = "4821";
    buttonNamed(root, "Switch").click();
    await settle();
    expect(switchTo).toHaveBeenLastCalledWith("C".repeat(22), "4821", expect.anything());
    expect(onSwitched).toHaveBeenCalledTimes(1);
    expect(input(root).value).toBe("");
  });

  it("offers signing in with another account", async () => {
    const onUseAnother = vi.fn();
    const dialog = openAccountSwitchDialog({ load: async () => [accounts[0]!], switchTo: vi.fn() },
      { onSwitched: vi.fn(), onUseAnother });
    dialog.open();
    await settle();
    const root = dialog.root as unknown as FakeNode;
    expect(String(root.textContent)).toContain("No other accounts are remembered on this device yet.");
    buttonNamed(root, "Sign in with another account").click();
    expect(onUseAnother).toHaveBeenCalledTimes(1);
  });
});

describe("the switching PIN setting", () => {
  beforeEach(() => { useDocument(new FakeDocument() as unknown as Document); });

  it("turns a PIN on and asks for the current one when the server says so", async () => {
    const document = new FakeDocument();
    useDocument(document as unknown as Document);
    const root = document.createElement("div");
    const set = vi.fn(async () => ({ enabled: true, currentPinRequired: true }));
    const mounted = mountAccountSwitchPinSettings(root as unknown as HTMLElement, {
      read: async () => ({ enabled: false, currentPinRequired: false }),
      set,
      clear: vi.fn(async () => ({ enabled: false, currentPinRequired: false })),
    });
    await mounted.ready;
    expect(String(root.textContent)).toContain("No PIN: one tap switches");
    input(root, 1).value = "48a1";
    buttonNamed(root, "Turn on PIN").click();
    expect(set).not.toHaveBeenCalled();
    input(root, 1).value = "4821";
    buttonNamed(root, "Turn on PIN").click();
    await settle();
    expect(set).toHaveBeenCalledWith("4821", undefined, expect.anything());
    expect(String(root.textContent)).toContain("A PIN is on for this account.");
    expect(input(root, 0).value).toBe("");
    expect(input(root, 1).value).toBe("");
    mounted.unmount();
  });

  it("stays away for an account the server refuses (an administrator)", async () => {
    const document = new FakeDocument();
    useDocument(document as unknown as Document);
    const root = document.createElement("div");
    const mounted = mountAccountSwitchPinSettings(root as unknown as HTMLElement, {
      read: async () => { throw new WebAuthenticationError("not_available", false); },
      set: vi.fn(), clear: vi.fn(),
    });
    await mounted.ready;
    expect(root.children).toHaveLength(0);
  });
});
