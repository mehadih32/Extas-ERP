// The layout checks on every screen at the four widths (v6.4 B2), with the engine in
// layout.mjs. GitHub runs it on every pull request that changes the screens
// (.github/workflows/layout-checks.yml), on the demo site's sample data in a
// throwaway database; `npm run layout:check` runs it against any address, e.g. a
// copy started on this computer. It opens every screen of the code (and one of each
// kind of record screen it finds a link to), checks it at 390, 768, 1366 and 1920 px,
// then presses each of its tabs and each button that opens a window, and checks each
// tab and window the same way (press.mjs: never a button that could change
// something). It fails (exit code 1) when any screen has a problem. It runs only on a
// copy on this computer or a demo site, never on a live ERP (routes.mjs, siteKind).
//
//   SITE      the ERP's address (default http://localhost:3000)
//   COOKIE    a session for the person whose screens are checked (the value of the
//             extras_session cookie; scripts/layout-session.ts makes one)
//   WIDTHS    the widths (default 390,768,1366,1920)
//   ONLY      check only the screens whose address starts with this ("/ai")
//   PATHS     or only these addresses, comma-separated (no links followed)
//   MINUTES   the time for the whole check (default 40)
//   TABS      screens checked at the same time (default 3)
//   PRESS     off: do not press tabs and window buttons (default: on)
//   OUT       a folder for a screenshot of each screen with a problem (optional)
//   REPORT    a file for the problems as JSON (optional)
//   CHROMIUM_PATH  a Chromium to use instead of Playwright's own
// Needs Playwright with Chromium (scripts/full-check: npm install, npx playwright
// install chromium).

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { checkLayout, RULES, safeSelector, WIDTHS } from "./layout.mjs";
import { PRESSABLE, pressSafe } from "./press.mjs";
import { GATES, NEVER, patternFinder, PUBLIC, screenRoutes, siteKind } from "./routes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SITE = new URL(process.env.SITE || "http://localhost:3000");
const COOKIE = process.env.COOKIE ?? "";
const ONLY = process.env.ONLY ?? "";
const widths = (process.env.WIDTHS ?? WIDTHS.join(","))
  .split(",")
  .map(Number)
  .filter((n) => n > 0);
const deadline = Date.now() + (Number(process.env.MINUTES) || 40) * 60_000;
const TABS = Number(process.env.TABS) || 3;
const OUT = process.env.OUT ?? "";
const ROUTES = screenRoutes(resolve(here, "../../src/app"));
const patternOf = patternFinder(ROUTES);

if (siteKind(SITE) === "live") {
  console.error(
    `${SITE.host} is not a copy on this computer nor a demo site (demo.<domain>), so it may be a live ERP with real data. The layout checks press tabs and open windows: run them on a copy (scripts/layout-session.ts makes a session there) or on the demo site. Nothing was checked.`,
  );
  process.exit(1);
}
if (siteKind(SITE) === "demo") {
  console.log(
    `Checking the demo site ${SITE.host}: screens, tabs and windows are only opened, nothing is saved.`,
  );
}
if (!COOKIE) {
  console.error("Set COOKIE to a session (scripts/layout-session.ts makes one).");
  process.exit(1);
}
const PRESS = process.env.PRESS !== "off";
if (OUT) mkdirSync(OUT, { recursive: true });

/** Only these addresses, when given (PATHS="/sales,/ai/orders/x1"): no links followed. */
const PATHS = (process.env.PATHS ?? "").split(",").filter((p) => p.startsWith("/"));
const queue = PATHS.length
  ? PATHS
  : ROUTES.filter((r) => !r.includes("[") && !PUBLIC.has(r) && !GATES[r]).filter(
      (r) => !ONLY || r.startsWith(ONLY),
    );
const queued = new Set(queue);
const perPattern = new Map();
const results = [];
let gate = null;

function add(href) {
  if (PATHS.length) return;
  let url;
  try {
    url = new URL(href, SITE);
  } catch {
    return;
  }
  if (url.host !== SITE.host || url.pathname.startsWith("/api/") || url.search) return;
  if (NEVER.some((re) => re.test(url.pathname))) return;
  const path = url.pathname;
  if (queued.has(path) || (ONLY && !path.startsWith(ONLY))) return;
  const pattern = patternOf(path);
  if (!pattern || !pattern.includes("[") || GATES[pattern]) return;
  if ((perPattern.get(pattern) ?? 0) >= 1) return;
  perPattern.set(pattern, 1);
  queued.add(path);
  queue.push(path);
}

