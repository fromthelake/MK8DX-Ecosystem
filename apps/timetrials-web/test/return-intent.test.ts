import { describe, expect, it } from "vitest";

import {
  returnIntentFromSearch,
  sanitizeReturnIntent,
  signInHref,
  withReturnIntent,
} from "../src/return-intent.js";

describe("return-intent contract", () => {
  it("accepts every product route a sign-in interrupts", () => {
    for (const route of [
      "/?apps=1",
      "/?settings=1",
      "/?notifications=1",
      "/?mystats=1",
      "/?cups=1",
      "/?ranking=timetrials",
      "/?records=1",
      "/?build=1",
      "/?community=1",
      "/?activity=1",
      "/?tournaments=1&operate=1",
      "/?tournaments=tournament.synthetic_night_01",
      "/?player=nova&tab=mastery",
      "/?leaderboard=track.mario_kart_stadium&mode=200",
      "/?admin=1",
      "/device?user_code=ABCD-1234",
    ]) {
      expect(sanitizeReturnIntent(route)).toBe(route);
    }
  });

  it("refuses everything that could leave the product or loop the sign-in", () => {
    for (const candidate of [
      null,
      undefined,
      "",
      "/",
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example/",
      "javascript:alert(1)",
      "/?signin=1",
      "/?welcome=1",
      "/?authError=1",
      "/?apps=1&return=%2F%3Fsettings%3D1",
      "/?unknown=1",
      "/?submit=1",
      "/?submit=1&track=track.mario_kart_stadium",
      "/?apps=<script>",
      "/?apps=1#fragment",
      "/device?user_code=../../etc",
      "/device?user_code=ABCD-1234&extra=1",
      "/devices?user_code=ABCD-1234",
      `/?player=${"a".repeat(700)}`,
    ]) {
      expect(sanitizeReturnIntent(candidate)).toBeNull();
    }
  });

  it("rebuilds the destination from parsed parts instead of echoing it", () => {
    expect(sanitizeReturnIntent("/?player=nova&tab=timetrials"))
      .toBe("/?player=nova&tab=timetrials");
    // Percent-noise that decodes to an allowed value is normalized.
    expect(sanitizeReturnIntent("/?apps=%31")).toBe("/?apps=1");
    // A comparison pair survives, in canonical form-encoded shape.
    expect(sanitizeReturnIntent("/?compare=player.a50,player.b60"))
      .toBe("/?compare=player.a50%2Cplayer.b60");
  });

  it("derives the intent from the interrupted route, not from sign-in routes", () => {
    expect(returnIntentFromSearch("?settings=1")).toBe("/?settings=1");
    expect(returnIntentFromSearch("?leaderboard=track.big_blue&mode=150"))
      .toBe("/?leaderboard=track.big_blue&mode=150");
    expect(returnIntentFromSearch("")).toBeNull();
    expect(returnIntentFromSearch("?signin=1")).toBeNull();
    expect(returnIntentFromSearch("?signin=1&return=%2F%3Fapps%3D1"))
      .toBe("/?apps=1");
    expect(returnIntentFromSearch("?authError=1&return=%2F%3Fsettings%3D1"))
      .toBe("/?settings=1");
    expect(
      returnIntentFromSearch("?signin=1&return=https%3A%2F%2Fevil.example"),
    ).toBeNull();
  });

  it("builds carrier links only for validated destinations", () => {
    expect(signInHref(null)).toBe("/?signin=1");
    expect(signInHref("/?apps=1")).toBe("/?signin=1&return=%2F%3Fapps%3D1");
    expect(withReturnIntent("/?welcome=1", null)).toBe("/?welcome=1");
    expect(withReturnIntent("/?welcome=1", "/?apps=1"))
      .toBe("/?welcome=1&return=%2F%3Fapps%3D1");
  });
});
