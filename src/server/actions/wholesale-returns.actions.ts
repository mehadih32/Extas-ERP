"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireCompany } from "@/modules/auth/context";
import * as wr from "@/modules/sales/wholesale-return.service";

/*
 * Sales > Wholesale returns (2026-11-12): receive, approve and QC. Who may do
 * each step is checked in the service (sales.order.create or Accounts to receive,
 * sales.returns.approve to approve, sales.returns.qc for the QC).
 */

const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

export const listWholesaleReturnsAction = async (query: unknown = {}) =>
  runAction(async () => wr.listWholesaleReturns(await requireCompany(), query));

export const getWholesaleReturnAction = async (id: string) =>
  runAction(async () => wr.getWholesaleReturn(await requireCompany(), id));

export const findInvoicesForReturnAction = async (search: string) =>
  runAction(async () => wr.findInvoicesForReturn(await requireCompany(), search));

export const wholesaleReturnFormAction = async (invoiceId: string) =>
  runAction(async () => wr.wholesaleReturnForm(await requireCompany(), invoiceId));

export const searchExchangeSkusAction = async (search: string) =>
  runAction(async () => wr.searchExchangeSkus(await requireCompany(), search));

export const exchangeQuoteAction = async (input: unknown) =>
  runAction(async () => wr.exchangeQuote(await requireCompany(), input));

export const receiveWholesaleReturnAction = async (input: unknown) =>
  change(async () => {
    const r = await wr.receiveWholesaleReturn(
      await requireCompany(),
      input,
      await getRequestMeta(),
    );
    return { id: r.id, number: r.number };
  });

export const approveWholesaleReturnAction = async (id: string, input: unknown) =>
  change(async () => {
    await wr.approveWholesaleReturn(await requireCompany(), id, input, await getRequestMeta());
    return null;
  });

export const checkWholesaleReturnAction = async (id: string, input: unknown) =>
  change(async () => {
    await wr.checkWholesaleReturn(await requireCompany(), id, input, await getRequestMeta());
    return null;
  });

export const setWholesaleReturnSettingsAction = async (input: unknown) =>
  change(async () => {
    await wr.setWholesaleReturnSettings(await requireCompany(), input, await getRequestMeta());
    return null;
  });
