#!/usr/bin/env bash
# Boot the default iOS simulator or Android emulator if needed; print its device id.
# Usage: scripts/boot.sh <ios|android>
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

case "${1:?Usage: boot.sh <ios|android>}" in
  ios)
    udid=$(xcrun simctl list devices available -j | node -e '
      const name = process.argv[1];
      const all = Object.values(JSON.parse(require("fs").readFileSync(0, "utf8")).devices).flat();
      const d = all.find((x) => x.name === name && x.state === "Booted") ?? all.find((x) => x.name === name);
      if (!d) { console.error(`No iOS simulator named "${name}". Set IOS_SIMULATOR.`); process.exit(1); }
      console.log(d.udid);' "$IOS_SIMULATOR")
    xcrun simctl bootstatus "$udid" -b >/dev/null
    open -g -a Simulator
    echo "$udid"
    ;;
  android)
    # Only OUR emulator (ANDROID_SERIAL = emulator-5650, from env.sh): never a physical phone or another app's
    # emulator (template 2a6b1db; D26).
    find_serial() { adb devices | awk -v s="$ANDROID_SERIAL" '$1 == s && $2 == "device" { print $1; exit }'; }
    serial=$(find_serial)
    if [[ -z $serial ]]; then
      mkdir -p artifacts
      # -no-audio: host audio can hang the emulator. -crash-report-mode never: after a crash the next
      # boot otherwise waits forever on a "send crash report?" dialog nobody answers unattended.
      nohup emulator -avd "$ANDROID_AVD" -port "$ANDROID_EMULATOR_PORT" -no-boot-anim -no-snapshot-save -no-audio \
        -crash-report-mode never >artifacts/emulator.log 2>&1 &
      for _ in $(seq 1 90); do
        serial=$(find_serial)
        [[ -n $serial ]] && break
        sleep 2
      done
      [[ -n $serial ]] || { echo "Emulator $ANDROID_AVD did not start. See artifacts/emulator.log" >&2; exit 1; }
    fi
    until [[ "$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do sleep 2; done
    adb -s "$serial" reverse "tcp:$METRO_PORT" "tcp:$METRO_PORT" >/dev/null
    # Test-friendly emulator: no stylus-handwriting tutorial popping over the keyboard, no animations.
    adb -s "$serial" shell settings put secure stylus_handwriting_enabled 0
    for anim in window_animation_scale transition_animation_scale animator_duration_scale; do
      adb -s "$serial" shell settings put global "$anim" 0
    done
    echo "$serial"
    ;;
  *)
    echo "Usage: boot.sh <ios|android>" >&2
    exit 1
    ;;
esac
