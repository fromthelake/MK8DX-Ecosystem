/** OpenCV.js bridge for an already verified BGR icon crop.
 *
 * The source adapter chooses the crop, kind and game-art profile. Keep its
 * presence/geometry/context decision separate from this pixel normalization.
 */
import { searchFlagWindow, type FlagWindowRead } from './sharedFlagWindow';
import { matchIconTensor, matchIconTensorCenter,
  type IconTensorGroup, type IconTensorMatch } from './sharedIconScorer';

export function normalizeCvBgrCrop(cv: any, cropBgr: any, width: number, height: number): Float32Array {
  if (!cropBgr || cropBgr.empty() || cropBgr.channels() !== 3
      || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Expected nonempty BGR crop and canonical dimensions');
  }
  const resized = new cv.Mat();
  const rgb = new cv.Mat();
  try {
    cv.resize(cropBgr, resized, new cv.Size(width, height), 0, 0, cv.INTER_AREA);
    cv.cvtColor(resized, rgb, cv.COLOR_BGR2RGB);
    const bytes = rgb.data as Uint8Array;
    if (bytes.length !== width * height * 3) throw new Error('Unexpected normalized icon channels');
    const result = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) result[i] = bytes[i] / 255;
    return result;
  } finally {
    rgb.delete();
    resized.delete();
  }
}

export function matchCvBgrCrop(cv: any, cropBgr: any, group: IconTensorGroup,
  searchMode: 'center_shortlist' | 'center_then_shortlist' = 'center_shortlist'): IconTensorMatch {
  return matchIconTensor(normalizeCvBgrCrop(cv, cropBgr, group.width, group.height), group, searchMode);
}

export interface TireWindowRead {
  match: IconTensorMatch;
  cropXywh: [number, number, number, number];
  basis: 'fixed_slot' | 'window_search';
  evaluated: number;
}

/** Opt-in tire geometry: one fixed slot, then the bounded padded window. */
export function matchCvBgrTireWindow(cv: any, windowBgr: any,
  slotXywh: [number, number, number, number], group: IconTensorGroup,
  step = 2): TireWindowRead {
  if (!windowBgr || windowBgr.empty() || windowBgr.channels() !== 3
      || !Array.isArray(slotXywh) || slotXywh.length !== 4
      || !slotXywh.every(Number.isInteger) || ![1, 2, 4].includes(step)) {
    throw new Error('Expected BGR tire window, integer slot and bounded step');
  }
  const [x, y, width, height] = slotXywh;
  if (width < 4 || height < 4 || x < 0 || y < 0
      || x + width > windowBgr.cols || y + height > windowBgr.rows
      || windowBgr.cols - width > 20 || windowBgr.rows - height > 20) {
    throw new Error('Tire slot must fit its bounded padded window');
  }
  const at = (left: number, top: number): IconTensorMatch => {
    const crop = windowBgr.roi(new cv.Rect(left, top, width, height));
    try {
      return matchIconTensorCenter(normalizeCvBgrCrop(cv, crop, group.width, group.height), group);
    } finally {
      crop.delete();
    }
  };
  const centered = at(x, y);
  if (centered.status === 'accepted') {
    return { match: centered, cropXywh: [x, y, width, height], basis: 'fixed_slot', evaluated: 1 };
  }
  let best: TireWindowRead | null = null;
  let evaluated = 1;
  for (let top = 0; top <= windowBgr.rows - height; top += step) {
    for (let left = 0; left <= windowBgr.cols - width; left += step) {
      const match = at(left, top);
      evaluated++;
      if (!best || match.score > best.match.score) {
        best = { match, cropXywh: [left, top, width, height],
          basis: 'window_search', evaluated };
      }
    }
  }
  if (!best) throw new Error('Empty bounded tire search');
  return { ...best, evaluated };
}

/** The central flag-window search (sharedFlagWindow) on an OpenCV.js BGR window. */
export function matchCvBgrFlagWindow(cv: any, windowBgr: any,
  slotXywh: [number, number, number, number], group: IconTensorGroup): FlagWindowRead {
  if (!windowBgr || windowBgr.empty() || windowBgr.channels() !== 3) throw new Error('Expected a BGR flag window');
  return searchFlagWindow(windowBgr.cols, windowBgr.rows, slotXywh, (left, top, width, height) => {
    const crop = windowBgr.roi(new cv.Rect(left, top, width, height));
    try {
      return matchIconTensorCenter(normalizeCvBgrCrop(cv, crop, group.width, group.height), group).score;
    } finally {
      crop.delete();
    }
  });
}
