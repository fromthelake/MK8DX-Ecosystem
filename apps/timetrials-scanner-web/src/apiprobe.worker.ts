// Audit-hulpworker: welke worker-API's de engine-worker op dit toestel heeft.
// Een eigen bestand in plaats van een blob:-worker, zodat de scanner-CSP geen worker-src blob: nodig heeft (#34).
self.onmessage = () => {
  const r: Record<string, unknown> = { offscreen: typeof OffscreenCanvas !== 'undefined', bitmap: typeof createImageBitmap === 'function', sab: typeof SharedArrayBuffer !== 'undefined', isolated: self.crossOriginIsolated, nested: typeof Worker !== 'undefined' };
  try {
    const c = new OffscreenCanvas(4, 4);
    r.ctx2d = !!c.getContext('2d');
    r.toBlob = typeof c.convertToBlob === 'function';
  } catch (e) {
    r.ctx2d = 'ERR ' + (e as Error).message;
  }
  postMessage(r);
};
