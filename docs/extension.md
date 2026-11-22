# Toasty browser extension

The browser extension is the everyday face of Toasty: it fills your logins, remembers
new ones as you sign up, and keeps an encrypted offline copy of your vault. It talks
to the same API as the web vault ([docs/api.md](docs/api.md)) and uses the exact same
cryptography (`@toasty/crypto`).

## What it does

- **Autofill** — fills username/password fields on login pages from your vault.
- **Save and remember** — when you log in with credentials the vault doesn't know,
  the extension offers to save them (encrypted) in one click.
- **TOTP codes** — shows the current TOTP code for logins that have one and copies it
  with a click.
- **Generators in the popup** — passwords (strong, unbiased — rejection sampling over
  your chosen character classes), usernames, and passphrases.
- **Matching by site** — logins are matched to pages by site/registrable domain, and
  you can pin items to specific URLs when a site has several environments.
- **Encrypted offline cache** — the vault is cached locally (ciphertext only), so
  autofill keeps working offline and syncs when you're back online.
- **Auto-lock** — the extension locks after an idle timeout (default 15 minutes) and
  clears its in-memory key when the browser exits.

## Install from the stores

| Browser | Store |
| --- | --- |
| Chrome | Chrome Web Store (link to be published) |
| Firefox | Firefox Add-ons (AMO) (link to be published) |
| Edge | Microsoft Edge Add-ons (link to be published) |

The extension works against any Toasty server: you configure the server URL yourself
on the extension's Options page (see below).

## Load unpacked (development)

```bash
npm install --include=dev
npm run build -w @toasty/extension
```

Then in Chrome or Edge: open `chrome://extensions` (Edge: `edge://extensions`),
enable **Developer mode**, click **Load unpacked**, and select
`apps/extension/dist`. On Firefox: `about:debugging` → **This Firefox** →
**Load Temporary Add-on…** → pick `apps/extension/dist/manifest.json`.

## Point it at your own server

Open the extension's **Options** page, set **Server URL** to your instance (e.g.
`https://toasty.example.com`), and sign in. Self-hosting details are in
[docs/self-hosting.md](docs/self-hosting.md).

## How autofill and "remember" work (high level)

1. On page load, the extension looks for login forms and derives the page's site
   (registrable domain).
2. If the vault is unlocked, it finds matching items — by site first, then by any
   pinned URLs — and fills the fields it can identify.
3. When you submit a login form with credentials the vault doesn't contain, a prompt
   offers to save them. The item is encrypted locally with your vault key
   (AES-256-GCM, AAD = item id) and uploaded as ciphertext via
   `PUT /api/vault/items/:id`.
4. Page contents and form values never leave the browser except as ciphertext.

Full key hierarchy and threat model: [docs/security.md](docs/security.md).

## Privacy note

All encryption happens locally in the extension. What gets stored and synced is
ciphertext and key-wrapping material only — the server (and the stores) never see
plaintext vault data, and your master password is never sent anywhere. Logging in
sends only a derived auth key, which proves knowledge of the master password
without revealing it.

## Store submission checklist (for the owner)

When adding the extension to the stores, prepare:

- **Screenshots** — 1280x800 and 640x400: popup with a login, generator, options
  page, save prompt.
- **Privacy policy URL** — hosted at `https://toasty.stary.lol/privacy`
  (placeholder until published).
- **Single purpose description** — "Autofill and manage passwords from a
  self-hostable, zero-knowledge vault."
- **Host permission justification** — the extension requests access to page URLs to
  detect login forms and autofill on sites the user visits; no data is transmitted
  except encrypted vault items to the configured server.
- **Data usage disclosure** — no data collected or sold; only ciphertext is synced
  to the user's chosen server.
- **Review notes** — explain the form-detection behavior, that encryption is local
  (point at `@toasty/crypto` and docs/security.md), and that the server URL is
  configured by the user.

## Update / release flow

1. Bump `version` in `apps/extension/manifest.json` (and `package.json`).
2. Build and package:

   ```bash
   npm run build -w @toasty/extension
   cd apps/extension/dist && zip -r ../../toasty-extension-<version>.zip .
   ```

3. Submit the zip to the Chrome Web Store, Firefox AMO, and Edge Add-ons (each has
   its own upload flow and review queue).
4. Tag the release (`v0.x.y`) per [docs/github-workflow.md](github-workflow.md) and
   keep store versions in sync across browsers.
