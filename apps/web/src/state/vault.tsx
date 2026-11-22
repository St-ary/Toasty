import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";
import {
  changeMasterPassword as rotateMasterPassword,
  createAccount,
  createBackup,
  decryptItem,
  deriveFromMasterPassword,
  encryptItem,
  openBackup,
  unlock as unlockFromPassword,
  unlockWithRecoveryCode as openWithRecoveryCode,
  unwrapSecret,
  wipe,
} from "@toasty/crypto";
import type { BackupFile, ItemPayload, ItemType, RestoredItem } from "@toasty/crypto";
import { api, ApiError } from "../lib/api";
import type { AuthResponse, ItemRecord, KdfInfo, VaultMeta } from "../lib/api";
import { clearSession, loadSession, saveSession, updateSessionVault } from "../lib/session";
import type { StoredSession } from "../lib/session";
import { clearCache, emptyCache, loadCache, saveCache } from "../lib/vault-cache";
import type { VaultCache } from "../lib/vault-cache";

export type VaultStatus = "signedOut" | "needsUnlock" | "unlocked";
export type SyncStatus = "synced" | "syncing" | "offline" | "error";

const AUTO_LOCK_MS = 15 * 60 * 1000;
const BATCH_LIMIT = 500;

export interface ImportResult {
  imported: number;
  skipped: number;
}

export interface VaultContextValue {
  status: VaultStatus;
  email: string | null;
  vaultMeta: VaultMeta | null;
  vaultKey: Uint8Array | null;
  items: ItemRecord[];
  decrypted: ReadonlyMap<string, ItemPayload>;
  syncStatus: SyncStatus;
  lastSync: string | null;
  busy: boolean;
  hasCachedMeta: boolean;
  hasCachedRecovery: boolean;
  register: (email: string, masterPassword: string, setupToken: string) => Promise<string>;
  login: (email: string, masterPassword: string) => Promise<void>;
  unlockWithPassword: (masterPassword: string) => Promise<void>;
  unlockWithRecovery: (recoveryCode: string) => Promise<void>;
  lock: () => void;
  signOut: () => Promise<void>;
  sync: () => Promise<void>;
  addItem: (type: ItemType | "folder", payload: ItemPayload) => Promise<string>;
  updateItem: (id: string, type: ItemType | "folder", payload: ItemPayload) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  createFolder: (name: string) => Promise<string>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  changeMasterPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  exportBackup: (exportPassword: string) => Promise<BackupFile>;
  importBackup: (exportPassword: string, file: BackupFile) => Promise<ImportResult>;
  importItems: (entries: Array<{ type: ItemType; payload: ItemPayload }>) => Promise<ImportResult>;
  clearLocalCache: () => void;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault(): VaultContextValue {
  const context = useContext(VaultContext);
  if (context === null) throw new Error("useVault must be used within a VaultProvider");
  return context;
}

function requireCache(ref: MutableRefObject<VaultCache | null>): VaultCache {
  const cache = ref.current;
  if (cache === null) throw new Error("Vault cache is not initialized");
  return cache;
}

function requireKey(ref: MutableRefObject<Uint8Array | null>): Uint8Array {
  const key = ref.current;
  if (key === null) throw new Error("The vault is locked");
  return key;
}

export function VaultProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [status, setStatus] = useState<VaultStatus>(() => (loadSession() === null ? "signedOut" : "needsUnlock"));
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [decrypted, setDecrypted] = useState<ReadonlyMap<string, ItemPayload>>(new Map());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("synced");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const vaultKeyRef = useRef<Uint8Array | null>(null);
  const cacheRef = useRef<VaultCache | null>(null);
  if (cacheRef.current === null) cacheRef.current = loadCache();

  const commit = useCallback(() => {
    const cache = requireCache(cacheRef);
    saveCache(cache);
    setItems(Object.values(cache.items));
    setLastSync(cache.lastSync);
  }, []);

