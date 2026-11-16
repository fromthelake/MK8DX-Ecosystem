import { startAppearance } from "./appearance-runtime.js";
import { mountAuthenticationProductPage } from "./authentication-product-page.js";
import { installDutchUiCopy } from "./dutch-ui-copy.js";
import { loadProductCatalog } from "./product-catalog.js";
import { adoptBrowserLanguages, parseProductLanguage, productLanguage, usesProductCatalog } from "./product-language.js";
import { requestSiteBackdrop } from "./site-backdrop.js";
import { registerProductServiceWorker } from "./web-push-settings.js";
import { stepUpAwareFetch } from "./step-up-client.js";
import { confirmWithEmailLink } from "./step-up-dialog.js";


const root = document.getElementById("app");
if (!(root instanceof HTMLElement)) {
  throw new Error("The Time Trials application root is unavailable.");
}

// The design-system component gallery (Checkpoint 1) exists only on development and the QA mirror.
// The module name is built at run time so the release bundler never resolves or includes it; on a
// hosted release the import fails and the ordinary product starts.
const galleryRequested = new URLSearchParams(window.location.search).has("design-gallery");
const galleryModule = ["./ds", "gallery.js"].join("-");

// A dangerous administrator action may first need a fresh e-mail confirmation (step-up). Every request
// the product makes goes through this one fetch, so each such action gets the same dialog and is repeated
// once after confirmation; every other answer passes through untouched.
function installStepUp(): void {
  const pageFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = stepUpAwareFetch(
    pageFetch,
    () => confirmWithEmailLink({ fetcher: pageFetch }),
    window.location.origin,
  ) as typeof globalThis.fetch;
}

function startProduct(root: HTMLElement): void {
  installStepUp();
  // The head boot script already painted the chosen profile; this adopts the same record so the
  // running page and the DOM cannot drift apart (ADR-0205).
  startAppearance();
  mountAuthenticationProductPage(root);
  installDutchUiCopy(document);
  requestSiteBackdrop();
  void registerProductServiceWorker();
}

// A link may carry the product language (`?lang=de`); it becomes the stored choice, as Settings would make it.
const linkedLanguage = parseProductLanguage(new URLSearchParams(window.location.search).get("lang"));
if (linkedLanguage !== null) {
  try { window.localStorage.setItem("mk8dx.product-language.v1", linkedLanguage); } catch { /* the page still shows it */ }
  document.documentElement.setAttribute("lang", linkedLanguage);
}

// No explicit choice yet: follow the browser's languages (a Dutch phone opens in Dutch). Nothing is stored, so the
// language menu and Settings stay the only way to make a lasting choice.
adoptBrowserLanguages(navigator.languages?.length ? navigator.languages : [navigator.language]);

// Every language except English and Dutch reads its text from a catalog, fetched once before the first
// render (product-catalog.ts); without it the page stays English rather than failing.
const catalogReady: Promise<unknown> = usesProductCatalog() ? loadProductCatalog(productLanguage()) : Promise.resolve();

if (galleryRequested) {
  import(/* @vite-ignore */ galleryModule)
    .then((gallery: { mountDesignGallery(host: HTMLElement): void }) => gallery.mountDesignGallery(root))
    .catch(() => startProduct(root));
} else {
  void catalogReady.then(() => startProduct(root));
}
