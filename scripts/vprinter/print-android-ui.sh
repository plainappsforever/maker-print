#!/usr/bin/env bash
# P6: prints from the app's own UI on OUR emulator to the virtual printer "MakerPrint Android" (never a real printer).
# Usage: scripts/vprinter/print-android-ui.sh <screen|cal|cal-multi> <seed> [pages=1] [toggle]
#   screen = Print & export screen of the seed's first project (pages = jobs to send: >1 for "one by one");
#   cal / cal-multi = Calibrate screen, A4 sheet / 2-page check. "toggle" flips the one-by-one switch first.
# Step 1 (Maestro) opens the dialog; the printer list is a popup Maestro cannot see, so the entry is tapped by its
# uiautomator bounds here; step 2 (Maestro) asserts the destination and taps Print. Same safety as print-android.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/env.sh
mode=${1:?mode}; set=${2:?seed}; pages=${3:-1}; one=${4:-keep}
printer=${PRINTER:-MakerPrint Android} # PRINTER="Save as PDF": the PrintSpooler's PDF printer (no network)
app=${APP:-com.tim.makerprint.dev} # APP=com.tim.makerprint.preview OPEN_FLOW=.maestro/release/android-open-dialog.yaml: the Release build (P7)
open_flow=${OPEN_FLOW:-.maestro/measure/android-open-dialog.yaml}
out="artifacts/maestro/android-measure-p6-$mode-$set-$(date +%H%M%S)"
maestro --device "$ANDROID_SERIAL" test -e APP_ID=$app -e MODE="$mode" -e SET="$set" -e ONE="$one" --test-output-dir "$out" "$open_flow" >/dev/null
dump() { adb -s "$ANDROID_SERIAL" shell uiautomator dump /sdcard/mp-ui.xml >/dev/null; adb -s "$ANDROID_SERIAL" shell cat /sdcard/mp-ui.xml; }
tap_text() { # $1 = exact text, $2 = "available": only a row that has the printer-info button (stale entries have none)
  dump | node -e '
    const xml = require("fs").readFileSync(0, "utf8"); const [want, mode] = process.argv.slice(1);
    const nodes = [...xml.matchAll(/<node [^>]*?text="([^"]*)"[^>]*?resource-id="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)].map((x) => ({ text: x[1], id: x[2], b: x.slice(3, 7).map(Number) }));
    const info = nodes.filter((n) => n.id.endsWith(":id/more_info"));
    const hits = nodes.filter((n) => n.text === want && (mode !== "available" || info.some((i) => i.b[1] <= n.b[1] && i.b[3] >= n.b[3])));
    if (!hits.length) { console.error(`"${want}" not on screen`); process.exit(1); }
    const m = hits[0].b;
    console.log(`${(m[0] + m[2]) >> 1} ${(m[1] + m[3]) >> 1}`);' "$1" "${2:-any}"
}
tap_id() {
  dump | node -e 'const x = require("fs").readFileSync(0, "utf8"); const m = x.match(new RegExp(`resource-id="${process.argv[1]}"[^>]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`)); if (!m) process.exit(1); const b = m.slice(1).map(Number); console.log(`${(b[0] + b[2]) >> 1} ${(b[1] + b[3]) >> 1}`)' "$1"
}
selected() { dump | node -e 'const x = require("fs").readFileSync(0, "utf8"); const m = x.match(/text="([^"]*)"[^>]*resource-id="com.android.printspooler:id\/title"/); console.log(m ? m[1] : "")'; }
choose_printer() {
  sleep 2
  if [[ $printer == "Save as PDF" ]]; then
    if [[ "$(selected)" != "$printer" ]]; then
      adb -s "$ANDROID_SERIAL" shell input tap $(tap_id com.android.printspooler:id/destination_spinner)
      sleep 2
      adb -s "$ANDROID_SERIAL" shell input tap $(tap_text "$printer")
      sleep 2
    fi
    return
  fi
  # a preselected entry may be a stale one of a restarted virtual printer ("isn't available"): pick it from All printers
  if [[ "$(selected)" == "$printer" ]] && ! dump | grep -q "available right now"; then return; fi
  adb -s "$ANDROID_SERIAL" shell input tap $(tap_id com.android.printspooler:id/destination_spinner)
  sleep 2
  adb -s "$ANDROID_SERIAL" shell input tap $(tap_text "All printers…")
  local xy=""
  for _ in $(seq 1 15); do # discovery of a restarted virtual printer can take ~20 s
    sleep 3
    xy=$(tap_text "$printer" available 2>/dev/null) && break
  done
  [[ -n $xy ]] || { echo "$printer not available in All printers" >&2; exit 1; }
  adb -s "$ANDROID_SERIAL" shell input tap $xy
  sleep 2
}
case $mode in
  screen) outcome=print-outcome-0 ;;
  *) outcome=calibration-outcome-0 ;;
esac
for ((i = 1; i <= pages; i++)); do
  choose_printer
  if ((i < pages)); then
    id=com.android.printspooler:id/title; text=".+"
  else
    id=$outcome; text=".*(Sent through the exact print route|All [0-9]+ pages sent one by one).*"
  fi
  if [[ $printer == "Save as PDF" ]]; then
    file="p6-$mode-$set-$one-$i-$(date +%H%M%S)"
    maestro --device "$ANDROID_SERIAL" test -e APP_ID=$app -e FILE="$file" -e OUTCOME="$id" -e TEXT="$text" --test-output-dir "$out" .maestro/measure/android-save-step2.yaml >/dev/null
    mkdir -p artifacts/vprinter/android-pdf
    sleep 2
    adb -s "$ANDROID_SERIAL" pull "/sdcard/Download/$file.pdf" "artifacts/vprinter/android-pdf/$file.pdf" >/dev/null && echo "pulled artifacts/vprinter/android-pdf/$file.pdf"
  else
    maestro --device "$ANDROID_SERIAL" test -e APP_ID=$app -e PRINTER="$printer" -e OUTCOME="$id" -e TEXT="$text" --test-output-dir "$out" .maestro/measure/android-print-step2.yaml >/dev/null
  fi
  echo "job $i/$pages sent"
done
