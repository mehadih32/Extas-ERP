"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as assets from "@/modules/accounts/asset.service";
import * as bank from "@/modules/accounts/bank.service";
import * as capital from "@/modules/accounts/capital.service";
import * as chart from "@/modules/accounts/chart.service";
import * as reports from "@/modules/accounts/reports.service";
import * as screens from "@/modules/accounts/screens.service";
import * as supplierPayments from "@/modules/accounts/supplier-payment.service";
import * as vouchers from "@/modules/accounts/voucher.service";

/*
 * Accounts Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 *   accounts.view             chart, ledgers, bank statements, registers, reports
 *   accounts.manage           journal vouchers, accounts, bank accounts, assets, capital
 *   accounts.receipts.record  money in (capital and loans received, asset sale proceeds)
 *   accounts.payments.record  money out (transfers, supplier payments, installments)
 * Services check the money permissions themselves too, so no caller can skip them.
 * Changes made from the screens refresh them and hand back the record's id and
 * number only: the full records carry Decimal amounts, which do not cross to the
 * browser, so the screens reload the record from its page.
 */

const view = () => requirePermission("accounts.view");
const manage = () => requirePermission("accounts.manage");
const payOut = () => requirePermission("accounts.payments.record");
/** The "paid from / into" picker: anyone who records money. */
const moneyDesk = () =>
  requireAnyPermission("accounts.view", "accounts.receipts.record", "accounts.payments.record");
/** Supplier payments: the people who see the books and the people who pay. */
const paymentsDesk = () => requireAnyPermission("accounts.view", "accounts.payments.record");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

const ref = (record: { id: string; number: string }) => ({
  id: record.id,
  number: record.number,
});
const accountRef = (account: { id: string; code: string; name: string }) => ({
  id: account.id,
  code: account.code,
  name: account.name,
});
type Range = { from?: string; to?: string };

// --- Screens ---------------------------------------------------------------------------
export const getAccountsOverviewScreenAction = async () =>
  runAction(async () => screens.getOverviewScreen(await view()));
export const getCashBankScreenAction = async () =>
  runAction(async () => screens.getCashBankScreen(await view()));
export const getBankScreenAction = async (bankAccountId: string, range: Range = {}) =>
  runAction(async () => screens.getBankScreen(await view(), bankAccountId, range));
export const getBankFormAction = async (bankAccountId?: string) =>
  runAction(async () => screens.getBankForm(await manage(), bankAccountId));
export const getSupplierPaymentListAction = async (query: { supplierId?: string; take?: number }) =>
  runAction(async () => screens.getSupplierPaymentList(await paymentsDesk(), query));
export const listSupplierPaymentRowsAction = async (query: unknown) =>
  runAction(async () => screens.listSupplierPaymentRows(await paymentsDesk(), query));
export const getSupplierPaymentScreenAction = async (paymentId: string) =>
  runAction(async () => screens.getSupplierPaymentScreen(await paymentsDesk(), paymentId));
export const getPayFormAction = async (supplierId?: string, projectId?: string) =>
  runAction(async () => screens.getPayForm(await payOut(), supplierId, projectId));
export const getSupplierDuesAction = async (supplierId: string) =>
  runAction(async () => screens.getSupplierDues(await payOut(), supplierId));
/** Suppliers to pay or to owe, buyers and suppliers on journal lines. */
export const findAccountsPartiesAction = async (query: {
  kind: "SUPPLIER" | "BUYER";
  purpose: "PAY" | "DUE" | "JOURNAL";
  search?: string;
}) =>
  runAction(async () =>
    screens.findParties(
      await requireAnyPermission(
        "parties.view",
        "accounts.view",
        "accounts.payments.record",
        "expenses.manage",
      ),
      query,
    ),
  );
export const getJournalListAction = async (query: unknown) =>
  runAction(async () => screens.getJournalList(await view(), query));
export const listJournalRowsAction = async (query: unknown) =>
  runAction(async () => screens.listJournalRows(await view(), query));
