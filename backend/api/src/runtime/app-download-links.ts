import { createHmac, randomBytes } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  opendir,
  readdir,
  realpath,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

// Short-lived static download links (opt-in).
//
// Some shared hosts put the Node application behind a proxy that refuses large
// responses: LiteSpeed/Passenger answers a 536 MB APK streamed through Node
// with its own small HTML error page. Files the web server serves itself have
// no such limit and support HTTP Range (resumable downloads). In this mode the
// authenticated file route does not stream; it links the stored file into
// `<directory>/<expiry>-<64 hex>/<fileName>` inside the web document root and
// redirects the signed-in browser there.
//
// Expiry is enforced where the file is served, not only by cleanup:
// - Each link folder holds its own `.htaccess` whose rewrite rule refuses every
//   request (403) once the web server's clock passes the folder's expiry. Apache
//   and LiteSpeed evaluate it per request, so an idle or stopped API process
//   does not extend a link. The rule has no IfModule guard: a server that
//   cannot apply it answers with an error rather than serving the file.
// - Independently, a bounded sweep removes expired folders at startup, on a
//   timer and before new links are made. This is the only bound on a web server
//   that ignores `.htaccess` (docs/install/B2_WEBHOSTING.md states the honest
//   maximum lifetime there).
//
// Links are reused: one folder per account, download and half-lifetime bucket,
// named by a server-keyed HMAC, so repeated clicks (from any API process with
// the same key) land on the same folder. A link stays usable for between half
// and the whole configured lifetime. The number of live folders has a hard
// cap. Only folder names this module makes are ever touched; the stored file
// is never removed or written.

export class AppDownloadLinkConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AppDownloadLinkConfigurationError";
  }
}

/** Every live link folder is in use; the caller answers 503 with Retry-After. */
export class AppDownloadLinkCapacityError extends Error {
  public constructor(public readonly retryAfterSeconds: number) {
    super("too many live app download links");
    this.name = "AppDownloadLinkCapacityError";
  }
}

export type AppDownloadLinkConfig = Readonly<{
  // The web server's document root; the link directory must lie inside it.
  documentRoot: string;
  // Where the short-lived link folders are created, e.g. `<docroot>/dl`.
  directory: string;
  // The public URL path of `directory`, e.g. `/dl`.
  urlPath: string;
  ttlMilliseconds: number;
  // Hard cap on live link folders in the link directory.
  maximumLinks: number;
}>;

export type AppDownloadLinkRequest = Readonly<{
  // The account the link is for; links are reused per account and download.
  subject: string;
  downloadId: string;
}>;

export type AppDownloadLinkSweep = Readonly<{
  removed: number;
  live: number;
  failed: number;
  // False when the sweep stopped at its entry bound before seeing everything.
  complete: boolean;
}>;

export type AppDownloadLinks = Readonly<{
  /**
   * Returns the public URL path of a link to `sourcePath`, reusing a live one
   * for the same request. `created` is false for a reused link.
   */
  create(sourcePath: string, fileName: string, request?: AppDownloadLinkRequest):
    Promise<Readonly<{ location: string; created: boolean }>>;
  // Removes expired link folders (bounded); never throws.
  removeExpired(): Promise<AppDownloadLinkSweep>;
  // Stops the cleanup timer, if one was started.
  close(): void;
}>;

export type AppDownloadLinkOptions = Readonly<{
  now?: () => number;
  // Server key for reusable folder names; the same in every API process. A
  // random per-process key is used when absent (reuse then stays per process).
  key?: Buffer;
  // How often the independent cleanup runs; 0 disables the timer (tests).
  sweepIntervalMs?: number;
  // Receives sweep results as numbers only.
  onSweep?: (sweep: AppDownloadLinkSweep) => void;
}>;

export const APP_DOWNLOAD_LINK_ENVIRONMENT = {
  documentRoot: "MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT",
  directory: "MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY",
  urlPath: "MK8DX_HOSTED_APP_DOWNLOAD_LINK_URL_PATH",
  ttlSeconds: "MK8DX_HOSTED_APP_DOWNLOAD_LINK_TTL_SECONDS",
  maximumLinks: "MK8DX_HOSTED_APP_DOWNLOAD_LINK_MAX_LINKS",
} as const;

