import { holdsAny, isActivePath, NAV_ITEMS, type NavItem } from "@/components/shell/nav-items";

import { accountsHelp } from "./content/accounts";
import { complianceHelp } from "./content/compliance";
import { dashboardHelp } from "./content/dashboard";
import { gettingStartedHelp } from "./content/getting-started";
import { helpCenterHelp } from "./content/help-center";
import { hrHelp } from "./content/hr";
import { materialsHelp } from "./content/materials";
import { myHrHelp } from "./content/my-hr";
import { partiesHelp } from "./content/parties";
import { plannerHelp } from "./content/planner";
import { productionHelp } from "./content/production";
import { productsHelp } from "./content/products";
import { reportsHelp } from "./content/reports";
import { salesHelp } from "./content/sales";
import { settingsHelp } from "./content/settings";
import { helpSearchEntry, type HelpSearchEntry } from "./search";
import type { HelpArticle, HelpSection } from "./types";

/** The manual, in the menu's order: first steps, every section, then the Help Center itself. */
export const HELP_SECTIONS: readonly HelpSection[] = [
  gettingStartedHelp,
  dashboardHelp,
  salesHelp,
  productionHelp,
  accountsHelp,
  productsHelp,
  materialsHelp,
  partiesHelp,
  hrHelp,
  reportsHelp,
  plannerHelp,
  complianceHelp,
  myHrHelp,
  settingsHelp,
  helpCenterHelp,
];

export function findHelpSection(id: string): HelpSection | undefined {
  return HELP_SECTIONS.find((section) => section.id === id);
}

export function findHelpArticle(
  sectionId: string,
  slug: string,
): { section: HelpSection; article: HelpArticle } | undefined {
  const section = findHelpSection(sectionId);
  const article = section?.articles.find((a) => a.slug === slug);
  return section && article ? { section, article } : undefined;
}

/** The menu entry a page belongs to: the longest menu address it sits under. */
export function menuEntryFor(route: string): NavItem | undefined {
  return NAV_ITEMS.filter((item) => isActivePath(route, item.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}

/** Whether this person's role opens a page (pages outside the menu are open to all). */
function routeOpen(route: string, permissions: readonly string[]): boolean {
  const entry = menuEntryFor(route);
  return !entry || holdsAny(permissions, entry.anyOf);
}

/** Whether the person's role opens the section's part of the app. */
export function sectionOpen(section: HelpSection, permissions: readonly string[]): boolean {
  return section.href === null || routeOpen(section.href, permissions);
}

/** Whether the person's role opens the pages a guide is about. */
export function articleOpen(article: HelpArticle, permissions: readonly string[]): boolean {
  if (article.anyOf) return holdsAny(permissions, article.anyOf);
  return article.routes.length === 0 || article.routes.some((r) => routeOpen(r, permissions));
}

/** The first page of a guide this person may open, to link to from the guide. */
export function articleLink(article: HelpArticle, permissions: readonly string[]): string | null {
  if (article.anyOf && !holdsAny(permissions, article.anyOf)) return null;
  return article.routes.find((r) => article.anyOf || routeOpen(r, permissions)) ?? null;
}

/** Every guide, flattened for the search box, marked open or not for this person. */
export function helpSearchEntries(permissions: readonly string[]): HelpSearchEntry[] {
  return HELP_SECTIONS.flatMap((section) =>
    section.articles.map((article) =>
      helpSearchEntry(section, article, articleOpen(article, permissions)),
    ),
  );
}
