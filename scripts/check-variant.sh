#!/usr/bin/env bash
# F1 / D54: reads the Expo config EMBEDDED in a built binary and fails when it is not the variant you meant to ship.
# Usage: scripts/check-variant.sh <production|preview|development> <file.apk | file.aab | App.app | App.xcarchive>
# Checks extra.appVariant and scheme against app.config.ts for that variant. Run it on EVERY store-bound binary before upload.
set -euo pipefail
cd "$(dirname "$0")/.."

variant=${1:?Usage: check-variant.sh <production|preview|development> <apk|aab|app|xcarchive>}
target=${2:?Usage: check-variant.sh <production|preview|development> <apk|aab|app|xcarchive>}
[[ -e $target ]] || { echo "check-variant: $target not found" >&2; exit 2; }

expected=$(APP_VARIANT=$variant npx --no-install expo config --json --type public | node -e 'const c=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(c.extra.appVariant+" "+c.scheme)')
want_variant=${expected%% *}
want_scheme=${expected##* }

case $target in
  *.apk) embedded=$(unzip -p "$target" assets/app.config) ;;
  *.aab) embedded=$(unzip -p "$target" base/assets/app.config) ;;
  *.app) embedded=$(cat "$(find "$target" -path '*EXConstants.bundle/app.config' | head -1)") ;;
  *.xcarchive) embedded=$(cat "$(find "$target" -path '*EXConstants.bundle/app.config' | head -1)") ;;
  *) echo "check-variant: unsupported file type: $target" >&2; exit 2 ;;
esac
[[ -n $embedded ]] || { echo "check-variant: no embedded app.config found in $target" >&2; exit 2; }

got=$(printf '%s' "$embedded" | node -e 'const c=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log((c.extra&&c.extra.appVariant)+" "+c.scheme)')
got_variant=${got%% *}
got_scheme=${got##* }
echo "embedded: appVariant=$got_variant scheme=$got_scheme; expected: appVariant=$want_variant scheme=$want_scheme"
if [[ $got_variant != "$want_variant" || $got_scheme != "$want_scheme" ]]; then
  echo "check-variant: FAIL - this binary was built with the wrong APP_VARIANT" >&2
  exit 1
fi
echo "check-variant: OK"
