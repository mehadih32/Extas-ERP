"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as screens from "@/modules/inventory/screens.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";

/*
 * Inventory Server Actions. Reads need `inventory.view`; every change needs
 * `inventory.manage`. Each returns { ok: true, data } or { ok: false, error }.
 * Changes refresh the screens, so lists, the matrix and the dashboard's stock
 * figures show them straight away.
 */

const view = () => requirePermission("inventory.view");
const manage = () => requirePermission("inventory.manage");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

// --- Screens -----------------------------------------------------------------------
export const getCatalogSetupAction = async () =>
  runAction(async () => screens.getCatalogSetup(await view()));
export const getStyleListAction = async (query: unknown) =>
  runAction(async () => screens.getStyleList(await view(), query));
export const listStyleCardsAction = async (query: unknown) =>
  runAction(async () => screens.listStyleCards(await view(), query));
export const getStyleFormAction = async (styleId?: string) =>
  runAction(async () => screens.getStyleForm(await view(), styleId));
export const getStyleScreenAction = async (styleId: string, warehouseId?: string) =>
  runAction(async () => screens.getStyleScreen(await view(), styleId, { warehouseId }));
export const getVariantDetailsAction = async (variantId: string) =>
  runAction(async () => screens.getVariantDetails(await view(), variantId));
/** The count sheet is for people who may record counts, as recordStockCountAction is. */
export const getStockCountSheetAction = async (query: unknown) =>
  runAction(async () => screens.getStockCountSheet(await manage(), query));

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
  change(async () => catalog.createCategory(await manage(), input, await getRequestMeta()));
export const updateCategoryAction = async (id: string, input: unknown) =>
  change(async () => catalog.updateCategory(await manage(), id, input, await getRequestMeta()));
export const deleteCategoryAction = async (id: string) =>
  change(async () => catalog.deleteCategory(await manage(), id, await getRequestMeta()));

// --- Brands ----------------------------------------------------------------------
export const createBrandAction = async (input: unknown) =>
  change(async () => catalog.createBrand(await manage(), input, await getRequestMeta()));
export const updateBrandAction = async (id: string, input: unknown) =>
  change(async () => catalog.updateBrand(await manage(), id, input, await getRequestMeta()));
export const deleteBrandAction = async (id: string) =>
  change(async () => catalog.deleteBrand(await manage(), id, await getRequestMeta()));

// --- Colors & sizes --------------------------------------------------------------
export const createColorAction = async (input: unknown) =>
  change(async () => catalog.createColor(await manage(), input, await getRequestMeta()));
export const updateColorAction = async (id: string, input: unknown) =>
  change(async () => catalog.updateColor(await manage(), id, input, await getRequestMeta()));
export const deleteColorAction = async (id: string) =>
  change(async () => catalog.deleteColor(await manage(), id, await getRequestMeta()));
export const createSizeAction = async (input: unknown) =>
  change(async () => catalog.createSize(await manage(), input, await getRequestMeta()));
export const updateSizeAction = async (id: string, input: unknown) =>
  change(async () => catalog.updateSize(await manage(), id, input, await getRequestMeta()));
export const reorderSizesAction = async (input: unknown) =>
  change(async () => catalog.reorderSizes(await manage(), input, await getRequestMeta()));
export const deleteSizeAction = async (id: string) =>
  change(async () => catalog.deleteSize(await manage(), id, await getRequestMeta()));

// --- Styles & matrix -------------------------------------------------------------
export const createStyleAction = async (input: unknown) =>
  change(async () => {
    const style = await styles.createStyle(await manage(), input, await getRequestMeta());
    return { id: style.id, code: style.code, name: style.name };
  });
export const updateStyleAction = async (id: string, input: unknown) =>
  change(async () => {
    const style = await styles.updateStyle(await manage(), id, input, await getRequestMeta());
    return { id: style.id, code: style.code, name: style.name, isActive: style.isActive };
  });
export const deleteStyleAction = async (id: string) =>
  change(async () => styles.deleteStyle(await manage(), id, await getRequestMeta()));
export const generateMatrixAction = async (styleId: string, input: unknown) =>
  change(async () => {
    const result = await matrix.generateMatrix(
      await manage(),
      styleId,
      input,
      await getRequestMeta(),
    );
    return { created: result.created };
  });
export const updateVariantAction = async (variantId: string, input: unknown) =>
  change(async () => {
    const variant = await matrix.updateVariant(
      await manage(),
      variantId,
      input,
      await getRequestMeta(),
    );
    return { id: variant.id, sku: variant.sku };
  });

// --- Ratio presets ---------------------------------------------------------------
export const createRatioPresetAction = async (input: unknown) =>
  change(async () => matrix.createRatioPreset(await manage(), input, await getRequestMeta()));
export const updateRatioPresetAction = async (id: string, input: unknown) =>
  change(async () => matrix.updateRatioPreset(await manage(), id, input, await getRequestMeta()));
export const deleteRatioPresetAction = async (id: string) =>
  change(async () => matrix.deleteRatioPreset(await manage(), id, await getRequestMeta()));

// --- Stock -----------------------------------------------------------------------
export const listWarehousesAction = async () =>
  runAction(async () => stock.listWarehouses(await view()));
export const createWarehouseAction = async (input: unknown) =>
  change(async () => stock.createWarehouse(await manage(), input, await getRequestMeta()));
export const adjustStockAction = async (input: unknown) =>
  change(async () => stock.adjustStock(await manage(), input, await getRequestMeta()));
export const recordStockCountAction = async (input: unknown) =>
  change(async () => stock.recordStockCount(await manage(), input, await getRequestMeta()));
export const moveToBadStockAction = async (input: unknown) =>
  change(async () => stock.moveToBadStock(await manage(), input, await getRequestMeta()));
export const listBadStockAction = async (query: unknown) =>
  runAction(async () => stock.listBadStock(await view(), query));
export const listStockMovementsAction = async (query: unknown) =>
  runAction(async () => stock.listMovements(await view(), query));
export const getStockSummaryAction = async () =>
  runAction(async () => stock.getStockSummary(await view()));
