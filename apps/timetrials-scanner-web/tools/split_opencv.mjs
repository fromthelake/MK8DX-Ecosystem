// Splitst de single-file OpenCV.js-distributie in JavaScript en WASM.
//
// De 4.10-distributie gebruikt een base64-data-URI; 5.0 gebruikt een
// binaryDecode-literal. De worker haalt in beide gevallen een losse WASM
// op. De OpenCV-binary blijft bytegelijk; de afgeleide bestanden in public/cv
// blijven buiten Git.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const src = path.join(webRoot, 'node_modules', '@techstark', 'opencv-js', 'dist', 'opencv.js');
const outDir = path.join(webRoot, 'public', 'cv');

const text = await fs.readFile(src, 'utf8');
const marker = 'var wasmBinaryFile="data:application/octet-stream;base64,';
const start = text.indexOf(marker);
let wasm;
let patched;
let patch;
if (start >= 0) {
  const b64start = start + marker.length;
  const b64end = text.indexOf('"', b64start);
  wasm = Buffer.from(text.slice(b64start, b64end), 'base64');
  patched = text.slice(0, start) + 'var wasmBinaryFile=(typeof self!=="undefined"&&self.MK8_OPENCV_WASM_URL)||"opencv_js.wasm"' + text.slice(b64end + 1);
  const locate = 'if(!isDataURI(wasmBinaryFile)){wasmBinaryFile=locateFile(wasmBinaryFile)}';
  if (!patched.includes(locate)) throw new Error('locateFile-patchpunt niet gevonden');
  patched = patched.replace(locate, 'if(!isDataURI(wasmBinaryFile)&&!/^(https?:|blob:|\\/)/.test(wasmBinaryFile)){wasmBinaryFile=locateFile(wasmBinaryFile)}');
  patched = patched.replace('}(this, function () {', '}(typeof self !== "undefined" ? self : this, function () {');
  patch = ['wasm data-URI -> opencv_js.wasm (locateFile)', 'UMD root this -> self'];
} else {
  // OpenCV.js 5 embeds a binaryDecode('...') literal instead of base64.
  const embedded = 'function findWasmBinary(){return binaryDecode(';
  const begin = text.indexOf(embedded);
  if (begin < 0) throw new Error('ingebedde wasm niet gevonden in opencv.js');
  const quote = begin + embedded.length;
  if (text[quote] !== "'") throw new Error('onverwacht wasm-literal');
  let end = quote + 1;
  for (; end < text.length; end += 1) {
    if (text[end] === '\\') { end += 1; continue; }
    if (text[end] === "'") break;
  }
  if (text.slice(end, end + 3) !== "')}")
    throw new Error('onverwacht wasm-einde');
  const literal = vm.runInNewContext(text.slice(quote, end + 1), Object.create(null), { timeout: 5000 });
  wasm = Buffer.alloc(literal.length);
  for (let index = 0; index < literal.length; index += 1) {
    const code = literal.charCodeAt(index);
    wasm[index] = (~code >> 8) & code;
  }
  patched = text.slice(0, begin) + 'function findWasmBinary(){return (typeof self!=="undefined"&&self.MK8_OPENCV_WASM_URL)||"opencv_js.wasm"}' + text.slice(end + 3);
  const sync = 'function getBinarySync(file){return file}';
  if (!patched.includes(sync)) throw new Error('getBinarySync-patchpunt niet gevonden');
  patched = patched.replace(sync, 'async function getBinarySync(file){if(file instanceof Uint8Array)return file;const response=await fetch(file);if(!response.ok)throw new Error("WASM HTTP "+response.status);return new Uint8Array(await response.arrayBuffer())}');
  patch = ['binaryDecode literal -> opencv_js.wasm', 'fetch absolute wasm URL'];
}
if (wasm.subarray(0, 8).toString('hex') !== '0061736d01000000')
  throw new Error('ongeldig wasm-magic');
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'opencv_js.wasm'), wasm);
await fs.writeFile(path.join(outDir, 'opencv.js'), patched);
const pkg = JSON.parse(await fs.readFile(path.join(webRoot, 'node_modules', '@techstark', 'opencv-js', 'package.json'), 'utf8'));
await fs.writeFile(path.join(outDir, 'PROVENANCE.json'), JSON.stringify({ source: '@techstark/opencv-js', version: pkg.version, opencv: pkg.version.split('-')[0], source_bytes: text.length, wasm_bytes: wasm.length, js_bytes: patched.length, patch }, null, 1));
console.log(`opencv gesplitst: js ${(patched.length / 1e6).toFixed(1)} MB, wasm ${(wasm.length / 1e6).toFixed(1)} MB -> ${outDir}`);
