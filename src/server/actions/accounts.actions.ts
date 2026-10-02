"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as assets from "@/modules/accounts/asset.service";
import * as bank from "@/modules/accounts/bank.service";
import * as capital from "@/modules/accounts/capital.service";
import * as chart from "@/modules/accounts/chart.service";
import * as reports from "@/modules/accounts/reports.service";
import * as supplierPayments from "@/modules/accounts/supplier-payment.service";
import * as vouchers from "@/modules/accounts/voucher.service";

/*
 * Accounts Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 *   accounts.view             chart, ledgers, bank statements, registers, reports
 *   accounts.manage           journal vouchers, accounts, bank accounts, assets, capital
 *   accounts.receipts.record  money in (capital and loans received, asset sale proceeds)
 *   accounts.payments.record  money out (transfers, supplier payments, installments)
 * Services check the money permissions themselves too, so no caller can skip them.
 */

const view = () => requirePermission("accounts.view");
const manage = () => requirePermission("accounts.manage");
const payOut = () => requirePermission("accounts.payments.record");
/** The "paid from / into" picker: anyone who records money. */
const moneyDesk = () =>
  requireAnyPermission("accounts.view", "accounts.receipts.record", "accounts.payments.record");

// --- Overview & reports -----------------------------------------------------------------
export const getAccountsOverviewAction = async () =>
  runAction(async () =>
    reports.getAccountsOverview(
      await requireAnyPermission("accounts.view", "dashboard.financials"),
    ),
  );
export const getProfitAndLossAction = async (query: unknown) =>
  runAction(async () => reports.getProfitAndLoss(await view(), query));
export const getBalanceSheetAction = async (query: unknown) =>
  runAction(async () => reports.getBalanceSheet(await view(), query));
export const getTrialBalanceAction = async (query: unknown) =>
  runAction(async () => reports.getTrialBalance(await view(), query));
export const getBooksCheckAction = async () =>
  runAction(async () => reports.getBooksCheck(await view()));

// --- Chart of accounts & ledgers ----------------------------------------------------------
export const listAccountsAction = async (query: unknown) =>
  runAction(async () => chart.listAccounts(await view(), query));
export const getAccountAction = async (accountId: string) =>
  runAction(async () => chart.getAccount(await view(), accountId));
export const getAccountLedgerAction = async (accountId: string, query: unknown) =>
  runAction(async () => chart.getAccountLedger(await view(), accountId, query));
export const listCashAccountsAction = async () =>
  runAction(async () => chart.listCashAccounts(await moneyDesk()));
export const createAccountAction = async (input: unknown) =>
  runAction(async () => chart.createAccount(await manage(), input, await getRequestMeta()));
export const updateAccountAction = async (accountId: string, input: unknown) =>
  runAction(async () =>
    chart.updateAccount(await manage(), accountId, input, await getRequestMeta()),
  );
export const setAccountOpeningBalanceAction = async (accountId: string, input: unknown) =>
  runAction(async () =>
    chart.setAccountOpeningBalance(await manage(), accountId, input, await getRequestMeta()),
  );

// --- Journal vouchers & transfers ---------------------------------------------------------
export const listJournalEntriesAction = async (query: unknown) =>
  runAction(async () => vouchers.listJournalEntries(await view(), query));
export const getJournalEntryAction = async (entryId: string) =>
  runAction(async () => vouchers.getJournalEntry(await view(), entryId));
export const createJournalVoucherAction = async (input: unknown) =>
  runAction(async () =>
    vouchers.createJournalVoucher(await manage(), input, await getRequestMeta()),
  );
/** Journal vouchers need accounts.manage; transfers need accounts.payments.record. */
export const reverseJournalVoucherAction = async (entryId: string, input: unknown) =>
  runAction(async () =>
    vouchers.reverseJournalVoucher(
      await requireAnyPermission("accounts.manage", "accounts.payments.record"),
      entryId,
      input,
      await getRequestMeta(),
    ),
  );
export const createTransferAction = async (input: unknown) =>
  runAction(async () => vouchers.createTransfer(await payOut(), input, await getRequestMeta()));

// --- Bank accounts & statements -------------------------------------------------------------
export const listBankAccountsAction = async (query: { includeInactive?: unknown } = {}) =>
  runAction(async () => bank.listBankAccounts(await view(), query));
export const getBankAccountAction = async (bankAccountId: string) =>
  runAction(async () => bank.getBankAccount(await view(), bankAccountId));
export const createBankAccountAction = async (input: unknown) =>
  runAction(async () => bank.createBankAccount(await manage(), input, await getRequestMeta()));
export const updateBankAccountAction = async (bankAccountId: string, input: unknown) =>
  runAction(async () =>
    bank.updateBankAccount(await manage(), bankAccountId, input, await getRequestMeta()),
  );
export const getBankStatementAction = async (bankAccountId: string, query: unknown) =>
  runAction(async () => bank.getBankStatement(await view(), bankAccountId, query));

