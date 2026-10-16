import pictures from "./pictures.json";

/*
 * The guides' automatic pictures (`npm run help:shots`): one per guide, taken on
 * the demo site's sample data, with a numbered mark on the button or field each
 * step is about. public/help/shots/<slug>.webp is the picture; pictures.json says
 * which steps are marked on it and what it was taken from, so the test knows
 * when a screen changed and its picture is old.
 */

export type HelpPicture = {
  /** "/help/shots/sales-quotation.webp" */
  src: string;
  width: number;
  height: number;
  /** The steps (from 1) with a mark on the picture. */
  marks: number[];
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
