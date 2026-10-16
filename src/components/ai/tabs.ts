import { activeTabHref, holdsAny } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

/** The AI Center's groups of pages (v6.4: one row of 16 tabs did not fit any screen). */
export type AiGroup = "mehedi" | "work" | "money" | "system";

export const AI_GROUPS: ReadonlyArray<{ id: AiGroup; label: string }> = [
  { id: "mehedi", label: "Mehedi & Agents" },
  { id: "work", label: "Work" },
  { id: "money", label: "Money" },
  { id: "system", label: "System" },
];

export type AiTab = {
  href: string;
  label: string;
  /** The group the page is under (AI_GROUPS). */
  group: AiGroup;
  anyOf: readonly PermissionKey[];
  /** Only for the platform owner (Server Health looks at the whole server). */
  platformOwner?: true;
};

/*
 * The AI Center's pages, by group. Everything is read with ai.view or ai.manage
 * (the owner, by default); changing anything, and the Settings page with the key
 * and the PIN, needs ai.manage. The AI itself holds neither. Server Health and the
 * Full check are the platform owner's only. A new page is one line here, with its
 * group; the menu and the layout checks follow (and its guide goes in the Help Center).
 */
export const AI_KEYS: readonly PermissionKey[] = ["ai.view", "ai.manage"];

/** Pages for the platform owner only, who also holds ai.manage. */
const PLATFORM_OWNER = { anyOf: ["ai.manage"], platformOwner: true } as const;

export const AI_TABS: readonly AiTab[] = [
  { href: "/ai", label: "AI Home", group: "mehedi", anyOf: AI_KEYS },
  { href: "/ai/mehedi", label: "Mehedi 2.0", group: "mehedi", anyOf: AI_KEYS },
  { href: "/ai/agents", label: "Agents", group: "mehedi", anyOf: AI_KEYS },
  { href: "/ai/skills", label: "Skills", group: "mehedi", anyOf: AI_KEYS },
  { href: "/ai/chat", label: "Chat", group: "mehedi", anyOf: ["ai.manage"] },
  { href: "/ai/orders", label: "Orders", group: "work", anyOf: AI_KEYS },
  { href: "/ai/drafts", label: "Drafts", group: "work", anyOf: AI_KEYS },
  { href: "/ai/bot", label: "Bot", group: "work", anyOf: ["ai.manage"] },
  { href: "/ai/costs", label: "Budget & Costs", group: "money", anyOf: AI_KEYS },
  { href: "/ai/models", label: "Models", group: "money", anyOf: AI_KEYS },
  { href: "/ai/control", label: "Control", group: "system", anyOf: AI_KEYS },
  { href: "/ai/knowledge", label: "Books & tests", group: "system", anyOf: AI_KEYS },
  { href: "/ai/logs", label: "Logs", group: "system", anyOf: AI_KEYS },
  { href: "/ai/health", label: "Server Health", group: "system", ...PLATFORM_OWNER },
  { href: "/ai/full-check", label: "Full check", group: "system", ...PLATFORM_OWNER },
  { href: "/ai/settings", label: "Settings", group: "system", anyOf: ["ai.manage"] },
];

/** The pages this person may open, group by group. */
export function visibleAiTabs(permissions: Iterable<string>, platformOwner = false): AiTab[] {
  const held = [...permissions];
  const mine = AI_TABS.filter(
    (tab) => holdsAny(held, tab.anyOf) && (!tab.platformOwner || platformOwner),
  );
  return AI_GROUPS.flatMap((g) => mine.filter((tab) => tab.group === g.id));
}

export type AiNavGroup = {
  id: AiGroup;
  label: string;
  /** Where the group's tab goes: its first page. */
  href: string;
  tabs: Array<Pick<AiTab, "href" | "label">>;
};

/**
 * The AI Center's menu for these pages at this address: the groups that have a
 * page for this person (each going to its first page), the group the current page
 * is in, and the current page (a page under a tab, like a skill, is that tab's).
 */
export function aiNavigation(
  tabs: ReadonlyArray<Pick<AiTab, "href" | "label" | "group">>,
  pathname: string,
): { groups: AiNavGroup[]; active: AiNavGroup | null; current: string | undefined } {
  const groups = AI_GROUPS.flatMap((g) => {
    const mine = tabs.filter((t) => t.group === g.id).map(({ href, label }) => ({ href, label }));
    return mine.length ? [{ id: g.id, label: g.label, href: mine[0]!.href, tabs: mine }] : [];
  });
  const current = activeTabHref(
    pathname,
    tabs.map((t) => t.href),
  );
  const active = groups.find((g) => g.tabs.some((t) => t.href === current)) ?? null;
  return { groups, active, current };
}