const DEFAULT_TTL_SECONDS = 600;
const MINIMUM_TTL_SECONDS = 60;
const MAXIMUM_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_MAXIMUM_LINKS = 2_000;
const MAXIMUM_MAXIMUM_LINKS = 20_000;
const MAXIMUM_SWEEP_INTERVAL_MS = 60_000;
// Folders written by earlier versions: 64 hex, expired by modification time.
const legacyFolderPattern = /^[0-9a-f]{64}$/;
// Current folders: `<expiry, Unix seconds>-<64 hex>`.
const linkFolderPattern = /^([0-9]{10})-[0-9a-f]{64}$/;
const urlPathPattern = /^(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}){1,8}$/;
const fileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const subjectPattern = /^[A-Za-z0-9._-]{1,160}$/;

function isInside(parent: string, child: string): boolean {
  const between = relative(parent, child);
  return between.length > 0 && !between.startsWith("..") && !isAbsolute(between);
}

/**
 * Reads the optional static-link settings from the hosted environment.
 * Returns null when the mode is not configured; throws when it is configured
 * incompletely or inconsistently, so a typo never silently falls back to the
 * streaming route that the host cannot deliver.
 */
export function readAppDownloadLinkConfig(
  environment: Readonly<Record<string, string | undefined>>,
): AppDownloadLinkConfig | null {
  const value = (key: string): string | undefined => {
    const raw = environment[key];
    return raw === undefined || raw.length === 0 ? undefined : raw;
  };
  const names = APP_DOWNLOAD_LINK_ENVIRONMENT;
  const directoryValue = value(names.directory);
  const documentRootValue = value(names.documentRoot);
  const urlPathValue = value(names.urlPath);
  const ttlValue = value(names.ttlSeconds);
  const maximumValue = value(names.maximumLinks);
  if (directoryValue === undefined) {
    if (documentRootValue !== undefined || urlPathValue !== undefined ||
      ttlValue !== undefined || maximumValue !== undefined) {
      throw new AppDownloadLinkConfigurationError(
        `${names.directory} is required when any other app download link setting is set`,
      );
    }
    return null;
  }
  if (documentRootValue === undefined) {
    throw new AppDownloadLinkConfigurationError(
      `${names.documentRoot} is required with ${names.directory}`,
    );
  }
  if (!isAbsolute(directoryValue) || !isAbsolute(documentRootValue)) {
    throw new AppDownloadLinkConfigurationError(
      `${names.directory} and ${names.documentRoot} must be absolute paths`,
    );
  }
  const documentRoot = resolve(documentRootValue);
  const directory = resolve(directoryValue);
  if (!isInside(documentRoot, directory)) {
    throw new AppDownloadLinkConfigurationError(
      `${names.directory} must lie inside ${names.documentRoot}`,
    );
  }
  const urlPath = urlPathValue ??
    `/${relative(documentRoot, directory).split(sep).join("/")}`;
  if (!urlPathPattern.test(urlPath) || urlPath.split("/").some((part) => part === "." || part === "..")) {
    throw new AppDownloadLinkConfigurationError(
      `${names.urlPath} must be an absolute URL path such as /dl, without a trailing slash`,
    );
  }
  let ttlSeconds = DEFAULT_TTL_SECONDS;
  if (ttlValue !== undefined) {
    ttlSeconds = /^[0-9]{1,6}$/.test(ttlValue) ? Number(ttlValue) : Number.NaN;
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < MINIMUM_TTL_SECONDS ||
      ttlSeconds > MAXIMUM_TTL_SECONDS) {
      throw new AppDownloadLinkConfigurationError(
        `${names.ttlSeconds} must be a whole number of seconds from ` +
        `${MINIMUM_TTL_SECONDS} to ${MAXIMUM_TTL_SECONDS}`,
      );
    }
  }
  let maximumLinks = DEFAULT_MAXIMUM_LINKS;
  if (maximumValue !== undefined) {
    maximumLinks = /^[0-9]{1,5}$/.test(maximumValue) ? Number(maximumValue) : Number.NaN;
    if (!Number.isSafeInteger(maximumLinks) || maximumLinks < 1 || maximumLinks > MAXIMUM_MAXIMUM_LINKS) {
      throw new AppDownloadLinkConfigurationError(
        `${names.maximumLinks} must be a whole number from 1 to ${MAXIMUM_MAXIMUM_LINKS}`,
      );
    }
  }
  return { documentRoot, directory, urlPath, ttlMilliseconds: ttlSeconds * 1000, maximumLinks };
}

