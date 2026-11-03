// Select-a-Ghost panel's last look. When the RF-DETR detector sees no lap
// circles (the ghost's character badge shining through the translucent panel
// right behind them), the circles 1-2-3 are found by shape: grey template
// matching over several sizes, a vertical column at an even pitch. Templates
// and search settings come from the recognition pack
// (mk8dx.lap-circle-templates.v1, tooling/recognition/build_lap_circle_templates.py).
// Same arithmetic as the APK's LapCircleFinder.java.
import { cv } from './cv';
import type { Detection } from './types';

export const LAP_CIRCLE_TEMPLATES_FILE = 'lap-circle-templates-v1.json';

export interface LapCircleTemplates {
  size: number;
  templates: Uint8Array[];
  search: {
    minRelativeSize: number; maxRelativeSize: number; sizeStep: number; workSize: number;
    pitchMin: number; pitchMax: number; pitchStep: number; neighbourWindow: number;
    seedPeaks: number; seedMinScore: number; minScore: number;
  };
}

export interface LapCircleColumn {
  /** centre x, centre y and size of circles 1, 2, 3 in the input's pixels */
  circles: [number, number, number][];
  score: number;
}

export function parseLapCircleTemplates(document: any): LapCircleTemplates {
  if (document?.schema !== 'mk8dx.lap-circle-templates.v1') throw new Error('Expected a mk8dx.lap-circle-templates.v1 document');
  const size = Number(document.size);
  const templates = ['1', '2', '3'].map((digit) => Uint8Array.from(atob(String(document.templates[digit])), (c) => c.charCodeAt(0)));
  if (templates.some((t) => t.length !== size * size)) throw new Error('lap-circle template size mismatch');
  return { size, templates, search: document.search };
}

/** The best 1-2-3 column in a BGR Mat, or null when none reaches the pack's minimum score. */
export function findLapCircles(bgr: any, pack: LapCircleTemplates): LapCircleColumn | null {
  const c = cv();
  const s = pack.search;
  const work = s.workSize;
  const grey = new c.Mat();
  const tmpl: any[] = [];
  try {
    c.cvtColor(bgr, grey, c.COLOR_BGR2GRAY);
    for (const bytes of pack.templates) {
      const raw = c.matFromArray(pack.size, pack.size, c.CV_8UC1, Array.from(bytes));
      const asFloat = new c.Mat();
      raw.convertTo(asFloat, c.CV_32F);
      raw.delete();
      const scaled = new c.Mat();
      c.resize(asFloat, scaled, new c.Size(work, work), 0, 0, c.INTER_AREA);
      asFloat.delete();
      tmpl.push(scaled);
    }
    const w = grey.cols;
    const h = grey.rows;
    let best: LapCircleColumn | null = null;
    for (let rel = s.minRelativeSize; rel <= s.maxRelativeSize; rel *= s.sizeStep) {
      const size = rel * w;
      const scale = work / size;
      const small = new c.Mat();
      const smallFloat = new c.Mat();
      c.resize(grey, small, new c.Size(Math.max(work + 1, Math.round(w * scale)), Math.max(work + 1, Math.round(h * scale))), 0, 0, c.INTER_AREA);
      small.convertTo(smallFloat, c.CV_32F);
      small.delete();
      const response = tmpl.map((t) => {
        const r = new c.Mat();
        c.matchTemplate(smallFloat, t, r, c.TM_CCOEFF_NORMED);
        return r;
      });
      smallFloat.delete();
      const seeds = response[0].clone();
      for (let peak = 0; peak < s.seedPeaks; peak++) {
        const top = c.minMaxLoc(seeds);
        if (top.maxVal < s.seedMinScore) break;
        const x1 = top.maxLoc.x;
        const y1 = top.maxLoc.y;
        c.rectangle(seeds, new c.Point(x1 - Math.trunc(work / 2), y1 - Math.trunc(work / 2)),
          new c.Point(x1 + Math.trunc(work / 2), y1 + Math.trunc(work / 2)), new c.Scalar(-1), -1);
        for (let pitchFactor = s.pitchMin; pitchFactor <= s.pitchMax + 1e-9; pitchFactor += s.pitchStep) {
          const pitch = pitchFactor * work;
          const found: [number, number, number][] = [];
          let inside = true;
          for (let d = 1; d <= 2 && inside; d++) {
            const yy = Math.round(y1 + d * pitch);
            const y0 = yy - s.neighbourWindow;
            const y1b = yy + s.neighbourWindow + 1;
            const x0 = x1 - s.neighbourWindow;
            const x1b = x1 + s.neighbourWindow + 1;
            if (y0 < 0 || y1b > response[d].rows || x0 < 0 || x1b > response[d].cols) { inside = false; break; }
            const region = response[d].roi(new c.Rect(x0, y0, x1b - x0, y1b - y0));
            const local = c.minMaxLoc(region);
            region.delete();
            found.push([local.maxVal, x0 + local.maxLoc.x, y0 + local.maxLoc.y]);
          }
          if (!inside) continue;
          const score = Math.min(top.maxVal, found[0][0], found[1][0]);
          if (!best || score > best.score) {
            const points: [number, number][] = [[x1, y1], [found[0][1], found[0][2]], [found[1][1], found[1][2]]];
            best = { circles: points.map(([x, y]) => [(x + work / 2) / scale, (y + work / 2) / scale, size]), score };
          }
        }
      }
      seeds.delete();
      for (const r of response) r.delete();
    }
    return best && best.score >= s.minScore ? best : null;
  } finally {
    grey.delete();
    for (const t of tmpl) t.delete();
  }
}

/** The column as lap_index detections in the input's normalized space (one circle-sized box each). */
export function lapCircleDetections(column: LapCircleColumn, width: number, height: number): Detection[] {
  return column.circles.map(([x, y, size]) => ({
    label: 'lap_index', score: column.score,
    left: Math.max(0, (x - size / 2) / width), top: Math.max(0, (y - size / 2) / height),
    right: Math.min(1, (x + size / 2) / width), bottom: Math.min(1, (y + size / 2) / height),
  }));
}
