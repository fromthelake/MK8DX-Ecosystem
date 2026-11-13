// Audit-hulpworker: één wasm-heap in stappen laten groeien (en aanraken) tot het maximum of tot een fout.
// Een eigen bestand in plaats van een blob:-worker, zodat de scanner-CSP geen worker-src blob: nodig heeft (#34).
self.onmessage = (e: MessageEvent<{ stepMb: number; maxMb: number }>) => {
  const step = e.data.stepMb * 16;
  const max = e.data.maxMb * 16;
  let mem: WebAssembly.Memory;
  let pages = 0;
  try {
    mem = new WebAssembly.Memory({ initial: step, maximum: max });
    pages = step;
  } catch (err) {
    postMessage({ ok: false, mb: 0, err: String(err) });
    return;
  }
  let err = '';
  while (pages < max) {
    try {
      mem.grow(step);
      pages += step;
      new Uint8Array(mem.buffer).fill(1, (pages - step) * 65536, pages * 65536);
      postMessage({ progress: pages / 16 });
    } catch (error) {
      err = String(error);
      break;
    }
  }
  postMessage({ ok: true, mb: pages / 16, err });
};
