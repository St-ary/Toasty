import type { CachedKdf, KdfInfo, LocalData, Settings, VaultMeta } from "./types";
import { isRecord } from "./types";

export const DEFAULT_SERVER_URL = "https://vault.stary.lol";

const SETTINGS_KEY = "settings";
const LOCAL_KEY = "localData";

const DEFAULT_SETTINGS: Settings = {
  serverUrl: DEFAULT_SERVER_URL,
  email: "",
  autofillOnPageLoad: true,
  autoLockMinutes: 15,
  savePrompts: true,
  autofillLogins: true,
  autofillPasskeys: true,
  showTotpCodes: true,
  autofillAllowedHosts: [],
  autofillBlockedHosts: [],
};

function parseHostList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const host = entry.trim().toLowerCase().replace(/^www\./, "");
    if (host.length > 0) seen.add(host);
  }
  return [...seen];
}

function parseKdfInfo(value: unknown): KdfInfo | null {
  if (!isRecord(value)) return null;
  const { salt, iterations } = value;
  if (typeof salt !== "string" || typeof iterations !== "number" || !Number.isFinite(iterations)) return null;
  return { salt, iterations };
}

function parseKdf(value: unknown): CachedKdf | null {
  if (!isRecord(value)) return null;
  const info = parseKdfInfo(value);
  const { email } = value;
  if (!info || typeof email !== "string") return null;
  return { email, ...info };
}

function parseVaultMeta(value: unknown): VaultMeta | null {
  if (!isRecord(value)) return null;
  const { userId, email, wrappedVaultKey, recoveryWrappedVaultKey } = value;
  const kdf = parseKdfInfo(value.kdf);
  if (typeof userId !== "string" || typeof email !== "string") return null;
  if (typeof wrappedVaultKey !== "string" || typeof recoveryWrappedVaultKey !== "string") return null;
  if (!kdf) return null;
  return { userId, email, kdf, wrappedVaultKey, recoveryWrappedVaultKey };
}

function parseSettings(value: unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (!isRecord(value)) return out;
  if (typeof value.serverUrl === "string" && value.serverUrl.trim()) {
    out.serverUrl = value.serverUrl.trim().replace(/\/+$/, "");
  }
  if (typeof value.email === "string") out.email = value.email.trim();
  if (typeof value.autofillOnPageLoad === "boolean") out.autofillOnPageLoad = value.autofillOnPageLoad;
  if (typeof value.savePrompts === "boolean") out.savePrompts = value.savePrompts;
  if (typeof value.autofillLogins === "boolean") out.autofillLogins = value.autofillLogins;
  if (typeof value.autofillPasskeys === "boolean") out.autofillPasskeys = value.autofillPasskeys;
  if (typeof value.showTotpCodes === "boolean") out.showTotpCodes = value.showTotpCodes;
  if (Array.isArray(value.autofillAllowedHosts)) {
    out.autofillAllowedHosts = parseHostList(value.autofillAllowedHosts);
  }
  if (Array.isArray(value.autofillBlockedHosts)) {
    out.autofillBlockedHosts = parseHostList(value.autofillBlockedHosts);
  }
  if (typeof value.autoLockMinutes === "number" && Number.isFinite(value.autoLockMinutes)) {
    out.autoLockMinutes = Math.round(Math.min(480, Math.max(1, value.autoLockMinutes)));
  }
  return out;
}

function parseLocalData(value: unknown): Partial<LocalData> {
  const out: Partial<LocalData> = {};
  if (!isRecord(value)) return out;
  if (isRecord(value.items)) out.items = value.items as LocalData["items"];
  if (typeof value.lastSync === "string") out.lastSync = value.lastSync;
  out.cachedKdf = parseKdf(value.cachedKdf);
  out.vaultMeta = parseVaultMeta(value.vaultMeta);
  if (Array.isArray(value.neverSaveHosts)) {
    out.neverSaveHosts = value.neverSaveHosts.filter((host): host is string => typeof host === "string");
  }
  return out;
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...parseSettings(stored[SETTINGS_KEY]) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = parseSettings({ ...(await getSettings()), ...patch });
  const settings: Settings = { ...DEFAULT_SETTINGS, ...next };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  return settings;
}

export async function getLocalData(): Promise<LocalData> {
  const stored = await chrome.storage.local.get(LOCAL_KEY);
  const parsed = parseLocalData(stored[LOCAL_KEY]);
  return {
    items: parsed.items ?? {},
    lastSync: parsed.lastSync ?? null,
    cachedKdf: parsed.cachedKdf ?? null,
    vaultMeta: parsed.vaultMeta ?? null,
    neverSaveHosts: parsed.neverSaveHosts ?? [],
  };
}

export async function setLocalData(data: LocalData): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_KEY]: data });
}

export async function updateLocalData(mutate: (data: LocalData) => void): Promise<LocalData> {
  const data = await getLocalData();
  mutate(data);
  await setLocalData(data);
  return data;
}

export async function clearLocalData(): Promise<void> {
  await chrome.storage.local.remove(LOCAL_KEY);
}
