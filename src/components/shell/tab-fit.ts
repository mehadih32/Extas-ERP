/*
 * Which of a row's tabs fit at the row's width (components/shell/section-tabs.tsx).
 * Plain arithmetic, so it is tested without a browser (tests/unit/ai-center-nav.test.ts).
 */

export type TabFit = {
  /** The tabs shown in the row, by their place in the list, in order. */
  shown: number[];
  /** The tabs that go under "More", in order (none when every tab fits). */
  more: number[];
};

/**
 * Fits tabs `widths` wide (px) into a row `available` px wide, `gap` px apart. When
 * they do not all fit, the first ones that do stay in the row with a "More" button
 * `more` px wide after them, and the rest go under it. The current tab (`current`,
 * -1 for none) is always in the row: it takes the place of the last one that fits.
 */
export function fitTabs({
  widths,
  available,
  more,
  gap,
  current = -1,
}: {
  widths: readonly number[];
  available: number;
  more: number;
  gap: number;
  current?: number;
}): TabFit {
  const all = widths.map((_, i) => i);
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available + 0.5) return { shown: all, more: [] };

  // Each tab in the row takes its width and the gap after it; then comes "More".
  let room = available - more;
  const shown = new Set<number>();
  if (current >= 0 && current < widths.length) {
    shown.add(current);
    room -= widths[current]! + gap;
  }
  for (const i of all) {
    if (shown.has(i)) continue;
    const need = widths[i]! + gap;
    if (need > room + 0.5) break;
    shown.add(i);
    room -= need;
  }
  return {
    shown: all.filter((i) => shown.has(i)),
    more: all.filter((i) => !shown.has(i)),
  };
}