/** `YYYYMMDDHHMMSS` in this process's local time: what Apache/LiteSpeed `%{TIME}` compares. */
export function webServerTimeStamp(epochMs: number): string {
  const date = new Date(epochMs);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}${two(date.getMonth() + 1)}${two(date.getDate())}` +
    `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

/**
 * The per-folder rule: refuse every request once the web server's local time
 * is past the expiry, and keep the capability URL out of caches and indexes.
 */
export function linkFolderAccessRules(expiresAtMs: number): string {
  // The last second the link may still be requested; `%{TIME}` has 1 s resolution.
  const lastValid = webServerTimeStamp(expiresAtMs - 1_000);
  return [
    `# MK8DX app download link. Refused after ${new Date(expiresAtMs).toISOString()}.`,
    "# Written by the API; removed with this folder. Do not edit.",
    "RewriteEngine On",
    `RewriteCond %{TIME} >${lastValid}`,
    "RewriteRule ^ - [F]",
    "<IfModule mod_headers.c>",
    "Header always set Cache-Control \"private, no-store\"",
    "Header always set X-Robots-Tag \"noindex, nofollow\"",
    "Header always set Referrer-Policy \"no-referrer\"",
    "</IfModule>",
    "",
  ].join("\n");
}

async function removeLinkFolder(folder: string): Promise<void> {
  // Only plain files and links we made are expected inside. Anything else
  // (a nested directory) means this is not ours: leave the folder alone.
  const names = await readdir(folder);
  for (const name of names) {
    const stats = await lstat(join(folder, name));
    if (!stats.isFile() && !stats.isSymbolicLink()) {
      throw new Error("unexpected entry in a link folder");
    }
  }
  // The link first, the rule last: the stored file is never reachable without
  // its expiry rule. Unlinking a symlink or a hard link never touches the
  // stored file.
  for (const name of names.filter((entry) => entry !== ".htaccess")) {
    await unlink(join(folder, name));
  }
  if (names.includes(".htaccess")) { await unlink(join(folder, ".htaccess")); }
  await rmdir(folder);
}

/** Entries one sweep examines at most, so a crowded directory cannot stall a request. */
function sweepBound(maximumLinks: number): number {
  return maximumLinks * 2 + 1_000;
}

/**
 * Prepares the link directory (creating it when missing), refuses a directory
 * that is a symbolic link or resolves outside the document root, writes an
 * empty index page so the directory itself never lists, removes expired link
 * folders before the first request and starts the independent cleanup timer.
 */
