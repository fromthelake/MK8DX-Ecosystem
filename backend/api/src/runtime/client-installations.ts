// Which build of a client each Player is actually running.
//
// The download page knows what is on offer and `client-support` knows what is
// allowed; neither knew what is *installed*, so "who is still on an old build,
// and who never opened the app at all" could only be guessed at. A client says
// so itself, at start and from its own periodic pass.
//
// Per device and with history, which is what the owner asked for: one row per
// (account, installation, client, version), so an update leaves the old row
// standing beside the new one and the timeline is readable. A check-in that
// matches a row already there only moves `last_seen_at_ms` and counts up, so
// this is a record of installations rather than a log of requests.
//
// What it deliberately does not carry: no address, no token, no request path,
// nothing about what was done - only which copy of which app, on what it calls
// itself, seen when.

import type { ActorContext } from "../identity/types.js";

/** Clients that may check in. The catalog constraint names the same three. */
export const CLIENT_NAMES = ["android", "web", "livetrial"] as const;
export type ClientName = (typeof CLIENT_NAMES)[number];

export function isClientName(value: unknown): value is ClientName {
  return typeof value === "string" && (CLIENT_NAMES as readonly string[]).includes(value);
}

export type ClientCheckin = Readonly<{
  /** The client's own installation profile: one copy of one app. */
  installationId: string;
  client: ClientName;
  version: string;
  build?: number;
  /** What the device calls itself, where the client knows it. */
  deviceModel?: string;
}>;

export type ClientInstallationRow = Readonly<{
  userAccountId: string;
  playerId?: string;
  displayName?: string;
  installationId: string;
  client: ClientName;
  version: string;
  build?: number;
  deviceModel?: string;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  checkinCount: number;
}>;

export type ClientInstallationRepository = Readonly<{
  /** Upserts one check-in and prunes what that account has left behind. */
  record(
    userAccountId: string,
    checkin: ClientCheckin,
    nowMs: number,
    forgetBeforeMs: number,
  ): Promise<void>;
  /** Every installation, newest first, for the administrator's own reading. */
  list(limit: number): Promise<readonly ClientInstallationRow[]>;
}>;

export class ClientInstallationError extends Error {
  public constructor(public readonly code: "invalid_input" | "not_authenticated") {
    super(`client installation error: ${code}`);
    this.name = "ClientInstallationError";
  }
}

/**
 * Eighteen months. A device nobody has used since then is not a device this
 * community has; keeping the row would only be keeping it. The prune happens
 * on the write path, so nothing has to remember to run it.
 */
export const CLIENT_INSTALLATION_RETENTION_MS = 18 * 30 * 24 * 60 * 60 * 1000;

const installationPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/;
const versionPattern = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;

export class ClientInstallationService {
  public constructor(
    private readonly repository: ClientInstallationRepository,
    private readonly now: () => number = Date.now,
  ) {}

  public async checkin(actor: ActorContext, checkin: ClientCheckin): Promise<void> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new ClientInstallationError("not_authenticated");
    }
    if (!installationPattern.test(checkin.installationId) ||
      !isClientName(checkin.client) ||
      !versionPattern.test(checkin.version) ||
      (checkin.build !== undefined &&
        (!Number.isSafeInteger(checkin.build) || checkin.build < 1))) {
      throw new ClientInstallationError("invalid_input");
    }
    // A model is free text from a device. It is cut down rather than refused:
    // an unfamiliar phone naming itself at length is not a reason to lose the
    // check-in, and what is kept is printable, trimmed and bounded.
    const deviceModel = checkin.deviceModel
      ?.replace(/[^ -~]/g, "")
      .trim()
      .slice(0, 64)
      .trim();
    const nowMs = this.now();
    await this.repository.record(
      actor.userAccountId,
      {
        installationId: checkin.installationId,
        client: checkin.client,
        version: checkin.version,
        ...(checkin.build === undefined ? {} : { build: checkin.build }),
        ...(deviceModel === undefined || deviceModel === "" ? {} : { deviceModel }),
      },
      nowMs,
      nowMs - CLIENT_INSTALLATION_RETENTION_MS,
    );
  }

  public async list(actor: ActorContext): Promise<readonly ClientInstallationRow[]> {
    if (actor.role !== "administrator") {
      throw new ClientInstallationError("not_authenticated");
    }
    return this.repository.list(500);
  }
}
