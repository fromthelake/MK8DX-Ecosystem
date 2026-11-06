// OpenCV.js uit de gepinde scannerdependency; de Android-versie wordt
// afzonderlijk via de gelijkbron-herkenningspoort gekwalificeerd.
// De WASM-build draait dezelfde C++-implementatie van CLAHE, Canny, HoughLinesP,
// warpPerspective, matchTemplate enz. — daarom niet herschreven in TS: dat zou
// pariteitsrisico introduceren zonder winst (eis §7/§16).
//
// Laadpad: /cv/opencv.js + /cv/opencv_js.wasm, afgeleid door
// tools/split_opencv.mjs. De 5.x-wrapper levert eerst een Promise op.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any;

let cvInstance: CV | null = null;
let loading: Promise<CV> | null = null;

export async function loadCv(base = '/cv/'): Promise<CV> {
  if (cvInstance) return cvInstance;
  if (!loading) {
    loading = (async () => {
      const origin = typeof location !== 'undefined' ? location.origin : '';
      const cvBase = base.startsWith('http') ? base : `${origin}${base}`;
      const g = globalThis as any;
      // gepatchte build (tools/split_opencv.mjs) leest de absolute wasm-URL hieruit
      g.MK8_OPENCV_WASM_URL = `${cvBase}opencv_js.wasm`;
      await import(/* @vite-ignore */ `${cvBase}opencv.js`);
      const start = performance.now();
      let candidate = g.cv;
      // OpenCV.js 5 exports a Promise for its initialized module.
      if (candidate && typeof candidate.then === 'function' && typeof candidate.Mat !== 'function') {
        candidate = await candidate;
        g.cv = candidate;
      }
      while (!candidate || typeof candidate.Mat !== 'function') {
        await new Promise((r) => setTimeout(r, 25));
        candidate = g.cv;
        if (performance.now() - start > 60000) throw new Error('OpenCV.js initialiseerde niet binnen 60 s');
      }
      // Het Emscripten-Module is een thenable dat zichzélf oplevert: een promise
      // die ermee resolvet (bv. de return van deze async functie) roept then()
      // oneindig aan -> event loop geblokkeerd, renderer-crash. Daarom `then`
      // verwijderen zodra de runtime klaar is (bekende Emscripten-workaround).
      if (typeof candidate.then === 'function') {
        try {
          delete candidate.then;
        } catch {
          candidate.then = undefined;
        }
      }
      cvInstance = candidate;
      return candidate;
    })();
  }
  return loading;
}

export function cv(): CV {
  if (!cvInstance) throw new Error('OpenCV nog niet geladen');
  return cvInstance;
}

/** RGBA-pixels -> BGR 8UC3 Mat (Android: bitmapToMat -> RGBA2BGR). */
export function rgbaToBgrMat(rgba: Uint8ClampedArray, width: number, height: number): any {
  const c = cv();
  const rgbaMat = c.matFromArray(height, width, c.CV_8UC4, rgba);
  const bgr = new c.Mat();
  c.cvtColor(rgbaMat, bgr, c.COLOR_RGBA2BGR);
  rgbaMat.delete();
  return bgr;
}

/** RGBA-pixels -> grijs 8UC1 Mat (Android: RGBA2GRAY). */
export function rgbaToGrayMat(rgba: Uint8ClampedArray, width: number, height: number): any {
  const c = cv();
  const rgbaMat = c.matFromArray(height, width, c.CV_8UC4, rgba);
  const gray = new c.Mat();
  c.cvtColor(rgbaMat, gray, c.COLOR_RGBA2GRAY);
  rgbaMat.delete();
  return gray;
}

/** BGR-Mat -> RGBA-pixels (voor tensoren, crops, weergave). */
export function bgrMatToRgba(mat: any): { rgba: Uint8ClampedArray; width: number; height: number } {
  const c = cv();
  const rgba = new c.Mat();
  if (mat.channels() === 1) {
    c.cvtColor(mat, rgba, c.COLOR_GRAY2RGBA);
  } else {
    c.cvtColor(mat, rgba, c.COLOR_BGR2RGBA);
  }
  const out = new Uint8ClampedArray(rgba.data);
  const w = rgba.cols;
  const h = rgba.rows;
  rgba.delete();
  return { rgba: out, width: w, height: h };
}

/**
 * Copy of a rectangle of `mat`. The temporary ROI view is deleted here: an
 * undeleted view keeps the whole parent buffer alive after the parent's own
 * delete(), which leaked the input and canonical images on every frame.
 */
export function cropClone(mat: any, x: number, y: number, width: number, height: number): any {
  const c = cv();
  const view = mat.roi(new c.Rect(x, y, width, height));
  try {
    return view.clone();
  } finally {
    view.delete();
  }
}

export function clampInt(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Java float (32-bit) semantiek voor Box/Detection-coördinaten. */
export const f32 = Math.fround;

export function matStd(gray: any): number {
  const c = cv();
  const mean = new c.Mat();
  const std = new c.Mat();
  c.meanStdDev(gray, mean, std);
  const v = std.rows > 0 ? std.data64F[0] : 0.0;
  mean.delete();
  std.delete();
  return v;
}
