# Shared toolchain paths and defaults for project scripts. Source this file; don't run it.
export LANG="${LANG:-en_US.UTF-8}" # CocoaPods requires UTF-8
# Dev builds reach Metro via localhost (Android uses adb reverse); LAN IPs get blocked by firewalls.
export REACT_NATIVE_PACKAGER_HOSTNAME=localhost
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$HOME/.maestro/bin:/opt/homebrew/bin:$PATH"

# Default targets. Override per command, e.g. IOS_SIMULATOR="iPhone 17" npm run ios
export IOS_SIMULATOR="${IOS_SIMULATOR:-MakerPrint iPhone}"
export ANDROID_AVD="${ANDROID_AVD:-MakerPrint_API_36}"
# Dedicated ports so other apps can build in parallel (D26): emulator console 5650 (serial emulator-5650), Metro 8164.
export ANDROID_EMULATOR_PORT="${ANDROID_EMULATOR_PORT:-5650}"
export METRO_PORT="${METRO_PORT:-8164}"
# Pin every adb / Gradle (installDebug, expo run:android) / Maestro call to THIS app's emulator, so a plugged-in
# physical phone (or another app's emulator) is never touched (template 2a6b1db).
export ANDROID_SERIAL="emulator-${ANDROID_EMULATOR_PORT}"

# macOS 27 + Xcode 26: CocoaPods (pod install in `expo prebuild`) picks the Command Line Tools macOS SDK 27,
# whose libSystem.B.tbd fails with "malformed file". Pin the Xcode-shipped SDK. native.sh unsets it after prebuild
# because it must not leak into xcodebuild (it would override the iOS SDK).
if [[ -z "${SDKROOT:-}" ]] && _sdk=$(xcrun --sdk macosx --show-sdk-path 2>/dev/null) && [[ -n $_sdk ]]; then
  export SDKROOT="$_sdk"
fi
unset _sdk
