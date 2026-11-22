# Toasty API & Integration Contract

This document is the single source of truth for how `@toasty/server` and `@toasty/web`
talk to each other. Both MUST implement exactly this contract.

## Topology

- `@toasty/server` exposes the JSON API under `/api/*` (default port `8787`).
- In production the server also serves the built web app from `STATIC_DIR` (SPA fallback
  to `index.html`), so a deployment is just: Postgres + one app container + Caddy.
- In development, `vite dev` proxies `/api` to `http://localhost:8787`.

## Zero-knowledge rules

The server MUST never see master passwords, vault keys, or plaintext item data.
Everything below is what the server is allowed to store:

| Field | Meaning |
| --- | --- |
| `kdfSalt` | client-side PBKDF2 salt (base64url), not secret |
| `kdfIterations` | client-side KDF cost (integer) |
| `authKey` | proof of master password knowledge (base64url, 32 bytes) — sent once at register/login, stored only as a server-side scrypt hash |
| `wrappedVaultKey` | AES-GCM wrapped vault key (`v1.<iv>.<ct>`, base64url parts) |
| `recoveryWrappedVaultKey` | vault key wrapped with the recovery code key |
| item `ciphertext`/`iv` | AES-256-GCM ciphertext of the item JSON, keyed by the vault key, AAD = item id |

## Environment variables (server)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | listen port |
| `HOST` | `0.0.0.0` | listen host |
| `DATABASE_URL` | — | Postgres connection string (required) |
| `CORS_ORIGIN` | `http://localhost:5173` | comma-separated allowed origins (`*` allowed) |
| `STATIC_DIR` | unset | if set, serve SPA static files from this directory |
| `SESSION_TTL_HOURS` | `24` | session lifetime in hours |
| `SESSION_MAX_REFRESHES` | `3` | max `POST /api/auth/refresh` extensions per session |
| `RATE_LIMIT_AUTH_PER_MINUTE` | `10` | per-IP limit on `/api/auth/*` |
| `TRUST_PROXY` | `false` | trust `X-Forwarded-For` for rate limiting |
| `MIGRATE_ON_BOOT` | `true` | run SQL migrations on startup |
| `ALLOW_REGISTRATION` | `false` | allow open sign-ups after setup (default: setup-only) |
| `TOASTY_VERSION` | from `package.json` | reported version (normally set by the release image) |
| `UPDATE_CHECK` | `true` | poll the release channel for new versions |
| `UPDATE_MANIFEST_URL` | `https://toasty.stary.lol/versions.json` | release channel manifest |
| `UPDATER_URL` | unset | base URL of the updater sidecar (e.g. `http://updater:8090`); without it, updates show a command instead of switching automatically |
| `UPDATE_IMAGE_REPO` | unset | optional image repository override (e.g. `toasty`) used when switching versions |

## Database schema

```sql
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  auth_key_hash text not null,
  kdf_salt text not null,
  kdf_iterations integer not null,
  wrapped_vault_key text not null,
  recovery_wrapped_vault_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table vault_items (
  id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  ciphertext text not null,
  iv text not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index vault_items_user_updated_idx on vault_items (user_id, updated_at);
```

Migrations live in `apps/server/migrations/*.sql` and run in filename order at boot
(tracked in a `schema_migrations` table).

## Conventions

- All requests/responses are JSON (`Content-Type: application/json`).
- Authenticated requests send `Authorization: Bearer <session token>`.
- Errors: non-2xx with body `{"error": {"code": "<code>", "message": "<human readable>"}}`.
  Codes: `invalid_request`, `invalid_credentials`, `email_taken`, `registration_closed`,
  `invalid_setup_token`, `unauthorized`, `session_expired`, `not_found`, `rate_limited`,
  `internal`.
- Sessions: opaque bearer tokens, default lifetime `SESSION_TTL_HOURS` (24h). A session can
  be extended with `POST /api/auth/refresh` up to `SESSION_MAX_REFRESHES` times (default 3);
  once the refresh budget is spent the session is destroyed (`401 session_expired`) and the
  user must sign in again. Expired sessions are purged at boot and on every refresh.
- Rate limits (per IP): 10/min on `/api/auth/*`, 240/min on `/api/vault/*` (`429 rate_limited`).
  Logins additionally have per-account throttling: 5 consecutive failures lock the account
  for 60s, doubling per further failure up to 15min; the counter decays after 1h idle and
  clears on successful login.
- Timestamps are ISO-8601 UTC strings.
- Sync uses last-write-wins: the server assigns `updatedAt` on every write.

## Endpoints

### GET /api/health
No auth. `200 {"ok": true, "serverTime": "<iso>"}`.

### GET /api/status
No auth. Instance bootstrap state, driving the client's first screen.
`200 {"needsSetup": true, "registrationOpen": true}` — `needsSetup` is true while the
instance has zero users; `registrationOpen` is true while setup is pending or when
`ALLOW_REGISTRATION=true`.

