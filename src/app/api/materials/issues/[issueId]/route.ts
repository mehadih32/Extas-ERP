import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as issues from "@/modules/materials/issue.service";

type Params = { issueId: string };

export const dynamic = "force-dynamic";

/** GET /api/materials/issues/:issueId — one issue or return note with its lines. */
export const GET = apiRoute<Params>(async (_request, { issueId }) =>
  issues.getIssue(await requirePermission("materials.view"), issueId),
);
