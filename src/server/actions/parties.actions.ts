"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as campaigns from "@/modules/parties/campaign.service";
import * as dormant from "@/modules/parties/dormant.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";

/*
 * Buyers & Suppliers Server Actions. Each returns { ok: true, data } or
 * { ok: false, error }.
 *   parties.view            profiles, lists, dormant buyer filter
 *   parties.manage          create / edit, grade, Blue Verified badge, status
 *   parties.ledger.view     statements, receivables & payables overview
 *   accounts.manage         opening balances (posts a journal entry)
 *   sales.campaigns.manage  re-engagement campaigns
 */

const view = () => requirePermission("parties.view");
const manage = () => requirePermission("parties.manage");
const ledgerView = () => requirePermission("parties.ledger.view");
const campaignsManage = () => requirePermission("sales.campaigns.manage");

// --- Profiles --------------------------------------------------------------------
export const listPartiesAction = async (query: unknown) =>
  runAction(async () => parties.listParties(await view(), query));
export const getPartyProfileAction = async (partyId: string) =>
  runAction(async () => parties.getPartyProfile(await view(), partyId));
export const createPartyAction = async (input: unknown) =>
  runAction(async () => parties.createParty(await manage(), input, await getRequestMeta()));
export const updatePartyAction = async (partyId: string, input: unknown) =>
  runAction(async () =>
    parties.updateParty(await manage(), partyId, input, await getRequestMeta()),
  );
export const setPartyGradeAction = async (partyId: string, input: unknown) =>
  runAction(async () =>
    parties.setPartyGrade(await manage(), partyId, input, await getRequestMeta()),
  );
export const setPartyVerifiedAction = async (partyId: string, input: unknown) =>
  runAction(async () =>
    parties.setPartyVerified(await manage(), partyId, input, await getRequestMeta()),
  );
export const changePartyStatusAction = async (partyId: string, input: unknown) =>
  runAction(async () =>
    parties.changePartyStatus(await manage(), partyId, input, await getRequestMeta()),
  );

// --- Ledger ----------------------------------------------------------------------
export const getPartyStatementAction = async (partyId: string, query: unknown) =>
  runAction(async () => ledger.getStatement(await ledgerView(), partyId, query));
export const getReceivablesPayablesAction = async () =>
  runAction(async () => ledger.getReceivablesPayables(await ledgerView()));
export const setOpeningBalanceAction = async (partyId: string, input: unknown) =>
  runAction(async () =>
    ledger.setOpeningBalance(
      await requirePermission("accounts.manage"),
      partyId,
      input,
      await getRequestMeta(),
    ),
  );

// --- Dormant buyers --------------------------------------------------------------
export const listDormantBuyersAction = async (query: unknown) =>
  runAction(async () => dormant.listDormantBuyers(await view(), query));
export const refreshPartyStatusesAction = async () =>
  runAction(async () => dormant.refreshPartyStatuses(await manage(), await getRequestMeta()));

// --- Re-engagement campaigns -----------------------------------------------------
export const listCampaignsAction = async () =>
  runAction(async () => campaigns.listCampaigns(await campaignsManage()));
export const getCampaignAction = async (campaignId: string) =>
  runAction(async () => campaigns.getCampaign(await campaignsManage(), campaignId));
export const createCampaignAction = async (input: unknown) =>
  runAction(async () =>
    campaigns.createCampaign(await campaignsManage(), input, await getRequestMeta()),
  );
export const updateCampaignRecipientAction = async (
  campaignId: string,
  recipientId: string,
  input: unknown,
) =>
  runAction(async () =>
    campaigns.updateRecipientStatus(await campaignsManage(), campaignId, recipientId, input),
  );
export const completeCampaignAction = async (campaignId: string) =>
  runAction(async () =>
    campaigns.completeCampaign(await campaignsManage(), campaignId, await getRequestMeta()),
  );
export const cancelCampaignAction = async (campaignId: string) =>
  runAction(async () =>
    campaigns.cancelCampaign(await campaignsManage(), campaignId, await getRequestMeta()),
  );
