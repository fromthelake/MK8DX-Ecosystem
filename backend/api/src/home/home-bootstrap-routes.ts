// One request for everything the Home page renders.
//
// The page used to ask ten separate questions, each of which the server
// answers in single-digit milliseconds. Asking them separately cost ten
// round trips and, on the production host, ten chances to hit a per-second
// request limit. Asked together they cost one.
//
// Every section is optional and carries its own existing document, with
// its own schemaVersion. That keeps this route free of duplicated schema
// definitions, lets each client parser stay exactly as it was, and means a
// section that fails is simply absent rather than taking the page with it.

import type { FastifyInstance } from "fastify";

import { publicPlayerAliasesSchema } from "../identity/alias-schemas.js";
import type { AliasReadRepository } from "../identity/alias-service.js";
import { errorResponseSchema, publicPlayerProfileSchema } from
  "../identity/schemas.js";
import { careerResponseSchema } from
  "../profiles/public-career-routes.js";
import type { PublicCareerService } from
  "../profiles/public-career-service.js";
import {
  ratingLeaderboardDocument,
  leaderboardResponseSchema,
  opponentsResponseSchema,
  ratingHistoryResponseSchema,
  tournamentStandingsResponseSchema,
} from "../rating/public-rating-routes.js";
import type { MysqlPublicRatingRepository } from
  "../rating/mysql-rating-repository.js";
import type { ActorResolver, IdentityReadRepository } from
  "../identity/types.js";
import { inboxResponseSchema } from
  "../notifications/notification-routes.js";
import type { NotificationService } from
  "../notifications/notification-service.js";
import { accountPlayerClaimsSchema } from
  "../profiles/player-claim-product-routes.js";
import type { PlayerClaimProductService } from
  "../profiles/player-claim-product-service.js";
import { publicTrackBestsSchema } from
  "../timetrials/public-time-trial-routes.js";
import type { PublicTimeTrialService } from
  "../timetrials/public-time-trial-service.js";
import { summaryResponseSchema } from "../timetrials/reaction-routes.js";
import type { ReactionService } from "../timetrials/reaction-service.js";
import type { ActivityStoryService } from "./activity-story-service.js";
import type {
  FollowPreferenceService,
  HomeComebackService,
} from "./home-comeback-service.js";
import type { HomeFocusService } from "./home-focus-service.js";
import {
  comebackResponseSchema,
  focusResponseSchema,
  followsResponseSchema,
  rivalsResponseSchema,
  storiesResponseSchema,
} from "./home-routes.js";

export type HomeBootstrapRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  identity: Pick<IdentityReadRepository, "findPublicPlayerById">;
  notifications: Pick<NotificationService, "listMine">;
  claims: Pick<PlayerClaimProductService, "listMine">;
  comeback: Pick<HomeComebackService, "loadMine">;
  focus: Pick<HomeFocusService, "loadMine">;
  follows: Pick<FollowPreferenceService, "listMine">;
  stories: Pick<ActivityStoryService, "listStories">;
  trackBests: Pick<PublicTimeTrialService, "listTrackBestsForPlayers">;
  reactions: Pick<ReactionService, "summarize">;
  /**
   * The current World Records, only as Mastery needs them (mode, track, time): every page that shows
   * a Mastery label computes it from the live baseline (ADR-0169, owner 2026-09-26) without asking a
   * second time. Absent when a runtime does not mount World Records.
   */
  worldRecords?: Readonly<{ list(): Promise<readonly Readonly<{ mode: number; trackId: string; totalTimeMs: number }>[]> }>;
  // The Player-profile view. Absent when a runtime does not mount rating
  // or career, in which case that view simply answers the shared parts.
  ratings?: Pick<MysqlPublicRatingRepository, "listRatings">;
  ratingHistory?: Readonly<{
    listRatingHistory(playerId: string): Promise<readonly unknown[]>;
    listOpponents(playerId: string): Promise<readonly unknown[]>;
    listTournamentStandings(): Promise<readonly unknown[]>;
  }>;
  career?: Pick<PublicCareerService, "loadCareer">;
  aliases?: Pick<AliasReadRepository, "listPublicAliasesByPlayerId">;
}>;

const bootstrapResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "authenticated"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.home-bootstrap.v1" },
    authenticated: { type: "boolean" },
    notifications: inboxResponseSchema,
    claims: accountPlayerClaimsSchema,
    player: publicPlayerProfileSchema,
    comeback: comebackResponseSchema,
    focus: focusResponseSchema,
    trackBests: publicTrackBestsSchema,
    follows: followsResponseSchema,
    rivals: rivalsResponseSchema,
    stories: storiesResponseSchema,
    reactions: summaryResponseSchema,
    profile: publicPlayerProfileSchema,
    ratingLeaderboard: leaderboardResponseSchema,
    ratingHistory: ratingHistoryResponseSchema,
    tournamentStandings: tournamentStandingsResponseSchema,
    opponents: opponentsResponseSchema,
    career: careerResponseSchema,
    aliases: publicPlayerAliasesSchema,
    worldRecordTimes: {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "records"],
      properties: {
        schemaVersion: { type: "string", const: "mk8dx.world-record-times.v1" },
        records: {
          type: "array",
          maxItems: 400,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["mode", "trackId", "totalTimeMs"],
            properties: {
              mode: { type: "integer", enum: [150, 200] },
              trackId: { type: "string", pattern: "^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$" },
              totalTimeMs: { type: "integer", minimum: 1, maximum: 599999 },
            },
          },
        },
      },
    },
  },
} as const;

// A section that cannot be produced is left out. The page has always
// rendered around a missing part; it must not lose the rest for one.
async function section<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load();
  } catch {
    return undefined;
  }
}

// The Player-profile view. Each part is optional in the same way: a
// runtime that does not mount rating or career simply answers without it.
async function loadProfile(
  options: HomeBootstrapRouteOptions,
  playerId: string,
): Promise<Readonly<Record<string, unknown>>> {
  const [profile, ratingLeaderboard, ratingHistory, tournamentStandings,
    opponents, career, aliases] = await Promise.all([
    section(async () =>
      await options.identity.findPublicPlayerById(playerId) ?? undefined),
    options.ratings === undefined ? undefined : section(async () =>
      ratingLeaderboardDocument(await options.ratings!.listRatings(200))),
    options.ratingHistory === undefined ? undefined : section(async () => ({
      schemaVersion: "mk8dx.public-rating-history.v1" as const,
      points: await options.ratingHistory!.listRatingHistory(playerId),
    })),
    options.ratingHistory === undefined ? undefined : section(async () => ({
      schemaVersion: "mk8dx.public-tournament-standings.v1" as const,
      sections: await options.ratingHistory!.listTournamentStandings(),
    })),
    options.ratingHistory === undefined ? undefined : section(async () => ({
      schemaVersion: "mk8dx.public-tournament-opponents.v1" as const,
      opponents: await options.ratingHistory!.listOpponents(playerId),
    })),
    options.career === undefined ? undefined : section(async () => ({
      schemaVersion: "mk8dx.public-player-career.v1" as const,
      ...await options.career!.loadCareer(playerId),
    })),
    options.aliases === undefined ? undefined : section(async () => ({
      schemaVersion: "mk8dx.public-player-aliases.v1" as const,
      playerId,
      aliases: await options.aliases!.listPublicAliasesByPlayerId(playerId),
    })),
  ]);
  return {
    ...(profile === undefined ? {} : { profile }),
    ...(ratingLeaderboard === undefined ? {} : { ratingLeaderboard }),
    ...(ratingHistory === undefined ? {} : { ratingHistory }),
    ...(tournamentStandings === undefined ? {} : { tournamentStandings }),
    ...(opponents === undefined ? {} : { opponents }),
    ...(career === undefined ? {} : { career }),
    ...(aliases === undefined ? {} : { aliases }),
  };
}

