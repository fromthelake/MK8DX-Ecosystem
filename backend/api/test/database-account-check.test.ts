import { describe, expect, it } from "vitest";

import { classifyGrants } from "../src/composition/database-account-check-main.js";

describe("database account classification", () => {
  it("accepts a MySQL runtime account with only row access", () => {
    expect(classifyGrants([
      "GRANT USAGE ON *.* TO `mk8dx_runtime`@`%`",
      "GRANT SELECT, INSERT, UPDATE, DELETE ON `mk8dx`.* TO `mk8dx_runtime`@`%`",
    ], "mk8dx")).toEqual({ dataAccess: true, canChangeSchema: false, extraPrivileges: [] });
  });

  it("accepts a MariaDB runtime account and never needs its password hash", () => {
    expect(classifyGrants([
      "GRANT USAGE ON *.* TO `acct_run`@`localhost` IDENTIFIED BY PASSWORD '*0123456789ABCDEF'",
      "GRANT SELECT, INSERT, UPDATE, DELETE ON `acct\\_mk8dx`.* TO `acct_run`@`localhost`",
    ], "acct_mk8dx")).toEqual({ dataAccess: true, canChangeSchema: false, extraPrivileges: [] });
  });

  it("flags a hosting-panel user with all privileges", () => {
    const report = classifyGrants([
      "GRANT USAGE ON *.* TO `acct_user`@`localhost`",
      "GRANT ALL PRIVILEGES ON `acct\\_mk8dx`.* TO `acct_user`@`localhost`",
    ], "acct_mk8dx");
    expect(report).toEqual({ dataAccess: true, canChangeSchema: true, extraPrivileges: ["ALL PRIVILEGES"] });
  });

  it("flags single schema privileges, global grants, roles and GRANT OPTION", () => {
    expect(classifyGrants(["GRANT SELECT, INSERT, UPDATE, DELETE, DROP ON `mk8dx`.* TO `u`@`%`"], "mk8dx")
      .extraPrivileges).toEqual(["DROP"]);
    expect(classifyGrants(["GRANT ALTER ON *.* TO `u`@`%`"], "mk8dx").canChangeSchema).toBe(true);
    expect(classifyGrants(["GRANT SELECT ON `mk8dx`.* TO `u`@`%` WITH GRANT OPTION"], "mk8dx").extraPrivileges)
      .toEqual(["GRANT OPTION"]);
    expect(classifyGrants(["GRANT `site_owner`@`%` TO `u`@`%`"], "mk8dx").extraPrivileges).toEqual(["ROLE"]);
    expect(classifyGrants(["GRANT `site_owner` TO `u`@`%`"], "mk8dx").canChangeSchema).toBe(true);
    expect(classifyGrants(["GRANT PROXY ON ''@'' TO 'root'@'localhost' WITH GRANT OPTION"], "mk8dx").canChangeSchema)
      .toBe(true);
    expect(classifyGrants(["GRANT INDEX, CREATE VIEW ON `m%`.* TO `u`@`%`"], "mk8dx").extraPrivileges)
      .toEqual(["CREATE VIEW", "INDEX"]);
  });

  it("ignores grants on other databases and reports missing row access", () => {
    const report = classifyGrants([
      "GRANT ALL PRIVILEGES ON `other`.* TO `u`@`%`",
      "GRANT SELECT ON `mk8dx`.* TO `u`@`%`",
      "GRANT UPDATE (display_name) ON `mk8dx`.`players` TO `u`@`%`",
    ], "mk8dx");
    expect(report).toEqual({ dataAccess: false, canChangeSchema: false, extraPrivileges: [] });
    // `_` is a wildcard in a grant's database name; `\_` is a literal underscore.
    expect(classifyGrants(["GRANT DROP ON `mk8dx_`.* TO `u`@`%`"], "mk8dx1").canChangeSchema).toBe(true);
    expect(classifyGrants(["GRANT DROP ON `mk8dx\\_`.* TO `u`@`%`"], "mk8dx1").canChangeSchema).toBe(false);
  });
});
