// @ts-check
/*
 * The Extas ERP Android app opens the company's own Extas ERP server, so the
 * app always shows the latest screens without a new APK. Set the server's
 * address when building, for example:
 *   EXTAS_APP_URL=https://erp.yourcompany.com npm run sync
 * (the GitHub workflow takes it from the repository variable EXTAS_APP_URL).
 */
const url = (process.env.EXTAS_APP_URL || "https://erp.example.com").replace(/\/+$/, "");

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: "com.extas.erp",
  appName: "Extas ERP",
  webDir: "www",
  server: {
    url,
    cleartext: url.startsWith("http://"),
    // Shown when the server cannot be reached (no internet).
    errorPath: "offline.html",
  },
  android: {
    allowMixedContent: false,
  },
};

module.exports = config;
