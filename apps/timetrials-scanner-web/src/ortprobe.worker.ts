// Audit-hulpworker: ONNX Runtime laden, model laden, 1 inferentie met n threads — in een eigen worker
// (zoals de engine) en daarna beëindigd door de audit, zodat de wasm-heap de pagina niet belast.
self.onmessage = async (ev: MessageEvent<{ threads: number; base: string }>) => {
  const { threads, base } = ev.data;
  const log = (message: string) => postMessage({ type: 'log', message });
  try {
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.wasmPaths = `${base}ort/`;
    ort.env.wasm.numThreads = threads;
    const t0 = performance.now();
    const r = await fetch(`${base}assets/model/inference_model.onnx`);
    if (!r.ok) throw new Error(`model ${r.status}`);
    const bytes = await r.arrayBuffer();
    log(`model ${Math.round(bytes.byteLength / 1048576)} MB in ${Math.round(performance.now() - t0)} ms`);
    const t1 = performance.now();
    const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all', intraOpNumThreads: threads, interOpNumThreads: 1 });
    log(`sessie in ${Math.round(performance.now() - t1)} ms`);
    const input = new Float32Array(3 * 704 * 704).fill(0.5);
    const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, 704, 704]) };
    const t2 = performance.now();
    const out = await session.run(feeds);
    const ms = Math.round(performance.now() - t2);
    const dims = out[session.outputNames[0]].dims.join('x');
    await session.release();
    postMessage({ type: 'done', result: `inferentie ${ms} ms, uitvoer ${dims}, threads ${threads} (in eigen worker)` });
  } catch (exc) {
    postMessage({ type: 'error', message: exc instanceof Error ? `${exc.name}: ${exc.message}` : String(exc) });
  }
};
