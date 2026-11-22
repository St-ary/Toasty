# Self-hosting Toasty

This guide takes you from an empty server to a working, TLS-secured Toasty vault.
The stack is deliberately small: **Postgres + one Node app container (API + web
vault) + Caddy (TLS)**.

```
Internet ──▶ Caddy (80/443, automatic TLS)
                │
                ▼
             app container (:8787, Node API + serves the built web SPA)
                │
                ▼
             Postgres 16 (ciphertext only — see docs/security.md)
```

## Prerequisites

- A server with [Docker](https://docs.docker.com/engine/install/) and Docker Compose
  (the `docker compose` plugin, v2).
- A domain name pointing at the server (recommended), or a LAN where you're fine
  with plain HTTP.
- Optional: DNS A/AAAA records already propagated — Caddy needs them to obtain
  Let's Encrypt certificates.

## Quick start

```bash
git clone https://github.com/stary/toasty.git
cd toasty
cp .env.example .env
```

Edit `.env` — at minimum set `POSTGRES_PASSWORD` (strong, URL-safe), `DOMAIN`, and
`CORS_ORIGIN` (must match the exact origin you'll visit, e.g.
`https://toasty.example.com`). Then edit the hostname in `docker/Caddyfile` to match
your domain.

```bash
docker compose up -d
```

Open `https://your-domain` and complete the first-run setup (next section).
That's it.

## Configuration reference (.env)

The server's environment variables are defined in [docs/api.md](docs/api.md); the
names below are exact and must not be changed.

| Variable | Example | Used by | Purpose |
| --- | --- | --- | --- |
| `POSTGRES_USER` | `toasty` | Postgres, app | Database role the app connects as |
| `POSTGRES_PASSWORD` | `change-me` | Postgres, app | Database password (URL-safe — it goes inside `DATABASE_URL`) |
| `POSTGRES_DB` | `toasty` | Postgres | Database name |
| `DOMAIN` | `toasty.example.com` | Caddy | The domain Caddy serves; edit `docker/Caddyfile` to match |
| `CORS_ORIGIN` | `https://toasty.example.com` | app | Exact allowed browser origin(s), comma-separated |
| `PORT` | `8787` | app | Listen port inside the container (set by `docker-compose.yml`) |
| `HOST` | `0.0.0.0` | app | Listen host inside the container (set by `docker-compose.yml`) |
| `DATABASE_URL` | `postgres://user:pass@db:5432/toasty` | app | Postgres connection string (assembled by `docker-compose.yml`) |
| `STATIC_DIR` | `/app/public` | app | Serve the built web SPA from here (set by the Docker image) |
| `SESSION_TTL_HOURS` | `24` | app | Session lifetime in hours |
| `SESSION_MAX_REFRESHES` | `3` | app | Session extensions allowed before re-login |
| `RATE_LIMIT_AUTH_PER_MINUTE` | `10` | app | Per-IP limit on `/api/auth/*` |
| `TRUST_PROXY` | `false` | app | Trust `X-Forwarded-For` — set `true` behind Caddy/your own proxy |
| `MIGRATE_ON_BOOT` | `true` | app | Run SQL migrations on startup (set by `docker-compose.yml`) |
| `ALLOW_REGISTRATION` | `false` | app | Reopen sign-ups after first-run setup (setup closes registration once the first account exists) |

## TLS via Caddy

The included `docker/Caddyfile` terminates TLS automatically with Let's Encrypt:
Caddy provisions and renews certificates on its own as long as the hostname in the
Caddyfile resolves to your server and ports 80/443 are reachable. Self-hosters
replace the example hostnames with their own domain:

```text
toasty.example.com {
    encode zstd gzip
    reverse_proxy app:8787
}
```

Then:

```bash
docker compose up -d caddy
docker compose logs -f caddy     # watch the certificate being issued
```

### Plain HTTP on a LAN

No public domain? Skip Caddy and publish the app port directly. Create a
`docker-compose.override.yml` next to `docker-compose.yml`:

```yaml
services:
  app:
    ports:
      - "8787:8787"
```

```bash
docker compose up -d db app
```

Open `http://<server-ip>:8787`, and set `CORS_ORIGIN=http://<server-ip>:8787` in
`.env`. Only do this on a trusted network — traffic is unencrypted.

## First-run setup

There is no seeded admin and no default password: zero-knowledge means the server
cannot create an account for you. While the instance has zero users, opening the site
shows a one-time setup wizard instead of a login page.

1. **Get the setup token.** The server prints a one-time setup token in its logs at
   boot. With the compose stack the app container is `toasty_manager-app-1`:

   ```bash
   docker logs toasty_manager-app-1
   ```

2. **Create your account.** Enter the token in the setup wizard, then create your
   account (email + master password). Your device generates the vault key and
   recovery code locally. Save the recovery code — it is shown once and is the only
   way back in if you forget your master password.

3. **Registration closes.** Completing setup closes sign-ups: later registration
   attempts get `403 registration_closed`, so the instance stays private. To run a
   multi-user instance with open sign-ups, set `ALLOW_REGISTRATION=true` in `.env`
   and restart the app.

## Backups

The database contains only ciphertext, so a plain `pg_dump` is safe to store
somewhere durable. Manual dump:

```bash
docker compose exec -T db pg_dump -U toasty toasty | gzip > toasty-$(date -u +%Y%m%d-%H%M%S).sql.gz
```

Nightly via cron (crontab entry on the host):

```cron
17 3 * * * cd /opt/toasty && docker compose exec -T db pg_dump -U toasty toasty | gzip > /backups/toasty-$(date +\%Y\%m\%d-\%H\%M\%S).sql.gz
```

Restore:

```bash
gunzip -c toasty-20260101-031700.sql.gz | docker compose exec -T db psql -U toasty toasty
```

Restoring replaces rows with the dump's contents; stop the app first
(`docker compose stop app`) to avoid writes during the restore.

## Upgrades

```bash
git pull
docker compose build app
docker compose up -d
```

Migrations run automatically on boot (`MIGRATE_ON_BOOT=true`). Take a backup first —
it costs one minute and has saved better sysadmins than us.

## Bringing your own reverse proxy

If Nginx, Traefik, or HAProxy already terminates TLS on the host, you don't need
Caddy:

1. Remove (or stop) the `caddy` service: `docker compose up -d db app`.
2. Proxy `https://your-domain` to `http://app:8787` from the proxy's network, or
   publish the app port (`ports: ["8787:8787"]`) and proxy to
   `http://127.0.0.1:8787`.
3. Set `TRUST_PROXY=true` so per-IP rate limiting sees real client addresses.
4. Make sure the proxy forwards `X-Forwarded-For` / `X-Forwarded-Proto` and that
   `CORS_ORIGIN` matches the public origin.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `port is already allocated` on startup | Something else owns 80/443 (or 5432) | Stop the other service, or change the host-side port mapping in `docker-compose.yml` |
| App restarts in a loop, logs show connection refused | Postgres not ready yet | Wait for the healthcheck (`docker compose ps`), then `docker compose restart app` |
| Web vault loads but login fails with a CORS error | `CORS_ORIGIN` doesn't match the browser origin exactly | Set `CORS_ORIGIN` to the full origin (`https://your-domain`, no trailing slash, correct scheme) and restart the app |
| Migration errors in app logs on upgrade | Old dump restored over a newer schema, or a half-applied migration | Restore the pre-upgrade backup, `git pull` to a consistent revision, restart; migrations are tracked in `schema_migrations` |
| Certificate issuance fails in Caddy logs | DNS not pointing at the server, or port 80 blocked | Verify DNS with `dig your-domain`, open 80/443 in the firewall |
| Cloudflare `Error 526: Invalid SSL certificate` | The domain is proxied (orange cloud) and Cloudflare rejects the origin cert — Caddy's HTTP-01 challenge can't complete behind the proxy, so it falls back to a self-signed cert | Either set the DNS record to **DNS only** (grey cloud) so Caddy issues a real Let's Encrypt certificate, or keep the proxy and set Cloudflare SSL/TLS to **Full (strict)** with a Cloudflare Origin Certificate in front of Caddy |

## Resource footprint

Small. A comfortable minimum is 1 vCPU, 512 MB RAM (256 MB works for light use),
and about 1 GB of disk including images. Idle usage is roughly: Postgres 60–100 MB,
app 60–120 MB, Caddy ~20 MB. PBKDF2 runs on the client, so server CPU stays quiet
even with many users.
