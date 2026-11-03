// Bounded player interactions: send, review and answer on the same canonical API.

export const ENGAGEMENT_KINDS = [
  "poke", "rock_paper_scissors", "dice_roll", "challenge",
] as const;

export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number];

export type EngagementDetail = Readonly<{
  hand?: "rock" | "paper" | "scissors";
  face?: number;
  duel?: boolean;
  recipientFace?: number;
  trackId?: string;
  mode?: 150 | 200;
  totalTimeMs?: number;
  deltaMs?: number;
  recipientHand?: "rock" | "paper" | "scissors";
  outcome?: "actor" | "recipient" | "draw";
  respondedAtMs?: number;
}>;

export type Engagement = Readonly<{
  engagementId: string;
  kind: EngagementKind;
  actorPlayerId: string;
  recipientPlayerId: string;
  actorDisplayName?: string;
  recipientDisplayName?: string;
  detail?: EngagementDetail;
  createdAtMs: number;
}>;
export type EngagementSent = Pick<Engagement, "engagementId" | "kind" | "recipientPlayerId" | "createdAtMs" | "detail">;
export type EngagementInbox = Readonly<{
  engagements: readonly Engagement[];
  rpsStats: Readonly<{ played: number; wins: number; losses: number; draws: number }>;
}>;

/** Why one action cannot be sent now; the page shows it beside the button. */
export type EngagementAllowance = Readonly<{
  available: boolean;
  reason?: "cooldown" | "awaiting_answer" | "not_accepted" | "recipient_limit" | "no_account";
  availableAtMs?: number;
  engagementId?: string;
}>;

/** The viewer's history with one Player and what they can send them now. */
export type EngagementConversation = Readonly<{
  playerId: string;
  accepted: boolean;
  actions: Readonly<Record<EngagementKind, EngagementAllowance>>;
  engagements: readonly Engagement[];
}>;

export type EngagementRefusal =
  | "not_authenticated"
  | "no_verified_player"
  | "not_found"
  | "not_accepted"
  | "no_account"
  | "cooldown"
  | "awaiting_answer"
  | "recipient_limit"
  | "limit_reached"
  | "invalid"
  | "already_answered"
  | "unavailable";

export class PlayerEngagementClientError extends Error {
  public constructor(public readonly refusal: EngagementRefusal) {
    super(`The engagement was refused: ${refusal}`);
    this.name = "PlayerEngagementClientError";
  }
}

/** What each answer means to the person who pressed the button. */
export function refusalMessage(
  refusal: EngagementRefusal,
  localize: (english: string, dutch: string) => string,
): string {
  switch (refusal) {
    case "not_authenticated":
      return localize("Sign in first.", "Meld je eerst aan.");
    case "no_verified_player":
      return localize(
        "Claim your own Player first.", "Claim eerst je eigen speler.",
      );
    case "not_found":
      return localize("That Player was not found.", "Die speler is niet gevonden.");
    case "not_accepted":
      return localize(
        "This Player does not accept these from you.",
        "Deze speler ontvangt dit niet van jou.",
      );
    case "no_account":
      return localize(
        "This Player has no account yet, so they cannot be notified.",
        "Deze speler heeft nog geen account en kan dus geen melding krijgen.",
      );
    case "cooldown":
      return localize(
        "You can send this once an hour to the same Player.",
        "Je kunt dit één keer per uur naar dezelfde speler sturen.",
      );
    case "awaiting_answer":
      return localize(
        "Your last game is still waiting for their answer.",
        "Je vorige spel wacht nog op hun antwoord.",
      );
    case "recipient_limit":
      return localize(
        "This Player has received the most interactions allowed today. Try again tomorrow.",
        "Deze speler heeft vandaag het maximum aantal interacties ontvangen. Probeer het morgen opnieuw.",
      );
    case "limit_reached":
      return localize("Not right now — try again later.", "Nu even niet — probeer het later opnieuw.");
    case "invalid":
      return localize("That is not a valid move.", "Dat is geen geldige zet.");
    case "already_answered":
      return localize("This game was already answered.", "Dit spel is al beantwoord.");
    default:
      return localize("Try again later.", "Probeer het later opnieuw.");
  }
}

function refusalOf(status: number): EngagementRefusal {
  if (status === 401) { return "not_authenticated"; }
  if (status === 404) { return "not_found"; }
  if (status === 429) { return "limit_reached"; }
  if (status === 400) { return "invalid"; }
  if (status === 409) { return "already_answered"; }
  if (status === 403) { return "not_accepted"; }
  return "unavailable";
}

export type PlayerEngagementClient = Readonly<{
  send(
    playerId: string, kind: EngagementKind, detail?: EngagementDetail,
  ): Promise<EngagementSent>;
  list(): Promise<EngagementInbox>;
  /** A hand answers rock-paper-scissors; no hand answers a dice duel with a server roll. */
  answer(engagementId: string, hand?: "rock" | "paper" | "scissors"): Promise<Engagement>;
  conversation(playerId: string): Promise<EngagementConversation>;
}>;

const CONVERSATION_KEYS = ["schemaVersion", "playerId", "accepted", "actions", "engagements"] as const;

