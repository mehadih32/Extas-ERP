// Where a Help picture is cut from its page, and where its numbered marks go
// (v6.4.1 C2). scripts/full-check/help-shots.mjs reads the page in the browser
// (every button or field a step quotes, with where it is) and these rules,
// which need no browser, choose the part of the page the steps are about and
// the mark for each step. tests/unit/help-marks.test.ts tests them;
// scripts/full-check/help-shots-selftest.mjs tests them with help-shots.mjs on
// made-up pages in a real browser.
//
// A place on the page: { x, y, w, h } in px from the page's top left corner.
// A step's option: one element showing one of the labels the step quotes:
//   { id, label, li (which of the step's labels), tier, act, body, x, y, w, h }
// tier: 0 the words of a button, field or heading in the page itself; 1 the
// same in the menu, top bar or tabs; 2 and 3 the same, found less exactly (a
// part of an "Inbox, 3 unread" label, or plain words "Demo site: …"); 4 a link
// to another page. A lower tier is marked first, then something to press or
// fill in (act) before a heading, then the step's first label.

/** Space above the part a guide's target names. */
export const MARGIN = 16;
/** Space kept above the first mark when the picture starts lower down the page. */
export const CONTEXT = 120;
/** Space kept below the lowest mark. */
export const BELOW = 40;
/** The shortest picture: a part at the very end of a page shows a little of what is above it. */
export const MIN_HEIGHT = 400;

/**
 * Whether a place lies wholly in the part of the page from top to bottom.
 * @param {{ y: number, h: number }} o
 * @param {number} top
 * @param {number} bottom
 */
export const inside = (o, top, bottom) => o.y >= top && o.y + o.h <= bottom - 8;

/**
 * A step's options, best first: the page's own words before the menu's, exact
 * before loose, a button or field before a heading, the step's first label
 * first, then from the top of the page.
 * @template {{ tier: number, act?: boolean, li: number, y: number, x: number }} T
 * @param {T[]} options
 * @returns {T[]}
 */
export const bestFirst = (options) =>
  [...options].sort(
    (a, b) =>
      a.tier - b.tier || Number(!a.act) - Number(!b.act) || a.li - b.li || a.y - b.y || a.x - b.x,
  );

/**
 * @typedef {{ id: number, label: string, li: number, tier: number, act?: boolean,
 *   body: boolean, x: number, y: number, w: number, h: number }} Option
 * @typedef {{ label: string, part: { y: number, h: number } }} Target
 * @typedef {{ top: number, bottom: number, why: string, floor?: number }} Window
 */

/**
 * The part of the page the picture shows, before its marks are chosen: the
 * open dialog or menu (the screen as it is), the part the guide's target
 * names, or else the part of the page where the most steps' buttons are, the
 * page's own buttons counting before its menu's.
 * @param {{ steps: Option[][], target: Target | null, opened: string | null,
 *   scrollY: number, viewHeight: number, docHeight: number, maxHeight: number }} page
 * @returns {Window}
 */
export function chooseWindow({ steps, target, opened, scrollY, viewHeight, docHeight, maxHeight }) {
  if (opened) return { top: scrollY, bottom: scrollY + viewHeight, why: opened };
  if (target) {
    const top = Math.max(0, Math.round(target.part.y - MARGIN));
    return {
      top,
      bottom: Math.min(top + maxHeight, docHeight),
      floor: target.part.y + target.part.h + MARGIN,
      why: target.label,
    };
  }
  const tops = [
    ...new Set([0, ...steps.flat().map((o) => Math.max(0, Math.round(o.y - CONTEXT)))]),
  ].sort((a, b) => a - b);
  let best = { top: 0, score: -1 };
  for (const top of tops) {
    const bottom = Math.min(top + maxHeight, docHeight);
    const own = steps.filter((os) => os.some((o) => o.body && inside(o, top, bottom))).length;
    const any = steps.filter((os) => os.some((o) => inside(o, top, bottom))).length;
    const score = own * 1000 + any;
    if (score > best.score) best = { top, score };
  }
  return { top: best.top, bottom: Math.min(best.top + maxHeight, docHeight), why: "marks" };
}

/**
 * One mark for each step that has an option in the part shown: its best one,
 * never an element another step's mark is already on.
 * @param {Option[][]} steps
 * @param {{ top: number, bottom: number }} window
 */
export function pickMarks(steps, { top, bottom }) {
  const used = new Set();
  /** @type {Array<Option & { n: number }>} */
  const marks = [];
  steps.forEach((options, i) => {
    const o = bestFirst(options).find((c) => !used.has(c.id) && inside(c, top, bottom));
    if (!o) return;
    used.add(o.id);
    marks.push({ ...o, n: i + 1 });
  });
  return marks;
}

