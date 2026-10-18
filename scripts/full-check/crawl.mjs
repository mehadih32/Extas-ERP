// The Full check (AI Center > Full check), run on GitHub's computers by
// .github/workflows/full-check.yml. It gives the ERP the one-time pass, gets a
// session for the owner and one member of each role, then, role by role:
// opens every screen (found from the page files in src/app), follows the links
// it finds to record screens, downloads the PDFs and files the screens link to,
// presses tabs and the buttons that only open a menu or window (press.mjs), and
// notes every problem: an error screen, a broken link (a 404, or an address with
// "[projectId]" in it), a part that did not load, a script error, a slow screen,
// a PDF that is not a PDF or that cuts a figure short or misses a page number
// (pdf-text.mjs), or being sent to sign in. It also checks each screen's
// layout at the four widths (390, 768, 1366 and 1920 px: text cut or overlapping,
// a screen wider than the window, a menu item out of reach, wrong fonts; the rules
// are in layout.mjs): the owner's role on every screen at every width, the other
// roles on their home screen at every width and their other screens on a phone.
// Each tab it shows and each window it opens is checked the same way, on a phone
// at least (the owner's role at every width in the first half of its time).
// Each problem gets a screenshot. The report and the screenshots go back to the ERP.
//
// This log is public (the repository is), so it names only the kind of problem
// and the screen's route ("/sales/orders/[id]"): never the screen's text, an
// id or anything else from the ERP's data. The ERP keeps that, privately.
//
// On the live site the check only reads: this browser stops every request that
// is not a read, and the ERP refuses them too (src/proxy.ts). On the demo site
// (the ERP says "writes") the buttons it presses may also write.
//
//   SITE     the ERP's address (https://erp.example.com)
//   RUN      the check's id in the ERP
//   PASS     the one-time pass the ERP sent with it
//   MINUTES  the time for the whole check (default: what the ERP says, 10)
//   CHROMIUM_PATH  a Chromium to use instead of Playwright's own
//   PROOF    only off GitHub: a signed token standing in for GitHub's (on
//            GitHub the workflow's "id-token: write" gives the real one)
// Needs only Playwright with Chromium. Exit code 1: the check could not start or report.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { checkLayout, HEIGHTS, problemLine, RULES, WIDTHS } from "./layout.mjs";
import { pdfProblems } from "./pdf-text.mjs";
import { PRESSABLE, pressSafe } from "./press.mjs";
import { GATES, NEVER, patternFinder, PUBLIC, screenRoutes } from "./routes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(here, "../../src/app");
const SITE = new URL(process.env.SITE ?? "");
const RUN = process.env.RUN ?? "";
const PASS = process.env.PASS ?? "";
const SLOW_MS = 6000;
const PAGE_TIMEOUT_MS = 45_000;
const MAX_SHOTS = 80;
const TABS = 4;
/** How long a screen may keep loading after it opened (its links prefetch, lists fill). */
const SETTLE_MS = 1500;
const ACTIONS = !!process.env.GITHUB_ACTIONS;

if (SITE.protocol !== "https:" && SITE.hostname !== "localhost" && SITE.hostname !== "127.0.0.1") {
  console.error("SITE must be an https:// address.");
  process.exit(1);
}

const say = (text) => console.log(text);

