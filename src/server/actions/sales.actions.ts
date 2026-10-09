"use server";

import type { CustomFieldEntity } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as customFields from "@/modules/sales/custom-fields.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";
import * as proformas from "@/modules/sales/proforma.service";
import * as quotations from "@/modules/sales/quotation.service";
import * as refunds from "@/modules/sales/refund.service";
import * as screens from "@/modules/sales/screens.service";
import * as summary from "@/modules/sales/summary.service";

/*
 * Sales Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 *   sales.view                read quotations, proformas, orders, documents, payments
 *   sales.quotation.manage    quotations and proforma conversion
 *   sales.order.create        orders, invoices, packing lists, challans
 *   accounts.receipts.record  money received (also needed for a payment at checkout);
 *                             a refund kept as the buyer's credit
 *   accounts.payments.record  a refund paid back to the buyer
 *   accounts.manage           a refund kept as a cancellation charge
 *   sales.invoice.edit        void invoices (cancelling an invoiced order needs it too)
 *   sales.force_override      sell beyond available stock (checked inside the order)
 *   company.settings          custom field definitions
 * An INSUFFICIENT_STOCK error means: show the "Force Override & Sell" warning.
 * Changes refresh the screens, so lists, orders and balances show them straight away.
 */

const view = () => requirePermission("sales.view");
const quote = () => requirePermission("sales.quotation.manage");
const sell = () => requirePermission("sales.order.create");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

/**
 * What a change hands back to the screen: the record's id and number only. The
 * full records carry Decimal amounts, which do not cross to the browser; the
 * screens reload the record from its page.
 */
const ref = (record: { id: string; number: string }) => ({
  id: record.id,
  number: record.number,
});

// --- Screens -------------------------------------------------------------------
export const getQuotationListAction = async (query: unknown) =>
  runAction(async () => screens.getQuotationList(await view(), query));
export const listQuotationRowsAction = async (query: unknown) =>
  runAction(async () => screens.listQuotationRows(await view(), query));
export const getQuotationScreenAction = async (quotationId: string) =>
  runAction(async () => screens.getQuotationScreen(await view(), quotationId));
export const getQuotationFormAction = async (quotationId?: string) =>
  runAction(async () => screens.getQuotationForm(await quote(), quotationId));
export const listProformaRowsAction = async (query: unknown) =>
  runAction(async () => screens.listProformaRows(await view(), query));
export const getProformaScreenAction = async (proformaId: string) =>
  runAction(async () => screens.getProformaScreen(await view(), proformaId));
export const getOrderListAction = async (query: unknown) =>
  runAction(async () => screens.getOrderList(await view(), query));
export const listOrderRowsAction = async (query: unknown) =>
  runAction(async () => screens.listOrderRows(await view(), query));
export const getOrderScreenAction = async (orderId: string) =>
  runAction(async () => screens.getOrderScreen(await view(), orderId));
export const getOrderFormAction = async (from: { orderId?: string; proformaId?: string }) =>
  runAction(async () => screens.getOrderForm(await sell(), from));
export const listInvoiceRowsAction = async (query: unknown) =>
  runAction(async () => screens.listInvoiceRows(await view(), query));
export const getInvoiceScreenAction = async (invoiceId: string) =>
  runAction(async () => screens.getInvoiceScreen(await view(), invoiceId));
export const getPaymentListAction = async (query: unknown) =>
  runAction(async () => screens.getPaymentList(await view(), query));
export const listPaymentRowsAction = async (query: unknown) =>
  runAction(async () => screens.listPaymentRows(await view(), query));
export const listRefundRowsAction = async (query: unknown) =>
  runAction(async () => screens.listRefundRows(await view(), query));
export const getPaymentScreenAction = async (paymentId: string) =>
  runAction(async () => screens.getPaymentScreen(await view(), paymentId));

