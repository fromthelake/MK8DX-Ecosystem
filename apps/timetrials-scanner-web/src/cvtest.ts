// Diagnostische pagina: start de minimale cv-worker (window.mk8CvTest).
const worker = new Worker(new URL('./cvworker.ts', import.meta.url), { type: 'module' });
(window as any).mk8CvTest = (step: string) => new Promise((resolve) => {
  worker.onmessage = (e) => resolve(e.data);
  worker.onerror = (e) => resolve({ ok: false, err: `worker error ${e.message}` });
  worker.postMessage({ step });
});
