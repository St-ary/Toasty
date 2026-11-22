import type { ItemRecord, KdfInfo } from "./api";

const CACHE_KEY = "toasty.cache.v1";

export interface VaultCache {
  userId: string | null;
  lastSync: string | null;
  items: Record<string, ItemRecord>;
  dirty: string[];
  kdf: KdfInfo | null;
  wrappedVaultKey: string | null;
  recoveryWrappedVaultKey: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKdfInfo(value: unknown): value is KdfInfo {
  return isRecord(value) && typeof value.salt === "string" && typeof value.iterations === "number";
}

function isItemRecord(value: unknown): value is ItemRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.ciphertext === "string" &&
    typeof value.iv === "string" &&
    typeof value.deleted === "boolean" &&
    typeof value.updatedAt === "string"
  );
}

export function emptyCache(): VaultCache {
  return {
    userId: null,
    lastSync: null,
    items: {},
    dirty: [],
    kdf: null,
    wrappedVaultKey: null,
    recoveryWrappedVaultKey: null,
  };
}

export function loadCache(): VaultCache {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw === null) return emptyCache();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyCache();

    const items: Record<string, ItemRecord> = {};
    if (isRecord(parsed.items)) {
      for (const [id, value] of Object.entries(parsed.items)) {
        if (isItemRecord(value)) items[id] = value;
      }
    }

    const dirty = Array.isArray(parsed.dirty)
      ? parsed.dirty.filter((entry): entry is string => typeof entry === "string")
      : [];

    return {
      userId: typeof parsed.userId === "string" ? parsed.userId : null,
      lastSync: typeof parsed.lastSync === "string" ? parsed.lastSync : null,
      items,
      dirty,
      kdf: isKdfInfo(parsed.kdf) ? parsed.kdf : null,
      wrappedVaultKey: typeof parsed.wrappedVaultKey === "string" ? parsed.wrappedVaultKey : null,
      recoveryWrappedVaultKey:
        typeof parsed.recoveryWrappedVaultKey === "string" ? parsed.recoveryWrappedVaultKey : null,
    };
  } catch {
    return emptyCache();
  }
}

export function saveCache(cache: VaultCache): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    return;
  }
}

export function clearCache(): void {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    return;
  }
}
