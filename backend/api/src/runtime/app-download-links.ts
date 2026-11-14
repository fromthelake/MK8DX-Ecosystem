import { randomBytes } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readdir,
  realpath,
  rmdir,
  symlink,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

// Short-lived static download links (opt-in).
//
// Some shared hosts put the Node application behind a proxy that refuses large
// responses: LiteSpeed/Passenger answers a 536 MB APK streamed through Node
// with its own small HTML error page. Files the web server serves itself have
// no such limit and support HTTP Range (resumable downloads). In this mode the
// authenticated file route does not stream; it creates
// `<directory>/<64 hex>/<fileName>` as a link to the stored file inside the web
// document root and redirects the signed-in browser there. The folder name is
// 32 random bytes, so the address is unguessable, and folders older than the
// lifetime are removed on every request and at startup. Only folders whose
// name is exactly 64 lowercase hex characters are ever touched.

export class AppDownloadLinkConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AppDownloadLinkConfigurationError";
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
}>;

export type AppDownloadLinks = Readonly<{
  // Creates a fresh link to `sourcePath` and returns its public URL path.
  create(sourcePath: string, fileName: string): Promise<string>;
  // Removes every link folder older than the lifetime.
  removeExpired(): Promise<void>;
}>;

export const APP_DOWNLOAD_LINK_ENVIRONMENT = {
  documentRoot: "MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT",
  directory: "MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY",
  urlPath: "MK8DX_HOSTED_APP_DOWNLOAD_LINK_URL_PATH",
  ttlSeconds: "MK8DX_HOSTED_APP_DOWNLOAD_LINK_TTL_SECONDS",
} as const;

const DEFAULT_TTL_SECONDS = 600;
const MINIMUM_TTL_SECONDS = 60;
const MAXIMUM_TTL_SECONDS = 24 * 60 * 60;
const linkFolderPattern = /^[0-9a-f]{64}$/;
const urlPathPattern = /^(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}){1,8}$/;
const fileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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
  if (directoryValue === undefined) {
    if (documentRootValue !== undefined || urlPathValue !== undefined ||
      ttlValue !== undefined) {
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
  return { documentRoot, directory, urlPath, ttlMilliseconds: ttlSeconds * 1000 };
}

async function removeLinkFolder(folder: string): Promise<void> {
  // Only plain files and links we made are expected inside. Anything else
  // (a nested directory) means this is not ours: leave the folder alone.
  const names = await readdir(folder);
  for (const name of names) {
    const stats = await lstat(join(folder, name));
    if (!stats.isFile() && !stats.isSymbolicLink()) { return; }
  }
  for (const name of names) {
    // Unlinking a symlink or a hard link never touches the stored file.
    await unlink(join(folder, name));
  }
  await rmdir(folder);
}

/**
 * Prepares the link directory (creating it when missing), refuses a directory
 * that is a symbolic link or resolves outside the document root, and removes
 * expired link folders once before the first request.
 */
export async function prepareAppDownloadLinks(
  config: AppDownloadLinkConfig,
  now: () => number = Date.now,
): Promise<AppDownloadLinks> {
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

  async function removeExpired(): Promise<void> {
    const cutoff = now() - config.ttlMilliseconds;
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      return;
    }
    for (const name of names) {
      if (!linkFolderPattern.test(name)) { continue; }
      const folder = join(directory, name);
      try {
        const folderStats = await lstat(folder);
        if (!folderStats.isDirectory() || folderStats.mtimeMs > cutoff) { continue; }
        await removeLinkFolder(folder);
      } catch {
        // A concurrent request removed it first, or it is not removable;
        // the next request tries again.
      }
    }
  }

  await removeExpired();

  return {
    removeExpired,
    async create(sourcePath: string, fileName: string): Promise<string> {
      if (!fileNamePattern.test(fileName)) {
        throw new AppDownloadLinkConfigurationError("download file name is invalid");
      }
      await removeExpired();
      const token = randomBytes(32).toString("hex");
      const folder = join(directory, token);
      await mkdir(folder);
      const target = join(folder, fileName);
      try {
        await symlink(sourcePath, target, "file");
      } catch {
        // Hosts that forbid symlinks (or Windows without the privilege) still
        // allow a hard link when the files share one filesystem.
        try {
          await link(sourcePath, target);
        } catch (error) {
          await rmdir(folder).catch(() => undefined);
          throw error;
        }
      }
      return `${config.urlPath}/${token}/${encodeURIComponent(fileName)}`;
    },
  };
}
