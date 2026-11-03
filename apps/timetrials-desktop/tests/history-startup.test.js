"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the dashboard's actual History loader with a server that becomes
// ready after the first status check, as happens during an automatic restart.
const source = fs.readFileSync(path.join(__dirname, "../dashboard/app.js"), "utf8");
const start = source.indexOf("function reloadHistory(");
const end = source.indexOf("async function startApp()", start);
assert.ok(start >= 0 && end > start);
// reloadHistory navigates through navigateFrame, which swaps in a fresh clone
// of the iframe (so a reload adds no browser-history entry): load it too.
const navStart = source.indexOf("function navigateFrame(");
const navEnd = source.indexOf("\n}", navStart) + 2;
assert.ok(navStart >= 0 && navEnd > navStart);

// A minimal iframe: src is an attribute, cloneNode(false) copies it and
// replaceWith puts the clone where the selector finds it.
function makeFrame(initial) {
  let value = initial;
  return {
    getAttribute: name => name === "src" ? value : null,
    removeAttribute: name => { if (name === "src") value = null; },
    set src(next) { value = next; },
    cloneNode: () => makeFrame(value),
    replaceWith: fresh => { nodes["#history-frame"] = fresh; },
  };
}
const frame = makeFrame("http://127.0.0.1:8777/old-error");
let loadingHidden = true;
const loading = {classList: {toggle: (_name, hidden) => { loadingHidden = hidden; }}, textContent: ""};
const panel = {classList: {contains: name => name === "active"}};
let nextStatus = {historyReady: false};
const nodes = {"#history-frame": frame, "#history-loading": loading, "#history-panel": panel};
const context = vm.createContext({
  $: selector => nodes[selector],
  historyManagedByApp: true,
  appStatus: {historyReady: false},
  historyUrl: "http://127.0.0.1:8777/",
  language: "nl",
  tr: (_en, nl) => nl,
  action: async () => nextStatus,
  renderCaptureBar: () => {},
});
vm.runInContext(source.slice(navStart, navEnd) + source.slice(start, end), context);

const currentSrc = () => nodes["#history-frame"].getAttribute("src");

async function main() {
  vm.runInContext("reloadHistory(true)", context);
  assert.equal(currentSrc(), null, "History must not retain a failed iframe during startup");
  assert.equal(loadingHidden, false);

  nextStatus = {historyReady: true};
  await vm.runInContext("pollApp()", context);
  assert.match(currentSrc(), /^http:\/\/127\.0\.0\.1:8777\/\?view=history&/);
  assert.equal(loadingHidden, true);

  nextStatus = {historyReady: false};
  await vm.runInContext("pollApp()", context);
  assert.equal(currentSrc(), null, "History must wait again while capture replaces its server");

  vm.runInContext("historyManagedByApp = false; reloadHistory(true)", context);
  assert.match(currentSrc(), /^http:\/\/127\.0\.0\.1:8777\/\?view=history&/,
    "the standalone dashboard retains its existing History route");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
