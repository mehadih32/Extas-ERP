import { apiRoute, readJson } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as location from "@/modules/hr/location.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/location/pings — { source: "WEB" | "ANDROID", points: [{ at, lat, lng,
 * accuracy?, speed?, battery? }] }: positions from the employee's phone while checked in (GPS
 * attendance). Answers { kept, onDuty, sendEverySeconds }; onDuty false tells the Android
 * app to stop its background service.
 */
export const POST = apiRoute(async (request) =>
  location.recordPings(await requirePermission("portal.self"), await readJson(request)),
);
