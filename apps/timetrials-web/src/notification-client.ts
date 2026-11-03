// Closed bounded client for the aggregated notification inbox.

const maximumResponseBytes = 32_768;
// 200 members with a track, a mode and a timestamp each is comfortably larger
// than an inbox page, so opening an entry gets its own ceiling.
const maximumEventsResponseBytes = 131_072;
const notificationIdPattern = /^[0-9]{1,19}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;

export const NOTIFICATION_KINDS = [
  "overtaken",
  "reaction_received",
  "claim_decided",
  // A link request, delivered to administrators.
  "claim_requested",
  "result_published",
  "group_invited",
  "group_joined",
  "group_left",
  "group_removed",
  "group_role_changed",
  "world_record",
  // Player-to-Player engagement: a poke now, the games and the challenge on
  // the same rails.
  "poke",
  "rock_paper_scissors",
  "dice_roll",
  "challenge",
  // "Request to host" (ADR-0220): to the administrators, and the answer back.
  "host_requested",
  "host_request_decided",
  // Open sign-up (ADR-0222): the outcome at closing, moving up, taken off the list.
  "tournament_signup_selected",
  "tournament_signup_moved_up",
  "tournament_signup_removed",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationView = Readonly<{
  notificationId: string;
  kind: NotificationKind;
  actorPlayerId?: string;
  actorDisplayName?: string;
  trackId?: string;
  mode?: 150 | 200;
  groupId?: string;
  groupName?: string;
  /** The night a sign-up entry is about (ADR-0222). */
  tournamentId?: string;
  tournamentName?: string;
  detail?: string;
  actorTimeMs?: number;
  recipientTimeMs?: number;
  deltaMs?: number;
  recipientRank?: number;
  count: number;
  lastEventAtMs: number;
  read: boolean;
}>;

export type NotificationInbox = Readonly<{
  unreadCount: number;
  notifications: readonly NotificationView[];
}>;

/** One of the events an entry counted. */
export type NotificationEventView = Readonly<{
  occurredAtMs: number;
  actorPlayerId?: string;
  actorDisplayName?: string;
  trackId?: string;
  mode?: 150 | 200;
  detail?: string;
  actorTimeMs?: number;
  recipientTimeMs?: number;
  recipientRank?: number;
}>;

export class NotificationClientError extends Error {
  public constructor(
    public readonly code:
      | "invalid_input"
      | "not_authenticated"
      | "unavailable"
      | "invalid_response",
  ) {
    super("Notifications could not be loaded.");
    this.name = "NotificationClientError";
  }
}

export interface NotificationClient {
  inbox(signal?: AbortSignal): Promise<NotificationInbox>;
  events(
    notificationId: string,
    signal?: AbortSignal,
  ): Promise<readonly NotificationEventView[]>;
  markRead(
    target: readonly string[] | "all",
    signal?: AbortSignal,
  ): Promise<void>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

const baseInit = {
  credentials: "same-origin",
  mode: "same-origin",
  redirect: "error",
  referrerPolicy: "same-origin",
  cache: "no-store",
} as const;

async function boundedJson(
  response: Response,
  limit: number = maximumResponseBytes,
): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw new NotificationClientError("invalid_response");
  }
  const body = await response.text();
  if (body.length > limit) {
    throw new NotificationClientError("invalid_response");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new NotificationClientError("invalid_response");
  }
}

