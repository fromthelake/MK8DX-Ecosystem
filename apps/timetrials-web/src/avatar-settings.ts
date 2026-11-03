// Profile character self-service: pick the exact canonical MK8DX
// appearance — base characters grouped with their colour/visual
// variants — as presentation metadata for the public profile. Never
// identity evidence, never a loadout, never rating input.

import {
  AVATAR_GROUPS,
  avatarAppearance,
  type AvatarGroup,
} from "./avatar-manifest.js";
import { GAME_ASSET_BASE } from "./asset-manifest.js";
import { dutchPresentation } from "./dutch-ui-copy.js";

export type MountedAvatarSettings = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export interface AvatarClient {
  setAvatar(avatarId: string | null, signal?: AbortSignal): Promise<void>;
}

export class AvatarClientError extends Error {
  public constructor(
    public readonly code:
      | "not_authenticated"
      | "no_verified_player"
      | "unavailable",
  ) {
    super("The profile character could not be saved.");
    this.name = "AvatarClientError";
  }
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

const baseInit = {
  credentials: "same-origin",
  mode: "same-origin",
  redirect: "error",
  referrerPolicy: "same-origin",
  cache: "no-store",
} as const;

export function createAvatarClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): AvatarClient {
  return {
    async setAvatar(avatarId, signal) {
      let proofResponse: Response;
      try {
        proofResponse = await fetchPort("/v1/session/csrf", {
          ...baseInit,
          method: "GET",
          headers: { Accept: "application/json" },
          ...(signal === undefined ? {} : { signal }),
        });
      } catch {
        throw new AvatarClientError("unavailable");
      }
      if (proofResponse.status === 401) {
        throw new AvatarClientError("not_authenticated");
      }
      if (proofResponse.status !== 200) {
        throw new AvatarClientError("unavailable");
      }
      const proof = await proofResponse.json() as Record<string, unknown>;
      if (proof["schemaVersion"] !== "mk8dx.web-csrf.v1" ||
          typeof proof["headerName"] !== "string" ||
          typeof proof["value"] !== "string") {
        throw new AvatarClientError("unavailable");
      }
      let response: Response;
      try {
        response = await fetchPort("/v1/account/player-avatar", {
          ...baseInit,
          method: "PUT",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            [proof["headerName"]]: proof["value"],
          },
          body: JSON.stringify({ avatarId }),
          ...(signal === undefined ? {} : { signal }),
        });
      } catch {
        throw new AvatarClientError("unavailable");
      }
      if (response.status === 401) {
        throw new AvatarClientError("not_authenticated");
      }
      if (response.status === 409) {
        throw new AvatarClientError("no_verified_player");
      }
      if (response.status !== 200) {
        throw new AvatarClientError("unavailable");
      }
    },
  };
}

