// The Help Center's automatic pictures, step 2 of 2 (`npm run help:shots`; step 1,
// scripts/help/plan.ts, lists the guides that need one). For each guide it opens
// its page on the demo site's sample data, finds the button or field each step
// quotes (“Issue the invoice”), puts a numbered red mark with an arrow on it, and
// saves the picture as public/help/shots/<slug>.webp, then records it in
// src/modules/help/pictures.json. It only opens pages and, where a guide says so
// (shot.open), presses one button that opens a dialog: it never saves anything.
// Run it only on a copy made for checks (the demo site's data), never the live ERP.
//
//   SITE           the ERP's address (default http://localhost:3000)
//   COOKIE         a session for the owner (scripts/layout-session.ts makes one)
//   HELP_PLAN      the plan (default .help-shots/plan.json)
//   CHROMIUM_PATH  a Chromium to use instead of Playwright's own
// Needs Playwright with Chromium (scripts/full-check: npm install, npx playwright
// install chromium) and sharp (the ERP's own, for WebP).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import sharp from "sharp";

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
 * A real address for a page pattern: a link to it found on the pages above it
 * ("/sales/orders" lists the orders "/sales/orders/[orderId]" opens).
 */
async function addressOf(page, pattern) {
  if (!pattern.includes("[")) return pattern;
  const re = patternRe(pattern);
  const parts = pattern.split("/").filter(Boolean);
  const tried = new Set();
  // The pages above it, nearest first, then the pages those link to.
  const starts = [];
  for (let n = parts.length - 1; n >= 0; n -= 1) {
    const above = `/${parts.slice(0, n).join("/")}`;
    if (!above.includes("[") && fixed.has(above)) starts.push(above);
  }
  const queue = [...starts];
  while (queue.length && tried.size < 12) {
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
    // A record's own address, not a page of its own that fits too ("/production/projects/new").
    const hit = paths.find((p) => re.test(p) && !fixed.has(p));
    if (hit) return hit;
    // One step further: record pages under a record (a project's tech pack).
    for (const p of paths) {
      if (!tried.has(p) && pattern.startsWith(p.split("/").slice(0, 2).join("/"))) {
        const prefix = pattern.split("/").slice(0, p.split("/").length).join("/");
        if (patternRe(prefix).test(p)) queue.push(p);
      }
    }
  }
  return null;
}

