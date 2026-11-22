import type { ItemPayload, ItemRecord, LoginItem, PasskeyItem } from "@toasty/crypto";

export type { ItemPayload, ItemRecord, LoginItem, PasskeyItem };

export interface Settings {
  serverUrl: string;
  email: string;
  autofillOnPageLoad: boolean;
  autoLockMinutes: number;
  savePrompts: boolean;
  autofillLogins: boolean;
  autofillPasskeys: boolean;
  showTotpCodes: boolean;
  autofillAllowedHosts: string[];
  autofillBlockedHosts: string[];
}

export interface KdfInfo {
  salt: string;
  iterations: number;
}

export interface VaultMeta {
  userId: string;
  email: string;
  kdf: KdfInfo;
  wrappedVaultKey: string;
  recoveryWrappedVaultKey: string;
}

export interface SessionState {
  token: string;
  vaultKey: string;
  vaultMeta: VaultMeta;
  unlockedAt: string;
  lastActivityAt: string;
  expiresAt?: string;
}

export interface CachedItem extends ItemRecord {
  dirty?: boolean;
}

export interface CachedKdf extends KdfInfo {
  email: string;
}

export interface LocalData {
  items: Record<string, CachedItem>;
  lastSync: string | null;
  cachedKdf: CachedKdf | null;
  vaultMeta: VaultMeta | null;
  neverSaveHosts: string[];
}

export type SyncPhase = "idle" | "syncing" | "offline" | "error";

export interface SyncStatus {
  phase: SyncPhase;
  lastSyncAt: string | null;
  error: string | null;
}

export interface LoginMatch {
  id: string;
  name: string;
  username: string;
  score: number;
  host: string;
  autofill: boolean;
  hasPassword: boolean;
  hasTotp: boolean;
}

export interface LoginSummary {
  id: string;
  name: string;
  username: string;
  urls: string[];
  hasTotp: boolean;
  hasPassword: boolean;
  autofill: boolean;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface PasskeyMatch {
  id: string;
  name: string;
  username: string;
  rpId: string;
}

export interface PasskeySummary {
  id: string;
  name: string;
  username: string;
  rpId: string;
  urls: string[];
  autofill: boolean;
}

export interface PasskeyAssertionResult {
  credentialId: string;
  userHandle: string | null;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

export interface PasskeyRegistrationResultWire {
  credentialId: string;
  userHandle: string;
  attestationObject: string;
  clientDataJSON: string;
  transports: string[];
}

export interface StatusReport {
  locked: boolean;
  email: string;
  serverUrl: string;
  sync: SyncStatus;
  settings: Settings;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
