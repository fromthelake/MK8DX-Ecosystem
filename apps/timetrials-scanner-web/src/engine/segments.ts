// 7-segment-lezing: de centrale cijfermatcher (packages/icon-matcher sharedSegmentDigits,
// dezelfde specificatie als Python en Java). Hier alleen het laden van het sjabloon uit de
// assets; de rest komt ongewijzigd uit het gedeelde pakket.
import type { AssetSource } from './assets';
import { SegmentTemplate, segmentTemplateFromRgba } from '../../../../packages/icon-matcher/ts/sharedSegmentDigits';

export {
  SEGMENT_KEYS, SegmentTemplate, bestSegmentCandidate, canonicalSegmentSlotSize, compareCandidates,
  decodePattern, segmentScores, segmentTemplateFromRgba,
} from '../../../../packages/icon-matcher/ts/sharedSegmentDigits';
export type { PointI, SegmentCandidate, SegmentKey } from '../../../../packages/icon-matcher/ts/sharedSegmentDigits';

export async function readSegmentTemplate(source: AssetSource, path: string): Promise<SegmentTemplate> {
  const img = await source.image(path);
  return segmentTemplateFromRgba(img.rgba, img.width, img.height);
}
