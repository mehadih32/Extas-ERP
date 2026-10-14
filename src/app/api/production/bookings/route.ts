import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as bookings from "@/modules/production/booking.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/bookings?search=&source=&category=&status=&batchId=&supplierId=
 * &cursor=&take= — fabric and trims bookings, newest first, with the fabric booked per
 * unit and the collar sets. Prices need materials.purchase, production.manage or
 * accounts.view.
 */
export const GET = apiRoute(async (request) =>
  bookings.listBookings(
    await requireAnyPermission("production.view", "materials.view", "materials.purchase"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/production/bookings — { source: SUPPLIER_PO | MARKET_PURCHASE, category:
 * KNITWEAR | WOVEN | OUTERWEAR | SWEATER | OTHER, supplierId, batchId?, expectedDate?,
 * supplierRef?, title?, styleRef?, garmentPieces?, deliveryPlace?, paymentTerms?,
 * termsLanguage?: EN | BN, terms?, notes?, receiveNow?, collar?: { style, extraPercent, notes?, sizes:
 * [{ label, collarLength, collarWidth, cuffLength?, cuffWidth? }], colours: [{
 * garmentColour, collarColour?, tippingColour?, pieces: [per size group] }] }, lines: [{
 * materialId | (name, kind, unit), quantity?, unitPrice?, description?, imageId?, specs?:
 * { role, fabricType, composition, colour, weight, weightUnit, dia, diaType, width,
 * construction, yarnCount, gauge, finish, size, pieces, perDozen, lossPercent } }] }.
 * A purchase order with its specification; collar and cuff lines take their quantity from
 * the matrix. receiveNow (a market purchase on its own, every item priced) also puts the
 * goods into the main store on a bill Due to the seller; `intoStock` says how that went.
 * Needs materials.purchase.
 */
export const POST = apiRoute(
  async (request) =>
    bookings.createBooking(
      await requirePermission("materials.purchase"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
