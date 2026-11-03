import type { Pool } from "mysql2/promise";

import type {
  EmbeddedAuthAuditEvent,
  EmbeddedAuthAuditSink,
} from "./embedded-passwordless-auth.js";

const opaqueIdPattern = /^[A-Za-z0-9_-]{1,36}$/;
const clientIdPattern = /^mk8dx\.[a-z0-9]+(?:[._-][a-z0-9]+)*\.v[1-9][0-9]*$/;

export class EmbeddedAuthAuditPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EmbeddedAuthAuditPersistenceError";
  }
}

export interface EmbeddedAuthAuditClock {
  nowMs(): number;
}

function validate(event: EmbeddedAuthAuditEvent): void {
  const validSubject = event.subjectId !== undefined &&
    opaqueIdPattern.test(event.subjectId);
  const validSession = event.sessionId !== undefined &&
    opaqueIdPattern.test(event.sessionId);
  const validClient = event.clientId !== undefined &&
    clientIdPattern.test(event.clientId);
  const valid = event.kind === "auth_user_created"
    ? validSubject && event.sessionId === undefined && event.clientId === undefined
    : event.kind === "auth_session_created" || event.kind === "auth_session_revoked"
      ? validSubject && validSession && event.clientId === undefined
      : event.kind === "device_authorization_requested"
        ? validClient && event.subjectId === undefined && event.sessionId === undefined
        : event.kind === "device_authorization_operator_approved" ||
            event.kind === "native_email_approval_sent" ||
            event.kind === "native_email_approval_approved" ||
            event.kind === "native_email_approval_locked"
          ? validSubject && validClient && event.sessionId === undefined
        : false;
  if (!valid) {
    throw new EmbeddedAuthAuditPersistenceError("auth audit event is invalid");
  }
}

export class MysqlEmbeddedAuthAuditSink implements EmbeddedAuthAuditSink {
  public constructor(
    private readonly pool: Pick<Pool, "execute">,
    private readonly clock: EmbeddedAuthAuditClock,
  ) {}

  public async record(event: EmbeddedAuthAuditEvent): Promise<void> {
    validate(event);
    const occurredAtMs = this.clock.nowMs();
    if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs < 0) {
      throw new EmbeddedAuthAuditPersistenceError("auth audit clock is invalid");
    }
    try {
      await this.pool.execute(
        `INSERT INTO mk8dx_auth_audit_event
         (event_kind, privacy_class, subject_id, session_id, client_id,
          occurred_at_ms)
         VALUES (?, 'private', ?, ?, ?, ?)`,
        [
          event.kind,
          event.subjectId ?? null,
          event.sessionId ?? null,
          event.clientId ?? null,
          occurredAtMs,
        ],
      );
    } catch {
      throw new EmbeddedAuthAuditPersistenceError("auth audit persistence failed");
    }
  }
}
