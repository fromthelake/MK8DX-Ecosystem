import type { Pool, RowDataPacket } from "mysql2/promise";

import type { PasswordlessAccountLookup } from "./embedded-passwordless-auth.js";

/**
 * Answers "does this address already have an account?" so the magic-link email
 * can welcome a new arrival instead of asking them to sign in to something
 * they have never been inside.
 *
 * The answer never reaches an anonymous caller: it only ever selects wording
 * inside a message delivered to that same address, so it does not widen the
 * address-enumeration surface the sign-in page deliberately keeps closed.
 */
export class MysqlPasswordlessAccountLookup implements PasswordlessAccountLookup {
  public constructor(private readonly pool: Pool) {}

  public async hasAccount(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 255) { return false; }
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT 1 AS present FROM mk8dx_auth_user WHERE email = ? LIMIT 1",
      [normalized],
    );
    return rows.length > 0;
  }
}
