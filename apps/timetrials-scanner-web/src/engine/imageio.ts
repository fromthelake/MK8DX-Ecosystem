// Beeld-in/uit voor de engine: decoderen (EXIF-bewust), normaliseren naar de
// analyse-ruimte (port van MainActivity.canonicalLandscape) en PNG/JPEG-encoding
// van crops voor de resultaatweergave. Werkt in worker én hoofddraad.
import type { Frame, LayoutProfile } from './types';

/** Saved-photo research routes. Camera frames already arrive in analysis space. */
export type SavedFramePreparation = 'current' | 'portrait-center' | 'portrait-full';
export type SavedFrameCandidatePreparation = SavedFramePreparation | 'portrait-auto';

/** Orientation is only a capture property; scan success still needs in-game
 * card/badge evidence before the auto route selects a result. */
export async function isPortraitSavedImage(blob: Blob): Promise<boolean> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(blob);
  }
  const portrait = bitmap.height > bitmap.width;
  bitmap.close();
  return portrait;
}

export async function blobToFrame(blob: Blob, layout: LayoutProfile): Promise<Frame> {
  // 'from-image': EXIF-oriëntatie toepassen (eis §39). De APK negeert EXIF bij
  // galerij-import (BitmapFactory.decodeStream); voor de 58 poortframes (geen
  // EXIF-rotatie) is dit identiek, voor telefoonfoto's een verbetering.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch {
    bitmap = await createImageBitmap(blob);
  }
  return bitmapToFrame(bitmap, layout);
}

/** Opt-in comparison with the live portrait camera's centered 4:3 analysis
 * crop. A portrait photo of an upright game screen must stay upright. */
export async function blobToPreparedFrame(blob: Blob, layout: LayoutProfile, preparation: SavedFramePreparation): Promise<Frame> {
  if (preparation === 'current' || layout === 'ghost_detail') return blobToFrame(blob, layout);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch {
    bitmap = await createImageBitmap(blob);
  }
  const w = bitmap.width;
  const h = bitmap.height;
  if (h <= w) return bitmapToFrame(bitmap, layout);
  const targetH = preparation === 'portrait-center' ? Math.round(w * 3 / 4) : h;
  const offsetY = Math.round((h - targetH) / 2);
  const canvas = new OffscreenCanvas(w, targetH);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, offsetY, w, targetH, 0, 0, w, targetH);
  bitmap.close();
  const data = ctx.getImageData(0, 0, w, targetH);
  return { width: w, height: targetH, rgba: data.data };
}

export function bitmapToFrame(bitmap: ImageBitmap, layout: LayoutProfile): Frame {
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, w, h);
  return canonicalLandscape({ width: w, height: h, rgba: data.data }, layout);
}

/** Port van MainActivity.canonicalLandscape (analysisRotationDegrees=0 voor
 *  galerij/burst-frames): staande beelden 90° kloksgewijs draaien, behalve in
 *  ghost_detail-stand (het paneel is zelf staand). */
export function canonicalLandscape(frame: Frame, layout: LayoutProfile): Frame {
  if (frame.width >= frame.height || layout === 'ghost_detail') {
    return frame;
  }
  return rotate90Clockwise(frame);
}

export function rotate90Clockwise(frame: Frame): Frame {
  const { width: w, height: h, rgba } = frame;
  const out = new Uint8ClampedArray(w * h * 4);
  // (x,y) in bron -> (h-1-y, x) in doel (doel is h breed, w hoog)
  const dw = h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const dx = h - 1 - y;
      const dy = x;
      const di = (dy * dw + dx) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return { width: h, height: w, rgba: out };
}

export async function frameToDataUrl(frame: Frame, type: 'image/jpeg' | 'image/png' = 'image/jpeg', quality = 0.85): Promise<string> {
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height), 0, 0);
  const blob = await canvas.convertToBlob({ type, quality });
  return blobToDataUrl(blob);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** BGR-crop (Mat) -> PNG data-URL. */
export async function bgrMatToPngDataUrl(cvMod: any, mat: any): Promise<string> {
  const rgba = new cvMod.Mat();
  cvMod.cvtColor(mat, rgba, mat.channels() === 1 ? cvMod.COLOR_GRAY2RGBA : cvMod.COLOR_BGR2RGBA);
  const canvas = new OffscreenCanvas(rgba.cols, rgba.rows);
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows), 0, 0);
  rgba.delete();
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blobToDataUrl(blob);
}