/** GitHub's signed proof that this is the repository's Full check workflow, for the ERP. */
async function proof() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !token) {
    if (process.env.PROOF) return process.env.PROOF;
    throw new Error("No GitHub proof: the workflow needs the permission id-token: write.");
  }
  const audience = (process.env.SITE ?? "").replace(/\/$/, "");
  const response = await fetch(`${url}&audience=${encodeURIComponent(audience)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.value) throw new Error(`GitHub gave no proof (${response.status}).`);
  return data.value;
}

async function api(path, { body, key, bytes } = {}) {
  const response = await fetch(new URL(path, SITE), {
    method: "POST",
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": bytes ? "image/jpeg" : "application/json",
    },
    body: bytes ?? JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(60_000),
  });
  const answer = await response.json().catch(() => null);
  if (!response.ok || !answer?.ok) {
    throw new Error(`${path}: ${response.status} ${answer?.error?.message ?? ""}`);
  }
  return answer.data;
}

// ---------------------------------------------------------------- the screens

const ROUTES = screenRoutes(APP_DIR);
const patternOf = patternFinder(ROUTES);

/** Downloads worth fetching: PDFs and files. */
const DOWNLOAD =
  /^\/api\/.*(\/pdf|\/download|\/export|\/excel|booking-book|tech-pack|\/print|\/file)(\/|$|\?)/;

// ---------------------------------------------------------------- the check

const problems = [];
const seen = new Set();
const shots = new Map();

/**
 * The error's type and its stack lines (the ERP keeps only the lines from its
 * own code for an issue on GitHub, src/modules/ai/full-check/texts.ts).
 */
function errorFacts(error) {
  if (!error || typeof error !== "object") return {};
  const type = typeof error.name === "string" ? error.name.slice(0, 80) : null;
  const stack =
    typeof error.stack === "string"
      ? error.stack
          .split("\n")
          .filter((l) => /^\s*at /.test(l))
          .slice(0, 20)
          .map((l) => l.slice(0, 300))
      : [];
  return { errorType: type, stack };
}

async function note(page, role, kind, screen, text, detail, ms, facts = {}) {
  const pattern = patternOf(screen.split("?")[0]) ?? null;
  const key = `${kind}|${pattern ?? screen}|${text.replace(/\d+/g, "#")}`;
  if (seen.has(key)) return;
  seen.add(key);
  const index = problems.length;
  problems.push({
    role,
    kind,
    screen: screen.slice(0, 500),
    pattern,
    text: text.slice(0, 500),
    detail: detail ? String(detail).slice(0, 4000) : null,
    ms: ms ?? null,
    status: facts.status ?? null,
    errorType: facts.errorType ?? null,
    stack: facts.stack ?? [],
  });
  say(`  problem: ${kind} on ${pattern ?? "a screen"}`);
  if (page && shots.size < MAX_SHOTS) {
    const shot = await page
      .screenshot({ type: "jpeg", quality: 60, timeout: 10_000 })
      .catch(() => null);
    if (shot) shots.set(index, shot);
  }
}

async function checkRole(browser, session, writes, deadline, first) {
  const role = session.role;
  const begun = Date.now();
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    acceptDownloads: false,
    userAgent: "Extas ERP Full check (Playwright)",
  });
  await context.addCookies([
    {
      name: "extras_session",
      value: session.cookie,
      domain: SITE.hostname,
      path: "/",
      httpOnly: true,
      secure: SITE.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
  let skipped = 0;
  if (!writes) {
    // The live site: only reads leave this browser.
    await context.route("**/*", (route) => {
      const method = route.request().method();
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") return route.continue();
      skipped += 1;
      return route.abort("blockedbyclient");
    });
  }

  const queue = ROUTES.filter((r) => !r.includes("[") && !PUBLIC.has(r));
  const queued = new Set(queue);
  const perPattern = new Map();
  const downloads = new Set();
  /** Downloads found and not fetched yet: the tabs fetch them between screens. */
  const pendingDownloads = [];
  const limit = role === "Owner" ? 2 : 1;
  let screens = 0;
  let pdfs = 0;
  let links = 0;
  let gate = null;
  /** Menus already found whole at a width (the top bar is the same on every screen). */
  const menusSeen = new Set();

  /** One LAYOUT problem for what was found, with a screenshot at the first width that has one. */
  async function noteLayout(page, path, found, ms, view) {
    const at = found[0].width;
    await page.setViewportSize({ width: at, height: HEIGHTS[at] ?? 900 }).catch(() => {});
    const rules = [...new Set(found.map((p) => p.what))];
    const where = !view
      ? ""
      : view.kind === "window"
        ? " (in a window the screen opens)"
        : " (on one of the screen's tabs)";
    await note(
      page,
      role,
      "LAYOUT",
      path,
      `${rules.map((what) => RULES[what] ?? what).join("; ")}${where}`,
      [
        ...(view ? [`After pressing "${view.label}" (${view.kind}):`] : []),
        ...found.slice(0, 24).map((p) => `${problemLine(p)}\n  ${p.detail}`),
      ].join("\n"),
      ms,
    );
  }

  /**
   * The screen's layout at the four widths (layout.mjs), as one LAYOUT problem. The
   * owner's role: every screen at every width; the other roles: the home screen at
   * every width, the rest on a phone. Returns what it found.
   */
  async function checkScreenLayout(page, path, ms) {
    const widths = first || path === "/" ? WIDTHS : [WIDTHS[0]];
    const found = [];
    for (const width of widths) {
      if (Date.now() > deadline) break;
      found.push(...(await checkLayout(page, { width, seen: menusSeen }).catch(() => [])));
    }
    if (found.length) await noteLayout(page, path, found, ms);
    await page.setViewportSize({ width: 1366, height: 900 }).catch(() => {});
    return found;
  }

  /** The same problem at the same width and place (a tab shows the rest of the screen too). */
  const layoutKey = (p) => `${p.width}|${p.what}|${p.where}`;

  function add(href, from) {
    let url;
    try {
      url = new URL(href, SITE);
    } catch {
      return;
    }
    if (url.host !== SITE.host) return;
    const raw = decodeURIComponent(url.pathname);
    if (raw.includes("[") || raw.includes("]")) {
      void note(
        null,
        role,
        "BROKEN_LINK",
        from,
        "A link has a placeholder in its address, so it opens a page that does not exist",
        `Link: ${url.pathname} (on ${from})`,
      );
      return;
    }
    const path = url.pathname + url.search;
    if (NEVER.some((re) => re.test(url.pathname))) return;
    links += 1;
    if (url.pathname.startsWith("/api/")) {
      if (DOWNLOAD.test(url.pathname) && downloads.size < 60) {
        const pattern = url.pathname.replace(/\/c[a-z0-9]{20,}/g, "/[id]");
        const n = perPattern.get(`dl:${pattern}`) ?? 0;
        if (n < limit && !downloads.has(path)) {
          perPattern.set(`dl:${pattern}`, n + 1);
          downloads.add(path);
          pendingDownloads.push(`${path}\n${from}`);
        }
      }
      return;
    }
    if (queued.has(path)) return;
    const pattern = patternOf(url.pathname);
    if (!pattern) return;
    // Filters and pages of a list: the list itself is enough.
    if (url.search && queued.has(url.pathname)) return;
    const n = perPattern.get(pattern) ?? 0;
    if (n >= (pattern === url.pathname ? 1 : limit)) return;
    perPattern.set(pattern, n + 1);
    queued.add(path);
    queue.push(path);
  }

  async function visit(page, path) {
    const errors = [];
    const thrown = [];
    const failed = [];
    const statuses = [];
    const onError = (e) => {
      errors.push(e.message);
      thrown.push(e);
    };
    const onConsole = (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (/Failed to load resource|ERR_BLOCKED_BY_CLIENT|Failed to fetch|NEXT_REDIRECT/.test(text))
        return;
      errors.push(text);
    };
    const onResponse = (r) => {
      const u = new URL(r.url());
      if (u.host !== SITE.host || r.status() < 400 || r.request().resourceType() === "document")
        return;
      if (u.pathname.startsWith("/api/full-check/")) return;
      failed.push(`${r.request().method()} ${u.pathname} answered ${r.status()}`);
      statuses.push(r.status());
    };
    const onFailed = (r) => {
      const why = r.failure()?.errorText ?? "";
      if (/BLOCKED_BY_CLIENT|ERR_ABORTED/.test(why)) return;
      if (new URL(r.url()).host !== SITE.host) return;
      failed.push(`${r.method()} ${new URL(r.url()).pathname} failed (${why})`);
    };
    page.on("pageerror", onError);
    page.on("console", onConsole);
    page.on("response", onResponse);
    page.on("requestfailed", onFailed);
    try {
      const started = Date.now();
      const response = await page.goto(new URL(path, SITE).href, {
        waitUntil: "load",
        timeout: PAGE_TIMEOUT_MS,
      });
      const ms = Date.now() - started;
      await page.waitForLoadState("networkidle", { timeout: SETTLE_MS }).catch(() => {});
      screens += 1;
      const now = new URL(page.url()).pathname;
      if (GATES[now] && GATES[now] !== GATES[path]) {
        if (screens === 1 || now !== "/sign-in") {
          gate = `${session.member} must first ${GATES[now]}, so the ${role} role's screens were not checked.`;
          return;
        }
        await note(
          page,
          role,
          "SIGNED_OUT",
          path,
          "The screen sent the check to the sign-in screen",
          `Opened ${path}, landed on ${page.url()}`,
          ms,
        );
        return;
      }
      const status = response?.status() ?? 0;
      if (status === 404) {
        await note(
          page,
          role,
          "BROKEN_LINK",
          path,
          "A link leads to a page that does not exist (404)",
          `GET ${path} answered 404`,
          ms,
        );
      } else if (status >= 400) {
        await note(
          page,
          role,
          "ERROR",
          path,
          `The screen answered ${status}`,
          `GET ${path} answered ${status}`,
          ms,
          { status },
        );
      }
      const body = await page
        .locator("body")
        .innerText({ timeout: 5000 })
        .catch(() => "");
      // The ERP's error window (its code box), or Next.js' own crash page. Not the
      // words alone: the Help Center's guide on errors quotes them.
      const box = await page.$('[data-testid="error-code"]').catch(() => null);
      const code = box ? ((await box.innerText().catch(() => "")) || "").trim() : null;
      const crashed = /Application error: a (client|server)-side exception has occurred/i.test(
        body,
      );
      if (status < 400 && (box || crashed)) {
        await note(
          page,
          role,
          "ERROR",
          path,
          "The screen showed an error",
          `${code ? `${code}: ` : ""}${body.slice(0, 600)}`,
          ms,
          errorFacts(thrown[0]),
        );
      }
      if (errors.length) {
        await note(
          page,
          role,
          "SCRIPT",
          path,
          "The screen had a script error",
          errors.slice(0, 5).join("\n"),
          ms,
          errorFacts(thrown[0]),
        );
      }
      if (failed.length) {
        await note(
          page,
          role,
          "FAILED_REQUEST",
          path,
          "Part of the screen did not load",
          failed.slice(0, 8).join("\n"),
          ms,
          { status: statuses[0] ?? null },
        );
      }
      if (ms > SLOW_MS) {
        await note(
          page,
          role,
          "SLOW",
          path,
          `The screen took ${(ms / 1000).toFixed(1)} seconds to open`,
          `GET ${path} took ${ms} ms`,
          ms,
        );
      }
      const hrefs = await page.$$eval("a[href]", (as) =>
        as.map((a) => a.getAttribute("href") ?? ""),
      );
      for (const href of hrefs) add(href, path);
      // A download that asks first which way round (a booking's PDF): its links are
      // named on the button, as the window's link exists only while it is open.
      const offered = await page.$$eval("[data-download-hrefs]", (els) =>
        els.flatMap((el) => (el.getAttribute("data-download-hrefs") ?? "").split(" ")),
      );
      for (const href of offered.filter(Boolean)) add(href, path);
      const layout = await checkScreenLayout(page, path, ms);
      await pressAndLook(page, path, layout, ms);
    } catch (error) {
      await note(
        page,
        role,
        "ERROR",
        path,
        "The screen did not open",
        String(error?.message ?? error).split("\n")[0],
        undefined,
        { errorType: typeof error?.name === "string" ? error.name.slice(0, 80) : null },
      );
    } finally {
      page.off("pageerror", onError);
      page.off("console", onConsole);
      page.off("response", onResponse);
      page.off("requestfailed", onFailed);
    }
  }

  const pressed = new Set();
  /**
   * Presses the screen's tabs and the buttons that only open a menu or a window
   * (press.mjs: never one that could change something), once for each kind of screen,
   * and checks the layout of each tab and window: on a phone, and at every width for
   * the owner's role in the first half of its time. Only what the screen itself did
   * not already show is noted.
   */
  async function pressAndLook(page, path, before, ms) {
    const pattern = patternOf(path.split("?")[0]);
    if (!pattern || pressed.has(pattern)) return;
    pressed.add(pattern);
    const known = new Set(before.map(layoutKey));
    await pressSafe(page, {
      selector: PRESSABLE.all,
      // The top bar's menus are the same on every screen: pressed once, on the home screen.
      within: path === "/" ? "" : "#main ",
      max: 6,
      deadline,
      look: async (view) => {
        const all = first && Date.now() < begun + (deadline - begun) / 2;
        const found = [];
        for (const width of all ? WIDTHS : [WIDTHS[0]]) {
          if (Date.now() > deadline) break;
          found.push(...(await checkLayout(page, { width, menus: false }).catch(() => [])));
        }
        const fresh = found.filter((p) => !known.has(layoutKey(p)));
        for (const p of fresh) known.add(layoutKey(p));
        if (fresh.length) await noteLayout(page, path, fresh, ms, view);
      },
    });
  }

  async function fetchDownload(entry) {
    const [path, from] = entry.split("\n");
    try {
      const response = await context.request.get(new URL(path, SITE).href, { timeout: 60_000 });
      const type = response.headers()["content-type"] ?? "";
      const bytes = await response.body();
      pdfs += 1;
      let why = null;
      if (response.status() >= 400) why = `answered ${response.status()}`;
      else if (
        /\/pdf|booking-book|tech-pack/.test(path) &&
        type.includes("pdf") &&
        bytes.subarray(0, 5).toString("latin1") !== "%PDF-"
      ) {
        why = "sent a file that is not a PDF";
      } else if (
        type.includes("text/html") &&
        // An HTML template is a file too: it comes as an attachment, or sandboxed.
        !/attachment/i.test(response.headers()["content-disposition"] ?? "") &&
        !/sandbox/.test(response.headers()["content-security-policy"] ?? "")
      ) {
        why = "sent a web page instead of the file";
      }
      if (why) {
        await note(
          null,
          role,
          "PDF",
          from,
          "A PDF or file did not open",
          `GET ${path} ${why}`,
          null,
          {
            status: response.status() >= 400 ? response.status() : null,
          },
        );
      } else if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
        // Its text: no figure cut short with "…", the page number on every page.
        let found = [];
        try {
          found = pdfProblems(bytes);
        } catch {
          found = [];
        }
        if (found.length) {
          await note(
            null,
            role,
            "PDF",
            from,
            found.some((p) => p.what === "CUT_FIGURE")
              ? "A PDF cuts a figure short"
              : "A PDF has a page without its page number",
            found
              .slice(0, 8)
              .map((p) => `GET ${path} ${p.detail}${p.text ? `\n  ${p.text}` : ""}`)
              .join("\n"),
          );
        }
      }
    } catch (error) {
      await note(
        null,
        role,
        "PDF",
        from,
        "A PDF or file did not open",
        `GET ${path}: ${String(error?.message ?? error).split("\n")[0]}`,
      );
    }
  }

  const pages = await Promise.all(Array.from({ length: TABS }, () => context.newPage()));
  await visit(pages[0], "/");
  let next = 0;
  await Promise.all(
    pages.map(async (page) => {
      while (!gate && Date.now() < deadline) {
        // A PDF or file found on a screen is fetched as it is found, so a check that
        // runs out of time has still opened the downloads of the screens it saw.
        const download = pendingDownloads.shift();
        if (download) {
          await fetchDownload(download);
          continue;
        }
        const path = queue[next++];
        if (!path) {
          // Another tab may still add links: wait a moment, then stop.
          await page.waitForTimeout(800);
          if (!queue[next]) break;
          continue;
        }
        if (path === "/") continue;
        await visit(page, path);
      }
    }),
  );
  // The last screens' downloads, with a minute's grace.
  while (!gate && pendingDownloads.length > 0 && Date.now() < deadline + 60_000) {
    await fetchDownload(pendingDownloads.shift());
  }
  await context.close();
  const left = Math.max(0, queue.length - next);
  const filesLeft = pendingDownloads.length;
  say(
    `${role} (${session.member}): ${screens} screens, ${pdfs} downloads${skipped ? `, ${skipped} ${skipped === 1 ? "write" : "writes"} stopped` : ""}${left > 0 ? `, ${left} not reached in time` : ""}${filesLeft > 0 ? `, ${filesLeft} downloads not fetched in time` : ""}`,
  );
  const missed = [
    left > 0 && `${left} ${left === 1 ? "screen" : "screens"}`,
    filesLeft > 0 && `${filesLeft} ${filesLeft === 1 ? "PDF or file" : "PDFs and files"}`,
  ].filter(Boolean);
  return {
    role,
    member: session.member,
    screens,
    pdfs,
    skipped,
    links,
    notReached: left,
    filesLeft,
    stopped: Boolean(gate),
    note:
      gate ??
      (missed.length > 0
        ? `${missed.join(" and ")} ${left + filesLeft === 1 ? "was" : "were"} not reached in the time.`
        : null),
  };
}

