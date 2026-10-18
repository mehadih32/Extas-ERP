// The Help pictures' own test (v6.4.1 C2): made-up pages, each with a known
// answer, read and marked by the real code (help-marks.mjs) in a real browser.
// A long page's picture must start at the part its steps are about, every step
// that can be marked is, and the page's own buttons come before its menu's.
// GitHub runs it before it takes the pictures (.github/workflows/help-pictures.yml);
// locally:
//   node scripts/full-check/help-shots-selftest.mjs   (CHROMIUM_PATH: a Chromium to use)
// The rules alone are tested with Vitest too (tests/unit/help-marks.test.ts).

import { chromium } from "playwright";

import { markPage } from "./help-marks.mjs";

const SITE = "http://help-shots.test";
const MAX_HEIGHT = 1600;

/** A page of the made-up app: a top bar with the menu, then `body`. */
const screen = (body) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.5 sans-serif; }
  header { height: 56px; display: flex; gap: 16px; align-items: center; padding: 0 16px; }
  main { padding: 16px; }
  section { border: 1px solid #ccc; margin: 16px 0; padding: 16px; }
  .gap { height: 2000px; }
</style></head><body>
<header>
  <a href="/" aria-label="Extas ERP, dashboard">Extas ERP</a>
  <nav><a href="/ai/costs">Money</a> <a href="/ai/settings">System</a></nav>
  <button aria-label="Inbox, 3 unread">🔔 3</button>
</header>
<main>${body}</main></body></html>`;

const pages = {
  // The tech pack: the logos far down a long page.
  "/tech-packs/1": screen(`
    <h1>Tech Pack</h1>
    <section><h3>Measurements</h3><button>Measurement sheet</button></section>
    <div class="gap"></div>
    <section><h3>Logos and embroidery</h3><button>Add a logo</button>
      <p>Chest logo, 70 mm</p><button>Upload a file</button></section>
    <section><h3>Colours and lab dips</h3><button>Add a colour</button></section>`),
  // AI models: step 1 names the menu first ("Money"), then the page's own words.
  "/ai/models": screen(`
    <h1>AI Center</h1>
    <section><h3>Providers</h3><button>Read models from providers</button></section>
    <div class="gap"></div>
    <section><h3>Prices</h3><button>Edit</button><button>Add a price</button></section>`),
  // The buttons of three steps together low down, one step's near the top.
  "/sales/orders/7": screen(`
    <h1>Order SO-7</h1><button>Edit</button>
    <div class="gap"></div>
    <section><h3>Payments</h3><button>Receive a payment</button>
      <label><input type="checkbox"> Include previous due (৳ 12,000)</label>
      <button>Issue the invoice</button></section>`),
  // Words that are not a button: the demo site's bar; a form's numbered steps.
  "/": screen(`<div role="note">Demo site: practice data only.</div><h1>Dashboard</h1>
    <nav aria-label="Booking steps"><button><span>1</span><span>Booking type</span></button>
    <button><span>4</span><span>Collar &amp; cuff</span></button></nav>`),
  // A dialog: only what is in it is marked.
  "/hr/employees/3": screen(`
    <h1>Rahim</h1><button>Deactivate employee</button>
    <div role="dialog" style="position:fixed;top:120px;left:200px;background:#fff;padding:16px">
      <h2>Deactivate employee</h2><label><input type="radio"> They resigned</label>
      <button>Deactivate</button></div>`),
};

const problems = [];
const check = (name, ok, got) => {
  if (!ok) problems.push(`${name}: ${JSON.stringify(got)}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.route(`${SITE}/**`, (route) => {
  const html = pages[new URL(route.request().url()).pathname];
  return html
    ? route.fulfill({ body: html, contentType: "text/html" })
    : route.fulfill({ status: 404, body: "" });
});
const page = await context.newPage();
const read = async (path, args) => {
  await page.goto(`${SITE}${path}`);
  return markPage(page, { target: null, opened: null, maxHeight: MAX_HEIGHT, ...args });
};

// 1. A target far down a long page: the picture starts at its panel, and marks it.
let r = await read("/tech-packs/1", {
  steps: [["Logos and embroidery", "Add a logo"], ["Upload a file"], ["Measurement sheet"]],
  target: "Logos and embroidery",
});
check("target: the picture starts at the logos' panel", r.clip?.y > 1800, r.clip);
check("target: the picture says which part", r.clip?.target === "Logos and embroidery", r.clip);
check("target: steps 1 and 2 marked, step 3 (above the part) not", `${r.marks}` === "1,2", r);
check("a button before a heading: step 1 marks Add a logo", r.labels?.["1"] === "Add a logo", r);
r = await read("/tech-packs/1", { steps: [["Add a logo"]], target: "Sizes and fits" });
check("target: a part the page does not have is an error", !!r.error, r);

// 2. The page's own words before the menu's.
r = await read("/ai/models", {
  steps: [["AI", "Money", "Providers", "Read models from providers"], ["Prices"]],
});
check(
  "own words: step 1 marks Read models from providers, not the menu's Money",
  r.labels?.["1"] === "Read models from providers",
  r,
);
check("own words: the picture starts at the top here", r.clip?.y === 0, r.clip);
r = await read("/ai/models", { steps: [["AI", "System", "Settings"]] });
check("menu: a step that names only the menu still gets its mark", r.labels?.["1"] === "System", r);

// 3. No target: the part where the most steps' buttons are.
r = await read("/sales/orders/7", {
  steps: [["Edit"], ["Receive a payment"], ["Issue the invoice", "Include previous due (…)"]],
});
check("most steps: the picture moves down to the payments", r.clip?.y > 1500, r.clip);
check("most steps: steps 2 and 3 marked", `${r.marks}` === "2,3", r);
check("… stands for the page's words", r.labels?.["3"] === "Issue the invoice", r);
r = await read("/sales/orders/7", { steps: [["Include previous due (…)"]] });
check("… matches a label with an amount in it", `${r.marks}` === "1", r);

// 4. Loose words: part of a label, plain words before a colon.
r = await read("/", { steps: [["Extas ERP"], ["Inbox"], ["Demo site"], ["Collar & cuff"]] });
check("loose: the logo, the inbox, the demo bar and a form's step", `${r.marks}` === "1,2,3,4", r);

// 5. A dialog: only what is in it.
r = await read("/hr/employees/3", {
  steps: [["Deactivate employee"], ["They resigned", "Deactivate"]],
  opened: "dialog",
});
check("dialog: both steps marked inside the dialog", `${r.marks}` === "1,2", r);
check("dialog: the picture is the screen as it is", r.clip?.target === "dialog", r.clip);

// 6. Drawing: one red number for each mark, on a layer above the page.
r = await read("/sales/orders/7", {
  steps: [["Edit"], ["Receive a payment"], ["Issue the invoice"]],
  draw: true,
});
const numbers = await page.$$eval("[data-help-marks] div", (ds) =>
  ds.map((d) => d.textContent).filter(Boolean),
);
check("drawing: a number for each mark", `${numbers}` === `${r.marks}`, { numbers, r });

await browser.close();
if (problems.length) {
  console.error(
    `The Help pictures' self-test failed (${problems.length}):\n${problems.join("\n")}`,
  );
  process.exit(1);
}
console.log("The Help pictures' self-test passed.");