function isKind(value: unknown): value is NotificationKind {
  return typeof value === "string" &&
    (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

function integer(value: unknown, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
      value < minimum) {
    throw new NotificationClientError("invalid_response");
  }
  return value;
}

function parseInbox(value: unknown): NotificationInbox {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NotificationClientError("invalid_response");
  }
  const document = value as Record<string, unknown>;
  if (document["schemaVersion"] !== "mk8dx.notifications.v1" ||
      !Array.isArray(document["notifications"]) ||
      document["notifications"].length > 30) {
    throw new NotificationClientError("invalid_response");
  }
  const notifications = document["notifications"].map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new NotificationClientError("invalid_response");
    }
    const row = entry as Record<string, unknown>;
    if (typeof row["notificationId"] !== "string" ||
        !notificationIdPattern.test(row["notificationId"]) ||
        !isKind(row["kind"]) || typeof row["read"] !== "boolean") {
      throw new NotificationClientError("invalid_response");
    }
    const mode: 150 | 200 | undefined =
      row["mode"] === 150 ? 150 : row["mode"] === 200 ? 200 : undefined;
    return {
      notificationId: row["notificationId"],
      kind: row["kind"],
      ...(typeof row["actorPlayerId"] === "string" &&
        playerIdPattern.test(row["actorPlayerId"])
        ? { actorPlayerId: row["actorPlayerId"] }
        : {}),
      ...(typeof row["actorDisplayName"] === "string" &&
        row["actorDisplayName"].length <= 128
        ? { actorDisplayName: row["actorDisplayName"] }
        : {}),
      ...(typeof row["trackId"] === "string" &&
        trackIdPattern.test(row["trackId"])
        ? { trackId: row["trackId"] }
        : {}),
      ...(mode === undefined ? {} : { mode }),
      ...(typeof row["groupId"] === "string" && /^social_group\.[a-z0-9-]{8,64}$/.test(row["groupId"])
        ? { groupId: row["groupId"] } : {}),
      ...(typeof row["groupName"] === "string" && row["groupName"].length <= 80
        ? { groupName: row["groupName"] } : {}),
      ...(typeof row["tournamentId"] === "string" &&
        /^tournament\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/.test(row["tournamentId"])
        ? { tournamentId: row["tournamentId"] } : {}),
      ...(typeof row["tournamentName"] === "string" && row["tournamentName"].length >= 1 &&
        row["tournamentName"].length <= 128
        ? { tournamentName: row["tournamentName"] } : {}),
      ...(typeof row["detail"] === "string" && row["detail"].length <= 32
        ? { detail: row["detail"] }
        : {}),
      ...(typeof row["actorTimeMs"] === "number" &&
        Number.isSafeInteger(row["actorTimeMs"]) && row["actorTimeMs"] > 0
        ? { actorTimeMs: row["actorTimeMs"] }
        : {}),
      ...(typeof row["recipientTimeMs"] === "number" &&
        Number.isSafeInteger(row["recipientTimeMs"]) && row["recipientTimeMs"] > 0
        ? { recipientTimeMs: row["recipientTimeMs"] }
        : {}),
      ...(typeof row["deltaMs"] === "number" &&
        Number.isSafeInteger(row["deltaMs"]) && row["deltaMs"] < 0
        ? { deltaMs: row["deltaMs"] }
        : {}),
      ...(typeof row["recipientRank"] === "number" &&
        Number.isSafeInteger(row["recipientRank"]) && row["recipientRank"] > 0
        ? { recipientRank: row["recipientRank"] }
        : {}),
      count: integer(row["count"], 1),
      lastEventAtMs: integer(row["lastEventAtMs"], 0),
      read: row["read"],
    };
  });
  return {
    unreadCount: integer(document["unreadCount"], 0),
    notifications,
  };
}

function parseEvents(value: unknown): readonly NotificationEventView[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NotificationClientError("invalid_response");
  }
  const document = value as Record<string, unknown>;
  if (document["schemaVersion"] !== "mk8dx.notification-events.v1" ||
      !Array.isArray(document["events"]) || document["events"].length > 200) {
    throw new NotificationClientError("invalid_response");
  }
  return document["events"].map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new NotificationClientError("invalid_response");
    }
    const row = entry as Record<string, unknown>;
    const mode: 150 | 200 | undefined =
      row["mode"] === 150 ? 150 : row["mode"] === 200 ? 200 : undefined;
    return {
      occurredAtMs: integer(row["occurredAtMs"], 0),
      ...(typeof row["actorPlayerId"] === "string" &&
        playerIdPattern.test(row["actorPlayerId"])
        ? { actorPlayerId: row["actorPlayerId"] } : {}),
      ...(typeof row["actorDisplayName"] === "string" &&
        row["actorDisplayName"].length <= 128
        ? { actorDisplayName: row["actorDisplayName"] } : {}),
      ...(typeof row["trackId"] === "string" && trackIdPattern.test(row["trackId"])
        ? { trackId: row["trackId"] } : {}),
      ...(mode === undefined ? {} : { mode }),
      ...(typeof row["detail"] === "string" && row["detail"].length <= 32
        ? { detail: row["detail"] } : {}),
      ...(typeof row["actorTimeMs"] === "number" &&
        Number.isSafeInteger(row["actorTimeMs"]) && row["actorTimeMs"] > 0
        ? { actorTimeMs: row["actorTimeMs"] } : {}),
      ...(typeof row["recipientTimeMs"] === "number" &&
        Number.isSafeInteger(row["recipientTimeMs"]) && row["recipientTimeMs"] > 0
        ? { recipientTimeMs: row["recipientTimeMs"] } : {}),
      ...(typeof row["recipientRank"] === "number" &&
        Number.isSafeInteger(row["recipientRank"]) && row["recipientRank"] > 0
        ? { recipientRank: row["recipientRank"] } : {}),
    };
  });
}

