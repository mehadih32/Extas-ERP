# Extas ERP for Android

The Extas ERP web app in a native Android frame ([Capacitor](https://capacitorjs.com) 8),
for staff who check in and then travel: while they are checked in (GPS attendance), the
`DutyTracker` plugin keeps sending the phone's position from a foreground service, with the
screen off or the app closed, until they check out.

- `capacitor.config.js`: the app opens `EXTAS_APP_URL` (the company's Extas ERP server), so
  screens come from the server and need no new APK.
- `android/app/src/main/java/com/extas/erp/`: `MainActivity` registers the plugin;
  `DutyTrackerPlugin` is what the pages call (`start`, `stop`, `status`, `permissions`, see
  `src/components/hr/location-client.ts`); `DutyTrackerService` takes a position about every
  30 s with Android's own location (GPS and network, no Google Play services), keeps them on
  the phone with no network, sends them each minute to `/api/portal/location/pings` with the
  web app's sign-in cookie, and stops when the server answers `onDuty: false`.
- `www/`: the page shown when the server cannot be reached.
- `android/` is Capacitor's project (`npx cap add android`), with the plugin, the service,
  the permissions in `AndroidManifest.xml`, Extas icons and splash screens. Files that
  `cap sync` writes are not kept in git.

Building: the **Android app** workflow (`.github/workflows/android.yml`) builds the APK on
GitHub; see deploy/README.md, "The Android app". On a computer with Android Studio
(Java 21):

```bash
cd mobile
npm ci
EXTAS_APP_URL=https://erp.yourcompany.com npm run apk
# android/app/build/outputs/apk/debug/app-debug.apk
```