export async function prepareAppDownloadLinks(
  config: AppDownloadLinkConfig,
  nowOrOptions: (() => number) | AppDownloadLinkOptions = {},
): Promise<AppDownloadLinks> {
  const options: AppDownloadLinkOptions = typeof nowOrOptions === "function"
    ? { now: nowOrOptions } : nowOrOptions;
  const now = options.now ?? Date.now;
  const key = options.key ?? randomBytes(32);
  if (key.length < 16) {
    throw new AppDownloadLinkConfigurationError("the app download link key is too short");
  }
  await mkdir(config.directory, { recursive: true });
  const stats = await lstat(config.directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new AppDownloadLinkConfigurationError(
      "the app download link directory must be a real directory, not a link",
    );
  }
  const realRoot = await realpath(config.documentRoot);
  const realDirectory = await realpath(config.directory);
  if (!isInside(realRoot, realDirectory)) {
    throw new AppDownloadLinkConfigurationError(
      "the app download link directory resolves outside the document root",
    );
  }
  const directory = config.directory;
  // A listing of the link directory would reveal live capability URLs on a
  // server whose directory listing is on: an index page answers instead.
  await writeFile(join(directory, "index.html"), "", { flag: "wx" }).catch(() => undefined);

  const bucketMs = Math.max(30_000, Math.floor(config.ttlMilliseconds / 2));
  let liveAtLastSweep = 0;
  let createdSinceSweep = 0;
  let lastSweepAtMs = Number.NEGATIVE_INFINITY;
  let running: Promise<AppDownloadLinkSweep> | null = null;

  async function sweep(): Promise<AppDownloadLinkSweep> {
    const current = now();
    const legacyCutoff = current - config.ttlMilliseconds;
    let removed = 0;
    let live = 0;
    let failed = 0;
    let examined = 0;
    let complete = true;
    try {
      const handle = await opendir(directory);
      try {
        for await (const entry of handle) {
          examined += 1;
          if (examined > sweepBound(config.maximumLinks)) { complete = false; break; }
          const name = entry.name;
          const matched = linkFolderPattern.exec(name);
          const legacy = matched === null && legacyFolderPattern.test(name);
          if (matched === null && !legacy) { continue; }
          const folder = join(directory, name);
          try {
            const folderStats = await lstat(folder);
            if (!folderStats.isDirectory()) { continue; }
            const expired = matched !== null
              ? Number(matched[1]) * 1_000 <= current
              : folderStats.mtimeMs <= legacyCutoff;
            if (!expired) { live += 1; continue; }
            await removeLinkFolder(folder);
            removed += 1;
          } catch {
            // Removed concurrently, not ours, or not removable now: counted and
            // retried by the next sweep. An expired folder still refuses
            // requests through its own rule.
            failed += 1;
          }
        }
      } finally {
        await handle.close().catch(() => undefined);
      }
    } catch {
      failed += 1;
      complete = false;
    }
    liveAtLastSweep = live;
    createdSinceSweep = 0;
    lastSweepAtMs = current;
    const result = { removed, live, failed, complete };
    try { options.onSweep?.(result); } catch { /* reporting never breaks cleanup */ }
    return result;
  }

  function removeExpired(): Promise<AppDownloadLinkSweep> {
    running ??= sweep().finally(() => { running = null; });
    return running;
  }

  await removeExpired();
  const intervalMs = options.sweepIntervalMs ??
    Math.min(MAXIMUM_SWEEP_INTERVAL_MS, Math.max(5_000, Math.floor(config.ttlMilliseconds / 4)));
  const timer = intervalMs > 0 ? setInterval(() => { void removeExpired(); }, intervalMs) : null;
  timer?.unref?.();
  // Before a new link, the live count must be recent enough to trust.
  const sweepBeforeCreateMs = intervalMs > 0 ? Math.min(intervalMs, bucketMs) : bucketMs;

  async function folderHoldsLink(folder: string, fileName: string): Promise<boolean> {
    try {
      const [entry, rules] = await Promise.all([
        lstat(join(folder, fileName)), lstat(join(folder, ".htaccess")),
      ]);
      return (entry.isFile() || entry.isSymbolicLink()) && rules.isFile();
    } catch {
      return false;
    }
  }

  return {
    removeExpired,
    close() { if (timer !== null) { clearInterval(timer); } },
    async create(sourcePath, fileName, request) {
      if (!fileNamePattern.test(fileName)) {
        throw new AppDownloadLinkConfigurationError("download file name is invalid");
      }
      if (request !== undefined &&
          (!subjectPattern.test(request.subject) || !subjectPattern.test(request.downloadId))) {
        throw new AppDownloadLinkConfigurationError("download link request is invalid");
      }
      // Only files outside the link directory may be linked: cleanup must never
      // be able to reach a stored artifact.
      const realSource = await realpath(sourcePath);
      if (realSource === realDirectory || isInside(realDirectory, realSource)) {
        throw new AppDownloadLinkConfigurationError("the stored file lies inside the link directory");
      }
      const current = now();
      if (current - lastSweepAtMs >= sweepBeforeCreateMs) { await removeExpired(); }
      const bucket = Math.floor(current / bucketMs);
      const expiresAtMs = (bucket + 2) * bucketMs;
      const token = request === undefined
        ? randomBytes(32).toString("hex")
        : createHmac("sha256", key)
          .update(`mk8dx.app-download-link.v2\0${request.subject}\0${request.downloadId}\0${fileName}\0${String(bucket)}`)
          .digest("hex");
      const name = `${String(Math.floor(expiresAtMs / 1_000)).padStart(10, "0")}-${token}`;
      const folder = join(directory, name);
      const location = `${config.urlPath}/${name}/${encodeURIComponent(fileName)}`;
      if (request !== undefined && await folderHoldsLink(folder, fileName)) {
        return { location, created: false };
      }
      if (liveAtLastSweep + createdSinceSweep >= config.maximumLinks) {
        throw new AppDownloadLinkCapacityError(Math.max(1, Math.ceil(bucketMs / 1_000)));
      }
      try {
        await mkdir(folder);
      } catch (error) {
        // A concurrent request for the same link made it first.
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || request === undefined) { throw error; }
      }
      createdSinceSweep += 1;
      // The rule goes in before the link, so the file is never reachable
      // without its expiry.
      await writeFile(join(folder, ".htaccess"), linkFolderAccessRules(expiresAtMs), { mode: 0o644 });
      const target = join(folder, fileName);
      try {
        await symlink(sourcePath, target, "file");
      } catch (symlinkError) {
        if ((symlinkError as NodeJS.ErrnoException).code === "EEXIST") {
          return { location, created: false };
        }
        // Hosts that forbid symlinks (or Windows without the privilege) still
        // allow a hard link when the files share one filesystem.
        try {
          await link(sourcePath, target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") { return { location, created: false }; }
          await unlink(join(folder, ".htaccess")).catch(() => undefined);
          await rmdir(folder).catch(() => undefined);
          throw error;
        }
      }
      return { location, created: true };
    },
  };
}

