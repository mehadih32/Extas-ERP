// The Help Center's automatic pictures, step 2 of 2 (`npm run help:shots`; step 1,
// scripts/help/plan.ts, lists the guides that need one). For each guide it opens
// its page on the demo site's sample data (for a record's page, the demo record
// that shows the most of the steps), finds the button or field each step quotes
// (“Issue the invoice”), and cuts the picture from the part of the page the steps
// are about: the part the guide's shot.target names, or else where the most
// steps' buttons are, never just the top of a long page (scripts/full-check/
// help-marks.mjs). It puts a numbered red mark with an arrow on each, saves the
// picture as public/help/shots/<slug>.webp, and records it in
// src/modules/help/pictures.json with its marks and its part of the page. A
// picture that marks nothing is listed as not done (exit code 1). It only opens
// pages and, where a guide says so (shot.open), presses one button that opens a
// dialog or menu: it never saves anything. Run it only on a copy made for checks
// (the demo site's data), never the live ERP.
//
//   SITE           the ERP's address (default http://localhost:3000)
//   COOKIE         a session for the owner (scripts/layout-session.ts makes one)
//   HELP_PLAN      the plan (default .help-shots/plan.json)
//   CHROMIUM_PATH  a Chromium to use instead of Playwright's own
// Needs Playwright with Chromium (scripts/full-check: npm install, npx playwright
// install chromium), and sharp (for WebP) and Prettier from the ERP's own packages.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { format, resolveConfig } from "prettier";
import sharp from "sharp";

import { markPage } from "./help-marks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const SITE = new URL(process.env.SITE || "http://localhost:3000");
const COOKIE = process.env.COOKIE ?? "";
const PLAN = resolve(root, process.env.HELP_PLAN ?? ".help-shots/plan.json");
const OUT = join(root, "public", "help", "shots");
const MANIFEST = join(root, "src", "modules", "help", "pictures.json");
const WIDTH = 1280;
const HEIGHT = 800;
const MAX_HEIGHT = 1600;

if (!COOKIE) {
  console.error("Set COOKIE to a session (scripts/layout-session.ts makes one).");
  process.exit(1);
}
const plan = JSON.parse(readFileSync(PLAN, "utf8"));
mkdirSync(OUT, { recursive: true });
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};

/** "/sales/orders/[orderId]" as a test for addresses. */
const patternRe = (pattern) =>
  new RegExp(`^${pattern.replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+")}$`);
/** The pages with no record in their address ("/sales/orders"). */
const fixed = new Set(plan.patterns.filter((p) => !p.includes("[")));

/** Links that would change something or sign out: never followed. */
const NEVER = [
  /^\/sign-out/,
  /^\/api\//,
  /\/(send|delete|approve|cancel|void|merge|restore)(\/|$)/,
];

/**
 * Real addresses for a page pattern, up to `max`: links to it found on the
 * guide's own pages and the pages above it ("/sales/orders" lists the orders
 * "/sales/orders/[orderId]" opens).
 */
