// The layout checks (v6.4 B2): one engine, used by
//   - the Full check (crawl.mjs: every screen at the four widths, "LAYOUT" problems),
//     and so by Bug Guard, which runs the Full check;
//   - the GitHub check on every pull request (.github/workflows/layout-checks.yml,
//     layout-run.mjs; `npm run layout:check` runs the same against any address).
//
// How to call it (Playwright, any page that has finished loading):
//
//   import { checkLayout, WIDTHS } from "./layout.mjs";
//   for (const width of WIDTHS) {
//     const problems = await checkLayout(page, { width });
//     // [{ kind: "LAYOUT", what: "CUT_TEXT", where: "nav.flex > a.shrink-0", width: 390, detail: "..." }]
//   }
//
// It sets the window to that width, lets the screen settle and looks for:
//   OVERFLOW     the screen is wider than the window (it scrolls sideways);
//   CUT_TEXT     text cut by its box (hidden overflow, or "..."; see below), by a row
//                that scrolls with a hidden scroll bar, or by the window's edge; and a
//                row of tabs or menu links that scrolls sideways (on a phone its scroll
//                bar does not show, so the tabs past the edge look cut);
//   OVERLAP      text over other text, or a button or link over another;
//   OFF_SCREEN   a button, link or field outside the window, where no scrolling reaches it;
//   MENU         a menu item the person may open that cannot be reached at this width:
//                not in the menu bar, the side menu, the phone's tab bar nor its "More";
//                the same for every section's tabs;
//   FONT         text that is not in the app's own fonts (or whose font did not load);
//   BENGALI      Bengali text in a font with no Bengali letters (it would show as boxes);
//   TINY         readable text smaller than 12 px;
//   EMPTY_TABLE  a table with no rows that does not say what to do next.
// Text cut short with "..." (or a line clamp) is cut text on a phone and a tablet (390
// and 768 px: no pointer shows a tooltip there), table cells included (v6.4.1: a long
// buyer's, supplier's or company's name must show whole on a phone), and at every
// width on a button, a link, a tab, a menu item or a heading. It is allowed only on an
// element marked data-layout-cut-ok, and on a laptop or a large desktop with a tooltip
// that holds the whole text: in plain text, or in a table cell.
// It skips what is hidden on purpose (display:none, visibility:hidden, the sr-only
// text for screen readers, aria-hidden and inert parts, data-layout-ignore), rows
// that scroll on purpose with a visible scroll bar (a wide table in its scrolling
// box), the inside of a text field, and the development tools' own overlay.
//
// Each problem: { kind: "LAYOUT", what, where, width, detail }
//   what    a key of RULES;
//   where   a CSS-like path of tag names and the app's own class names: never an id,
//           an address, an attribute value or any of the screen's text, so it may go
//           into a GitHub issue (src/modules/ai/full-check/texts.ts checks it again);
//   detail  plain words for the ERP's own report. It may quote a few words of the
//           screen (kept private in the ERP; issues never carry it).
//
// Markers the app puts on its menus, so the checks know what must be reachable:
//   data-layout-expect="/a /b"  on a menu, or the app frame: these addresses must be reachable
//   data-layout-nav             on each menu whose links count for the nearest data-layout-expect
//   data-layout-more            on a "More" button: its menu holds the rest
//   data-layout-scroll-cue      on a row that scrolls with a cue of its own (not cut)
//   data-layout-cut-ok          on text that may end in "..." because its whole value is
//                               one tap away (use it sparingly: a file name that opens the file)
//   data-layout-ignore          on a decorative part the checks skip
//
// The rules' arithmetic is in small pure functions (LIB below), tested with Vitest
// (tests/unit/layout-check.test.ts); the same functions run inside the page.

/** The four widths every screen must work at: phone, tablet, laptop, large desktop. */
export const WIDTHS = [390, 768, 1366, 1920];

/** A window height that suits each width. */
export const HEIGHTS = { 390: 844, 768: 1024, 1366: 900, 1920: 1080 };

/** What each problem means, in plain words (the ERP's report shows these). */
export const RULES = {
  OVERFLOW: "The screen is wider than the window",
  CUT_TEXT: "Text is cut",
  OVERLAP: "Text or buttons overlap",
  OFF_SCREEN: "A button or link is off the screen",
  MENU: "A menu item cannot be reached",
  FONT: "Text is not in the app's fonts",
  BENGALI: "Bengali text is not in a Bengali font",
  TINY: "Text is too small to read",
  EMPTY_TABLE: "A table is empty and does not say what to do next",
};

/** The smallest readable text, in CSS pixels. */
export const MIN_TEXT_PX = 12;

/** Up to this width (a phone, a tablet) text cut with "..." is always cut: no pointer, no tooltip. */
export const STRICT_UP_TO = 768;

