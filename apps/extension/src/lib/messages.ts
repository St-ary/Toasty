import type { Credentials, LoginMatch, LoginSummary, StatusReport, SyncStatus } from "./types";
import { isRecord } from "./types";

export interface SaveLoginPayload {
  name: string;
  username: string;
  password: string;
  url: string;
}

export type BgRequest =
  | { type: "unlock"; email: string; masterPassword: string }
  | { type: "lock" }
  | { type: "syncNow" }
  | { type: "getMatching"; url: string }
  | { type: "getLogins" }
  | { type: "getPasskeys" }
  | { type: "getCredentials"; itemId: string }
  | { type: "getTotp"; itemId: string }
  | { type: "fillItem"; itemId: string; tabId: number }
  | { type: "openAndFill"; itemId: string }
  | { type: "saveLogin"; login: SaveLoginPayload }
  | { type: "updateLogin"; itemId: string; password: string; username?: string }
  | { type: "setItemAutofill"; itemId: string; autofill: boolean }
  | { type: "markNeverSave"; host: string }
  | {
      type: "webauthnCandidates";
      rpId: string;
      allowCredentials: string[];
      url: string;
    }
  | {
      type: "webauthnGet";
      itemId: string;
      rpId: string;
      challenge: string;
      origin: string;
      userVerification: string;
    }
  | {
      type: "webauthnCreate";
      rpId: string;
      rpName: string;
      userName: string;
      userDisplayName: string;
      challenge: string;
      origin: string;
      userVerification: string;
    }
  | { type: "getStatus" }
  | { type: "settingsChanged" }
  | { type: "activity" };

export type ContentRequest =
  | { type: "fillItem"; credentials: Credentials }
  | { type: "showBadge" }
  | { type: "hideBadge" };

export interface BgFailure {
  error: string;
}

function isFailure(value: unknown): value is BgFailure {
  return isRecord(value) && typeof value.error === "string";
}

export async function sendToBackground<T>(request: BgRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage<unknown, T | BgFailure>(request);
  if (isFailure(response)) throw new Error(response.error);
  return response as T;
}

export async function sendToTab<T>(tabId: number, request: ContentRequest): Promise<T | undefined> {
  return chrome.tabs.sendMessage<ContentRequest, T | undefined>(tabId, request);
}
