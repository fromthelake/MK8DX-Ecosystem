// The MK8DX pattern photo behind the page weighs 669 KB and sits under
// gradients that cover 94-98% of it: measured against a screenshot without
// it, it changes the average pixel by 0.74 of 255. Asking for it during the
// landing is what made the signed-out Home feel slow. On an emulated
// mid-range phone it delayed the largest paint from 2.8s to 1.8s at 4 Mbit,
// and from 6.0s to 2.7s at 1.6 Mbit, because it competed for bandwidth with
// the hero logo - which is the element the browser actually measures.
//
// Nothing about the picture changes, only when it is asked for. The
// stylesheet carries the photo layer behind this class; without it the same
// gradients render over the flat background they already sit on.
export const SITE_BACKDROP_CLASS = "site-photo-ready";

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void, options?: { timeout: number },
  ) => number;
};

/**
 * Requests the decorative page photo once the landing has settled. Safe to
 * call at any point: a document that has already finished loading gets the
 * class immediately.
 */
export function requestSiteBackdrop(
  document_: Document = document,
  window_: Window = window,
): void {
  const adopt = (): void => {
    document_.documentElement.classList.add(SITE_BACKDROP_CLASS);
  };
  if (document_.readyState === "complete") {
    adopt();
    return;
  }
  window_.addEventListener("load", () => {
    const idle = (window_ as IdleWindow).requestIdleCallback;
    if (typeof idle === "function") {
      idle(adopt, { timeout: 2_000 });
    } else {
      window_.setTimeout(adopt, 200);
    }
  }, { once: true });
}