export function mountAvatarSettings(
  root: HTMLElement,
  client: AvatarClient = createAvatarClient(),
  initialAvatarId: string | null = null,
): MountedAvatarSettings {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  let selectedId: string | null = initialAvatarId;
  let expandedGroup: AvatarGroup | null = null;

  const container = document.createElement("section");
  container.className = "avatar-settings";
  container.setAttribute("aria-label", "Profile character");
  const heading = document.createElement("h3");
  heading.textContent = "Profile character";
  const explanation = document.createElement("p");
  explanation.className = "avatar-settings__note";
  explanation.textContent =
    "Pick the character you race as — including colour variants. " +
    "Shown on your public profile. Purely cosmetic.";
  const preview = document.createElement("div");
  preview.className = "avatar-settings__preview";
  const previewIcon = document.createElement("img");
  previewIcon.className = "avatar-settings__preview-icon";
  previewIcon.alt = "";
  previewIcon.hidden = true;
  const previewName = document.createElement("span");
  previewName.className = "avatar-settings__preview-name";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "tt-auth__button";
  save.textContent = "Save";
  const clearChoice = document.createElement("button");
  clearChoice.type = "button";
  clearChoice.className = "tt-auth__button";
  clearChoice.textContent = "No character";
  preview.append(previewIcon, previewName, save, clearChoice);
  const grid = document.createElement("div");
  grid.className = "avatar-settings__grid";
  const variantRow = document.createElement("div");
  variantRow.className = "avatar-settings__variants";
  variantRow.hidden = true;
  const status = document.createElement("p");
  status.className = "avatar-settings__status";
  status.setAttribute("role", "status");
  container.append(heading, explanation, preview, grid, variantRow, status);
  root.append(container);

  const groupButtons = new Map<string, HTMLButtonElement>();
  const variantButtons = new Map<string, HTMLButtonElement>();

  const renderSelection = (): void => {
    const appearance = avatarAppearance(selectedId);
    if (appearance === undefined) {
      previewIcon.hidden = true;
      previewName.textContent = "No character selected";
    } else {
      previewIcon.src = `${GAME_ASSET_BASE}${appearance.iconPath}`;
      previewIcon.hidden = false;
      previewName.textContent = dutchPresentation(appearance.name);
    }
    for (const [id, buttonElement] of groupButtons) {
      const group = AVATAR_GROUPS.find((candidate) => candidate.id === id);
      const selectedInGroup = selectedId !== null && group !== undefined &&
        (group.id === selectedId ||
         group.variants.some((variant) => variant.id === selectedId));
      buttonElement.className = selectedInGroup
        ? "avatar-settings__option avatar-settings__option--active"
        : "avatar-settings__option";
    }
    for (const [id, buttonElement] of variantButtons) {
      buttonElement.className = id === selectedId
        ? "avatar-settings__option avatar-settings__option--active"
        : "avatar-settings__option";
    }
  };

  const renderVariants = (): void => {
    while (variantRow.firstChild !== null) {
      variantRow.removeChild(variantRow.firstChild);
    }
    variantButtons.clear();
    if (expandedGroup === null || expandedGroup.variants.length === 0) {
      variantRow.hidden = true;
      return;
    }
    variantRow.hidden = false;
    const label = document.createElement("span");
    label.className = "avatar-settings__variants-label";
    label.textContent = `${dutchPresentation(expandedGroup.name)} ${dutchPresentation("variants")}`;
    variantRow.append(label);
    const appearances = [
      { id: expandedGroup.id, name: expandedGroup.name,
        iconPath: expandedGroup.iconPath },
      ...expandedGroup.variants,
    ];
    for (const appearance of appearances) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "avatar-settings__option";
      option.title = appearance.name;
      option.setAttribute("aria-label", appearance.name);
      const icon = document.createElement("img");
      icon.className = "avatar-settings__icon";
      icon.src = `${GAME_ASSET_BASE}${appearance.iconPath}`;
      icon.alt = "";
      icon.loading = "lazy";
      option.append(icon);
      option.addEventListener("click", () => {
        selectedId = appearance.id;
        renderSelection();
      });
      variantButtons.set(appearance.id, option);
      variantRow.append(option);
    }
  };

  for (const group of AVATAR_GROUPS) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "avatar-settings__option";
    option.title = group.name;
    option.setAttribute("aria-label", group.name);
    const icon = document.createElement("img");
    icon.className = "avatar-settings__icon";
    icon.src = `${GAME_ASSET_BASE}${group.iconPath}`;
    icon.alt = "";
    icon.loading = "lazy";
    option.append(icon);
    if (group.variants.length > 0) {
      const marker = document.createElement("span");
      marker.className = "avatar-settings__more";
      marker.textContent = `+${group.variants.length}`;
      option.append(marker);
    }
    option.addEventListener("click", () => {
      selectedId = group.id;
      expandedGroup = group.variants.length > 0 ? group : null;
      renderVariants();
      renderSelection();
    });
    groupButtons.set(group.id, option);
    grid.append(option);
  }

  const persist = (avatarId: string | null): void => {
    save.disabled = true;
    status.textContent = "Saving…";
    client.setAvatar(avatarId, controller.signal).then(
      () => {
        if (!disposed) { status.textContent = "Saved."; }
      },
      (error: unknown) => {
        if (disposed) { return; }
        status.textContent =
          error instanceof AvatarClientError &&
          error.code === "no_verified_player"
            ? "Claim your Player first, then pick a character."
            : "The character could not be saved. Retry later.";
      },
    ).then(() => { save.disabled = false; });
  };
  save.addEventListener("click", () => persist(selectedId));
  clearChoice.addEventListener("click", () => {
    selectedId = null;
    expandedGroup = null;
    renderVariants();
    renderSelection();
    persist(null);
  });

  renderSelection();
  return {
    container,
    ready: Promise.resolve(),
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