/** Buyers to pick for a quotation, an order or a payment on account. */
export const findBuyersAction = async (query: { search?: string; purpose?: "SALE" | "PAYMENT" }) =>
  runAction(async () =>
    screens.findBuyers(
      query.purpose === "PAYMENT"
        ? await requirePermission("accounts.receipts.record")
        : await requireAnyPermission("sales.quotation.manage", "sales.order.create"),
      query,
    ),
  );
/** Styles to quote or sell. */
export const findSaleStylesAction = async (query: { search?: string }) =>
  runAction(async () =>
    screens.findSaleStyles(
      await requireAnyPermission("sales.quotation.manage", "sales.order.create"),
      query,
    ),
  );
/** A style's colours and sizes with the pieces ready to sell, for order entry. */
export const getSaleMatrixAction = async (styleId: string, warehouseId?: string) =>
  runAction(async () => screens.getSaleMatrix(await sell(), styleId, warehouseId));

// --- Custom fields -------------------------------------------------------------
export const listCustomFieldsAction = async (entity?: CustomFieldEntity) =>
  runAction(async () => customFields.listCustomFields(await view(), entity));
export const createCustomFieldAction = async (input: unknown) =>
  change(async () =>
    customFields.createCustomField(
      await requirePermission("company.settings"),
      input,
      await getRequestMeta(),
    ),
  );
export const updateCustomFieldAction = async (fieldId: string, input: unknown) =>
  change(async () =>
    customFields.updateCustomField(
      await requirePermission("company.settings"),
      fieldId,
      input,
      await getRequestMeta(),
    ),
  );

// --- Quotations ----------------------------------------------------------------
export const listQuotationsAction = async (query: unknown) =>
  runAction(async () => quotations.listQuotations(await view(), query));
export const getQuotationAction = async (quotationId: string) =>
  runAction(async () => quotations.getQuotation(await view(), quotationId));
export const createQuotationAction = async (input: unknown) =>
  change(async () =>
    ref(await quotations.createQuotation(await quote(), input, await getRequestMeta())),
  );
export const updateQuotationAction = async (quotationId: string, input: unknown) =>
  change(async () =>
    ref(
      await quotations.updateQuotation(await quote(), quotationId, input, await getRequestMeta()),
    ),
  );
