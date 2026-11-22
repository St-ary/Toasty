import {
  decryptItem,
  encryptItem,
  fromBase64Url,
  type ItemPayload,
  type LoginItem,
  type PasskeyItem,
} from "@toasty/crypto";
import { getLocalData, updateLocalData } from "./settings";
import { getSession } from "./session";
import type { CachedItem, Credentials, LoginSummary, PasskeySummary } from "./types";

const memo = new Map<string, ItemPayload>();
let memoKey = "";

export function clearVaultMemo(): void {
  memo.clear();
  memoKey = "";
}

export async function getVaultKey(): Promise<Uint8Array> {
  const session = await getSession();
  if (!session) throw new Error("The vault is locked");
  if (session.vaultKey !== memoKey) {
    clearVaultMemo();
    memoKey = session.vaultKey;
  }
  return fromBase64Url(session.vaultKey);
}

function isLoginItem(payload: ItemPayload): payload is LoginItem {
  return "username" in payload || "password" in payload || "urls" in payload;
}

function isPasskeyItem(payload: ItemPayload): payload is PasskeyItem {
  return "credentialId" in payload || "privateKey" in payload || "rpId" in payload;
}

export async function listRecords(): Promise<CachedItem[]> {
  const data = await getLocalData();
  return Object.values(data.items)
    .filter((item) => !item.deleted)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function decryptCached(record: CachedItem): Promise<ItemPayload> {
  const key = await getVaultKey();
  const cached = memo.get(record.id);
  if (cached) return cached;
  const payload = await decryptItem<ItemPayload>(key, record.id, record);
  memo.set(record.id, payload);
  return payload;
}

export async function listLogins(): Promise<Array<{ id: string; payload: LoginItem }>> {
  const records = await listRecords();
  const logins: Array<{ id: string; payload: LoginItem }> = [];
  for (const record of records) {
    if (record.type !== "login") continue;
    const payload = await decryptCached(record);
    if (isLoginItem(payload)) logins.push({ id: record.id, payload });
  }
  return logins;
}

export async function loginSummaries(): Promise<LoginSummary[]> {
  const logins = await listLogins();
  return logins.map(({ id, payload }) => ({
    id,
    name: payload.name,
    username: payload.username ?? "",
    urls: payload.urls ?? [],
    hasTotp: typeof payload.totp === "string" && payload.totp.length > 0,
    hasPassword: typeof payload.password === "string" && payload.password.length > 0,
    autofill: payload.autofill !== false,
  }));
}

export async function passkeySummaries(): Promise<PasskeySummary[]> {
  const passkeys = await listPasskeys();
  return passkeys.map(({ id, payload }) => ({
    id,
    name: payload.name,
    username: payload.username ?? "",
    rpId: payload.rpId ?? "",
    urls: payload.urls ?? [],
    autofill: payload.autofill !== false,
  }));
}

export async function getTotpSecret(itemId: string): Promise<{ secret: string }> {
  const data = await getLocalData();
  const record = data.items[itemId];
  if (!record || record.deleted || record.type !== "login") {
    throw new Error("Item not found");
  }
  const payload = await decryptCached(record);
  if (!isLoginItem(payload) || typeof payload.totp !== "string" || payload.totp.length === 0) {
    throw new Error("No authenticator on this item");
  }
  return { secret: payload.totp };
}

export async function getCredentials(itemId: string): Promise<Credentials> {
  const data = await getLocalData();
  const record = data.items[itemId];
  if (!record || record.deleted || record.type !== "login") {
    throw new Error("Item not found");
  }
  const payload = await decryptCached(record);
  if (!isLoginItem(payload)) throw new Error("Item is not a login");
  return { username: payload.username ?? "", password: payload.password ?? "" };
}

export async function getLoginPayload(itemId: string): Promise<LoginItem> {
  const data = await getLocalData();
  const record = data.items[itemId];
  if (!record || record.deleted) throw new Error("Item not found");
  const payload = await decryptCached(record);
  if (!isLoginItem(payload)) throw new Error("Item is not a login");
  return payload;
}

export async function createLogin(payload: LoginItem): Promise<string> {
  const key = await getVaultKey();
  const id = crypto.randomUUID();
  const { ciphertext, iv } = await encryptItem(key, id, payload);
  const updatedAt = new Date().toISOString();
  await updateLocalData((data) => {
    data.items[id] = { id, type: "login", ciphertext, iv, deleted: false, updatedAt, dirty: true };
  });
  memo.set(id, payload);
  return id;
}

export async function updateLogin(itemId: string, patch: Partial<LoginItem>): Promise<void> {
  const key = await getVaultKey();
  const data = await getLocalData();
  const record = data.items[itemId];
  if (!record || record.deleted) throw new Error("Item not found");
  const current = await decryptCached(record);
  if (!isLoginItem(current)) throw new Error("Item is not a login");
  const next: LoginItem = { ...current, ...patch };
  const { ciphertext, iv } = await encryptItem(key, itemId, next);
  await updateLocalData((local) => {
    const existing = local.items[itemId];
    if (!existing) return;
    local.items[itemId] = {
      ...existing,
      ciphertext,
      iv,
      deleted: false,
      updatedAt: new Date().toISOString(),
      dirty: true,
    };
  });
  memo.set(itemId, next);
}

export async function deleteItem(itemId: string): Promise<void> {
  await updateLocalData((data) => {
    const existing = data.items[itemId];
    if (!existing) return;
    data.items[itemId] = {
      ...existing,
      deleted: true,
      updatedAt: new Date().toISOString(),
      dirty: true,
    };
  });
  memo.delete(itemId);
}

export async function listPasskeys(): Promise<Array<{ id: string; payload: PasskeyItem }>> {
  const records = await listRecords();
  const passkeys: Array<{ id: string; payload: PasskeyItem }> = [];
  for (const record of records) {
    if (record.type !== "passkey") continue;
    const payload = await decryptCached(record);
    if (isPasskeyItem(payload)) passkeys.push({ id: record.id, payload });
  }
  return passkeys;
}

export async function getPasskey(itemId: string): Promise<{ id: string; payload: PasskeyItem }> {
  const data = await getLocalData();
  const record = data.items[itemId];
  if (!record || record.deleted || record.type !== "passkey") {
    throw new Error("Item not found");
  }
  const payload = await decryptCached(record);
  if (!isPasskeyItem(payload)) throw new Error("Item is not a passkey");
  return { id: record.id, payload };
}

export async function createPasskey(payload: PasskeyItem): Promise<string> {
  const key = await getVaultKey();
  const id = crypto.randomUUID();
  const { ciphertext, iv } = await encryptItem(key, id, payload);
  const updatedAt = new Date().toISOString();
  await updateLocalData((data) => {
    data.items[id] = { id, type: "passkey", ciphertext, iv, deleted: false, updatedAt, dirty: true };
  });
  memo.set(id, payload);
  return id;
}

export async function updatePasskey(itemId: string, patch: Partial<PasskeyItem>): Promise<void> {
  const key = await getVaultKey();
  const { payload: current } = await getPasskey(itemId);
  const next: PasskeyItem = { ...current, ...patch };
  const { ciphertext, iv } = await encryptItem(key, itemId, next);
  await updateLocalData((local) => {
    const existing = local.items[itemId];
    if (!existing) return;
    local.items[itemId] = {
      ...existing,
      ciphertext,
      iv,
      deleted: false,
      updatedAt: new Date().toISOString(),
      dirty: true,
    };
  });
  memo.set(itemId, next);
}

export async function setItemAutofill(itemId: string, autofill: boolean): Promise<void> {
  const data = await getLocalData();
  const record = data.items[itemId];
  if (!record || record.deleted) throw new Error("Item not found");
  if (record.type === "login") {
    await updateLogin(itemId, { autofill });
    return;
  }
  if (record.type === "passkey") {
    await updatePasskey(itemId, { autofill });
    return;
  }
  throw new Error("Autofill is only available for logins and passkeys");
}