let inFlightInbox: Promise<NotificationInbox> | null = null;

export function createNotificationClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): NotificationClient {
  const csrfProof = async (signal?: AbortSignal): Promise<
    Readonly<{ headerName: string; value: string }>
  > => {
    let response: Response;
    try {
      response = await fetchPort("/v1/session/csrf", {
        ...baseInit,
        method: "GET",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      throw new NotificationClientError("unavailable");
    }
    if (response.status === 401) {
      throw new NotificationClientError("not_authenticated");
    }
    if (response.status !== 200) {
      throw new NotificationClientError("unavailable");
    }
    const document = await boundedJson(response) as Record<string, unknown>;
    if (document["schemaVersion"] !== "mk8dx.web-csrf.v1" ||
        typeof document["headerName"] !== "string" ||
        !/^x-[a-z0-9-]{1,62}$/i.test(document["headerName"]) ||
        typeof document["value"] !== "string" ||
        document["value"].length < 1 || document["value"].length > 4_096) {
      throw new NotificationClientError("invalid_response");
    }
    return { headerName: document["headerName"], value: document["value"] };
  };

  const loadInbox = async (): Promise<NotificationInbox> => {
    let response: Response;
    try {
      response = await fetchPort("/v1/notifications", {
        ...baseInit,
        method: "GET",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new NotificationClientError("unavailable");
    }
    if (response.status === 401) {
      throw new NotificationClientError("not_authenticated");
    }
    if (response.status !== 200) {
      throw new NotificationClientError("unavailable");
    }
    return parseInbox(await boundedJson(response));
  };

  return {
    async inbox(signal) {
      // The navigation badge and the inbox section both want this the
      // moment a page opens. One request answers both; a caller that goes
      // away simply stops listening.
      if (inFlightInbox === null) {
        inFlightInbox = loadInbox();
        void inFlightInbox.catch(() => undefined)
          .then(() => { inFlightInbox = null; });
      }
      const shared = inFlightInbox;
      if (signal === undefined) { return shared; }
      return Promise.race([
        shared,
        new Promise<never>((_resolve, reject) => {
          if (signal.aborted) {
            reject(new NotificationClientError("unavailable"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => { reject(new NotificationClientError("unavailable")); },
            { once: true },
          );
        }),
      ]);
    },
    async events(notificationId, signal) {
      if (!notificationIdPattern.test(notificationId)) {
        throw new NotificationClientError("invalid_input");
      }
      let response: Response;
      try {
        response = await fetchPort(
          `/v1/notifications/${notificationId}/events`,
          {
            ...baseInit,
            method: "GET",
            headers: { Accept: "application/json" },
            ...(signal === undefined ? {} : { signal }),
          },
        );
      } catch {
        throw new NotificationClientError("unavailable");
      }
      if (response.status === 401) {
        throw new NotificationClientError("not_authenticated");
      }
      if (response.status !== 200) {
        throw new NotificationClientError("unavailable");
      }
      return parseEvents(await boundedJson(response, maximumEventsResponseBytes));
    },
    async markRead(target, signal) {
      if (target !== "all" &&
          (target.length === 0 || target.length > 100 ||
           target.some((id) => !notificationIdPattern.test(id)))) {
        throw new NotificationClientError("invalid_input");
      }
      const proof = await csrfProof(signal);
      let response: Response;
      try {
        response = await fetchPort("/v1/notifications/read", {
          ...baseInit,
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            [proof.headerName]: proof.value,
          },
          body: JSON.stringify(
            target === "all" ? { all: true } : { notificationIds: target },
          ),
          ...(signal === undefined ? {} : { signal }),
        });
      } catch {
        throw new NotificationClientError("unavailable");
      }
      if (response.status === 401) {
        throw new NotificationClientError("not_authenticated");
      }
      if (response.status !== 200) {
        throw new NotificationClientError("unavailable");
      }
    },
  };
}
