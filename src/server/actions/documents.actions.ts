"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as printing from "@/modules/documents/print.service";
import * as sending from "@/modules/documents/send.service";
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
/** Page 1 of an invoice as data, for the browser to draw as a picture to share. */
export const documentPictureAction = async (input: unknown) =>
  runAction(async () => printing.documentPicture(await printer(), input, await getRequestMeta()));
export const listDocumentsAction = async (query: unknown) =>
  runAction(async () => printing.listDocuments(await printer(), query));
export const getDocumentAction = async (documentId: string) =>
  runAction(async () => printing.getDocument(await printer(), documentId));

// --- Screens -----------------------------------------------------------------------------

export const getDocumentsScreenAction = async (query: unknown = {}) =>
  runAction(async () => screens.getDocumentsScreen(await printer(), query));
export const listDocumentRowsAction = async (query: unknown) =>
  runAction(async () => screens.listDocumentRows(await printer(), query));

// --- Sending to buyers (documents/send.service.ts): only when the person presses Send ------

const sender = () => requirePermission("documents.send");

export const sendDocumentByEmailAction = async (input: unknown) =>
  runAction(async () => {
    const sent = await sending.sendDocumentByEmail(await sender(), input, await getRequestMeta());
    revalidatePath("/", "layout");
    return sent;
  });
export const createWhatsAppLinkAction = async (input: unknown) =>
  runAction(async () => {
    const made = await sending.createWhatsAppLink(await sender(), input, await getRequestMeta());
    revalidatePath("/", "layout");
    return made;
  });
export const recordShareAction = async (input: unknown) =>
  runAction(async () => sending.recordShare(await sender(), input, await getRequestMeta()));
export const stopDocumentLinkAction = async (linkId: string) =>
  runAction(async () => {
    const stopped = await sending.stopDocumentLink(await sender(), linkId, await getRequestMeta());
    revalidatePath("/", "layout");
    return stopped;
  });
/** Whether email can go yet, and whether this person can set it up (AI Center > Settings). */
export const documentSendSetupAction = async () =>
  runAction(async () => {
    const ctx = await sender();
    return {
      emailReady: await sending.emailReady(ctx.company.id),
      canSetUpEmail: ctx.can("ai.manage"),
    };
  });
export const listDocumentSendsAction = async (query: unknown) =>
  runAction(async () => sending.listDocumentSends(await printer(), query));