/** What the startup self-check found out about the web server. */
export type AppDownloadLinkProbeResult =
  | "enforced" | "not_enforced" | "clock_mismatch" | "rules_rejected" | "unreachable";

/**
 * Asks the real web server, through the public origin, whether it applies the
 * per-folder expiry: an already expired probe link must be refused and a valid
 * one served. Uses a small probe file, never a stored artifact, and removes both
 * probe folders afterwards. The result is for the operator log only.
 */
export async function probeAppDownloadLinkExpiry(
  config: AppDownloadLinkConfig,
  origin: string,
  fetchPort: (url: string, init: RequestInit) => Promise<Response> = fetch,
  now: () => number = Date.now,
): Promise<AppDownloadLinkProbeResult> {
  const current = now();
  const make = async (expiresAtMs: number) => {
    const name = `${String(Math.floor(expiresAtMs / 1_000)).padStart(10, "0")}-${randomBytes(32).toString("hex")}`;
    const folder = join(config.directory, name);
    await mkdir(folder);
    await writeFile(join(folder, ".htaccess"), linkFolderAccessRules(expiresAtMs));
    await writeFile(join(folder, "probe.txt"), "mk8dx-link-probe");
    return { folder, url: new URL(`${config.urlPath}/${name}/probe.txt`, origin).toString() };
  };
  const status = async (url: string): Promise<number | null> => {
    try {
      const response = await fetchPort(url, {
        method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(5_000),
      });
      await response.body?.cancel().catch(() => undefined);
      return response.status;
    } catch {
      return null;
    }
  };
  const expired = await make(current - 120_000);
  const valid = await make(current + 120_000);
  try {
    const [expiredStatus, validStatus] = await Promise.all([status(expired.url), status(valid.url)]);
    if (expiredStatus === null || validStatus === null) { return "unreachable"; }
    if (validStatus >= 500) { return "rules_rejected"; }
    if (validStatus !== 200) { return validStatus === 403 ? "clock_mismatch" : "unreachable"; }
    return expiredStatus === 200 ? "not_enforced" : "enforced";
  } finally {
    await removeLinkFolder(expired.folder).catch(() => undefined);
    await removeLinkFolder(valid.folder).catch(() => undefined);
  }
}
