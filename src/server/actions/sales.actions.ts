"use server";

import type { CustomFieldEntity } from "@prisma/client";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as customFields from "@/modules/sales/custom-fields.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";
import * as proformas from "@/modules/sales/proforma.service";
import * as quotations from "@/modules/sales/quotation.service";
import * as summary from "@/modules/sales/summary.service";

/*
 * Sales Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 *   sales.view                read quotations, proformas, orders, documents, payments
 *   sales.quotation.manage    quotations and proforma conversion
 *   sales.order.create        orders, invoices, packing lists, challans
 *   accounts.receipts.record  money received (also needed for a payment at checkout)
 *   sales.invoice.edit        void invoices (cancelling an invoiced order needs it too)
 *   sales.force_override      sell beyond available stock (checked inside the order)
 *   company.settings          custom field definitions
 * An INSUFFICIENT_STOCK error means: show the "Force Override & Sell" warning.
 */

const view = () => requirePermission("sales.view");
const quote = () => requirePermission("sales.quotation.manage");
const sell = () => requirePermission("sales.order.create");

// --- Custom fields -------------------------------------------------------------
export const listCustomFieldsAction = async (entity?: CustomFieldEntity) =>
  runAction(async () => customFields.listCustomFields(await view(), entity));
export const createCustomFieldAction = async (input: unknown) =>
  runAction(async () =>
    customFields.createCustomField(
      await requirePermission("company.settings"),
      input,
      await getRequestMeta(),
    ),
  );
export const updateCustomFieldAction = async (fieldId: string, input: unknown) =>
  runAction(async () =>
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
  runAction(async () => quotations.createQuotation(await quote(), input, await getRequestMeta()));
export const updateQuotationAction = async (quotationId: string, input: unknown) =>
  runAction(async () =>
    quotations.updateQuotation(await quote(), quotationId, input, await getRequestMeta()),
  );
export const setQuotationStatusAction = async (quotationId: string, input: unknown) =>
  runAction(async () =>
    quotations.setQuotationStatus(await quote(), quotationId, input, await getRequestMeta()),
  );
export const deleteQuotationAction = async (quotationId: string) =>
  runAction(async () =>
    quotations.deleteQuotation(await quote(), quotationId, await getRequestMeta()),
  );
export const convertQuotationToProformaAction = async (quotationId: string, input: unknown) =>
  runAction(async () =>
    proformas.convertQuotationToProforma(await quote(), quotationId, input, await getRequestMeta()),
  );

// --- Proforma invoices ---------------------------------------------------------
export const listProformasAction = async (query: unknown) =>
  runAction(async () => proformas.listProformas(await view(), query));
export const getProformaAction = async (proformaId: string) =>
  runAction(async () => proformas.getProforma(await view(), proformaId));
export const cancelProformaAction = async (proformaId: string, input: unknown) =>
  runAction(async () =>
    proformas.cancelProforma(await quote(), proformaId, input, await getRequestMeta()),
  );
export const convertProformaToOrderAction = async (proformaId: string, input: unknown) =>
  runAction(async () =>
    proformas.convertProformaToOrder(await sell(), proformaId, input, await getRequestMeta()),
  );

// --- Orders ----------------------------------------------------------------------
export const listOrdersAction = async (query: unknown) =>
  runAction(async () => orders.listOrders(await view(), query));
export const getOrderAction = async (orderId: string) =>
  runAction(async () => orders.getOrder(await view(), orderId));
export const createOrderAction = async (input: unknown) =>
  runAction(async () => orders.createOrder(await sell(), input, await getRequestMeta()));
export const updateOrderAction = async (orderId: string, input: unknown) =>
  runAction(async () => orders.updateOrder(await sell(), orderId, input, await getRequestMeta()));
export const cancelOrderAction = async (orderId: string, input: unknown) =>
  runAction(async () => orders.cancelOrder(await sell(), orderId, input, await getRequestMeta()));

// --- Documents -----------------------------------------------------------------
export const issueInvoiceAction = async (orderId: string, input: unknown) =>
  runAction(async () =>
    documents.issueInvoice(await sell(), orderId, input, await getRequestMeta()),
  );
export const voidInvoiceAction = async (invoiceId: string, input: unknown) =>
  runAction(async () =>
    documents.voidInvoice(
      await requirePermission("sales.invoice.edit"),
      invoiceId,
      input,
      await getRequestMeta(),
    ),
  );
export const getInvoiceAction = async (invoiceId: string) =>
  runAction(async () => documents.getInvoiceDocument(await view(), invoiceId));
export const createPackingListAction = async (orderId: string, input: unknown) =>
  runAction(async () =>
    documents.createPackingList(await sell(), orderId, input, await getRequestMeta()),
  );
export const getPackingListAction = async (packingListId: string) =>
  runAction(async () => documents.getPackingListDocument(await view(), packingListId));
export const setPickedItemsAction = async (packingListId: string, input: unknown) =>
  runAction(async () => documents.setPickedItems(await sell(), packingListId, input));
export const createDeliveryChallanAction = async (orderId: string, input: unknown) =>
  runAction(async () =>
    documents.createDeliveryChallan(await sell(), orderId, input, await getRequestMeta()),
  );
export const getChallanAction = async (challanId: string) =>
  runAction(async () => documents.getChallanDocument(await view(), challanId));
export const listChallansAction = async (query: {
  orderId?: string;
  partyId?: string;
  search?: string;
}) => runAction(async () => documents.listChallans(await view(), query));

// --- Payments & summary --------------------------------------------------------
export const receivePaymentAction = async (input: unknown) =>
  runAction(async () =>
    payments.receivePayment(
      await requirePermission("accounts.receipts.record"),
      input,
      await getRequestMeta(),
    ),
  );
export const listPaymentsAction = async (query: unknown) =>
  runAction(async () => payments.listPayments(await view(), query));
export const getPaymentReceiptAction = async (paymentId: string) =>
  runAction(async () => payments.getPaymentReceipt(await view(), paymentId));
export const getSalesSummaryAction = async (query: unknown) =>
  runAction(async () => summary.getSalesSummary(await view(), query));
