import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as payments from "@/modules/accounts/supplier-payment.service";

export const dynamic = "force-dynamic";

/** GET /api/accounts/supplier-payments?supplierId=&from=&to=&cursor=&take= — money paid to suppliers. */
export const GET = apiRoute(async (request) =>
  payments.listSupplierPayments(
    await requireAnyPermission("accounts.view", "accounts.payments.record"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/accounts/supplier-payments — { supplierId, amount, paymentDate?, method?, accountId?,
 * reference?, notes? }: pays a supplier on account; settles their oldest open bills.
 */
export const POST = apiRoute(
  async (request) =>
    payments.paySupplier(
      await requirePermission("accounts.payments.record"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
