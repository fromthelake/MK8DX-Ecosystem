// Asset-loader: leest de 1:1 gekopieerde APK-assets (public/assets, zie
// tools/sync_assets.mjs). PNG-decodering via ImageBitmap + OffscreenCanvas —
// hetzelfde premultiplied-alpha-pad als Android Bitmap -> bitmapToMat.
import { cv } from './cv';

export interface AssetSource {
  json<T = any>(path: string): Promise<T>;
  bytes(path: string): Promise<ArrayBuffer>;
  /** RGBA-pixels van een PNG/JPG (alpha behouden) */
  image(path: string): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }>;
  /** bestandsnamen in een icoonmap (listings.json, want de browser kan niet listen) */
  list(dir: string): Promise<string[]>;
}

export class FetchAssetSource implements AssetSource {
  private readonly base: string;
  private listings: Record<string, string[]> | null = null;
  private readonly cache = new Map<string, Promise<any>>();

  private packBuf: ArrayBuffer | null = null;
  private packIndex: Record<string, [number, number]> | null = null;

  constructor(base = '/assets/') {
    this.base = base.endsWith('/') ? base : base + '/';
  }

  private url(path: string): string {
    return this.base + path.replace(/^\//, '');
  }

  /** Pakketbestand (tools/sync_assets.mjs): één request i.p.v. ±1500; inhoud byte-identiek aan de losse bestanden.
   *  Mislukt het laden, dan blijven de losse bestanden het pad (zelfde bytes). */
  async loadPack(name = 'pack/engine_assets'): Promise<{ entries: number; bytes: number } | null> {
    try {
      const [index, buf] = await Promise.all([
        fetch(this.url(`${name}.index.json`)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
        fetch(this.url(`${name}.pack`)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))),
      ]);
      if (buf.byteLength !== index.bytes) throw new Error(`pakket onvolledig: ${buf.byteLength} != ${index.bytes}`);
      this.packIndex = index.files;
      this.packBuf = buf;
      return { entries: index.entries, bytes: index.bytes };
    } catch {
      this.packIndex = null;
      this.packBuf = null;
      return null;
    }
  }

  private packSlice(path: string): Uint8Array | null {
    if (!this.packBuf || !this.packIndex) return null;
    const e = this.packIndex[path.replace(/^\//, '')];
    return e ? new Uint8Array(this.packBuf, e[0], e[1]) : null;
  }

  async json<T = any>(path: string): Promise<T> {
    const key = 'json:' + path;
    if (!this.cache.has(key)) {
      const slice = this.packSlice(path);
      if (slice) this.cache.set(key, Promise.resolve(JSON.parse(new TextDecoder().decode(slice))));
      else this.cache.set(key, fetch(this.url(path)).then((r) => {
        if (!r.ok) throw new Error(`asset ontbreekt: ${path} (${r.status})`);
        return r.json();
      }));
    }
    return this.cache.get(key)!;
  }

  async bytes(path: string): Promise<ArrayBuffer> {
    const slice = this.packSlice(path);
    if (slice) return slice.slice().buffer as ArrayBuffer;
    const r = await fetch(this.url(path));
    if (!r.ok) throw new Error(`asset ontbreekt: ${path} (${r.status})`);
    return r.arrayBuffer();
  }

  async image(path: string): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
    const slice = this.packSlice(path);
    if (slice) return decodeImageBlob(new Blob([slice.slice().buffer as ArrayBuffer]));
    const r = await fetch(this.url(path));
    if (!r.ok) throw new Error(`asset ontbreekt: ${path} (${r.status})`);
    const blob = await r.blob();
    return decodeImageBlob(blob);
  }

  async list(dir: string): Promise<string[]> {
    if (!this.listings) {
      this.listings = await this.json<Record<string, string[]>>('listings.json');
    }
    return this.listings[dir.replace(/\/$/, '')] ?? [];
  }
}

export async function decodeImageBlob(blob: Blob): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return { rgba: data.data, width: data.width, height: data.height };
}

/** PNG -> BGR 8UC3 (Android: bitmapToMat -> RGBA2BGR). */
export async function loadBgr(source: AssetSource, path: string): Promise<any> {
  const c = cv();
  const img = await source.image(path);
  const rgba = c.matFromArray(img.height, img.width, c.CV_8UC4, img.rgba);
  const bgr = new c.Mat();
  c.cvtColor(rgba, bgr, c.COLOR_RGBA2BGR);
  rgba.delete();
  return bgr;
}

/** PNG -> grijs 8UC1 (Android: RGBA2GRAY). */
export async function loadGray(source: AssetSource, path: string): Promise<any> {
  const c = cv();
  const img = await source.image(path);
  const rgba = c.matFromArray(img.height, img.width, c.CV_8UC4, img.rgba);
  const gray = new c.Mat();
  c.cvtColor(rgba, gray, c.COLOR_RGBA2GRAY);
  rgba.delete();
  return gray;
}

/** PNG -> {bgr, alpha} (KartConfigMatcher.loadAssets: alpha-kanaal apart). */
export async function loadBgrAlpha(source: AssetSource, path: string): Promise<{ bgr: any; alpha: any }> {
  const c = cv();
  const img = await source.image(path);
  const rgba = c.matFromArray(img.height, img.width, c.CV_8UC4, img.rgba);
  const bgr = new c.Mat();
  c.cvtColor(rgba, bgr, c.COLOR_RGBA2BGR);
  rgba.delete();
  // Core.extractChannel(rgba, alpha, 3) — niet in OpenCV.js; handmatig kanaal 3
  const a = new Uint8Array(img.width * img.height);
  for (let i = 0; i < a.length; i++) a[i] = img.rgba[i * 4 + 3];
  const alpha = c.matFromArray(img.height, img.width, c.CV_8UC1, a);
  return { bgr, alpha };
}
