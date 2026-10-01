import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as customFields from "@/modules/sales/custom-fields.service";

type Params = { fieldId: string };

export const dynamic = "force-dynamic";

/** PATCH /api/sales/custom-fields/:fieldId — label, options, required, order, { isActive: false } */
export const PATCH = apiRoute<Params>(async (request, { fieldId }) =>
  customFields.updateCustomField(
    await requirePermission("company.settings"),
    fieldId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
