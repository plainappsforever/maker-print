#!/usr/bin/env bash
# Samples the app's memory every second until stopped (Ctrl-C / kill by the PID this prints): iOS = RSS of the
# simulator process (MB), Android = dumpsys meminfo TOTAL PSS (MB). Our devices only. Usage: scripts/sample-mem.sh <ios|android> <out.txt>
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
platform=${1:?}; out=${2:?}
app=com.tim.makerprint.dev
: >"$out"
[[ $platform == ios ]] && udid=$(scripts/boot.sh ios)
while true; do
  if [[ $platform == ios ]]; then
    pid=$(xcrun simctl spawn "$udid" launchctl list 2>/dev/null | awk -v a="$app" '$3 ~ a { print $1; exit }')
    [[ -n ${pid:-} && $pid != "-" ]] && echo "$(date +%s) $(( $(ps -o rss= -p "$pid" 2>/dev/null || echo 0) / 1024 ))" >>"$out"
  else
    kb=$(adb -s "$ANDROID_SERIAL" shell dumpsys meminfo "$app" 2>/dev/null | awk '/TOTAL PSS:/ { print $3; exit } /^ +TOTAL / { print $2; exit }')
    [[ -n ${kb:-} ]] && echo "$(date +%s) $(( kb / 1024 ))" >>"$out"
  fi
  sleep 1
done
