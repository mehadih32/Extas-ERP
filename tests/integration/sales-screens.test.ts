import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Sales screens decide what to show and offer from flags the server sends
 * with the data (canCreate, canReceive, can.edit, can.receive, can.refundKinds,
 * costs). These tests open the screens' data as each built-in role and then try
 * every change through the same Server Actions the buttons call: each must work
 * exactly when the screen offers it. Next.js' request helpers are replaced as in
 * screens.test.ts.
 */
const browser = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      browser.cookies.has(name) ? { name, value: browser.cookies.get(name)! } : undefined,
    set: (name: string, value: string) => void browser.cookies.set(name, value),
    delete: (name: string) => void browser.cookies.delete(name),
  }),
  headers: async () => browser.headers,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`Redirected to ${url}`), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
      redirectedTo: url,
    });
  },
  notFound: () => {
    throw Object.assign(new Error("Not found"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  },
  useRouter: () => ({}),
  usePathname: () => "/sales",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import InvoicePage from "@/app/(app)/sales/invoices/[invoiceId]/page";
import InvoicesPage from "@/app/(app)/sales/invoices/page";
import EditOrderPage from "@/app/(app)/sales/orders/[orderId]/edit/page";
import OrderPage from "@/app/(app)/sales/orders/[orderId]/page";
import NewOrderPage from "@/app/(app)/sales/orders/new/page";
import OrdersPage from "@/app/(app)/sales/orders/page";
import SalesPage from "@/app/(app)/sales/page";
import PaymentPage from "@/app/(app)/sales/payments/[paymentId]/page";
import PaymentsPage from "@/app/(app)/sales/payments/page";
import ProformaPage from "@/app/(app)/sales/proformas/[proformaId]/page";
import ProformasPage from "@/app/(app)/sales/proformas/page";
import EditQuotationPage from "@/app/(app)/sales/quotations/[quotationId]/edit/page";
import QuotationPage from "@/app/(app)/sales/quotations/[quotationId]/page";
import NewQuotationPage from "@/app/(app)/sales/quotations/new/page";
import QuotationsPage from "@/app/(app)/sales/quotations/page";
import { SalesNoAccess } from "@/components/sales/no-access";
import { visibleSalesTabs } from "@/components/sales/tabs";
import { visibleNavItems } from "@/components/shell/nav-items";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/result";
import type { CompanyContext } from "@/modules/auth/context";
import { createSession } from "@/modules/auth/session.service";
import { canSeeFinancials } from "@/modules/dashboard/access";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";
import * as proformas from "@/modules/sales/proforma.service";
import * as quotations from "@/modules/sales/quotation.service";
import {
  cancelOrderAction,
  cancelProformaAction,
  convertProformaToOrderAction,
  convertQuotationToProformaAction,
  createDeliveryChallanAction,
  createOrderAction,
  createPackingListAction,
  createQuotationAction,
  deleteQuotationAction,
  findBuyersAction,
  findSaleStylesAction,
  getInvoiceScreenAction,
  getOrderFormAction,
  getOrderListAction,
  getOrderScreenAction,
  getPaymentListAction,
  getPaymentScreenAction,
  getProformaScreenAction,
  getQuotationFormAction,
  getQuotationListAction,
  getQuotationScreenAction,
  getSaleMatrixAction,
  issueInvoiceAction,
  listInvoiceRowsAction,
  listProformaRowsAction,
  listRefundRowsAction,
  receivePaymentAction,
  refundBuyerAction,
  setOrderShipmentDateAction,
  setQuotationStatusAction,
  updateOrderAction,
  updateQuotationAction,
  voidInvoiceAction,
  voidRefundAction,
} from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  sales: "SALES_EXECUTIVE",
  store: "WAREHOUSE_TEAM",
  accounts: "ACCOUNTS",
  employee: "EMPLOYEE",
} as const;
type Who = keyof typeof ROLES;

async function signInAs(userId: string, companyId: string) {
  const { token } = await createSession(userId, companyId);
  browser.cookies.set(SESSION_COOKIE, token);
}

/** A refusal must come from the access rules, not from some other failure. */
function expectRuleRefusal(result: ActionResult<unknown>, label: string) {
  if (result.ok) return;
  expect(["FORBIDDEN", "CONFLICT", "VALIDATION"], `${label}: ${result.error.message}`).toContain(
    result.error.code,
  );
}

/** The change works exactly when the screen offered it. */
function expectOffered(result: ActionResult<unknown>, offered: boolean, label: string) {
  expect(result.ok, `${label}${result.ok ? "" : `: ${result.error.message}`}`).toBe(offered);
  expectRuleRefusal(result, label);
}

function data<T>(result: ActionResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/** What a page rendered: the "not part of your role" notice, a redirect, or the page. */
async function rendered(page: Promise<React.ReactElement>): Promise<string> {
  try {
    const element = await page;
    return element.type === SalesNoAccess ? "no access" : "page";
  } catch (error) {
    const to = (error as { redirectedTo?: string }).redirectedTo;
    if (to) return `redirect ${to}`;
    throw error;
  }
}

/**
 * Extras with one person in each built-in role, a Classic Polo (Navy / White x
 * S M L, wholesale 900, retail 1450, 100 pcs of each SKU at cost 500) and the
 * buyer Rahim Traders.
 */
async function shop() {
  const { company, roles } = await makeCompany("Extras");
  const people = {} as Record<Who, { id: string }>;
  for (const [who, role] of Object.entries(ROLES) as Array<[Who, keyof typeof roles]>) {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roles[role]);
    people[who] = user;
  }
  const owner = await contextFor(people.owner.id, company.id);
  const sizes = [];
  for (const name of ["S", "M", "L"]) sizes.push(await catalog.createSize(owner, { name }));
  const navy = await catalog.createColor(owner, { name: "Navy", hexCode: "#1f2a44" });
  const white = await catalog.createColor(owner, { name: "White", hexCode: "#FFFFFF" });
  const tops = await catalog.createCategory(owner, { name: "Tops" });
  const style = await styles.createStyle(owner, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(owner, style.id, {
    colorIds: [navy.id, white.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { color: true, size: true },
  });
  const sku = (color: string, size: string) =>
    variants.find((v) => v.color.name === color && v.size.name === size)!.id;
  for (const v of variants) {
    await stock.adjustStock(owner, {
      variantId: v.id,
      quantity: 100,
      type: "OPENING",
      unitCost: 500,
    });
  }
  const buyer = (
    await parties.createParty(owner, {
      kind: "BUYER",
      name: "Rahim Traders",
      phone: "01711223344",
      paymentTermsDays: 30,
    })
  ).party;
  return { company, people, owner, style, sku, buyer };
}

type Shop = Awaited<ReturnType<typeof shop>>;

async function as(env: Shop, who: Who): Promise<CompanyContext> {
  await signInAs(env.people[who].id, env.company.id);
  return requireCompanyPage();
}

const params = <T>(value: T) => Promise.resolve(value);
const noQuery = () => Promise.resolve({});

/** A quotation from the owner, in the state asked for. */
async function quotationIn(env: Shop, status: "DRAFT" | "SENT" | "ACCEPTED" = "DRAFT") {
  const q = await quotations.createQuotation(env.owner, {
    partyId: env.buyer.id,
    items: [
      {
        styleId: env.style.id,
        description: "Classic Polo",
        sizeBreakdown: { S: 10, M: 10 },
        unitPrice: 900,
      },
    ],
  });
  if (status !== "DRAFT") await quotations.setQuotationStatus(env.owner, q.id, { status: "SENT" });
  if (status === "ACCEPTED") {
    await quotations.setQuotationStatus(env.owner, q.id, { status: "ACCEPTED" });
  }
  return q;
}

/** A wholesale order of 6 Navy polos (3 S, 3 M) at 900, invoiced unless asked not to. */
const orderFor = (env: Shop, extra: Record<string, unknown> = {}) =>
  orders.createOrder(env.owner, {
    channel: "WHOLESALE",
    partyId: env.buyer.id,
    matrix: [
      {
        styleId: env.style.id,
        quantities: { [env.sku("Navy", "S")]: 3, [env.sku("Navy", "M")]: 3 },
      },
    ],
    ...extra,
  });

run("Sales screens", () => {
  beforeEach(resetDb);

  it("shows each page to the people its actions let in, and nothing to the others", async () => {
    const env = await shop();
    const q = await quotationIn(env, "ACCEPTED");
    const p = await proformas.convertQuotationToProforma(env.owner, q.id, {});
    const order = await orderFor(env);
    const invoiceId = order.invoice!.id;
    const paid = await payments.receivePayment(env.owner, {
      orderId: order.id,
      amount: 1000,
      method: "CASH",
    });
    const seen: Record<string, unknown> = {};

    for (const who of Object.keys(ROLES) as Who[]) {
      const ctx = await as(env, who);
      const view = ctx.can("sales.view");
      const quote = ctx.can("sales.quotation.manage");
      const sell = ctx.can("sales.order.create");
      const receive = ctx.can("accounts.receipts.record");
      seen[who] = { view, quote, sell, receive, costs: canSeeFinancials(ctx) };

      const inMenu = visibleNavItems([...ctx.permissions]).some((i) => i.href === "/sales");
      expect(inMenu, who).toBe(view);
      const tabs = visibleSalesTabs(ctx.permissions).map((t) => t.href);
      expect(tabs, who).toEqual(
        view
          ? [
              "/sales/orders",
              "/sales/quotations",
              "/sales/proformas",
              "/sales/invoices",
              "/sales/payments",
            ]
          : [],
      );

      // Each screen's data comes exactly to the people its page is shown to.
      const orderList = await getOrderListAction({});
      expect(orderList.ok, `${who}: orders`).toBe(view);
      const quotationList = await getQuotationListAction({});
      expect(quotationList.ok, `${who}: quotations`).toBe(view);
      const paymentList = await getPaymentListAction({});
      expect(paymentList.ok, `${who}: payments`).toBe(view);
      expect((await listProformaRowsAction({})).ok, `${who}: proformas`).toBe(view);
      expect((await listInvoiceRowsAction({})).ok, `${who}: invoices`).toBe(view);
      expect((await listRefundRowsAction({})).ok, `${who}: refunds`).toBe(view);
      expect((await getOrderScreenAction(order.id)).ok, `${who}: order`).toBe(view);
      expect((await getQuotationScreenAction(q.id)).ok, `${who}: quotation`).toBe(view);
      expect((await getProformaScreenAction(p.id)).ok, `${who}: proforma`).toBe(view);
      expect((await getInvoiceScreenAction(invoiceId)).ok, `${who}: invoice`).toBe(view);
      expect((await getPaymentScreenAction(paid.payment.id)).ok, `${who}: receipt`).toBe(view);
      expect((await getQuotationFormAction()).ok, `${who}: quotation form`).toBe(quote);
      expect((await getOrderFormAction({})).ok, `${who}: order form`).toBe(sell);
      expect((await findSaleStylesAction({ search: "" })).ok, `${who}: styles`).toBe(quote || sell);
      expect((await getSaleMatrixAction(env.style.id)).ok, `${who}: matrix`).toBe(sell);
      expect((await findBuyersAction({ search: "" })).ok, `${who}: buyers`).toBe(quote || sell);
      expect((await findBuyersAction({ search: "", purpose: "PAYMENT" })).ok, who).toBe(receive);
      if (orderList.ok) expect(orderList.data.canCreate, who).toBe(sell);
      if (quotationList.ok) expect(quotationList.data.canCreate, who).toBe(quote);
      if (paymentList.ok) expect(paymentList.data.canReceive, who).toBe(receive);

      // The pages show "not part of your role" in the same cases.
      const page = (allowed: boolean) => (allowed ? "page" : "no access");
      expect(await rendered(SalesPage()), `${who}: /sales`).toBe(
        view ? "redirect /sales/orders" : "no access",
      );
      const listed = { searchParams: noQuery() };
      expect(await rendered(OrdersPage(listed)), `${who}: orders`).toBe(page(view));
      expect(await rendered(QuotationsPage(listed)), `${who}: quotations`).toBe(page(view));
      expect(await rendered(ProformasPage(listed)), `${who}: proformas`).toBe(page(view));
      expect(await rendered(InvoicesPage(listed)), `${who}: invoices`).toBe(page(view));
      expect(await rendered(PaymentsPage(listed)), `${who}: payments`).toBe(page(view));
      expect(
        await rendered(PaymentsPage({ searchParams: params({ show: "refunds" }) })),
        `${who}: refunds`,
      ).toBe(page(view));
      const one = { searchParams: noQuery() };
      expect(
        await rendered(OrderPage({ params: params({ orderId: order.id }), ...one })),
        `${who}: order`,
      ).toBe(page(view));
      expect(
        await rendered(QuotationPage({ params: params({ quotationId: q.id }), ...one })),
        `${who}: quotation`,
      ).toBe(page(view));
      expect(
        await rendered(ProformaPage({ params: params({ proformaId: p.id }), ...one })),
        `${who}: proforma`,
      ).toBe(page(view));
      expect(
        await rendered(InvoicePage({ params: params({ invoiceId }) })),
        `${who}: invoice`,
      ).toBe(page(view));
      expect(
        await rendered(PaymentPage({ params: params({ paymentId: paid.payment.id }) })),
        `${who}: receipt`,
      ).toBe(page(view));
      expect(await rendered(NewQuotationPage()), `${who}: new quotation`).toBe(page(quote));
      expect(await rendered(NewOrderPage(one)), `${who}: new order`).toBe(page(sell));
      // An accepted quotation and an invoiced order can no longer be edited: back to their page.
      expect(
        await rendered(EditQuotationPage({ params: params({ quotationId: q.id }) })),
        `${who}: edit quotation`,
      ).toBe(quote ? `redirect /sales/quotations/${q.id}` : "no access");
      expect(
        await rendered(EditOrderPage({ params: params({ orderId: order.id }) })),
        `${who}: edit order`,
      ).toBe(sell ? `redirect /sales/orders/${order.id}` : "no access");
    }

    expect(seen).toEqual({
      owner: { view: true, quote: true, sell: true, receive: true, costs: true },
      production: { view: false, quote: false, sell: false, receive: false, costs: false },
      sales: { view: true, quote: true, sell: true, receive: false, costs: false },
      store: { view: true, quote: false, sell: false, receive: false, costs: false },
      accounts: { view: true, quote: false, sell: false, receive: true, costs: true },
      employee: { view: false, quote: false, sell: false, receive: false, costs: false },
    });
  }, 120_000);

  it("keeps costs and margins to the people who see the financials", async () => {
    const env = await shop();
    const order = await orderFor(env);
    await documents.createDeliveryChallan(env.owner, order.id, {});

    for (const who of ["owner", "sales", "store", "accounts"] as const) {
      const ctx = await as(env, who);
      const screen = data(await getOrderScreenAction(order.id), who);
      const financials = canSeeFinancials(ctx);
      if (financials) {
        // 6 pcs at 900, each costing 500.
        expect(screen.costs, who).toEqual({
          cost: "3000.00",
          netSales: "5400.00",
          margin: "2400.00",
          marginPercent: 44.4,
          estimated: false,
        });
      } else {
        const { costs, ...rest } = screen;
        expect(costs, who).toBeNull();
        expect(JSON.stringify(rest), who).not.toMatch(/cost/i);
      }
      // The order itself (as the API and the screens read it) hides each line's cost too.
      const raw = await orders.getOrder(ctx, order.id);
      expect(
        raw.items.map((i) => i.unitCost?.toFixed(2) ?? null),
        who,
      ).toEqual(financials ? ["500.00", "500.00"] : [null, null]);
    }
  }, 60_000);

  it("offers quotation and proforma changes exactly to the people the actions let make them", async () => {
    const env = await shop();
    for (const who of ["owner", "sales", "store", "accounts"] as const) {
      await as(env, who);

      const draft = await quotationIn(env);
      const screen = data(await getQuotationScreenAction(draft.id), who);
      expectOffered(
        await updateQuotationAction(draft.id, { notes: "Navy only" }),
        screen.can.edit,
        `${who}: edit a draft`,
      );
      expectOffered(
        await setQuotationStatusAction(draft.id, { status: "SENT" }),
        screen.can.marks.includes("SENT"),
        `${who}: mark sent`,
      );
      const other = await quotationIn(env);
      const otherScreen = data(await getQuotationScreenAction(other.id), who);
      expectOffered(
        await deleteQuotationAction(other.id),
        otherScreen.can.delete,
        `${who}: delete`,
      );

      const accepted = await quotationIn(env, "ACCEPTED");
      const acceptedScreen = data(await getQuotationScreenAction(accepted.id), who);
      expect(acceptedScreen.can.edit, who).toBe(false);
      expect(acceptedScreen.can.delete, who).toBe(false);
      const converted = await convertQuotationToProformaAction(accepted.id, { advancePercent: 50 });
      expectOffered(converted, acceptedScreen.can.convert, `${who}: make the proforma`);
      const proformaId = converted.ok
        ? converted.data.id
        : (await proformas.convertQuotationToProforma(env.owner, accepted.id, {})).id;

      // The advance (half of 18,000) is received only by Accounts and Super Admin.
      const proforma = data(await getProformaScreenAction(proformaId), who);
      expect(proforma.can.convert, `${who}: order before the advance`).toBe(false);
      const half = Number(proforma.proforma.advanceAmount) / 2;
      expectOffered(
        await receivePaymentAction({ proformaId, amount: half, method: "BKASH" }),
        proforma.can.receive,
        `${who}: receive part of the advance`,
      );
      if (!proforma.can.receive) {
        await payments.receivePayment(env.owner, { proformaId, amount: half, method: "BKASH" });
      }

      // With money held, cancelling needs Accounts' keys to settle it, and refunds are Accounts'.
      const held = data(await getProformaScreenAction(proformaId), who);
      expect(held.held, who).toBe(half.toFixed(2));
      if (held.can.refundKinds.length > 0) {
        const refunded = await refundBuyerAction({
          proformaId,
          kind: held.can.refundKinds[0],
          method: "CASH",
          amount: 100,
          reason: "Paid twice by mistake",
        });
        expectOffered(refunded, true, `${who}: refund part of the advance`);
        const withRefund = data(await getProformaScreenAction(proformaId), who);
        const refund = withRefund.proforma.refunds[0]!;
        expectOffered(
          await voidRefundAction(refund.id, { reason: "Recorded on the wrong proforma" }),
          refund.can.void,
          `${who}: void the refund`,
        );
      } else {
        expectOffered(
          await refundBuyerAction({
            proformaId,
            kind: "CASH",
            method: "CASH",
            amount: 100,
            reason: "Paid twice by mistake",
          }),
          false,
          `${who}: refund`,
        );
      }
      expectOffered(
        await cancelProformaAction(proformaId, {
          reason: "Buyer withdrew",
          ...(held.can.settleKinds.length > 0 ? { settle: { kind: "CREDIT" as const } } : {}),
        }),
        held.can.cancel,
        `${who}: cancel the proforma`,
      );
      expect(held.can.cancel, who).toBe(who === "owner");
      expect(held.notes.cancel !== null, `${who}: why not cancel`).toBe(who === "sales");
    }

    // An advance paid in full lets the order be made from it, by people who take orders.
    const accepted = await quotationIn(env, "ACCEPTED");
    const p = await proformas.convertQuotationToProforma(env.owner, accepted.id, {});
    await payments.receivePayment(env.owner, {
      proformaId: p.id,
      amount: Number(p.advanceAmount),
      method: "BANK_TRANSFER",
    });
    for (const who of ["accounts", "store", "sales"] as const) {
      await as(env, who);
      const screen = data(await getProformaScreenAction(p.id), who);
      expect((await getOrderFormAction({ proformaId: p.id })).ok, who).toBe(screen.can.convert);
      expectOffered(
        await convertProformaToOrderAction(p.id, {
          matrix: [
            {
              styleId: env.style.id,
              quantities: { [env.sku("White", "S")]: 10, [env.sku("White", "M")]: 10 },
            },
          ],
        }),
        screen.can.convert,
        `${who}: make the order`,
      );
    }
  }, 120_000);

  it("offers order changes exactly to the people the actions let make them", async () => {
    const env = await shop();
    for (const who of ["owner", "sales", "store", "accounts"] as const) {
      const ctx = await as(env, who);

      // An order without an invoice: editable, and an invoice may be issued.
      const fresh = await orderFor(env, { documents: { invoice: false } });
      let screen = data(await getOrderScreenAction(fresh.id), who);
      expectOffered(
        await updateOrderAction(fresh.id, { notes: "Pack in fives" }),
        screen.can.edit,
        `${who}: edit`,
      );
      expectOffered(
        await setOrderShipmentDateAction(fresh.id, { shipmentDate: "2099-01-31" }),
        screen.can.shipmentDate,
        `${who}: ship-by day`,
      );
      expectOffered(
        await receivePaymentAction({ orderId: fresh.id, amount: 500, method: "CASH" }),
        screen.can.receive,
        `${who}: receive an advance`,
      );
      if (!screen.can.receive) {
        await payments.receivePayment(env.owner, {
          orderId: fresh.id,
          amount: 500,
          method: "CASH",
        });
      }
      screen = data(await getOrderScreenAction(fresh.id), who);
      expect(screen.can.refundKinds, who).toEqual(
        who === "owner" || who === "accounts" ? ["CASH", "CREDIT", "FORFEIT"] : [],
      );
      if (screen.can.refundKinds.length > 0) {
        expectOffered(
          await refundBuyerAction({
            orderId: fresh.id,
            kind: "CREDIT",
            amount: 200,
            reason: "Kept as credit for the next order",
          }),
          true,
          `${who}: refund as credit`,
        );
      }
      expectOffered(
        await issueInvoiceAction(fresh.id, {}),
        screen.can.issueInvoice,
        `${who}: issue the invoice`,
      );
      if (!screen.can.issueInvoice) await documents.issueInvoice(env.owner, fresh.id, {});

      // Invoiced: no more edits; packing, delivery and voiding as the screen says.
      screen = data(await getOrderScreenAction(fresh.id), who);
      expect(screen.can.edit, `${who}: edit after invoicing`).toBe(false);
      expect(await updateOrderAction(fresh.id, { notes: "x" }).then((r) => r.ok), who).toBe(false);
      expectOffered(
        await createPackingListAction(fresh.id, { cartons: 1 }),
        screen.can.packingList,
        `${who}: packing list`,
      );
      expectOffered(
        await createDeliveryChallanAction(fresh.id, {
          items: [{ variantId: env.sku("Navy", "S"), quantity: 1 }],
        }),
        screen.can.challan,
        `${who}: deliver part`,
      );
      screen = data(await getOrderScreenAction(fresh.id), who);
      expectOffered(
        await voidInvoiceAction(screen.order.invoice!.id, { reason: "Wrong buyer name" }),
        screen.can.voidInvoice,
        `${who}: void the invoice`,
      );
      expect(screen.can.voidInvoice, who).toBe(who === "owner");

      // Cancelling: only before anything is delivered; an invoice needs voiding rights.
      const other = await orderFor(env);
      const otherScreen = data(await getOrderScreenAction(other.id), who);
      expectOffered(
        await cancelOrderAction(other.id, { reason: "Buyer cancelled" }),
        otherScreen.can.cancel,
        `${who}: cancel`,
      );
      expect(otherScreen.can.cancel, who).toBe(who === "owner");
      expect(otherScreen.notes.cancel !== null, `${who}: why not cancel`).toBe(who === "sales");

      // Money at checkout and Force Override are offered only to the people who hold them.
      const form = await getOrderFormAction({});
      if (form.ok) {
        expect(form.data.can.takePayment, who).toBe(ctx.can("accounts.receipts.record"));
        expect(form.data.can.forceOverride, who).toBe(ctx.can("sales.force_override"));
        const beyond = await createOrderAction({
          channel: "POS",
          matrix: [{ styleId: env.style.id, quantities: { [env.sku("White", "L")]: 5000 } }],
          forceOverride: { reason: "Made to order next week" },
          documents: { invoice: false },
        });
        expectOffered(beyond, form.data.can.forceOverride, `${who}: sell beyond stock`);
        const paidAtCounter = await createOrderAction({
          channel: "POS",
          matrix: [{ styleId: env.style.id, quantities: { [env.sku("Navy", "L")]: 1 } }],
          payment: { amount: 1450, method: "CASH" },
        });
        expectOffered(paidAtCounter, form.data.can.takePayment, `${who}: paid at the counter`);
      } else {
        expect(form.error.code, who).toBe("FORBIDDEN");
        expectOffered(
          await createOrderAction({
            channel: "POS",
            matrix: [{ styleId: env.style.id, quantities: { [env.sku("White", "L")]: 1 } }],
          }),
          false,
          `${who}: take an order`,
        );
      }
    }
  }, 180_000);

  it("records money on account only for Accounts and Super Admin", async () => {
    const env = await shop();
    for (const who of Object.keys(ROLES) as Who[]) {
      const ctx = await as(env, who);
      const receive = ctx.can("accounts.receipts.record");
      const list = await getPaymentListAction({});
      if (list.ok) expect(list.data.canReceive, who).toBe(receive);
      const buyers = await findBuyersAction({ search: "Rahim", purpose: "PAYMENT" });
      expect(buyers.ok, who).toBe(receive);
      expectOffered(
        await receivePaymentAction({ partyId: env.buyer.id, amount: 250, method: "CHEQUE" }),
        receive,
        `${who}: payment on account`,
      );
      expect(receive, who).toBe(who === "owner" || who === "accounts");
    }
  }, 60_000);

  it("drafts a quotation from the builder's input and opens it", async () => {
    const env = await shop();
    await as(env, "sales");
    const form = data(await getQuotationFormAction(), "form");
    expect(form.quotation).toBeNull();
    expect(form.sizes.map((s) => s.name)).toEqual(["S", "M", "L"]);
    const created = data(
      await createQuotationAction({
        partyId: env.buyer.id,
        validUntil: null,
        items: [
          {
            styleId: env.style.id,
            categoryId: null,
            description: "Classic Polo",
            fabric: null,
            colorNote: "Navy",
            sizeBreakdown: { S: 5, M: 10 },
            unitPrice: 880,
          },
        ],
        stylingRules: [{ area: "Chest", instruction: "Logo on the left chest" }],
        discount: 0,
        tax: 0,
        terms: null,
        notes: null,
        customFields: {},
      }),
      "create",
    );
    expect(Object.keys(created).sort()).toEqual(["id", "number"]);
    const screen = data(await getQuotationScreenAction(created.id), "screen");
    expect(screen.quotation.total).toBe("13200.00");
    expect(screen.quotation.items[0]!.sizes).toEqual([
      { size: "S", quantity: 5 },
      { size: "M", quantity: 10 },
    ]);
    const editing = data(await getQuotationFormAction(created.id), "edit form");
    expect(editing.quotation?.items[0]?.unitPrice).toBe("880.00");
  }, 60_000);
});