/** Finds, for each step, the first quoted label shown on the page, and marks it. */
async function mark(page, steps, inDialog) {
  return page.evaluate(
    ({ steps, inDialog, maxHeight }) => {
      const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
      const scope = (inDialog && document.querySelector("[role=dialog]")) || document.body;
      const candidates = [
        ...scope.querySelectorAll(
          "button, a, [role=tab], [role=button], [role=menuitem], label, th, h1, h2, h3, h4, legend, summary, input, textarea, select, [role=combobox]",
        ),
      ].filter((el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
      });
      const name = (el) =>
        [
          norm(el.textContent),
          norm(el.getAttribute("aria-label")),
          norm(el.getAttribute("placeholder")),
          norm(el.getAttribute("title")),
        ].filter(Boolean);
      const W = document.documentElement.clientWidth;
      // Only what the picture shows: the page down to its cut, or the screen with a dialog open.
      const limit = inDialog ? innerHeight : maxHeight;
      const used = new Set();
      const marks = [];
      steps.forEach((labels, i) => {
        for (const label of labels) {
          const want = norm(label);
          const el = candidates.find((c) => !used.has(c) && name(c).some((n) => n === want));
          if (!el) continue;
          used.add(el);
          const r = el.getBoundingClientRect();
          if (r.top + scrollY + r.height > limit - 8 || r.left + r.width < 0 || r.left > W)
            continue;
          marks.push({
            n: i + 1,
            x: r.left + scrollX,
            y: r.top + scrollY,
            w: r.width,
            h: r.height,
          });
          return;
        }
      });
      const layer = document.createElement("div");
      layer.setAttribute("data-help-marks", "");
      layer.style.cssText =
        "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none";
      const RED = "#dc2626";
      for (const m of marks) {
        const ring = document.createElement("div");
        ring.style.cssText = `position:absolute;left:${m.x - 4}px;top:${m.y - 4}px;width:${m.w + 8}px;height:${m.h + 8}px;border:3px solid ${RED};border-radius:8px;box-shadow:0 0 0 2px #fff`;
        // The number sits up and to the left of the thing, else up and to the right,
        // above or below it, wherever it stays inside the picture; the arrow points at it.
        const mid = Math.min(12, m.h / 2);
        const spots = [
          [m.x - 44, m.y - 30, m.x - 4, m.y - 4 + mid],
          [m.x + m.w + 16, m.y - 30, m.x + m.w + 4, m.y - 4 + mid],
          [m.x + 8, m.y - 46, m.x + 22, m.y - 4],
          [m.x + 8, m.y + m.h + 18, m.x + 22, m.y + m.h + 4],
        ];
        const fits = ([x, y]) => x >= 4 && x <= W - 34 && y >= 4 && y <= limit - 34;
        const [bx, by, x2, y2] = spots.find(fits) ?? [
          Math.min(Math.max(m.x + 4, 4), W - 34),
          Math.min(Math.max(m.y + 2, 4), limit - 34),
          null,
          null,
        ];
        const badge = document.createElement("div");
        badge.textContent = String(m.n);
        badge.style.cssText = `position:absolute;left:${bx}px;top:${by}px;width:28px;height:28px;border-radius:50%;background:${RED};color:#fff;font:700 15px/28px system-ui,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)`;
        layer.append(ring, badge);
        if (x2 === null) continue;
        const x1 = bx + 15;
        const y1 = by + 15;
        const svgNs = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNs, "svg");
        const minX = Math.min(x1, x2) - 6;
        const minY = Math.min(y1, y2) - 6;
        svg.setAttribute("width", String(Math.abs(x2 - x1) + 12));
        svg.setAttribute("height", String(Math.abs(y2 - y1) + 12));
        svg.style.cssText = `position:absolute;left:${minX}px;top:${minY}px;overflow:visible`;
        const line = document.createElementNS(svgNs, "line");
        line.setAttribute("x1", String(x1 - minX));
        line.setAttribute("y1", String(y1 - minY));
        line.setAttribute("x2", String(x2 - minX));
        line.setAttribute("y2", String(y2 - minY));
        line.setAttribute("stroke", RED);
        line.setAttribute("stroke-width", "3");
        line.setAttribute("stroke-linecap", "round");
        svg.appendChild(line);
        layer.prepend(svg);
      }
      document.body.appendChild(layer);
      return marks.map((m) => m.n);
    },
    { steps, inDialog, maxHeight: MAX_HEIGHT },
  );
}

async function shoot(context, guide) {
  const page = await context.newPage();
  try {
    const address = await addressOf(page, guide.route);
    if (!address) return { error: `no record found to open ${guide.route}` };
    await page.goto(new URL(address, SITE).href, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const landed = new URL(page.url()).pathname;
    if (!patternRe(guide.route).test(landed)) {
      return { error: `${guide.route} sent the browser to ${landed}` };
    }
    let inDialog = false;
    if (guide.open) {
      const button = page.getByRole("button", { name: guide.open, exact: true }).first();
      await button.click({ timeout: 5_000 });
      await page.locator("[role=dialog]").first().waitFor({ timeout: 5_000 });
      await page.waitForTimeout(400);
      inDialog = true;
    }
    // Moving pictures and blinking cursors still.
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}nextjs-portal{display:none!important}",
    });
    const marks = await mark(page, guide.steps, inDialog);
    const full = !inDialog;
    const height = full
      ? Math.min(MAX_HEIGHT, await page.evaluate(() => document.documentElement.scrollHeight))
      : HEIGHT;
    const png = await page.screenshot({
      type: "png",
      fullPage: full,
      clip: full ? { x: 0, y: 0, width: WIDTH, height } : undefined,
    });
    const webp = await sharp(png).webp({ quality: 72 }).toBuffer();
    writeFileSync(join(OUT, `${guide.slug}.webp`), webp);
    return { marks, height };
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
    height: result.height,
    marks: result.marks,
    route: guide.route,
    screen: guide.screen,
    guide: guide.guide,
    taken: today,
  };
  done += 1;
  if (done % 10 === 0) console.log(`${done} pictures taken`);
}
await browser.close();

const sorted = Object.fromEntries(
  Object.keys(manifest)
    .sort()
    .map((k) => [k, manifest[k]]),
);
writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`${done} of ${plan.guides.length} pictures taken.`);
if (failed.length) {
  console.log(`Not taken (${failed.length}):\n${failed.join("\n")}`);
  process.exitCode = 1;
}
