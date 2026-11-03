import type { FastifyRequest } from "fastify";

import type { ActorResolver } from "../identity/types.js";

export type VerifiedAuthenticationSubject = Readonly<{
  issuerKey: string;
  lookupKeyVersion: string;
  subjectLookupHmac: Uint8Array;
}>;

export type VerifiedAuthenticationSubjectResolver = (
  request: FastifyRequest,
) => Promise<VerifiedAuthenticationSubject | null>;

export type BoundUserAccount = Readonly<{
  userAccountId: string;
}>;

export interface AuthenticationBindingRepository {
  resolveActiveAccount(
    subject: VerifiedAuthenticationSubject,
  ): Promise<BoundUserAccount | null>;
}

export interface RotatingAuthenticationBindingRepository
  extends AuthenticationBindingRepository {
  rotateActiveSubject(
    previous: VerifiedAuthenticationSubject,
    active: VerifiedAuthenticationSubject,
  ): Promise<void>;
}

export interface AuthenticationSubjectProvisioner {
  provision(subject: VerifiedAuthenticationSubject): Promise<Readonly<{
    userAccountId: string;
  }>>;
}

export interface AdministratorGrantStatusRepository {
  isActiveAdministrator(userAccountId: string): Promise<boolean>;
}

export function createAdministratorAwareActorResolver(
  resolveAccountActor: ActorResolver,
  administratorGrants: AdministratorGrantStatusRepository,
): ActorResolver {
  return async (request) => {
    const actor = await resolveAccountActor(request);
    if (actor.role !== "account" && actor.role !== "administrator") {
      return actor;
    }
    try {
      return await administratorGrants.isActiveAdministrator(actor.userAccountId)
        ? { role: "administrator", userAccountId: actor.userAccountId }
        : { role: "account", userAccountId: actor.userAccountId };
    } catch {
      return { role: "account", userAccountId: actor.userAccountId };
    }
  };
}

export function createBoundAccountActorResolver(
  resolveVerifiedSubject: VerifiedAuthenticationSubjectResolver,
  repository: AuthenticationBindingRepository,
): ActorResolver {
  return async (request) => {
    const subject = await resolveVerifiedSubject(request);
    if (subject === null) {
      return { role: "anonymous" };
    }
    const account = await repository.resolveActiveAccount(subject);
    if (account === null) {
      return { role: "anonymous" };
    }
    return { role: "account", userAccountId: account.userAccountId };
  };
}

/**
 * A brand-new account's first page fires several product calls at once, and
 * every one of them reaches "no binding yet — provision". Only one insert can
 * win; the losers re-read the binding the winner just committed instead of
 * failing the request (the 503 this produced was the first thing a new
 * arrival saw on the welcome screen).
 */
async function resolveOrProvision(
  subject: VerifiedAuthenticationSubject,
  repository: AuthenticationBindingRepository,
  provisioner: AuthenticationSubjectProvisioner,
): Promise<Readonly<{ userAccountId: string }>> {
  try {
    return await provisioner.provision(subject);
  } catch (error) {
    const settled = await repository.resolveActiveAccount(subject);
    if (settled !== null) {
      return settled;
    }
    throw error;
  }
}

export function createProvisioningBoundAccountActorResolver(
  resolveVerifiedSubject: VerifiedAuthenticationSubjectResolver,
  repository: AuthenticationBindingRepository,
  provisioner: AuthenticationSubjectProvisioner,
): ActorResolver {
  return async (request) => {
    const subject = await resolveVerifiedSubject(request);
    if (subject === null) {
      return { role: "anonymous" };
    }
    const existing = await repository.resolveActiveAccount(subject);
    if (existing !== null) {
      return { role: "account", userAccountId: existing.userAccountId };
    }
    const provisioned = await resolveOrProvision(subject, repository, provisioner);
    return { role: "account", userAccountId: provisioned.userAccountId };
  };
}

export function createRotatingProvisioningBoundAccountActorResolver(
  resolveVerifiedSubjects: (
    request: FastifyRequest,
  ) => Promise<readonly VerifiedAuthenticationSubject[] | null>,
  repository: RotatingAuthenticationBindingRepository,
  provisioner: AuthenticationSubjectProvisioner,
): ActorResolver {
  return async (request) => {
    const subjects = await resolveVerifiedSubjects(request);
    if (subjects === null || subjects.length === 0 || subjects[0] === undefined) {
      return { role: "anonymous" };
    }
    const active = subjects[0];
    for (const [index, subject] of subjects.entries()) {
      const existing = await repository.resolveActiveAccount(subject);
      if (existing === null) { continue; }
      if (index > 0) {
        await repository.rotateActiveSubject(subject, active);
      }
      return { role: "account", userAccountId: existing.userAccountId };
    }
    const provisioned = await resolveOrProvision(active, repository, provisioner);
    return { role: "account", userAccountId: provisioned.userAccountId };
  };
}
