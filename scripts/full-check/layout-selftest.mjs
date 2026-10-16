// The layout checks' own test (v6.4 B2): small made-up screens, each with one
// known kind of layout bug (or none), checked with the real engine in a real
// browser. Every check must find its bug, and the clean screens must pass, so a
// change to layout.mjs that stops it from seeing a bug fails here. GitHub runs it
// before the layout checks (.github/workflows/layout-checks.yml); locally:
//   node scripts/full-check/layout-selftest.mjs   (CHROMIUM_PATH: a Chromium to use)
// The pure rules are tested with Vitest too (tests/unit/layout-check.test.ts).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { checkLayout } from "./layout.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bengaliFont = readFileSync(resolve(here, "../../assets/fonts/NotoSansBengali-Regular.ttf"));

/** A screen: the app's way of laying out (system sans-serif here), plus `body`. */
const screen = (body, css = "") => `<!doctype html><html><head><meta charset="utf-8">
<style>
  @font-face { font-family: "Test Bengali"; src: url(data:font/ttf;base64,${bengaliFont.toString("base64")});
    unicode-range: U+0964-0965, U+0980-09FE; }
  body { margin: 0; padding: 16px; font: 16px/1.5 "DejaVu Sans", "Test Bengali", sans-serif; }
  button, input, select, textarea { font: inherit; }
  .font-sans { font-family: "DejaVu Sans", "Test Bengali", sans-serif; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
  ${css}
</style></head><body>${body}
<script>
  // A "More" button that opens a menu (as the app's dropdown menus do).
  for (const b of document.querySelectorAll("[data-layout-more]")) {
    b.addEventListener("click", () => {
      const m = document.createElement("div");
      m.setAttribute("role", "menu");
      m.innerHTML = b.getAttribute("data-items");
      document.body.appendChild(m);
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelectorAll("[role=menu]").forEach((m) => m.remove());
  });
</script></body></html>`;