export const getJournalEntryScreenAction = async (entryId: string) =>
  runAction(async () => screens.getJournalEntryScreen(await view(), entryId));
export const getVoucherFormAction = async () =>
  runAction(async () => screens.getVoucherForm(await manage()));
export const getChartScreenAction = async (query: { includeInactive?: boolean } = {}) =>
  runAction(async () => screens.getChartScreen(await view(), query));
export const getAccountScreenAction = async (accountId: string, range: Range = {}) =>
  runAction(async () => screens.getAccountScreen(await view(), accountId, range));

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
  change(async () =>
    accountRef(await chart.createAccount(await manage(), input, await getRequestMeta())),
  );
export const updateAccountAction = async (accountId: string, input: unknown) =>
  change(async () =>
    accountRef(await chart.updateAccount(await manage(), accountId, input, await getRequestMeta())),
  );
export const setAccountOpeningBalanceAction = async (accountId: string, input: unknown) =>
  change(async () =>
    accountRef(
      await chart.setAccountOpeningBalance(
        await manage(),
        accountId,
        input,
        await getRequestMeta(),
      ),
    ),
  );

// --- Journal vouchers & transfers ---------------------------------------------------------
export const listJournalEntriesAction = async (query: unknown) =>
  runAction(async () => vouchers.listJournalEntries(await view(), query));
export const getJournalEntryAction = async (entryId: string) =>
  runAction(async () => vouchers.getJournalEntry(await view(), entryId));
export const createJournalVoucherAction = async (input: unknown) =>
  change(async () =>
    ref(await vouchers.createJournalVoucher(await manage(), input, await getRequestMeta())),
  );
/** Journal vouchers need accounts.manage; transfers need accounts.payments.record. */
export const reverseJournalVoucherAction = async (entryId: string, input: unknown) =>
  change(async () =>
    ref(
      await vouchers.reverseJournalVoucher(
        await requireAnyPermission("accounts.manage", "accounts.payments.record"),
        entryId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const createTransferAction = async (input: unknown) =>
  change(async () =>
    ref(await vouchers.createTransfer(await payOut(), input, await getRequestMeta())),
  );

// --- Bank accounts & statements -------------------------------------------------------------
export const listBankAccountsAction = async (query: { includeInactive?: unknown } = {}) =>
  runAction(async () => bank.listBankAccounts(await view(), query));
export const getBankAccountAction = async (bankAccountId: string) =>
  runAction(async () => bank.getBankAccount(await view(), bankAccountId));
export const createBankAccountAction = async (input: unknown) =>
  change(async () => {
    const created = await bank.createBankAccount(await manage(), input, await getRequestMeta());
    return { id: created.id, accountNumber: created.accountNumber };
  });
export const updateBankAccountAction = async (bankAccountId: string, input: unknown) =>
  change(async () => {
    const updated = await bank.updateBankAccount(
      await manage(),
      bankAccountId,
      input,
      await getRequestMeta(),
    );
    return { id: updated.id, accountNumber: updated.accountNumber, isActive: updated.isActive };
  });
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
  runAction(async () => supplierPayments.listSupplierPayments(await paymentsDesk(), query));
export const getSupplierPaymentAction = async (paymentId: string) =>
  runAction(async () => supplierPayments.getSupplierPayment(await paymentsDesk(), paymentId));
/** Pays a supplier on account: what it settled and any advance left with them. */
export const paySupplierAction = async (input: unknown) =>
  change(async () => {
    const paid = await supplierPayments.paySupplier(await payOut(), input, await getRequestMeta());
    return {
      ...ref(paid),
      appliedTo: paid.appliedTo.map((a) => ({ number: a.number, amount: a.amount })),
      advanceLeft: paid.advanceLeft,
    };
  });
export const voidSupplierPaymentAction = async (paymentId: string, input: unknown) =>
  change(async () =>
    ref(
      await supplierPayments.voidSupplierPayment(
        await payOut(),
        paymentId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