// --- Fixed assets ----------------------------------------------------------------------------
export const listFixedAssetsAction = async (query: unknown) =>
  runAction(async () => assets.listFixedAssets(await view(), query));
export const getFixedAssetAction = async (assetId: string) =>
  runAction(async () => assets.getFixedAsset(await view(), assetId));
export const createFixedAssetAction = async (input: unknown) =>
  runAction(async () => assets.createFixedAsset(await manage(), input, await getRequestMeta()));
export const updateFixedAssetAction = async (assetId: string, input: unknown) =>
  runAction(async () =>
    assets.updateFixedAsset(await manage(), assetId, input, await getRequestMeta()),
  );
export const disposeFixedAssetAction = async (assetId: string, input: unknown) =>
  runAction(async () =>
    assets.disposeFixedAsset(await manage(), assetId, input, await getRequestMeta()),
  );
export const voidFixedAssetAction = async (assetId: string, input: unknown) =>
  runAction(async () =>
    assets.voidFixedAsset(await manage(), assetId, input, await getRequestMeta()),
  );
export const previewDepreciationAction = async (query: unknown) =>
  runAction(async () => assets.previewDepreciation(await view(), query));
export const runDepreciationAction = async (input: unknown) =>
  runAction(async () => assets.runDepreciation(await manage(), input, await getRequestMeta()));

// --- Capital, investors & loans ---------------------------------------------------------------
export const listCapitalSourcesAction = async (query: unknown) =>
  runAction(async () => capital.listCapitalSources(await view(), query));
export const getCapitalSourceAction = async (sourceId: string) =>
  runAction(async () => capital.getCapitalSource(await view(), sourceId));
export const createCapitalSourceAction = async (input: unknown) =>
  runAction(async () => capital.createCapitalSource(await manage(), input, await getRequestMeta()));
export const updateCapitalSourceAction = async (sourceId: string, input: unknown) =>
  runAction(async () =>
    capital.updateCapitalSource(await manage(), sourceId, input, await getRequestMeta()),
  );
export const receiveCapitalAction = async (sourceId: string, input: unknown) =>
  runAction(async () =>
    capital.receiveCapital(await manage(), sourceId, input, await getRequestMeta()),
  );
export const repayCapitalAction = async (sourceId: string, input: unknown) =>
  runAction(async () =>
    capital.repayCapital(await manage(), sourceId, input, await getRequestMeta()),
  );
export const reverseCapitalEntryAction = async (
  sourceId: string,
  entryId: string,
  input: unknown,
) =>
  runAction(async () =>
    capital.reverseCapitalEntry(await manage(), sourceId, entryId, input, await getRequestMeta()),
  );
export const voidCapitalSourceAction = async (sourceId: string, input: unknown) =>
  runAction(async () =>
    capital.voidCapitalSource(await manage(), sourceId, input, await getRequestMeta()),
  );
export const previewScheduleAction = async (sourceId: string, input: unknown) =>
  runAction(async () => capital.previewSchedule(await view(), sourceId, input));
export const scheduleInstallmentsAction = async (sourceId: string, input: unknown) =>
  runAction(async () =>
    capital.scheduleInstallments(await manage(), sourceId, input, await getRequestMeta()),
  );
export const addInstallmentAction = async (sourceId: string, input: unknown) =>
  runAction(async () =>
    capital.addInstallment(await manage(), sourceId, input, await getRequestMeta()),
  );
export const listInstallmentsAction = async (query: unknown) =>
  runAction(async () => capital.listInstallments(await view(), query));
export const payInstallmentAction = async (installmentId: string, input: unknown) =>
  runAction(async () =>
    capital.payInstallment(await manage(), installmentId, input, await getRequestMeta()),
  );
export const skipInstallmentAction = async (installmentId: string, input: unknown) =>
  runAction(async () =>
    capital.skipInstallment(await manage(), installmentId, input, await getRequestMeta()),
  );

// --- Supplier payments ----------------------------------------------------------------------------
export const listSupplierPaymentsAction = async (query: unknown) =>
  runAction(async () =>
    supplierPayments.listSupplierPayments(
      await requireAnyPermission("accounts.view", "accounts.payments.record"),
      query,
    ),
  );
export const getSupplierPaymentAction = async (paymentId: string) =>
  runAction(async () =>
    supplierPayments.getSupplierPayment(
      await requireAnyPermission("accounts.view", "accounts.payments.record"),
      paymentId,
    ),
  );
export const paySupplierAction = async (input: unknown) =>
  runAction(async () =>
    supplierPayments.paySupplier(await payOut(), input, await getRequestMeta()),
  );
export const voidSupplierPaymentAction = async (paymentId: string, input: unknown) =>
  runAction(async () =>
    supplierPayments.voidSupplierPayment(await payOut(), paymentId, input, await getRequestMeta()),
  );
