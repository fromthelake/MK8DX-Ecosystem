import { describe, expect, it } from "vitest";

import { searchOfHref } from "../src/authentication-product-page.js";

describe("an in-app link's route", () => {
  it("keeps the fragment out of the last parameter", () => {
    // A notification's "Open" is /?player=x#interactions; the Player is x, not "x#interactions".
    expect(new URLSearchParams(searchOfHref("/?player=player.ben#interactions")).get("player")).toBe("player.ben");
    expect(searchOfHref("/?notifications=1")).toBe("?notifications=1");
    expect(searchOfHref("/")).toBe("");
    expect(searchOfHref("/#top")).toBe("");
  });
});
