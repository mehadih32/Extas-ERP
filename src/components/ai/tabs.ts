import { holdsAny } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

export type AiTab = { href: string; label: string; anyOf: readonly PermissionKey[] };

/*
 * The AI Center's tabs. Everything is read with ai.view or ai.manage (the
 * owner, by default); changing anything, and the Settings tab with the key and
 * the PIN, needs ai.manage. The AI itself holds neither.
 */
export const AI_KEYS: readonly PermissionKey[] = ["ai.view", "ai.manage"];

export const AI_TABS: readonly AiTab[] = [
  { href: "/ai", label: "AI Home", anyOf: AI_KEYS },
  { href: "/ai/mehedi", label: "Mehedi 2.0", anyOf: AI_KEYS },
  { href: "/ai/chat", label: "Chat", anyOf: ["ai.manage"] },
  { href: "/ai/drafts", label: "Drafts", anyOf: AI_KEYS },
  { href: "/ai/control", label: "Control", anyOf: AI_KEYS },
  { href: "/ai/costs", label: "Budget & Costs", anyOf: AI_KEYS },
  { href: "/ai/models", label: "Models", anyOf: AI_KEYS },
  { href: "/ai/knowledge", label: "Books & tests", anyOf: AI_KEYS },
  { href: "/ai/logs", label: "Logs", anyOf: AI_KEYS },
  { href: "/ai/bot", label: "Bot", anyOf: ["ai.manage"] },
  { href: "/ai/settings", label: "Settings", anyOf: ["ai.manage"] },
];

/** The tabs this person may open, in order. */
export function visibleAiTabs(permissions: Iterable<string>): AiTab[] {
  const held = [...permissions];
  return AI_TABS.filter((tab) => holdsAny(held, tab.anyOf));
}
