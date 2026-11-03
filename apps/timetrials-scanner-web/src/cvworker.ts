// Diagnostische minimale worker: alleen OpenCV laden + één Mat maken.
import { loadCv } from './engine/cv';

self.onmessage = async (ev: MessageEvent) => {
  const t = performance.now();
  try {
    const step = ev.data?.step ?? 'cv';
    const c = await loadCv();
    const m = new c.Mat(4, 4, c.CV_8UC3, new c.Scalar(1, 2, 3));
    const hsv = new c.Mat();
    c.cvtColor(m, hsv, c.COLOR_BGR2HSV);
    let extra = '';
    if (step === 'ort') {
      const ort = await import('onnxruntime-web');
      extra = ` ort=${ort.env.versions?.web ?? 'geladen'}`;
    }
    (self as unknown as Worker).postMessage({ ok: true, ms: Math.round(performance.now() - t), hsv: Array.from(hsv.data.slice(0, 3)), extra });
  } catch (exc) {
    (self as unknown as Worker).postMessage({ ok: false, err: exc instanceof Error ? `${exc.message}\n${exc.stack}` : String(exc) });
  }
};
