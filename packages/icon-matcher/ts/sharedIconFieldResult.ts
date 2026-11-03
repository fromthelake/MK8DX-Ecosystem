/** The same post-ROI visual trace as Python visual_field_result. */
import type { IconTensorMatch } from './sharedIconScorer';

export interface VisualFieldRead {
  schema: 'mk8dx.visual-field-read.v1';
  kind: 'characters' | 'bodies' | 'tires' | 'gliders' | 'flags';
  profile: 'result' | 'scoreboard' | 'ghost_select';
  method: 'rgb';
  catalogSha256: string;
  cropPixelSha256: string;
  status: 'accepted' | 'unknown';
  top1Id: string;
  acceptedId: string | null;
  score: number;
  margin: number;
  familyMargin?: number | null;
  offset: [number, number];
  top: { id: string; familyId: string; score: number }[];
}

const SHA = /^[0-9a-f]{64}$/;
export async function visualFieldResult(match: IconTensorMatch, cropBgr: any,
  kind: VisualFieldRead['kind'], profile: VisualFieldRead['profile'],
  catalogSha256: string): Promise<VisualFieldRead> {
  if (!SHA.test(catalogSha256) || !cropBgr || cropBgr.empty() || cropBgr.channels() !== 3
      || !match.top.length || match.top[0].id !== match.top1Id
      || !Number.isFinite(match.score) || !Number.isFinite(match.margin)
      || (match.status === 'accepted') !== (match.acceptedId !== null)) {
    throw new Error('Invalid visual field read');
  }
  // A Mat ROI can have a parent-row stride. Its data view may have the
  // expected length while skipping actual ROI rows, so hash a dense copy.
  const dense = cropBgr.clone();
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const bgr = dense.data as Uint8Array;
    if (bgr.length !== cropBgr.cols * cropBgr.rows * 3) {
      throw new Error('Expected contiguous BGR crop pixels');
    }
    bytes = new Uint8Array(bgr.length);
    bytes.set(bgr);
  } finally {
    dense.delete();
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const cropPixelSha256 = Array.from(new Uint8Array(digest),
    (value) => value.toString(16).padStart(2, '0')).join('');
  return { schema: 'mk8dx.visual-field-read.v1', kind, profile, method: 'rgb',
    catalogSha256, cropPixelSha256, status: match.status, top1Id: match.top1Id,
    acceptedId: match.acceptedId, score: match.score, margin: match.margin,
    familyMargin: match.familyMargin,
    offset: match.offset, top: match.top };
}
