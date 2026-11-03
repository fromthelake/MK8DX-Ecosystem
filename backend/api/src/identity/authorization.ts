import type { ActorContext } from "./types.js";

export function canReadUserAccount(
  actor: ActorContext,
  targetUserAccountId: string,
): boolean {
  return (
    actor.role === "administrator" ||
    (actor.role === "account" && actor.userAccountId === targetUserAccountId)
  );
}

export function canReadPlayerClaim(
  actor: ActorContext,
  claimOwnerUserAccountId: string,
): boolean {
  return (
    actor.role === "administrator" ||
    (actor.role === "account" &&
      actor.userAccountId === claimOwnerUserAccountId)
  );
}
