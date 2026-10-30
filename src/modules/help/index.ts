import { ACCOUNTS_TABS } from "@/components/accounts/tabs";
import { AI_TABS } from "@/components/ai/tabs";
import { HR_TABS } from "@/components/hr/tabs";
import { MATERIALS_TABS } from "@/components/materials/tabs";
import { PARTIES_TABS } from "@/components/parties/tabs";
import { PLANNER_TABS } from "@/components/planner/tabs";
import { PRODUCTION_TABS } from "@/components/production/tabs";
import { PRODUCTS_TABS } from "@/components/products/tabs";
import { REPORTS_TABS } from "@/components/reports/tabs";
import { SALES_TABS } from "@/components/sales/tabs";
import { SETTINGS_TABS } from "@/components/settings/tabs";
import { holdsAny, isActivePath, NAV_ITEMS, type NavItem } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

import { accountsHelp } from "./content/accounts";
import { aiHelp } from "./content/ai";
import { complianceHelp } from "./content/compliance";
import { businessHelp } from "./content/business";
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
import { techPackHelp } from "./content/tech-pack";
import { helpSearchEntry, type HelpSearchEntry } from "./search";
import type { HelpArticle, HelpSection } from "./types";

/** The manual, in the menu's order: first steps, every section, then the Help Center itself. */
export const HELP_SECTIONS: readonly HelpSection[] = [
  gettingStartedHelp,
  dashboardHelp,
  businessHelp,
  salesHelp,
  productionHelp,
  techPackHelp,
  accountsHelp,
  productsHelp,
  materialsHelp,
  partiesHelp,
  hrHelp,
  reportsHelp,
  plannerHelp,
  complianceHelp,
  myHrHelp,
  aiHelp,
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

/** A section's tab: who opens it (the same check as the section's tab bar). */
type PageTab = {
  href: string;
  anyOf: readonly PermissionKey[];
  /** ...and, when given, any of these too. */
  andAnyOf?: readonly PermissionKey[];
  /** Only the platform owner opens it (Server Health, Full check, Bug Guard, Backups). */
  platformOwner?: boolean;
};

const PAGE_TABS: readonly PageTab[] = [
  ACCOUNTS_TABS,
  AI_TABS,
  HR_TABS,
  MATERIALS_TABS,
  PARTIES_TABS,
  PLANNER_TABS,
  PRODUCTION_TABS,
  PRODUCTS_TABS,
  REPORTS_TABS,
  SALES_TABS,
  SETTINGS_TABS,
].flat();

const MENU_ROOTS = new Set(NAV_ITEMS.map((item) => item.href));

/**
 * The tab a page is under: the longest tab address it sits under. A section's
 * first tab ("Overview" at "/production") is only its own page, not the
 * section's other pages, which its menu entry covers.
 */
function tabFor(route: string): PageTab | undefined {
  return PAGE_TABS.filter(
    (tab) => route === tab.href || (!MENU_ROOTS.has(tab.href) && isActivePath(route, tab.href)),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}

/**
 * Whether this person opens a page: by its tab when it has one (the tab bar's
 * own check, which the page's actions follow), else by its menu entry (pages
 * outside the menu are open to all). v6.4.1 C6: the menu entry alone let some
 * guides say "open" for pages whose tab the person could not open.
 */
function routeOpen(route: string, permissions: readonly string[], platformOwner = false): boolean {
  const tab = tabFor(route);
  if (tab) {
    return (
      holdsAny(permissions, tab.anyOf) &&
      (!tab.andAnyOf || holdsAny(permissions, tab.andAnyOf)) &&
      (!tab.platformOwner || platformOwner)
    );
  }
  const entry = menuEntryFor(route);
  return !entry || holdsAny(permissions, entry.anyOf);
}

/** Whether only the platform owner opens a page. */
const ownerOnly = (route: string) => tabFor(route)?.platformOwner === true;

/** Whether the person's role opens the section's part of the app (its menu entry). */
export function sectionOpen(section: HelpSection, permissions: readonly string[]): boolean {
  if (section.href === null) return true;
  const entry = menuEntryFor(section.href);
  return !entry || holdsAny(permissions, entry.anyOf);
}

/**
 * Whether a guide is shown to this person at all. Everyone may read every
 * guide (those about pages their role does not open say so), except the guides
 * of the pages only the platform owner opens (Bug Guard, Full check, Server
 * Health, Backups): those are shown only to the platform owner (v6.4.1 C6).
 */
export function articleShown(
  article: HelpArticle,
  _permissions: readonly string[],
  platformOwner = false,
): boolean {
  return platformOwner || article.routes.length === 0 || !article.routes.every(ownerOnly);
}

/**
 * Whether the person opens the pages a guide is about: its own `anyOf` when
 * it has one, and one of its pages that the person opens.
 */
export function articleOpen(
  article: HelpArticle,
  permissions: readonly string[],
  platformOwner = false,
): boolean {
  if (!articleShown(article, permissions, platformOwner)) return false;
  if (article.anyOf && !holdsAny(permissions, article.anyOf)) return false;
  return (
    article.routes.length === 0 ||
    article.routes.some((r) => routeOpen(r, permissions, platformOwner))
  );
}

/** A section's guides this person is shown (articleShown), in order. */
export function shownArticles(
  section: HelpSection,
  permissions: readonly string[],
  platformOwner = false,
): HelpArticle[] {
  return section.articles.filter((a) => articleShown(a, permissions, platformOwner));
}

/**
 * The list a page of one record is opened from: its address up to the first part that
 * names the record ("/production/projects/[projectId]/tech-pack" is opened from
 * "/production/projects").
 */
export function listPageOf(route: string): string {
  const at = route.indexOf("/[");
  return at < 0 ? route : route.slice(0, at) || "/";
}

/** Where a guide's button goes; `pick`: to the list, to pick the order or record first. */
export type ArticleLink = { href: string; pick: boolean };

/**
 * The page of a guide this person may open, to link to from the guide: its first page
 * that needs no record picked, else the list the first record page is opened from (a
 * link to "/production/projects/[projectId]" itself would open "Page not found").
 */
export function articleLink(
  article: HelpArticle,
  permissions: readonly string[],
  platformOwner = false,
): ArticleLink | null {
  if (!articleShown(article, permissions, platformOwner)) return null;
  if (article.anyOf && !holdsAny(permissions, article.anyOf)) return null;
  const open = article.routes.filter((r) => routeOpen(r, permissions, platformOwner));
  const direct = open.find((r) => !r.includes("["));
  if (direct) return { href: direct, pick: false };
  return open[0] ? { href: listPageOf(open[0]), pick: true } : null;
}

/** Every guide this person is shown, flattened for the search box, marked open or not. */
export function helpSearchEntries(
  permissions: readonly string[],
  platformOwner = false,
): HelpSearchEntry[] {
  return HELP_SECTIONS.flatMap((section) =>
    shownArticles(section, permissions, platformOwner).map((article) =>
      helpSearchEntry(section, article, articleOpen(article, permissions, platformOwner)),
    ),
  );
}
