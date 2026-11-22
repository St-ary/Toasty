import type { KdfInfo } from "./types";

export type ApiErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "email_taken"
  | "unauthorized"
  | "session_expired"
  | "not_found"
  | "rate_limited"
  | "internal"
  | "network"
  | "unknown";

const KNOWN_CODES: readonly ApiErrorCode[] = [
  "invalid_request",
  "invalid_credentials",
  "email_taken",
  "unauthorized",
  "session_expired",
  "not_found",
  "rate_limited",
  "internal",
];

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthVault {
  kdf: KdfInfo;
  wrappedVaultKey: string;
  recoveryWrappedVaultKey: string;
}

export interface AuthResponse {
  token: string;
  expiresAt?: string;
  refreshesLeft?: number;
  user: AuthUser;
  vault: AuthVault;
}

export interface RefreshResponse {
  expiresAt: string;
  refreshesLeft: number;
}

export interface RemoteItem {
  id: string;
  type: string;
  ciphertext: string;
  iv: string;
  deleted: boolean;
  updatedAt: string;
}

export interface ItemsPage {
  items: RemoteItem[];
  serverTime: string;
}

export interface BatchUpsertBody {
  items: Array<Pick<RemoteItem, "id" | "type" | "ciphertext" | "iv" | "deleted">>;
}

interface ErrorBody {
  code: ApiErrorCode;
  message: string;
}

function isKnownCode(code: string): code is ApiErrorCode {
  return (KNOWN_CODES as readonly string[]).includes(code);
}

function extractError(parsed: unknown, status: number): ErrorBody {
  if (parsed && typeof parsed === "object") {
    const error = (parsed as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const record = error as { code?: unknown; message?: unknown };
      const code = typeof record.code === "string" && isKnownCode(record.code) ? record.code : "unknown";
      const message = typeof record.message === "string" && record.message ? record.message : `Request failed (${status})`;
      return { code, message };
    }
  }
  return { code: "unknown", message: `Request failed (${status})` };
}

export class ApiClient {
  private token: string | null = null;

  constructor(readonly baseUrl: string) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError("network", "Unable to reach the server", 0);
    }
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      const { code, message } = extractError(parsed, response.status);
      throw new ApiError(code, message, response.status);
    }
    return parsed as T;
  }

  health(): Promise<{ ok: boolean; serverTime: string }> {
    return this.request("GET", "/api/health");
  }

  register(body: {
    email: string;
    kdf: KdfInfo;
    authKey: string;
    wrappedVaultKey: string;
    recoveryWrappedVaultKey: string;
  }): Promise<AuthResponse> {
    return this.request("POST", "/api/auth/register", body);
  }

  login(email: string, authKey: string): Promise<AuthResponse> {
    return this.request("POST", "/api/auth/login", { email, authKey });
  }

  logout(): Promise<void> {
    return this.request("POST", "/api/auth/logout");
  }

  refreshSession(): Promise<RefreshResponse> {
    return this.request("POST", "/api/auth/refresh");
  }

  me(): Promise<{ user: AuthUser; vault: AuthVault }> {
    return this.request("GET", "/api/auth/me");
  }

  updateKey(body: {
    authKey?: string;
    kdf?: KdfInfo;
    wrappedVaultKey: string;
    recoveryWrappedVaultKey?: string;
  }): Promise<void> {
    return this.request("PUT", "/api/vault/key", body);
  }

  async getKdf(email: string): Promise<{ kdf: KdfInfo } | null> {
    try {
      return await this.request<{ kdf: KdfInfo }>(
        "GET",
        `/api/auth/kdf?email=${encodeURIComponent(email)}`,
      );
    } catch {
      return null;
    }
  }

  listItems(since: string | null): Promise<ItemsPage> {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.request("GET", `/api/vault/items${query}`);
  }

  upsertItem(id: string, item: BatchUpsertBody["items"][number]): Promise<RemoteItem> {
    return this.request("PUT", `/api/vault/items/${encodeURIComponent(id)}`, item);
  }

  batchUpsert(items: BatchUpsertBody["items"]): Promise<ItemsPage> {
    return this.request("POST", "/api/vault/items/batch", { items });
  }

  deleteItem(id: string): Promise<void> {
    return this.request("DELETE", `/api/vault/items/${encodeURIComponent(id)}`);
  }
}
