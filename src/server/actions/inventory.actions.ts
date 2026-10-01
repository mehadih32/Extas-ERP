"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";

/*
 * Inventory Server Actions. Reads need `inventory.view`; every change needs
 * `inventory.manage`. Each returns { ok: true, data } or { ok: false, error }.
 */

const view = () => requirePermission("inventory.view");
const manage = () => requirePermission("inventory.manage");

// --- Catalog reads -------------------------------------------------------------
export const getInventoryTreeAction = async () =>
  runAction(async () => styles.getInventoryTree(await view()));
export const listCategoriesAction = async () =>
  runAction(async () => catalog.listCategoryTree(await view()));
export const listBrandsAction = async () => runAction(async () => catalog.listBrands(await view()));
export const listColorsAction = async () => runAction(async () => catalog.listColors(await view()));
export const listSizesAction = async () => runAction(async () => catalog.listSizes(await view()));
export const listStylesAction = async (query: unknown) =>
  runAction(async () => styles.listStyles(await view(), query));
export const getStyleAction = async (styleId: string) =>
  runAction(async () => styles.getStyle(await view(), styleId));
export const getStyleMatrixAction = async (styleId: string, warehouseId?: string) =>
  runAction(async () => matrix.getStyleMatrix(await view(), styleId, { warehouseId }));
export const lookupVariantAction = async (code: string) =>
  runAction(async () => matrix.lookupVariant(await view(), code));
export const listRatioPresetsAction = async () =>
  runAction(async () => matrix.listRatioPresets(await view()));
export const ratioFillAction = async (input: unknown) =>
  runAction(async () => matrix.ratioFill(await view(), input));

// --- Categories ------------------------------------------------------------------
export const createCategoryAction = async (input: unknown) =>
  runAction(async () => catalog.createCategory(await manage(), input, await getRequestMeta()));
export const updateCategoryAction = async (id: string, input: unknown) =>
  runAction(async () => catalog.updateCategory(await manage(), id, input, await getRequestMeta()));
export const deleteCategoryAction = async (id: string) =>
  runAction(async () => catalog.deleteCategory(await manage(), id, await getRequestMeta()));

// --- Brands ----------------------------------------------------------------------
export const createBrandAction = async (input: unknown) =>
  runAction(async () => catalog.createBrand(await manage(), input, await getRequestMeta()));
export const updateBrandAction = async (id: string, input: unknown) =>
  runAction(async () => catalog.updateBrand(await manage(), id, input, await getRequestMeta()));
export const deleteBrandAction = async (id: string) =>
  runAction(async () => catalog.deleteBrand(await manage(), id, await getRequestMeta()));

// --- Colors & sizes --------------------------------------------------------------
export const createColorAction = async (input: unknown) =>
  runAction(async () => catalog.createColor(await manage(), input, await getRequestMeta()));
export const updateColorAction = async (id: string, input: unknown) =>
  runAction(async () => catalog.updateColor(await manage(), id, input, await getRequestMeta()));
export const deleteColorAction = async (id: string) =>
  runAction(async () => catalog.deleteColor(await manage(), id, await getRequestMeta()));
export const createSizeAction = async (input: unknown) =>
  runAction(async () => catalog.createSize(await manage(), input, await getRequestMeta()));
export const updateSizeAction = async (id: string, input: unknown) =>
  runAction(async () => catalog.updateSize(await manage(), id, input, await getRequestMeta()));
export const reorderSizesAction = async (input: unknown) =>
  runAction(async () => catalog.reorderSizes(await manage(), input, await getRequestMeta()));
export const deleteSizeAction = async (id: string) =>
  runAction(async () => catalog.deleteSize(await manage(), id, await getRequestMeta()));

// --- Styles & matrix -------------------------------------------------------------
export const createStyleAction = async (input: unknown) =>
  runAction(async () => styles.createStyle(await manage(), input, await getRequestMeta()));
export const updateStyleAction = async (id: string, input: unknown) =>
  runAction(async () => styles.updateStyle(await manage(), id, input, await getRequestMeta()));
export const deleteStyleAction = async (id: string) =>
  runAction(async () => styles.deleteStyle(await manage(), id, await getRequestMeta()));
export const generateMatrixAction = async (styleId: string, input: unknown) =>
  runAction(async () =>
    matrix.generateMatrix(await manage(), styleId, input, await getRequestMeta()),
  );
export const updateVariantAction = async (variantId: string, input: unknown) =>
  runAction(async () =>
    matrix.updateVariant(await manage(), variantId, input, await getRequestMeta()),
  );

// --- Ratio presets ---------------------------------------------------------------
export const createRatioPresetAction = async (input: unknown) =>
  runAction(async () => matrix.createRatioPreset(await manage(), input, await getRequestMeta()));
export const updateRatioPresetAction = async (id: string, input: unknown) =>
  runAction(async () =>
    matrix.updateRatioPreset(await manage(), id, input, await getRequestMeta()),
  );
export const deleteRatioPresetAction = async (id: string) =>
  runAction(async () => matrix.deleteRatioPreset(await manage(), id, await getRequestMeta()));

// --- Stock -----------------------------------------------------------------------
export const listWarehousesAction = async () =>
  runAction(async () => stock.listWarehouses(await view()));
export const createWarehouseAction = async (input: unknown) =>
  runAction(async () => stock.createWarehouse(await manage(), input, await getRequestMeta()));
export const adjustStockAction = async (input: unknown) =>
  runAction(async () => stock.adjustStock(await manage(), input, await getRequestMeta()));
export const moveToBadStockAction = async (input: unknown) =>
  runAction(async () => stock.moveToBadStock(await manage(), input, await getRequestMeta()));
export const listStockMovementsAction = async (query: unknown) =>
  runAction(async () => stock.listMovements(await view(), query));
export const getStockSummaryAction = async () =>
  runAction(async () => stock.getStockSummary(await view()));
