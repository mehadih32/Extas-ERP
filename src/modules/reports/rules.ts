import { ALLOWED, refuse, type Verdict } from "@/lib/verdict";
import { archiveTypes } from "@/modules/documents/print.service";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * Who may do what in Reports & documents. The services refuse with these
 * answers and the screens read the same ones to decide what to offer:
 *   reports      reports.export: the Report Builder and saved reports (each
 *                figure in a report needs its own permission too, catalog.ts)
 *   documents    the printed documents list: the kinds of document this person
 *                may print (print.service.ts archiveTypes)
 *   templates    templates.manage: upload, map, change and delete templates
 *   letterhead   documents.letterhead: the blank letterhead pad and letter templates
 */

type Can = { can: (permission: PermissionKey) => boolean };

export function reportsKeys(ctx: Can) {
  const documentTypes = archiveTypes(ctx);
  return {
    reports: ctx.can("reports.export"),
    documents: documentTypes.length > 0,
    documentTypes,
    templates: ctx.can("templates.manage"),
    letterhead: ctx.can("documents.letterhead"),
  };
}

/** The signed-in person, for the rule about one's own reports. */
export type Acting = { userId: string; isOwner: boolean };

/** Only the person who made a report, or a Super Admin, deletes it. */
export function mayDeleteReport(acting: Acting, report: { requestedById: string | null }): Verdict {
  if (acting.isOwner || report.requestedById === acting.userId) return ALLOWED;
  return refuse(
    "FORBIDDEN",
    "Only the person who made this report, or a Super Admin, can delete it.",
  );
}