/** Waits (up to 3 minutes) for the site to answer again, after it restarted. */
async function siteBack() {
  const until = Date.now() + 180_000;
  while (Date.now() < until) {
    const ok = await fetch(new URL("/sign-in", SITE), { signal: AbortSignal.timeout(10_000) })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return false;
}

async function open(page, path) {
  return page
    .goto(new URL(path, SITE).href, { waitUntil: "load", timeout: 120_000 })
    .catch((error) => ({ failed: String(error?.message ?? error).split("\n")[0] }));
}

async function visit(page, path) {
  const started = Date.now();
  let response = await open(page, path);
  // The site was restarting (a development server is restarted when it grows too big): once more.
  if (
    response?.failed &&
    /ERR_CONNECTION_(REFUSED|RESET)|ERR_EMPTY_RESPONSE/.test(response.failed)
  ) {
    if (await siteBack()) response = await open(page, path);
  }
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
  if (response?.failed) {
    results.push({ path, pattern: patternOf(path), error: response.failed, problems: [] });
    return;
  }
  const now = new URL(page.url()).pathname;
  if (GATES[now] && now !== path) {
    gate = `The session was sent to ${now} (${GATES[now]}).`;
    return;
  }
  for (const href of await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href"))))
    add(href);
  const problems = [];
  for (const width of widths) {
    if (Date.now() > deadline) break;
    const found = await checkLayout(page, { width }).catch((error) => [
      {
        kind: "LAYOUT",
        width,
        what: "ERROR",
        where: "(the check)",
        detail: String(error?.message ?? error).split("\n")[0],
      },
    ]);
    if (found.length && OUT && !problems.length) {
      const name = `${(patternOf(path) ?? path).replace(/[^\w-]+/g, "_")}-${width}.png`;
      await page.screenshot({ path: join(OUT, name), fullPage: true }).catch(() => {});
    }
    problems.push(...found);
  }
  if (PRESS && Date.now() < deadline) {
    // Each tab and window the screen opens, at the same widths: only what the screen
    // itself did not already show. The top bar's windows are pressed on the home screen.
    const key = (p) => `${p.width}|${p.what}|${p.where}`;
    const known = new Set(problems.map(key));
    let views = 0;
    await pressSafe(page, {
      selector: PRESSABLE.dialogs,
      within: path === "/" ? "" : "#main ",
      max: 8,
      deadline,
      look: async (view) => {
        views += 1;
        for (const width of widths) {
          if (Date.now() > deadline) break;
          const found = (await checkLayout(page, { width, menus: false }).catch(() => [])).filter(
            (p) => !known.has(key(p)),
          );
          if (found.length && OUT) {
            const name = `${(patternOf(path) ?? path).replace(/[^\w-]+/g, "_")}-${view.kind}${views}-${width}.png`;
            await page.screenshot({ path: join(OUT, name) }).catch(() => {});
          }
          for (const p of found) {
            known.add(key(p));
            problems.push({
              ...p,
              detail: `After pressing "${view.label}" (${view.kind}): ${p.detail}`,
            });
          }
        }
      },
    });
  }
  results.push({ path, pattern: patternOf(path), ms: Date.now() - started, problems });
  const n = problems.length;
  console.log(`${n ? "x" : "ok"} ${patternOf(path) ?? path}${n ? `: ${n} problems` : ""}`);
  for (const p of problems) {
    console.log(`    ${p.width} px  ${p.what}  ${p.where}\n        ${p.detail}`);
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ userAgent: "Extas ERP layout check (Playwright)" });
  await context.addCookies([
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
  const pages = await Promise.all(Array.from({ length: TABS }, () => context.newPage()));
  let next = 0;
  await Promise.all(
    pages.map(async (page) => {
      while (!gate && Date.now() < deadline) {
        const path = queue[next++];
        if (!path) {
          await page.waitForTimeout(1000);
          if (!queue[next]) break;
          continue;
        }
        await visit(page, path);
      }
    }),
  );
  await browser.close();

  const left = queue.length - Math.min(next, queue.length);
  const problems = results.flatMap((r) =>
    r.problems.map((p) => ({ ...p, pattern: r.pattern ?? r.path })),
  );
  const errors = results.filter((r) => r.error);
  if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify(results, null, 2));
  const counts = {};
  for (const p of problems) counts[p.what] = (counts[p.what] ?? 0) + 1;
  const summary = [
    `Layout checks: ${results.length} screens at ${widths.join(", ")} px, ${problems.length} problems${errors.length ? `, ${errors.length} screens did not open` : ""}${left > 0 ? `, ${left} screens not reached in time` : ""}.`,
    ...Object.entries(counts).map(([what, n]) => `  ${RULES[what] ?? what}: ${n}`),
  ];
  console.log(`\n${summary.join("\n")}`);
  if (gate) console.log(gate);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = problems
      .slice(0, 200)
      .map(
        (p) =>
          `| \`${p.pattern}\` | ${p.width} | ${RULES[p.what] ?? p.what} | \`${safeSelector(p.where)}\` |`,
      );
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "## Layout checks",
        "",
        summary[0],
        "",
        ...(rows.length
          ? ["| Screen | Width | Problem | Where |", "| --- | --- | --- | --- |", ...rows, ""]
          : []),
      ].join("\n"),
    );
  }
  if (problems.length || errors.length || left > 0 || gate) process.exit(1);
}

main().catch((error) => {
  console.error(`The layout checks could not finish: ${error.message}`);
  process.exit(1);
});