async function main() {
  const started = Date.now();
  const begun = await api("/api/full-check/start", {
    body: { run: RUN, pass: PASS, proof: await proof() },
  });
  if (ACTIONS) {
    for (const s of begun.roles) say(`::add-mask::${s.cookie}`);
    say(`::add-mask::${begun.reportKey}`);
  }
  say(
    `Checking the ${begun.site} site as ${begun.roles.length} roles (${ROUTES.length} screens in the code).`,
  );
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const total = (Number(process.env.MINUTES) || begun.minutes || 25) * 60_000;
  const end = Date.now() + total;
  const summary = { roles: [], screens: 0, pdfs: 0, links: 0, seconds: 0 };
  for (const [i, session] of begun.roles.entries()) {
    // The owner sees the most: a third of the time. The others share what is
    // left, so time a role did not need goes to the next ones.
    const left = Math.max(60_000, end - Date.now());
    const deadline =
      Date.now() +
      (i === 0 ? Math.round(total * 0.35) : Math.round(left / (begun.roles.length - i)));
    const done = await checkRole(browser, session, begun.writes, deadline, i === 0).catch(
      (error) => ({
        role: session.role,
        member: session.member,
        screens: 0,
        pdfs: 0,
        skipped: 0,
        links: 0,
        notReached: 0,
        filesLeft: 0,
        stopped: true,
        note: `The check stopped: ${String(error?.message ?? error).split("\n")[0]}`,
      }),
    );
    summary.roles.push({
      role: done.role,
      member: done.member,
      screens: done.screens,
      pdfs: done.pdfs,
      skipped: done.skipped,
      notReached: done.notReached,
      filesLeft: done.filesLeft,
      stopped: done.stopped,
      note: done.note,
    });
    summary.screens += done.screens;
    summary.pdfs += done.pdfs;
    summary.links += done.links;
  }
  await browser.close();
  for (const name of begun.notChecked ?? []) {
    summary.roles.push({
      role: name,
      member: "-",
      screens: 0,
      pdfs: 0,
      skipped: 0,
      note: "No one has this role, so it was not checked.",
    });
  }
  summary.seconds = Math.round((Date.now() - started) / 1000);
  const report = await api("/api/full-check/report", {
    key: begun.reportKey,
    body: { summary, problems: problems.map((p, i) => ({ ...p, shot: shots.has(i) })) },
  });
  let sent = 0;
  for (const { index, id } of report.problems) {
    const bytes = shots.get(index);
    if (!bytes) continue;
    await api(`/api/full-check/shot?problem=${encodeURIComponent(id)}`, {
      key: begun.reportKey,
      bytes,
    })
      .then(() => sent++)
      .catch((error) => say(`  screenshot not sent: ${error.message}`));
  }
  say(
    `Done in ${summary.seconds} s: ${summary.screens} screens, ${summary.pdfs} downloads, ${problems.length} problems, ${sent} screenshots sent.`,
  );
}

main().catch((error) => {
  console.error(`The Full check could not finish: ${error.message}`);
  process.exit(1);
});