  const wipeKey = useCallback(() => {
    if (vaultKeyRef.current !== null) {
      wipe(vaultKeyRef.current);
      vaultKeyRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (status !== "unlocked" || vaultKeyRef.current === null) {
      setDecrypted(new Map());
      return;
    }
    let cancelled = false;
    const key = vaultKeyRef.current;
    void (async () => {
      const next = new Map<string, ItemPayload>();
      for (const record of items) {
        if (record.deleted) continue;
        try {
          next.set(record.id, await decryptItem<ItemPayload>(key, record.id, record));
        } catch {
          continue;
        }
      }
      if (!cancelled) setDecrypted(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [items, status]);

  const expireSession = useCallback(() => {
    api.setToken(null);
    wipeKey();
    clearSession();
    clearCache();
    cacheRef.current = emptyCache();
    commit();
    setSession(null);
    setStatus("signedOut");
    setSyncStatus("synced");
  }, [commit, wipeKey]);

  const maybeRefreshSession = useCallback(async (): Promise<void> => {
    const current = loadSession();
    if (current === null) return;
    api.setToken(current.token);
    const expiresMs = current.expiresAt === undefined ? 0 : new Date(current.expiresAt).getTime();
    if (expiresMs - Date.now() > 12 * 60 * 60 * 1000) return;
    try {
      const refreshed = await api.refreshSession();
      saveSession({ ...current, expiresAt: refreshed.expiresAt });
      setSession((prev) => (prev === null ? prev : { ...prev, expiresAt: refreshed.expiresAt }));
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === "session_expired" || error.code === "unauthorized")
      ) {
        expireSession();
      }
    }
  }, [expireSession]);

  useEffect(() => {
    void maybeRefreshSession();
  }, [maybeRefreshSession]);

  const sync = useCallback(async (): Promise<void> => {
    if (vaultKeyRef.current === null) return;
    const cache = requireCache(cacheRef);
    setSyncStatus("syncing");
    try {
      const pulled = await api.listItems(cache.lastSync);
      for (const record of pulled.items) {
        if (cache.dirty.includes(record.id)) continue;
        if (record.deleted) delete cache.items[record.id];
        else cache.items[record.id] = record;
      }
      cache.lastSync = pulled.serverTime;

      const dirtyIds = [...cache.dirty];
      const dirtyRecords = dirtyIds
        .map((id) => cache.items[id])
        .filter((record): record is ItemRecord => record !== undefined);

      const pushed = new Map<string, string>();
      for (let i = 0; i < dirtyRecords.length; i += BATCH_LIMIT) {
        const chunk = dirtyRecords.slice(i, i + BATCH_LIMIT);
        for (const record of chunk) pushed.set(record.id, record.ciphertext);
        const response = await api.batchUpsert({
          items: chunk.map((record) => ({
            id: record.id,
            type: record.type,
            ciphertext: record.ciphertext,
            iv: record.iv,
            deleted: record.deleted,
          })),
        });
        for (const stored of response.items) {
          if (stored.deleted) delete cache.items[stored.id];
          else cache.items[stored.id] = stored;
        }
        cache.lastSync = response.serverTime;
      }

      cache.dirty = cache.dirty.filter((id) => {
        const sent = pushed.get(id);
        return sent === undefined || (cache.items[id]?.ciphertext ?? null) !== sent;
      });

      commit();
      setSyncStatus("synced");
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === "session_expired" || error.code === "unauthorized")
      ) {
        expireSession();
        return;
      }
      if (error instanceof ApiError && error.status === 0) setSyncStatus("offline");
      else setSyncStatus("error");
    }
  }, [commit, expireSession]);

  const applyAuth = useCallback(
    (auth: AuthResponse, vaultKey: Uint8Array) => {
      saveSession({ token: auth.token, user: auth.user, vault: auth.vault, expiresAt: auth.expiresAt });
      api.setToken(auth.token);
      const cache = requireCache(cacheRef);
      if (cache.userId !== auth.user.id) {
        cacheRef.current = {
          ...emptyCache(),
          userId: auth.user.id,
          kdf: auth.vault.kdf,
          wrappedVaultKey: auth.vault.wrappedVaultKey,
          recoveryWrappedVaultKey: auth.vault.recoveryWrappedVaultKey,
        };
      } else {
        cache.userId = auth.user.id;
        cache.kdf = auth.vault.kdf;
        cache.wrappedVaultKey = auth.vault.wrappedVaultKey;
        cache.recoveryWrappedVaultKey = auth.vault.recoveryWrappedVaultKey;
      }
      wipeKey();
      vaultKeyRef.current = vaultKey;
      commit();
      setSession({ token: auth.token, user: auth.user, vault: auth.vault, expiresAt: auth.expiresAt });
      setStatus("unlocked");
      setSyncStatus("synced");
    },
    [commit, wipeKey],
  );

  const register = useCallback(
    async (email: string, masterPassword: string, setupToken: string): Promise<string> => {
      setBusy(true);
      try {
        const account = await createAccount(email, masterPassword);
        const auth = await api.register({
          email: account.setup.email,
          setupToken: setupToken.trim(),
          kdf: { salt: account.setup.kdfSalt, iterations: account.setup.kdfIterations },
          authKey: account.setup.authKey,
          wrappedVaultKey: account.setup.wrappedVaultKey,
          recoveryWrappedVaultKey: account.setup.recoveryWrappedVaultKey,
        });
        applyAuth(auth, account.vaultKey);
        void sync();
        return account.recoveryCode;
      } finally {
        setBusy(false);
      }
    },
    [applyAuth, sync],
  );

  const login = useCallback(
    async (email: string, masterPassword: string): Promise<void> => {
      setBusy(true);
      try {
        let kdf: KdfInfo | null = null;
        try {
          const preflight = await api.getKdf(email);
          kdf = preflight.kdf;
        } catch (error) {
          const cache = requireCache(cacheRef);
          const cached = cache.kdf ?? session?.vault.kdf ?? null;
          const missingKdf =
            error instanceof ApiError && (error.code === "not_found" || error.status === 404);
          if (missingKdf && cached !== null) {
            kdf = cached;
          } else if (missingKdf) {
            throw new ApiError("invalid_credentials", "Email or master password is incorrect", 401);
          } else {
            throw error;
          }
        }

        const { authKey, wrapKey } = await deriveFromMasterPassword(
          masterPassword,
          kdf.salt,
          kdf.iterations,
        );
        let auth: AuthResponse;
        try {
          auth = await api.login(email, authKey);
        } catch (error) {
          if (error instanceof ApiError && error.code === "invalid_credentials") {
            throw new ApiError("invalid_credentials", "Email or master password is incorrect", 401);
          }
          throw error;
        }
        const vaultKey = await unwrapSecret(wrapKey, auth.vault.wrappedVaultKey);
        wipe(wrapKey);
        applyAuth(auth, vaultKey);
        void sync();
      } finally {
        setBusy(false);
      }
    },
    [applyAuth, session, sync],
  );

  const unlockWithPassword = useCallback(
    async (masterPassword: string): Promise<void> => {
      setBusy(true);
      try {
        const cache = requireCache(cacheRef);
        const meta = session?.vault ?? null;
        const kdfSalt = meta?.kdf.salt ?? cache.kdf?.salt ?? null;
        const kdfIterations = meta?.kdf.iterations ?? cache.kdf?.iterations ?? null;
        const wrappedVaultKey = meta?.wrappedVaultKey ?? cache.wrappedVaultKey ?? null;
        if (kdfSalt === null || kdfIterations === null || wrappedVaultKey === null) {
          throw new Error("No cached key material on this device — please sign in again");
        }
        const vaultKey = await unlockFromPassword(masterPassword, {
          kdfSalt,
          kdfIterations,
          wrappedVaultKey,
        });
        wipeKey();
        vaultKeyRef.current = vaultKey;
        if (session !== null) api.setToken(session.token);
        setStatus("unlocked");
        void sync();
      } finally {
        setBusy(false);
      }
    },
    [session, sync, wipeKey],
  );

  const unlockWithRecovery = useCallback(
    async (recoveryCode: string): Promise<void> => {
      setBusy(true);
      try {
        const cache = requireCache(cacheRef);
        const wrapped =
          session?.vault.recoveryWrappedVaultKey ?? cache.recoveryWrappedVaultKey ?? null;
        if (wrapped === null) {
          throw new Error("No recovery key material is cached on this device");
        }
        const vaultKey = await openWithRecoveryCode(recoveryCode, wrapped);
        wipeKey();
        vaultKeyRef.current = vaultKey;
        if (session !== null) api.setToken(session.token);
        setStatus("unlocked");
        void sync();
      } finally {
        setBusy(false);
      }
    },
    [session, sync, wipeKey],
  );

  const lock = useCallback(() => {
    wipeKey();
    setStatus(session === null ? "signedOut" : "needsUnlock");
    setSyncStatus("synced");
  }, [session, wipeKey]);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await api.logout();
    } catch {
      // local sign-out must proceed even when the server is unreachable
    }
    expireSession();
  }, [expireSession]);

  const addItem = useCallback(
    async (type: ItemType | "folder", payload: ItemPayload): Promise<string> => {
      const vaultKey = requireKey(vaultKeyRef);
      const cache = requireCache(cacheRef);
      const id = crypto.randomUUID();
      const { ciphertext, iv } = await encryptItem(vaultKey, id, payload);
      cache.items[id] = {
        id,
        type,
        ciphertext,
        iv,
        deleted: false,
        updatedAt: new Date().toISOString(),
      };
      if (!cache.dirty.includes(id)) cache.dirty.push(id);
      commit();
      void sync();
      return id;
    },
    [commit, sync],
  );

  const updateItem = useCallback(
    async (id: string, type: ItemType | "folder", payload: ItemPayload): Promise<void> => {
      const vaultKey = requireKey(vaultKeyRef);
      const cache = requireCache(cacheRef);
      const { ciphertext, iv } = await encryptItem(vaultKey, id, payload);
      cache.items[id] = {
        id,
        type,
        ciphertext,
        iv,
        deleted: false,
        updatedAt: new Date().toISOString(),
      };
      if (!cache.dirty.includes(id)) cache.dirty.push(id);
      commit();
      void sync();
    },
    [commit, sync],
  );

  const deleteItem = useCallback(
    async (id: string): Promise<void> => {
      const cache = requireCache(cacheRef);
      const existing = cache.items[id];
      if (existing === undefined) return;
      cache.items[id] = {
        ...existing,
        deleted: true,
        updatedAt: new Date().toISOString(),
      };
      if (!cache.dirty.includes(id)) cache.dirty.push(id);
      commit();
      void sync();
    },
    [commit, sync],
  );

  const createFolder = useCallback(
    async (name: string): Promise<string> => addItem("folder", { name: name.trim() }),
    [addItem],
  );

  const renameFolder = useCallback(
    async (id: string, name: string): Promise<void> => {
      const vaultKey = requireKey(vaultKeyRef);
      const cache = requireCache(cacheRef);
      const record = cache.items[id];
      if (record === undefined || record.deleted) return;
      const payload = await decryptItem<ItemPayload>(vaultKey, record.id, record);
      await updateItem(id, "folder", { ...payload, name: name.trim() });
    },
    [updateItem],
  );

  const deleteFolder = useCallback(
    async (id: string): Promise<void> => {
      const vaultKey = requireKey(vaultKeyRef);
      const cache = requireCache(cacheRef);
      const folderRecord = cache.items[id];
      if (folderRecord === undefined || folderRecord.deleted) return;
      for (const record of Object.values(cache.items)) {
        if (record.deleted || record.id === id || record.type === "folder") continue;
        try {
          const payload = await decryptItem<ItemPayload>(vaultKey, record.id, record);
          const withFolder = payload as { folderId?: string };
          if (withFolder.folderId !== id) continue;
          delete withFolder.folderId;
          await updateItem(record.id, record.type as ItemType, payload);
        } catch {
          continue;
        }
      }
      await deleteItem(id);
    },
    [deleteItem, updateItem],
  );

  const changeMasterPassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      const cache = requireCache(cacheRef);
      const meta = session?.vault ?? null;
      const kdfSalt = meta?.kdf.salt ?? cache.kdf?.salt ?? null;
      const kdfIterations = meta?.kdf.iterations ?? cache.kdf?.iterations ?? null;
      const wrappedVaultKey = meta?.wrappedVaultKey ?? cache.wrappedVaultKey ?? null;
      if (kdfSalt === null || kdfIterations === null || wrappedVaultKey === null) {
        throw new Error("No cached key material on this device — please sign in again");
      }
      setBusy(true);
      try {
        const changed = await rotateMasterPassword(currentPassword, newPassword, {
          kdfSalt,
          kdfIterations,
          wrappedVaultKey,
        });
        await api.updateVaultKey({
          authKey: changed.authKey,
          kdf: { salt: changed.kdfSalt, iterations: changed.kdfIterations },
          wrappedVaultKey: changed.wrappedVaultKey,
        });
        const updated: VaultMeta = {
          kdf: { salt: changed.kdfSalt, iterations: changed.kdfIterations },
          wrappedVaultKey: changed.wrappedVaultKey,
          recoveryWrappedVaultKey: meta?.recoveryWrappedVaultKey ?? cache.recoveryWrappedVaultKey,
        };
        updateSessionVault(updated);
        cache.kdf = updated.kdf;
        cache.wrappedVaultKey = updated.wrappedVaultKey;
        cache.recoveryWrappedVaultKey = updated.recoveryWrappedVaultKey;
        commit();
        if (session !== null) setSession({ ...session, vault: updated });
      } finally {
        setBusy(false);
      }
    },
    [commit, session],
  );

  const exportBackup = useCallback(async (exportPassword: string): Promise<BackupFile> => {
    const vaultKey = requireKey(vaultKeyRef);
    const cache = requireCache(cacheRef);
    const records = Object.values(cache.items).filter((record) => !record.deleted);
    return createBackup(exportPassword, vaultKey, records);
  }, []);

  const importEntries = useCallback(
    async (entries: Array<{ type: string; payload: ItemPayload }>): Promise<ImportResult> => {
      const vaultKey = requireKey(vaultKeyRef);
      const cache = requireCache(cacheRef);

      const existingNames = new Set<string>();
      for (const record of Object.values(cache.items)) {
        if (record.deleted) continue;
        try {
          const payload = await decryptItem<ItemPayload>(vaultKey, record.id, record);
          existingNames.add(payload.name.trim().toLowerCase());
        } catch {
          continue;
        }
      }

      let imported = 0;
      let skipped = 0;
      for (const item of entries) {
        const name = item.payload.name.trim().toLowerCase();
        if (existingNames.has(name)) {
          skipped += 1;
          continue;
        }
        const id = crypto.randomUUID();
        const { ciphertext, iv } = await encryptItem(vaultKey, id, item.payload);
        cache.items[id] = {
          id,
          type: item.type,
          ciphertext,
          iv,
          deleted: false,
          updatedAt: new Date().toISOString(),
        };
        cache.dirty.push(id);
        existingNames.add(name);
        imported += 1;
      }
      commit();
      void sync();
      return { imported, skipped };
    },
    [commit, sync],
  );

  const importBackup = useCallback(
    async (exportPassword: string, file: BackupFile): Promise<ImportResult> => {
      const restored: RestoredItem[] = await openBackup(exportPassword, file);
      return importEntries(restored);
    },
    [importEntries],
  );

  const importItems = importEntries;

  const clearLocalCache = useCallback(() => {
    clearCache();
    cacheRef.current = emptyCache();
    commit();
    void sync();
  }, [commit, sync]);

  useEffect(() => {
    if (status !== "unlocked") return;
    let timer = window.setTimeout(lock, AUTO_LOCK_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, AUTO_LOCK_MS);
    };
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [status, lock]);

  const value = useMemo<VaultContextValue>(
    () => ({
      status,
      email: session?.user.email ?? null,
      vaultMeta: session?.vault ?? null,
      vaultKey: vaultKeyRef.current,
      items,
      decrypted,
      syncStatus,
      lastSync,
      busy,
      hasCachedMeta:
        (session?.vault.wrappedVaultKey ?? null) !== null ||
        (cacheRef.current?.wrappedVaultKey ?? null) !== null,
      hasCachedRecovery:
        (session?.vault.recoveryWrappedVaultKey ?? null) !== null ||
        (cacheRef.current?.recoveryWrappedVaultKey ?? null) !== null,
      register,
      login,
      unlockWithPassword,
      unlockWithRecovery,
      lock,
      signOut,
      sync,
      addItem,
      updateItem,
      deleteItem,
      createFolder,
      renameFolder,
      deleteFolder,
      changeMasterPassword,
      exportBackup,
      importBackup,
      importItems,
      clearLocalCache,
    }),
    [
      status,
      session,
      items,
      decrypted,
      syncStatus,
      lastSync,
      busy,
      register,
      login,
      unlockWithPassword,
      unlockWithRecovery,
      lock,
      signOut,
      sync,
      addItem,
      updateItem,
      deleteItem,
      createFolder,
      renameFolder,
      deleteFolder,
      changeMasterPassword,
      exportBackup,
      importBackup,
      importItems,
      clearLocalCache,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
