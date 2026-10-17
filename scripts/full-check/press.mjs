// Pressing what only shows a tab or opens a window (v6.4), shared by the Full check
// (crawl.mjs) and the layout checks (layout-run.mjs), so that the layout of each tab
// and each window a screen opens is checked too, not only the screen as it first
// shows. It never presses a button whose words (its text, its label for screen
// readers or its tooltip) say it could change something (DANGER), nor a disabled one.

/** Buttons never pressed, even on the demo site. */
export const DANGER =
  /delete|remove|take out|cancel|void|send|approve|reject|pay|merge|restore|sign out|log out|switch off|turn off|pause|save|submit|confirm|record|post|apply|run|start|teach|test|reset|close|archive|lock|upload|import|generate|create|add|new|refund|settle|discard|retire|grant|revoke/i;

/** What may be pressed. */
export const PRESSABLE = {
  /** The Full check: tabs, buttons that open a menu or a window, and parts that fold open. */
  all: '[role="tab"], button[aria-haspopup], summary',
  /** The layout checks: tabs and buttons that open a window. */
  dialogs: '[role="tab"], [aria-haspopup="dialog"]',
};

/** Whether a button with these words (text, screen-reader label, tooltip) is safe to press. */
export function safeToPress(...words) {
  return !DANGER.test(words.filter(Boolean).join(" "));
}

const WINDOW = '[role="dialog"], [role="alertdialog"]';

/**
 * Presses the screen's safe tabs and window buttons one after the other (at most
 * `max`, until `deadline`), and after each one that showed a tab or opened a window
 * calls `look({ kind: "tab" | "window", label })`, while the tab shows or the window
 * is open. A window is closed again with Escape; the window's size is put back after
 * `look`. It stops when a press leads to another screen.
 *   selector  what to press (PRESSABLE.all or PRESSABLE.dialogs)
 *   within    a CSS prefix that limits it to part of the screen ("#main ")
 */
export async function pressSafe(
  page,
  { selector = PRESSABLE.all, within = "", max = 6, deadline, look } = {},
) {
  const scoped = selector
    .split(",")
    .map((s) => `${within}${s.trim()}`)
    .join(", ");
  // The elements themselves (not their places in the list): what is checked is what is pressed.
  const buttons = await page.$$(scoped).catch(() => []);
  const screen = new URL(page.url()).pathname;
  const size = page.viewportSize();
  let n = 0;
  for (const button of buttons) {
    if (n >= max || (deadline && Date.now() > deadline)) break;
    const facts = await button
      .evaluate((el) => ({
        text: (el.innerText || "").replace(/\s+/g, " ").trim(),
        label: el.getAttribute("aria-label") || "",
        title: el.getAttribute("title") || "",
        tab: el.getAttribute("role") === "tab",
        selected: el.getAttribute("aria-selected") === "true",
        disabled: Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true",
      }))
      .catch(() => null);
    if (!facts || facts.disabled || !safeToPress(facts.text, facts.label, facts.title)) continue;
    // The tab already showing was checked with the screen.
    if (facts.tab && facts.selected) continue;
    if (!(await button.isVisible().catch(() => false))) continue;
    const clicked = await button
      .click({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    n += 1;
    if (!clicked) continue;
    await page.waitForTimeout(300);
    if (new URL(page.url()).pathname !== screen) break;
    const open = page.locator(WINDOW).filter({ visible: true });
    const opened = (await open.count().catch(() => 0)) > 0;
    const tab =
      facts.tab && (await button.getAttribute("aria-selected").catch(() => null)) === "true";
    const label = (facts.text || facts.label || facts.title).slice(0, 60);
    if ((opened || tab) && look) {
      await look({ kind: opened ? "window" : "tab", label });
      if (size) await page.setViewportSize(size).catch(() => {});
    }
    await page.keyboard.press("Escape").catch(() => {});
    if (opened)
      await open
        .first()
        .waitFor({ state: "hidden", timeout: 2000 })
        .catch(() => {});
  }
}
