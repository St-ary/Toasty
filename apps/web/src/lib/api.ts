export type ErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "email_taken"
  | "registration_closed"
  | "invalid_setup_token"
  | "unauthorized"
  | "session_expired"
  | "not_found"
  | "rate_limited"
  | "internal";

const ERROR_CODES: readonly string[] = [
  "invalid_request",
  "invalid_credentials",
  "email_taken",
  "registration_closed",
  "invalid_setup_token",
  "unauthorized",
  "session_expired",
  "not_found",
  "rate_limited",
  "internal",
];

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface UserInfo {
  id: string;
  email: string;
}

export interface KdfInfo {
  salt: string;
  iterations: number;
}

export interface VaultMeta {
  kdf: KdfInfo;
  wrappedVaultKey: string;
  recoveryWrappedVaultKey: string | null;
}

export interface AuthResponse {
  token: string;
  expiresAt?: string;
  refreshesLeft?: number;
  user: UserInfo;
  vault: VaultMeta;
}

export interface RefreshResponse {
  expiresAt: string;
  refreshesLeft: number;
}

export interface MeResponse {
  user: UserInfo;
  vault: VaultMeta;
}

export interface RegisterBody {
  email: string;
  setupToken?: string;
  kdf: KdfInfo;
  authKey: string;
  wrappedVaultKey: string;
  recoveryWrappedVaultKey: string;
}

export interface StatusResponse {
  needsSetup: boolean;
  registrationOpen: boolean;
}

export interface VaultKeyUpdateBody {
  authKey?: string;
  kdf?: KdfInfo;
  wrappedVaultKey: string;
  recoveryWrappedVaultKey?: string;
}

export interface ItemRecord {
  id: string;
  type: string;
  ciphertext: string;
  iv: string;
  deleted: boolean;
  updatedAt: string;
}

export interface ItemUpsertBody {
  type: string;
  ciphertext: string;
  iv: string;
  deleted: boolean;
}

export interface BatchUpsertBody {
  items: Array<{ id: string } & ItemUpsertBody>;
}

export interface ItemsResponse {
  items: ItemRecord[];
  serverTime: string;
}

export interface HealthResponse {
  ok: boolean;
  serverTime: string;
}

export interface VersionInfo {
  version: string;
  image: string;
  releasedAt?: string;
  notes?: string;
}

export interface VersionStatusResponse {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  versions: VersionInfo[];
  checkedAt: string | null;
  updaterAvailable: boolean;
}

export interface VersionApplyResponse {
  mode: "updater" | "manual";
  action: "update" | "downgrade" | "reinstall";
  version: string;
  image?: string;
  command?: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readErrorCode(parsed: unknown): ErrorCode {
  if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.code === "string") {
    return ERROR_CODES.includes(parsed.error.code)
      ? (parsed.error.code as ErrorCode)
      : "internal";
  }
  return "internal";
}

function readErrorMessage(parsed: unknown, status: number): string {
  if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === "string") {
    return parsed.error.message;
  }
  return `Request failed with status ${status}`;
}

const SERVER_KEY = "toasty.server";

export function getServerUrl(): string {
  try {
    return window.localStorage.getItem(SERVER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setServerUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, "");
  try {
    if (trimmed.length === 0) window.localStorage.removeItem(SERVER_KEY);
    else window.localStorage.setItem(SERVER_KEY, trimmed);
  } catch {
    return;
  }
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.token !== null) headers["Authorization"] = `Bearer ${this.token}`;

    let response: Response;
    try {
      response = await fetch(`${getServerUrl()}/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError("internal", "Unable to reach the Toasty server", 0);
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      throw new ApiError(readErrorCode(parsed), readErrorMessage(parsed, response.status), response.status);
    }
    return parsed as T;
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/health");
  }

  getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>("GET", "/status");
  }

  getKdf(email: string): Promise<{ kdf: KdfInfo }> {
    return this.request<{ kdf: KdfInfo }>("GET", `/auth/kdf?email=${encodeURIComponent(email)}`);
  }

  register(body: RegisterBody): Promise<AuthResponse> {
    return this.request<AuthResponse>("POST", "/auth/register", body);
  }

  login(email: string, authKey: string): Promise<AuthResponse> {
    return this.request<AuthResponse>("POST", "/auth/login", { email, authKey });
  }

  logout(): Promise<void> {
    return this.request<void>("POST", "/auth/logout");
  }

  refreshSession(): Promise<RefreshResponse> {
    return this.request<RefreshResponse>("POST", "/auth/refresh");
  }

  me(): Promise<MeResponse> {
    return this.request<MeResponse>("GET", "/auth/me");
  }

  updateVaultKey(body: VaultKeyUpdateBody): Promise<void> {
    return this.request<void>("PUT", "/vault/key", body);
  }

  listItems(since: string | null): Promise<ItemsResponse> {
    const query = since === null ? "" : `?since=${encodeURIComponent(since)}`;
    return this.request<ItemsResponse>("GET", `/vault/items${query}`);
  }

  upsertItem(id: string, body: ItemUpsertBody): Promise<ItemRecord> {
    return this.request<ItemRecord>("PUT", `/vault/items/${encodeURIComponent(id)}`, body);
  }

  batchUpsert(body: BatchUpsertBody): Promise<ItemsResponse> {
    return this.request<ItemsResponse>("POST", "/vault/items/batch", body);
  }

  deleteItem(id: string): Promise<void> {
    return this.request<void>("DELETE", `/vault/items/${encodeURIComponent(id)}`);
  }

  getVersion(): Promise<VersionStatusResponse> {
    return this.request<VersionStatusResponse>("GET", "/version");
  }

  applyVersion(version: string): Promise<VersionApplyResponse> {
    return this.request<VersionApplyResponse>("POST", "/version/apply", { version });
  }
}

export const api = new ApiClient();