/** The conversation document, checked key for key like every other web parser. */
export function parseConversation(value: unknown): EngagementConversation {
  const fail = (): never => { throw new PlayerEngagementClientError("unavailable"); };
  if (typeof value !== "object" || value === null) { return fail(); }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!CONVERSATION_KEYS.every((key) => keys.includes(key)) ||
      !keys.every((key) => (CONVERSATION_KEYS as readonly string[]).includes(key))) { return fail(); }
  if (record["schemaVersion"] !== "mk8dx.player-engagement-conversation.v1" ||
      typeof record["playerId"] !== "string" || typeof record["accepted"] !== "boolean" ||
      !Array.isArray(record["engagements"]) || typeof record["actions"] !== "object" || record["actions"] === null) {
    return fail();
  }
  const actions = record["actions"] as Record<string, unknown>;
  for (const kind of ENGAGEMENT_KINDS) {
    const action = actions[kind] as Record<string, unknown> | undefined;
    if (action === undefined || typeof action["available"] !== "boolean") { return fail(); }
  }
  return {
    playerId: record["playerId"],
    accepted: record["accepted"],
    actions: actions as unknown as EngagementConversation["actions"],
    engagements: record["engagements"] as Engagement[],
  };
}

/** The server's code, when it named one, decides the words; the status is the fallback. */
async function refusalFrom(response: Response): Promise<EngagementRefusal> {
  const body = await response.text().catch(() => "");
  if (body.includes("engagement_no_verified_player")) { return "no_verified_player"; }
  if (body.includes("engagement_recipient_unreachable")) { return "no_account"; }
  if (body.includes("engagement_cooldown")) { return "cooldown"; }
  if (body.includes("engagement_awaiting_answer")) { return "awaiting_answer"; }
  if (body.includes("engagement_recipient_limit")) { return "recipient_limit"; }
  return refusalOf(response.status);
}

/** The same one-shot proof every other web mutation asks for. */
async function webCsrfProof(
  fetchPort: typeof fetch,
): Promise<Readonly<{ headerName: string; value: string }>> {
  const response = await fetchPort("/v1/session/csrf", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status !== 200) { throw new Error("no proof"); }
  const proof = await response.json() as Record<string, unknown>;
  if (typeof proof["headerName"] !== "string" || typeof proof["value"] !== "string") {
    throw new Error("no proof");
  }
  return { headerName: proof["headerName"], value: proof["value"] };
}

export function createPlayerEngagementClient(
  fetchPort: typeof fetch = globalThis.fetch.bind(globalThis),
  csrf: (port: typeof fetch) => Promise<Readonly<{ headerName: string; value: string }>> =
    webCsrfProof,
): PlayerEngagementClient {
  const mutation = async (path: string, payload: unknown): Promise<Response> => {
    let proof: Readonly<{ headerName: string; value: string }>;
    try { proof = await csrf(fetchPort); }
    catch { throw new PlayerEngagementClientError("not_authenticated"); }
    try {
      return await fetchPort(path, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", [proof.headerName]: proof.value },
        body: JSON.stringify(payload),
        credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store",
      });
    } catch { throw new PlayerEngagementClientError("unavailable"); }
  };
  const assertSuccess = async (response: Response, expected: number): Promise<void> => {
    if (response.status === expected) { return; }
    throw new PlayerEngagementClientError(await refusalFrom(response));
  };
  return {
    async send(playerId, kind, detail) {
      const response = await mutation(
        `/v1/players/${encodeURIComponent(playerId)}/engagements`,
        { kind, ...(detail === undefined ? {} : { detail }) },
      );
      await assertSuccess(response, 201);
      return await response.json() as EngagementSent;
    },
    async list() {
      let response: Response;
      try { response = await fetchPort("/v1/player-engagements", {
        method: "GET", headers: { Accept: "application/json" },
        credentials: "same-origin", cache: "no-store",
      }); } catch { throw new PlayerEngagementClientError("unavailable"); }
      await assertSuccess(response, 200);
      const result = await response.json() as { schemaVersion?: string; engagements?: Engagement[]; rpsStats?: EngagementInbox["rpsStats"] };
      if (result.schemaVersion !== "mk8dx.player-engagements.v1" ||
          !Array.isArray(result.engagements) || result.rpsStats === undefined) {
        throw new PlayerEngagementClientError("unavailable");
      }
      return { engagements: result.engagements, rpsStats: result.rpsStats };
    },
    async conversation(playerId) {
      let response: Response;
      try { response = await fetchPort(`/v1/players/${encodeURIComponent(playerId)}/engagements`, {
        method: "GET", headers: { Accept: "application/json" },
        credentials: "same-origin", cache: "no-store",
      }); } catch { throw new PlayerEngagementClientError("unavailable"); }
      await assertSuccess(response, 200);
      return parseConversation(await response.json().catch(() => null));
    },
    async answer(engagementId, hand) {
      const response = await mutation(
        `/v1/player-engagements/${encodeURIComponent(engagementId)}/reply`,
        hand === undefined ? {} : { hand },
      );
      await assertSuccess(response, 200);
      const result = await response.json() as { schemaVersion?: string; engagement?: Engagement };
      if (result.schemaVersion !== "mk8dx.player-engagement-result.v1" || result.engagement === undefined) {
        throw new PlayerEngagementClientError("unavailable");
      }
      return result.engagement;
    },
  };
}
