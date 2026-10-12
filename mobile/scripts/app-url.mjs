/*
 * Writes www/app-url.js, which tells the app's offline page where to go back
 * to: the same EXTAS_APP_URL that capacitor.config.js opens. Run before
 * "cap sync" (npm run sync does).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const url = (process.env.EXTAS_APP_URL || "https://erp.example.com").replace(/\/+$/, "");
if (!/^https?:\/\/[^/\s]+$/.test(url)) {
  console.error(
    `EXTAS_APP_URL must be the server's address, like https://erp.yourcompany.com (got "${url}").`,
  );
  process.exit(1);
}
fs.writeFileSync(
  path.join(here, "..", "www", "app-url.js"),
  `window.EXTAS_APP_URL = ${JSON.stringify(url)};\n`,
);
console.log(`The app opens ${url}`);
