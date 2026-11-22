# Toasty mobile (iOS + Android)

**Status: beta (v0.2.0).** The mobile apps live in
[apps/mobile](../apps/mobile) — native shells around the same web vault the
website runs, so the app UI is exactly the website, talking to self-hosted
instances over the standard API ([docs/api.md](api.md)).

## What's built

- **Platforms:** iOS 16+ and Android 8+ (API 26+).
- **Vault browsing and editing** — the full web vault UI (view, create,
  update, delete logins, notes, cards, folders) with sync against the
  standard API (last-write-wins).
- **Autofill** — iOS Password AutoFill (Credential Provider extension) and
  the Android Autofill Framework, so logins fill into apps and the browser.
- **Same crypto, same API** — the web bundle reuses `@toasty/crypto`
  (PBKDF2 600k, HKDF key separation, AES-256-GCM) verbatim, so a vault
  created on mobile works in the web vault and extension and vice versa.
- **Stack decision:** WebView shells (WKWebView / Android WebView) around
  the web build. This was the deciding factor over React Native or fully
  native: honest, verbatim reuse of `@toasty/crypto` without reimplementing
  security-critical code per platform. Native code exists only where the
  platforms require it: autofill services and the device-encrypted
  credential cache.

## Autofill model

After unlock, the web app pushes login items to the native side; they are
encrypted with a device key (Android Keystore / iOS Keychain) and wiped on
lock. Autofill matches by web domain (browsers) or URL fragments (apps).
Nothing extra is sent to the server beyond the normal API sync.

## Building

- **Android:** `cd apps/mobile && ./build-android.sh` → debug APK (JDK 17+,
  Android SDK). Release builds: sign `assembleRelease` with your keystore.
- **iOS:** `cd apps/mobile/ios && xcodegen generate && open Toasty.xcodeproj`
  (macOS + Xcode, set your signing team).

## Testing program notes

- Beta runs against self-hosted instances; mobile testing follows the same
  model (TestFlight and Google Play internal testing).
- Testers should use a dedicated test vault, not their real one — zero-knowledge
  means nobody can recover data lost to a beta bug.
- Feedback goes through GitHub issues (label: `mobile`); see
  [docs/github-workflow.md](github-workflow.md).

## Planned next

- **Biometric unlock** — Face ID / Touch ID / fingerprint unlock a locally
  stored, wrapped vault key; the master password remains the root secret and
  is still never sent anywhere.
- Credential-provider quick-type suggestions (iOS `ASCredentialIdentityStore`).
- Passkey (WebAuthn) item support on mobile.

Questions and ideas are welcome as feature requests — they shape the mobile
scope as it matures.
