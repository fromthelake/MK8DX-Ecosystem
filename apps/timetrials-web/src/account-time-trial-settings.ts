export type TimeTrialModePreference = "all" | "150" | "200";
export type TimeTrialTrackAccess = "unknown" | "base_only" | "base_and_bcp";
export type AccountTimeTrialPreferences = Readonly<{
  modePreference: TimeTrialModePreference;
  screenName: string | null;
  trackAccess: TimeTrialTrackAccess;
}>;

export interface AccountTimeTrialPreferenceClient {
  read(signal?: AbortSignal): Promise<AccountTimeTrialPreferences>;
  save(value: AccountTimeTrialPreferences, signal?: AbortSignal): Promise<AccountTimeTrialPreferences>;
}

export function accountPreferenceFieldUpdate(
  persisted: AccountTimeTrialPreferences,
  field: "modePreference" | "screenName" | "trackAccess",
  value: TimeTrialModePreference | TimeTrialTrackAccess | string | null,
): AccountTimeTrialPreferences {
  if (field === "modePreference") {
    return { ...persisted, modePreference: value as TimeTrialModePreference };
  }
  if (field === "trackAccess") {
    return { ...persisted, trackAccess: value as TimeTrialTrackAccess };
  }
  return { ...persisted, screenName: value as string | null };
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;
const base = { credentials: "same-origin", mode: "same-origin", redirect: "error", referrerPolicy: "same-origin", cache: "no-store" } as const;

async function parse(response: Response): Promise<AccountTimeTrialPreferences> {
  const body = await response.json() as Record<string, unknown>;
  if (response.status !== 200 || body["schemaVersion"] !== "mk8dx.account-time-trial-preferences.v1" ||
      (body["modePreference"] !== "all" && body["modePreference"] !== "150" && body["modePreference"] !== "200") ||
      (body["trackAccess"] !== "unknown" && body["trackAccess"] !== "base_only" && body["trackAccess"] !== "base_and_bcp") ||
      (body["screenName"] !== null && typeof body["screenName"] !== "string")) {
    throw new Error("preferences unavailable");
  }
  return {
    modePreference: body["modePreference"],
    screenName: body["screenName"] as string | null,
    trackAccess: body["trackAccess"],
  };
}

export function createAccountTimeTrialPreferenceClient(fetchPort: FetchPort = globalThis.fetch.bind(globalThis)): AccountTimeTrialPreferenceClient {
  return {
    async read(signal) {
      return parse(await fetchPort("/v1/account/time-trial-preferences", { ...base, method: "GET", headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }) }));
    },
    async save(value, signal) {
      const csrf = await fetchPort("/v1/session/csrf", { ...base, method: "GET", headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }) });
      if (csrf.status !== 200) throw new Error("preferences unavailable");
      const proof = await csrf.json() as Record<string, unknown>;
      if (typeof proof["headerName"] !== "string" || typeof proof["value"] !== "string") throw new Error("preferences unavailable");
      return parse(await fetchPort("/v1/account/time-trial-preferences", {
        ...base, method: "PUT", headers: { Accept: "application/json", "Content-Type": "application/json", [proof["headerName"]]: proof["value"] },
        body: JSON.stringify(value), ...(signal === undefined ? {} : { signal }),
      }));
    },
  };
}

