import { fetchRankPlayerDirectory } from "./time-trial-standing-view.js";

export type SocialGroupMember = Readonly<{ playerId: string; displayName: string; role: "owner" | "admin" | "member"; status: "invited" | "active" }>;
export type SocialGroup = Readonly<{ groupId: string; name: string; myRole: "owner" | "admin" | "member"; myStatus: "invited" | "active"; members: readonly SocialGroupMember[] }>;
export type SocialGroupsDocument = Readonly<{ groups: readonly SocialGroup[]; rankScope: Readonly<{ global: boolean; rivals: boolean; groupIds: readonly string[] }> }>;
export interface SocialGroupClient {
  list(signal?: AbortSignal): Promise<SocialGroupsDocument>;
  create(name: string, signal?: AbortSignal): Promise<void>;
  invite(groupId: string, playerId: string, signal?: AbortSignal): Promise<void>;
  respond(groupId: string, accept: boolean, signal?: AbortSignal): Promise<void>;
  leave(groupId: string, signal?: AbortSignal): Promise<void>;
  remove(groupId: string, playerId: string, signal?: AbortSignal): Promise<void>;
  setRole(groupId: string, playerId: string, role: "admin" | "member", signal?: AbortSignal): Promise<void>;
  archive(groupId: string, signal?: AbortSignal): Promise<void>;
  saveRankScope(scope: SocialGroupsDocument["rankScope"], signal?: AbortSignal): Promise<void>;
}
type FetchPort = (input: string, init: RequestInit) => Promise<Response>;
const base = { credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store" } as const;

export function createSocialGroupClient(fetchPort: FetchPort = globalThis.fetch.bind(globalThis)): SocialGroupClient {
  const csrf = async (signal?: AbortSignal) => {
    const response = await fetchPort("/v1/session/csrf", { ...base, method: "GET", headers: { Accept: "application/json" }, ...(signal ? { signal } : {}) });
    if (response.status !== 200) throw new Error("csrf unavailable");
    const value = await response.json() as Record<string, unknown>;
    if (typeof value["headerName"] !== "string" || typeof value["value"] !== "string") throw new Error("csrf invalid");
    return { name: value["headerName"], value: value["value"] };
  };
  const write = async (path: string, method: string, body: unknown, signal?: AbortSignal) => {
    const proof = await csrf(signal);
    const response = await fetchPort(path, { ...base, method, headers: { Accept: "application/json", "Content-Type": "application/json", [proof.name]: proof.value }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) });
    if (response.status !== 200 && response.status !== 201) throw new Error("group write unavailable");
  };
  return {
    async list(signal) {
      const response = await fetchPort("/v1/account/groups", { ...base, method: "GET", headers: { Accept: "application/json" }, ...(signal ? { signal } : {}) });
      if (response.status !== 200) throw new Error("groups unavailable");
      const body = await response.json() as SocialGroupsDocument & { schemaVersion?: string };
      if (body.schemaVersion !== "mk8dx.social-groups.v1" || !Array.isArray(body.groups) || body.rankScope === undefined) throw new Error("groups invalid");
      return body;
    },
    create: (name, signal) => write("/v1/account/groups", "POST", { name }, signal),
    invite: (groupId, playerId, signal) => write(`/v1/account/groups/${encodeURIComponent(groupId)}/invitations`, "POST", { playerId }, signal),
    respond: (groupId, accept, signal) => write(`/v1/account/groups/${encodeURIComponent(groupId)}/invitation`, "PUT", { accept }, signal),
    leave: (groupId, signal) => write(`/v1/account/groups/${encodeURIComponent(groupId)}/members/me`, "DELETE", undefined, signal),
    remove: (groupId, playerId, signal) => write(`/v1/account/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(playerId)}`, "DELETE", undefined, signal),
    setRole: (groupId, playerId, role, signal) => write(`/v1/account/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(playerId)}/role`, "PUT", { role }, signal),
    archive: (groupId, signal) => write(`/v1/account/groups/${encodeURIComponent(groupId)}`, "DELETE", undefined, signal),
    saveRankScope: (scope, signal) => write("/v1/account/rank-scope", "PUT", scope, signal),
  };
}

