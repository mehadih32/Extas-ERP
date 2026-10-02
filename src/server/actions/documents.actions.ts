"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission } from "@/modules/auth/context";
import * as printing from "@/modules/documents/print.service";

/*
 * Printed document Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 * Each document type needs its own permission (see print.service.ts). The PDF downloads from
 * GET /api/documents/:documentId/download (?inline=1 opens it in the browser).
 */

const printer = () => requireAnyPermission(...printing.PRINT_PERMISSIONS);

export const printDocumentAction = async (input: unknown) =>
  runAction(async () => printing.printDocument(await printer(), input, await getRequestMeta()));
export const listDocumentsAction = async (query: unknown) =>
  runAction(async () => printing.listDocuments(await printer(), query));
export const getDocumentAction = async (documentId: string) =>
  runAction(async () => printing.getDocument(await printer(), documentId));
