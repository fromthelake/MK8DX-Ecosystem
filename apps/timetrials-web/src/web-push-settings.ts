import { localized } from "./product-language.js";

export const NOTIFICATION_SCOPES = ["all", "rivals", "world_records", "none"] as const;

export type NotificationScope = (typeof NOTIFICATION_SCOPES)[number];

/**
 * Who may reach you with a poke, a game or a challenge. A separate question
 * from what you want delivered: somebody who wants every World Record may
 * still want nothing from strangers.
 */
export const ENGAGEMENT_ACCEPT_SCOPES = ["all", "rivals", "none"] as const;

export type EngagementAcceptScope = (typeof ENGAGEMENT_ACCEPT_SCOPES)[number];

type NotificationSettings = Readonly<{
  preferences: Readonly<{
    scope?: NotificationScope;
    engagementAcceptScope?: EngagementAcceptScope;
    competitiveOvertaken: boolean;
    activityReactions: boolean;
  }>;
  webPush: Readonly<{
    supported: boolean;
    applicationServerKey?: string;
    subscriptionCount: number;
  }>;
}>;

type PushNavigator = Navigator & Readonly<{ standalone?: boolean }>;
const guideReadKey = "mk8dx-ios-push-guide-read-v1";
const openedKey = "mk8dx-inbox-notification-settings-open-v1";

function isIos(navigator_: Navigator): boolean {
  return /iPad|iPhone|iPod/.test(navigator_.userAgent) ||
    (navigator_.platform === "MacIntel" && navigator_.maxTouchPoints > 1);
}

function isStandalone(window_: Window): boolean {
  return window_.matchMedia("(display-mode: standalone)").matches ||
    (window_.navigator as PushNavigator).standalone === true;
}

