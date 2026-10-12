import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as exits from "@/modules/hr/exit.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/** POST /api/hr/employees/:employeeId/certificate — makes the experience and clearance certificate again. */
export const POST = apiRoute<Params>(
  async (_request, { employeeId }) =>
    exits.remakeCertificate(
      await requirePermission("hr.manage"),
      employeeId,
      await getRequestMeta(),
    ),
  { successStatus: 202 },
);
