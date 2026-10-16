#!/bin/bash
# Compiles the reviewer's CoreGraphics/ImageIO measuring tools (macOS only) when the binary is missing or older
# than its source. Usage: scripts/cg/build.sh [tool ...]   (default: all)
set -euo pipefail
cd "$(dirname "$0")"
tools=("$@"); [ ${#tools[@]} -eq 0 ] && tools=(rmeasure crop srcinfo imgio encpdf)
for t in "${tools[@]}"; do
  if [ ! -x "$t" ] || [ "$t.swift" -nt "$t" ]; then xcrun swiftc -O -o "$t" "$t.swift" >/dev/null; fi
done