export async function registerHomeBootstrapRoutes(
  app: FastifyInstance,
  options: HomeBootstrapRouteOptions,
): Promise<void> {
  app.get<{
    Querystring: Readonly<{ player?: string }>;
    Reply: unknown;
  }>(
    "/v1/bootstrap",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            player: {
              type: "string",
              pattern: "^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
              maxLength: 135,
            },
          },
        },
        response: {
          200: bootstrapResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      // A Player id asks for the profile view; without one the Home view
      // is meant. Both always carry the parts every page shows.
      const viewedPlayerId = request.query.player;
      const actor = await section(() => options.resolveActor(request));
      const authenticated = actor !== undefined &&
        (actor.role === "account" || actor.role === "administrator");

      const profileSections = viewedPlayerId === undefined
        ? {}
        : await loadProfile(options, viewedPlayerId);

      // Every view carries the Mastery baseline; a snapshot that is not complete is left out and the
      // clients keep their packaged one.
      const worldRecordTimes = options.worldRecords === undefined ? undefined : await section(async () => {
        const records = (await options.worldRecords!.list())
          .map((record) => ({ mode: record.mode, trackId: record.trackId, totalTimeMs: record.totalTimeMs }));
        return records.length === 192
          ? { schemaVersion: "mk8dx.world-record-times.v1" as const, records }
          : undefined;
      });
      const baseline = worldRecordTimes === undefined ? {} : { worldRecordTimes };

      // Public sections are answered for everyone, including a signed-out
      // visitor, so opening the site never depends on having an account.
      const stories = viewedPlayerId !== undefined
        ? undefined
        : await section(async () => ({
        schemaVersion: "mk8dx.activity-stories.v1" as const,
        stories: await options.stories.listStories(),
      }));

      const reactionSummaries = stories === undefined
        ? undefined
        : await section(async () => {
            // The reaction bar of a story targets that story's best run,
            // so those are the ids to answer. The client orders stories
            // newest first before it shows the top ten, so the same order
            // is applied here: taking the first twenty then guarantees the
            // client's ten are among them. A caller that wants fewer simply
            // ignores the rest.
            type Story = Readonly<{
              latestAtMs: number;
              mode: number;
              trackId: string;
              player: Readonly<{ playerId: string }>;
              runDetails?: readonly Readonly<
                { resultId: string; timeMs: number }>[];
            }>;
            const resultIds = [...(stories.stories as readonly Story[])]
              .sort((a, b) =>
                b.latestAtMs - a.latestAtMs ||
                a.player.playerId.localeCompare(b.player.playerId) ||
                a.trackId.localeCompare(b.trackId) ||
                a.mode - b.mode)
              .slice(0, 20)
              .map((story) => [...(story.runDetails ?? [])]
                .sort((a, b) =>
                  a.timeMs - b.timeMs || a.resultId.localeCompare(b.resultId))
                [0]?.resultId)
              .filter((id): id is string => id !== undefined);
            if (resultIds.length === 0 || actor === undefined) {
              return undefined;
            }
            return {
              schemaVersion: "mk8dx.public-time-trial-reactions.v1" as const,
              reactions: await options.reactions.summarize(actor, resultIds),
            };
          });

      if (!authenticated || actor === undefined) {
        return reply.send({
          schemaVersion: "mk8dx.home-bootstrap.v1",
          authenticated: false,
          ...profileSections,
          ...baseline,
          ...(stories === undefined ? {} : { stories }),
          ...(reactionSummaries === undefined
            ? {}
            : { reactions: reactionSummaries }),
        });
      }

      const homeOnly = viewedPlayerId === undefined;
      const [notifications, claims, comeback, focus, follows] =
        await Promise.all([
          section(async () => ({
            schemaVersion: "mk8dx.notifications.v1" as const,
            ...await options.notifications.listMine(actor),
          })),
          section(async () => ({
            schemaVersion: "mk8dx.account-player-claims.v1" as const,
            claims: await options.claims.listMine(actor),
          })),
          homeOnly ? section(async () => ({
            schemaVersion: "mk8dx.home-comeback.v1" as const,
            ...await options.comeback.loadMine(actor),
          })) : undefined,
          homeOnly ? section(async () => ({
            schemaVersion: "mk8dx.home-focus.v1" as const,
            ...await options.focus.loadMine(actor),
          })) : undefined,
          homeOnly ? section(async () => ({
            schemaVersion: "mk8dx.player-follows.v1" as const,
            follows: await options.follows.listMine(actor),
          })) : undefined,
        ]);

      // The navigation shows the verified Player, and the hero needs the
      // bests of that Player and every rival. Both depend on an answer
      // above, so they follow it rather than travel beside it.
      const verifiedPlayerId = claims?.claims.find(
        (claim) => (claim as Readonly<{ claimStatus?: string }>)
          .claimStatus === "verified",
      );
      const player = verifiedPlayerId === undefined
        ? undefined
        : await section(async () => {
            const playerId = (verifiedPlayerId as Readonly<
              { playerId?: string }>).playerId;
            if (playerId === undefined) { return undefined; }
            const found = await options.identity.findPublicPlayerById(playerId);
            return found ?? undefined;
          });

      const trackBests = comeback === undefined
        ? undefined
        : await section(async () => {
            const ids = [
              comeback.player.playerId,
              ...comeback.rivals.map((rival) => rival.playerId),
            ];
            const grouped = await options.trackBests
              .listTrackBestsForPlayers(ids);
            return {
              schemaVersion: "mk8dx.public-track-bests.v1" as const,
              players: [...grouped].map(([playerId, bests]) => (
                {
                  playerId,
                  bests: focus === undefined || focus.modePreference === "all"
                    ? bests
                    : bests.filter((best) =>
                        String((best as Readonly<{ mode: number }>).mode) ===
                          focus.modePreference),
                }
              )),
            };
          });

      // Comeback already loaded the private rival selection and comparisons.
      // Re-projecting those identities lets Activity consume the ordinary
      // rivals endpoint from the bootstrap cache without another request or
      // another repository query.
      const rivals = comeback === undefined
        ? undefined
        : {
            schemaVersion: "mk8dx.player-rivals.v1" as const,
            rivals: comeback.rivals.map((rival) => ({
              playerId: rival.playerId,
              displayName: rival.displayName,
              ...(rival.avatarId === undefined ? {} : { avatarId: rival.avatarId }),
            })),
          };

      const filteredStories = stories === undefined
        ? undefined
        : focus === undefined || focus.modePreference === "all"
          ? stories
          : {
              ...stories,
              stories: (
                stories.stories as readonly Readonly<{ mode: number }>[]
              ).filter((story) =>
                String(story.mode) === focus.modePreference),
            };

      // Personal relevance is a projection of the persisted canonical event,
      // not a second client-side standings inference. Exact actor/time matching
      // prevents an old notification from being attached to a later story.
      const relevantStories = filteredStories === undefined || notifications === undefined
        ? filteredStories
        : {
            ...filteredStories,
            stories: (filteredStories.stories as readonly Record<string, unknown>[])
              .map((story) => {
                const player = story["player"] as Record<string, unknown> | undefined;
                const evidence = notifications.notifications.find((candidate) => {
                  const notification = candidate as Readonly<{
                    kind?: string; actorPlayerId?: string; trackId?: string;
                    mode?: number; actorTimeMs?: number;
                  }>;
                  return notification.kind === "overtaken" &&
                    notification.actorPlayerId === player?.["playerId"] &&
                    notification.trackId === story["trackId"] &&
                    notification.mode === story["mode"] &&
                    notification.actorTimeMs === story["bestMs"];
                }) as Readonly<{
                  notificationId?: string; actorTimeMs?: number;
                  recipientTimeMs?: number; deltaMs?: number;
                  recipientRank?: number;
                }> | undefined;
                return evidence?.notificationId === undefined ||
                    evidence.actorTimeMs === undefined ||
                    evidence.recipientTimeMs === undefined ||
                    evidence.deltaMs === undefined ||
                    evidence.recipientRank === undefined
                  ? story
                  : {
                      ...story,
                      viewerOvertake: {
                        notificationId: evidence.notificationId,
                        actorTimeMs: evidence.actorTimeMs,
                        recipientTimeMs: evidence.recipientTimeMs,
                        deltaMs: evidence.deltaMs,
                        recipientRank: evidence.recipientRank,
                      },
                    };
              }),
          };

      return reply.send({
        schemaVersion: "mk8dx.home-bootstrap.v1",
        authenticated: true,
        ...profileSections,
        ...baseline,
        ...(notifications === undefined ? {} : { notifications }),
        ...(claims === undefined ? {} : { claims }),
        ...(player === undefined ? {} : { player }),
        ...(comeback === undefined ? {} : { comeback }),
        ...(focus === undefined ? {} : { focus }),
        ...(trackBests === undefined ? {} : { trackBests }),
        ...(follows === undefined ? {} : { follows }),
        ...(rivals === undefined ? {} : { rivals }),
        ...(relevantStories === undefined ? {} : { stories: relevantStories }),
        ...(reactionSummaries === undefined
          ? {}
          : { reactions: reactionSummaries }),
      });
    },
  );
}
