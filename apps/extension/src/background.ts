import {
  createPasskeyRegistration,
  deriveFromMasterPassword,
  signPasskeyAssertion,
  toBase64Url,
  unwrapSecret,
  wipe,
  type LoginItem,
  type PasskeyItem,
} from "@toasty/crypto";
import { ApiClient, type AuthResponse } from "./lib/api";
import { matchLogins, pageHost, scoreUrl } from "./lib/matching";
import { sendToTab, type BgRequest, type ContentRequest, type SaveLoginPayload } from "./lib/messages";
import * as session from "./lib/session";
import * as settings from "./lib/settings";
import * as sync from "./lib/sync";
import * as vault from "./lib/vault";
import type {
  CachedKdf,
  KdfInfo,
  PasskeyAssertionResult,
  PasskeyMatch,
  PasskeyRegistrationResultWire,
  StatusReport,
  VaultMeta,
} from "./lib/types";

async function createApi(): Promise<ApiClient> {
  const config = await settings.getSettings();
  const api = new ApiClient(config.serverUrl);
  const state = await session.getSession();
  if (state) api.setToken(state.token);
  return api;
}

async function statusReport(): Promise<StatusReport> {
  const [state, config, syncStatus] = await Promise.all([
    session.getSession(),
    settings.getSettings(),
    sync.getSyncStatus(),
  ]);
  return {
    locked: state === null,
    email: config.email || state?.vaultMeta.email || "",
    serverUrl: config.serverUrl,
    sync: syncStatus,
    settings: config,
  };
}

