import { CustomFieldEntity } from "@prisma/client";

import { apiRoute, readJson } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as customFields from "@/modules/sales/custom-fields.service";

export const dynamic = "force-dynamic";

/** GET /api/sales/custom-fields?entity=QUOTATION&includeInactive=true */
export const GET = apiRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  const entity = params.get("entity");
  return customFields.listCustomFields(
    await requirePermission("sales.view"),
    customFieldEntity(entity),
    params.get("includeInactive") === "true",
  );
});

/** POST /api/sales/custom-fields — { entity, key, label, fieldType, options?, isRequired? } */
export const POST = apiRoute(
  async (request) =>
    customFields.createCustomField(
      await requirePermission("company.settings"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);

function customFieldEntity(value: string | null) {
  if (!value) return undefined;
  return CustomFieldEntity[value as keyof typeof CustomFieldEntity] ?? invalidEntity();
}

function invalidEntity(): never {
  throw new AppError("VALIDATION", "Unknown custom field entity.");
}
