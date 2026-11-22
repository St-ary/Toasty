#!/usr/bin/env bash
# Builds the Toasty Android APK:
#   1. builds the web vault with relative asset paths for the WebView shell
#   2. copies the bundle into the Android assets
#   3. runs the Gradle build
# Requires: JDK 17 or 21, Android SDK (API 35), Gradle 8.9+.
set -euo pipefail

cd "$(dirname "$0")"

# Gradle/AGP need JDK 17-21; newer JVMs (e.g. Java 25) fail with
# "Unsupported class file major version 69". Prefer an installed LTS JDK
# unless the caller exported a working JAVA_HOME.
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "${JAVA_HOME}/bin/java" ]; then
    for candidate in \
        /usr/lib/jvm/java-21-openjdk-amd64 \
        /usr/lib/jvm/java-21-openjdk \
        /usr/lib/jvm/temurin-21-jdk-amd64 \
        /usr/lib/jvm/jdk-21 \
        /usr/lib/jvm/java-17-openjdk-amd64 \
        /usr/lib/jvm/java-17-openjdk \
        /usr/lib/jvm/temurin-17-jdk-amd64 \
        /usr/lib/jvm/jdk-17; do
        if [ -x "$candidate/bin/java" ]; then
            export JAVA_HOME="$candidate"
            break
        fi
    done
fi
if [ -z "${JAVA_HOME:-}" ]; then
    echo "error: no JDK 17/21 found — e.g. apt install openjdk-21-jdk-headless" >&2
    exit 1
fi
echo "using JDK: $JAVA_HOME"

if [ -z "${ANDROID_HOME:-}" ] && [ -d /opt/android-sdk ]; then
    export ANDROID_HOME=/opt/android-sdk
fi

echo "[1/3] building web vault for mobile ..."
npm run build:mobile --prefix ../../apps/web

echo "[2/3] copying bundle into Android assets ..."
rm -rf android/app/src/main/assets/public
mkdir -p android/app/src/main/assets/public
cp -r ../../apps/web/dist/. android/app/src/main/assets/public/

echo "[3/3] gradle build ..."
cd android
if command -v gradle >/dev/null 2>&1; then
    gradle assembleDebug
else
    ./gradlew assembleDebug
fi

echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
