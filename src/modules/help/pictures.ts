import pictures from "./pictures.json";

/*
 * The guides' automatic pictures (`npm run help:shots`): one per guide, taken on
 * the demo site's sample data, of the part of the page the steps are about, with
 * a numbered mark on the button or field each step is about. public/help/shots/
 * <slug>.webp is the picture; pictures.json says which steps are marked on it,
 * which part of the page it shows and what it was taken from, so the tests know
 * when a screen changed and its picture is old, or a picture marks nothing.
 */

export type HelpPicture = {
  /** "/help/shots/sales-quotation.webp" */
  src: string;
  width: number;
  height: number;
  /** The steps (from 1) with a mark on the picture. */
  marks: number[];
  /** For each marked step ("2"), the label it quotes that the mark is on. */
  labels?: Record<string, string>;
  /**
   * The part of the page it shows: from `y` px down the page, `height` px tall,
   * found by the guide's target (its words), "marks" (where the most steps'
   * buttons are), or "dialog" or "menu" (the one the guide's shot opens).
   */
  clip?: { y: number; height: number; target: string };
  /** The page it was taken on ("/sales/orders/[orderId]"). */
  route: string;
  /** The screen's fingerprint when it was taken (scripts/help/screens.ts). */
  screen: string;
  /** The steps' marks when it was taken. */
  guide: string;
  /** "2026-10-16" */
  taken: string;
};

export const HELP_PICTURES: Readonly<Record<string, HelpPicture>> = pictures as Record<
  string,
  HelpPicture
>;
