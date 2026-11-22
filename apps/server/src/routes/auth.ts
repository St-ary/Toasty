import type { Config } from "../config.js";
import { createHmac, randomBytes } from "node:crypto";
import { query } from "../db.js";
import { countUsers, verifySetupToken } from "../lib/app-settings.js";
import { HttpError, created, noContent, ok } from "../lib/http.js";
import type { Handler, Reply, RequestContext, Router } from "../lib/http.js";
import { hashAuthKey, verifyAuthKey } from "../lib/password.js";
import { FailureThrottle, RateLimiter } from "../lib/rate-limit.js";
import { createSessionToken, hashToken } from "../lib/tokens.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const WRAPPED_KEY_PATTERN = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export interface AuthContext {
  userId: string;
  sessionId: string;
}

interface UserRow {
  id: string;
  email: string;
  auth_key_hash: string;
  kdf_salt: string;
  kdf_iterations: number;
  wrapped_vault_key: string;
  recovery_wrapped_vault_key: string | null;
}

interface PgErrorLike {
  code?: string;
}

let dummyHashPromise: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashAuthKey(createSessionToken());
  return dummyHashPromise;
}

let decoySecretPromise: Promise<string> | null = null;

function decoySecret(): Promise<string> {
  decoySecretPromise ??= (async () => {
    const generated = randomBytes(32).toString("base64url");
    await query(
      "insert into app_settings (key, value) values ('decoy_kdf_secret', $1) on conflict do nothing",
      [generated],
    );
    const rows = await query<{ value: string }>(
      "select value from app_settings where key = 'decoy_kdf_secret'",
    );
    return rows[0]?.value ?? generated;
  })();
  return decoySecretPromise;
}

async function decoyKdf(email: string): Promise<{ salt: string; iterations: number }> {
  const secret = await decoySecret();
  const salt = createHmac("sha256", Buffer.from(secret, "base64url"))
    .update(email)
    .digest("base64url")
    .slice(0, 22);
  return { salt, iterations: 600000 };
}

const LOGIN_THROTTLE = new FailureThrottle(5, 60_000, 900_000);

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(
      400,
      "invalid_request",
      "Request body must be a JSON object",
    );
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "invalid_request", `${field} must be a non-empty string`);
  }
  return value;
}

function decodeBase64Url(text: string, field: string): Buffer {
  if (!BASE64URL_PATTERN.test(text)) {
    throw new HttpError(400, "invalid_request", `${field} must be base64url`);
  }
  const decoded = Buffer.from(text, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== text) {
    throw new HttpError(400, "invalid_request", `${field} must be canonical base64url`);
  }
  return decoded;
}

function validateEmail(value: unknown): string {
  const email = requireString(value, "email").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, "invalid_request", "email is not a valid email address");
  }
  return email;
}

function validateAuthKey(value: unknown): string {
  const text = requireString(value, "authKey");
  const decoded = decodeBase64Url(text, "authKey");
  if (decoded.length !== 32) {
    throw new HttpError(400, "invalid_request", "authKey must decode to 32 bytes");
  }
  return text;
}

function validateWrappedKey(value: unknown, field: string): string {
  const text = requireString(value, field);
  if (!WRAPPED_KEY_PATTERN.test(text)) {
    throw new HttpError(400, "invalid_request", `${field} must match v1.<iv>.<ct>`);
  }
  return text;
}

function validateKdfSalt(value: unknown): string {
  const text = requireString(value, "kdf.salt");
  const decoded = decodeBase64Url(text, "kdf.salt");
  if (decoded.length < 8 || decoded.length > 64) {
    throw new HttpError(400, "invalid_request", "kdf.salt must decode to 8-64 bytes");
  }
  return text;
}

function validateKdf(value: unknown): { salt: string; iterations: number } {
  const kdf = asObject(value);
  const salt = validateKdfSalt(kdf.salt);
  const iterations = kdf.iterations;
  if (
    typeof iterations !== "number" ||
    !Number.isInteger(iterations) ||
    iterations < 100000 ||
    iterations > 5000000
  ) {
    throw new HttpError(
      400,
      "invalid_request",
      "kdf.iterations must be an integer between 100000 and 5000000",
    );
  }
  return { salt, iterations };
}

function userPayload(row: UserRow): { id: string; email: string } {
  return { id: row.id, email: row.email };
}

function vaultPayload(row: UserRow): {
  kdf: { salt: string; iterations: number };
  wrappedVaultKey: string;
  recoveryWrappedVaultKey: string | null;
} {
  return {
    kdf: { salt: row.kdf_salt, iterations: row.kdf_iterations },
    wrappedVaultKey: row.wrapped_vault_key,
    recoveryWrappedVaultKey: row.recovery_wrapped_vault_key,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as PgErrorLike).code === "23505"
  );
}

async function loadUser(userId: string): Promise<UserRow | undefined> {
  const rows = await query<UserRow>(
    `select id, email, auth_key_hash, kdf_salt, kdf_iterations, wrapped_vault_key, recovery_wrapped_vault_key
     from users where id = $1`,
    [userId],
  );
  return rows[0];
}