### GET /api/auth/kdf?email=<email>
No auth. Login preflight so clients can run the KDF before sending `authKey`
(the KDF salt is not secret). `200 {"kdf": {"salt": "<b64url>", "iterations": 600000}}`.
Unknown emails return a deterministic per-installation decoy salt (same shape and
timing as a real one) so the endpoint cannot be used for account enumeration; the
subsequent login attempt simply fails with `invalid_credentials`.

### POST /api/auth/register
One-time instance setup (or open registration when `ALLOW_REGISTRATION=true`).
Body:
```json
{
  "email": "taster@stary.lol",
  "setupToken": "<from server logs, one-time setup only>",
  "kdf": { "salt": "<b64url>", "iterations": 600000 },
  "authKey": "<b64url>",
  "wrappedVaultKey": "v1.<iv>.<ct>",
  "recoveryWrappedVaultKey": "v1.<iv>.<ct>"
}
```
`201`:
```json
{
  "token": "<opaque session token>",
  "expiresAt": "<iso8601>",
  "refreshesLeft": 3,
  "user": { "id": "<uuid>", "email": "taster@stary.lol" },
  "vault": {
    "kdf": { "salt": "<b64url>", "iterations": 600000 },
    "wrappedVaultKey": "v1.<iv>.<ct>",
    "recoveryWrappedVaultKey": "v1.<iv>.<ct>"
  }
}
```
`409` with code `email_taken` if the email exists. Validates: email format, `authKey`
base64url length 32 bytes, wrapped key formats, `iterations` 100k–5M.
Registration rules: while the instance has zero users and `ALLOW_REGISTRATION` is
false, the body MUST include the one-time `setupToken` (printed in the server logs at
boot) or the request fails `403 invalid_setup_token`. Once a user exists, registration
is closed (`403 registration_closed`) unless `ALLOW_REGISTRATION=true`.

### POST /api/auth/login
Body: `{ "email": "...", "authKey": "<b64url>" }` → same `200` response shape as register.
`401` code `invalid_credentials` for unknown email or bad `authKey` (constant-time compare).
The server re-hashes `authKey` with scrypt and compares against the stored hash.

### POST /api/auth/logout
Auth required. Revokes the current session. `204`.

### POST /api/auth/refresh
Auth required. Extends the current session by `SESSION_TTL_HOURS` and consumes one of its
`SESSION_MAX_REFRESHES` refreshes. `200 {"expiresAt": "<iso>", "refreshesLeft": 2}`.
When the budget is exhausted the session is deleted and the response is
`401 session_expired` — clients must sign in again.

### GET /api/auth/me
Auth required. `200` with `{ "user", "vault" }` as in register (no token field).

### PUT /api/vault/key
Auth required. Master-password change / key rotation. Body (all fields optional except the
wrapped key):
```json
{
  "authKey": "<b64url>",
  "kdf": { "salt": "<b64url>", "iterations": 600000 },
  "wrappedVaultKey": "v1.<iv>.<ct>",
  "recoveryWrappedVaultKey": "v1.<iv>.<ct>"
}
```
Updates only the provided fields (`kdf.salt` and `kdf.iterations` update together).
`authKey`, when provided, is the NEW key material (e.g. after a master-password
change): the request is authenticated by the session token and the server stores the
new scrypt hash. `204`.

### GET /api/vault/items?since=<iso8601>
Auth required. Returns up to 1000 items changed after `since` (inclusive of tombstones),
ordered by `updatedAt`:
```json
{
  "items": [
    { "id": "<uuid>", "type": "login", "ciphertext": "<b64url>", "iv": "<b64url>",
      "deleted": false, "updatedAt": "<iso>" }
  ],
  "serverTime": "<iso>"
}
```
Omit `since` to get everything. The client stores `serverTime` as the next `since` value.

### PUT /api/vault/items/:id
Auth required. Upsert one item. Body:
```json
{ "type": "login", "ciphertext": "<b64url>", "iv": "<b64url>", "deleted": false }
```
`:id` must be a UUID generated client-side. `200` returns the stored item (server
`updatedAt`). Limits: `ciphertext` ≤ 64 KB, `type` ≤ 32 chars, max 10 000 items/user.

### POST /api/vault/items/batch
Auth required. Body: `{ "items": [ { "id", "type", "ciphertext", "iv", "deleted" }, ... ] }`
(up to 500 per call). `200`: `{ "items": [ ...stored... ], "serverTime": "<iso>" }`.

### DELETE /api/vault/items/:id

Auth required. Soft delete (writes a tombstone so other devices drop the item). `204`.

### GET /api/version

Public. Returns `{ current, latest, updateAvailable, versions, checkedAt, updaterAvailable }`
from the release channel manifest (`UPDATE_MANIFEST_URL`).

### POST /api/version/apply

Requires auth. Body `{ version }`. Switches the instance to that release through the
updater sidecar (`UPDATER_URL`) and returns `{ mode: "updater" | "manual", action, version,
message }`. Without an updater, `mode: "manual"` includes the `command` to run instead.
