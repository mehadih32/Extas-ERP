/*
 * The AI's own sign-in address in each company: ai-<companyId>@ai.invalid.
 * ".invalid" can never receive mail, so no person owns such an address, and
 * the ERP never lets anyone add, invite or take over an account at it.
 */

export const AI_EMAIL_DOMAIN = "ai.invalid";

export const aiEmail = (companyId: string) => `ai-${companyId}@${AI_EMAIL_DOMAIN}`;

/** Whether an address is kept for the AI's accounts. */
export const isAiAddress = (email: string) =>
  email.trim().toLowerCase().endsWith(`@${AI_EMAIL_DOMAIN}`);

export const AI_ADDRESS_TEXT =
  "This address is kept for the AI's own account: use a person's email.";
