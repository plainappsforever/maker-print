# Maker Print

Print PDFs, SVGs and photos at designed size, with a check bar. No ads.

Print what you designed at the size you designed it: templates, stencils, sewing and craft patterns, rulers, labels, decals. Everything stays on your phone. No account, no ads, no subscription, and the Android app has no internet permission.

**Get it:** [App Store](https://plainapps.dfdsfdsfsdf.workers.dev/apps/maker-print/) · [Google Play](https://plainapps.dfdsfdsfsdf.workers.dev/apps/maker-print/) · [GitHub Releases](https://github.com/plainappsforever/maker-print/releases) ·
[Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/plainappsforever/maker-print)

**Status:** first store release pending.

## Our promise

**Free, no ads, no tracking, no accounts.** This app keeps your data on your phone. It has no analytics, no crash
reporter, no advertising SDK and no sign-in. The Android release build has no INTERNET permission at all. We will not sell this app or this project to a company
that changes any of this.

Why we write it down: in 2023 a popular open-source Android suite was sold to an ad-funded app company and its store
listings started saying "Contains ads"; its community had to fork it to keep a clean version. The source code of
Maker Print is published under GPL-3.0, so if this promise were ever broken, anyone could continue the last
version that kept it.

## What it does

Pages written at their true size
Maker Print writes every page of its print file at the exact paper size and asks the print system not to scale it. PDF pages keep their designed size (it reads page boxes, rotation and unit scale). SVG files get their size from their units; if a file has none, the app asks once which program made it (96, 72 or 90 pixels per inch) and shows the resulting size before you place it. Photos show their resolution live while you type a size.

See the proof on the paper
Every print carries a 100 mm check bar. Measure it with a ruler. Printers, drivers and print dialogs can still change the size, and a screen cannot show true size: only paper proves it. If the bar is off, the Calibrate wizard prints a test sheet, you type what you measured, and Maker Print saves a correction for that printer and paper and applies it to later prints. It was tested with virtual printers on a simulator and an emulator; your own printer is the final judge, which is why the bar is there.

Big jobs on small paper
Sheets up to 3 metres are split into pages with overlap, registration marks that match on neighbouring pages, page labels with arrows and an assembly map. Blank pages are skipped and you can leave out single pages. Landscape pages are printed turned on portrait paper.

Templates and copies
Rulers up to 3 metres long, graph paper, dot grid, lined paper, circle templates and test squares. Add text, rectangles, ellipses and lines. Repeat a design in rows and columns, fill a sheet, add trim marks, mirror it for transfer paper. Set the scale of a photo from a length you know.

Units
Millimetres, centimetres and inches, including fractions such as 3 1/16". Type any unit into any size field. English and German.

Android printing
Printing several pages in one job can shrink them on printers without PDF support. Maker Print therefore prints pages one by one by default (one tap per page). You can switch this off after measuring your printer.

Export
Export a vector PDF at the exact paper size to print at a copy shop or from a computer (choose Actual size there).

Good to know
- SVG text, embedded pictures, patterns and filters are not printed, or printed differently; the app lists them before you print. For an exact result, import a PDF.
- PDF comments and form fields are not printed; flatten the PDF first.
- Maker Print keeps at least 3 mm blank at the paper edge.

Not included in this version
DXF import, PNG export, label sheet catalogues, barcodes, sequential numbers, custom fonts.

## Privacy

- All data is stored locally (SQLite in the app's private storage). Nothing is uploaded.
- Files leave the phone only when you share or export them yourself.
- Privacy policy: https://plainapps.dfdsfdsfsdf.workers.dev/apps/maker-print/privacy

## Build from source

The app identifier `com.tim.makerprint` is a placeholder: the identifier changes before the first store release.

You need: **Node.js 22 LTS** (the React Native version used here accepts `^20.19.4 || ^22.13.0 || ^24.3.0`), npm,
and git. The app is an [Expo](https://expo.dev) (SDK 57) / React Native app; the native `android/` and `ios/` folders
are generated from `app.config.ts` and are not in the repository.

```sh
git clone https://github.com/plainappsforever/maker-print.git
cd maker-print
npm ci
npm run verify          # typecheck + lint + all unit tests
```

### Android (Linux, macOS or Windows)

Needs JDK 17 and the Android SDK (Android Studio installs both; set `ANDROID_HOME`).

```sh
export APP_VARIANT=production
npx expo prebuild --platform android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# APK: android/app/build/outputs/apk/release/ (signed with the debug key unless you configure your own key)
```

`APP_VARIANT` selects the app id and name (`development`, `preview`, `production`; see `app.config.ts`).
Builds made this way are signed with your key, not ours, so they cannot update an installed store version.

### iOS (macOS only)

Needs Xcode (26 or newer) and CocoaPods.

```sh
export APP_VARIANT=production
npx expo prebuild --platform ios
npx expo run:ios --configuration Release        # runs on the iOS Simulator
```

For a real iPhone, open `ios/*.xcworkspace` in Xcode, choose your own team under *Signing & Capabilities*
and change the bundle identifier. There is no sideloading store for iOS; the App Store build is ours.

## Verifying a release

Every GitHub release lists SHA-256 checksums (`SHA256SUMS.txt`) and the APKs are signed with one key per app.
Certificate SHA-256 fingerprint: `not yet published on Android`

## How this app was made

Maker Print was written with substantial help from an AI coding assistant (Claude Code), directed, reviewed and
tested by the maintainer. We say this openly because some stores and users care about it.

## Licence

Copyright (C) 2026 Farija Retkoceri

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
License as published by the Free Software Foundation, version 3 (GPL-3.0-only). See [LICENSE](LICENSE).
Third-party components keep their own licences (see `LICENSES/` and the app's licences screen where present).
Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
