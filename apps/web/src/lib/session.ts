import type { UserInfo, VaultMeta } from "./api";

const SESSION_KEY = "toasty.session";

export interface StoredSession {
  token: string;
  user: UserInfo;
  vault: VaultMeta;
  expiresAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKdfInfo(value: unknown): value is VaultMeta["kdf"] {
  return isRecord(value) && typeof value.salt === "string" && typeof value.iterations === "number";
}

function isVaultMeta(value: unknown): value is VaultMeta {
  return (
    isRecord(value) &&
    isKdfInfo(value.kdf) &&
    typeof value.wrappedVaultKey === "string" &&
    (typeof value.recoveryWrappedVaultKey === "string" || value.recoveryWrappedVaultKey === null)
  );
}

function isUserInfo(value: unknown): value is UserInfo {
  return isRecord(value) && typeof value.id === "string" && typeof value.email === "string";
}

function isStoredSession(value: unknown): value is StoredSession {
  return (
    isRecord(value) &&
    typeof value.token === "string" &&
    isUserInfo(value.user) &&
    isVaultMeta(value.vault)
  );
}

export function loadSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    return;
  }
}

export function updateSessionVault(vault: VaultMeta): void {
  const session = loadSession();
  if (session === null) return;
  saveSession({ ...session, vault });
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    return;
  }
}
