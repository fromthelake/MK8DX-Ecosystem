import type { AccountStatus, ActorContext } from "../identity/types.js";

const authenticationBindingIdPattern =
  /^restricted_auth_binding\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const reasonCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export type AuthenticationBindingLifecycleErrorCode =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_command"
  | "invalid_transition";

export class AuthenticationBindingLifecycleError extends Error {
  public constructor(
    public readonly code: AuthenticationBindingLifecycleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthenticationBindingLifecycleError";
  }
}

export type AuthenticationBindingStatus = "active" | "released" | "revoked";

export type AuthenticationBindingLifecycleSnapshot = Readonly<{
  authenticationBindingId: string;
  userAccountId: string;
  bindingStatus: AuthenticationBindingStatus;
  revision: number;
  lastSequence: number;
  updatedAtMs: number;
}>;

export type AppendAuthenticationBindingLifecycleInput = Readonly<{
  authenticationBindingId: string;
  expectedRevision: number;
  nextSnapshot: AuthenticationBindingLifecycleSnapshot;
  event: Readonly<{
    sequence: number;
    eventType: "binding_released" | "binding_revoked";
    actorUserAccountId: string;
    reasonCode: string;
    occurredAtMs: number;
  }>;
}>;

export interface AuthenticationBindingLifecycleTransaction {
  findUserAccountStatusForUpdate(
    userAccountId: string,
  ): Promise<AccountStatus | null>;
  findAuthenticationBindingForUpdate(
    authenticationBindingId: string,
  ): Promise<AuthenticationBindingLifecycleSnapshot | null>;
  appendAuthenticationBindingLifecycle(
    input: AppendAuthenticationBindingLifecycleInput,
  ): Promise<void>;
}

export interface AuthenticationBindingLifecycleRepository {
  transaction<T>(
    work: (transaction: AuthenticationBindingLifecycleTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface AuthenticationBindingLifecycleClock {
  nowMs(): number;
}

export type EndAuthenticationBindingCommand = Readonly<{
  authenticationBindingId: string;
  expectedRevision: number;
  action: "release" | "revoke";
  reasonCode: string;
}>;

export class AuthenticationBindingLifecycleService {
  public constructor(
    private readonly repository: AuthenticationBindingLifecycleRepository,
    private readonly clock: AuthenticationBindingLifecycleClock,
  ) {}

  public async endBinding(
    actor: ActorContext,
    command: EndAuthenticationBindingCommand,
  ): Promise<AuthenticationBindingLifecycleSnapshot> {
    if (actor.role !== "administrator") {
      throw new AuthenticationBindingLifecycleError(
        "forbidden",
        "administrator actor required",
      );
    }
    if (!authenticationBindingIdPattern.test(command.authenticationBindingId)) {
      throw new AuthenticationBindingLifecycleError(
        "invalid_command",
        "authenticationBindingId is invalid",
      );
    }
    if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) {
      throw new AuthenticationBindingLifecycleError(
        "invalid_command",
        "expectedRevision is invalid",
      );
    }
    if (command.action !== "release" && command.action !== "revoke") {
      throw new AuthenticationBindingLifecycleError(
        "invalid_command",
        "authentication binding action is invalid",
      );
    }
    if (
      command.reasonCode.length > 64 ||
      !reasonCodePattern.test(command.reasonCode)
    ) {
      throw new AuthenticationBindingLifecycleError(
        "invalid_command",
        "reasonCode is invalid",
      );
    }
    const occurredAtMs = this.clock.nowMs();
    if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs < 0) {
      throw new AuthenticationBindingLifecycleError(
        "conflict",
        "authentication binding clock value is invalid",
      );
    }

    return this.repository.transaction(async (transaction) => {
      const administratorStatus = await transaction.findUserAccountStatusForUpdate(
        actor.userAccountId,
      );
      const current = await transaction.findAuthenticationBindingForUpdate(
        command.authenticationBindingId,
      );
      if (administratorStatus === null || current === null) {
        throw new AuthenticationBindingLifecycleError(
          "not_found",
          "authentication binding was not found",
        );
      }
      if (administratorStatus !== "active") {
        throw new AuthenticationBindingLifecycleError(
          "conflict",
          "administrator UserAccount is not active",
        );
      }
      if (current.revision !== command.expectedRevision) {
        throw new AuthenticationBindingLifecycleError(
          "conflict",
          "authentication binding revision conflicted",
        );
      }
      if (current.bindingStatus !== "active") {
        throw new AuthenticationBindingLifecycleError(
          "invalid_transition",
          "authentication binding is already ended",
        );
      }
      if (occurredAtMs < current.updatedAtMs) {
        throw new AuthenticationBindingLifecycleError(
          "conflict",
          "authentication binding clock precedes retained lifecycle state",
        );
      }
      const bindingStatus = command.action === "release" ? "released" : "revoked";
      const updated: AuthenticationBindingLifecycleSnapshot = {
        ...current,
        bindingStatus,
        revision: current.revision + 1,
        lastSequence: current.lastSequence + 1,
        updatedAtMs: occurredAtMs,
      };
      await transaction.appendAuthenticationBindingLifecycle({
        authenticationBindingId: current.authenticationBindingId,
        expectedRevision: command.expectedRevision,
        nextSnapshot: updated,
        event: {
          sequence: updated.lastSequence,
          eventType:
            command.action === "release" ? "binding_released" : "binding_revoked",
          actorUserAccountId: actor.userAccountId,
          reasonCode: command.reasonCode,
          occurredAtMs,
        },
      });
      return updated;
    });
  }
}
