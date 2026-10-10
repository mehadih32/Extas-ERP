"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission } from "@/modules/auth/context";
import * as printing from "@/modules/documents/print.service";
import * as screens from "@/modules/reports/screens.service";

/*
 * Printed document Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 * Each document type needs its own permission (see print.service.ts). The PDF downloads from
 * GET /api/documents/:documentId/download (?inline=1 opens it in the browser). Printing
 * refreshes the screens, so the list of printed documents shows the new copy.
 */

const printer = () => requireAnyPermission(...printing.PRINT_PERMISSIONS);

export const printDocumentAction = async (input: unknown) =>
  runAction(async () => {
    const printed = await printing.printDocument(await printer(), input, await getRequestMeta());
    revalidatePath("/", "layout");
    return printed;
  });
export const listDocumentsAction = async (query: unknown) =>
  runAction(async () => printing.listDocuments(await printer(), query));
export const getDocumentAction = async (documentId: string) =>
  runAction(async () => printing.getDocument(await printer(), documentId));

// --- Screens -----------------------------------------------------------------------------

export const getDocumentsScreenAction = async (query: unknown = {}) =>
  runAction(async () => screens.getDocumentsScreen(await printer(), query));
export const listDocumentRowsAction = async (query: unknown) =>
  runAction(async () => screens.listDocumentRows(await printer(), query));
