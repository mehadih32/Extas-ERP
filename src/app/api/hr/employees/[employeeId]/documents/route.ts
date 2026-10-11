import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { fileFromForm, formFields, formFromRequest } from "@/modules/files/file.service";
import * as vault from "@/modules/hr/vault.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/hr/employees/:employeeId/documents — multipart/form-data with `file` (a photo or a
 * PDF, 10 MB at most), `kind` (NID, PHOTO, CERTIFICATE, CONTRACT or OTHER) and `title`
 * (optional): keeps the paper in the employee's data vault (hr.manage).
 */
export const POST = apiRoute<Params>(
  async (request, { employeeId }) => {
    const ctx = await requirePermission("hr.manage");
    const form = await formFromRequest(request);
    return vault.addEmployeeDocument(
      ctx,
      employeeId,
      formFields(form),
      await fileFromForm(form),
      await getRequestMeta(),
    );
  },
  { successStatus: 201 },
);
