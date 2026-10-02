"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as issues from "@/modules/materials/issue.service";
import * as materials from "@/modules/materials/material.service";
import * as orders from "@/modules/materials/purchase-order.service";
import * as purchases from "@/modules/materials/purchase.service";
import * as returns from "@/modules/materials/supplier-return.service";

/*
 * Raw materials Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 *   materials.view            stock, stock cards, purchase orders, issue notes
 *   materials.manage          the store: materials, counts, wastage, transfers, issues to
 *                             production and returns from it
 *   materials.purchase        purchase orders, Due bills, returns to suppliers, opening stock
 *   accounts.payments.record  purchases paid now and paying bills (Accounts)
 *   accounts.manage           voiding purchases and returns, opening stock (Accounts)
 * Prices and values are shown to materials.purchase, production.manage and accounts.view
 * holders only. Services check these permissions themselves too.
 */

const view = () => requirePermission("materials.view");
const store = () => requirePermission("materials.manage");
const buy = () => requirePermission("materials.purchase");
const catalogue = () => requireAnyPermission("materials.manage", "materials.purchase");
const buyOrAccounts = () => requireAnyPermission("materials.purchase", "accounts.manage");

// --- Materials and the store ---------------------------------------------------------
export const listMaterialsAction = async (query: unknown) =>
  runAction(async () => materials.listMaterials(await view(), query));
export const getMaterialsSummaryAction = async () =>
  runAction(async () => materials.getMaterialsSummary(await view()));
export const getMaterialAction = async (materialId: string) =>
  runAction(async () => materials.getMaterial(await view(), materialId));
export const createMaterialAction = async (input: unknown) =>
  runAction(async () => materials.createMaterial(await catalogue(), input, await getRequestMeta()));
export const updateMaterialAction = async (materialId: string, input: unknown) =>
  runAction(async () =>
    materials.updateMaterial(await catalogue(), materialId, input, await getRequestMeta()),
  );
export const getStockCardAction = async (materialId: string, query: unknown) =>
  runAction(async () => materials.getStockCard(await view(), materialId, query));
export const listMaterialMovementsAction = async (query: unknown) =>
  runAction(async () => materials.listMovements(await view(), query));
export const addOpeningStockAction = async (materialId: string, input: unknown) =>
  runAction(async () =>
    materials.addOpeningStock(await buyOrAccounts(), materialId, input, await getRequestMeta()),
  );
export const countMaterialAction = async (materialId: string, input: unknown) =>
  runAction(async () =>
    materials.countStock(await store(), materialId, input, await getRequestMeta()),
  );
export const recordWastageAction = async (materialId: string, input: unknown) =>
  runAction(async () =>
    materials.recordWastage(await store(), materialId, input, await getRequestMeta()),
  );
export const transferMaterialAction = async (materialId: string, input: unknown) =>
  runAction(async () =>
    materials.transferStock(await store(), materialId, input, await getRequestMeta()),
  );

// --- Purchase orders -------------------------------------------------------------------
export const listPurchaseOrdersAction = async (query: unknown) =>
  runAction(async () => orders.listPurchaseOrders(await view(), query));
export const getPurchaseOrderAction = async (orderId: string) =>
  runAction(async () => orders.getPurchaseOrder(await view(), orderId));
export const createPurchaseOrderAction = async (input: unknown) =>
  runAction(async () => orders.createPurchaseOrder(await buy(), input, await getRequestMeta()));
export const updatePurchaseOrderAction = async (orderId: string, input: unknown) =>
  runAction(async () =>
    orders.updatePurchaseOrder(await buy(), orderId, input, await getRequestMeta()),
  );
export const cancelPurchaseOrderAction = async (orderId: string, input: unknown) =>
  runAction(async () =>
    orders.cancelPurchaseOrder(await buy(), orderId, input, await getRequestMeta()),
  );
export const closePurchaseOrderAction = async (orderId: string, input: unknown) =>
  runAction(async () =>
    orders.closePurchaseOrder(await buy(), orderId, input, await getRequestMeta()),
  );

// --- Purchases (supplier bills) and returns to suppliers ------------------------------
export const listPurchasesAction = async (query: unknown) =>
  runAction(async () => purchases.listPurchases(await view(), query));
export const getPurchaseAction = async (billId: string) =>
  runAction(async () => purchases.getPurchase(await view(), billId));
export const createPurchaseAction = async (input: unknown) =>
  runAction(async () =>
    purchases.createPurchase(
      await requireAnyPermission("materials.purchase", "accounts.payments.record"),
      input,
      await getRequestMeta(),
    ),
  );
export const payPurchaseAction = async (billId: string, input: unknown) =>
  runAction(async () =>
    purchases.payPurchase(
      await requirePermission("accounts.payments.record"),
      billId,
      input,
      await getRequestMeta(),
    ),
  );
export const voidPurchaseAction = async (billId: string, input: unknown) =>
  runAction(async () =>
    purchases.voidPurchase(await buyOrAccounts(), billId, input, await getRequestMeta()),
  );
export const listSupplierReturnsAction = async (query: unknown) =>
  runAction(async () => returns.listSupplierReturns(await view(), query));
export const getSupplierReturnAction = async (returnId: string) =>
  runAction(async () => returns.getSupplierReturn(await view(), returnId));
export const createSupplierReturnAction = async (input: unknown) =>
  runAction(async () =>
    returns.createSupplierReturn(await buyOrAccounts(), input, await getRequestMeta()),
  );
export const voidSupplierReturnAction = async (returnId: string, input: unknown) =>
  runAction(async () =>
    returns.voidSupplierReturn(await buyOrAccounts(), returnId, input, await getRequestMeta()),
  );

// --- Issues to production and returns from it -----------------------------------------
export const listMaterialIssuesAction = async (query: unknown) =>
  runAction(async () => issues.listIssues(await view(), query));
export const getMaterialIssueAction = async (issueId: string) =>
  runAction(async () => issues.getIssue(await view(), issueId));
export const issueToProductionAction = async (input: unknown) =>
  runAction(async () => issues.issueToProduction(await store(), input, await getRequestMeta()));
export const returnFromProductionAction = async (input: unknown) =>
  runAction(async () => issues.returnFromProduction(await store(), input, await getRequestMeta()));
export const getProjectMaterialsAction = async (projectId: string) =>
  runAction(async () =>
    issues.getProjectMaterials(
      await requireAnyPermission("materials.view", "production.view"),
      projectId,
    ),
  );
