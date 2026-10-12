import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as terms from "@/modules/hr/terms.service";

export const dynamic = "force-dynamic";

/** POST /api/hr/terms/draft — opens a draft from the version in force (or the starter text). */
export const POST = apiRoute(
  async () => terms.startTermsDraft(await requirePermission("hr.manage"), await getRequestMeta()),
  { successStatus: 201 },
);

/** PUT /api/hr/terms/draft — { title, intro?, sections: [{ title, body }] }: saves the draft. */
export const PUT = apiRoute(async (request) =>
  terms.saveTermsDraft(
    await requirePermission("hr.manage"),
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/hr/terms/draft — throws the draft away. */
export const DELETE = apiRoute(async () =>
  terms.discardTermsDraft(await requirePermission("hr.manage"), await getRequestMeta()),
);
