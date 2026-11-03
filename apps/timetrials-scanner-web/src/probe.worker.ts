// Audit-hulpworker: één schakel van de scanner-keten op zichzelf, in een weggooi-worker (daarna beëindigd).
//   opencv    — OpenCV.js laden + kleine bewerking (cvtColor/threshold), heapgrootte
//   pack      — assetpakket (index + pack) ophalen en de index controleren
//   decode    — testbeeld ophalen en als ImageBitmap decoderen (zoals de scan-invoer)
//   tesseract — Tesseract-worker (geneste worker) starten met eng en een gerenderde regel lezen
import { loadCv } from './engine/cv';
import { createWorker, PSM } from 'tesseract.js';

type Req = { kind: 'opencv' | 'pack' | 'decode' | 'tesseract'; base: string };

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { kind, base } = ev.data;
  const log = (message: string) => postMessage({ type: 'log', message });
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  try {
    if (kind === 'opencv') {
      const cv = await loadCv(`${base}cv/`);
      log(`OpenCV geladen in ${ms()} ms`);
      const src = new cv.Mat(64, 64, cv.CV_8UC3, new cv.Scalar(10, 200, 30, 0));
      const gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_BGR2GRAY);
      const bin = new cv.Mat();
      cv.threshold(gray, bin, 100, 255, cv.THRESH_BINARY);
      const nz = cv.countNonZero(bin);
      src.delete(); gray.delete(); bin.delete();
      const heap = Math.round(((cv as any).HEAPU8?.byteLength ?? 0) / 1048576);
      if (nz !== 64 * 64) throw new Error(`cvtColor/threshold gaf ${nz} i.p.v. 4096 pixels`);
      postMessage({ type: 'done', result: `OpenCV geladen, cvtColor+threshold OK, heap ${heap} MB, ${ms()} ms` });
      return;
    }
    if (kind === 'pack') {
      const idx = await fetch(`${base}assets/pack/engine_assets.index.json`);
      if (!idx.ok) throw new Error(`index ${idx.status}`);
      const index = await idx.json();
      const entries = typeof index?.entries === 'number' ? index.entries : Object.keys(index?.files ?? {}).length;
      const expectBytes = Number(index?.bytes ?? 0);
      const r = await fetch(`${base}assets/pack/engine_assets.pack`);
      if (!r.ok) throw new Error(`pack ${r.status}`);
      const bytes = (await r.arrayBuffer()).byteLength;
      if (expectBytes && bytes !== expectBytes) throw new Error(`pack ${bytes} bytes, index verwacht ${expectBytes} (cache verouderd of upload onvolledig?)`);
      const mf = await fetch(`${base}assets/assets_manifest.json`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      const modelBytes = Number(mf?.files?.['model/inference_model.onnx']?.bytes ?? 0);
      postMessage({ type: 'done', result: `index ${entries} bestanden, pack ${Math.round(bytes / 1048576 * 10) / 10} MB, manifest model ${Math.round(modelBytes / 1048576)} MB, ${ms()} ms` });
      return;
    }
    if (kind === 'decode') {
      const blob = await fetch(`${base}assets/demo_frames/demo_1_zand.jpg`).then((r) => { if (!r.ok) throw new Error(`testbeeld ${r.status}`); return r.blob(); });
      let how = 'from-image';
      let bmp: ImageBitmap;
      try {
        bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      } catch {
        how = 'zonder opties';
        bmp = await createImageBitmap(blob);
      }
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      const nonzero = px.some((v) => v !== 0);
      const { width, height } = bmp;
      bmp.close();
      if (!nonzero) throw new Error('gedecodeerd beeld is leeg');
      postMessage({ type: 'done', result: `${width}x${height} gedecodeerd (${how}), ${Math.round(blob.size / 1024)} kB, pixels OK, ${ms()} ms` });
      return;
    }
    if (kind === 'tesseract') {
      const worker = await createWorker('eng', 1, {
        workerPath: `${base}tess/worker.min.js`,
        corePath: `${base}tess/tesseract-core-simd-lstm.wasm.js`,
        langPath: `${base}tessdata`,
        gzip: false,
        cacheMethod: 'none',
        workerBlobURL: false,
        logger: () => undefined,
      });
      log(`Tesseract-worker (eng) gestart in ${ms()} ms`);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, preserve_interword_spaces: '1' });
      const c = new OffscreenCanvas(260, 60);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 260, 60);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText('MK8 123', 12, 44);
      const png = await c.convertToBlob({ type: 'image/png' });
      const t1 = performance.now();
      const res = await worker.recognize(png);
      const text = (res.data.text ?? '').trim();
      await worker.terminate();
      const okText = /123/.test(text);
      postMessage({ type: 'done', result: `gelezen "${text}" (${okText ? 'bevat 123' : 'verwacht 123 — OCR-uitvoer afwijkend'}), herkenning ${Math.round(performance.now() - t1)} ms, totaal ${ms()} ms` });
      return;
    }
    throw new Error(`onbekende probe ${kind}`);
  } catch (exc) {
    postMessage({ type: 'error', message: exc instanceof Error ? `${exc.name}: ${exc.message}` : String(exc) });
  }
};
