import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * The Help Center's manual: step-by-step guides in Bengali for every part of the
 * app. Each section of the app has one file in ./content, and every feature
 * that is added, changed or removed updates its guide in the same change.
 */

/**
 * A screenshot for a step. Until the picture is added, the Help Center shows a
 * placeholder with the caption and the id, so the right screenshot can be put
 * in later (as public/help/<id>.png, then `src` set to "/help/<id>.png").
 */
export type HelpImage = {
  /** Unique across the manual: "<section>-<guide>-<n>", e.g. "sales-quotation-1". */
  id: string;
  /** Bengali: what the screenshot shows. */
  caption: string;
  /** The picture once it is added, e.g. "/help/sales-quotation-1.png". */
  src?: string;
};

export type HelpStep = {
  /** Bengali. The app's own button and field names stay in English, in quotes. */
  text: string;
  image?: HelpImage;
};

/** One task explained step by step ("How to make a quotation"). */
export type HelpArticle = {
  /** Unique, URL-safe, English: "sales-quotation". */
  slug: string;
  /** Bengali, phrased as the task: "কোটেশন তৈরি করবেন যেভাবে". */
  title: string;
  /** Bengali, one sentence on what this guide helps with. */
  summary: string;
  /**
   * Words people may search with, in lower case: English names from the app
   * ("quotation", "proforma"), Bengali words ("কোটেশন", "দরপত্র") and common
   * spellings.
   */
  keywords: string[];
  /** The app's addresses this guide covers ("/sales/quotations"). */
  routes: string[];
  /** Bengali: who can do this, by role or permission. */
  who?: string;
  /**
   * Who may open these pages, when the menu entry above them says otherwise
   * (e.g. everyone chooses their own look under Settings); [] for everyone.
   * Without it, the menu entry that holds the first matching route decides.
   */
  anyOf?: readonly PermissionKey[];
  steps: HelpStep[];
  /** Bengali: good to know, limits, common mistakes. */
  tips?: string[];
};

/** One section of the app (Sales, Production...) and its guides. */
export type HelpSection = {
  /** URL-safe, English: "sales". */
  id: string;
  /** Bengali, with the menu's English name: "বিক্রয় (Sales)". */
  title: string;
  /** Bengali, one or two sentences on what the section is for. */
  description: string;
  /**
   * The menu entry it belongs to ("/sales"), or null for guides about the whole
   * app. Who opens the section comes from that entry (components/shell/nav-items.ts).
   */
  href: string | null;
  articles: HelpArticle[];
};
