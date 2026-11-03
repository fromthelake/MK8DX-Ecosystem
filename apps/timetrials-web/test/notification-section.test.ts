import { describe, expect, it } from "vitest";

import {
  mountNotificationSection,
  notificationEventMessage,
  notificationLink,
  notificationMessage,
} from "../src/notification-section.js";
import type {
  NotificationClient,
  NotificationView,
} from "../src/notification-client.js";
import type { PlayerEngagementClient, Engagement } from "../src/player-engagement-client.js";
import { FakeDocument, type FakeNode, descendants } from "./dom-double.js";

const hasClass = (node: FakeNode, className: string): boolean =>
  node.className.split(" ").includes(className);

const beaten: NotificationView = {
  notificationId: "7",
  kind: "overtaken",
  actorPlayerId: "player.floyd",
  actorDisplayName: "Floyd",
  trackId: "track.mount_wario",
  mode: 150,
  actorTimeMs: 115_331,
  recipientTimeMs: 115_942,
  deltaMs: -611,
  recipientRank: 4,
  count: 4,
  lastEventAtMs: 1_900_000_000_000,
  read: false,
};

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) { await Promise.resolve(); }
}

describe("notification section", () => {
  it("shows an incoming RPS turn, sends the chosen hand and displays the result", async () => {
    const pending: Engagement = {
      engagementId: "player_engagement.test_123456", kind: "rock_paper_scissors",
      actorPlayerId: "player.floyd", recipientPlayerId: "player.ben",
      actorDisplayName: "Floyd", recipientDisplayName: "Ben", createdAtMs: 1_000,
    };
    let current = pending;
    const answers: string[] = [];
    const engagementClient: PlayerEngagementClient = {
      async send() { throw new Error("unused"); },
      async list() { return { engagements: [current],
        rpsStats: current.detail === undefined
          ? { played: 0, wins: 0, losses: 0, draws: 0 }
          : { played: 1, wins: 1, losses: 0, draws: 0 } }; },
      async answer(_id, hand) {
        answers.push(hand ?? "dice");
        current = { ...pending, detail: { hand: "rock", recipientHand: hand ?? "paper",
          outcome: "recipient", respondedAtMs: 2_000 } };
        return current;
      },
      async conversation() { throw new Error("unused"); },
    };
    const notificationClient: NotificationClient = {
      async inbox() { return { unreadCount: 0, notifications: [] }; },
      async events() { return []; },
      async markRead() {},
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountNotificationSection(root as unknown as HTMLElement,
      "player.ben", notificationClient, () => 2_000, null, engagementClient);
    await mounted.ready; await settle();
    const paper = descendants(root).find((node) => node.tagName === "button" &&
      node.textContent?.includes("Paper"));
    expect(paper).toBeDefined();
    paper?.click();
    await settle();
    expect(answers).toEqual(["paper"]);
    expect(descendants(root).find((node) => hasClass(node, "notifications__game"))?.textContent)
      .toContain("Winner: Ben");
    mounted.unmount();
  });
  it("opens a grouped entry and lists what it counted", async () => {
    const records: NotificationView = {
      notificationId: "91",
      kind: "world_record",
      trackId: "track.rainbow_road",
      mode: 200,
      count: 3,
      lastEventAtMs: 1_900_000_000_000,
      read: false,
    };
    let requested: string | null = null;
    const client: NotificationClient = {
      async inbox() { return { unreadCount: 1, notifications: [records] }; },
      async events(notificationId) {
        requested = notificationId;
        return [
          { occurredAtMs: 1_900_000_000_000, trackId: "track.rainbow_road", mode: 200 },
          { occurredAtMs: 1_899_999_000_000, trackId: "track.mount_wario", mode: 150 },
        ];
      },
      async markRead() { throw new Error("unused"); },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountNotificationSection(
      root as unknown as HTMLElement, "player.ben", client,
      () => 1_900_000_600_000,
    );
    await mounted.ready;

    // Nothing is fetched until the entry is actually opened.
    const disclosure = descendants(root).find((node) =>
      hasClass(node, "notifications__group"));
    expect(disclosure).toBeDefined();
    expect(requested).toBeNull();
    const summary = disclosure!.children.find((node) =>
      hasClass(node, "notifications__group-summary"));
    expect(summary?.textContent).toBe("Show all 3");

    disclosure!.open = true;
    disclosure!.toggle();
    await settle();

    expect(requested).toBe("91");
    const items = descendants(disclosure!).filter((node) => node.tagName === "li");
    expect(items).toHaveLength(2);
    // Each member carries the track thumb, so forty-nine of these read as
    // artwork rather than as forty-nine lines of prose.
    const memberThumbs = descendants(disclosure!).filter((node) =>
      hasClass(node, "ds-notifications__art"));
    expect(memberThumbs).toHaveLength(2);
    expect(memberThumbs[0]?.className).toContain("ds-notifications__art");
    expect(memberThumbs[0]?.attributes.get("aria-label"))
      .toBe("Rainbow Road, Special Cup, 200cc");
    const art = descendants(memberThumbs[0]!).filter((node) =>
      hasClass(node, "activity-list__art"));
    expect(art).toHaveLength(1);
    expect(descendants(memberThumbs[0]!).filter((node) => node.tagName === "small"))
      .toHaveLength(0);
    // The compact thumb already identifies the track visually and carries the
    // engine class. The line beside a World Record member therefore stays
    // empty, while the artwork itself carries the link.
    expect(hasClass(items[0]!.children[0]!, "ds-notifications__art")).toBe(true);
    expect(hasClass(items[0]!.children[0]!, "activity-list__thumb")).toBe(true);
    expect(items[0]?.children.slice(1).map((node) => node.className)).toEqual([
      "", "notifications__when ds-notice__when",
    ]);
    expect(items[0]?.children[1]?.textContent).toBe("");
    expect(memberThumbs[0]?.tagName).toBe("a");
    expect(memberThumbs[0]?.attributes.get("href"))
      .toBe("/?leaderboard=track.rainbow_road&mode=200");
    // The second member keeps its own track and mode rather than inheriting
    // the aggregate's most recent one.
    expect(memberThumbs[1]?.attributes.get("href"))
      .toBe("/?leaderboard=track.mount_wario&mode=150");
    // Two members were returned for an entry that counted three, and the
    // difference is stated rather than hidden.
    expect(descendants(disclosure!).some((node) =>
      node.textContent === "Showing the most recent 2 of 3.")).toBe(true);
    mounted.unmount();
  });

  it("says so when a grouped entry predates keeping its members", async () => {
    const client: NotificationClient = {
      async inbox() {
        return { unreadCount: 1, notifications: [{ ...beaten, count: 4 }] };
      },
      async events() { return []; },
      async markRead() { throw new Error("unused"); },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountNotificationSection(
      root as unknown as HTMLElement, "player.ben", client,
      () => 1_900_000_600_000,
    );
    await mounted.ready;
    const disclosure = descendants(root).find((node) =>
      hasClass(node, "notifications__group"));
    disclosure!.open = true;
    disclosure!.toggle();
    await settle();
    expect(descendants(disclosure!).some((node) => node.textContent ===
      "This entry was counted before the individual events were kept."))
      .toBe(true);
    mounted.unmount();
  });

  it("offers no disclosure for an entry that counted one thing", async () => {
    const client: NotificationClient = {
      async inbox() {
        return { unreadCount: 1, notifications: [{ ...beaten, count: 1 }] };
      },
      async events() { throw new Error("must not be asked"); },
      async markRead() { throw new Error("unused"); },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountNotificationSection(
      root as unknown as HTMLElement, "player.ben", client,
      () => 1_900_000_600_000,
    );
    await mounted.ready;
    expect(descendants(root).some((node) =>
      hasClass(node, "notifications__group"))).toBe(false);
    mounted.unmount();
  });

  it("shows the track above the APK-style title, detail, actions, and date", async () => {
    const client: NotificationClient = {
      async inbox() { return { unreadCount: 1, notifications: [beaten] }; },
      async events() { return []; },
      async markRead() { throw new Error("unused"); },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountNotificationSection(
      root as unknown as HTMLElement, "player.ben", client,
      () => 1_900_000_600_000,
    );
    await mounted.ready;
    const row = descendants(root).find((node) =>
      hasClass(node, "notifications__item"));
    expect(row).toBeDefined();
    // Android leads with the 160dp artwork, then one full-width content stack.
    expect(hasClass(row!.children[0]!, "ds-notifications__art")).toBe(true);
    expect(hasClass(row!.children[0]!, "activity-list__thumb")).toBe(true);
    expect(row!.children[1]?.className).toBe("notifications__body");
    const body = row!.children[1]!;
    // The title carries a visible unread chip; detail, actions, grouped events
    // and the date follow in the native order.
    expect(body.children.map((node) => node.className)).toEqual([
      "notifications__title-row",
      "notifications__detail ds-body",
      "notifications__actions",
      "notifications__group",
      "notifications__when ds-notice__when",
    ]);
    expect(body.children[0]?.children.map((node) => node.className)).toEqual([
      "notifications__title ds-notice__copy",
      "notifications__unread ds-chip",
    ]);
    expect(body.children[2]?.children.map((node) => node.className)).toEqual([
      "notifications__link notifications__open ds-button",
      "notifications__mark-read ds-button",
    ]);
    expect(descendants(row!).some((node) =>
      node.attributes.get("aria-label")?.startsWith("Mount Wario") === true)).toBe(true);
    expect(descendants(row!.children[0]!).filter((node) => node.tagName === "small"))
      .toHaveLength(1);
    mounted.unmount();
  });

  it("keeps a single column when the entry names no track", async () => {
    const client: NotificationClient = {
      async inbox() {
        return {
          unreadCount: 1,
          notifications: [{
            notificationId: "12",
            kind: "claim_decided",
            detail: "verified",
            count: 1,
            lastEventAtMs: 1_900_000_000_000,
            read: true,
          }],
        };
      },
      async events() { return []; },
      async markRead() { throw new Error("unused"); },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountNotificationSection(
      root as unknown as HTMLElement, "player.ben", client,
      () => 1_900_000_600_000,
    );
    await mounted.ready;
    const row = descendants(root).find((node) =>
      hasClass(node, "notifications__item"));
    expect(descendants(row!).some((node) =>
      hasClass(node, "ds-notifications__art"))).toBe(false);
    expect(row!.children.map((node) => node.className)).toEqual([
      "notifications__body",
    ]);
    mounted.unmount();
  });

  it("shows the Android engine mark when an entry has a mode but no track", async () => {
    const client: NotificationClient = {
      async inbox() {
        return {
          unreadCount: 1,
          notifications: [{
            notificationId: "13",
            kind: "world_record",
            mode: 200,
            count: 1,
            lastEventAtMs: 1_900_000_000_000,
            read: false,
          }],
        };
      },
      async events() { return []; },
      async markRead() { throw new Error("unused"); },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountNotificationSection(
      root as unknown as HTMLElement, "player.ben", client,
      () => 1_900_000_600_000,
    );
    await mounted.ready;
    const mark = descendants(root).find((node) =>
      hasClass(node, "notifications__engine"));
    expect(mark?.attributes.get("data-engine")).toBe("200");
    expect(mark?.textContent).toContain("200cc");
    mounted.unmount();
  });

  it("phrases one member per kind", () => {
    expect(notificationEventMessage("world_record", {
      occurredAtMs: 1, trackId: "track.mount_wario", mode: 200,
    })).toBe("200cc · Mount Wario");
    expect(notificationEventMessage("overtaken", {
      occurredAtMs: 1, actorDisplayName: "Floyd", trackId: "track.mount_wario",
      mode: 150, actorTimeMs: 115_331, recipientTimeMs: 115_942, recipientRank: 4,
    })).toBe("Floyd on Mount Wario (150cc) · 1:55.331 · 0.611s faster · you are now #4");
    expect(notificationEventMessage("poke", {
      occurredAtMs: 1, actorDisplayName: "Evan",
    })).toBe("Evan");
  });

  it("aggregates messages and deep links per kind", () => {
    expect(notificationMessage(beaten))
      .toBe("Floyd beat your time on Mount Wario by 0.611s · 150cc · you are now #4");
    expect(notificationMessage({ ...beaten, count: 1 }))
      .toBe("Floyd beat your time on Mount Wario by 0.611s · 150cc · you are now #4");
    expect(notificationLink(beaten, "player.ben"))
      .toBe("/?leaderboard=track.mount_wario&mode=150&notification=7");
    expect(notificationLink(beaten, null))
      .toBe("/?leaderboard=track.mount_wario&mode=150&notification=7");
    expect(notificationMessage({
      notificationId: "8",
      kind: "reaction_received",
      trackId: "track.mario_circuit",
      mode: 200,
      count: 5,
      lastEventAtMs: 0,
      read: false,
    })).toBe("5 reactions on your Mario Circuit time");
    expect(notificationLink({
      notificationId: "8",
      kind: "reaction_received",
      trackId: "track.mario_circuit",
      mode: 200,
      count: 5,
      lastEventAtMs: 0,
      read: false,
    }, null)).toBe("/?leaderboard=track.mario_circuit&mode=200");
    expect(notificationMessage({
      notificationId: "9",
      kind: "claim_decided",
      detail: "verified",
      count: 1,
      lastEventAtMs: 0,
      read: true,
    })).toBe("Your Player claim was approved");
  });

  it("renders the inbox with unread emphasis and mark-all control", async () => {
    const client: NotificationClient = {
      async inbox() {
        return { unreadCount: 1, notifications: [beaten] };
      },
      async events() { return []; },
      async markRead() { throw new Error("unused"); },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountNotificationSection(
      root as unknown as HTMLElement,
      "player.ben",
      client,
      () => 1_900_000_600_000,
    );
    await mounted.ready;
    const nodes = descendants(root);
    const texts = nodes.map((node) => node.textContent);
    // The track artwork already names Mount Wario. Android keeps the title
    // short and puts the class, gap and new rank on a separate line.
    expect(texts).toContain("Floyd passed you.");
    expect(texts).toContain("150cc · 0.611s faster · you are now #4");
    expect(texts.some((text) => text?.includes("on Mount Wario"))).toBe(false);
    expect(notificationMessage(beaten, true))
      .toBe("Floyd beat your time by 0.611s · you are now #4");
    expect(texts).toContain("1 unread");
    expect(texts.some((text) => /\d{4} · \d{2}:\d{2}/u.test(text ?? ""))).toBe(true);
    expect(nodes.some((node) =>
      node.className.includes("notifications__item--unread"))).toBe(true);
    expect(nodes.find((node) => hasClass(node, "notifications__link"))
      ?.attributes.get("href")).toBe("/?leaderboard=track.mount_wario&mode=150&notification=7");
    mounted.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("clears one notification without opening it", async () => {
    // A world record you do not care about used to be clearable only by
    // following it to the leaderboard it happened on.
    const record: NotificationView = {
      notificationId: "31",
      kind: "world_record",
      trackId: "track.mount_wario",
      mode: 150,
      count: 1,
      lastEventAtMs: 1_900_000_000_000,
      read: false,
    };
    const marked: string[][] = [];
    let unreadCount = 1;
    const client: NotificationClient = {
      async inbox() {
        return {
          unreadCount,
          notifications: [{ ...record, read: unreadCount === 0 }],
        };
      },
      async events() { return []; },
      async markRead(target) {
        if (target === "all") { throw new Error("expected one notification"); }
        marked.push([...target]);
        unreadCount = 0;
      },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountNotificationSection(
      root as unknown as HTMLElement, "player.ben", client,
      () => 1_900_000_600_000,
    );
    await mounted.ready;

    const dismiss = descendants(root).find((node) =>
      hasClass(node, "notifications__mark-read"));
    expect(dismiss).toBeDefined();
    dismiss!.click();
    await settle();

    expect(marked).toEqual([["31"]]);
    // The row is read now, so it offers no second dismissal and no longer
    // carries the unread emphasis.
    const after = descendants(root);
    expect(after.some((node) => hasClass(node, "notifications__mark-read")))
      .toBe(false);
    expect(after.some((node) =>
      node.className.includes("notifications__item--unread"))).toBe(false);
    mounted.unmount();
  });

  it("offers mark-all only while something is unread", async () => {
    let unreadCount = 2;
    let allMarked = false;
    const client: NotificationClient = {
      async inbox() {
        return {
          unreadCount,
          notifications: [{ ...beaten, read: unreadCount === 0 }],
        };
      },
      async events() { return []; },
      async markRead(target) {
        expect(target).toBe("all");
        allMarked = true;
        unreadCount = 0;
      },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountNotificationSection(
      root as unknown as HTMLElement, "player.ben", client,
      () => 1_900_000_600_000,
    );
    await mounted.ready;
    const markAll = descendants(root).find((node) =>
      node.className.includes("notifications__mark-all"));
    expect(markAll?.hidden).toBe(false);
    markAll!.click();
    await settle();
    expect(allMarked).toBe(true);
    // Nothing is unread, so the control that clears everything goes away.
    expect(descendants(root).find((node) =>
      node.className.includes("notifications__mark-all"))?.hidden).toBe(true);
    mounted.unmount();
  });

  it("sends a trackless world record to the Time Trial ranking", () => {
    // `?rank=1` is not a route; it silently fell through to Home.
    expect(notificationLink({
      notificationId: "9", kind: "world_record", count: 1,
      lastEventAtMs: 1_900_000_000_000, read: false,
    }, null)).toBe("/?ranking=timetrials");
  });

  it("shows a friendly empty state", async () => {
    const client: NotificationClient = {
      async inbox() { return { unreadCount: 0, notifications: [] }; },
      async events() { return []; },
      async markRead() { throw new Error("unused"); },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountNotificationSection(
      root as unknown as HTMLElement,
      null,
      client,
    );
    await mounted.ready;
    expect(descendants(root).map((node) => node.textContent))
      .toContain("No notifications yet.");
    mounted.unmount();
  });
  it("tells an administrator who asked to be linked, and sends reviewers to Administration", () => {
    const requested = {
      notificationId: "77",
      kind: "claim_requested" as const,
      actorPlayerId: "player.kikker",
      actorDisplayName: "Kikker",
      detail: "requested",
      count: 1,
      lastEventAtMs: 1_800_000_000_000,
      read: false,
    };
    expect(notificationMessage(requested)).toBe("Somebody asks to be linked to Kikker");
    expect(notificationLink(requested, "player.ben")).toBe("/?admin=1");
  });
  it("tells the person asking about a question, a revoke and a release (ADR-0216)", () => {
    const decided = (detail: string) => ({
      notificationId: "78", kind: "claim_decided" as const, detail, count: 1,
      lastEventAtMs: 1_800_000_000_000, read: false,
    });
    expect(notificationMessage(decided("info_requested"))).toBe("A reviewer has a question about your Player claim");
    expect(notificationMessage(decided("revoked"))).toBe("Your Player link was removed");
    expect(notificationMessage(decided("released"))).toBe("Your Player link was closed");
    expect(notificationLink(decided("revoked"), "player.ben")).toBe("/?settings=1");
  });
  it("tells administrators who asks to host, and the person the answer (ADR-0220)", () => {
    const base = { notificationId: "79", count: 1, lastEventAtMs: 1_800_000_000_000, read: false };
    const asked = { ...base, kind: "host_requested" as const, actorPlayerId: "player.kikker", actorDisplayName: "Kikker", detail: "requested" };
    expect(notificationMessage(asked)).toBe("Kikker asks to host Tournaments");
    expect(notificationMessage({ ...base, kind: "host_requested" as const, detail: "requested" }))
      .toBe("Somebody asks to host Tournaments");
    expect(notificationLink(asked, "player.ben")).toBe("/?admin=tournaments");
    const decided = (detail: string) => ({ ...base, kind: "host_request_decided" as const, detail });
    expect(notificationMessage(decided("approved"))).toBe("You are now a Director: you can host Tournaments");
    expect(notificationMessage(decided("declined"))).toBe("Your request to host was declined");
    expect(notificationLink(decided("declined"), "player.ben")).toBe("/?tournaments=1");
  });

});