function supportsPush(window_: Window): boolean {
  return "serviceWorker" in window_.navigator && "PushManager" in window_ &&
    "Notification" in window_;
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function csrf(): Promise<Readonly<{ headerName: string; value: string }>> {
  const response = await fetch("/v1/session/csrf", {
    method: "GET", credentials: "same-origin", cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("csrf unavailable");
  return response.json() as Promise<Readonly<{ headerName: string; value: string }>>;
}

async function write(path: string, method: "POST" | "PUT" | "DELETE", body: object): Promise<void> {
  const proof = await csrf();
  const response = await fetch(path, {
    method, credentials: "same-origin", cache: "no-store",
    headers: {
      Accept: "application/json", "Content-Type": "application/json",
      [proof.headerName]: proof.value,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("notification write failed");
}

async function load(): Promise<NotificationSettings> {
  const response = await fetch("/v1/notification-settings", {
    method: "GET", credentials: "same-origin", cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("notification settings unavailable");
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.notification-settings.v1") {
    throw new Error("invalid notification settings");
  }
  return body as unknown as NotificationSettings;
}

function subscriptionDocument(subscription: PushSubscription): object {
  const json = subscription.toJSON();
  if (typeof json.endpoint !== "string" || json.keys === undefined ||
      typeof json.keys["p256dh"] !== "string" || typeof json.keys["auth"] !== "string") {
    throw new Error("invalid browser subscription");
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys["p256dh"], auth: json.keys["auth"] } };
}

export async function registerProductServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("/sw.js", { scope: "/" }); }
  catch { return null; }
}

export async function detachCurrentWebPushSubscription(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription === null || subscription === undefined) return;
  const endpoint = subscription.endpoint;
  try { await write("/v1/web-push/subscriptions", "DELETE", { endpoint }); }
  finally { await subscription.unsubscribe().catch(() => false); }
}

function row(document_: Document, labelText: string, checked: boolean): Readonly<{
  element: HTMLLabelElement; input: HTMLInputElement;
}> {
  const label = document_.createElement("label");
  label.className = "notification-settings__preference ds-settings-toggle";
  const input = document_.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  label.append(input, document_.createTextNode(labelText));
  return { element: label, input };
}

/**
 * Plain steps per device, for someone who has never heard of a service worker.
 * The device you are on comes first and is open; the others are there because
 * people set this up on the laptop and then wonder why the phone is silent.
 */
function platformGuide(
  document_: Document,
  platform: "iphone" | "android" | "desktop",
): HTMLElement {
  const steps: Readonly<Record<string, readonly string[]>> = {
    iphone: [
      localized("Open this site in Safari.", "Open deze site in Safari."),
      localized("Tap the Share button at the bottom.", "Tik onderaan op de Deel-knop."),
      localized("Choose ‘Add to Home Screen’.", "Kies ‘Zet op beginscherm’."),
      localized("Open MK8DX from the new icon on your Home Screen.", "Open MK8DX via het nieuwe icoon op je beginscherm."),
      localized("Come back here and tap ‘Enable notifications’, then tap Allow.", "Kom hier terug, tik op ‘Meldingen inschakelen’ en tik op Sta toe."),
    ],
    android: [
      localized("Tap ‘Enable notifications’ below.", "Tik hieronder op ‘Meldingen inschakelen’."),
      localized("Tap Allow when your phone asks.", "Tik op Toestaan wanneer je telefoon het vraagt."),
      localized("That is all. For a quicker start, use your browser menu to add MK8DX to your Home screen.", "Meer is er niet. Wil je sneller starten, voeg MK8DX dan via het browsermenu toe aan je beginscherm."),
    ],
    desktop: [
      localized("Click ‘Enable notifications’ below.", "Klik hieronder op ‘Meldingen inschakelen’."),
      localized("Click Allow in the small window your browser shows.", "Klik op Toestaan in het kleine venster van je browser."),
      localized("Notifications arrive while your browser is running, even with this tab closed.", "Meldingen komen binnen zolang je browser draait, ook met dit tabblad dicht."),
    ],
  };
  const names: Readonly<Record<string, string>> = {
    iphone: localized("On iPhone or iPad", "Op iPhone of iPad"),
    android: localized("On an Android phone", "Op een Android-telefoon"),
    desktop: localized("On a computer", "Op een computer"),
  };
  const guide = document_.createElement("div");
  guide.className = "notification-settings__guide ds-stack";
  const order: ReadonlyArray<"iphone" | "android" | "desktop"> = platform === "iphone"
    ? ["iphone", "android", "desktop"]
    : platform === "android" ? ["android", "iphone", "desktop"] : ["desktop", "iphone", "android"];
  for (const [index, key] of order.entries()) {
    const block = document_.createElement("details");
    block.className = "notification-settings__guide-block ds-disclosure";
    block.open = index === 0;
    const summary = document_.createElement("summary");
    summary.textContent = index === 0
      ? localized(`${names[key]} — what to do`, `${names[key]} — wat je doet`)
      : names[key]!;
    const list = document_.createElement("ol");
    for (const copy of steps[key]!) {
      const item = document_.createElement("li");
      item.textContent = copy;
      list.append(item);
    }
    block.append(summary, list);
    guide.append(block);
  }
  return guide;
}

export function mountWebPushSettings(
  root: HTMLElement,
  options: Readonly<{ inboxContext?: boolean }> = {},
): Readonly<{
  ready: Promise<void>; unmount(): void;
}> {
  const document_ = root.ownerDocument;
  const window_ = document_.defaultView;
  const controller = new AbortController();
  let disposed = false;
  const section = document_.createElement("section");
  section.className = "notification-settings ds-panel";
  const inbox = options.inboxContext === true;
  const heading = document_.createElement("h3");
  heading.className = "ds-title";
  heading.textContent = inbox
    ? localized("Get notified on this device", "Meldingen op dit apparaat")
    : localized("Notifications", "Meldingen");
  const status = document_.createElement("p");
  status.className = "notification-settings__status ds-body-s";
  status.textContent = localized("Loading notification settings…", "Meldingsinstellingen laden…");
  const controls = document_.createElement("div");
  // On the page you open to read your notifications, the settings are not what
  // you came for. Four scope pickers, two switches and a three-platform guide
  // pushed the actual inbox below the fold. The page now puts this closed panel
  // after the inbox, and the summary says which state it is in, so
  // "why did I not hear about that?" is answered without opening it at all.
  const collapse = inbox ? document_.createElement("details") : null;
  if (collapse === null) {
    section.append(heading, status, controls);
  } else {
    collapse.className = "notification-settings__collapse ds-disclosure";
    const summary = document_.createElement("summary");
    summary.className = "notification-settings__collapse-summary ds-disclosure__summary";
    summary.append(heading);
    collapse.append(summary, status, controls);
    section.append(collapse);
    // Opened once, it stays open for this browser: an owner who is working on
    // their settings should not have to reopen them after every reload.
    try {
      collapse.open = window_?.localStorage.getItem(openedKey) === "1";
    } catch { /* Storage may be unavailable in private mode. */ }
    collapse.addEventListener("toggle", () => {
      try {
        window_?.localStorage.setItem(openedKey, collapse.open ? "1" : "0");
      } catch { /* Keep the disclosure usable without storage. */ }
    });
  }
  root.append(section);

  /** The one line the summary shows while it is closed. */
  const summarise = (state: "on" | "off" | "blocked" | "unavailable"): void => {
    if (collapse === null) { return; }
    heading.textContent = localized(
      "Get notified on this device", "Meldingen op dit apparaat",
    ) + (state === "on"
      ? localized(" — on", " — aan")
      : state === "blocked"
        ? localized(" — blocked by your browser", " — geblokkeerd door je browser")
        : state === "unavailable"
          ? localized(" — not available here", " — hier niet beschikbaar")
          : localized(" — off", " — uit"));
  };

  const ready = load().then(async (settings) => {
    if (disposed) return;
    status.textContent = "";
    // What you want to hear about at all, before the per-kind switches, and
    // who may reach you with a poke. Buttons rather than dropdowns, because
    // these are the controls an owner reaches for while a phone is buzzing.
    const scopeChoice = <Value extends string>(
      label: string,
      chosen: Value,
      copy: ReadonlyArray<readonly [Value, string, string]>,
    ): Readonly<{ element: HTMLElement; value: () => Value }> => {
      let value = chosen;
      const field = document_.createElement("div");
      field.className = "notification-settings__scope ds-field";
      const heading = document_.createElement("p");
      heading.className = "notification-settings__scope-label ds-field__label";
      heading.textContent = label;
      const buttons = document_.createElement("div");
      buttons.className = "notification-settings__scope-buttons";
      const note = document_.createElement("p");
      note.className = "notification-settings__scope-note ds-field__hint";
      const controlsFor: Array<readonly [Value, HTMLButtonElement]> = [];
      const paint = (): void => {
        for (const [candidate, control] of controlsFor) {
          const active = candidate === value;
          control.setAttribute("aria-pressed", active ? "true" : "false");
        }
        note.textContent = copy.find(([candidate]) => candidate === value)?.[2] ?? "";
      };
      for (const [candidate, text] of copy) {
        const control = document_.createElement("button");
        control.type = "button";
        control.className = "ds-button notification-settings__scope-button";
        control.setAttribute("data-variant", "secondary");
        control.textContent = text;
        control.addEventListener("click", () => { value = candidate; paint(); });
        controlsFor.push([candidate, control]);
        buttons.append(control);
      }
      field.append(heading, buttons, note);
      paint();
      return { element: field, value: () => value };
    };

    const sendScope = scopeChoice<NotificationScope>(
      localized("Send me", "Stuur mij"),
      settings.preferences.scope ?? "all",
      [
        ["all", localized("Everything", "Alles"), localized("Every notification below.", "Alle meldingen hieronder.")],
        ["rivals", localized("Rivals", "Rivalen"), localized("Only what another Player does to your standing.", "Alleen wat een andere speler met jouw stand doet.")],
        ["world_records", localized("World Records", "Wereldrecords"), localized("Only new World Records, bundled into one message.", "Alleen nieuwe wereldrecords, gebundeld in één bericht.")],
        ["none", localized("Nothing", "Niets"), localized("Stay silent; the inbox still fills up.", "Blijf stil; je inbox loopt nog wel vol.")],
      ],
    );
    const acceptScope = scopeChoice<EngagementAcceptScope>(
      localized("Let me be poked by", "Laat mij porren door"),
      settings.preferences.engagementAcceptScope ?? "all",
      [
        ["all", localized("Anyone", "Iedereen"), localized("Any Player may send you a poke or a challenge.", "Elke speler mag je porren of uitdagen.")],
        ["rivals", localized("Rivals", "Rivalen"), localized("Only the Players you follow as rivals.", "Alleen de spelers die je als rivaal volgt.")],
        ["none", localized("No one", "Niemand"), localized("Nobody can poke or challenge you.", "Niemand kan je porren of uitdagen.")],
      ],
    );
    controls.append(sendScope.element, acceptScope.element);
    const competitive = row(document_, localized("Competitive — Someone passes me", "Competitief — Iemand passeert mij"), settings.preferences.competitiveOvertaken);
    const reactions = row(document_, localized("Activity — Reactions to my results", "Activiteit — Reacties op mijn resultaten"), settings.preferences.activityReactions);
    const save = document_.createElement("button");
    save.type = "button";
    save.className = "ds-button";
    save.setAttribute("data-variant", "secondary");
    save.textContent = localized("Save preferences", "Voorkeuren opslaan");
    save.addEventListener("click", () => {
      save.disabled = true;
      void write("/v1/notification-settings/preferences", "PUT", {
        scope: sendScope.value(),
        engagementAcceptScope: acceptScope.value(),
        competitiveOvertaken: competitive.input.checked,
        activityReactions: reactions.input.checked,
      }).then(() => { status.textContent = localized("Notification preferences saved.", "Meldingsvoorkeuren opgeslagen."); })
        .catch(() => { status.textContent = localized("Could not save notification preferences.", "Meldingsvoorkeuren konden niet worden opgeslagen."); })
        .finally(() => { save.disabled = false; });
    });
    controls.append(competitive.element, reactions.element, save);

    const push = document_.createElement("div");
    push.className = "notification-settings__push ds-stack";
    const title = document_.createElement("h4");
    title.className = "ds-title";
    title.textContent = localized("Stay up to date", "Blijf op de hoogte");
    const explanation = document_.createElement("p");
    explanation.textContent = localized(
      "Receive notifications when someone passes you, reacts to your result, or something else important changes for you.",
      "Ontvang meldingen wanneer iemand je inhaalt, op je resultaat reageert of er iets anders belangrijks voor jou gebeurt.",
    );
    push.append(title, explanation);
    controls.append(push);
    if (window_ !== null) {
      push.append(platformGuide(
        document_,
        isIos(window_.navigator) ? "iphone"
          : /android/i.test(window_.navigator.userAgent) ? "android" : "desktop",
      ));
    }

    // DOM-only product tests intentionally use a document without a browsing
    // context. Preferences remain testable there; browser capabilities do not.
    if (window_ === null) {
      const unavailable = document_.createElement("p");
      unavailable.textContent = localized(
        "Web notifications require a browser.",
        "Webmeldingen vereisen een browser.",
      );
      push.append(unavailable);
      summarise("unavailable");
      return;
    }

    const ios = isIos(window_.navigator);
    const standalone = isStandalone(window_);
    const capable = supportsPush(window_) && settings.webPush.supported;
    if (ios && !standalone) {
      title.textContent = localized("Notifications on iPhone", "Meldingen op iPhone");
      const compact = document_.createElement("p");
      compact.textContent = localized(
        "Add MK8DX to your Home Screen to use notifications on iPhone.",
        "Voeg MK8DX toe aan je beginscherm om meldingen op iPhone te gebruiken.",
      );
      push.append(compact);
      const instructions = document_.createElement("ol");
      for (const copy of [
        localized("In Safari, tap Share.", "Tik in Safari op Deel."),
        localized("Choose ‘Add to Home Screen’.", "Kies ‘Zet op beginscherm’."),
        localized("Open MK8DX from the new icon.", "Open MK8DX daarna vanaf het nieuwe icoon."),
        localized("Then choose ‘Enable notifications’.", "Kies vervolgens ‘Meldingen inschakelen’."),
      ]) { const item = document_.createElement("li"); item.textContent = copy; instructions.append(item); }
      const understood = document_.createElement("button");
      understood.type = "button";
      understood.className = "ds-button";
      understood.setAttribute("data-variant", "secondary");
      understood.textContent = localized("Understood", "Begrepen");
      let alreadyRead = false;
      try { alreadyRead = window_.localStorage.getItem(guideReadKey) === "1"; } catch { /* Storage may be unavailable in private mode. */ }
      instructions.hidden = alreadyRead;
      understood.hidden = alreadyRead;
      understood.addEventListener("click", () => {
        try { window_.localStorage.setItem(guideReadKey, "1"); } catch { /* Keep the guide usable without storage. */ }
        instructions.hidden = true; understood.hidden = true;
      });
      if (alreadyRead) {
        const show = document_.createElement("button");
        show.type = "button"; show.className = "ds-button";
        show.setAttribute("data-variant", "quiet");
        show.textContent = localized("Show instructions", "Toon instructies");
        show.addEventListener("click", () => { instructions.hidden = false; understood.hidden = false; show.hidden = true; });
        push.append(show);
      }
      push.append(instructions, understood);
      summarise("off");
      return;
    }
    if (!capable) {
      const unsupported = document_.createElement("p");
      unsupported.textContent = localized("Web notifications are not supported here.", "Webmeldingen worden hier niet ondersteund.");
      push.append(unsupported);
      summarise("unavailable");
      return;
    }
    const registration = await registerProductServiceWorker();
    const existing = await registration?.pushManager.getSubscription() ?? null;
    const button = document_.createElement("button");
    button.type = "button";
    button.className = "ds-button";
    button.setAttribute("data-variant", "secondary");
    const renderPermission = (): void => {
      if (Notification.permission === "denied") {
        button.hidden = true;
        summarise("blocked");
        status.textContent = ios
          ? localized("Notifications are disabled in iOS. Allow them for MK8DX in iOS Settings.", "Meldingen zijn uitgeschakeld in iOS. Sta ze voor MK8DX toe via Instellingen in iOS.")
          : localized("Notifications are blocked in your browser settings.", "Meldingen zijn geblokkeerd in je browserinstellingen.");
      } else if (Notification.permission === "granted" && existing !== null) {
        button.textContent = localized("Disable web notifications", "Webmeldingen uitschakelen");
        status.textContent = localized("✓ Notifications are enabled", "✓ Meldingen zijn ingeschakeld");
        summarise("on");
      } else {
        button.textContent = localized("Enable notifications", "Meldingen inschakelen");
        summarise("off");
      }
    };
    renderPermission();
    button.addEventListener("click", () => {
      button.disabled = true;
      const work = async (): Promise<void> => {
        const current = await registration?.pushManager.getSubscription() ?? null;
        if (current !== null) {
          await write("/v1/web-push/subscriptions", "DELETE", { endpoint: current.endpoint });
          await current.unsubscribe();
          status.textContent = localized("Web notifications are disabled.", "Webmeldingen zijn uitgeschakeld.");
          button.textContent = localized("Enable notifications", "Meldingen inschakelen");
          summarise("off");
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          button.hidden = permission === "denied";
          status.textContent = permission === "denied"
            ? ios
              ? localized("Notifications are disabled in iOS. Allow them for MK8DX in iOS Settings.", "Meldingen zijn uitgeschakeld in iOS. Sta ze voor MK8DX toe via Instellingen in iOS.")
              : localized("Notifications are blocked in your browser settings.", "Meldingen zijn geblokkeerd in je browserinstellingen.")
            : localized("Notification permission was not granted.", "Toestemming voor meldingen is niet gegeven.");
          summarise(permission === "denied" ? "blocked" : "off");
          return;
        }
        if (registration === null || settings.webPush.applicationServerKey === undefined) {
          renderPermission(); return;
        }
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlBytes(settings.webPush.applicationServerKey),
        });
        try {
          await write("/v1/web-push/subscriptions", "POST", subscriptionDocument(subscription));
        } catch (error) { await subscription.unsubscribe(); throw error; }
        status.textContent = localized("✓ Notifications are enabled", "✓ Meldingen zijn ingeschakeld");
        button.textContent = localized("Disable web notifications", "Webmeldingen uitschakelen");
        summarise("on");
      };
      void work().catch(() => { status.textContent = localized("Notifications could not be changed.", "Meldingen konden niet worden gewijzigd."); })
        .finally(() => { button.disabled = false; });
    });
    push.append(button);
  }).catch(() => { if (!disposed) status.textContent = localized("Notification settings are temporarily unavailable.", "Meldingsinstellingen zijn tijdelijk niet beschikbaar."); });

  return {
    ready,
    unmount(): void {
      disposed = true;
      controller.abort();
      if (section.parentNode !== null) section.parentNode.removeChild(section);
    },
  };
}
