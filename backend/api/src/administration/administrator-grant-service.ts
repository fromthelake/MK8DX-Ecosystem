import type { AccountStatus, ActorContext } from "../identity/types.js";

const grantIdPattern = /^administrator_grant\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const accountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const reasonCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export type AdministratorGrantStatus = "active" | "revoked";
export type AdministratorGrantOrigin = "bootstrap_cli" | "administrator";

export type AdministratorGrantSnapshot = Readonly<{
  administratorGrantId: string;
  userAccountId: string;
  status: AdministratorGrantStatus;
  origin: AdministratorGrantOrigin;
  revision: number;
  lastSequence: number;
  grantedAtMs: number;
  revokedAtMs?: number;
}>;

export type CreateAdministratorGrantInput = Readonly<{
  snapshot: AdministratorGrantSnapshot;
  actorUserAccountId?: string;
  reasonCode: string;
}>;

export type RevokeAdministratorGrantInput = Readonly<{
  current: AdministratorGrantSnapshot;
  expectedRevision: number;
  actorUserAccountId: string;
  reasonCode: string;
  revokedAtMs: number;
}>;

export interface AdministratorGrantWriteTransaction {
  findUserAccountStatus(userAccountId: string): Promise<AccountStatus | null>;
  hasAnyGrantForUpdate(): Promise<boolean>;
  findActiveGrantForUpdate(
    userAccountId: string,
  ): Promise<AdministratorGrantSnapshot | null>;
  countActiveGrantsForUpdate(): Promise<number>;
  createGrant(input: CreateAdministratorGrantInput): Promise<void>;
  revokeGrant(input: RevokeAdministratorGrantInput): Promise<void>;
}

export interface AdministratorGrantWriteRepository {
  transaction<T>(
    work: (transaction: AdministratorGrantWriteTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface AdministratorGrantIdGenerator {
  newAdministratorGrantId(): string;
}

export interface AdministratorGrantClock {
  nowMs(): number;
}

export type AdministratorGrantServiceErrorCode =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_command";

export class AdministratorGrantServiceError extends Error {
  public constructor(
    public readonly code: AdministratorGrantServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdministratorGrantServiceError";
  }
}

function validAccountId(value: string): void {
  if (!accountIdPattern.test(value)) {
    throw new AdministratorGrantServiceError(
      "invalid_command",
      "userAccountId is invalid",
    );
  }
}

function validReasonCode(value: string): void {
  if (value.length > 64 || !reasonCodePattern.test(value)) {
    throw new AdministratorGrantServiceError(
      "invalid_command",
      "reasonCode is invalid",
    );
  }
}

export class AdministratorGrantService {
  public constructor(
    private readonly repository: AdministratorGrantWriteRepository,
    private readonly idGenerator: AdministratorGrantIdGenerator,
    private readonly clock: AdministratorGrantClock,
  ) {}

  public async bootstrapFirstAdministrator(
    userAccountId: string,
  ): Promise<AdministratorGrantSnapshot> {
    validAccountId(userAccountId);
    return this.createGrant(userAccountId, "bootstrap_cli", undefined, "initial_owner_bootstrap");
  }

  public async grantAdministrator(
    actor: ActorContext,
    userAccountId: string,
    reasonCode: string,
  ): Promise<AdministratorGrantSnapshot> {
    if (actor.role !== "administrator") {
      throw new AdministratorGrantServiceError(
        "forbidden",
        "administrator actor required",
      );
    }
    validAccountId(userAccountId);
    validReasonCode(reasonCode);
    return this.createGrant(userAccountId, "administrator", actor.userAccountId, reasonCode);
  }

  public async revokeAdministrator(
    actor: ActorContext,
    userAccountId: string,
    reasonCode: string,
  ): Promise<AdministratorGrantSnapshot> {
    if (actor.role !== "administrator") {
      throw new AdministratorGrantServiceError(
        "forbidden",
        "administrator actor required",
      );
    }
    validAccountId(userAccountId);
    validReasonCode(reasonCode);
    const revokedAtMs = this.now();
    return this.repository.transaction(async (transaction) => {
      const [actorStatus, actorGrant, current] = await Promise.all([
        transaction.findUserAccountStatus(actor.userAccountId),
        transaction.findActiveGrantForUpdate(actor.userAccountId),
        transaction.findActiveGrantForUpdate(userAccountId),
      ]);
      if (actorStatus !== "active" || actorGrant === null) {
        throw new AdministratorGrantServiceError(
          "forbidden",
          "administrator account is not active",
        );
      }
      if (current === null) {
        throw new AdministratorGrantServiceError(
          "not_found",
          "active administrator grant was not found",
        );
      }
      if (await transaction.countActiveGrantsForUpdate() <= 1) {
        throw new AdministratorGrantServiceError(
          "conflict",
          "the final active administrator grant cannot be revoked",
        );
      }
      await transaction.revokeGrant({
        current,
        expectedRevision: current.revision,
        actorUserAccountId: actor.userAccountId,
        reasonCode,
        revokedAtMs,
      });
      return {
        ...current,
        status: "revoked",
        revision: current.revision + 1,
        lastSequence: current.lastSequence + 1,
        revokedAtMs,
      };
    });
  }

  private async createGrant(
    userAccountId: string,
    origin: AdministratorGrantOrigin,
    actorUserAccountId: string | undefined,
    reasonCode: string,
  ): Promise<AdministratorGrantSnapshot> {
    const administratorGrantId = this.idGenerator.newAdministratorGrantId();
    if (!grantIdPattern.test(administratorGrantId)) {
      throw new AdministratorGrantServiceError(
        "invalid_command",
        "generated administratorGrantId is invalid",
      );
    }
    const grantedAtMs = this.now();
    return this.repository.transaction(async (transaction) => {
      if (origin === "bootstrap_cli" && await transaction.hasAnyGrantForUpdate()) {
        throw new AdministratorGrantServiceError(
          "conflict",
          "administrator bootstrap has already been completed",
        );
      }
      const accountStatus = await transaction.findUserAccountStatus(userAccountId);
      if (accountStatus === null) {
        throw new AdministratorGrantServiceError(
          "not_found",
          "UserAccount was not found",
        );
      }
      if (accountStatus !== "active") {
        throw new AdministratorGrantServiceError(
          "conflict",
          "UserAccount is not active",
        );
      }
      if (origin === "administrator") {
        const actorStatus = await transaction.findUserAccountStatus(actorUserAccountId!);
        const actorGrant = await transaction.findActiveGrantForUpdate(actorUserAccountId!);
        if (actorStatus !== "active" || actorGrant === null) {
          throw new AdministratorGrantServiceError(
            "forbidden",
            "administrator account is not active",
          );
        }
      }
      if (await transaction.findActiveGrantForUpdate(userAccountId) !== null) {
        throw new AdministratorGrantServiceError(
          "conflict",
          "UserAccount already has an active administrator grant",
        );
      }
      const snapshot: AdministratorGrantSnapshot = {
        administratorGrantId,
        userAccountId,
        status: "active",
        origin,
        revision: 1,
        lastSequence: 1,
        grantedAtMs,
      };
      await transaction.createGrant({
        snapshot,
        ...(actorUserAccountId === undefined ? {} : { actorUserAccountId }),
        reasonCode,
      });
      return snapshot;
    });
  }

  private now(): number {
    const value = this.clock.nowMs();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new AdministratorGrantServiceError(
        "conflict",
        "administrator grant clock value is invalid",
      );
    }
    return value;
  }
}
