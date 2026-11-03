// The Apps page: where a community member gets the Android and Windows
// builds. The files are owner-private, so both the list and the download
// are only served to a signed-in account and the page says so plainly
// rather than pretending to be a store.

export type AppDownloadEntry = Readonly<{
  id: string;
  platform: "android" | "windows";
  title: string;
  version: string;
  releasedOn: string;
  fileName: string;
  bytes: number;
  sha256: string;
  requirements: readonly string[];
  installSteps: readonly string[];
  updateSteps: readonly string[];
}>;

export type MountedAppDownloads = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

import { productLanguage } from "./product-language.js";
import type { ProductLanguage } from "./product-language.js";

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

// Everything a visitor reads on a card exists in both product languages: the
// English text is the reference and the Dutch text sits beside it, so a
// caption is never half-translated by word substitution.
type Bilingual<T> = Readonly<{ en: T; nl: T }>;

function pick<T>(language: ProductLanguage, text: Bilingual<T>): T {
  return language === "nl" ? text.nl : text.en;
}

const MAXIMUM_RESPONSE_BYTES = 65_536;

export class AppDownloadsError extends Error {
  public constructor(
    public readonly code: "not_authenticated" | "unavailable",
  ) {
    super("The apps could not be listed.");
    this.name = "AppDownloadsError";
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) { return ""; }
  if (bytes < 1024) { return `${bytes} bytes`; }
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1024) { return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} MB`; }
  return `${(megabytes / 1024).toFixed(1)} GB`;
}

export function formatAppDownloadMetadata(
  entry: AppDownloadEntry,
  language: ProductLanguage = productLanguage(),
): string {
  return language === "nl"
    ? `Versie ${entry.version} · Laatst bijgewerkt ${entry.releasedOn} · ${formatBytes(entry.bytes)}`
    : `Version ${entry.version} · Last updated ${entry.releasedOn} · ${formatBytes(entry.bytes)}`;
}

// The owner-written guides under each download come from the server in the
// product language: the request names it, and the server answers with the
// English lists wherever the owner has not written a translation.
export function appDownloadsPath(language: ProductLanguage): string {
  return language === "en"
    ? "/v1/app-downloads"
    : `/v1/app-downloads?language=${encodeURIComponent(language)}`;
}

export async function loadAppDownloads(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
  language: ProductLanguage = productLanguage(),
): Promise<readonly AppDownloadEntry[]> {
  let response: Response;
  try {
    response = await fetchPort(appDownloadsPath(language), {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      referrerPolicy: "same-origin",
      cache: "no-store",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    throw new AppDownloadsError("unavailable");
  }
  if (response.status === 401) { throw new AppDownloadsError("not_authenticated"); }
  if (response.status !== 200) { throw new AppDownloadsError("unavailable"); }
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAXIMUM_RESPONSE_BYTES) {
    throw new AppDownloadsError("unavailable");
  }
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppDownloadsError("unavailable");
  }
  const row = body as Record<string, unknown>;
  if (row["schemaVersion"] !== "mk8dx.app-downloads.v1" ||
    !Array.isArray(row["entries"]) || row["entries"].length > 20) {
    throw new AppDownloadsError("unavailable");
  }
  return row["entries"].map(parseEntry);
}

// The manifest is owner-written, but the page still parses it closed: a
// malformed entry must surface as "unavailable", never as undefined text.
const textList = (value: unknown, max: number): readonly string[] => {
  if (!Array.isArray(value) || value.length > max ||
    !value.every((item) => typeof item === "string" && item.length >= 1 && item.length <= 300)) {
    throw new AppDownloadsError("unavailable");
  }
  return value as readonly string[];
};

function parseEntry(value: unknown): AppDownloadEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppDownloadsError("unavailable");
  }
  const row = value as Record<string, unknown>;
  const text = (key: string, max: number, pattern?: RegExp): string => {
    const candidate = row[key];
    if (typeof candidate !== "string" || candidate.length < 1 || candidate.length > max ||
      (pattern !== undefined && !pattern.test(candidate))) {
      throw new AppDownloadsError("unavailable");
    }
    return candidate;
  };
  const bytes = row["bytes"];
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 1) {
    throw new AppDownloadsError("unavailable");
  }
  const platform = row["platform"];
  if (platform !== "android" && platform !== "windows") {
    throw new AppDownloadsError("unavailable");
  }
  return {
    id: text("id", 64, /^[a-z0-9][a-z0-9._-]{0,63}$/),
    platform,
    title: text("title", 120),
    version: text("version", 40),
    releasedOn: text("releasedOn", 10, /^\d{4}-\d{2}-\d{2}$/),
    fileName: text("fileName", 160),
    bytes,
    sha256: text("sha256", 64, /^[a-f0-9]{64}$/),
    requirements: textList(row["requirements"], 20),
    installSteps: textList(row["installSteps"], 20),
    updateSteps: textList(row["updateSteps"], 20),
  };
}

function list(
  document: Document,
  heading: string,
  items: readonly string[],
): HTMLElement | null {
  if (items.length === 0) { return null; }
  const section = document.createElement("div");
  section.className = "ds-disclosure app-download__section";
  const title = document.createElement("button");
  title.type = "button";
  title.className = "ds-disclosure__summary";
  title.textContent = heading;
  const body = document.createElement("div");
  body.className = "ds-disclosure__body";
  body.hidden = true;
  title.setAttribute("aria-expanded", "false");
  title.addEventListener("click", () => {
    body.hidden = !body.hidden;
    title.setAttribute("aria-expanded", body.hidden ? "false" : "true");
  });
  const rows = document.createElement("ul");
  for (const item of items) {
    const row = document.createElement("li");
    row.textContent = item;
    rows.append(row);
  }
  body.append(rows);
  section.append(title, body);
  return section;
}

// The product intro a non-technical visitor reads before the install steps:
// what the app is for, what goes in, what happens, what comes out and which
// chore it takes away. It describes the product, not a version, so it lives
// with the presentation rather than in the owner-written release manifest.
export interface AppDownloadIntro {
  readonly summary: string;
  readonly input: string;
  readonly process: string;
  readonly output: string;
  readonly solves: string;
}

type FlowKey = Exclude<keyof AppDownloadIntro, "summary">;

const FLOW_LABELS: Bilingual<Readonly<Record<FlowKey, string>>> = {
  en: { input: "Input", process: "Process", output: "Output", solves: "Solves" },
  nl: { input: "Invoer", process: "Verwerking", output: "Resultaat", solves: "Lost op" },
};

// "What this does?" is open by default: it is the first thing a visitor who
// has never used the app should read, while the install steps stay folded.
function introSection(
  document: Document,
  intro: AppDownloadIntro,
  language: ProductLanguage,
): HTMLElement {
  const section = document.createElement("div");
  section.className = "ds-disclosure app-download__section app-download__intro";
  const title = document.createElement("button");
  title.type = "button";
  title.className = "ds-disclosure__summary";
  title.textContent = pick(language, { en: "What this does?", nl: "Wat doet dit?" });
  title.setAttribute("aria-expanded", "true");
  const summary = document.createElement("p");
  summary.className = "app-download__intro-summary";
  summary.textContent = intro.summary;
  const flow = document.createElement("dl");
  flow.className = "app-download__flow";
  const labels = pick(language, FLOW_LABELS);
  for (const key of ["input", "process", "output", "solves"] as const) {
    const term = document.createElement("dt");
    term.textContent = labels[key];
    const detail = document.createElement("dd");
    detail.textContent = intro[key];
    flow.append(term, detail);
  }
  const body = document.createElement("div");
  body.className = "ds-disclosure__body";
  title.addEventListener("click", () => {
    body.hidden = !body.hidden;
    title.setAttribute("aria-expanded", body.hidden ? "false" : "true");
  });
  body.append(summary, flow);
  section.append(title, body);
  return section;
}

export interface AppDownloadPresentation {
  readonly cardClass: string;
  readonly platformLabel: string;
  readonly productLabel: string;
  readonly deviceLabel: string;
  readonly downloadLabel: string;
  readonly fileKind: string;
  readonly intro: AppDownloadIntro;
}

const ANDROID_INTRO: Bilingual<AppDownloadIntro> = {
  en: {
    summary:
      "The phone app for your Time Trials. Keep your best time on every track, " +
      "see where you stand against the community, and get a new time in with a " +
      "photo instead of typing it.",
    input:
      "A finished Time Trial: the result screen on your TV, either scanned with " +
      "the phone camera or typed in by hand (track, 150cc or 200cc, total time " +
      "and laps).",
    process:
      "The app reads the screen on the phone itself, without internet, and shows " +
      "you what it read so you can adjust it before it is saved. When you are " +
      "online it sends your times to the MK8DX site under your own Player name.",
    output:
      "Your own history and best times per track, the community leaderboards and " +
      "rankings, your progress and rivals, and a notification when someone beats " +
      "your time or pokes you.",
    solves:
      "No more typing times into a spreadsheet or a website after every session, " +
      "and no more guessing where you stand: your times land in one shared place, " +
      "straight from the couch.",
  },
  nl: {
    summary:
      "De telefoon-app voor je Time Trials. Bewaar je beste tijd op elk circuit, " +
      "zie waar je staat ten opzichte van de community en voer een nieuwe tijd in " +
      "met een foto in plaats van typen.",
    input:
      "Een gereden Time Trial: het resultatenscherm op je tv, gescand met de " +
      "camera van je telefoon of met de hand ingevoerd (circuit, 150cc of 200cc, " +
      "totaaltijd en ronden).",
    process:
      "De app leest het scherm op de telefoon zelf, zonder internet, en laat zien " +
      "wat hij heeft gelezen zodat je het kunt aanpassen voordat het wordt " +
      "opgeslagen. Zodra je online bent stuurt hij je tijden onder je eigen " +
      "spelersnaam naar de MK8DX-site.",
    output:
      "Je eigen geschiedenis en beste tijden per circuit, de ranglijsten van de " +
      "community, je voortgang en rivalen, en een melding wanneer iemand je tijd " +
      "verslaat of je port.",
    solves:
      "Nooit meer na elke sessie tijden overtypen in een spreadsheet of op een " +
      "website, en nooit meer gissen waar je staat: je tijden komen op één " +
      "gedeelde plek terecht, rechtstreeks vanaf de bank.",
  },
};

const LIVETRIAL_INTRO: Bilingual<AppDownloadIntro> = {
  en: {
    summary:
      "The PC program for Time Trials with a capture card or a recorded video. It " +
      "watches your play on the PC and picks up every finished run by itself.",
    input:
      "The picture from your Switch: live through a capture card connected to " +
      "the PC, or a video file you recorded earlier.",
    process:
      "LiveTrial recognises the track, the class (150cc or 200cc), the total time " +
      "and the laps from the screen while you play, stores each run on your PC " +
      "and keeps the frames it used as evidence. Sending runs to the MK8DX site is " +
      "a separate step you control: automatically, or by hand when you are ready.",
    output:
      "A run history and dashboard on your PC with your tracks, cups and goals, " +
      "and once a run is sent, your standing, best times and rivals on the MK8DX " +
      "site.",
    solves:
      "Long Time Trial sessions without touching a phone or a keyboard: you play, " +
      "and every finished run is captured, kept and ready to publish.",
  },
  nl: {
    summary:
      "Het pc-programma voor Time Trials met een capturekaart of een opgenomen " +
      "video. Het kijkt op de pc mee met je spel en pikt elke gereden run vanzelf " +
      "op.",
    input:
      "Het beeld van je Switch: live via een capturekaart die op de pc is " +
      "aangesloten, of een videobestand dat je eerder hebt opgenomen.",
    process:
      "LiveTrial herkent tijdens het spelen het circuit, de klasse (150cc of " +
      "200cc), de totaaltijd en de ronden op het scherm, bewaart elke run op je " +
      "pc en houdt de gebruikte beelden als bewijs. Runs naar de MK8DX-site " +
      "sturen is een aparte stap die jij bepaalt: automatisch, of met de hand " +
      "wanneer je er klaar voor bent.",
    output:
      "Een rungeschiedenis en dashboard op je pc met je circuits, bekers en " +
      "doelen, en zodra een run is verstuurd, je positie, beste tijden en rivalen " +
      "op de MK8DX-site.",
    solves:
      "Lange Time Trial-sessies zonder een telefoon of toetsenbord aan te raken: " +
      "jij speelt, en elke gereden run wordt vastgelegd, bewaard en staat klaar " +
      "om te publiceren.",
  },
};

const TOURNAMENT_TOOLS_INTRO: Bilingual<AppDownloadIntro> = {
  en: {
    summary:
      "The PC programs for whoever runs a tournament. They turn a recorded or live " +
      "video of the races into results you import into the tournament on the " +
      "MK8DX site.",
    input:
      "A recorded video of the races (.mp4 or .mkv), or the live picture through a " +
      "capture card, plus the tournament you set up on the site.",
    process:
      "The tools read the result screen after every race: who finished where and " +
      "with how many points. Live capture keeps following the stream through " +
      "disconnects and resets. You check the results before they are used.",
    output:
      "An Excel and CSV sheet and a race-results file that you import into the " +
      "tournament on the site, which then works out the standings, the " +
      "qualification groups and the finals.",
    solves:
      "Nobody has to write down every name and position after each race while the " +
      "next one is already starting. Results are complete, checked and in the " +
      "standings within minutes.",
  },
  nl: {
    summary:
      "De pc-programma's voor wie een toernooi organiseert. Ze zetten een " +
      "opgenomen of live video van de races om in uitslagen die je importeert in " +
      "het toernooi op de MK8DX-site.",
    input:
      "Een opgenomen video van de races (.mp4 of .mkv), of het livebeeld via een " +
      "capturekaart, plus het toernooi dat je op de site hebt aangemaakt.",
    process:
      "De programma's lezen na elke race het resultatenscherm: wie waar is " +
      "geëindigd en met hoeveel punten. Live-opname blijft de stream volgen bij " +
      "verbroken verbindingen en resets. Jij controleert de uitslagen voordat ze " +
      "worden gebruikt.",
    output:
      "Een Excel- en CSV-sheet en een bestand met raceuitslagen dat je importeert " +
      "in het toernooi op de site, dat daarna de standen, de kwalificatiegroepen " +
      "en de finales berekent.",
    solves:
      "Niemand hoeft meer na elke race alle namen en posities op te schrijven " +
      "terwijl de volgende al begint. Uitslagen zijn compleet, gecontroleerd en " +
      "binnen enkele minuten in de stand.",
  },
};

const WINDOWS_PLATFORM: Bilingual<string> = { en: "WINDOWS PC", nl: "WINDOWS-PC" };
const WINDOWS_DEVICE: Bilingual<string> = {
  en: "For Windows PCs and laptops",
  nl: "Voor Windows-pc's en laptops",
};

export function appDownloadPresentation(
  entry: AppDownloadEntry,
  language: ProductLanguage = productLanguage(),
): AppDownloadPresentation {
  if (entry.platform === "android") {
    return {
      cardClass: "app-download--android",
      platformLabel: pick(language, { en: "ANDROID APP", nl: "ANDROID-APP" }),
      productLabel: "MK8DX TIME TRIALS",
      deviceLabel: pick(language, {
        en: "For Android phones and tablets",
        nl: "Voor Android-telefoons en -tablets",
      }),
      downloadLabel: pick(language, {
        en: "Download Android app",
        nl: "Android-app downloaden",
      }),
      fileKind: ".APK",
      intro: pick(language, ANDROID_INTRO),
    };
  }
  if (entry.id === "livetrial-windows") {
    return {
      cardClass: "app-download--windows",
      platformLabel: pick(language, WINDOWS_PLATFORM),
      productLabel: "MK8DX TIME TRIALS",
      deviceLabel: pick(language, WINDOWS_DEVICE),
      downloadLabel: pick(language, {
        en: "Download Windows app",
        nl: "Windows-app downloaden",
      }),
      fileKind: ".ZIP",
      intro: pick(language, LIVETRIAL_INTRO),
    };
  }
  return {
    cardClass: "app-download--windows",
    platformLabel: pick(language, WINDOWS_PLATFORM),
    productLabel: "MK8DX TOURNAMENT",
    deviceLabel: pick(language, WINDOWS_DEVICE),
    downloadLabel: pick(language, {
      en: "Download Tournament Tools",
      nl: "Tournament Tools downloaden",
    }),
    fileKind: ".ZIP",
    intro: pick(language, TOURNAMENT_TOOLS_INTRO),
  };
}

function platformMark(document: Document, platform: AppDownloadEntry["platform"]): HTMLElement {
  const mark = document.createElement("span");
  mark.className = `app-download__platform-mark app-download__platform-mark--${platform}`;
  mark.setAttribute("aria-hidden", "true");
  if (platform === "android") {
    const head = document.createElement("span");
    head.className = "app-download__android-head";
    const body = document.createElement("span");
    body.className = "app-download__android-body";
    mark.append(head, body);
  } else {
    for (let index = 0; index < 4; index += 1) {
      mark.append(document.createElement("span"));
    }
  }
  return mark;
}

export function mountAppDownloadsView(
  root: HTMLElement,
  load: (signal?: AbortSignal) => Promise<readonly AppDownloadEntry[]> =
  (signal) => loadAppDownloads(undefined, signal),
): MountedAppDownloads {
  const document = root.ownerDocument;
  const language = productLanguage();
  const controller = new AbortController();
  const container = document.createElement("div");
  container.className = "app-downloads ds-app-downloads ds-stack";
  const status = document.createElement("div");
  status.className = "ds-status ds-app-downloads__status";
  status.setAttribute("role", "status");
  const statusIcon = document.createElement("span");
  statusIcon.className = "ds-status__icon";
  statusIcon.setAttribute("aria-hidden", "true");
  const statusCopy = document.createElement("span");
  const setStatus = (tone: "info" | "success" | "error", text: string): void => {
    status.setAttribute("data-tone", tone);
    statusIcon.textContent = tone === "success" ? "✓" : tone === "info" ? "i" : "!";
    statusCopy.textContent = text;
  };
  setStatus("info", pick(language, {
    en: "Looking for the latest builds…",
    nl: "Nieuwste versies zoeken…",
  }));
  status.append(statusIcon, statusCopy);
  container.append(status);
  root.append(container);

  const ready = (async () => {
    let entries: readonly AppDownloadEntry[];
    try {
      entries = await load(controller.signal);
    } catch (error) {
      setStatus("error", error instanceof AppDownloadsError &&
        error.code === "not_authenticated"
        ? pick(language, {
          en: "Sign in to download the MK8DX apps.",
          nl: "Meld je aan om de MK8DX-apps te downloaden.",
        })
        : pick(language, {
          en: "The apps are not available right now.",
          nl: "De apps zijn op dit moment niet beschikbaar.",
        }));
      return;
    }
    if (entries.length === 0) {
      setStatus("info", pick(language, {
        en: "No apps have been published yet.",
        nl: "Er zijn nog geen apps gepubliceerd.",
      }));
      return;
    }
    setStatus("success", pick(language, {
      en: "Choose your device and download the latest build.",
      nl: "Kies je apparaat en download de nieuwste versie.",
    }));
    for (const entry of entries) {
      const presentation = appDownloadPresentation(entry, language);
      const card = document.createElement("article");
      card.className = `ds-panel app-download ${presentation.cardClass}`;
      const titleId = `app-download-${entry.id}-title`;
      card.setAttribute("aria-labelledby", titleId);
      const header = document.createElement("div");
      header.className = "app-download__header";
      const identity = document.createElement("div");
      identity.className = "app-download__identity";
      const platform = document.createElement("p");
      platform.className = "app-download__platform";
      platform.textContent = presentation.platformLabel;
      const title = document.createElement("h2");
      title.id = titleId;
      title.className = "ds-panel__title";
      title.textContent = entry.title;
      const product = document.createElement("p");
      product.className = "app-download__product";
      product.textContent = presentation.productLabel;
      const meta = document.createElement("p");
      meta.className = "app-download__meta";
      meta.textContent = formatAppDownloadMetadata(entry, language);
      identity.append(platform, title, product, meta);
      header.append(platformMark(document, entry.platform), identity);
      const action = document.createElement("div");
      action.className = "app-download__action";
      const download = document.createElement("a");
      download.className = "ds-button app-download__button";
      download.setAttribute("data-variant", "global");
      download.setAttribute("data-size", "md");
      download.setAttribute(
        "href", `/v1/app-downloads/${encodeURIComponent(entry.id)}/file`,
      );
      download.setAttribute("download", entry.fileName);
      download.setAttribute(
        "aria-label",
        `${presentation.downloadLabel}, ${pick(language, { en: "version", nl: "versie" })} ${entry.version}`,
      );
      const downloadLabel = document.createElement("span");
      downloadLabel.textContent = presentation.downloadLabel;
      const downloadKind = document.createElement("span");
      downloadKind.className = "app-download__button-kind";
      downloadKind.textContent = `${presentation.fileKind} ↓`;
      download.append(downloadLabel, downloadKind);
      const device = document.createElement("span");
      device.className = "app-download__device";
      device.textContent = presentation.deviceLabel;
      action.append(download, device);
      card.append(header, action, introSection(document, presentation.intro, language));
      for (const [label, items] of [
        [pick(language, { en: "What you need", nl: "Wat je nodig hebt" }), entry.requirements],
        [pick(language, { en: "Installing", nl: "Installeren" }), entry.installSteps],
        [pick(language, { en: "Updating", nl: "Bijwerken" }), entry.updateSteps],
      ] as const) {
        const section = list(document, label, items);
        if (section !== null) { card.append(section); }
      }
      // The checksum lets a careful user confirm the file arrived intact.
      const checksum = document.createElement("p");
      checksum.className = "app-download__checksum";
      checksum.textContent = `SHA-256 ${entry.sha256}`;
      card.append(checksum);
      container.append(card);
    }
  })();

  return {
    container,
    ready,
    unmount(): void {
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