export const setQuotationStatusAction = async (quotationId: string, input: unknown) =>
  change(async () =>
    ref(
      await quotations.setQuotationStatus(
        await quote(),
        quotationId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const deleteQuotationAction = async (quotationId: string) =>
  change(async () => {
    await quotations.deleteQuotation(await quote(), quotationId, await getRequestMeta());
    return { id: quotationId };
  });
export const convertQuotationToProformaAction = async (quotationId: string, input: unknown) =>
  change(async () =>
    ref(
      await proformas.convertQuotationToProforma(
        await quote(),
        quotationId,
        input,
        await getRequestMeta(),
      ),
    ),
  );

// --- Proforma invoices ---------------------------------------------------------
export const listProformasAction = async (query: unknown) =>
  runAction(async () => proformas.listProformas(await view(), query));
export const getProformaAction = async (proformaId: string) =>
  runAction(async () => proformas.getProforma(await view(), proformaId));
export const cancelProformaAction = async (proformaId: string, input: unknown) =>
  change(async () =>
    ref(await proformas.cancelProforma(await quote(), proformaId, input, await getRequestMeta())),
  );
export const convertProformaToOrderAction = async (proformaId: string, input: unknown) =>
  change(async () =>
    ref(
      await proformas.convertProformaToOrder(
        await sell(),
        proformaId,
        input,
        await getRequestMeta(),
      ),
    ),
  );

// --- Orders ----------------------------------------------------------------------
export const listOrdersAction = async (query: unknown) =>
  runAction(async () => orders.listOrders(await view(), query));
export const getOrderAction = async (orderId: string) =>
  runAction(async () => orders.getOrder(await view(), orderId));
export const createOrderAction = async (input: unknown) =>
  change(async () => ref(await orders.createOrder(await sell(), input, await getRequestMeta())));
export const updateOrderAction = async (orderId: string, input: unknown) =>
  change(async () =>
    ref(await orders.updateOrder(await sell(), orderId, input, await getRequestMeta())),
  );
export const cancelOrderAction = async (orderId: string, input: unknown) =>
  change(async () =>
    ref(await orders.cancelOrder(await sell(), orderId, input, await getRequestMeta())),
  );
export const setOrderShipmentDateAction = async (orderId: string, input: unknown) =>
  change(async () =>
    ref(await orders.setOrderShipmentDate(await sell(), orderId, input, await getRequestMeta())),
  );

// --- Documents -----------------------------------------------------------------
export const issueInvoiceAction = async (orderId: string, input: unknown) =>
  change(async () =>
    ref(await documents.issueInvoice(await sell(), orderId, input, await getRequestMeta())),
  );
export const voidInvoiceAction = async (invoiceId: string, input: unknown) =>
  change(async () =>
    ref(
      await documents.voidInvoice(
        await requirePermission("sales.invoice.edit"),
        invoiceId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const getInvoiceAction = async (invoiceId: string) =>
  runAction(async () => documents.getInvoiceDocument(await view(), invoiceId));
export const createPackingListAction = async (orderId: string, input: unknown) =>
  change(async () =>
    ref(await documents.createPackingList(await sell(), orderId, input, await getRequestMeta())),
  );
export const getPackingListAction = async (packingListId: string) =>
  runAction(async () => documents.getPackingListDocument(await view(), packingListId));
export const setPickedItemsAction = async (packingListId: string, input: unknown) =>
  change(async () => documents.setPickedItems(await sell(), packingListId, input));
export const createDeliveryChallanAction = async (orderId: string, input: unknown) =>
  change(async () =>
    ref(
      await documents.createDeliveryChallan(await sell(), orderId, input, await getRequestMeta()),
    ),
  );
export const getChallanAction = async (challanId: string) =>
  runAction(async () => documents.getChallanDocument(await view(), challanId));
export const listInvoicesAction = async (query: unknown) =>
  runAction(async () => documents.listInvoices(await view(), query));
export const listChallansAction = async (query: {
  orderId?: string;
  partyId?: string;
  search?: string;
}) => runAction(async () => documents.listChallans(await view(), query));

// --- Payments & summary --------------------------------------------------------
export const receivePaymentAction = async (input: unknown) =>
  change(async () => {
    const { payment, productionProject } = await payments.receivePayment(
      await requirePermission("accounts.receipts.record"),
      input,
      await getRequestMeta(),
    );
    return {
      payment: ref(payment),
      productionProject: productionProject
        ? { id: productionProject.id, code: productionProject.code }
        : null,
    };
  });
export const listPaymentsAction = async (query: unknown) =>
  runAction(async () => payments.listPayments(await view(), query));
export const getPaymentReceiptAction = async (paymentId: string) =>
  runAction(async () => payments.getPaymentReceipt(await view(), paymentId));

// --- Refunds -------------------------------------------------------------------
/** Any Accounts money key opens refunds; the service checks the one for the refund's kind. */
const refundMoney = () =>
  requireAnyPermission("accounts.payments.record", "accounts.receipts.record", "accounts.manage");
export const refundBuyerAction = async (input: unknown) =>
  change(async () =>
    ref(await refunds.refundBuyer(await refundMoney(), input, await getRequestMeta())),
  );
export const voidRefundAction = async (refundId: string, input: unknown) =>
  change(async () =>
    ref(await refunds.voidRefund(await refundMoney(), refundId, input, await getRequestMeta())),
  );
export const listRefundsAction = async (query: unknown) =>
  runAction(async () => refunds.listRefunds(await view(), query));
export const getRefundAction = async (refundId: string) =>
  runAction(async () => refunds.getRefund(await view(), refundId));

export const getSalesSummaryAction = async (query: unknown) =>
  runAction(async () => summary.getSalesSummary(await view(), query));