async function addressesOf(page, pattern, from = [], max = 5) {
  if (!pattern.includes("[")) return [pattern];
  const re = patternRe(pattern);
  // Pages that fit the same addresses with fewer records in them: their addresses are theirs.
  const narrower = plan.patterns.filter(
    (q) => q !== pattern && q.split("[").length < pattern.split("[").length,
  );
  const parts = pattern.split("/").filter(Boolean);
  const tried = new Set();
  const hits = [];
  // The guide's own pages ("/parties/buyers"), then the pages above, nearest first,
  // then the pages those link to.
  const starts = [...from];
  for (let n = parts.length - 1; n >= 0; n -= 1) {
    const above = `/${parts.slice(0, n).join("/")}`;
    if (!above.includes("[") && fixed.has(above)) starts.push(above);
  }
  const queue = [...starts];
  while (queue.length && tried.size < 12 && hits.length < max) {
    const at = queue.shift();
    if (tried.has(at)) continue;
    tried.add(at);
    try {
      await page.goto(new URL(at, SITE).href, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    } catch {
      continue;
    }
    const links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
    const paths = links
      .map((href) => {
        try {
          // Read here in Node, not in the page: the site's own links only.
          const url = new URL(href, SITE);
          return url.origin === SITE.origin ? url.pathname : null;
        } catch {
          return null;
        }
      })
      .filter((p) => p && !NEVER.some((n) => n.test(p)));
    // A record's own address, not a page of its own that fits too ("/production/projects/new",
    // "/parties/buyers/new" of "/parties/[list]/new").
    for (const p of paths) {
      if (!re.test(p) || fixed.has(p) || hits.includes(p) || hits.length >= max) continue;
      if (narrower.some((q) => patternRe(q).test(p))) continue;
      hits.push(p);
    }
    // One step further: record pages under a record (a project's tech pack).
    for (const p of paths) {
      if (!tried.has(p) && pattern.startsWith(p.split("/").slice(0, 2).join("/"))) {
        const prefix = pattern.split("/").slice(0, p.split("/").length).join("/");
        if (patternRe(prefix).test(p)) queue.push(p);
      }
    }
  }
  return hits;
}

/** A button's words as a test: "…" stands for words the page fills in ("More for …"). */
const nameRe = (name) =>
  new RegExp(
    `^${name
      .split("…")
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".{1,80}?")}$`,
  );

/**
 * Opens a guide's page at one address, and the dialog or menu its shot opens.
 * Says which was opened, or what went wrong.
 */
async function openAt(page, guide, address) {
  const url = new URL(address, SITE);
  if (guide.query) url.search = guide.query;
  await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const landed = new URL(page.url()).pathname;
  if (!patternRe(guide.route).test(landed)) {
    return { error: `${guide.route} sent the browser to ${landed}` };
  }
  if (!guide.open) return { opened: null };
  const button = page.getByRole("button", { name: nameRe(guide.open) }).first();
  await button.click({ timeout: 5_000 });
  await page.locator("[role=dialog], [role=menu]").first().waitFor({ timeout: 5_000 });
  await page.waitForTimeout(400);
  return { opened: (await page.locator("[role=dialog]").count()) ? "dialog" : "menu" };
}

/** Moving pictures and blinking cursors still. */
const STILL =
  "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}nextjs-portal{display:none!important}";

async function shoot(context, guide) {
  const page = await context.newPage();
  try {
    const addresses = await addressesOf(page, guide.route, guide.from);
    if (!addresses.length) return { error: `no record found to open ${guide.route}` };
    const ask = { steps: guide.steps, target: guide.target, maxHeight: MAX_HEIGHT };
    // A record's page: the record that shows the most of the steps' buttons.
    let best = null;
    for (const address of addresses) {
      const at = await openAt(page, guide, address).catch((error) => ({
        error: error instanceof Error ? error.message.split("\n")[0] : String(error),
      }));
      if (at.error) {
        best ??= { error: at.error };
        continue;
      }
      if (addresses.length === 1) {
        best = { address, opened: at.opened, here: true };
        break;
      }
      const seen = await markPage(page, { ...ask, opened: at.opened });
      const score = seen.error ? -1 : seen.own * 1000 + seen.marks.length;
      if (!best || best.error || score > best.score) best = { address, opened: at.opened, score };
      best.here = best.address === address;
    }
    if (!best || best.error) return { error: best?.error ?? `could not open ${guide.route}` };
    if (!best.here) {
      const at = await openAt(page, guide, best.address);
      if (at.error) return at;
    }
    await page.addStyleTag({ content: STILL });
    const result = await markPage(page, { ...ask, opened: best.opened, draw: true });
    if (result.error) return result;
    const { clip } = result;
    const png = await page.screenshot(
      best.opened
        ? { type: "png" }
        : {
            type: "png",
            fullPage: true,
            clip: { x: 0, y: clip.y, width: WIDTH, height: clip.height },
          },
    );
    const webp = await sharp(png).webp({ quality: 72 }).toBuffer();
    writeFileSync(join(OUT, `${guide.slug}.webp`), webp);
    return result;
  } catch (error) {
    return { error: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const signedIn = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  locale: "en-GB",
  timezoneId: "Asia/Dhaka",
});
await signedIn.addCookies([
  {
    name: "extras_session",
    value: COOKIE,
    domain: SITE.hostname,
    path: "/",
    httpOnly: true,
    secure: SITE.protocol === "https:",
    sameSite: "Lax",
  },
]);
const signedOut = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  locale: "en-GB",
  timezoneId: "Asia/Dhaka",
});

const today = new Date().toISOString().slice(0, 10);
const failed = [];
let done = 0;
for (const guide of plan.guides) {
  const result = await shoot(guide.signedOut ? signedOut : signedIn, guide);
  if (result.error) {
    failed.push(`${guide.section}/${guide.slug}: ${result.error}`);
    continue;
  }
  manifest[guide.slug] = {
    src: `/help/shots/${guide.slug}.webp`,
    width: WIDTH,
    height: result.clip.height,
    marks: result.marks,
    labels: result.labels,
    clip: result.clip,
    route: guide.route,
    screen: guide.screen,
    guide: guide.guide,
    taken: today,
  };
  // Taken, but a picture must point at something: the guide's steps or shot need a look.
  if (result.marks.length === 0) {
    failed.push(
      `${guide.section}/${guide.slug}: marks nothing (no step's button or field is in the picture)`,
    );
  }
  done += 1;
  if (done % 10 === 0) console.log(`${done} pictures taken`);
}
// Guides with no picture (shot.none) keep none.
for (const slug of plan.none ?? []) {
  delete manifest[slug];
  rmSync(join(OUT, `${slug}.webp`), { force: true });
}
await browser.close();

const sorted = Object.fromEntries(
  Object.keys(manifest)
    .sort()
    .map((k) => [k, manifest[k]]),
);
// `npm run format:check` checks the manifest too, so it is written the way Prettier writes it
// (without the project's Tailwind plugin, which only sorts class names and JSON has none).
const style = { ...(await resolveConfig(MANIFEST)), plugins: [], filepath: MANIFEST };
writeFileSync(MANIFEST, await format(JSON.stringify(sorted, null, 2), style));
console.log(`${done} of ${plan.guides.length} pictures taken.`);
if (failed.length) {
  console.log(`Not taken (${failed.length}):\n${failed.join("\n")}`);
  process.exitCode = 1;
}