/** How many problems of one rule one check reports (the first ones say enough). */
const PER_RULE = 6;

// ---------------------------------------------------------------- the rules' arithmetic

/** A font family as the browser compares it: no quotes, lower case. */
export function normFamily(family) {
  return String(family)
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase();
}

/** The families of a CSS font-family list, in order. */
export function familiesOf(fontFamily) {
  return String(fontFamily ?? "")
    .split(",")
    .map(normFamily)
    .filter(Boolean);
}

/** Whether a FontFace's unicode-range covers the Bengali letters (ক, U+0995). */
export function coversBengali(unicodeRange) {
  const range = String(unicodeRange ?? "").trim();
  if (!range) return true;
  return range.split(",").some((part) => {
    const m = /^\s*U\+([0-9A-F?]+)(?:-([0-9A-F]+))?\s*$/i.exec(part);
    if (!m) return false;
    const from = parseInt(m[1].replace(/\?/g, "0"), 16);
    const to = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, "F"), 16);
    return from <= 0x0995 && 0x0995 <= to;
  });
}

/** Text with letters or digits in it (not just a dot, a dash or an arrow). */
export function isReadable(text) {
  return /[\p{L}\p{N}]/u.test(String(text ?? ""));
}

/** Text with Bengali letters in it. */
export function hasBengali(text) {
  return /[ঀ-৿]/.test(String(text ?? ""));
}

/** Whether readable text at this size is too small. */
export function isTiny(fontSizePx) {
  return Number(fontSizePx) > 0 && Number(fontSizePx) < MIN_TEXT_PX - 0.25;
}

/**
 * Whether a box cuts its own text: "x" (sideways) or "y" (lines cut off), or null.
 * Text cut short with "..." (text-overflow: ellipsis) or a line clamp is fine only:
 *   - on an element marked data-layout-cut-ok (`cutOk`: the whole value is one tap away);
 *   - never otherwise on a phone or a tablet (`narrow`: no pointer shows a tooltip),
 *     table cells included;
 *   - on a laptop or a large desktop, with a tooltip that holds the whole text
 *     (`titled`), in a table cell (`inCell`) or when not `strict` (`strict`: a phone or
 *     a tablet, or a button, link, tab, menu item or heading, where it must show whole).
 */
export function clipsOwnText(box) {
  const hides = (o) => o === "hidden" || o === "clip";
  const wide = box.scrollWidth > box.clientWidth + 1;
  const tall = box.scrollHeight > box.clientHeight + 1;
  const allowed = box.cutOk || (!box.narrow && box.titled && (box.inCell || !box.strict));
  if (hides(box.overflowX) && wide) {
    return allowed && box.textOverflow === "ellipsis" ? null : "x";
  }
  if (hides(box.overflowY) && tall) {
    return allowed && box.lineClamp ? null : "y";
  }
  return null;
}

/**
 * Whether a row of tabs or menu links hides some of them: it scrolls sideways and
 * gives no cue of its own (data-layout-scroll-cue). A phone shows no scroll bar until
 * the row is moved, so the tabs past the edge look cut. Such a row wraps, or puts the
 * rest under "More" (components/shell/section-tabs.tsx).
 */
export function tabRowHides(row) {
  const scrolls = row.overflowX === "auto" || row.overflowX === "scroll";
  return scrolls && row.scrollWidth > row.clientWidth + 1 && !row.cue;
}

/**
 * Whether a box with this overflow scrolls on purpose, so whatever sits outside
 * its edge is reachable: it scrolls, and either shows its scroll bar or gives a
 * cue of its own. A row that scrolls with its scroll bar hidden cuts its text.
 */
export function scrollsOnPurpose(box) {
  const scrolls = (o) => o === "auto" || o === "scroll";
  if (!scrolls(box.overflow)) return false;
  return box.cue || box.scrollbarWidth !== "none";
}

/** The part of two boxes that is in both: { w, h } (0 when they do not meet). */
export function intersection(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? { w, h } : { w: 0, h: 0 };
}

/**
 * Whether two lines of text overlap: more than a sliver sideways and more than
 * 40% of the smaller line's height (lines set tight touch, they do not overlap).
 */
export function textOverlaps(a, b) {
  const { w, h } = intersection(a, b);
  const smaller = Math.min(a.bottom - a.top, b.bottom - b.top);
  return w > 3 && h > Math.max(3, smaller * 0.4);
}

/** Whether two buttons or links overlap (more than the 1-2 px of shared borders). */
export function controlsOverlap(a, b) {
  const { w, h } = intersection(a, b);
  return w > 4 && h > 4;
}

/** Whether a box sticks out of a window this wide. */
export function outsideWidth(rect, width) {
  return rect.right > width + 1 || rect.left < -1;
}

