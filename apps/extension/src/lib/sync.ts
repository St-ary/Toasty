import { ApiClient, ApiError, type RemoteItem } from "./api";
import { getLocalData, getSettings, updateLocalData } from "./settings";
import { getSession, lock, setSession } from "./session";
import type { CachedItem, SyncPhase, SyncStatus } from "./types";

const SYNC_STATUS_KEY = "syncStatus";
const BATCH_LIMIT = 500;

async function readPhase(): Promise<{ phase: SyncPhase; error: string | null }> {
  const stored = await chrome.storage.session.get(SYNC_STATUS_KEY);
  const value = stored[SYNC_STATUS_KEY];
  if (value && typeof value === "object") {
    const record = value as { phase?: unknown; error?: unknown };
    const phase =
      record.phase === "syncing" || record.phase === "offline" || record.phase === "error"
        ? record.phase
        : "idle";
    return { phase, error: typeof record.error === "string" ? record.error : null };
  }
  return { phase: "idle", error: null };
}

async function writePhase(phase: SyncPhase, error: string | null): Promise<void> {
  await chrome.storage.session.set({ [SYNC_STATUS_KEY]: { phase, error } });
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const [{ phase, error }, data] = await Promise.all([readPhase(), getLocalData()]);
  return { phase, lastSyncAt: data.lastSync, error };
}

function stripDirty(item: CachedItem): Omit<RemoteItem, "updatedAt"> {
  return {
    id: item.id,
    type: item.type,
    ciphertext: item.ciphertext,
    iv: item.iv,
    deleted: item.deleted,
  };
}

export async function syncNow(): Promise<SyncStatus> {
  let session = await getSession();
  if (!session) throw new Error("The vault is locked");
  const settings = await getSettings();
  const api = new ApiClient(settings.serverUrl);
  api.setToken(session.token);
  await writePhase("syncing", null);
  try {
    const expiresMs = session.expiresAt === undefined ? 0 : new Date(session.expiresAt).getTime();
    if (expiresMs - Date.now() <= 12 * 60 * 60 * 1000) {
      const refreshed = await api.refreshSession();
      session = { ...session, expiresAt: refreshed.expiresAt };
      await setSession(session);
    }
    const before = await getLocalData();
    const pulled = await api.listItems(before.lastSync);
    await updateLocalData((data) => {
      for (const item of pulled.items) {
        const local = data.items[item.id];
        if (local?.dirty) continue;
        if (local && local.updatedAt > item.updatedAt) continue;
        data.items[item.id] = { ...item };
      }
      data.lastSync = pulled.serverTime;
    });

    const dirtyItems = Object.values((await getLocalData()).items).filter((item) => item.dirty);
    for (let offset = 0; offset < dirtyItems.length; offset += BATCH_LIMIT) {
      const batch = dirtyItems.slice(offset, offset + BATCH_LIMIT).map(stripDirty);
      const pushed = await api.batchUpsert(batch);
      await updateLocalData((data) => {
        for (const item of pushed.items) {
          const local = data.items[item.id];
          if (local?.dirty && local.updatedAt > item.updatedAt) continue;
          data.items[item.id] = { ...item };
        }
      });
    }

    await writePhase("idle", null);
  } catch (err) {
    const expired =
      err instanceof ApiError && (err.code === "session_expired" || err.code === "unauthorized");
    if (expired) {
      await lock();
      await writePhase("error", "Session expired, sign in again");
      return getSyncStatus();
    }
    const offline = err instanceof ApiError && err.code === "network";
    const message = err instanceof Error ? err.message : "Sync failed";
    await writePhase(offline ? "offline" : "error", message);
  }
  return getSyncStatus();
}
