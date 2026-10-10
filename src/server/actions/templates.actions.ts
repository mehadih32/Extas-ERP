"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireCompany, requirePermission } from "@/modules/auth/context";
import { fileFromForm, formFields } from "@/modules/files/file.service";
import * as screens from "@/modules/reports/screens.service";
import * as templates from "@/modules/templates/template.service";
import { isTemplateType } from "@/modules/templates/tags";

/*
 * Document template Server Actions. templates.manage uploads, maps and changes
 * templates; whoever may print a document type sees its active templates and
 * fills them. Each returns { ok: true, data } or { ok: false, error }. Changes
 * refresh the screens and hand back the template's id and name only.
 */

const manage = () => requirePermission("templates.manage");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

const templateRef = (t: { id: string; name: string }) => ({ id: t.id, name: t.name });

export const listTemplatesAction = async (query: unknown = {}) =>
  runAction(async () => templates.listTemplates(await requireCompany(), query));
export const getTemplateAction = async (templateId: string) =>
  runAction(async () => templates.getTemplate(await requireCompany(), templateId));
export const templateCatalogAction = async (documentType: string) =>
  runAction(async () => {
    await requireCompany();
    return templates.tagCatalog(documentType);
  });
/** The form needs `file` (.docx, HTML, PDF, JPG or PNG), `name`, `documentType` and `isDefault`. */
export const uploadTemplateAction = async (form: FormData) =>
  change(async () => {
    const ctx = await manage();
    return templateRef(
      await templates.uploadTemplate(
        ctx,
        formFields(form),
        await fileFromForm(form),
        await getRequestMeta(),
      ),
    );
  });
export const createHtmlTemplateAction = async (input: unknown) =>
  change(async () =>
    templateRef(await templates.createHtmlTemplate(await manage(), input, await getRequestMeta())),
  );
export const replaceTemplateFileAction = async (templateId: string, form: FormData) =>
  change(async () => {
    const ctx = await manage();
    return templateRef(
      await templates.replaceTemplateFile(
        ctx,
        templateId,
        await fileFromForm(form),
        await getRequestMeta(),
      ),
    );
  });
export const updateTemplateAction = async (templateId: string, input: unknown) =>
  change(async () =>
    templateRef(
      await templates.updateTemplate(await manage(), templateId, input, await getRequestMeta()),
    ),
  );
export const setTemplatePlaceholdersAction = async (templateId: string, input: unknown) =>
  change(async () =>
    templateRef(
      await templates.setPlaceholders(await manage(), templateId, input, await getRequestMeta()),
    ),
  );
export const deleteTemplateAction = async (templateId: string) =>
  change(async () => templates.deleteTemplate(await manage(), templateId, await getRequestMeta()));
/** Fills a template and keeps the file with the printed documents (download it from there). */
export const fillTemplateAction = async (templateId: string, input: unknown) =>
  change(async () => {
    const filled = await templates.fillTemplate(
      await requireCompany(),
      templateId,
      input,
      await getRequestMeta(),
    );
    return {
      id: filled.id,
      title: filled.title,
      isPdf: filled.mimeType === "application/pdf",
      reused: filled.reused,
    };
  });

// --- Screens -----------------------------------------------------------------------------

export const getTemplatesScreenAction = async () =>
  runAction(async () => screens.getTemplatesScreen(await manage()));
export const getTemplateScreenAction = async (templateId: string) =>
  runAction(async () => screens.getTemplateScreen(await manage(), templateId));
/** Buyers and suppliers to address a letter to (parties.view). */
export const findLetterPartiesAction = async (query: unknown) =>
  runAction(async () => screens.findLetterParties(await requireCompany(), query));
/** The active templates a document of this type can be filled from (none when it may not be printed). */
export const templateChoicesAction = async (documentType: string) =>
  runAction(async () => {
    const ctx = await requireCompany();
    return isTemplateType(documentType) ? screens.templateChoices(ctx, documentType) : [];
  });
