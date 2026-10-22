/*
 * Each e-commerce integration's own account: shop-<integrationId>@shop.invalid.
 * ".invalid" can never receive mail, so no person owns such an address, and
 * the ERP never lets anyone add, invite or take over an account at it.
 */

export const SHOP_EMAIL_DOMAIN = "shop.invalid";

export const shopEmail = (integrationId: string) => `shop-${integrationId}@${SHOP_EMAIL_DOMAIN}`;

/** Whether an address is kept for the shops' accounts. */
export const isShopAddress = (email: string) =>
  email.trim().toLowerCase().endsWith(`@${SHOP_EMAIL_DOMAIN}`);

export const SHOP_ADDRESS_TEXT =
  "This address is kept for an online shop's own account: use a person's email.";
