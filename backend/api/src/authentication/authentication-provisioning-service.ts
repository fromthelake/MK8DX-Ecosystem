import type { VerifiedAuthenticationSubject } from "./authentication-binding-resolver.js";

const keyPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const userAccountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const authenticationBindingIdPattern =
  /^restricted_auth_binding\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const provisionerReferencePattern =
  /^authentication_provisioner\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export type AuthenticationProvisioningErrorCode =
  | "denied"
  | "not_found"
  | "conflict"
  | "invalid_input";

export class AuthenticationProvisioningError extends Error {
  public constructor(
    public readonly code: AuthenticationProvisioningErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthenticationProvisioningError";
  }
}

export type AuthenticationProvisioningDecision =
  | Readonly<{ action: "deny" }>
  | Readonly<{ action: "create_account" }>
  | Readonly<{ action: "link_account"; userAccountId: string }>;

export interface AuthenticationProvisioningPolicy {
  decide(
    subject: VerifiedAuthenticationSubject,
  ): Promise<AuthenticationProvisioningDecision>;
}

export type AuthenticationBindingSnapshot = Readonly<{
  authenticationBindingId: string;
  userAccountId: string;
  accountStatus: "active" | "suspended" | "closed";
}>;

export type AuthenticationProvisioningResult = Readonly<{
  authenticationBindingId: string;
  userAccountId: string;
  accountCreated: boolean;
  bindingCreated: boolean;
}>;

export type CreateAuthenticationAccountInput = Readonly<{
  userAccountId: string;
  createdAtMs: number;
}>;

export type CreateAuthenticationBindingInput = Readonly<{
  authenticationBindingId: string;
  userAccountId: string;
  subject: VerifiedAuthenticationSubject;
  provisionerReference: string;
  createdAtMs: number;
}>;

export interface AuthenticationProvisioningTransaction {
  findActiveBindingForUpdate(
    subject: VerifiedAuthenticationSubject,
  ): Promise<AuthenticationBindingSnapshot | null>;
  findUserAccountStatusForUpdate(
    userAccountId: string,
  ): Promise<"active" | "suspended" | "closed" | null>;
  createUserAccount(input: CreateAuthenticationAccountInput): Promise<void>;
  createAuthenticationBinding(
    input: CreateAuthenticationBindingInput,
  ): Promise<void>;
}

export interface AuthenticationProvisioningRepository {
  transaction<T>(
    work: (transaction: AuthenticationProvisioningTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface AuthenticationProvisioningIdGenerator {
  newUserAccountId(): string;
  newAuthenticationBindingId(): string;
}

export interface AuthenticationProvisioningClock {
  nowMs(): number;
}

function validateSubject(subject: VerifiedAuthenticationSubject): void {
  if (
    subject.issuerKey.length > 64 ||
    !keyPattern.test(subject.issuerKey) ||
    subject.lookupKeyVersion.length > 64 ||
    !keyPattern.test(subject.lookupKeyVersion) ||
    subject.subjectLookupHmac.byteLength !== 32
  ) {
    throw new AuthenticationProvisioningError(
      "invalid_input",
      "verified authentication subject lookup material is invalid",
    );
  }
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export class AuthenticationProvisioningService {
  public constructor(
    private readonly repository: AuthenticationProvisioningRepository,
    private readonly policy: AuthenticationProvisioningPolicy,
    private readonly idGenerator: AuthenticationProvisioningIdGenerator,
    private readonly clock: AuthenticationProvisioningClock,
    private readonly provisionerReference: string,
  ) {
    if (
      provisionerReference.length > 141 ||
      !provisionerReferencePattern.test(provisionerReference)
    ) {
      throw new AuthenticationProvisioningError(
        "invalid_input",
        "authentication provisioner reference is invalid",
      );
    }
  }

  public async provision(
    subject: VerifiedAuthenticationSubject,
  ): Promise<AuthenticationProvisioningResult> {
    validateSubject(subject);
    const decision = await this.policy.decide(subject);
    if (decision.action === "deny") {
      throw new AuthenticationProvisioningError(
        "denied",
        "authentication provisioning policy denied the operation",
      );
    }
    if (
      decision.action === "link_account" &&
      !userAccountIdPattern.test(decision.userAccountId)
    ) {
      throw new AuthenticationProvisioningError(
        "invalid_input",
        "provisioning policy returned an invalid UserAccount identifier",
      );
    }
    const createdAtMs = this.clock.nowMs();
    if (!validTime(createdAtMs)) {
      throw new AuthenticationProvisioningError(
        "conflict",
        "authentication provisioning clock value is invalid",
      );
    }

    return this.repository.transaction(async (transaction) => {
      const existing = await transaction.findActiveBindingForUpdate(subject);
      if (existing !== null) {
        if (existing.accountStatus !== "active") {
          throw new AuthenticationProvisioningError(
            "conflict",
            "the existing authentication binding is not usable",
          );
        }
        if (
          decision.action === "link_account" &&
          existing.userAccountId !== decision.userAccountId
        ) {
          throw new AuthenticationProvisioningError(
            "conflict",
            "the verified subject is already bound to another UserAccount",
          );
        }
        return {
          authenticationBindingId: existing.authenticationBindingId,
          userAccountId: existing.userAccountId,
          accountCreated: false,
          bindingCreated: false,
        };
      }

      let userAccountId: string;
      let accountCreated: boolean;
      if (decision.action === "link_account") {
        userAccountId = decision.userAccountId;
        const status = await transaction.findUserAccountStatusForUpdate(
          userAccountId,
        );
        if (status === null) {
          throw new AuthenticationProvisioningError(
            "not_found",
            "the provisioning target UserAccount was not found",
          );
        }
        if (status !== "active") {
          throw new AuthenticationProvisioningError(
            "conflict",
            "the provisioning target UserAccount is not active",
          );
        }
        accountCreated = false;
      } else {
        userAccountId = this.idGenerator.newUserAccountId();
        if (!userAccountIdPattern.test(userAccountId)) {
          throw new AuthenticationProvisioningError(
            "invalid_input",
            "generated UserAccount identifier is invalid",
          );
        }
        await transaction.createUserAccount({ userAccountId, createdAtMs });
        accountCreated = true;
      }

      const authenticationBindingId =
        this.idGenerator.newAuthenticationBindingId();
      if (!authenticationBindingIdPattern.test(authenticationBindingId)) {
        throw new AuthenticationProvisioningError(
          "invalid_input",
          "generated authentication binding identifier is invalid",
        );
      }
      await transaction.createAuthenticationBinding({
        authenticationBindingId,
        userAccountId,
        subject,
        provisionerReference: this.provisionerReference,
        createdAtMs,
      });
      return {
        authenticationBindingId,
        userAccountId,
        accountCreated,
        bindingCreated: true,
      };
    });
  }
}
