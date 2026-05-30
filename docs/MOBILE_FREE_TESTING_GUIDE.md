# Get an APK in Testers' Hands — TODAY

**Companion to:** `docs/MOBILE_TESTFLIGHT_GUIDE.md` (the paid path).
This doc covers the **free** path: Android APK side-load to your team
without paying for anything, without installing Android Studio.

---

## Short answer
Skip Android Studio entirely. Install JDK 17 + Android command-line tools (~1.5 GB, 45 min), build with `gradlew.bat assembleDebug`, drop the APK in Google Drive, send testers a link. You'll be done before lunch.

---

## One-time install (~45 min, mostly downloads)

**1. JDK 17** — [Adoptium Temurin 17 MSI](https://adoptium.net/temurin/releases/?version=17). Run installer, check both boxes: **"Set JAVA_HOME"** and **"Add to PATH"**.

**2. Android command-line tools** — Download `commandlinetools-win-*.zip` from [developer.android.com](https://developer.android.com/studio#command-line-tools-only). Extract so the path is exactly:
```
C:\Android\cmdline-tools\latest\bin\sdkmanager.bat
```
The `latest\` folder name is mandatory — sdkmanager errors out otherwise.

**3. Environment variables** (System Properties → Environment Variables → System):
- `JAVA_HOME` = `C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot` (check actual folder)
- `ANDROID_HOME` = `C:\Android`
- Append to `Path`: `%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools`

**Reboot.** (Required — VS Code and terminals won't see new env vars otherwise.)

**4. SDK packages** — open a fresh PowerShell:
```powershell
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
sdkmanager --licenses
```
Press `y` through every license prompt.

---

## Build the APK (~30 sec after first build)

From your project root:
```powershell
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

**First build:** 5–10 min (Gradle downloads dependencies). **Every build after:** ~30 sec.

APK output:
```
android\app\build\outputs\apk\debug\app-debug.apk
```

> **Windows gotcha:** always `gradlew.bat`, never `./gradlew`. Backslashes everywhere.

---

## Do this RIGHT NOW (locks in long-term decisions)

**1. Back up your debug keystore — this is non-negotiable.**

Gradle just auto-generated `C:\Users\Samsung\.android\debug.keystore` on your first build. This file IS your app's identity. Lose it and testers must uninstall + reinstall every future version (losing app data). Reformat your laptop without it = same problem.

```powershell
Copy-Item "$env:USERPROFILE\.android\debug.keystore" "$env:USERPROFILE\Documents\monkeytravel-debug-keystore-BACKUP.keystore"
```
Then upload that backup to 1Password. Password is `android`, alias `androiddebugkey`.

**2. Generate a release keystore today too** (you'll need it the moment you grow past 5 testers or touch Play Store):
```powershell
keytool -genkey -v -keystore monkeytravel-release.jks -alias monkeytravel -keyalg RSA -keysize 2048 -validity 10000
```
Pick a strong password, write it down in 1Password, back up the `.jks` file to **two** locations. Losing this later = you can never update `app.monkeytravel` for any existing install. Ever.

**3. Confirm your app ID** in `android/app/build.gradle` — should be `app.monkeytravel` (or whatever you committed to). This is permanent across the app's life.

---

## Send to team (ranked)

1. **Google Drive shared link** ← recommended. Drag the APK in, right-click → "Share" → "Anyone with the link." Testers download in Chrome on their phone, it just works.
2. **Slack DM file upload** — works but Slack sometimes mangles the `.apk` extension on download, forcing testers to rename.
3. **WeTransfer / Smash** — fine for one-offs but link expires.

Use Drive. You'll be replacing the file every few days; same link, new APK, testers re-download.

---

## What testers see (paste this into Slack/email verbatim)

> **MonkeyTravel Beta — Android Install (5 min)**
>
> Thanks for testing. Android sideload takes a few extra taps — follow exactly:
>
> **1.** Open the link in **Chrome on your phone**. Tap the APK when it finishes downloading.
>
> **2.** Android will say *"your phone isn't allowed to install unknown apps."* Tap **Settings** → toggle **Allow from this source** → ON → back out. The install prompt reappears. Tap **Install**.
>
> **3.** Google Play Protect will warn the app isn't verified. **This is normal for beta builds.** Tap **More details** → **Install anyway** (or **Install without scanning**).
>
> **4. Samsung / Xiaomi / Oppo owners:** you'll see an extra "Safe Install" or 10-second countdown screen. Wait for the Install button to activate, tap **Install anyway**. If Samsung Auto Blocker is on (Settings → Security → Auto Blocker), turn it off for the install, then back on.
>
> **5.** Tap **Open**. Send me the build number on the splash + any feedback.
>
> **After testing:** turn "Install unknown apps" back **OFF** for Chrome. Don't disable Play Protect entirely. Don't forward the APK outside the group.

---

## Re-building for new versions

```powershell
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

~30 seconds. Same APK path. Upload to the same Drive link (replace file, keep link).

**Testers do NOT need to uninstall** — the debug keystore signature is stable across rebuilds on your machine, so new APKs install over the old one and preserve app data. (This is exactly why backing up `debug.keystore` matters — if you ever rebuild on a different machine without restoring it, signatures change and testers must uninstall first.)

---

## When to graduate to the paid path

- 5+ testers? Still fine on this path.
- 10+ testers? Move to Play Console Internal Testing ($25 one-time) — cleaner install UX (no "unknown sources" prompt).
- Ready to discover users via Play Store? Internal Testing → Closed Testing → Production (`docs/MOBILE_CONVERSION_PLAN.md` Phase A).
- Want iOS testers other than yourself? Apple Developer ($99/yr) → TestFlight (`docs/MOBILE_TESTFLIGHT_GUIDE.md`).

The free path validates ~90% of your product. Spend the $124 only when the constraint is real.
