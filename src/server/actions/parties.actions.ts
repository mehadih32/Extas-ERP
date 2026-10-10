"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as buyer360 from "@/modules/parties/buyer-360.service";
import * as campaigns from "@/modules/parties/campaign.service";
import * as dormant from "@/modules/parties/dormant.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as screens from "@/modules/parties/screens.service";
import * as supplier360 from "@/modules/parties/supplier-360.service";

/*
 * Buyers & Suppliers Server Actions. Each returns { ok: true, data } or
 * { ok: false, error }.
 *   parties.view            profiles (with a buyer's or supplier's 360° view), lists,
 *                           dormant buyer filter
 *   parties.manage          create / edit, grade, Blue Verified badge, status
 *   parties.ledger.view     statements, receivables & payables overview
 *   accounts.manage         opening balances (posts a journal entry)
 *   sales.campaigns.manage  re-engagement campaigns
 * Changes refresh the screens, so lists, profiles and balances show them straight away.
 */

const view = () => requirePermission("parties.view");
const manage = () => requirePermission("parties.manage");
const ledgerView = () => requirePermission("parties.ledger.view");
const campaignsManage = () => requirePermission("sales.campaigns.manage");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

// --- Screens ---------------------------------------------------------------------
export const getPartyListAction = async (query: unknown) =>
  runAction(async () => screens.getPartyList(await view(), query));
export const listPartyRowsAction = async (query: unknown) =>
  runAction(async () => screens.listPartyRows(await view(), query));
export const getPartyScreenAction = async (partyId: string) =>
  runAction(async () => screens.getPartyScreen(await view(), partyId));
/** A buyer's 360° view: figures, gross profit and history, as far as this person may see. */
export const getBuyer360Action = async (partyId: string, options?: buyer360.Buyer360Options) =>
  runAction(async () => buyer360.getBuyer360(await view(), partyId, options));
/** A supplier's 360° view: dues, projects, deliveries and history, as far as this person may see. */
export const getSupplier360Action = async (
  partyId: string,
  options?: supplier360.Supplier360Options,
) => runAction(async () => supplier360.getSupplier360(await view(), partyId, options));
export const getPartyFormAction = async (partyId?: string) =>
  runAction(async () => screens.getPartyForm(await manage(), partyId));
export const getStatementScreenAction = async (
  partyId: string,
  range: { from?: string; to?: string },
) => runAction(async () => screens.getStatementScreen(await ledgerView(), partyId, range));
export const getDuesScreenAction = async () =>
  runAction(async () => screens.getDuesScreen(await ledgerView()));

// --- Profiles --------------------------------------------------------------------
export const listPartiesAction = async (query: unknown) =>
  runAction(async () => parties.listParties(await view(), query));
export const getPartyProfileAction = async (partyId: string) =>
  runAction(async () => parties.getPartyProfile(await view(), partyId));
export const createPartyAction = async (input: unknown) =>
  change(async () => parties.createParty(await manage(), input, await getRequestMeta()));
export const updatePartyAction = async (partyId: string, input: unknown) =>
  change(async () => parties.updateParty(await manage(), partyId, input, await getRequestMeta()));
export const setPartyGradeAction = async (partyId: string, input: unknown) =>
  change(async () => parties.setPartyGrade(await manage(), partyId, input, await getRequestMeta()));
export const setPartyVerifiedAction = async (partyId: string, input: unknown) =>
  change(async () =>
    parties.setPartyVerified(await manage(), partyId, input, await getRequestMeta()),
  );
export const changePartyStatusAction = async (partyId: string, input: unknown) =>
  change(async () =>
    parties.changePartyStatus(await manage(), partyId, input, await getRequestMeta()),
  );

// --- Ledger ----------------------------------------------------------------------
export const getPartyStatementAction = async (partyId: string, query: unknown) =>
  runAction(async () => ledger.getStatement(await ledgerView(), partyId, query));
export const getReceivablesPayablesAction = async () =>
  runAction(async () => ledger.getReceivablesPayables(await ledgerView()));
export const setOpeningBalanceAction = async (partyId: string, input: unknown) =>
  change(async () =>
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
  change(async () => dormant.refreshPartyStatuses(await manage(), await getRequestMeta()));

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
