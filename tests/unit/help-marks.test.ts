import { describe, expect, it } from "vitest";

import {
  bestFirst,
  chooseWindow,
  finishWindow,
  pickMarks,
  placeBadges,
} from "../../scripts/full-check/help-marks.mjs";

/*
 * v6.4.1 C2: a Help picture shows the part of the page its steps are about,
 * not the top of a long page, and has a numbered mark on what each step names.
 * These are the rules help-shots.mjs uses to cut the picture and place the
 * marks; scripts/full-check/help-shots-selftest.mjs tests them with the
 * browser's side on made-up pages.
 */

let next = 0;
/** One element showing a label a step quotes, at y px down the page. */
const at = (
  y: number,
  over: Partial<{ label: string; li: number; tier: number; act: boolean; body: boolean }> = {},
) => ({
  id: next++,
  label: over.label ?? "Save",
  li: over.li ?? 0,
  tier: over.tier ?? 0,
  act: over.act ?? true,
  body: over.body ?? true,
  x: 100,
  y,
  w: 120,
  h: 32,
});

const page = { scrollY: 0, viewHeight: 800, docHeight: 5000, maxHeight: 1600 };

describe("Which part of the page a Help picture shows (v6.4.1 C2)", () => {
  it("starts at the part the guide's target names, however far down the page", () => {
    const win = chooseWindow({
      ...page,
      steps: [[at(4200)]],
      target: { label: "Logos and embroidery", part: { y: 4100, h: 300 } },
      opened: null,
    });
    expect(win).toMatchObject({ top: 4084, why: "Logos and embroidery" });
    // Down to the end of that part at least; not moved up to fill a screen near the end.
    const done = finishWindow(win, [], page);
    expect(done.top).toBe(4084);
    expect(done.bottom).toBeGreaterThanOrEqual(4100 + 300);
    expect(done.bottom).toBeLessThanOrEqual(5000);
  });

  it("without a target, shows where the most steps' buttons are, not the top of the page", () => {
    const steps = [[at(200)], [at(3000)], [at(3200)], [at(3500)]];
    const win = chooseWindow({ ...page, steps, target: null, opened: null });
    expect(win.why).toBe("marks");
    expect(win.top).toBeGreaterThan(2000);
    expect(pickMarks(steps, win).map((m) => m.n)).toEqual([2, 3, 4]);
  });

  it("counts the page's own buttons before the menu's, which sit at the top", () => {
    const steps = [
      [at(10, { body: false, tier: 1 })],
      [at(12, { body: false, tier: 1 })],
      [at(3000)],
      [at(3100)],
    ];
    expect(chooseWindow({ ...page, steps, target: null, opened: null }).top).toBeGreaterThan(2000);
  });

  it("keeps the top of the page when it already holds the most", () => {
    const steps = [[at(100)], [at(300)], [at(3000)]];
    expect(chooseWindow({ ...page, steps, target: null, opened: null }).top).toBe(0);
  });

  it("shows an open dialog or menu as the screen is", () => {
    const win = chooseWindow({
      ...page,
      scrollY: 40,
      steps: [[at(300)]],
      target: null,
      opened: "dialog",
    });
    expect(win).toEqual({ top: 40, bottom: 840, why: "dialog" });
    expect(finishWindow(win, [at(300)], page)).toEqual({ top: 40, bottom: 840, why: "dialog" });
  });

  it("reaches below the lowest mark, at least a screen's height, at most the longest picture", () => {
    expect(finishWindow({ top: 0, bottom: 1600, why: "marks" }, [at(100)], page).bottom).toBe(800);
    expect(finishWindow({ top: 0, bottom: 1600, why: "marks" }, [at(1200)], page).bottom).toBe(
      1272,
    );
    expect(
      finishWindow({ top: 0, bottom: 1600, why: "marks" }, [at(1590)], page).bottom,
    ).toBeLessThanOrEqual(1600);
    expect(
      finishWindow({ top: 0, bottom: 1600, why: "marks" }, [], { ...page, docHeight: 500 }),
    ).toEqual({ top: 0, bottom: 500, why: "marks" });
  });

  it("never cuts a sliver: a part at the very end of the page shows a little above it", () => {
    const end = { ...page, docHeight: 2800 };
    const win = { top: 2684, bottom: 2800, why: "Statement", floor: 2790 };
    expect(finishWindow(win, [at(2700)], end)).toEqual({
      top: 2400,
      bottom: 2800,
      why: "Statement",
    });
  });
});

describe("Which element each step's number marks (v6.4.1 C2)", () => {
  it("marks the page's own button before the menu's, a button before a heading", () => {
    const menu = at(10, { label: "Money", tier: 1, body: false });
    const heading = at(300, { label: "Providers", li: 1, act: false });
    const button = at(340, { label: "Read models from providers", li: 2 });
    expect(bestFirst([menu, heading, button])[0]).toBe(button);
    expect(bestFirst([menu, heading])[0]).toBe(heading);
    // A link to another page only when the step names nothing else here.
    const away = at(10, { label: "System", tier: 4, body: false });
    expect(bestFirst([away, at(900, { tier: 2, li: 1 })])[0]!.tier).toBe(2);
    expect(bestFirst([away])[0]).toBe(away);
  });

  it("gives each step its own element, and marks nothing outside the picture", () => {
    const shared = at(300);
    const steps = [[shared], [shared, at(400)], [at(2000)]];
    const marks = pickMarks(steps, { top: 0, bottom: 1600 });
    expect(marks.map((m) => [m.n, m.y])).toEqual([
      [1, 300],
      [2, 400],
    ]);
  });

  it("puts each number inside the picture, beside its thing, with an arrow to it", () => {
    const [badge] = placeBadges([{ n: 1, x: 600, y: 2100, w: 120, h: 32 }], [], {
      top: 2000,
      bottom: 2800,
      width: 1280,
    });
    expect(badge!.n).toBe(1);
    expect(badge!.badge.y).toBeGreaterThanOrEqual(2004);
    expect(badge!.badge.y).toBeLessThanOrEqual(2800 - 34);
    expect(badge!.line).not.toBeNull();
    expect(badge!.ring).toEqual({ x: 596, y: 2096, w: 128, h: 40 });
  });
});
