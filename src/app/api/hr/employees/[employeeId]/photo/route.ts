import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { requireCompany } from "@/modules/auth/context";
import { getEmployeePhoto } from "@/modules/hr/directory.service";

type Params = { employeeId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/employees/:employeeId/photo?v=:photoId — the employee's photo (their newest
 * picture "Photo" paper) for anyone who sees employees and for the employee. With `v` (the
 * paper's id, as the directory links it) the browser keeps it, since that paper never changes;
 * a new photo gets a new address.
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { employeeId } = await context.params;
    const version = new URL(request.url).searchParams.get("v");
    const photo = await getEmployeePhoto(await requireCompany(), employeeId, version);
    const response = fileResponse(photo.file, "inline");
    response.headers.set(
      "Cache-Control",
      version ? "private, max-age=31536000, immutable" : "private, no-cache",
    );
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
