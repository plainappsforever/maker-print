#!/usr/bin/env bash
# Prints a referee fixture from the debug screen on OUR emulator to the virtual printer (P4 measurement, A7).
# Usage: scripts/vprinter/print-android.sh <fixture-name> <exact|fallback> ["MakerPrint Test"|"Save as PDF"]
# Step 1 (Maestro) opens the dialog and its printer list; the list is a popup Maestro cannot see, so the entry is tapped
# by its uiautomator bounds here; step 2 (Maestro) asserts the destination and taps Print.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/env.sh
name=${1:?fixture}; route=${2:?route}; printer=${3:-MakerPrint Android}
out="artifacts/maestro/android-measure-$name-$route-$(date +%H%M%S)"
maestro --device "$ANDROID_SERIAL" test -e APP_ID=com.tim.makerprint.dev -e NAME="$name" -e ROUTE="$route" --test-output-dir "$out" .maestro/measure/print-android.yaml >/dev/null
tap_text() { # $1 = exact text, $2 = "available": only a row that has the printer-info button (stale entries have none)
  adb -s "$ANDROID_SERIAL" shell uiautomator dump /sdcard/mp-ui.xml >/dev/null
  adb -s "$ANDROID_SERIAL" shell cat /sdcard/mp-ui.xml | node -e '
    const xml = require("fs").readFileSync(0, "utf8"); const [want, mode] = process.argv.slice(1);
    const nodes = [...xml.matchAll(/<node [^>]*?text="([^"]*)"[^>]*?resource-id="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)].map((x) => ({ text: x[1], id: x[2], b: x.slice(3, 7).map(Number) }));
    const info = nodes.filter((n) => n.id.endsWith(":id/more_info"));
    const hits = nodes.filter((n) => n.text === want && (mode !== "available" || info.some((i) => i.b[1] <= n.b[1] && i.b[3] >= n.b[3])));
    if (!hits.length) { console.error(`"${want}" not on screen`); process.exit(1); }
    const m = hits[0].b;
    console.log(`${(m[0] + m[2]) >> 1} ${(m[1] + m[3]) >> 1}`);' "$1" "${2:-any}"
}
# "Save as PDF" is always in the popup; a network printer is picked in "All printers…", which lists only printers
# discovered NOW (the popup also keeps stale recent entries of a restarted virtual printer)
if [[ $printer == "Save as PDF" ]] && xy=$(tap_text "$printer" 2>/dev/null); then
  adb -s "$ANDROID_SERIAL" shell input tap $xy
else
  adb -s "$ANDROID_SERIAL" shell input tap $(tap_text "All printers…")
  sleep 6
  adb -s "$ANDROID_SERIAL" shell input tap $(tap_text "$printer" available)
fi
sleep 2
if [[ $printer == "Save as PDF" ]]; then
  maestro --device "$ANDROID_SERIAL" test -e APP_ID=com.tim.makerprint.dev -e NAME="$name" --test-output-dir "$out" .maestro/measure/save-pdf-android.yaml
else
  maestro --device "$ANDROID_SERIAL" test -e APP_ID=com.tim.makerprint.dev -e NAME="$name" -e PRINTER="$printer" --test-output-dir "$out" .maestro/measure/print-android-2.yaml
fi
