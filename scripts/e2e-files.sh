#!/usr/bin/env bash
# Puts the P5 import fixtures where the real pickers find them (our own devices only, D26):
#   iOS: PDFs/SVGs (and the big SVGs) into Files → On My iPhone; photos into the Photos library (once per device).
#   Android: everything into Download/ (document picker) and the photos into Pictures/ (photo picker), media-scanned.
# Usage: scripts/e2e-files.sh <ios|android>   (run `node scripts/fixtures/make-e2e-fixtures.mjs --big` first)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
platform=${1:?Usage: e2e-files.sh <ios|android>}
docs=(test/fixtures/e2e/pattern-a2.pdf test/fixtures/e2e/drawing-ai72.svg artifacts/e2e-big/drawing-45mb.svg artifacts/e2e-big/poster-600x900.svg)
# dates: photo-2400 = Jan 1, bracket-ruler = Jan 2, photo-12mp = Jan 3 (10:00)
photos=(test/fixtures/e2e/photo-2400.jpg test/fixtures/e2e/bracket-ruler.jpg artifacts/e2e-big/photo-12mp.jpg)
device=$(scripts/boot.sh "$platform")
if [[ $platform == ios ]]; then
  group=$(xcrun simctl get_app_container "$device" com.apple.DocumentsApp groups | awk '$1 == "group.com.apple.FileProvider.LocalStorage" { print $2 }')
  dest="$group/File Provider Storage"
  mkdir -p "$dest"
  for f in "${docs[@]}"; do [[ -f $f ]] && cp "$f" "$dest/"; done
  # the photo picker labels photos only by date ("Photo, January 01, 10:00"): give each fixture its own date
  marker="artifacts/e2e-photos-v2-$device"
  if [[ ! -f $marker ]]; then
    day=1
    for f in "${photos[@]}"; do
      [[ -f $f ]] || continue
      touch -t "202601$(printf %02d $day)1000" "$f"
      xcrun simctl addmedia "$device" "$f"
      day=$((day + 1))
    done
    date >"$marker"
  fi
else
  for f in "${docs[@]}" "${photos[@]}"; do [[ -f $f ]] && adb -s "$device" push "$f" /sdcard/Download/ >/dev/null; done
  for f in "${photos[@]}"; do [[ -f $f ]] && adb -s "$device" push "$f" /sdcard/Pictures/ >/dev/null; done
  for f in "${docs[@]}" "${photos[@]}"; do
    b=$(basename "$f")
    adb -s "$device" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/$b" >/dev/null
    adb -s "$device" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Pictures/$b" >/dev/null
  done
fi
echo "fixtures on $platform ($device)"
