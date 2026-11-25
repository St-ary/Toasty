![CI](https://github.com/St-ary/Toasty/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-8B5E34.svg)
![Docker](https://img.shields.io/badge/docker-ready-C68B59.svg)
![Warning](https://img.shields.io/badge/⚠️-Toasty_is_in_beta_--_expect_bugs-C68B59.svg)

**Currently don’t have my pc anymore to test or fix bugs so I’ll add a support page to toasty.stary.lol/support for reporting bugs and errors**

# Toasty — self-hosted, zero-knowledge password manager

Toasty is a password manager you host yourself. Passwords, notes, and cards are
encrypted on your device with AES-256-GCM before upload — the server stores only
ciphertext, so even a fully compromised server reveals nothing without your
master password.

This repository is the vault: the API server, the web vault, the shared crypto,
the mobile apps, and the Docker setup to run it.

## Quickstart

The whole self-hosted stack comes up with one command:

```bash
git clone https://github.com/St-ary/Toasty.git
cd Toasty
cp .env.example .env
# edit .env — at minimum set POSTGRES_PASSWORD, DOMAIN, and CORS_ORIGIN
docker compose up -d
```

**First-run setup.** Open `https://your-domain` — while the instance has zero users,
the site shows the setup wizard instead of a login page. Grab the one-time **setup
token** printed in the server logs (`docker logs toasty_manager-app-1`), enter it in
the wizard, create your account (email + master password), and save the recovery code
you are given — it is shown once. Registration closes the moment setup is done, so
the instance is private from then on; set `ALLOW_REGISTRATION=true` in `.env` if you
want open sign-ups. The full walkthrough — TLS, backups, upgrades, troubleshooting —
is in [docs/self-hosting.md](docs/self-hosting.md).

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/server` | Node API (`@toasty/server`) — also serves the built web vault in production |
| `apps/web` | Web vault (`@toasty/web`) — the vault's browser interface |
| `apps/mobile` | iOS and Android apps (WebView shells + native autofill) |
| `packages/crypto` | Shared zero-knowledge crypto (`@toasty/crypto`) |
| `docs/` | Self-hosting, API, and security documentation |
| `docker/` | Dockerfile and Caddyfile |

## Documentation

| Document | Covers |
| --- | --- |
| [docs/self-hosting.md](docs/self-hosting.md) | Running Toasty yourself with Docker |
| [docs/api.md](docs/api.md) | API contract and server environment variables |
| [docs/security.md](docs/security.md) | The zero-knowledge model, in detail |

## Local development

```bash
npm install --include=dev
docker compose up db        # Postgres only
npm run dev:server          # API on http://localhost:8787
npm run dev:web             # web vault on http://localhost:5173
```

The dev server reads the environment variables documented in
[docs/api.md](docs/api.md) (at minimum `DATABASE_URL`); the web dev server proxies
`/api` to `http://localhost:8787`.

## Security

Toasty is zero-knowledge end to end: your master password derives a key on your
device, that key unlocks a vault key, and the vault key encrypts every item with
AES-256-GCM before upload. The server stores only ciphertext, wrapped keys, and a
salt — it cannot read your vault, and neither can we. The full key hierarchy,
threat model, and non-guarantees are documented in
[docs/security.md](docs/security.md). Found a vulnerability? See
[CONTRIBUTING.md](CONTRIBUTING.md) — do not file a public issue.

## Contributing

Bug reports, feature ideas, and pull requests are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/github-workflow.md](docs/github-workflow.md).

## License

MIT — see [LICENSE](LICENSE).
