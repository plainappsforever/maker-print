#!/usr/bin/env bash
# Writes .maestro/release/<flow>.yaml from the dev flows of the same name: the seed step becomes a wiped-app start
# (subflows/release-start.yaml, no deep-link seeds in Release builds, D82) and subflow paths go one level up.
# Run it after changing a dev flow; the generated files are committed. Usage: scripts/make-release-flows.sh
set -euo pipefail
cd "$(dirname "$0")/.."
for f in smoke new-blank templates pdf-pattern photo-decal svg-units repeat-labels calibrate settings-de; do
  sed -e 's#file: subflows/seed.yaml#file: ../subflows/release-start.yaml#' \
      -e 's#subflows/#../subflows/#g' -e 's#\.\./\.\./subflows#../subflows#g' \
      -e 's#^name: #name: Release - #' -e 's#^  - p[0-9]*$#  - release#' -e 's#^  - smoke$#  - release#' \
      ".maestro/$f.yaml" >".maestro/release/$f.yaml"
done
echo "wrote $(ls .maestro/release | wc -l) release flows"
