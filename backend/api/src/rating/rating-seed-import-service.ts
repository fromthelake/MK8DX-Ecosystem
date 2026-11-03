// Phase 8 seed import: initialize established Players from the exact
// owner-supplied legacy transition seed (ADR-0154). Mu/sigma travel as the
// seed's exact decimal strings end to end; nothing is rounded or re-derived.

const decimalPattern = /^-?\d+\.\d+$/;
const legacyReferencePattern = /^[0-9]{1,10}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class RatingSeedImportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RatingSeedImportError";
  }
}

export type RatingSeedRow = Readonly<{
  legacyPlayerId: number;
  mu: string;
  sigma: string;
}>;

export type RatingSeedDocument = Readonly<{
  normalizedSeedSha256: string;
  rows: readonly RatingSeedRow[];
}>;

export type RatingSeedMappingEntry = Readonly<{
  legacyPlayerId: number;
  playerId: string;
}>;

export type RatingSeedImportReport = Readonly<{
  sourceReference: string;
  seedRows: number;
  mappedRows: number;
  imported: number;
  skippedAlreadyImported: number;
  unmappedLegacyPlayerIds: readonly number[];
}>;

export interface RatingSeedImportTransaction {
  findActiveHumanPlayerInternalId(playerId: string): Promise<number | null>;
  hasSeedIdentity(input: Readonly<{
    sourceSystem: string;
    sourcePlayerReference: string;
  }>): Promise<boolean>;
  hasRating(playerInternalId: number): Promise<boolean>;
  insertSeededRating(input: Readonly<{
    playerInternalId: number;
    mu: string;
    sigma: string;
    sourceReference: string;
    sourceSystem: string;
    sourcePlayerReference: string;
    sourceSnapshotSha256: string;
    nowMs: number;
  }>): Promise<void>;
}

export interface RatingSeedImportRepository {
  transaction<T>(
    work: (transaction: RatingSeedImportTransaction) => Promise<T>,
  ): Promise<T>;
}

export const RATING_SEED_SOURCE_SYSTEM = "mariokart8.nl";

export class RatingSeedImportService {
  public constructor(
    private readonly repository: RatingSeedImportRepository,
    private readonly clock: Readonly<{ nowMs(): number }>,
  ) {}

  public async importSeed(
    seed: RatingSeedDocument,
    mapping: readonly RatingSeedMappingEntry[],
  ): Promise<RatingSeedImportReport> {
    if (!/^[a-f0-9]{64}$/.test(seed.normalizedSeedSha256)) {
      throw new RatingSeedImportError("seed document hash is missing");
    }
    const rows = new Map<number, RatingSeedRow>();
    for (const row of seed.rows) {
      if (!Number.isSafeInteger(row.legacyPlayerId) || row.legacyPlayerId < 1 ||
        !decimalPattern.test(row.mu) || !decimalPattern.test(row.sigma) ||
        Number(row.sigma) <= 0 || rows.has(row.legacyPlayerId)) {
        throw new RatingSeedImportError(
          `seed row for legacy id ${row.legacyPlayerId} is invalid`,
        );
      }
      rows.set(row.legacyPlayerId, row);
    }
    const targets = new Map<number, string>();
    const usedPlayers = new Set<string>();
    for (const entry of mapping) {
      if (!rows.has(entry.legacyPlayerId) ||
        !playerIdPattern.test(entry.playerId) ||
        targets.has(entry.legacyPlayerId) || usedPlayers.has(entry.playerId)) {
        throw new RatingSeedImportError(
          `mapping entry for legacy id ${entry.legacyPlayerId} is invalid ` +
          "(unknown legacy id, malformed player id, or duplicate)",
        );
      }
      targets.set(entry.legacyPlayerId, entry.playerId);
      usedPlayers.add(entry.playerId);
    }

    const sourceReference =
      `${RATING_SEED_SOURCE_SYSTEM}#${seed.normalizedSeedSha256.slice(0, 16)}`;
    const nowMs = this.clock.nowMs();
    let imported = 0;
    let skipped = 0;
    for (const [legacyPlayerId, playerId] of targets) {
      const row = rows.get(legacyPlayerId)!;
      const outcome = await this.repository.transaction(async (transaction) => {
        const sourcePlayerReference = String(legacyPlayerId);
        if (!legacyReferencePattern.test(sourcePlayerReference)) {
          throw new RatingSeedImportError("legacy reference is invalid");
        }
        if (await transaction.hasSeedIdentity({
          sourceSystem: RATING_SEED_SOURCE_SYSTEM,
          sourcePlayerReference,
        })) {
          return "skipped" as const;
        }
        const playerInternalId =
          await transaction.findActiveHumanPlayerInternalId(playerId);
        if (playerInternalId === null) {
          throw new RatingSeedImportError(
            `mapped Player for legacy id ${legacyPlayerId} does not exist ` +
            "or is not an active human Player",
          );
        }
        if (await transaction.hasRating(playerInternalId)) {
          throw new RatingSeedImportError(
            `mapped Player for legacy id ${legacyPlayerId} already has a ` +
            "rating that did not come from this seed",
          );
        }
        await transaction.insertSeededRating({
          playerInternalId,
          mu: row.mu,
          sigma: row.sigma,
          sourceReference,
          sourceSystem: RATING_SEED_SOURCE_SYSTEM,
          sourcePlayerReference,
          sourceSnapshotSha256: seed.normalizedSeedSha256,
          nowMs,
        });
        return "imported" as const;
      });
      if (outcome === "imported") {
        imported += 1;
      } else {
        skipped += 1;
      }
    }
    const unmapped = [...rows.keys()]
      .filter((legacyPlayerId) => !targets.has(legacyPlayerId))
      .sort((a, b) => a - b);
    return {
      sourceReference,
      seedRows: rows.size,
      mappedRows: targets.size,
      imported,
      skippedAlreadyImported: skipped,
      unmappedLegacyPlayerIds: unmapped,
    };
  }
}