async function refreshBadge(): Promise<void> {
  const state = await session.getSession();
  if (state) {
    await chrome.action.setBadgeBackgroundColor({ color: "#c68b59" });
    await chrome.action.setBadgeText({ text: "T" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

async function broadcast(request: ContentRequest): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined ? Promise.resolve() : sendToTab(tab.id, request).catch(() => undefined),
    ),
  );
}

async function resolveKdf(api: ApiClient, email: string, cached: CachedKdf | null): Promise<KdfInfo> {
  const remote = await api.getKdf(email);
  if (remote) return remote.kdf;
  if (cached && cached.email === email) return { salt: cached.salt, iterations: cached.iterations };
  throw new Error("Unable to load the KDF parameters for this account");
}

async function unlockVault(email: string, masterPassword: string): Promise<StatusReport> {
  const api = await createApi();
  const local = await settings.getLocalData();
  const kdf = await resolveKdf(api, email, local.cachedKdf);
  const derived = await deriveFromMasterPassword(masterPassword, kdf.salt, kdf.iterations);
  try {
    const auth: AuthResponse = await api.login(email, derived.authKey);
    const vaultKey = await unwrapSecret(derived.wrapKey, auth.vault.wrappedVaultKey);
    const vaultMeta: VaultMeta = {
      userId: auth.user.id,
      email: auth.user.email,
      kdf: auth.vault.kdf,
      wrappedVaultKey: auth.vault.wrappedVaultKey,
      recoveryWrappedVaultKey: auth.vault.recoveryWrappedVaultKey,
    };
    const now = new Date().toISOString();
    await settings.updateLocalData((data) => {
      data.cachedKdf = { email: auth.user.email, ...auth.vault.kdf };
      data.vaultMeta = vaultMeta;
    });
    await session.setSession({
      token: auth.token,
      vaultKey: toBase64Url(vaultKey),
      vaultMeta,
      unlockedAt: now,
      lastActivityAt: now,
      expiresAt: auth.expiresAt,
    });
    await settings.updateSettings({ email: auth.user.email });
    wipe(vaultKey);
  } finally {
    wipe(derived.wrapKey);
  }
  await refreshBadge();
  void sync.syncNow().catch(() => undefined);
  return statusReport();
}

async function lockVault(): Promise<StatusReport> {
  vault.clearVaultMemo();
  await session.lock();
  await refreshBadge();
  await broadcast({ type: "hideBadge" });
  return statusReport();
}

async function openAndFill(itemId: string): Promise<{ ok: true }> {
  const payload = await vault.getLoginPayload(itemId);
  const rawUrl = payload.urls?.[0];
  if (!rawUrl) throw new Error("This login has no saved URL");
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const tab = await chrome.tabs.create({ url });
  if (tab.id === undefined) return { ok: true };
  const tabId = tab.id;
  const listener = (updatedId: number, info: chrome.tabs.TabChangeInfo): void => {
    if (updatedId !== tabId || info.status !== "complete") return;
    chrome.tabs.onUpdated.removeListener(listener);
    void vault
      .getCredentials(itemId)
      .then((credentials) => sendToTab(tabId, { type: "fillItem", credentials }))
      .catch(() => undefined);
  };
  chrome.tabs.onUpdated.addListener(listener);
  return { ok: true };
}

async function saveLogin(login: SaveLoginPayload): Promise<{ id: string }> {
  const payload: LoginItem = {
    name: login.name || login.url,
    username: login.username,
    password: login.password,
    urls: [login.url],
  };
  const id = await vault.createLogin(payload);
  void sync.syncNow().catch(() => undefined);
  return { id };
}

function rpMatches(rpId: string, itemRpId: string): boolean {
  return (
    rpId === itemRpId || rpId.endsWith(`.${itemRpId}`) || itemRpId.endsWith(`.${rpId}`)
  );
}

async function webauthnCandidates(
  rpId: string,
  allowCredentials: string[],
  url: string,
): Promise<PasskeyMatch[]> {
  const state = await session.getSession();
  if (!state) return [];
  const allowed = new Set(allowCredentials);
  const host = pageHost(url) ?? rpId;
  const matches: PasskeyMatch[] = [];
  for (const { id, payload } of await vault.listPasskeys()) {
    if (allowed.size > 0) {
      if (!payload.credentialId || !allowed.has(payload.credentialId)) continue;
    } else {
      const rpHit = payload.rpId !== undefined && rpMatches(rpId, payload.rpId);
      const urlHit = (payload.urls ?? []).some((itemUrl) => scoreUrl(host, itemUrl) > 0);
      if (!rpHit && !urlHit) continue;
    }
    matches.push({
      id,
      name: payload.name,
      username: payload.username ?? "",
      rpId: payload.rpId ?? rpId,
    });
  }
  matches.sort((a, b) => a.name.localeCompare(b.name));
  return matches;
}

async function webauthnGet(request: Extract<BgRequest, { type: "webauthnGet" }>): Promise<PasskeyAssertionResult> {
  const { payload } = await vault.getPasskey(request.itemId);
  if (!payload.privateKey || !payload.credentialId) {
    throw new Error("This passkey has no key material");
  }
  const signCount = (payload.signCount ?? 0) + 1;
  const assertion = await signPasskeyAssertion({
    privateKey: payload.privateKey,
    credentialId: payload.credentialId,
    userHandle: payload.userHandle,
    rpId: request.rpId,
    challenge: request.challenge,
    origin: request.origin,
    signCount,
    userVerification: request.userVerification !== "discouraged",
  });
  await vault.updatePasskey(request.itemId, { signCount });
  void sync.syncNow().catch(() => undefined);
  return {
    credentialId: assertion.credentialId,
    userHandle: assertion.userHandle ?? null,
    authenticatorData: assertion.authenticatorData,
    clientDataJSON: assertion.clientDataJSON,
    signature: assertion.signature,
  };
}

async function webauthnCreate(
  request: Extract<BgRequest, { type: "webauthnCreate" }>,
): Promise<PasskeyRegistrationResultWire> {
  const registration = await createPasskeyRegistration({
    rpId: request.rpId,
    challenge: request.challenge,
    origin: request.origin,
    userVerification: request.userVerification !== "discouraged",
  });
  const payload: PasskeyItem = {
    name: request.userDisplayName || request.userName || request.rpId,
    rpId: request.rpId,
    username: request.userName || undefined,
    userHandle: registration.userHandle,
    credentialId: registration.credentialId,
    privateKey: registration.privateKey,
    publicKey: registration.publicKey,
    signCount: 0,
    created: new Date().toISOString(),
    urls: [request.origin],
  };
  if (request.rpName.length > 0) payload.rpName = request.rpName;
  await vault.createPasskey(payload);
  void sync.syncNow().catch(() => undefined);
  return {
    credentialId: registration.credentialId,
    userHandle: registration.userHandle,
    attestationObject: registration.attestationObject,
    clientDataJSON: registration.clientDataJSON,
    transports: ["internal"],
  };
}

async function handleRequest(request: BgRequest): Promise<unknown> {
  switch (request.type) {
    case "unlock":
      return unlockVault(request.email, request.masterPassword);
    case "lock":
      return lockVault();
    case "syncNow":
      return sync.syncNow();
    case "getMatching":
      return matchLogins(request.url, await vault.loginSummaries());
    case "getLogins":
      return vault.loginSummaries();
    case "getPasskeys":
      return vault.passkeySummaries();
    case "getCredentials":
      return vault.getCredentials(request.itemId);
    case "getTotp":
      return vault.getTotpSecret(request.itemId);
    case "fillItem": {
      const credentials = await vault.getCredentials(request.itemId);
      await sendToTab(request.tabId, { type: "fillItem", credentials });
      return { ok: true };
    }
    case "openAndFill":
      return openAndFill(request.itemId);
    case "saveLogin":
      return saveLogin(request.login);
    case "updateLogin": {
      const patch: Partial<LoginItem> = { password: request.password };
      if (request.username) patch.username = request.username;
      await vault.updateLogin(request.itemId, patch);
      void sync.syncNow().catch(() => undefined);
      return { ok: true };
    }
    case "setItemAutofill": {
      await vault.setItemAutofill(request.itemId, request.autofill);
      void sync.syncNow().catch(() => undefined);
      return { ok: true };
    }
    case "markNeverSave":
      await settings.updateLocalData((data) => {
        if (!data.neverSaveHosts.includes(request.host)) data.neverSaveHosts.push(request.host);
      });
      return { ok: true };
    case "webauthnCandidates":
      return webauthnCandidates(request.rpId, request.allowCredentials, request.url);
    case "webauthnGet":
      return webauthnGet(request);
    case "webauthnCreate":
      return webauthnCreate(request);
    case "getStatus":
      return statusReport();
    case "settingsChanged":
      return { ok: true };
    case "activity":
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = message as BgRequest;
  if (request.type !== "getStatus") void session.touchActivity();
  handleRequest(request)
    .then(sendResponse)
    .catch((error: unknown) =>
      sendResponse({ error: error instanceof Error ? error.message : String(error) }),
    );
  return true;
});

function ensureAlarms(): void {
  chrome.alarms.create("toasty-idle", { periodInMinutes: 1 });
  chrome.alarms.create("toasty-sync", { periodInMinutes: 30 });
}

async function startup(): Promise<void> {
  await refreshBadge();
  const state = await session.getSession();
  if (state) void sync.syncNow().catch(() => undefined);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "toasty-idle") {
    void (async () => {
      const locked = await session.checkIdleLock();
      if (locked) await lockVault();
    })();
  } else if (alarm.name === "toasty-sync") {
    void startup();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms();
  void startup();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms();
  void startup();
});

ensureAlarms();
