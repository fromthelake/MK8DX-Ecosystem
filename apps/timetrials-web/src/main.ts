import { startAppearance } from "./appearance-runtime.js";
import { mountAuthenticationProductPage } from "./authentication-product-page.js";
import { installDutchUiCopy } from "./dutch-ui-copy.js";
import { loadProductCatalog } from "./product-catalog.js";
import { parseProductLanguage, productLanguage, usesProductCatalog } from "./product-language.js";
import { requestSiteBackdrop } from "./site-backdrop.js";
import { registerProductServiceWorker } from "./web-push-settings.js";


const root = document.getElementById("app");
if (!(root instanceof HTMLElement)) {
  throw new Error("The Time Trials application root is unavailable.");
}

// The design-system component gallery (Checkpoint 1) exists only on development and the QA mirror.
// The module name is built at run time so the release bundler never resolves or includes it; on a
// hosted release the import fails and the ordinary product starts.
const galleryRequested = new URLSearchParams(window.location.search).has("design-gallery");
const galleryModule = ["./ds", "gallery.js"].join("-");

function startProduct(root: HTMLElement): void {
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