export function mountAccountTimeTrialSettings(
  root: HTMLElement,
  client: AccountTimeTrialPreferenceClient = createAccountTimeTrialPreferenceClient(),
): Readonly<{ ready: Promise<void>; unmount(): void }> {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  const section = document.createElement("section");
  section.className = "ds-panel country-settings";
  const title = document.createElement("h3");
  title.className = "ds-title";
  title.textContent = "Time Trial preferences";
  const note = document.createElement("p");
  note.className = "ds-panel__note country-settings__note";
  note.textContent = "Choose which engine classes are relevant across Home, rankings and notifications. All is the default.";
  const modeLabel = document.createElement("label");
  modeLabel.className = "ds-field";
  modeLabel.textContent = "Relevant engine classes (optional)";
  const mode = document.createElement("select");
  mode.className = "ds-select country-settings__select";
  for (const [value, label] of [["all", "All — 150cc and 200cc"], ["150", "150cc only"], ["200", "200cc only"]] as const) {
    const option = document.createElement("option"); option.value = value; option.textContent = label; mode.append(option);
  }
  modeLabel.append(mode);
  const modeNote = document.createElement("p");
  modeNote.className = "ds-field__hint country-settings__note";
  modeNote.textContent = "Optional. ‘All’ is preselected, so you can keep the default.";
  const trackAccessLabel = document.createElement("label");
  trackAccessLabel.className = "ds-field";
  trackAccessLabel.textContent = "Do you have the Booster Course Pass?";
  const trackAccess = document.createElement("select");
  trackAccess.className = "ds-select country-settings__select";
  for (const [value, label] of [
    ["unknown", "Choose an answer"],
    ["base_only", "No — base 48 tracks"],
    ["base_and_bcp", "Yes — all 96 tracks"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    trackAccess.append(option);
  }
  trackAccessLabel.append(trackAccess);
  const trackAccessNote = document.createElement("p");
  trackAccessNote.className = "ds-field__hint country-settings__note";
  trackAccessNote.textContent = "This sets your default progress and ranking scope. Every public track remains available.";
  const screenLabel = document.createElement("label");
  screenLabel.className = "ds-field";
  screenLabel.textContent = "Screen name (optional)";
  const screenName = document.createElement("input");
  screenName.className = "ds-input country-settings__select";
  screenName.maxLength = 32;
  screenName.placeholder = "For example BAwSer";
  screenName.autocomplete = "off";
  screenLabel.append(screenName);
  const screenNote = document.createElement("p");
  screenNote.className = "ds-field__hint country-settings__note";
  screenNote.textContent = "Optional name used in-game. Your Player username and account stay the same.";
  const saveMode = document.createElement("button"); saveMode.type = "button"; saveMode.className = "ds-button"; saveMode.setAttribute("data-variant", "secondary"); saveMode.textContent = "Save Time Trial preference";
  const modeStatus = document.createElement("p"); modeStatus.className = "ds-body-s country-settings__status"; modeStatus.setAttribute("role", "status");
  const saveTrackAccess = document.createElement("button"); saveTrackAccess.type = "button"; saveTrackAccess.className = "ds-button"; saveTrackAccess.setAttribute("data-variant", "secondary"); saveTrackAccess.textContent = "Save track access";
  const trackAccessStatus = document.createElement("p"); trackAccessStatus.className = "ds-body-s country-settings__status"; trackAccessStatus.setAttribute("role", "status");
  const saveScreenName = document.createElement("button"); saveScreenName.type = "button"; saveScreenName.className = "ds-button"; saveScreenName.setAttribute("data-variant", "secondary"); saveScreenName.textContent = "Save screen name";
  const screenStatus = document.createElement("p"); screenStatus.className = "ds-body-s country-settings__status"; screenStatus.setAttribute("role", "status");
  saveMode.disabled = true;
  saveTrackAccess.disabled = true;
  saveScreenName.disabled = true;
  section.append(title, note, modeLabel, modeNote, saveMode, modeStatus,
    trackAccessLabel, trackAccessNote, saveTrackAccess, trackAccessStatus,
    screenLabel, screenNote, saveScreenName, screenStatus);
  root.append(section);
  let persisted: AccountTimeTrialPreferences | null = null;
  const ready = client.read(controller.signal).then((value) => {
    if (disposed) return;
    persisted = value;
    mode.value = value.modePreference;
    trackAccess.value = value.trackAccess;
    screenName.value = value.screenName ?? "";
    saveMode.disabled = false;
    saveTrackAccess.disabled = false;
    saveScreenName.disabled = false;
  }).catch(() => { if (!disposed) { modeStatus.textContent = "Preferences could not be loaded. Reload before saving this field."; trackAccessStatus.textContent = modeStatus.textContent; screenStatus.textContent = modeStatus.textContent; } });
  saveMode.addEventListener("click", () => {
    if (persisted === null) { modeStatus.textContent = "Wait until the saved preference has loaded."; return; }
    saveMode.disabled = true; modeStatus.textContent = "Saving…";
    const update = accountPreferenceFieldUpdate(
      persisted,
      "modePreference",
      mode.value as TimeTrialModePreference,
    );
    void client.save(update, controller.signal)
      .then((value) => { if (!disposed) { persisted = value; mode.value = value.modePreference; modeStatus.textContent = "Saved. Home and notifications now use this preference."; } })
      .catch(() => { if (!disposed) modeStatus.textContent = "This preference could not be saved. The screen-name field was not changed."; })
      .finally(() => { if (!disposed) saveMode.disabled = false; });
  });
  saveTrackAccess.addEventListener("click", () => {
    if (persisted === null) { trackAccessStatus.textContent = "Wait until the saved preference has loaded."; return; }
    if (trackAccess.value === "unknown") {
      trackAccessStatus.textContent = "Choose Yes or No before saving.";
      trackAccess.focus?.();
      return;
    }
    saveTrackAccess.disabled = true;
    trackAccessStatus.textContent = "Saving…";
    const update = accountPreferenceFieldUpdate(
      persisted,
      "trackAccess",
      trackAccess.value as TimeTrialTrackAccess,
    );
    void client.save(update, controller.signal)
      .then((value) => {
        if (!disposed) {
          persisted = value;
          trackAccess.value = value.trackAccess;
          trackAccessStatus.textContent = "Saved. Progress and rankings now use this default.";
        }
      })
      .catch(() => { if (!disposed) trackAccessStatus.textContent = "Track access could not be saved. Other fields were not changed."; })
      .finally(() => { if (!disposed) saveTrackAccess.disabled = false; });
  });
  saveScreenName.addEventListener("click", () => {
    if (persisted === null) { screenStatus.textContent = "Wait until the saved screen name has loaded."; return; }
    const trimmed = screenName.value.trim();
    if (trimmed.length > 32 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
      screenName.setAttribute("aria-invalid", "true");
      screenStatus.textContent = "Use at most 32 printable characters, or leave this optional field empty.";
      screenName.focus?.();
      return;
    }
    screenName.setAttribute("aria-invalid", "false");
    saveScreenName.disabled = true; screenStatus.textContent = "Saving…";
    const update = accountPreferenceFieldUpdate(
      persisted,
      "screenName",
      trimmed || null,
    );
    void client.save(update, controller.signal)
      .then((value) => { if (!disposed) { persisted = value; screenName.value = value.screenName ?? ""; screenStatus.textContent = "Screen name saved. The engine-class field was not changed."; } })
      .catch(() => { if (!disposed) screenStatus.textContent = "Screen name could not be saved. Your entered value is preserved."; })
      .finally(() => { if (!disposed) saveScreenName.disabled = false; });
  });
  return { ready, unmount() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    if (section.parentNode === root) root.removeChild(section);
  } };
}
