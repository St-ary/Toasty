import type { KdfInfo, SessionState, VaultMeta } from "./types";
import { isRecord } from "./types";
import { getSettings } from "./settings";

const SESSION_KEY = "session";

function parseKdf(value: unknown): KdfInfo | null {
  if (!isRecord(value)) return null;
  const { salt, iterations } = value;
  if (typeof salt !== "string" || typeof iterations !== "number" || !Number.isFinite(iterations)) return null;
  return { salt, iterations };
}

function parseVaultMeta(value: unknown): VaultMeta | null {
  if (!isRecord(value)) return null;
  const { userId, email, wrappedVaultKey, recoveryWrappedVaultKey } = value;
  const kdf = parseKdf(value.kdf);
  if (typeof userId !== "string" || typeof email !== "string") return null;
  if (typeof wrappedVaultKey !== "string" || typeof recoveryWrappedVaultKey !== "string") return null;
  if (!kdf) return null;
  return { userId, email, kdf, wrappedVaultKey, recoveryWrappedVaultKey };
}

function parseSession(value: unknown): SessionState | null {
  if (!isRecord(value)) return null;
  const { token, vaultKey, unlockedAt, lastActivityAt, expiresAt } = value;
  const vaultMeta = parseVaultMeta(value.vaultMeta);
  if (typeof token !== "string" || typeof vaultKey !== "string") return null;
  if (typeof unlockedAt !== "string" || typeof lastActivityAt !== "string") return null;
  if (!vaultMeta) return null;
  return {
    token,
    vaultKey,
    vaultMeta,
    unlockedAt,
    lastActivityAt,
    expiresAt: typeof expiresAt === "string" ? expiresAt : undefined,
  };
}

export async function getSession(): Promise<SessionState | null> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return parseSession(stored[SESSION_KEY]);
}

export async function setSession(state: SessionState): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: state });
}

export async function lock(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function touchActivity(): Promise<void> {
  const state = await getSession();
  if (!state) return;
  await setSession({ ...state, lastActivityAt: new Date().toISOString() });
}

export async function checkIdleLock(): Promise<boolean> {
  const state = await getSession();
  if (!state) return false;
  const { autoLockMinutes } = await getSettings();
  const idleMs = Date.now() - Date.parse(state.lastActivityAt);
  if (Number.isNaN(idleMs) || idleMs >= autoLockMinutes * 60_000) {
    await lock();
    return true;
  }
  return false;
}
