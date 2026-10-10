import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { HELP_ICONS } from "@/components/help/labels";
import { NAV_ITEMS } from "@/components/shell/nav-items";
import {
  articleLink,
  articleOpen,
  findHelpArticle,
  HELP_SECTIONS,
  helpSearchEntries,
  sectionOpen,
} from "@/modules/help";
import { missingFeaturePrompt, PROMPT_HEADING, quotedSearch } from "@/modules/help/prompt";
import { normalizeHelpText, searchHelp, searchWords } from "@/modules/help/search";
import { DEFAULT_ROLE_PERMISSIONS, isPermissionKey } from "@/modules/rbac/permissions";

/*
 * The Help Center's manual and search. The manual must keep up with the app:
 * these tests fail when a page has no guide, a guide points at a page that is
 * gone, or a guide quotes a button or field the app no longer shows. So
 * whenever a feature is added, changed or removed, its Bengali guide in
 * src/modules/help/content changes in the same pull request.
 */

const SRC = join(process.cwd(), "src");
const CONTENT = join(SRC, "modules", "help", "content");

function filesUnder(dir: string, match: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, match);
    return match(path) ? [path] : [];
  });
}

const articles = HELP_SECTIONS.flatMap((section) =>
  section.articles.map((article) => ({ section, article })),
);
const permissionsOf = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS) => [
  ...DEFAULT_ROLE_PERMISSIONS[role],
];
const BENGALI = /[ঀ-৿]/;

