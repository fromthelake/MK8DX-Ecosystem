import { describe, expect, it } from "vitest";

import {
  AdministratorBootstrapCliError,
  parseAdministratorBootstrapArguments,
} from "../src/administration/administrator-bootstrap-main.js";

describe("one-off initial administrator bootstrap CLI", () => {
  it("requires exact typed UserAccount confirmation", () => {
    expect(parseAdministratorBootstrapArguments([
      "--user-account-id",
      "user_account.synthetic_owner",
      "--confirm-user-account-id",
      "user_account.synthetic_owner",
    ])).toBe("user_account.synthetic_owner");
  });

  it.each([
    { arguments_: [] },
    { arguments_: ["--user-account-id", "user_account.synthetic_owner"] },
    { arguments_: [
      "--user-account-id",
      "user_account.synthetic_owner",
      "--confirm-user-account-id",
      "user_account.someone_else",
    ] },
    { arguments_: [
      "--email",
      "owner@example.test",
      "--confirm-user-account-id",
      "owner@example.test",
    ] },
  ])("rejects missing, mismatched, email-style, or alternate arguments", ({ arguments_ }) => {
    expect(() => parseAdministratorBootstrapArguments(arguments_)).toThrow(
      AdministratorBootstrapCliError,
    );
  });
});
