# Sourced by native.sh and bundle-release.sh (P7). Needs $platform (android) and $variant. The machine-wide Gradle init script
# (~/.gradle/init.d/build-dir-on-ssd.gradle) moves every build dir to /Volumes/Zweite/claude/gradle-build; two readers still look in
# the old places. Nothing is deleted.
# v1.1 (REVIEW_V1 finding 22): with the init script in place but the SSD not mounted, Gradle and CMake fail later with
# confusing "No such file" errors (and the codegen symlinks below dangle) — stop here and say why.
if [[ $platform == android && -f "$HOME/.gradle/init.d/build-dir-on-ssd.gradle" && ! -d /Volumes/Zweite/claude/gradle-build ]]; then
  echo "ssd-shims: the SSD folder /Volumes/Zweite/claude/gradle-build is not there, but ~/.gradle/init.d/build-dir-on-ssd.gradle moves" >&2
  echo "           every Android build dir onto it. Connect/mount the SSD (named Zweite) and run the build again." >&2
  exit 1
fi
app_name=$(npx expo config --json --type public | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).name)')
# The machine-wide Gradle init script (~/.gradle/init.d/build-dir-on-ssd.gradle) moves every build dir to the SSD, but the React Native
# settings plugin still writes autolinking.json to android/build while the app project reads it from the (moved) root build dir:
# put a copy where it is read (found in P7: "autolinking.json (No such file or directory)").
if [[ $platform == android && -f android/build/generated/autolinking/autolinking.json && -d /Volumes/Zweite/claude/gradle-build ]]; then
  mkdir -p "/Volumes/Zweite/claude/gradle-build/$app_name/root/generated/autolinking"
  cp android/build/generated/autolinking/autolinking.json "/Volumes/Zweite/claude/gradle-build/$app_name/root/generated/autolinking/autolinking.json"
fi
# The same init script also moves the codegen output that these libraries' CMake files read from their own android/build folder
# (autolinking.cmake: node_modules/<lib>/android/build/generated/source/codegen/jni): point that folder at the SSD build dir of the
# current variant with a symlink (created only when the folder is absent or already a symlink; nothing is deleted; P7).
if [[ $platform == android && -d /Volumes/Zweite/claude/gradle-build ]]; then
  for lib in react-native-gesture-handler react-native-reanimated react-native-worklets react-native-safe-area-context react-native-screens react-native-svg; do
    target="/Volumes/Zweite/claude/gradle-build/$app_name/$lib"
    link="node_modules/$lib/android/build"
    if [[ ! -e $link || -L $link ]]; then mkdir -p "$target"; ln -sfn "$target" "$link"; fi
  done
fi