/**
 * The part's final size: down to below the lowest mark and the target's whole
 * part, a screen's height where the page has it below the start, at least
 * MIN_HEIGHT, at most maxHeight. A dialog or menu stays the screen as it is.
 * @param {Window} win
 * @param {Array<{ y: number, h: number }>} marks
 * @param {{ docHeight: number, viewHeight: number, maxHeight: number }} page
 * @returns {{ top: number, bottom: number, why: string }}
 */
export function finishWindow(win, marks, { docHeight, viewHeight, maxHeight }) {
  const { top, why } = win;
  if (why === "dialog" || why === "menu") return { top, bottom: win.bottom, why };
  const lowest = Math.max(0, ...marks.map((m) => m.y + m.h + BELOW));
  const wanted = Math.max(top + Math.min(viewHeight, docHeight - top), lowest, win.floor ?? 0);
  const bottom = Math.round(Math.min(wanted, top + maxHeight, docHeight));
  // The picture starts at its part; near the end of the page it is shorter, and only
  // a sliver of a picture starts a little higher up.
  return { top: Math.max(0, Math.min(top, bottom - MIN_HEIGHT)), bottom, why };
}

/**
 * Where each mark's number goes: up and to the left of the thing, else up and
 * to the right, beside, above or below it, wherever it stays in the picture
 * and covers the fewest words and other marks; the arrow points at the thing.
 * @param {Array<{ n: number, x: number, y: number, w: number, h: number }>} marks
 * @param {Array<{ x: number, y: number, w: number, h: number }>} words
 * @param {{ top: number, bottom: number, width: number }} part
 */
export function placeBadges(marks, words, { top, bottom, width }) {
  /** @param {{x:number,y:number,w:number,h:number}} a @param {{x:number,y:number,w:number,h:number}} b */
  const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  /** @type {Array<{x:number,y:number,w:number,h:number}>} */
  const placed = [];
  return marks.map((m) => {
    const mid = Math.min(12, m.h / 2);
    /** @type {Array<[number, number, number, number]>} */
    const spots = [
      [m.x - 44, m.y - 30, m.x - 4, m.y - 4 + mid],
      [m.x + m.w + 16, m.y - 30, m.x + m.w + 4, m.y - 4 + mid],
      [m.x - 42, m.y + m.h / 2 - 14, m.x - 4, m.y + m.h / 2],
      [m.x + m.w + 14, m.y + m.h / 2 - 14, m.x + m.w + 4, m.y + m.h / 2],
      [m.x + 8, m.y - 46, m.x + 22, m.y - 4],
      [m.x + 8, m.y + m.h + 18, m.x + 22, m.y + m.h + 4],
    ];
    /** @param {[number, number, number, number]} spot */
    const fits = ([x, y]) => x >= 4 && x <= width - 34 && y >= top + 4 && y <= bottom - 34;
    /** @param {[number, number, number, number]} spot */
    const covered = ([x, y]) => {
      const box = { x: x - 2, y: y - 2, w: 32, h: 32 };
      let area = 0;
      for (const r of [...words, ...placed, ...marks]) {
        if (!meets(box, r)) continue;
        area +=
          (Math.min(box.x + box.w, r.x + r.w) - Math.max(box.x, r.x)) *
          (Math.min(box.y + box.h, r.y + r.h) - Math.max(box.y, r.y));
      }
      return area;
    };
    const best = spots
      .filter(fits)
      .map((spot, order) => ({ spot, order, area: covered(spot) }))
      .sort((a, b) => a.area - b.area || a.order - b.order)[0]?.spot;
    const badge = best
      ? { x: best[0], y: best[1] }
      : {
          x: Math.min(Math.max(m.x + 4, 4), width - 34),
          y: Math.min(Math.max(m.y + 2, top + 4), bottom - 34),
        };
    placed.push({ x: badge.x, y: badge.y, w: 28, h: 28 });
    return {
      n: m.n,
      ring: { x: m.x - 4, y: m.y - 4, w: m.w + 8, h: m.h + 8 },
      badge,
      line: best ? [best[0] + 15, best[1] + 15, best[2], best[3]] : null,
    };
  });
}

// ------------------------------------------------------------- in the browser

/**
 * Runs in the page (page.evaluate): every element that shows a label a step
 * quotes, the element the guide's target names and its part of the page, and
 * where the words are. Plain data comes back; nothing on the page changes.
 * @param {{ steps: string[][], target: string | null, opened: string | null }} args
 */
