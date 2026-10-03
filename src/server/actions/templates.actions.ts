"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireCompany, requirePermission } from "@/modules/auth/context";
import { fileFromForm, formFields } from "@/modules/files/file.service";
import * as templates from "@/modules/templates/template.service";

/*
 * Document template Server Actions. templates.manage uploads, maps and changes
 * templates; whoever may print a document type sees its active templates and
 * fills them. Each returns { ok: true, data } or { ok: false, error }.
 */

const manage = () => requirePermission("templates.manage");

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
  runAction(async () => {
    const ctx = await manage();
    return templates.uploadTemplate(
      ctx,
      formFields(form),
      await fileFromForm(form),
      await getRequestMeta(),
    );
  });
export const createHtmlTemplateAction = async (input: unknown) =>
  runAction(async () =>
    templates.createHtmlTemplate(await manage(), input, await getRequestMeta()),
  );
export const replaceTemplateFileAction = async (templateId: string, form: FormData) =>
  runAction(async () => {
    const ctx = await manage();
    return templates.replaceTemplateFile(
      ctx,
      templateId,
      await fileFromForm(form),
      await getRequestMeta(),
    );
  });
export const updateTemplateAction = async (templateId: string, input: unknown) =>
  runAction(async () =>
    templates.updateTemplate(await manage(), templateId, input, await getRequestMeta()),
  );
export const setTemplatePlaceholdersAction = async (templateId: string, input: unknown) =>
  runAction(async () =>
    templates.setPlaceholders(await manage(), templateId, input, await getRequestMeta()),
  );
export const deleteTemplateAction = async (templateId: string) =>
  runAction(async () =>
    templates.deleteTemplate(await manage(), templateId, await getRequestMeta()),
  );
export const fillTemplateAction = async (templateId: string, input: unknown) =>
  runAction(async () =>
    templates.fillTemplate(await requireCompany(), templateId, input, await getRequestMeta()),
  );
