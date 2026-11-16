/**
 * A signed-out /device page on a local (A2) server waits while the phone signs in on the invitation page, often
 * in another tab. It leaves only a marker with an expiry here, never the device code or any credential, so the
 * invitation page (infrastructure/docker/offline-invite/app.js) can offer "Back to approving your app" (/device)
 * instead of the home page. The waiting page itself continues by itself once the session appears.
 */
export const PENDING_DEVICE_KEY = "mk8dx.pending-device.v1";
/** As long as an invitation stays valid. */
export const PENDING_DEVICE_LIFETIME_MS = 15 * 60_000;

export function rememberPendingDevice(now: number = Date.now()): void {
  try {
    globalThis.localStorage?.setItem(PENDING_DEVICE_KEY, String(now + PENDING_DEVICE_LIFETIME_MS));
  } catch { /* storage refused: the waiting page still continues by itself */ }
}

export function forgetPendingDevice(): void {
  try { globalThis.localStorage?.removeItem(PENDING_DEVICE_KEY); } catch { /* storage refused */ }
}
