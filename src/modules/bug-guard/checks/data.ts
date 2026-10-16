import type { Check } from "../types";
import { LEDGER_CHECKS } from "./data-ledger";
import { LINK_CHECKS } from "./data-links";
import { MONEY_CHECKS } from "./data-money";
import { POSTING_CHECKS } from "./data-posting";
import { STOCK_CHECKS } from "./data-stock";
import { TOTALS_CHECKS } from "./data-totals";

/*
 * Bug Guard's data and accounts checks (the owner's 2b): the books, every
 * document's posting, stock, stored totals, money and links. Each only reads,
 * filters by its company and reports at most 20 findings.
 */
export const DATA_CHECKS: Check[] = [
  ...LEDGER_CHECKS,
  ...POSTING_CHECKS,
  ...STOCK_CHECKS,
  ...TOTALS_CHECKS,
  ...MONEY_CHECKS,
  ...LINK_CHECKS,
];