export function collectOnPage({ steps, target, opened }) {
  /** @param {string | null | undefined} s */
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const scope = (opened === "dialog" && document.querySelector("[role=dialog]")) || document.body;
  const PRESS =
    "button, a, [role=tab], [role=button], [role=menuitem], [role=menuitemcheckbox], [role=option], label, th, h1, h2, h3, h4, legend, summary, input, textarea, select, [role=combobox], [data-slot=card-title]";
  const LEAF = "span, p, strong, b, em, small, div, li, dt, dd, td, [role=status], [role=note]";
  /** @param {Element} el */
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const pressables = [...scope.querySelectorAll(PRESS)].filter(visible);
  // Plain words (a badge, a note, a status), not inside a button that already counts.
  const leaves = [...scope.querySelectorAll(LEAF)].filter(
    (el) => !el.closest(PRESS) && norm(el.textContent).length <= 160 && visible(el),
  );
  // The frame around the page: the menu, the top bar, the tabs.
  /** @param {Element} el */
  const inFrame = (el) => !!el.closest("nav, header, [role=tablist], [data-layout-nav]");
  // A menu or tab link to another page ("AI" > "System" > "Settings" in a step that
  // ends on this page) is marked only when the step names nothing else here.
  /** @param {Element} el */
  const away = (el) => {
    const link = /** @type {HTMLAnchorElement | null} */ (el.closest("a[href]"));
    if (!link || link.getAttribute("aria-current") || !inFrame(link)) return false;
    try {
      const to = new URL(link.href, location.href);
      return to.origin === location.origin && to.pathname !== location.pathname;
    } catch {
      return false;
    }
  };
  /** @param {string} s */
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // "…" in a label stands for words the page fills in ("Include previous due (…)").
  /** @param {string} label */
  const matcher = (label) => {
    const want = norm(label);
    if (!want.includes("…")) return (/** @type {string} */ s) => s === want;
    const re = new RegExp(
      `^${want
        .split("…")
        .map((p) => esc(p.trim()))
        .join(".{1,80}?")}$`,
    );
    return (/** @type {string} */ s) => re.test(s);
  };
  /** @param {Element} el */
  const names = (el) =>
    [
      norm(el.textContent),
      norm(el.getAttribute("aria-label")),
      norm(el.getAttribute("placeholder")),
      norm(el.getAttribute("title")),
    ].filter(Boolean);
  // "Inbox, 3 unread", "Company: Extas. Switch company": the parts of a label;
  // and a button's own pieces ("4" and "Collar & cuff" in a step of a form).
  /** @param {Element} el */
  const parts = (el) =>
    [
      ...[el.getAttribute("aria-label"), el.getAttribute("title")].flatMap((a) =>
        norm(a).split(/\s*[,.:;]\s+/),
      ),
      ...[...el.children].map((c) => norm(c.textContent)),
    ].filter(Boolean);
  /** @type {Element[]} */
  const els = [];
  /** @param {Element} el */
  const idOf = (el) => {
    const at = els.indexOf(el);
    if (at >= 0) return at;
    els.push(el);
    return els.length - 1;
  };
  const ACT =
    "button, a, input, textarea, select, summary, [role=tab], [role=button], [role=menuitem], [role=menuitemcheckbox], [role=option], [role=combobox]";
  /** @param {Element} el */
  const box = (el) => {
    let r = el.getBoundingClientRect();
    // A heading or label as wide as its panel: the ring goes round its words.
    if (!el.matches(ACT)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const words = range.getBoundingClientRect();
      if (words.width > 0 && words.height > 0 && words.width < r.width) r = words;
    }
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  };
  /** @param {string[]} labels */
  const optionsFor = (labels) =>
    labels.flatMap((label, li) => {
      const fits = matcher(label);
      /** @type {Array<Record<string, unknown>>} */
      const found = [];
      /** @param {Element} el @param {boolean} loose */
      const add = (el, loose) => {
        const frame = inFrame(el);
        const tier = away(el) ? 4 : (loose ? 2 : 0) + (frame ? 1 : 0);
        found.push({
          id: idOf(el),
          label,
          li,
          tier,
          act: el.matches(ACT),
          body: !frame,
          ...box(el),
        });
      };
      for (const el of pressables) {
        if (names(el).some(fits)) add(el, false);
        else if (parts(el).some(fits)) add(el, true);
      }
      for (const el of leaves) {
        const text = norm(el.textContent);
        if (!fits(text) && !text.startsWith(`${norm(label)}:`)) continue;
        // The innermost element with these words, not every box around them.
        if ([...el.children].some((c) => norm(c.textContent) === text)) continue;
        add(el, true);
      }
      return found;
    });

  const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  /** @type {{ label: string, part: { y: number, h: number } } | "missing" | null} */
  let part = null;
  if (target) {
    const best = optionsFor([target])
      .filter((o) => /** @type {number} */ (o.tier) < 4)
      .sort((a, b) => /** @type {number} */ (a.tier) - /** @type {number} */ (b.tier))[0];
    if (!best) part = "missing";
    else {
      const el = els[/** @type {number} */ (best.id)];
      // The panel, card or form the words head; the words alone on a page that is all one part.
      const around = el.closest(
        "section, [data-slot=card], fieldset, form, [role=region], [role=tabpanel], [role=dialog]",
      );
      const whole = around && around.getBoundingClientRect().height < docHeight * 0.9;
      const b = box(whole ? around : el);
      part = { label: target, part: { y: b.y, h: b.h } };
    }
  }
  const words = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode;
    if (!text.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    for (const r of range.getClientRects()) {
      if (r.width > 0 && r.height > 0)
        words.push({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height });
    }
  }
  return {
    steps: steps.map(optionsFor),
    target: part,
    docHeight,
    scrollY,
    viewHeight: innerHeight,
    width: document.documentElement.clientWidth,
    words,
  };
}

