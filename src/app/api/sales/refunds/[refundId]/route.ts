import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as refunds from "@/modules/sales/refund.service";

type Params = { refundId: string };

export const dynamic = "force-dynamic";

/** GET /api/sales/refunds/:refundId — refund voucher. */
export const GET = apiRoute<Params>(async (_request, { refundId }) =>
  refunds.getRefund(await requirePermission("sales.view"), refundId),
);
