# Toasty mobile (iOS + Android)

Native shells around the **same web vault** the website runs — the app UI is
exactly the website, shipped inside the binary, talking to your self-hosted
Toasty server over the standard API. Zero-knowledge stays intact: the vault
key is derived from your master password on-device and the autofill cache
lives only in hardware-backed device storage while the vault is unlocked.

## What's here

- `android/` — Android app (Kotlin):
  - `MainActivity` — WebView shell loading the bundled web vault
  - `VaultCache` — AES-256-GCM credential cache in the Android Keystore
  - `autofill/ToastyAutofillService` — Android Autofill Framework integration
    (fills logins into apps and browsers)
- `ios/` — iOS app (Swift):
  - `App/` — WKWebView shell (XcodeGen `project.yml` included)
  - `AutofillExtension/` — Password AutoFill Credential Provider extension
- `build-android.sh` — builds the debug APK end to end

## Android build

Requirements: JDK 17+, Android SDK (API 35), Gradle 8.9+.

```sh
cd apps/mobile
./build-android.sh
# APK lands in android/app/build/outputs/apk/debug/app-debug.apk
```

For a release build, sign `assembleRelease` with your own keystore.

## iOS build

iOS requires Xcode on macOS (Apple does not allow other toolchains):

```sh
cd apps/mobile/ios
xcodegen generate        # brew install xcodegen
open Toasty.xcodeproj    # set your signing team, then run
```

Enable **Password AutoFill** for Toasty in Settings → Passwords → AutoFill,
and the extension offers your logins in apps and Safari.

## No Mac? (Windows/Linux → iPhone)

Apple won't let non-Apple machines sign iOS apps locally, but the
**GitHub Actions workflow** (`.github/workflows/mobile.yml`) builds the IPA
in the cloud on every push (or run it manually from the Actions tab) and
downloads it as an artifact. Then sideload it from Windows:

1. **AltStore** (free, easiest) — install [AltServer](https://altstore.io)
   on your Windows PC, plug in the iPhone, and use AltServer → Sideload .ipa
   to install the downloaded `Toasty.ipa`. Needs a free Apple ID; the app
   must be re-signed every 7 days (AltStore refreshes it automatically over
   Wi-Fi when both devices are on the same network).
2. **SideStore** — same idea, refreshes on-device without the PC after the
   first install.
3. **TestFlight** (paid, $99/yr Apple Developer Program) — push the IPA to
   App Store Connect (the workflow has a stub for this; add your App Store
   Connect API key secrets), then install via the TestFlight app. Lasts a
   year and updates over the air — the realistic route if you distribute to
   other people.

For Android there is no such restriction: `app-debug.apk` from the same
workflow installs directly on any Android phone.

## First launch

The app asks for your server URL (e.g. `https://vault.stary.lol`) — the same
instance you use in a browser. Sign in with your master password and the
vault syncs over the standard API ([docs/api.md](../../docs/api.md)).

## Autofill model

- After unlock, the web app pushes login items to the native side; they are
  encrypted with a device key (Android Keystore / iOS Keychain) and never
  leave the device in plaintext.
- On lock (or app kill), the cache is wiped.
- Autofill matches by web domain (browsers) or URL fragments (apps).
- Nothing is sent to the Toasty server beyond the normal API sync.

## Status

v0.2.0 — beta. Test against a self-hosted instance with a **test vault**
first; zero-knowledge means nobody can recover data lost to a beta bug.
Feedback: GitHub issues with the `mobile` label.