/**
 * Runs in the page: draws the red rings, numbers and arrows where placeBadges
 * said, on a layer above everything.
 * @param {ReturnType<typeof placeBadges>} badges
 */
export function drawOnPage(badges) {
  const RED = "#dc2626";
  const layer = document.createElement("div");
  layer.setAttribute("data-help-marks", "");
  layer.style.cssText =
    "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none";
  for (const { n, ring, badge, line } of badges) {
    const r = document.createElement("div");
    r.style.cssText = `position:absolute;left:${ring.x}px;top:${ring.y}px;width:${ring.w}px;height:${ring.h}px;border:3px solid ${RED};border-radius:8px;box-shadow:0 0 0 2px #fff`;
    const b = document.createElement("div");
    b.textContent = String(n);
    b.style.cssText = `position:absolute;left:${badge.x}px;top:${badge.y}px;width:28px;height:28px;border-radius:50%;background:${RED};color:#fff;font:700 15px/28px system-ui,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)`;
    layer.append(r, b);
    if (!line) continue;
    const [x1, y1, x2, y2] = line;
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    const minX = Math.min(x1, x2) - 6;
    const minY = Math.min(y1, y2) - 6;
    svg.setAttribute("width", String(Math.abs(x2 - x1) + 12));
    svg.setAttribute("height", String(Math.abs(y2 - y1) + 12));
    svg.style.cssText = `position:absolute;left:${minX}px;top:${minY}px;overflow:visible`;
    const l = document.createElementNS(svgNs, "line");
    l.setAttribute("x1", String(x1 - minX));
    l.setAttribute("y1", String(y1 - minY));
    l.setAttribute("x2", String(x2 - minX));
    l.setAttribute("y2", String(y2 - minY));
    l.setAttribute("stroke", RED);
    l.setAttribute("stroke-width", "3");
    l.setAttribute("stroke-linecap", "round");
    svg.appendChild(l);
    layer.prepend(svg);
  }
  document.body.appendChild(layer);
}

/**
 * Reads a page (Playwright's) and works out its picture: the part shown and a
 * mark for each step it can show. With `draw`, puts the marks on the page.
 * @param {{ evaluate: Function }} page
 * @param {{ steps: string[][], target: string | null, opened: string | null,
 *   maxHeight: number, draw?: boolean }} args
 */
export async function markPage(page, { steps, target, opened, maxHeight, draw = false }) {
  const seen = await page.evaluate(collectOnPage, { steps, target, opened });
  if (seen.target === "missing") return { error: `its part “${target}” is not on the page` };
  const facts = { ...seen, opened, maxHeight };
  const win = chooseWindow({ ...facts, target: seen.target });
  const chosen = pickMarks(seen.steps, win);
  const part = finishWindow(win, chosen, facts);
  const marks = chosen.filter((m) => inside(m, part.top, part.bottom));
  if (draw) {
    const badges = placeBadges(marks, seen.words, { ...part, width: seen.width });
    await page.evaluate(drawOnPage, badges);
  }
  return {
    marks: marks.map((m) => m.n),
    labels: Object.fromEntries(marks.map((m) => [String(m.n), m.label])),
    own: marks.filter((m) => m.body).length,
    clip: { y: part.top, height: part.bottom - part.top, target: part.why },
  };
}
