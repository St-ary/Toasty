![CI](https://github.com/St-ary/Toasty/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-8B5E34.svg)
![Docker](https://img.shields.io/badge/docker-ready-C68B59.svg)

# Toasty — warm, zero-knowledge password management

Toasty is the open-source password manager you can host yourself in minutes. Every
password, note, and card is encrypted on your device with AES-256-GCM before it ever
touches the network — the server only ever stores ciphertext, so even a fully
compromised server reveals nothing without your master password. The project's guide
site — what Toasty is and how to download and self-host it — lives at
[toasty.stary.lol](https://toasty.stary.lol). This repository is the product:
API, web vault, browser extension, mobile apps, shared crypto, and the Docker
setup to run it all.

## Feature highlights

- **Zero-knowledge encryption** — AES-256-GCM for every item, keys derived with
  PBKDF2-HMAC-SHA-512 at 600,000 iterations. Master passwords never leave the device.
- **Self-host with one Docker command** — Postgres + one app container + Caddy for
  automatic TLS, with a guided one-time setup. See
  [docs/self-hosting.md](docs/self-hosting.md).
- **Browser extension with autofill and remember** — fill logins on any site, save new
  ones as you log in, and see or copy TOTP codes right where you sign in. Chrome,
  Firefox, and Edge.
- **Generators in the popup** — strong passwords, usernames, and passphrases whenever
  you need a fresh secret.
- **Encrypted backups** — dump the database any time; the dump contains only
  ciphertext and key-wrapping material.
- **White and dark mode** — a warm "Cinnamon Toast Crunch" theme in white, and a deep
  roast dark mode for the night shift.
- **Works offline** — clients cache the encrypted vault locally, so it keeps working
  with no connection and syncs when you're back.

## Two ways to use Toasty

| Way | What it is | Where |
| --- | --- | --- |
| **Self-host** | Run this repo yourself with Docker. Your data, your server, your rules. | This repository, [docs/self-hosting.md](docs/self-hosting.md) |
| **Browser extension** | Store-distributed (Chrome Web Store / Firefox AMO / Edge); works with any Toasty server you configure. | [docs/extension.md](docs/extension.md) |

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

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/server` | Node API (`@toasty/server`) — also serves the built web vault in production |
| `apps/web` | Web vault SPA (`@toasty/web`) |
| `apps/extension` | Browser extension (`@toasty/extension`) |
| `packages/crypto` | Shared zero-knowledge crypto (`@toasty/crypto`) |
| `docs/` | Documentation |
| `docker/` | Dockerfile and Caddyfile |

## Documentation

| Document | Covers |
| --- | --- |
| [docs/self-hosting.md](docs/self-hosting.md) | Running Toasty yourself with Docker |
| [docs/extension.md](docs/extension.md) | Browser extension: install, configure, submit to stores |
| [docs/mobile.md](docs/mobile.md) | Mobile apps (iOS + Android) with autofill |
| [docs/github-workflow.md](docs/github-workflow.md) | Issues, forks, PRs, CI, releases |
| [docs/api.md](docs/api.md) | API contract and server environment variables |
| [docs/security.md](docs/security.md) | The zero-knowledge model, in detail |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute code |

## Security

Toasty is zero-knowledge end to end: your master password derives a key on your
device, that key unlocks a vault key, and the vault key encrypts every item with
AES-256-GCM before upload. The server stores only ciphertext, wrapped keys, and a
salt — it cannot read your vault, and neither can we. The full key hierarchy,
threat model, and non-guarantees are documented in
[docs/security.md](docs/security.md). Found a vulnerability? See
[CONTRIBUTING.md](CONTRIBUTING.md) — do not file a public issue.

## Contributing

Bug reports, feature ideas, and pull requests are welcome. Start with
[docs/github-workflow.md](docs/github-workflow.md) for the GitHub workflow and
[CONTRIBUTING.md](CONTRIBUTING.md) for setup and style rules.

## Roadmap

1. Web vault + browser extension: built, heading into beta.
2. Beta testing with real users on self-hosted instances.
3. **Mobile app (iOS + Android) after the beta** — same crypto, same API. See
   [docs/mobile.md](docs/mobile.md).

## License

MIT — see [LICENSE](LICENSE).