/** The addresses in `expected` that are in none of `reachable`. */
export function missingFrom(expected, reachable) {
  const got = new Set(reachable);
  return [...new Set(expected)].filter((href) => !got.has(href));
}

/**
 * A selector that is safe to put in an issue: tag names, the app's own class names
 * and :nth-of-type only (no ids, no attribute values, no text). Anything else
 * makes it "(an element)".
 */
export function safeSelector(selector) {
  const s = String(selector ?? "").trim();
  if (!s || s.length > 300) return "(an element)";
  return /^[a-z][a-z0-9-]*(?:[.:][\w\-[\]%./:()#]*|\s>\s[a-z][a-z0-9-]*|\[data-slot\])*$/i.test(
    s,
  ) && !/[\u0080-￿]/.test(s)
    ? s
    : "(an element)";
}

/** One check's problems with the repeats taken out (the same rule at the same place). */
export function dedupe(problems) {
  const seen = new Set();
  const out = [];
  const perRule = new Map();
  for (const p of problems) {
    const key = `${p.what}|${p.where}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const n = perRule.get(p.what) ?? 0;
    if (n >= PER_RULE) continue;
    perRule.set(p.what, n + 1);
    out.push(p);
  }
  return out;
}

/** Families that have Bengali letters: by name, or by a unicode-range made for Bengali. */
export function isBengaliFamily(family, unicodeRange) {
  if (/bengali|bangla|kalpurush|solaiman|siyam ?rupali|hind siliguri|baloo da|lohit/i.test(family))
    return true;
  const range = String(unicodeRange ?? "").trim();
  // A face for every character (the default) says nothing about its letters.
  if (!range || /^U\+0+-10FFFF$/i.test(range)) return false;
  return coversBengali(range);
}

/** The pure functions, also run inside the page (declared together, so they can call each other). */
const LIB = [
  normFamily,
  familiesOf,
  coversBengali,
  isBengaliFamily,
  isReadable,
  hasBengali,
  isTiny,
  clipsOwnText,
  tabRowHides,
  scrollsOnPurpose,
  intersection,
  textOverlaps,
  controlsOverlap,
  outsideWidth,
];

export const LIB_SOURCE = `(() => {
const MIN_TEXT_PX = ${MIN_TEXT_PX};
const STRICT_UP_TO = ${STRICT_UP_TO};
${LIB.map((fn) => fn.toString()).join("\n")}
return { ${LIB.map((fn) => fn.name).join(", ")}, STRICT_UP_TO };
})()`;

// ---------------------------------------------------------------- inside the page

/**
 * Runs inside the page (self-contained: it only uses `lib`, the functions above).
 * Returns the problems it found and the menus whose items must be reachable.
 */
async function inPage(lib) {
  const W = window.innerWidth;
  const problems = [];
  const add = (what, el, detail) =>
    problems.push({ what, where: selectorOf(el), detail: String(detail).slice(0, 300) });

  // ---- what to skip
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "HEAD",
    "META",
    "LINK",
    "NEXTJS-PORTAL",
    "BR",
    "WBR",
  ]);
  const hiddenCache = new Map();
  const styleOf = (el) => getComputedStyle(el);
  /** sr-only text: a 1 px box that clips everything (for screen readers only). */
  const srOnly = (el, cs) =>
    cs.position === "absolute" &&
    (cs.clip === "rect(0px, 0px, 0px, 0px)" ||
      cs.clipPath === "inset(50%)" ||
      (parseFloat(cs.width) <= 1 && parseFloat(cs.height) <= 1));
  /** Hidden on purpose, by itself or a parent. */
  function hidden(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (hiddenCache.has(el)) return hiddenCache.get(el);
    let out = false;
    if (SKIP_TAGS.has(el.tagName)) out = true;
    else if (el.getAttribute("aria-hidden") === "true" || el.hasAttribute("inert")) out = true;
    else if (el.hasAttribute("data-layout-ignore")) out = true;
    else {
      const cs = styleOf(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse")
        out = true;
      else if (Number(cs.opacity) === 0) out = true;
      else if (srOnly(el, cs)) out = true;
      else out = hidden(el.parentElement);
    }
    hiddenCache.set(el, out);
    return out;
  }
  const shown = (el) =>
    !hidden(el) &&
    (typeof el.checkVisibility !== "function" ||
      el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));

  /** A path of tag names and the app's own class names (see safeSelector). */
  function selectorOf(el) {
    const parts = [];
    for (let e = el, depth = 0; e && e !== document.body && depth < 5; e = e.parentElement) {
      const tag = e.tagName.toLowerCase();
      if (tag === "main" || tag === "header" || tag === "aside") {
        parts.unshift(tag);
        break;
      }
      const slot = e.getAttribute("data-slot");
      const classes = [...e.classList]
        .filter((c) => /^[a-z][\w\-[\]%./:()#]*$/i.test(c) && c.length <= 40)
        .filter((c) => !/^(hover|focus|active|group|peer|data|aria|disabled|print|dark):/.test(c))
        .slice(0, 2);
      let part = slot ? `${tag}[data-slot]` : tag;
      if (!slot && classes.length) part += `.${classes.join(".")}`;
      const parent = e.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === e.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(e) + 1})`;
      }
      parts.unshift(part);
      depth += 1;
    }
    return parts.join(" > ") || el.tagName.toLowerCase();
  }

  /** The element's own text (its text nodes, not its children's). */
  const ownText = (el) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.nodeValue)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  /** The boxes of the element's own text, one per line. */
  function ownTextRects(el) {
    const rects = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) rects.push(r);
    }
    return rects;
  }
  const quote = (text) => `"${text.length > 40 ? `${text.slice(0, 40)}...` : text}"`;
  /** A tooltip with the whole text: a title on it or near it, there or once the pointer is over it. */
  function titled(el) {
    const has = () => {
      for (let e = el, i = 0; e && i < 4; e = e.parentElement, i++) {
        if (e.getAttribute("title")) return true;
      }
      return false;
    };
    if (has()) return true;
    // The pointer over it: the app may give cut text its tooltip then (truncated-titles.tsx).
    el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    return has();
  }
  const isField = (el) => el.closest("input, textarea, select, [contenteditable='true']");
  /** Buttons, links, tabs, menu items and headings: their text must show whole at every width. */
  const MUST_SHOW =
    "button, a[href], summary, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], h1, h2, h3, h4, h5, h6, [role='heading']";
  const CELL =
    "td, th, [role='cell'], [role='gridcell'], [role='columnheader'], [role='rowheader']";
  const kindOf = (el) =>
    el.closest("[role='tab']")
      ? "a tab"
      : el.closest("[role^='menuitem']")
        ? "a menu item"
        : el.closest("h1, h2, h3, h4, h5, h6, [role='heading']")
          ? "a heading"
          : el.closest("a[href], [role='link']")
            ? "a link"
            : "a button";

  // ---- which layer an element is in (fixed and sticky bars float over the page)
  const layerCache = new Map();
  function layerOf(el) {
    if (!el || el === document.body) return document.body;
    if (layerCache.has(el)) return layerCache.get(el);
    const cs = styleOf(el);
    const out =
      cs.position === "fixed" || cs.position === "sticky" ? el : layerOf(el.parentElement);
    layerCache.set(el, out);
    return out;
  }
  /** Inside a menu, a window or a tooltip (they sit over the page on purpose). */
  const floating = (el) =>
    el.closest(
      "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [role='tooltip'], [data-radix-popper-content-wrapper]",
    );

  /** The boxes around an element that cut what sticks out (hidden or scrolling overflow). */
  function clippers(el, self = false) {
    const out = [];
    const start = self ? el : el.parentElement;
    for (let p = start; p && p !== document.documentElement; p = p.parentElement) {
      const cs = styleOf(p);
      if (cs.position === "fixed") {
        if (cs.overflowX !== "visible" || cs.overflowY !== "visible") out.push({ el: p, cs });
        break;
      }
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") out.push({ el: p, cs });
    }
    return out;
  }
  /** The inner box of an element (inside its borders), where its content shows. */
  function innerRect(el) {
    const r = el.getBoundingClientRect();
    const left = r.left + el.clientLeft;
    const top = r.top + el.clientTop;
    return {
      left,
      top,
      right: left + (el.clientWidth || r.width),
      bottom: top + (el.clientHeight || r.height),
    };
  }
  const onPurpose = (p, cs, axis) =>
    lib.scrollsOnPurpose({
      overflow: axis === "x" ? cs.overflowX : cs.overflowY,
      scrollbarWidth: cs.scrollbarWidth,
      cue: p.hasAttribute("data-layout-scroll-cue"),
    });

  /**
   * Whether `rect` (a line of text or a link) is cut by a box around `el`: a box that
   * hides what sticks out, or scrolls with its scroll bar hidden. Returns that box.
   */
  function cutBy(el, rect, self = false) {
    for (const { el: p, cs } of clippers(el, self)) {
      const box = innerRect(p);
      const outX = rect.left < box.left - 2 || rect.right > box.right + 2;
      const outY = rect.top < box.top - 2 || rect.bottom > box.bottom + 2;
      if (outX && cs.overflowX !== "visible" && !onPurpose(p, cs, "x")) return p;
      if (outY && cs.overflowY !== "visible" && !onPurpose(p, cs, "y")) return p;
      // Inside a box that scrolls on purpose: whatever is outside is reachable.
      if ((outX && onPurpose(p, cs, "x")) || (outY && onPurpose(p, cs, "y"))) return null;
    }
    return null;
  }
  /** Whether a box that scrolls on purpose (sideways) holds this element. */
  function inSidewaysScroller(el) {
    return clippers(el).some(({ el: p, cs }) => onPurpose(p, cs, "x"));
  }

  // ---- 1. the screen wider than the window
  const pageWidth = Math.max(
    document.documentElement.scrollWidth,
    document.body ? document.body.scrollWidth : 0,
  );
  if (pageWidth > W + 1) {
    // The parts that stick out while their parent does not: where the overflow starts.
    let found = 0;
    for (const el of document.body.querySelectorAll("*")) {
      if (found >= 4) break;
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || !lib.outsideWidth(r, W)) continue;
      if (inSidewaysScroller(el) || cutBy(el, r) !== null) continue;
      const parent = el.parentElement;
      if (parent && parent !== document.body) {
        const pr = parent.getBoundingClientRect();
        if (lib.outsideWidth(pr, W)) continue;
      }
      add(
        "OVERFLOW",
        el,
        `The screen is ${pageWidth} px wide in a ${W} px window: this part reaches ${Math.round(r.right)} px`,
      );
      found += 1;
    }
    if (!found)
      problems.push({
        what: "OVERFLOW",
        where: "html",
        detail: `The screen is ${pageWidth} px wide in a ${W} px window`,
      });
  }

  // ---- 2-4, 6-8. one pass over every element with text of its own, and every control
  const texts = [];
  const controls = [];
  const CONTROL =
    "a[href], button, input:not([type='hidden']), select, textarea, summary, [role='button'], [role='tab'], [role='link'], [role='checkbox'], [role='switch'], [role='combobox']";
  // The app's fonts: the families its sans, serif and mono text resolve to (next/font
  // names them), less the system fonts they fall back on.
  const appFamilies = new Set();
  for (const cls of ["font-sans", "font-serif", "font-mono"]) {
    const probe = document.createElement("span");
    probe.className = cls;
    probe.setAttribute("aria-hidden", "true");
    document.body.appendChild(probe);
    const fams = lib.familiesOf(getComputedStyle(probe).fontFamily);
    probe.remove();
    // Up to the first system font: those are fallbacks, not the app's own.
    for (const f of fams) {
      if (/^(ui-|system-ui$|sans-serif$|serif$|georgia$)/.test(f)) break;
      appFamilies.add(f);
    }
    if (cls === "font-mono") for (const f of fams) appFamilies.add(f);
  }

  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("nextjs-portal, [data-nextjs-toast], #__next-build-watcher")) continue;
    const isControl = el.matches(CONTROL);
    const text = ownText(el);
    if (!isControl && !text) continue;
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (isControl) controls.push({ el, r });
    if (!text || el.tagName === "OPTION" || isField(el)) continue;
    const cs = styleOf(el);
    const rects = ownTextRects(el);
    if (!rects.length) continue;
    texts.push({ el, rects, cs, text });
  }

  // 2. text cut
  for (const t of texts) {
    const { el, cs, text, rects } = t;
    const control = el.closest(MUST_SHOW);
    const strict = W <= lib.STRICT_UP_TO || Boolean(control);
    const lineClamp = Boolean(cs.webkitLineClamp && cs.webkitLineClamp !== "none");
    const hasTitle = titled(el);
    const own = lib.clipsOwnText({
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      textOverflow: cs.textOverflow,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      titled: hasTitle,
      lineClamp,
      strict,
      narrow: W <= lib.STRICT_UP_TO,
      inCell: Boolean(el.closest(CELL)),
      cutOk: Boolean(el.closest("[data-layout-cut-ok]")),
    });
    if (own && lib.isReadable(text)) {
      const dots = own === "x" ? cs.textOverflow === "ellipsis" : lineClamp;
      const why = !dots
        ? ""
        : !hasTitle
          ? ", shown with ... and no tooltip with the whole text"
          : control
            ? `, shown with ...: ${kindOf(el)} must show its whole text`
            : `, shown with ...: at ${W} px there is no pointer to show its tooltip`;
      add(
        "CUT_TEXT",
        el,
        `${quote(text)} does not fit its box (${own === "x" ? "cut at the side" : "lines cut off"}${why})`,
      );
      continue;
    }
    if (!lib.isReadable(text)) continue;
    let reported = false;
    for (const line of rects) {
      const by = cutBy(el, line, true);
      if (by) {
        // "..." with a tooltip on the box itself is fine (clipsOwnText said so).
        if (by === el) break;
        add(
          "CUT_TEXT",
          el,
          `${quote(text)} is cut by the box around it${styleOf(by).scrollbarWidth === "none" ? ", a row that scrolls with its scroll bar hidden" : ""}`,
        );
        reported = true;
        break;
      }
      if (lib.outsideWidth(line, W) && !inSidewaysScroller(el) && layerOf(el) === document.body) {
        add("CUT_TEXT", el, `${quote(text)} runs off the side of the window`);
        reported = true;
        break;
      }
    }
    if (reported) continue;
  }

  // 2b. a row of tabs or menu links that scrolls sideways with no cue of its own
  for (const row of document.body.querySelectorAll("[role='tablist'], nav, nav *")) {
    if (!shown(row)) continue;
    const cs = styleOf(row);
    if (cs.overflowX !== "auto" && cs.overflowX !== "scroll") continue;
    const hides = lib.tabRowHides({
      overflowX: cs.overflowX,
      scrollWidth: row.scrollWidth,
      clientWidth: row.clientWidth,
      cue: Boolean(row.closest("[data-layout-scroll-cue]")),
    });
    if (!hides) continue;
    // Only a row of tabs or links: a wide table or picture in a menu is not one.
    if (!row.querySelector("a[href], [role='tab'], button")) continue;
    add(
      "CUT_TEXT",
      row,
      `A row of ${row.closest("[role='tablist']") ? "tabs" : "menu links"} is ${row.scrollWidth} px wide in a ${row.clientWidth} px space and scrolls sideways: on a phone the ones past the edge look cut (it should wrap, or put the rest under "More")`,
    );
  }

  // 3. overlap: text over text, and controls over controls, in the same layer
  /** The part of a box left showing inside the boxes around `el` that clip (none: null). */
  function showing(el, rect) {
    let { left, top, right, bottom } = rect;
    for (const { el: p, cs } of clippers(el, true)) {
      const box = innerRect(p);
      if (cs.overflowX !== "visible") {
        left = Math.max(left, box.left);
        right = Math.min(right, box.right);
      }
      if (cs.overflowY !== "visible") {
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
    }
    return right - left > 0.5 && bottom - top > 0.5 ? { left, top, right, bottom } : null;
  }
  const lines = [];
  for (const t of texts) {
    if (!lib.isReadable(t.text) || floating(t.el)) continue;
    const layer = layerOf(t.el);
    for (const line of t.rects) {
      const r = showing(t.el, line);
      if (r) lines.push({ el: t.el, layer, r });
    }
  }
  lines.sort((a, b) => a.r.top - b.r.top);
  let overlaps = 0;
  for (let i = 0; i < lines.length && overlaps < 6; i++) {
    const a = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j];
      if (b.r.top >= a.r.bottom) break;
      if (a.el === b.el || a.layer !== b.layer) continue;
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (!lib.textOverlaps(a.r, b.r)) continue;
      add("OVERLAP", b.el, `Text ${quote(ownText(b.el))} sits on top of ${quote(ownText(a.el))}`);
      overlaps += 1;
      break;
    }
  }
  const boxes = controls
    .filter(({ el }) => !floating(el))
    .filter(({ el }) => {
      const cs = styleOf(el);
      return cs.position !== "absolute" && cs.position !== "fixed";
    })
    // A link that wraps onto two lines is two boxes, one per line.
    .flatMap(({ el }) =>
      [...el.getClientRects()]
        .map((line) => showing(el, line))
        .filter(Boolean)
        .map((r) => ({ el, r, layer: layerOf(el) })),
    )
    .sort((a, b) => a.r.top - b.r.top);
  for (let i = 0; i < boxes.length && overlaps < 10; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      if (b.r.top >= a.r.bottom) break;
      if (a.el === b.el) continue;
      if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (a.el.closest("label") && a.el.closest("label") === b.el.closest("label")) continue;
      if (!lib.controlsOverlap(a.r, b.r)) continue;
      add("OVERLAP", b.el, "A button or link sits on top of another one");
      overlaps += 1;
      break;
    }
  }

  // 4. controls off the screen
  for (const { el, r } of controls) {
    if (!lib.outsideWidth(r, W)) continue;
    // In a row that scrolls on purpose it is reachable; cut by a box, "Text is cut" says so.
    if (inSidewaysScroller(el) || floating(el) || cutBy(el, r)) continue;
    add(
      "OFF_SCREEN",
      el,
      `A ${el.tagName === "A" ? "link" : el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" ? "field" : "button"} is outside the ${W} px window (from ${Math.round(r.left)} to ${Math.round(r.right)} px)`,
    );
  }

  // 6, 7. fonts: the app's own; Bengali text in a font that has Bengali letters
  const bengaliFaces = new Set();
  const loading = [];
  for (const face of document.fonts) {
    if (face.status === "unloaded" && lib.isBengaliFamily(face.family, face.unicodeRange)) {
      loading.push(face.load().catch(() => null));
    }
  }
  await Promise.all(loading);
  for (const face of document.fonts) {
    if (face.status === "loaded" && lib.isBengaliFamily(face.family, face.unicodeRange)) {
      bengaliFaces.add(lib.normFamily(face.family));
    }
  }
  // Each family's faces: loaded when at least one of them is.
  const faces = new Map();
  for (const face of document.fonts) {
    const f = lib.normFamily(face.family);
    faces.set(f, faces.get(f) === "loaded" || face.status === "loaded" ? "loaded" : face.status);
  }
  const notLoaded = new Set();
  for (const t of texts) {
    if (!lib.isReadable(t.text)) continue;
    const fams = lib.familiesOf(t.cs.fontFamily);
    const first = fams[0];
    if (first && !appFamilies.has(first)) {
      add("FONT", t.el, `${quote(t.text)} is in "${first}", not one of the app's fonts`);
    } else if (
      first &&
      faces.has(first) &&
      faces.get(first) !== "loaded" &&
      !notLoaded.has(first)
    ) {
      notLoaded.add(first);
      add("FONT", t.el, `The font "${first}" did not load, so the text shows in another font`);
    }
    if (lib.hasBengali(t.text) && !fams.some((f) => bengaliFaces.has(f))) {
      add(
        "BENGALI",
        t.el,
        `${quote(t.text)} is in ${fams.slice(0, 2).join(", ") || "no font"}, which has no Bengali letters (they may show as boxes)`,
      );
    }
  }

  // 8. tiny text
  for (const t of texts) {
    if (!lib.isReadable(t.text)) continue;
    const px = parseFloat(t.cs.fontSize);
    if (lib.isTiny(px)) add("TINY", t.el, `${quote(t.text)} is ${px} px (at least 12 px)`);
  }

  // 9. empty tables
  for (const table of document.querySelectorAll("table")) {
    if (!shown(table)) continue;
    const bodyRows = table.tBodies.length
      ? [...table.tBodies].reduce((n, b) => n + b.rows.length, 0)
      : table.rows.length - (table.tHead ? table.tHead.rows.length : 0);
    if (bodyRows > 0) continue;
    // A message next to it (in the same box) says what to do next.
    const box =
      table.parentElement?.getAttribute("data-slot") === "table-container"
        ? table.parentElement.parentElement
        : table.parentElement;
    const all = (box?.innerText ?? "").replace(/\s+/g, " ").trim();
    const own = (table.innerText ?? "").replace(/\s+/g, " ").trim();
    if (all.length > own.length + 3) continue;
    add("EMPTY_TABLE", table, "A table has no rows and no message saying what to do next");
  }

  // ---- 5. menus: what must be reachable, and what is reachable without opening anything
  // Ids from an earlier check (another width) would make two buttons share an id.
  for (const el of document.querySelectorAll("[data-layout-id]"))
    el.removeAttribute("data-layout-id");
  let n = 0;
  const menus = [];
  /** A link is reachable when it is shown whole inside the window (or a row that scrolls on purpose). */
  function reachable(a) {
    if (!shown(a)) return false;
    const r = a.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (cutBy(a, r)) return false;
    return !lib.outsideWidth(r, W) || inSidewaysScroller(a);
  }
  const pathOf = (a) => {
    const href = a.getAttribute("href") || "";
    try {
      return new URL(href, location.href).pathname;
    } catch {
      return href.startsWith("/") ? href.split(/[?#]/)[0] : null;
    }
  };
  for (const holder of document.querySelectorAll("[data-layout-expect]")) {
    if (hidden(holder)) continue;
    const expect = (holder.getAttribute("data-layout-expect") || "").split(/\s+/).filter(Boolean);
    const navs = [...holder.querySelectorAll("[data-layout-nav]")].filter(
      (nav) => nav.closest("[data-layout-expect]") === holder,
    );
    if (holder.hasAttribute("data-layout-nav")) navs.unshift(holder);
    const got = [];
    const more = [];
    for (const nav of navs) {
      if (hidden(nav)) continue;
      for (const a of nav.querySelectorAll("a[href]")) {
        if (a.closest("[data-layout-expect]") !== holder && a.closest("[data-layout-nav]") !== nav)
          continue;
        if (reachable(a)) got.push(pathOf(a));
      }
      for (const button of nav.querySelectorAll("[data-layout-more]")) {
        if (!shown(button)) continue;
        const r = button.getBoundingClientRect();
        if (lib.outsideWidth(r, W) && !inSidewaysScroller(button)) continue;
        const id = `layout-more-${n++}`;
        button.setAttribute("data-layout-id", id);
        more.push(id);
      }
    }
    const id = `layout-menu-${n++}`;
    holder.setAttribute("data-layout-id", id);
    menus.push({ id, where: selectorOf(holder), expect, got: got.filter(Boolean), more });
  }
  return { problems, menus };
}

/** The links shown in the menu a "More" button opened (Radix puts it at the end of the page). */
function linksInOpenMenu() {
  const menu = [...document.querySelectorAll("[role='menu']")].pop();
  if (!menu) return [];
  return [...menu.querySelectorAll("a[href]")]
    .filter((a) => {
      const cs = getComputedStyle(a);
      const r = a.getBoundingClientRect();
      return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
    })
    .map((a) => {
      const href = a.getAttribute("href") || "";
      try {
        return new URL(href, location.href).pathname;
      } catch {
        return href.startsWith("/") ? href.split(/[?#]/)[0] : null;
      }
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------- the check

/**
 * Checks the screen open in `page` at one width. Leaves the window at that width.
 *   width     the window's width (one of WIDTHS)
 *   height    the window's height (default: HEIGHTS[width], or 900)
 *   settleMs  how long the screen may take to lay itself out again (default 350)
 *   menus     check every menu item is reachable, opening the "More" menus (default true);
 *             false: no menu check (a tab or a window the screen opened: the menus were
 *             checked with the screen)
 *   seen      a Set the caller keeps between screens: a menu found whole at a width is
 *             not opened again there (the top bar is the same on every screen)
 */
export async function checkLayout(
  page,
  { width, height, settleMs = 350, menus = true, seen } = {},
) {
  if (!Number.isFinite(width)) throw new Error("checkLayout needs a width");
  await page.setViewportSize({ width, height: height ?? HEIGHTS[width] ?? 900 });
  await page.waitForTimeout(settleMs);
  await page.evaluate("document.fonts.ready.then(() => new Promise(requestAnimationFrame))");
  const collect = () => page.evaluate(`(${inPage.toString()})(${LIB_SOURCE})`);
  let found = await collect();
  if (found.problems.length) {
    // A screen still starting up (its scripts not running yet, so no tooltips; a
    // part still moving into place) looks once more before anything is reported.
    await page.waitForTimeout(1000);
    found = await collect();
  }
  const problems = found.problems.map((p) => ({ kind: "LAYOUT", width, ...p }));
  let gaps = menus ? await menuGaps(page, found.menus, { width, seen, open: true }) : [];
  if (gaps.length) {
    // A screen still settling (a menu drawn again after the resize) can swallow a
    // click: look once more, from scratch, before calling a menu item unreachable.
    await page.waitForTimeout(800);
    gaps = await menuGaps(page, (await collect()).menus, { width, seen, open: true });
  }
  problems.push(...gaps);
  return dedupe(problems.map((p) => ({ ...p, where: safeSelector(p.where) })));
}

/** The menu items that cannot be reached at this width, opening "More" menus when `open`. */
async function menuGaps(page, menus, { width, seen, open }) {
  const gaps = [];
  for (const menu of menus) {
    let missing = missingFrom(menu.expect, menu.got);
    const key = `${width}|${menu.where}|${menu.expect.join(" ")}`;
    if (missing.length && seen?.has(key)) continue;
    if (missing.length && open) {
      for (const more of menu.more) {
        if (!missing.length) break;
        const opened = await page
          .locator(`[data-layout-id="${more}"]`)
          .click({ timeout: 3000 })
          .then(() => page.waitForSelector("[role='menu']", { timeout: 3000 }))
          .then(() => true)
          .catch(() => false);
        if (!opened) continue;
        await page.waitForTimeout(150);
        const inMenu = await page.evaluate(`(${linksInOpenMenu.toString()})()`);
        missing = missingFrom(missing, inMenu);
        await page.keyboard.press("Escape").catch(() => {});
        await page
          .waitForSelector("[role='menu']", { state: "detached", timeout: 2000 })
          .catch(() => {});
      }
    }
    if (!missing.length) seen?.add(key);
    else {
      gaps.push({
        kind: "LAYOUT",
        width,
        what: "MENU",
        where: menu.where,
        detail: `Not reachable at ${width} px: ${missing.join(", ")}`,
        missing,
      });
    }
  }
  return gaps;
}

/**
 * The check at every width, one after the other (the window ends at the last one).
 * `deadline` (a Date.now() value) stops early when the time is up.
 */
export async function checkAllWidths(page, { widths = WIDTHS, deadline, ...options } = {}) {
  const all = [];
  for (const width of widths) {
    if (deadline && Date.now() > deadline) break;
    all.push(...(await checkLayout(page, { ...options, width })));
  }
  return all;
}

/** One problem in a line for a log or an issue: the width, the rule and the place, never text. */
export function problemLine(p) {
  return `LAYOUT ${p.width} ${p.what} ${safeSelector(p.where)}`;
}
