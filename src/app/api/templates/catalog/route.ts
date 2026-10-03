import { apiRoute } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import * as templates from "@/modules/templates/template.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/templates/catalog?documentType= — the tags a template for that document can use
 * ({BuyerName}, {InvoiceNo}, {ItemQuantity}...), what each prints, and which repeat per line.
 */
export const GET = apiRoute(async (request) => {
  await requireCompany();
  return templates.tagCatalog(new URL(request.url).searchParams.get("documentType") ?? "");
});
