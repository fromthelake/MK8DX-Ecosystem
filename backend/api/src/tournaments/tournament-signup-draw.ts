import { createHash, randomBytes } from "node:crypto";

/**
 * The open sign-up draw (ADR-0222), reproducible by anyone from the published seed.
 *
 * Algorithm "mk8dx-signup-draw-sha256-fisher-yates-v1":
 *
 * 1. The entrants are the Player ids (`player.…`) of everyone still signed up at closing, sorted
 *    ascending by plain code-unit comparison.
 * 2. The seed is 64 lower-case hexadecimal characters (32 random bytes), drawn once at closing and
 *    published with the result.
 * 3. A counter starts at 0. A uniform number below `m` is taken by hashing the UTF-8 text
 *    `<seed>:<counter>` with SHA-256 (the counter in decimal), incrementing the counter, reading the
 *    first 6 bytes of the digest as a big-endian unsigned 48-bit integer `x`, and accepting
 *    `x mod m` only when `x < floor(2^48 / m) * m` (otherwise the next counter is tried).
 * 4. Fisher-Yates from the end: for `i` from `n - 1` down to `1`, take `j` uniform below `i + 1` and
 *    swap positions `i` and `j`.
 * 5. The resulting order is the draw: the first free places go on the list, everyone after them is
 *    on the waiting list in that order.
 */
export const SIGNUP_DRAW_ALGORITHM = "mk8dx-signup-draw-sha256-fisher-yates-v1";

const seedPattern = /^[0-9a-f]{64}$/;
const RANGE = 2 ** 48;

export function newSignupDrawSeed(): string {
  return randomBytes(32).toString("hex");
}

export function isSignupDrawSeed(value: string): boolean {
  return seedPattern.test(value);
}

/** The draw order of these entrants under this seed (the input order does not matter). */
export function signupDrawOrder(seed: string, playerIds: readonly string[]): readonly string[] {
  if (!seedPattern.test(seed)) { throw new RangeError("the draw seed must be 64 lower-case hex characters"); }
  const order = [...new Set(playerIds)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  let counter = 0;
  const uniform = (bound: number): number => {
    const limit = Math.floor(RANGE / bound) * bound;
    for (;;) {
      const digest = createHash("sha256").update(`${seed}:${counter}`, "utf8").digest();
      counter += 1;
      const value = digest.readUIntBE(0, 6);
      if (value < limit) { return value % bound; }
    }
  };
  for (let index = order.length - 1; index >= 1; index -= 1) {
    const other = uniform(index + 1);
    const held = order[index]!;
    order[index] = order[other]!;
    order[other] = held;
  }
  return order;
}