describe("the manual's content", () => {
  it("has a section for every menu entry, with an icon", () => {
    const homes = [
      ...HELP_SECTIONS.map((s) => s.href),
      ...articles.flatMap(({ article }) => article.routes),
    ];
    for (const item of NAV_ITEMS) expect(homes, item.label).toContain(item.href);
    for (const section of HELP_SECTIONS) expect(HELP_ICONS[section.id], section.id).toBeDefined();
  });

  it("keeps section ids, guide slugs and screenshot ids unique", () => {
    const ids = HELP_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const slugs = articles.map(({ article }) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const images = articles.flatMap(({ article }) =>
      article.steps.flatMap((step) => (step.image ? [step.image] : [])),
    );
    expect(new Set(images.map((i) => i.id)).size).toBe(images.length);
    for (const { article } of articles) {
      for (const step of article.steps) {
        if (step.image)
          expect(step.image.id.startsWith(`${article.slug}-`), step.image.id).toBe(true);
      }
    }
  });

  it("writes every guide in Bengali, with steps, a summary and search words", () => {
    for (const section of HELP_SECTIONS) {
      expect(section.title, section.id).toMatch(BENGALI);
      expect(section.description, section.id).toMatch(BENGALI);
      expect(section.articles.length, section.id).toBeGreaterThan(0);
    }
    for (const { article } of articles) {
      expect(article.slug).toMatch(/^[a-z0-9-]+$/);
      expect(article.title, article.slug).toMatch(BENGALI);
      expect(article.summary, article.slug).toMatch(BENGALI);
      expect(article.steps.length, article.slug).toBeGreaterThan(0);
      for (const step of article.steps) expect(step.text, article.slug).toMatch(BENGALI);
      for (const tip of article.tips ?? []) expect(tip, article.slug).toMatch(BENGALI);
      expect(article.keywords.length, article.slug).toBeGreaterThanOrEqual(4);
      for (const keyword of article.keywords) {
        expect(keyword, article.slug).toBe(keyword.toLowerCase());
      }
      for (const key of article.anyOf ?? []) expect(isPermissionKey(key), key).toBe(true);
      for (const step of article.steps) {
        if (step.image) expect(step.image.caption, step.image.id).toMatch(BENGALI);
      }
    }
  });

  // The app's pages, as route patterns: ["sales", "orders", "[orderId]"].
  const pages = [join(SRC, "app", "(app)"), join(SRC, "app", "(auth)")].flatMap((group) =>
    filesUnder(group, (path) => path.endsWith(`${sep}page.tsx`)).map((path) =>
      relative(group, path).split(sep).slice(0, -1),
    ),
  );
  const segments = (route: string) => route.split("/").filter(Boolean);
  /** A guide's route covers a page when it is the page or a page above it ([id] matches anything). */
  const covers = (route: string, page: string[]) => {
    const parts = segments(route);
    if (parts.length === 0) return page.length === 0;
    return (
      parts.length <= page.length &&
      parts.every((part, i) => page[i]!.startsWith("[") || page[i] === part)
    );
  };
  const show = (page: string[]) => `/${page.join("/")}`;

  it("has a guide for every page of the app", () => {
    const routes = articles.flatMap(({ article }) => article.routes);
    const sectionHomes = HELP_SECTIONS.flatMap((s) => (s.href ? [s.href] : []));
    const uncovered = pages
      .filter((page) => !routes.some((route) => covers(route, page)))
      // A section's home page that only forwards to its first tab.
      .filter((page) => !sectionHomes.includes(show(page)))
      // Signed in, the sign-in page forwards to the app; its guide has no page to open.
      .filter(
        (page) => !(show(page) === "/sign-in" && findHelpArticle("getting-started", "sign-in")),
      )
      .map(show);
    expect(uncovered).toEqual([]);
  });

  it("points every guide at pages that exist", () => {
    for (const { article } of articles) {
      for (const route of article.routes) {
        expect(
          pages.some((page) => page.length >= segments(route).length && covers(route, page)),
          `${article.slug}: ${route}`,
        ).toBe(true);
      }
    }
  });

  it("quotes only buttons, fields and labels the app shows", () => {
    // Everything the screens say, with JSX entities and line breaks evened out.
    const app = filesUnder(SRC, (path) => /\.tsx?$/.test(path) && !path.startsWith(CONTENT))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n")
      .replaceAll("&apos;", "'")
      .replaceAll("&amp;", "&")
      .replace(/\s+/g, " ");
    // Examples the guides make up, and labels the screens build from parts.
    const composed = new Set([
      "HR Manager",
      "Store Keeper",
      "Move to Sewing",
      "Add the buyer",
      "Add the supplier",
      "Saved. You are using the Modern look.",
    ]);
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const missing: string[] = [];
    for (const file of filesUnder(CONTENT, (path) => path.endsWith(".ts"))) {
      for (const [, quoted] of readFileSync(file, "utf8").matchAll(/“([^”]+)”/g)) {
        if (!/[A-Za-z]/.test(quoted!) || BENGALI.test(quoted!) || composed.has(quoted!)) continue;
        // "…" stands for a name the screen fills in ("Move to …").
        const pattern = new RegExp(quoted!.split("…").map(escape).join(".{1,80}?"));
        if (!pattern.test(app)) missing.push(`${relative(CONTENT, file)}: ${quoted}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("writes Bengali as it is, not as \\u escapes", () => {
    for (const file of filesUnder(CONTENT, (path) => path.endsWith(".ts"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    }
  });
});

describe("who each guide is for", () => {
  const find = (section: string, slug: string) => findHelpArticle(section, slug)!.article;

  it("follows the menu: a guide is open when the role opens its page", () => {
    const employee = permissionsOf("EMPLOYEE");
    const sales = permissionsOf("SALES_EXECUTIVE");
    const salesSection = HELP_SECTIONS.find((s) => s.id === "sales")!;
    expect(sectionOpen(salesSection, sales)).toBe(true);
    expect(sectionOpen(salesSection, employee)).toBe(false);
    expect(articleOpen(find("sales", "sales-new-order"), sales)).toBe(true);
    expect(articleOpen(find("sales", "sales-new-order"), employee)).toBe(false);
  });

  it("keeps money guides to the people who move money", () => {
    const receive = find("sales", "sales-receive-payment");
    expect(articleOpen(receive, permissionsOf("SALES_EXECUTIVE"))).toBe(false);
    expect(articleOpen(receive, permissionsOf("ACCOUNTS"))).toBe(true);
    expect(articleOpen(receive, permissionsOf("SUPER_ADMIN"))).toBe(true);
  });

  it("opens everyone's own guides to everyone", () => {
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as Array<
      keyof typeof DEFAULT_ROLE_PERMISSIONS
    >) {
      const permissions = permissionsOf(role);
      const appearance = find("getting-started", "appearance");
      expect(articleOpen(appearance, permissions), role).toBe(true);
      expect(articleLink(appearance, permissions), role).toBe("/settings/appearance");
      expect(articleOpen(find("getting-started", "inbox"), permissions), role).toBe(true);
      expect(articleOpen(find("help-center", "help-missing-feature"), permissions), role).toBe(
        true,
      );
    }
  });

  it("links a guide to a page only when the role opens it", () => {
    const employee = permissionsOf("EMPLOYEE");
    expect(articleLink(find("hr", "hr-payroll-prepare"), employee)).toBeNull();
    expect(articleLink(find("hr", "hr-payroll-prepare"), permissionsOf("ACCOUNTS"))).toBe(
      "/hr/payroll",
    );
    expect(articleLink(find("my-hr", "my-hr-leave"), employee)).toBe("/me/leave");
  });

  it("lists every guide in the search for everyone, marking the ones their role does not open", () => {
    const employee = helpSearchEntries(permissionsOf("EMPLOYEE"));
    const owner = helpSearchEntries(permissionsOf("SUPER_ADMIN"));
    expect(employee).toHaveLength(articles.length);
    expect(owner).toHaveLength(articles.length);
    expect(employee.some((e) => !e.open)).toBe(true);
    expect(employee.find((e) => e.slug === "my-hr-payslips")!.open).toBe(true);
  });
});

describe("the search", () => {
  const entries = helpSearchEntries(permissionsOf("SUPER_ADMIN"));
  const top = (query: string) => searchHelp(entries, query)[0]?.slug;

  it("finds guides by their Bengali and English words", () => {
    expect(top("কোটেশন")).toBe("sales-quotation");
    expect(top("quotation")).toBe("sales-quotation");
    expect(top("পে-স্লিপ")).toMatch(/payslip/);
    expect(top("stock count")).toBe("products-stock-count");
    expect(top("Appearance")).toBe("appearance");
    expect(searchHelp(entries, "বেতন").length).toBeGreaterThan(1);
  });

  it("needs every word to match, and finds nothing for an empty search", () => {
    expect(searchHelp(entries, "")).toEqual([]);
    expect(searchHelp(entries, "   ")).toEqual([]);
    expect(searchHelp(entries, "quotation zzzqqq")).toEqual([]);
    expect(searchHelp(entries, "cryptocurrency mining")).toEqual([]);
  });

  it("ignores case, punctuation and the joiners that only change how Bengali looks", () => {
    expect(normalizeHelpText("  Stock-Count!  ")).toBe("stock count");
    expect(normalizeHelpText("র\u200d্যাক")).toBe(normalizeHelpText("র্যাক"));
    expect(searchWords("Invoice, invoice; INVOICE")).toEqual(["invoice"]);
    expect(top("INVOICE")).toBe(top("invoice"));
  });
});

describe("the prompt for a missing feature", () => {
  const prompt = missingFeaturePrompt({
    query: "  WhatsApp   payment reminders ",
    roleName: "Sales Executive",
    companyName: "Extas Apparel",
    day: "2026-10-10",
  });

  it("starts with the line for the admin and quotes the search", () => {
    expect(prompt.split("\n")[0]).toBe(PROMPT_HEADING);
    expect(PROMPT_HEADING).toBe("Admin: Copy this prompt to Claude to build this feature.");
    expect(prompt).toContain('"WhatsApp payment reminders"');
    expect(prompt).toContain("Sales Executive role at Extas Apparel");
    expect(prompt).toContain("2026-10-10");
  });

  it("asks Claude to keep data safe and the Bengali manual up to date", () => {
    expect(prompt).toMatch(/Do not break, overwrite or corrupt any existing data/);
    expect(prompt).toMatch(/Bengali Help Center/);
    expect(prompt).not.toMatch(BENGALI);
  });

  it("keeps a long search to one line of 200 characters", () => {
    expect(quotedSearch("a\nb\tc")).toBe("a b c");
    const long = quotedSearch("x".repeat(500));
    expect(long).toHaveLength(200);
    expect(long.endsWith("…")).toBe(true);
  });
});