export type MountedSocialGroupSettings = Readonly<{ container: HTMLElement; ready: Promise<void>; unmount(): void }>;
export function mountSocialGroupSettings(root: HTMLElement, client: SocialGroupClient = createSocialGroupClient()): MountedSocialGroupSettings {
  const document = root.ownerDocument, controller = new AbortController(); let disposed = false, state: SocialGroupsDocument | null = null;
  const container = document.createElement("section"); container.className = "ds-panel rival-settings"; container.setAttribute("aria-label", "Private Groups");
  const heading = document.createElement("h3"); heading.className = "ds-title"; heading.textContent = "My Groups";
  const note = document.createElement("p"); note.className = "ds-panel__note rival-settings__note"; note.textContent = "Private accepted-membership Groups. Invitations, joins, exits and removals always produce a notification.";
  const createRow = document.createElement("div"); createRow.className = "rival-settings__add";
  const name = document.createElement("input"); name.className = "ds-input country-settings__select"; name.placeholder = "New Group name";
  const create = document.createElement("button"); create.type = "button"; create.className = "ds-button"; create.setAttribute("data-variant", "secondary"); create.textContent = "Create Group"; createRow.append(name, create);
  const list = document.createElement("div"), status = document.createElement("p"); status.className = "ds-body-s"; status.setAttribute("role", "status");
  container.append(heading, note, createRow, list, status); root.append(container);
  const reload = async () => { state = await client.list(controller.signal); if (!disposed) render(); };
  const action = (work: () => Promise<void>) => { status.textContent = "Saving…"; void work().then(reload).then(() => { status.textContent = ""; }, () => { status.textContent = "Could not update the Group."; }); };
  create.addEventListener("click", () => { if (name.value.trim().length >= 2) action(() => client.create(name.value.trim(), controller.signal)); });
  const render = () => {
    list.replaceChildren(); if (!state || !state.groups.length) { const empty = document.createElement("p"); empty.textContent = "No Groups yet."; list.append(empty); return; }
    for (const group of state.groups) {
      const card = document.createElement("article"); card.className = "ds-panel settings-card";
      const title = document.createElement("h4"); title.textContent = `${group.name} · ${group.myRole}`; card.append(title);
      if (group.myStatus === "invited") {
        const copy = document.createElement("p"); copy.textContent = "You were invited. Membership starts only after acceptance.";
        const accept = document.createElement("button"); accept.className = "ds-button"; accept.setAttribute("data-variant", "secondary"); accept.textContent = "Accept"; accept.addEventListener("click", () => action(() => client.respond(group.groupId, true, controller.signal)));
        const decline = document.createElement("button"); decline.className = "ds-button"; decline.setAttribute("data-variant", "quiet"); decline.textContent = "Decline"; decline.addEventListener("click", () => action(() => client.respond(group.groupId, false, controller.signal)));
        card.append(copy, accept, decline); list.append(card); continue;
      }
      const members = document.createElement("ul");
      group.members.filter((member) => member.status === "active").forEach((member) => {
        const row = document.createElement("li"); row.textContent = `${member.displayName} · ${member.role}`;
        if (group.myRole === "owner" && member.role !== "owner") {
          const role = document.createElement("button"); role.className = "ds-button"; role.setAttribute("data-variant", "quiet"); role.textContent = member.role === "admin" ? "Make member" : "Make admin";
          role.addEventListener("click", () => action(() => client.setRole(group.groupId, member.playerId, member.role === "admin" ? "member" : "admin", controller.signal))); row.append(role);
        }
        if ((group.myRole === "owner" || group.myRole === "admin") && member.role === "member") {
          const remove = document.createElement("button"); remove.className = "ds-button"; remove.setAttribute("data-variant", "danger"); remove.textContent = "Remove"; remove.addEventListener("click", () => action(() => client.remove(group.groupId, member.playerId, controller.signal))); row.append(remove);
        }
        members.append(row);
      }); card.append(members);
      if (group.myRole === "owner" || group.myRole === "admin") {
        const invite = document.createElement("input"); invite.placeholder = "Search Player to invite"; invite.className = "ds-input country-settings__select";
        const matches = document.createElement("div"); invite.addEventListener("input", () => { matches.replaceChildren(); const query = invite.value.trim(); if (query.length < 2) return; void fetchRankPlayerDirectory(query, controller.signal).then((players) => players.forEach((player) => { const button = document.createElement("button"); button.className = "ds-button"; button.setAttribute("data-variant", "secondary"); button.textContent = `Invite ${player.displayName}`; button.addEventListener("click", () => action(() => client.invite(group.groupId, player.playerId, controller.signal))); matches.append(button); })); }); card.append(invite, matches);
      }
      const exit = document.createElement("button"); exit.className = "ds-button"; exit.setAttribute("data-variant", "danger"); exit.textContent = group.myRole === "owner" ? "Archive Group" : "Leave Group";
      exit.addEventListener("click", () => action(() => group.myRole === "owner" ? client.archive(group.groupId, controller.signal) : client.leave(group.groupId, controller.signal))); card.append(exit); list.append(card);
    }
  };
  const ready = reload().catch(() => { status.textContent = "Groups are temporarily unavailable."; });
  return { container, ready, unmount(): void { if (disposed) return; disposed = true; controller.abort(); if (container.parentNode === root) root.removeChild(container); } };
}
