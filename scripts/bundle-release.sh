#!/usr/bin/env bash
# Android App Bundle (.aab) for Google Play (P7, D82). Local and free; uploads nothing.
# Usage: scripts/bundle-release.sh [preview|production]   (default production)
#   - prebuild (no --clean) when the variant or the config changed, exactly like scripts/native.sh
#   - ./gradlew bundleRelease for arm64-v8a, armeabi-v7a, x86_64 (no 32-bit x86)
#   - signed with the owner's upload key when keystore.properties exists (plugins/with-release-signing.js, keystore.properties as described in MORNING_REPORT.md), otherwise
#     with the DEBUG key: such a bundle is for size checks only and Play refuses it
#   - copies the bundle to artifacts/builds/MakerPrint-v<version>-<variant>.aab and prints the per-ABI native code sizes
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

variant=${1:-production}
[[ $variant == preview || $variant == production ]] || { echo "variant must be preview or production"; exit 2; }
export APP_VARIANT=$variant

shopt -s nullglob
marker="android/.generated-for"
stamp="$variant $(cat app.config.ts package.json package-lock.json plugins/*.js modules/*/expo-module.config.json | shasum | cut -c1-12)"
if [[ ! -f $marker || "$(cat "$marker")" != "$stamp" ]]; then
  # shellcheck disable=SC2086
  SDKROOT="$(xcrun --sdk macosx --show-sdk-path)" npx expo prebuild ${PREBUILD_FLAGS:-} --platform android
  echo "$stamp" >"$marker"
fi

# same stale-autolinking fix as scripts/native.sh (variant switch without --clean)
if [[ -f android/build/generated/autolinking/autolinking.json ]]; then
  app_id=$(APP_VARIANT=$variant npx expo config --json --type public | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).android.package)')
  node -e '
    const fs = require("fs"); const [file, id] = process.argv.slice(1); const text = fs.readFileSync(file, "utf8");
    const next = text.replace(/("android":\{"packageName":")[^"]*(")/, `$1${id}$2`); if (next !== text) fs.writeFileSync(file, next);
  ' android/build/generated/autolinking/autolinking.json "$app_id"
fi
platform=android
source scripts/ssd-shims.sh
df -k / | awk 'NR==2 { if ($4 < 8 * 1048576) { printf "Only %.1f GiB free: three ABIs need ~8 GB of build output. Stop.\n", $4 / 1048576; exit 1 } }'
[[ -f keystore.properties ]] || echo "NOTE: keystore.properties not found - this bundle is signed with the DEBUG key (size check only, not uploadable)."

(cd android && ./gradlew bundleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64 --console=plain 2>&1 | grep -E "BUILD|FAILURE|error:|What went wrong" || true)
aab=android/app/build/outputs/bundle/release/app-release.aab
# the machine-wide Gradle init script puts build dirs on the SSD (scripts/ssd-shims.sh)
[[ -f $aab ]] || aab="/Volumes/Zweite/claude/gradle-build/$app_name/app/outputs/bundle/release/app-release.aab"
[[ -f $aab ]] || { echo "no bundle at $aab"; exit 1; }

version=$(node -p "require('./package.json').version")
mkdir -p artifacts/builds
out="artifacts/builds/MakerPrint-v${version}-${variant}.aab"
cp "$aab" "$out"
echo "bundle: $out ($(stat -f %z "$out") bytes)"
# Per-ABI native libraries inside the bundle (compressed / uncompressed bytes). A phone downloads one ABI plus dex and
# resources; `bundletool get-size total` gives Play's exact estimate (bundletool is not installed here).
unzip -v "$out" | awk '/ base\/lib\// { split($8, p, "/"); abi = p[3]; c[abi] += $3; u[abi] += $1 }
  / base\/dex\// { dc += $3; du += $1 }
  END { for (a in c) printf "  lib %-12s %10d compressed  %10d uncompressed\n", a, c[a], u[a]; printf "  dex          %10d compressed  %10d uncompressed\n", dc, du }'
