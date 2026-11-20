#!/usr/bin/env bash
# Store screenshots, capture step (iOS simulator, after .maestro/store-shots/seed.yaml has run).
# usage: scripts/store-shots-capture.sh <udid> <en|de> [flow-prefix ...]
# The PNG comes from `simctl io screenshot` (1320x2868 on the 6.9" device); scripts/png-drop-alpha.py rewrites it without alpha.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
udid=${1:?udid} lang=${2:?en|de}; shift 2
case $lang in en) apple="(en)"; printer="Inkjet" ;; de) apple="(de)"; printer="Tintenstrahler" ;; *) echo "lang must be en or de" >&2; exit 2 ;; esac
out=artifacts/screenshots/ios/$lang
mkdir -p "$out"
want=("$@")
for pair in f1-editor:01-editor f2-print:02-tiles f3-export:03-export f4-calibrate:04-calibrate f5-projects:05-projects; do
  flow=${pair%%:*}; name=${pair##*:}
  if [[ ${#want[@]} -gt 0 ]]; then [[ " ${want[*]} " == *" $flow "* ]] || continue; fi
  maestro --device "$udid" test -e APP_ID=com.plainapps.makerprint -e "APPLE_LANG=$apple" -e "PRINTER_NAME=$printer" ".maestro/store-shots/$flow.yaml" >/dev/null 2>&1 || { echo "FLOW FAILED: $flow"; continue; }
  raw=$(mktemp -t makerprint-shot).png
  xcrun simctl io "$udid" screenshot "$raw" >/dev/null 2>&1
  python3 -I scripts/png-drop-alpha.py "$raw" "$out/$name.png"
  echo "$name $(sips -g pixelWidth -g pixelHeight "$out/$name.png" | awk '/pixel/ { printf "%s ", $2 }') alpha=$(sips -g hasAlpha "$out/$name.png" | awk '/hasAlpha/ { print $2 }')"
done