async function createSession(
  userId: string,
  ttlHours: number,
): Promise<{ token: string; expiresAt: string }> {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await query(
    "insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)",
    [userId, hashToken(token), expiresAt],
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function requireAuth(ctx: RequestContext): Promise<AuthContext> {
  const header = ctx.req.headers.authorization;
  const match =
    typeof header === "string" ? /^Bearer (.+)$/.exec(header.trim()) : null;
  const token = match?.[1];
  if (token === undefined || token.length === 0) {
    throw new HttpError(401, "unauthorized", "Authentication required");
  }
  const rows = await query<{ session_id: string; user_id: string }>(
    `select s.id as session_id, s.user_id
     from sessions s
     where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new HttpError(401, "unauthorized", "Authentication required");
  }
  return { userId: row.user_id, sessionId: row.session_id };
}

async function handleRegister(
  ctx: RequestContext,
  config: Config,
): Promise<Reply> {
  const body = asObject(ctx.body);
  const email = validateEmail(body.email);
  const authKey = validateAuthKey(body.authKey);
  const kdf = validateKdf(body.kdf);
  const wrappedVaultKey = validateWrappedKey(body.wrappedVaultKey, "wrappedVaultKey");
  const recoveryWrappedVaultKey =
    body.recoveryWrappedVaultKey === undefined
      ? null
      : validateWrappedKey(body.recoveryWrappedVaultKey, "recoveryWrappedVaultKey");

  const userCount = await countUsers();
  if (userCount > 0 && !config.allowRegistration) {
    throw new HttpError(
      403,
      "registration_closed",
      "Registration is closed on this server",
    );
  }
  if (userCount === 0 && !config.allowRegistration) {
    const setupToken = requireString(body.setupToken, "setupToken");
    if (!(await verifySetupToken(setupToken))) {
      throw new HttpError(403, "invalid_setup_token", "Setup token is incorrect");
    }
  }

  const existing = await query<{ id: string }>(
    "select id from users where email = $1",
    [email],
  );
  if (existing.length > 0) {
    throw new HttpError(409, "email_taken", "This email is already registered");
  }

  const authKeyHash = await hashAuthKey(authKey);
  let row: UserRow;
  try {
    const inserted = await query<UserRow>(
      `insert into users (email, auth_key_hash, kdf_salt, kdf_iterations, wrapped_vault_key, recovery_wrapped_vault_key)
       values ($1, $2, $3, $4, $5, $6)
       returning id, email, auth_key_hash, kdf_salt, kdf_iterations, wrapped_vault_key, recovery_wrapped_vault_key`,
      [
        email,
        authKeyHash,
        kdf.salt,
        kdf.iterations,
        wrappedVaultKey,
        recoveryWrappedVaultKey,
      ],
    );
    row = inserted[0];
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "email_taken", "This email is already registered");
    }
    throw error;
  }

  const session = await createSession(row.id, config.sessionTtlHours);
  return created({
    token: session.token,
    expiresAt: session.expiresAt,
    refreshesLeft: config.sessionMaxRefreshes,
    user: userPayload(row),
    vault: vaultPayload(row),
  });
}

async function handleStatus(config: Config): Promise<Reply> {
  const needsSetup = (await countUsers()) === 0;
  return ok({ needsSetup, registrationOpen: needsSetup || config.allowRegistration });
}

async function handleRefresh(ctx: RequestContext, config: Config): Promise<Reply> {
  const auth = await requireAuth(ctx);
  const rows = await query<{ refresh_count: number }>(
    "select refresh_count from sessions where id = $1",
    [auth.sessionId],
  );
  const refreshCount = rows[0]?.refresh_count ?? 0;
  if (refreshCount >= config.sessionMaxRefreshes) {
    await query("delete from sessions where id = $1", [auth.sessionId]);
    throw new HttpError(
      401,
      "session_expired",
      `Session used all ${config.sessionMaxRefreshes} refreshes — sign in again`,
    );
  }
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000);
  await query(
    "update sessions set expires_at = $1, refresh_count = refresh_count + 1 where id = $2",
    [expiresAt, auth.sessionId],
  );
  await query("delete from sessions where expires_at < now()");
  return ok({
    expiresAt: expiresAt.toISOString(),
    refreshesLeft: config.sessionMaxRefreshes - refreshCount - 1,
  });
}

async function handleKdf(ctx: RequestContext): Promise<Reply> {
  const email = validateEmail(ctx.query.get("email"));
  const rows = await query<{ kdf_salt: string; kdf_iterations: number }>(
    "select kdf_salt, kdf_iterations from users where email = $1",
    [email],
  );
  const row = rows[0];
  const kdf =
    row === undefined
      ? await decoyKdf(email)
      : { salt: row.kdf_salt, iterations: row.kdf_iterations };
  return ok({ kdf });
}

async function handleLogin(ctx: RequestContext, config: Config): Promise<Reply> {
  const body = asObject(ctx.body);
  const email = validateEmail(body.email);
  const authKey = requireString(body.authKey, "authKey");

  const lockedMs = LOGIN_THROTTLE.lockedForMs(email);
  if (lockedMs > 0) {
    throw new HttpError(
      429,
      "rate_limited",
      `Too many failed attempts for this account — try again in ${Math.ceil(lockedMs / 1000)}s`,
    );
  }

  const rows = await query<UserRow>(
    `select id, email, auth_key_hash, kdf_salt, kdf_iterations, wrapped_vault_key, recovery_wrapped_vault_key
     from users where email = $1`,
    [email],
  );
  const row = rows[0];
  const storedHash = row?.auth_key_hash ?? (await dummyHash());
  const valid = await verifyAuthKey(authKey, storedHash);
  if (row === undefined || !valid) {
    LOGIN_THROTTLE.fail(email);
    throw new HttpError(401, "invalid_credentials", "Email or auth key is incorrect");
  }

  LOGIN_THROTTLE.succeed(email);
  const session = await createSession(row.id, config.sessionTtlHours);
  return ok({
    token: session.token,
    expiresAt: session.expiresAt,
    refreshesLeft: config.sessionMaxRefreshes,
    user: userPayload(row),
    vault: vaultPayload(row),
  });
}

async function handleLogout(ctx: RequestContext): Promise<Reply> {
  const auth = await requireAuth(ctx);
  await query("delete from sessions where id = $1", [auth.sessionId]);
  return noContent();
}

async function handleMe(ctx: RequestContext): Promise<Reply> {
  const auth = await requireAuth(ctx);
  const row = await loadUser(auth.userId);
  if (row === undefined) {
    throw new HttpError(401, "unauthorized", "Authentication required");
  }
  return ok({ user: userPayload(row), vault: vaultPayload(row) });
}

async function handleKeyUpdate(ctx: RequestContext): Promise<Reply> {
  const auth = await requireAuth(ctx);
  const body = asObject(ctx.body);

  const authKey = body.authKey === undefined ? null : validateAuthKey(body.authKey);
  const kdf = body.kdf === undefined ? null : validateKdf(body.kdf);
  const wrappedVaultKey =
    body.wrappedVaultKey === undefined
      ? null
      : validateWrappedKey(body.wrappedVaultKey, "wrappedVaultKey");
  const recoveryWrappedVaultKey =
    body.recoveryWrappedVaultKey === undefined
      ? null
      : validateWrappedKey(body.recoveryWrappedVaultKey, "recoveryWrappedVaultKey");

  if (
    authKey === null &&
    kdf === null &&
    wrappedVaultKey === null &&
    recoveryWrappedVaultKey === null
  ) {
    throw new HttpError(400, "invalid_request", "No fields to update");
  }

  const current = await query<{ id: string }>(
    "select id from users where id = $1",
    [auth.userId],
  );
  if (current[0] === undefined) {
    throw new HttpError(401, "unauthorized", "Authentication required");
  }

  const assignments: string[] = [];
  const params: unknown[] = [];
  const assign = (column: string, value: unknown): void => {
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  };
  if (wrappedVaultKey !== null) {
    assign("wrapped_vault_key", wrappedVaultKey);
  }
  if (authKey !== null) {
    assign("auth_key_hash", await hashAuthKey(authKey));
  }
  if (kdf !== null) {
    assign("kdf_salt", kdf.salt);
    assign("kdf_iterations", kdf.iterations);
  }
  if (recoveryWrappedVaultKey !== null) {
    assign("recovery_wrapped_vault_key", recoveryWrappedVaultKey);
  }
  params.push(auth.userId);
  await query(
    `update users set ${assignments.join(", ")}, updated_at = now() where id = $${params.length}`,
    params,
  );
  return noContent();
}

export function registerAuthRoutes(router: Router, config: Config): void {
  const limiter = new RateLimiter(config.rateLimitAuthPerMinute, 60_000);
  const rateLimit =
    (handler: Handler): Handler =>
    async (ctx) => {
      if (!limiter.check(ctx.ip)) {
        throw new HttpError(
          429,
          "rate_limited",
          "Too many requests, please try again later",
        );
      }
      return handler(ctx);
    };

  router.route("GET", "/api/status", () => handleStatus(config));
  router.route("GET", "/api/auth/kdf", rateLimit((ctx) => handleKdf(ctx)));
  router.route("POST", "/api/auth/register", rateLimit((ctx) => handleRegister(ctx, config)));
  router.route("POST", "/api/auth/login", rateLimit((ctx) => handleLogin(ctx, config)));
  router.route("POST", "/api/auth/refresh", rateLimit((ctx) => handleRefresh(ctx, config)));
  router.route("POST", "/api/auth/logout", rateLimit((ctx) => handleLogout(ctx)));
  router.route("GET", "/api/auth/me", rateLimit((ctx) => handleMe(ctx)));
  router.route("PUT", "/api/vault/key", (ctx) => handleKeyUpdate(ctx));
}
