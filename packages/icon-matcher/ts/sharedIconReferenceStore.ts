/** Lazy, hash-checked reference tensors for a source-specific ROI adapter.
 *
 * The pack is generated from the pinned Clean Assets schema-9 database. The
 * source supplies bytes; no private artwork or report is checked into Git.
 */
import type { IconTensorGroup } from './sharedIconScorer';
import { partRelationKey, type PartContextReferences, type PartKind } from './sharedPartContext';

interface TensorSpec { file: string; sha256: string; bytes: number }
interface GroupSpec {
  kind: string;
  profile: string;
  size: [number, number];
  ids: string[];
  families: string[];
  tensors: { rgb: TensorSpec; mask: TensorSpec; count: TensorSpec };
}
interface ReferenceManifest {
  schema: string;
  catalogSha256: string;
  context?: { schema: string; partForCharacter: [PartKind, string, string, string][];
    tireByIndex: [number, string][] };
  groups: Record<string, GroupSpec>;
}
export interface IconReferenceSource {
  json<T>(path: string): Promise<T>;
  bytes(path: string): Promise<ArrayBuffer>;
}

const SHA = /^[0-9a-f]{64}$/;
function safeFile(name: string): boolean {
  return /^[a-z0-9_.-]+$/.test(name) && name !== '.' && name !== '..';
}
async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export class SharedIconReferenceStore {
  private readonly loaded = new Map<string, Promise<IconTensorGroup>>();
  private partContext: Promise<PartContextReferences> | null = null;
  private constructor(private readonly source: IconReferenceSource,
    private readonly prefix: string, private readonly manifest: ReferenceManifest) {}

  get catalogSha256(): string { return this.manifest.catalogSha256; }

  static async create(source: IconReferenceSource, prefix: string,
    expectedCatalogSha256: string): Promise<SharedIconReferenceStore> {
    if (!/^[a-z0-9_/-]+$/.test(prefix) || prefix.includes('..') || prefix.startsWith('/')
        || !SHA.test(expectedCatalogSha256)) throw new Error('Invalid icon reference selection');
    const manifest = await source.json<ReferenceManifest>(`${prefix}/references.json`);
    if (manifest.schema !== 'mk8dx.shared-icon-references.v1'
        || manifest.catalogSha256 !== expectedCatalogSha256) {
      throw new Error('Shared icon catalog version mismatch');
    }
    return new SharedIconReferenceStore(source, prefix, manifest);
  }

  async get(kind: string, profile: string): Promise<IconTensorGroup> {
    const key = `${kind}__${profile}`;
    if (!this.loaded.has(key)) this.loaded.set(key, this.load(key));
    return this.loaded.get(key)!;
  }

  /** Catalog evidence for the optional text/character decision, never a label. */
  getPartContext(): Promise<PartContextReferences> {
    this.partContext ??= this.loadPartContext();
    return this.partContext;
  }

  private async loadPartContext(): Promise<PartContextReferences> {
    const metadata = this.manifest.context;
    if (metadata?.schema !== 'mk8dx.part-context.v1'
        || !Array.isArray(metadata.partForCharacter)
        || !Array.isArray(metadata.tireByIndex)) {
      throw new Error('Missing pinned part context in reference selection');
    }
    const [characters, bodies, gliders, tires] = await Promise.all([
      this.get('characters', 'result'), this.get('bodies', 'result'),
      this.get('gliders', 'result'), this.get('tires', 'result'),
    ]);
    const groups = new Map<PartKind, IconTensorGroup>([
      ['bodies', bodies], ['gliders', gliders], ['tires', tires],
    ]);
    const familyById = new Map<string, string>();
    for (const group of [characters, bodies, gliders, tires]) {
      group.ids.forEach((id, index) => {
        const family = group.families[index];
        if (familyById.has(id) && familyById.get(id) !== family) {
          throw new Error(`Conflicting icon family: ${id}`);
        }
        familyById.set(id, family);
      });
    }
    const resultMembers = new Map<PartKind, readonly { id: string; familyId: string }[]>();
    for (const [kind, group] of groups) {
      resultMembers.set(kind, group.ids.map((id, index) =>
        ({ id, familyId: group.families[index] })));
    }
    const characterIds = new Set(characters.ids);
    const partForCharacter = new Map<string, string>();
    for (const row of metadata.partForCharacter) {
      if (!Array.isArray(row) || row.length !== 4) throw new Error('Invalid part relation');
      const [kind, family, character, part] = row;
      if (!['bodies', 'gliders'].includes(kind) || typeof family !== 'string'
          || typeof character !== 'string' || typeof part !== 'string'
          || !(characterIds.has(character) || /^character\.mii_(light|medium|heavy)$/.test(character))
          || familyById.get(part) !== family
          || !groups.get(kind)?.ids.includes(part)) {
        throw new Error('Part relation differs from reference groups');
      }
      const key = partRelationKey(kind, family, character);
      if (partForCharacter.has(key) && partForCharacter.get(key) !== part) {
        throw new Error('Conflicting part relation');
      }
      partForCharacter.set(key, part);
    }
    const tireByIndex = new Map<number, string>();
    for (const row of metadata.tireByIndex) {
      if (!Array.isArray(row) || row.length !== 2 || !Number.isSafeInteger(row[0])
          || row[0] < 0 || typeof row[1] !== 'string' || !tires.ids.includes(row[1])
          || tireByIndex.has(row[0])) throw new Error('Invalid tire index relation');
      tireByIndex.set(row[0], row[1]);
    }
    return { familyById, resultMembers, partForCharacter, tireByIndex };
  }

  private async load(key: string): Promise<IconTensorGroup> {
    const group = this.manifest.groups[key];
    if (!group || `${group.kind}__${group.profile}` !== key || !Array.isArray(group.size)
        || group.size.length !== 2 || !group.size.every((value) => Number.isInteger(value) && value > 0)
        || !Array.isArray(group.ids) || group.ids.length < 2
        || !Array.isArray(group.families) || group.ids.length !== group.families.length) {
      throw new Error(`Missing or invalid shared icon group ${key}`);
    }
    const read = async (spec: TensorSpec): Promise<ArrayBuffer> => {
      if (!spec || !safeFile(spec.file) || !SHA.test(spec.sha256)
          || !Number.isInteger(spec.bytes) || spec.bytes < 1) throw new Error('Invalid icon tensor entry');
      const bytes = await this.source.bytes(`${this.prefix}/${spec.file}`);
      if (bytes.byteLength !== spec.bytes || await sha256(bytes) !== spec.sha256) {
        throw new Error(`Shared icon tensor checksum mismatch: ${spec.file}`);
      }
      return bytes;
    };
    const [rgb, mask, count] = await Promise.all([
      read(group.tensors.rgb), read(group.tensors.mask), read(group.tensors.count),
    ]);
    const [width, height] = group.size;
    const references = group.ids.length;
    if (rgb.byteLength !== references * width * height * 3 * 4
        || mask.byteLength !== references * width * height
        || count.byteLength !== references * 4) {
      throw new Error(`Shared icon tensor shape mismatch: ${key}`);
    }
    return { width, height, ids: group.ids, families: group.families,
      rgb: new Float32Array(rgb), mask: new Uint8Array(mask), count: new Float32Array(count) };
  }
}