const CASES = [
  {
    name: "a clean screen",
    width: 390,
    html: screen(`
      <h1>Orders</h1>
      <p>Every order this month. <span lang="bn">বাংলা লেখা ঠিক আছে</span></p>
      <nav data-layout-expect="/a /b" data-layout-nav><a href="/a">First</a> <a href="/b">Second</a></nav>
      <div style="overflow-x:auto"><table style="width:900px"><thead><tr><th>Name</th></tr></thead>
        <tbody><tr><td>A row that is wider than the phone, in a box that scrolls</td></tr></tbody></table></div>
      <div style="width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis" title="A long name in full">A long name in full that is cut</div>
      <span class="sr-only">Only for screen readers, and far too long to fit anywhere at all</span>
      <div style="display:none;width:2000px">Hidden on purpose</div>
      <div aria-hidden="true" style="width:30px;overflow:hidden;white-space:nowrap">Decoration only</div>
      <table><thead><tr><th>Payments</th></tr></thead><tbody></tbody></table>
      <p>No payments yet: record one with Record payment.</p>`),
    expect: [],
  },
  {
    name: "a screen wider than the window",
    width: 390,
    html: screen(`<div style="width:700px;background:#eee">A wide part</div>`),
    expect: ["OVERFLOW"],
    allow: ["CUT_TEXT"],
  },
  {
    name: "text cut by its box",
    width: 768,
    html: screen(
      `<div style="width:80px;overflow:hidden;white-space:nowrap">Settings and more words</div>`,
    ),
    expect: ["CUT_TEXT"],
  },
  {
    name: "text shown with ... and no tooltip",
    width: 768,
    html: screen(
      `<div style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Settings and more words</div>`,
    ),
    expect: ["CUT_TEXT"],
  },
  {
    name: "text shown with ... that gets its tooltip when the pointer is over it",
    width: 768,
    html: screen(
      `<div class="truncate" style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Settings and more words</div>
      <script>
        document.addEventListener("pointerover", (e) => {
          const el = e.target.closest(".truncate");
          if (el) el.title = el.textContent;
        });
      </script>`,
    ),
    expect: [],
  },
  {
    name: "a tab row that scrolls with its scroll bar hidden",
    width: 390,
    html: screen(
      `<nav style="display:flex;gap:24px;overflow-x:auto;scrollbar-width:none;white-space:nowrap">
        <a href="/1">AI Home</a><a href="/2">Mehedi 2.0</a><a href="/3">Agents</a><a href="/4">Skills</a>
        <a href="/5">Chat</a><a href="/6">Orders</a><a href="/7">Settings</a></nav>`,
    ),
    expect: ["CUT_TEXT"],
  },
  {
    name: "text on top of text",
    width: 1366,
    html: screen(
      `<div style="position:relative;height:40px"><span style="position:absolute;left:0;top:0">Total due</span>
        <span style="position:absolute;left:10px;top:2px">Paid today</span></div>`,
    ),
    expect: ["OVERLAP"],
  },
  {
    name: "a button off the screen",
    width: 390,
    html: screen(
      `<div style="overflow-x:hidden"><button style="margin-left:420px">Save</button></div>`,
      "html,body{overflow-x:hidden}",
    ),
    expect: ["CUT_TEXT"],
    allow: ["OFF_SCREEN"],
  },
  {
    name: "a button outside the window",
    width: 390,
    html: screen(`<button style="position:relative;left:400px">Go</button>`),
    expect: ["OFF_SCREEN"],
    allow: ["OVERFLOW", "CUT_TEXT"],
  },
  {
    name: "a menu item hidden at this width",
    width: 390,
    html: screen(
      `<div data-layout-expect="/a /b /c"><nav data-layout-nav><a href="/a">A</a> <a href="/b">B</a>
        <a href="/c" style="display:none">C</a></nav></div>`,
    ),
    expect: ["MENU"],
  },
  {
    name: "a menu item under More",
    width: 390,
    html: screen(
      `<div data-layout-expect="/a /b /c"><nav data-layout-nav><a href="/a">A</a> <a href="/b">B</a>
        <button data-layout-more data-items='<a href="/c">C</a>'>More</button></nav></div>`,
    ),
    expect: [],
  },
  {
    name: "a menu under a different More at each width, checked one width after the other",
    widths: [390, 768, 390],
    html: screen(
      `<div data-layout-expect="/a /b /c">
        <nav data-layout-nav class="phone"><a href="/a">A</a>
          <button data-layout-more data-items='<a href="/b">B</a><a href="/c">C</a>'>More</button></nav>
        <nav data-layout-nav class="wide"><a href="/a">A</a> <a href="/b">B</a>
          <button data-layout-more data-items='<a href="/c">C</a>'>More</button></nav></div>`,
      `@media (min-width: 700px) { .phone { display: none; } }
       @media (max-width: 699px) { .wide { display: none; } }`,
    ),
    expect: [],
  },
  {
    name: "text in a font that is not the app's",
    width: 1366,
    html: screen(`<p style="font-family:'Comic Sans MS', cursive">Hello</p>`),
    expect: ["FONT"],
  },
  {
    name: "Bengali text in a font without Bengali letters",
    width: 1366,
    html: screen(`<p style="font-family:'DejaVu Serif', serif">বাংলা লেখা</p>`),
    expect: ["BENGALI"],
    allow: ["FONT"],
  },
  {
    name: "text too small to read",
    width: 1366,
    html: screen(`<p style="font-size:10px">Small print</p>`),
    expect: ["TINY"],
  },
  {
    name: "an empty table with no word on what to do",
    width: 1366,
    html: screen(
      `<section><table><thead><tr><th>Invoices</th></tr></thead><tbody></tbody></table></section>`,
    ),
    expect: ["EMPTY_TABLE"],
  },
];

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  let failed = 0;
  for (const c of CASES) {
    const widths = c.widths ?? [c.width];
    await page.setViewportSize({ width: widths[0], height: 800 });
    await page.setContent(c.html, { waitUntil: "load" });
    const found = [];
    for (const width of widths) found.push(...(await checkLayout(page, { width, settleMs: 50 })));
    const kinds = [...new Set(found.map((p) => p.what))];
    const missing = c.expect.filter((k) => !kinds.includes(k));
    const extra = kinds.filter((k) => !c.expect.includes(k) && !(c.allow ?? []).includes(k));
    const ok = !missing.length && !extra.length;
    if (!ok) failed += 1;
    console.log(
      `${ok ? "ok" : "FAILED"}  ${c.name}${missing.length ? `: did not find ${missing.join(", ")}` : ""}${extra.length ? `: also found ${extra.join(", ")}` : ""}`,
    );
    if (!ok) for (const p of found) console.log(`      ${p.what} ${p.where}: ${p.detail}`);
  }
  await browser.close();
  console.log(failed ? `${failed} of ${CASES.length} failed.` : `All ${CASES.length} passed.`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(`The self-test could not run: ${error.message}`);
  process.exit(1);
});
