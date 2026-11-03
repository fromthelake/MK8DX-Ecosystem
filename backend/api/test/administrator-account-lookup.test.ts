import { describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2";

import {
  AdministratorAccountLookupError,
  lookupVerifiedAccountByEmail,
  parseAccountLookupArguments,
  type AccountLookupQueryPort,
} from "../src/administration/administrator-account-lookup-main.js";
import { AuthenticationSubjectHmacProtector } from
  "../src/authentication/authentication-subject-hmac-protector.js";

const protector = new AuthenticationSubjectHmacProtector({
  lookupHmacKey: new Uint8Array(32).fill(0x42),
  lookupKeyVersion: "test-lookup-v1",
});

type FakeUser = { id: string; email: string; emailVerified: 0 | 1 };
type FakeBinding = { hmacHex: string; userAccountId: string };

function fakeQueries(
  users: readonly FakeUser[],
  bindings: readonly FakeBinding[],
): AccountLookupQueryPort & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async execute(sql, values) {
      queries.push(sql);
      if (sql.includes("FROM mk8dx_auth_user")) {
        return users
          .filter((user) => user.email === values[0])
          .map((user) => ({
            subjectId: user.id,
            emailVerified: user.emailVerified,
          })) as unknown as RowDataPacket[];
      }
      if (sql.includes("restricted_authentication_bindings")) {
        expect(values[0]).toBe("mk8dx_passwordless_v1");
        expect(values[1]).toBe("test-lookup-v1");
        const hmacHex = Buffer.from(values[2] as Uint8Array).toString("hex");
        return bindings
          .filter((binding) => binding.hmacHex === hmacHex)
          .map((binding) => ({
            userAccountId: binding.userAccountId,
          })) as unknown as RowDataPacket[];
      }
      throw new Error(`unexpected SQL in fake: ${sql.slice(0, 60)}`);
    },
  };
}

function bindingFor(subjectId: string, userAccountId: string): FakeBinding {
  const subject = protector.protectVerifiedSubject(
    "mk8dx_passwordless_v1",
    subjectId,
  );
  return {
    hmacHex: Buffer.from(subject.subjectLookupHmac).toString("hex"),
    userAccountId,
  };
}

describe("administrator account lookup", () => {
  it("requires one exact email argument", () => {
    expect(parseAccountLookupArguments(["--email", "owner@example.test"]))
      .toBe("owner@example.test");
    for (const bad of [
      [],
      ["--email"],
      ["--user", "owner@example.test"],
      ["--email", "not-an-email"],
      ["--email", "two words@example.test"],
    ]) {
      expect(() => parseAccountLookupArguments(bad as string[])).toThrow(
        AdministratorAccountLookupError,
      );
    }
  });

  it("resolves exactly one verified account even when other users signed in first", async () => {
    // Two other legitimate users exist and signed in before the owner; the
    // explicit email still targets exactly the owner's account, and their
    // presence never grants or blocks anything ("no first user wins").
    const queries = fakeQueries(
      [
        { id: "subject-early-1", email: "early1@example.test", emailVerified: 1 },
        { id: "subject-early-2", email: "early2@example.test", emailVerified: 1 },
        { id: "subject-owner", email: "owner@example.test", emailVerified: 1 },
      ],
      [
        bindingFor("subject-early-1", "user_account.early_1"),
        bindingFor("subject-early-2", "user_account.early_2"),
        bindingFor("subject-owner", "user_account.owner_target"),
      ],
    );
    await expect(lookupVerifiedAccountByEmail(
      queries,
      protector,
      "owner@example.test",
    )).resolves.toBe("user_account.owner_target");
  });

  it("fails closed on zero matches, unverified email, and missing binding", async () => {
    const users: FakeUser[] = [
      { id: "subject-owner", email: "owner@example.test", emailVerified: 1 },
      { id: "subject-unverified", email: "new@example.test", emailVerified: 0 },
    ];
    const bindings = [bindingFor("subject-owner", "user_account.owner_target")];

    await expect(lookupVerifiedAccountByEmail(
      fakeQueries(users, bindings),
      protector,
      "absent@example.test",
    )).rejects.toThrow(/no authentication user/);

    await expect(lookupVerifiedAccountByEmail(
      fakeQueries(users, bindings),
      protector,
      "new@example.test",
    )).rejects.toThrow(/not verified/);

    await expect(lookupVerifiedAccountByEmail(
      fakeQueries(users, []),
      protector,
      "owner@example.test",
    )).rejects.toThrow(/no active authentication binding/);
  });

  it("fails closed on ambiguous matches and malformed rows", async () => {
    const duplicateUsers: FakeUser[] = [
      { id: "subject-a", email: "owner@example.test", emailVerified: 1 },
      { id: "subject-b", email: "owner@example.test", emailVerified: 1 },
    ];
    await expect(lookupVerifiedAccountByEmail(
      fakeQueries(duplicateUsers, []),
      protector,
      "owner@example.test",
    )).rejects.toThrow(/more than one/);

    const owner: FakeUser[] = [
      { id: "subject-owner", email: "owner@example.test", emailVerified: 1 },
    ];
    const ambiguous = [
      bindingFor("subject-owner", "user_account.owner_target"),
      bindingFor("subject-owner", "user_account.second_binding"),
    ];
    await expect(lookupVerifiedAccountByEmail(
      fakeQueries(owner, ambiguous),
      protector,
      "owner@example.test",
    )).rejects.toThrow(/ambiguous/);

    const malformed = [bindingFor("subject-owner", "NOT_AN_ACCOUNT_ID")];
    await expect(lookupVerifiedAccountByEmail(
      fakeQueries(owner, malformed),
      protector,
      "owner@example.test",
    )).rejects.toThrow(/malformed/);
  });
});
