import type { PaymentMethod, SalesChannel } from "@prisma/client";

/*
 * Choices the Sales screens offer, shared by the server and the browser.
 * Integrations come last: website orders arrive with the website link, and
 * courier cash-on-delivery with the courier link, so neither is offered by hand.
 */

/** Payment methods offered by hand. */
export const RECEIVE_METHODS: readonly PaymentMethod[] = [
  "CASH",
  "BANK_TRANSFER",
  "CHEQUE",
  "BKASH",
  "NAGAD",
  "ROCKET",
  "CARD",
  "OTHER",
];

/** Channels an order is taken in by hand (B2B pre-orders come from a proforma invoice). */
export const ORDER_CHANNELS: readonly SalesChannel[] = ["WHOLESALE", "POS", "SOCIAL_COMMERCE"];
