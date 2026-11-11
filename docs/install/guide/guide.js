"use strict";
// MK8DX guide: show only the steps for the reader's computer and device, search, open/close, print.
// No inline script or style anywhere (the setup wizard serves this page under a strict CSP).
(function () {
  const STORE = "mk8dx-guide-choice";
  const ua = (navigator.userAgent || "").toLowerCase();
  const platform = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "").toLowerCase();
  const guessComputer = () => (platform.includes("win") || ua.includes("windows")) ? "windows"
    : (platform.includes("mac") || ua.includes("mac os")) && !ua.includes("iphone") && !ua.includes("ipad") ? "macos"
      : (platform.includes("linux") || ua.includes("linux")) && !ua.includes("android") ? "linux" : "all";
  const guessDevice = () => ua.includes("android") ? "android" : (ua.includes("iphone") || ua.includes("ipad")) ? "iphone" : "all";

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (error) { saved = {}; }
  const state = { os: saved.os || guessComputer(), device: saved.device || guessDevice() };

  function visible(element) {
    const classes = Array.from(element.classList);
    const systems = classes.filter((name) => name.startsWith("os-")).map((name) => name.slice(3));
    const devices = classes.filter((name) => name.startsWith("device-")).map((name) => name.slice(7));
    const systemOk = state.os === "all" || systems.length === 0 || systems.includes(state.os);
    const deviceOk = state.device === "all" || devices.length === 0 || devices.includes(state.device);
    return systemOk && deviceOk;
  }

  function apply() {
    document.querySelectorAll(".filtered").forEach((element) => { element.hidden = !visible(element); });
    document.querySelectorAll("[data-os]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.os === state.os));
    });
    document.querySelectorAll("[data-device]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.device === state.device));
    });
    // A chapter for another computer is hidden; so is its line in the contents.
    document.querySelectorAll(".toc a").forEach((link) => {
      const target = document.getElementById(link.getAttribute("href").slice(1));
      link.parentElement.hidden = Boolean(target && target.hidden);
    });
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (error) { /* private window */ }
    search();
  }

  function search() {
    const input = document.getElementById("search");
    const query = (input ? input.value : "").trim().toLowerCase();
    let found = 0;
    document.querySelectorAll("details.chapter").forEach((chapter) => {
      if (chapter.classList.contains("filtered") && !visible(chapter)) return;
      if (!query) { chapter.classList.remove("no-match"); found += 1; return; }
      const match = chapter.textContent.toLowerCase().includes(query);
      chapter.classList.toggle("no-match", !match);
      if (match) { chapter.open = true; found += 1; }
    });
    const nothing = document.getElementById("nothing");
    if (nothing) nothing.hidden = found > 0;
  }

  function setAll(open) { document.querySelectorAll("details.chapter").forEach((chapter) => { chapter.open = open; }); }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-os]").forEach((button) => button.addEventListener("click", () => {
      state.os = button.dataset.os; apply();
    }));
    document.querySelectorAll("[data-device]").forEach((button) => button.addEventListener("click", () => {
      state.device = button.dataset.device; apply();
    }));
    const input = document.getElementById("search");
    if (input) input.addEventListener("input", search);
    const open = document.getElementById("open-all");
    if (open) open.addEventListener("click", () => setAll(true));
    const close = document.getElementById("close-all");
    if (close) close.addEventListener("click", () => setAll(false));
    const print = document.getElementById("print");
    if (print) print.addEventListener("click", () => { setAll(true); window.print(); });
    window.addEventListener("beforeprint", () => setAll(true));
    // A link from the contents opens its chapter.
    document.querySelectorAll(".toc a").forEach((link) => link.addEventListener("click", () => {
      const target = document.getElementById(link.getAttribute("href").slice(1));
      if (target) target.open = true;
    }));
    // On a phone the contents start closed, so the guide itself is on the first screen.
    const toc = document.getElementById("toc");
    if (toc && window.matchMedia("(max-width: 860px)").matches) toc.open = false;
    apply();
  });
})();
