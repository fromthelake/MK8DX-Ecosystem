// Splitst node_modules/@techstark/opencv-js/dist/opencv.js (single-file,
// wasm als base64 ingebed) in public/cv/opencv.js + public/cv/opencv_js.wasm.
//
// Reden: de ingebedde data-URI-variant initialiseert in Chromium wél in het
// venster maar hangt in een (module- én classic-)worker; met een losse .wasm
// via fetch/instantiateStreaming werkt de worker-route. De OpenCV-code zelf
// (4.10.0) blijft byte-gelijk; alleen het laadpad en de UMD-root (self i.p.v.
// this) worden gepatcht. Afgeleid bestand -> niet in git (public/cv ignored).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const src = path.join(webRoot, 'node_modules', '@techstark', 'opencv-js', 'dist', 'opencv.js');
const outDir = path.join(webRoot, 'public', 'cv');

const text = await fs.readFile(src, 'utf8');
const marker = 'var wasmBinaryFile="data:application/octet-stream;base64,';
const start = text.indexOf(marker);
if (start < 0) throw new Error('data-URI wasm niet gevonden in opencv.js');
const b64start = start + marker.length;
const b64end = text.indexOf('"', b64start);
const b64 = text.slice(b64start, b64end);
const wasm = Buffer.from(b64, 'base64');
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'opencv_js.wasm'), wasm);
// absolute wasm-URL via self.MK8_OPENCV_WASM_URL (de UMD-wrapper maakt zijn
// eigen lege Module, dus Module.locateFile is van buiten niet te zetten)
let patched = text.slice(0, start) + 'var wasmBinaryFile=(typeof self!=="undefined"&&self.MK8_OPENCV_WASM_URL)||"opencv_js.wasm"' + text.slice(b64end + 1);
const locate = 'if(!isDataURI(wasmBinaryFile)){wasmBinaryFile=locateFile(wasmBinaryFile)}';
if (!patched.includes(locate)) throw new Error('locateFile-patchpunt niet gevonden');
patched = patched.replace(locate, 'if(!isDataURI(wasmBinaryFile)&&!/^(https?:|blob:|\\/)/.test(wasmBinaryFile)){wasmBinaryFile=locateFile(wasmBinaryFile)}');
// UMD-root: in een module-worker is `this` undefined -> op self zetten
patched = patched.replace('}(this, function () {', '}(typeof self !== "undefined" ? self : this, function () {');
await fs.writeFile(path.join(outDir, 'opencv.js'), patched);
const pkg = JSON.parse(await fs.readFile(path.join(webRoot, 'node_modules', '@techstark', 'opencv-js', 'package.json'), 'utf8'));
await fs.writeFile(path.join(outDir, 'PROVENANCE.json'), JSON.stringify({ source: '@techstark/opencv-js', version: pkg.version, opencv: '4.10.0', source_bytes: text.length, wasm_bytes: wasm.length, js_bytes: patched.length, patch: ['wasm data-URI -> opencv_js.wasm (locateFile)', 'UMD root this -> self'] }, null, 1));
console.log(`opencv gesplitst: js ${(patched.length / 1e6).toFixed(1)} MB, wasm ${(wasm.length / 1e6).toFixed(1)} MB -> ${outDir}`);
