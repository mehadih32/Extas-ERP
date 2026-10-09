"use server";

import type { MaterialIssueKind } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as files from "@/modules/files/file.service";
import * as issues from "@/modules/materials/issue.service";
import * as materials from "@/modules/materials/material.service";
import * as orders from "@/modules/materials/purchase-order.service";
import * as purchases from "@/modules/materials/purchase.service";
import * as screens from "@/modules/materials/screens.service";
import * as returns from "@/modules/materials/supplier-return.service";

/*
 * Raw materials Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 *   materials.view            stock, stock cards, purchase orders, issue notes
 *   materials.manage          the store: materials, counts, wastage, transfers, issues to
 *                             production and returns from it
 *   materials.purchase        purchase orders, Due bills, returns to suppliers, opening stock
 *   accounts.payments.record  purchases paid now and paying bills (Accounts)
 *   accounts.manage           voiding purchases and returns, opening stock (Accounts)
 * Prices and values are shown to materials.purchase, production.manage and accounts
 * holders only. Services check these permissions themselves too. Changes refresh
 * the screens and hand back the record's id and code or number only: the full
 * records carry Decimal amounts, which do not cross to the browser.
 */

const view = () => requirePermission("materials.view");
const store = () => requirePermission("materials.manage");
const buy = () => requirePermission("materials.purchase");
const catalogue = () => requireAnyPermission("materials.manage", "materials.purchase");
const buyOrAccounts = () => requireAnyPermission("materials.purchase", "accounts.manage");
const receive = () => requireAnyPermission("materials.purchase", "accounts.payments.record");
/** The material search on the order, bill and issue forms. */
const pickMaterials = () =>
  requireAnyPermission(
    "materials.view",
    "materials.manage",
    "materials.purchase",
    "accounts.payments.record",
  );
/** The supplier search: a material's usual supplier, an order's, a bill's. */
const pickSuppliers = () =>
  requireAnyPermission("materials.manage", "materials.purchase", "accounts.payments.record");
const pickProjects = () => requireAnyPermission("materials.manage", "materials.purchase");

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
const materialRef = (m: { id: string; code: string; name: string }) => ({
  id: m.id,
  code: m.code,
  name: m.name,
});
type CardQuery = { from?: string; to?: string; store?: string };

// --- Screens ---------------------------------------------------------------------------
export const getMaterialsOverviewScreenAction = async () =>
  runAction(async () => screens.getOverviewScreen(await view()));
export const getMaterialListAction = async (query: unknown) =>
  runAction(async () => screens.getMaterialList(await view(), query));
export const listMaterialRowsAction = async (query: unknown) =>
  runAction(async () => screens.listMaterialRows(await view(), query));
export const getMaterialScreenAction = async (materialId: string, query: CardQuery = {}) =>
  runAction(async () => screens.getMaterialScreen(await view(), materialId, query));
export const getMaterialFormAction = async (materialId?: string) =>
  runAction(async () => screens.getMaterialForm(await catalogue(), materialId));
export const findMaterialsAction = async (query: { search?: string }) =>
  runAction(async () => screens.findMaterials(await pickMaterials(), query));
export const findMaterialSuppliersAction = async (query: { search?: string }) =>
  runAction(async () => screens.findSuppliers(await pickSuppliers(), query));
export const findMaterialProjectsAction = async (query: { search?: string }) =>
  runAction(async () => screens.findProjects(await pickProjects(), query));
export const getOrderListAction = async (
  query: { supplierId?: string; materialId?: string } & Record<string, unknown>,
) => runAction(async () => screens.getOrderList(await view(), query));
export const listOrderRowsAction = async (query: unknown) =>
  runAction(async () => screens.listOrderRows(await view(), query));
export const getOrderScreenAction = async (orderId: string) =>
  runAction(async () => screens.getOrderScreen(await view(), orderId));
export const getOrderFormAction = async (
  options: { orderId?: string; materialId?: string; supplierId?: string; projectId?: string } = {},
) => runAction(async () => screens.getOrderForm(await buy(), options));
export const getPurchaseListAction = async (query: unknown) =>
  runAction(async () => screens.getPurchaseList(await view(), query));
export const listPurchaseRowsAction = async (query: unknown) =>
  runAction(async () => screens.listPurchaseRows(await view(), query));
export const getPurchaseScreenAction = async (billId: string) =>
  runAction(async () => screens.getPurchaseScreen(await view(), billId));
export const getPurchaseFormAction = async (options: { orderId?: string } = {}) =>
  runAction(async () => screens.getPurchaseForm(await receive(), options));
export const getReturnListAction = async (query: Record<string, unknown>) =>
  runAction(async () => screens.getReturnList(await view(), query));
export const listReturnRowsAction = async (query: Record<string, unknown>) =>
  runAction(async () => screens.listReturnRows(await view(), { ...query, includeVoid: true }));
export const getReturnScreenAction = async (returnId: string) =>
  runAction(async () => screens.getReturnScreen(await view(), returnId));
