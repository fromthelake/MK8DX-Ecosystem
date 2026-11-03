import { describe, expect, it } from "vitest";

import {
  PASSENGER_PLACEHOLDER_PORT,
  PASSENGER_PRIVATE_ENV_FILE,
  PassengerEnvironmentError,
  loadPrivateEnvironmentFile,
  passengerEnvironment,
  type PassengerEnvironmentIo,
} from "../src/composition/passenger-environment.js";
import { loadHostedServerConfig } from "../src/composition/hosted-server.js";

const nothingExists: PassengerEnvironmentIo = {
  pathExists: () => false,
  readFile: () => {
    throw new Error("no file in this fake");
  },
};

function ioWith(
  files: Readonly<Record<string, string>>,
  directories: readonly string[] = [],
): PassengerEnvironmentIo {
  const normalize = (path: string) => path.replaceAll("\\", "/");
  return {
    pathExists: (path) =>
      Object.keys(files).some((file) => normalize(path).endsWith(file)) ||
      directories.some((directory) => normalize(path).endsWith(directory)),
    readFile: (path) => {
      const match = Object.entries(files).find(([file]) =>
        normalize(path).endsWith(file));
      if (match === undefined) {
        throw new Error("unexpected read in fake io");
      }
      return match[1];
    },
  };
}

describe("Passenger environment defaulting", () => {
  it("supplies the placeholder port only when no port is configured", () => {
    const defaulted = passengerEnvironment(
      { MK8DX_HOSTED_MYSQL_HOST: "x" },
      "/apps/mk8dx",
      nothingExists,
    );
    expect(defaulted["MK8DX_HOSTED_API_PORT"]).toBe(PASSENGER_PLACEHOLDER_PORT);
    expect(defaulted["MK8DX_HOSTED_MYSQL_HOST"]).toBe("x");
    expect(loadHostedServerConfig(defaulted)).toEqual({
      host: "127.0.0.1",
      port: 3000,
    });
  });

  it("never overrides an explicitly configured port", () => {
    expect(passengerEnvironment({ PORT: "4123" }, "/x", nothingExists))
      .toEqual({ PORT: "4123" });
    expect(passengerEnvironment(
      { MK8DX_HOSTED_API_PORT: "4124" },
      "/x",
      nothingExists,
    )).toEqual({ MK8DX_HOSTED_API_PORT: "4124" });
    const both = { PORT: "4125", MK8DX_HOSTED_API_PORT: "4125" };
    expect(passengerEnvironment(both, "/x", nothingExists)).toBe(both);
  });

  it("defaults the static web root to the packaged web directory when present", () => {
    const defaulted = passengerEnvironment(
      { PORT: "4123" },
      "/home/synthetic/apps/mk8dx",
      ioWith({}, ["/home/synthetic/apps/mk8dx/web"]),
    );
    expect(
      defaulted["MK8DX_HOSTED_STATIC_WEB_ROOT"]?.replaceAll("\\", "/"),
    ).toMatch(/\/home\/synthetic\/apps\/mk8dx\/web$/);

    const absent = passengerEnvironment({ PORT: "4123" }, "/x", nothingExists);
    expect(absent["MK8DX_HOSTED_STATIC_WEB_ROOT"]).toBeUndefined();

    const explicit = passengerEnvironment(
      { PORT: "4123", MK8DX_HOSTED_STATIC_WEB_ROOT: "/explicit/web" },
      "/x",
      ioWith({}, ["/x/web"]),
    );
    expect(explicit["MK8DX_HOSTED_STATIC_WEB_ROOT"]).toBe("/explicit/web");
  });

  it("merges the private environment file with real environment precedence", () => {
    const io = ioWith({
      [PASSENGER_PRIVATE_ENV_FILE]: JSON.stringify({
        MK8DX_HOSTED_MYSQL_HOST: "localhost",
        MK8DX_HOSTED_MYSQL_DATABASE: "from_file",
      }),
    });
    const merged = passengerEnvironment(
      { PORT: "4123", MK8DX_HOSTED_MYSQL_DATABASE: "from_panel" },
      "/apps/mk8dx",
      io,
    );
    expect(merged["MK8DX_HOSTED_MYSQL_HOST"]).toBe("localhost");
    // A value set in the real environment (panel) always wins over the file.
    expect(merged["MK8DX_HOSTED_MYSQL_DATABASE"]).toBe("from_panel");
  });

  it("fails closed on malformed or non-hosted private file content", () => {
    expect(() => loadPrivateEnvironmentFile(
      "/apps/mk8dx",
      ioWith({ [PASSENGER_PRIVATE_ENV_FILE]: "not json" }),
    )).toThrow(PassengerEnvironmentError);
    expect(() => loadPrivateEnvironmentFile(
      "/apps/mk8dx",
      ioWith({ [PASSENGER_PRIVATE_ENV_FILE]: JSON.stringify(["x"]) }),
    )).toThrow(/one JSON object/);
    expect(() => loadPrivateEnvironmentFile(
      "/apps/mk8dx",
      ioWith({
        [PASSENGER_PRIVATE_ENV_FILE]: JSON.stringify({ PATH: "/evil" }),
      }),
    )).toThrow(/MK8DX_HOSTED_\* string values/);
    expect(() => loadPrivateEnvironmentFile(
      "/apps/mk8dx",
      ioWith({
        [PASSENGER_PRIVATE_ENV_FILE]:
          JSON.stringify({ MK8DX_HOSTED_MYSQL_PORT: 3306 }),
      }),
    )).toThrow(/MK8DX_HOSTED_\* string values/);
    expect(loadPrivateEnvironmentFile("/apps/mk8dx", nothingExists)).toEqual({});
  });
});
