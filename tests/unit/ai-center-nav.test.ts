import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AI_GROUPS, AI_TABS, type AiTab, aiNavigation, visibleAiTabs } from "@/components/ai/tabs";
import { fitTabs } from "@/components/shell/tab-fit";
import { DEFAULT_ROLE_PERMISSIONS } from "@/modules/rbac/permissions";

/*
 * v6.4 B1: the AI Center's pages in groups, so every page's name shows in full at
 * every width (one row of 16 tabs showed "Settings" as "S"), and every section's
 * tab row: no tab is ever cut, the ones that do not fit go under "More", and the
 * current tab always shows.
 */

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const labels = (tabs: ReadonlyArray<{ label: string }>) => tabs.map((t) => t.label);

describe("The AI Center's groups", () => {
  it("are Mehedi & Agents, Work, Money and System, every page in one of them", () => {
    expect(labels(AI_GROUPS)).toEqual(["Mehedi & Agents", "Work", "Money", "System"]);
    const ids = new Set(AI_GROUPS.map((g) => g.id));
    for (const tab of AI_TABS) expect(ids.has(tab.group), tab.label).toBe(true);
    const nav = aiNavigation(visibleAiTabs(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN, true), "/ai");
    expect(nav.groups.map((g) => [g.label, labels(g.tabs)])).toEqual([
      ["Mehedi & Agents", ["AI Home", "Mehedi 2.0", "Agents", "Skills", "Chat"]],
      ["Work", ["Orders", "Drafts", "Bot"]],
      ["Money", ["Budget & Costs", "Models"]],
      ["System", ["Control", "Books & tests", "Logs", "Server Health", "Full check", "Settings"]],
    ]);
  });

  it("open on the group of the current page, each group going to its first page", () => {
    const tabs = visibleAiTabs(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN, true);
    const at = (pathname: string) => aiNavigation(tabs, pathname);
    expect(at("/ai/settings").active?.label).toBe("System");
    expect(at("/ai/settings").current).toBe("/ai/settings");
    expect(at("/ai/costs").active?.label).toBe("Money");
    expect(at("/ai").active?.label).toBe("Mehedi & Agents");
    // A page under a tab belongs to the tab's group.
    expect(at("/ai/skills/new").current).toBe("/ai/skills");
    expect(at("/ai/skills/new").active?.label).toBe("Mehedi & Agents");
    expect(at("/ai/orders/cm123").active?.label).toBe("Work");
    expect(at("/ai/knowledge/K1").active?.label).toBe("System");
    expect(at("/ai/settings").groups.map((g) => g.href)).toEqual([
      "/ai",
      "/ai/orders",
      "/ai/costs",
      "/ai/control",
    ]);
  });

  it("keep each person's pages: Settings and Bot with ai.manage, the server's pages for the platform owner", () => {
    const owner = aiNavigation(visibleAiTabs(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN), "/ai/control");
    expect(labels(owner.active!.tabs)).toEqual(["Control", "Books & tests", "Logs", "Settings"]);
    const viewer = aiNavigation(visibleAiTabs(["ai.view"]), "/ai/logs");
    expect(viewer.groups.map((g) => [g.label, labels(g.tabs)])).toEqual([
      ["Mehedi & Agents", ["AI Home", "Mehedi 2.0", "Agents", "Skills"]],
      ["Work", ["Orders", "Drafts"]],
      ["Money", ["Budget & Costs", "Models"]],
      ["System", ["Control", "Books & tests", "Logs"]],
    ]);
    expect(aiNavigation(visibleAiTabs([]), "/ai").groups).toEqual([]);
    // A group with no page for this person is left out.
    const only = aiNavigation([{ href: "/ai/logs", label: "Logs", group: "system" }], "/ai/logs");
    expect(labels(only.groups)).toEqual(["System"]);
  });

  it("take a new page with one line: Bug Guard goes under System", () => {
    const bugGuard: AiTab = {
      href: "/ai/bug-guard",
      label: "Bug Guard",
      group: "system",
      anyOf: ["ai.manage"],
      platformOwner: true,
    };
    const nav = aiNavigation([...AI_TABS, bugGuard], "/ai/bug-guard");
    expect(nav.active?.label).toBe("System");
    expect(labels(nav.active!.tabs).at(-1)).toBe("Bug Guard");
  });

  it("are drawn as group tabs with the group's pages under them, wrapping, never cut", () => {
    const layout = read("src/app/(app)/ai/layout.tsx");
    expect(layout).toContain("<AiNav");
    const nav = read("src/components/ai/ai-nav.tsx");
    expect(nav).toContain("aiNavigation(");
    expect(nav).toContain("<SectionTabs");
    expect(nav).toContain("flex-wrap");
    expect(nav).toContain('aria-current={active ? "page" : undefined}');
  });
});

describe("A section's tab row", () => {
  const widths = [60, 80, 70, 90, 100, 75];
  const gap = 24;

  it("shows every tab when they fit", () => {
    const total = widths.reduce((a, b) => a + b, 0) + gap * 5;
    expect(fitTabs({ widths, available: total, more: 60, gap })).toEqual({
      shown: [0, 1, 2, 3, 4, 5],
      more: [],
    });
  });

  it("puts what does not fit under More, never cutting a tab", () => {
    const fit = fitTabs({ widths, available: 300, more: 60, gap });
    expect(fit).toEqual({ shown: [0, 1], more: [2, 3, 4, 5] });
    // What is shown, the gaps and More fit in the row.
    const used = fit.shown.reduce((s, i) => s + widths[i]! + gap, 0) + 60;
    expect(used).toBeLessThanOrEqual(300);
  });

  it("always shows the current tab, in its place", () => {
    expect(fitTabs({ widths, available: 300, more: 60, gap, current: 5 })).toEqual({
      shown: [0, 5],
      more: [1, 2, 3, 4],
    });
    expect(fitTabs({ widths, available: 300, more: 60, gap, current: 1 })).toEqual({
      shown: [0, 1],
      more: [2, 3, 4, 5],
    });
    // Even when nothing else fits.
    expect(fitTabs({ widths, available: 120, more: 60, gap, current: 4 })).toEqual({
      shown: [4],
      more: [0, 1, 2, 3, 5],
    });
  });

  it("is the one tab row of every section: More, a focus ring and aria-current", () => {
    const tabs = read("src/components/shell/section-tabs.tsx");
    expect(tabs).toContain("fitTabs(");
    expect(tabs).toContain("data-layout-more");
    expect(tabs).toContain("data-layout-expect");
    expect(tabs).toContain('aria-current={active ? "page" : undefined}');
    expect(tabs).toContain("focus-visible:ring");
    expect(tabs).not.toContain("[scrollbar-width:none]");
  });
});