export const getReturnFormAction = async (billId: string) =>
  runAction(async () => screens.getReturnForm(await buyOrAccounts(), billId));
export const getIssueListAction = async (query: { projectId?: string } & Record<string, unknown>) =>
  runAction(async () => screens.getIssueList(await view(), query));
export const listIssueRowsAction = async (query: unknown) =>
  runAction(async () => screens.listIssueRows(await view(), query));
export const getIssueScreenAction = async (issueId: string) =>
  runAction(async () => screens.getIssueScreen(await view(), issueId));
export const getIssueFormAction = async (options: {
  kind: MaterialIssueKind;
  projectId?: string;
}) => runAction(async () => screens.getIssueForm(await store(), options));
export const getProjectHoldingsAction = async (projectId: string) =>
  runAction(async () => screens.getProjectHoldings(await store(), projectId));
/** A production project's materials, on its Production page. */
export const getProjectMaterialsPanelAction = async (projectId: string) =>
  runAction(async () =>
    screens.getProjectMaterialsPanel(
      await requireAnyPermission("materials.view", "production.view"),
      projectId,
    ),
  );

// --- Materials and the store ---------------------------------------------------------
export const createMaterialAction = async (input: unknown) =>
  change(async () =>
    materialRef(await materials.createMaterial(await catalogue(), input, await getRequestMeta())),
  );
export const updateMaterialAction = async (materialId: string, input: unknown) =>
  change(async () =>
    materialRef(
      await materials.updateMaterial(await catalogue(), materialId, input, await getRequestMeta()),
    ),
  );
export const addOpeningStockAction = async (materialId: string, input: unknown) =>
  change(async () =>
    materialRef(
      await materials.addOpeningStock(
        await buyOrAccounts(),
        materialId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const countMaterialAction = async (materialId: string, input: unknown) =>
  change(async () =>
    materialRef(
      await materials.countStock(await store(), materialId, input, await getRequestMeta()),
    ),
  );
export const recordWastageAction = async (materialId: string, input: unknown) =>
  change(async () =>
    materialRef(
      await materials.recordWastage(await store(), materialId, input, await getRequestMeta()),
    ),
  );
export const transferMaterialAction = async (materialId: string, input: unknown) =>
  change(async () =>
    materialRef(
      await materials.transferStock(await store(), materialId, input, await getRequestMeta()),
    ),
  );

// --- Purchase orders -------------------------------------------------------------------
export const createPurchaseOrderAction = async (input: unknown) =>
  change(async () =>
    ref(await orders.createPurchaseOrder(await buy(), input, await getRequestMeta())),
  );
export const updatePurchaseOrderAction = async (orderId: string, input: unknown) =>
  change(async () =>
    ref(await orders.updatePurchaseOrder(await buy(), orderId, input, await getRequestMeta())),
  );
export const cancelPurchaseOrderAction = async (orderId: string, input: unknown) =>
  change(async () =>
    ref(await orders.cancelPurchaseOrder(await buy(), orderId, input, await getRequestMeta())),
  );
export const closePurchaseOrderAction = async (orderId: string, input: unknown) =>
  change(async () =>
    ref(await orders.closePurchaseOrder(await buy(), orderId, input, await getRequestMeta())),
  );

// --- Purchases (supplier bills) and returns to suppliers ------------------------------
/** FormData with a `file` field: a photo or PDF of the supplier's bill (10 MB max). */
export const uploadMaterialFileAction = async (form: FormData) =>
  runAction(async () => {
    const asset = await files.storeUpload(
      await receive(),
      await files.fileFromForm(form),
      await getRequestMeta(),
    );
    return { id: asset.id, fileName: asset.fileName };
  });
export const createPurchaseAction = async (input: unknown) =>
  change(async () =>
    ref(await purchases.createPurchase(await receive(), input, await getRequestMeta())),
  );
export const payPurchaseAction = async (billId: string, input: unknown) =>
  change(async () =>
    ref(
      await purchases.payPurchase(
        await requirePermission("accounts.payments.record"),
        billId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const voidPurchaseAction = async (billId: string, input: unknown) =>
  change(async () =>
    ref(await purchases.voidPurchase(await buyOrAccounts(), billId, input, await getRequestMeta())),
  );
export const createSupplierReturnAction = async (input: unknown) =>
  change(async () =>
    ref(await returns.createSupplierReturn(await buyOrAccounts(), input, await getRequestMeta())),
  );
export const voidSupplierReturnAction = async (returnId: string, input: unknown) =>
  change(async () =>
    ref(
      await returns.voidSupplierReturn(
        await buyOrAccounts(),
        returnId,
        input,
        await getRequestMeta(),
      ),
    ),
  );

// --- Issues to production and returns from it -----------------------------------------
export const issueToProductionAction = async (input: unknown) =>
  change(async () =>
    ref(await issues.issueToProduction(await store(), input, await getRequestMeta())),
  );
export const returnFromProductionAction = async (input: unknown) =>
  change(async () =>
    ref(await issues.returnFromProduction(await store(), input, await getRequestMeta())),
  );
