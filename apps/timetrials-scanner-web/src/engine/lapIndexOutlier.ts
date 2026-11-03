// The lap-index badge clean-up: the central specification (packages/icon-matcher sharedDetections,
// the same rules as Android and Python; CENTRAL_RECOGNITION section 8.6, phase 5). These wrappers
// keep the runner's { detections, removed } shape.
import type { Detection } from './types';
import { weakDuplicateLapIndex, weakLapIndexOutlier, weakOffLatticeLapIndex } from '../../../../packages/icon-matcher/ts/sharedDetections';

type Cleanup = { detections: Detection[]; removed: Detection | null };

function apply(detections: Detection[], removed: Detection | null): Cleanup {
  return removed ? { detections: detections.filter((d) => d !== removed), removed } : { detections, removed: null };
}

/** One weak off-column badge from an otherwise strong six-row screen. */
export function removeWeakLapIndexOutlier(detections: Detection[]): Cleanup {
  return apply(detections, weakLapIndexOutlier(detections));
}

/** One duplicate badge, only when both three-row cards remain supported. */
export function removeWeakDuplicateLapIndex(detections: Detection[]): Cleanup {
  return apply(detections, weakDuplicateLapIndex(detections));
}

/** Two complete three-lap badge lattices with one weak extra box. */
export function removeWeakOffLatticeLapIndex(detections: Detection[]): Cleanup {
  return apply(detections, weakOffLatticeLapIndex(detections));
}
