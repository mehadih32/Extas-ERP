"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireCompany } from "@/modules/auth/context";
import { fileFromForm } from "@/modules/files/file.service";
import * as leads from "@/modules/leads/lead.service";

/*
 * Leads (Sales > Leads). Each returns { ok: true, data } or { ok: false, error }.
 * The service checks who may do what (leads.view, leads.all, leads.manage,
 * leads.assign, leads.convert, leads.export, leads.settings, leads.erase) and
 * which leads each person sees, so no caller can skip it.
 */

const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/sales/leads", "layout");
    return result;
  });

// --- Reads -----------------------------------------------------------------------------------
export const getLeadsPageAction = async (filters: unknown) =>
  runAction(async () => leads.listLeads(await requireCompany(), filters));
export const getAddLeadFormAction = async () =>
  runAction(async () => leads.getAddLeadForm(await requireCompany()));
export const checkLeadDuplicatesAction = async (input: unknown) =>
  runAction(async () => leads.checkLeadDuplicates(await requireCompany(), input));
export const getLeadAction = async (leadId: string) =>
  runAction(async () => leads.getLead(await requireCompany(), leadId));
export const getLeadReportAction = async (filters: unknown) =>
  runAction(async () => leads.leadReport(await requireCompany(), filters));
export const getLeadSettingsAction = async () =>
  runAction(async () => leads.getLeadSettingsPage(await requireCompany()));
export const getQuotationBuyerAction = async (partyId: string) =>
  runAction(async () => leads.quotationBuyer(await requireCompany(), partyId));
export const getLeadOfBuyerAction = async (partyId: string) =>
  runAction(async () => leads.leadOfBuyer(await requireCompany(), partyId));
export const listSuppressionsAction = async () =>
  runAction(async () => leads.listSuppressions(await requireCompany()));

// --- Changes ---------------------------------------------------------------------------------
export const addLeadAction = async (input: unknown) =>
  change(async () => leads.addLead(await requireCompany(), input, await getRequestMeta()));
export const editLeadAction = async (leadId: string, input: unknown) =>
  change(async () => leads.editLead(await requireCompany(), leadId, input, await getRequestMeta()));
export const logLeadActivityAction = async (leadId: string, input: unknown) =>
  change(async () =>
    leads.logLeadActivity(await requireCompany(), leadId, input, await getRequestMeta()),
  );
export const setNextStepAction = async (leadId: string, input: unknown) =>
  change(async () =>
    leads.setNextStep(await requireCompany(), leadId, input, await getRequestMeta()),
  );
export const changeLeadStageAction = async (leadId: string, input: unknown) =>
  change(async () =>
    leads.changeLeadStage(await requireCompany(), leadId, input, await getRequestMeta()),
  );
export const assignLeadAction = async (leadId: string, input: unknown) =>
  change(async () =>
    leads.assignLead(await requireCompany(), leadId, input, await getRequestMeta()),
  );
export const setLeadArchivedAction = async (leadId: string, archived: boolean) =>
  change(async () =>
    leads.setLeadArchived(await requireCompany(), leadId, archived, await getRequestMeta()),
  );
export const addLeadContactAction = async (leadId: string, input: unknown) =>
  change(async () =>
    leads.addLeadContact(await requireCompany(), leadId, input, await getRequestMeta()),
  );
export const updateLeadContactAction = async (leadId: string, contactId: string, input: unknown) =>
  change(async () =>
    leads.updateLeadContact(
      await requireCompany(),
      leadId,
      contactId,
      input,
      await getRequestMeta(),
    ),
  );
export const eraseLeadContactAction = async (leadId: string, contactId: string, input: unknown) =>
  change(async () =>
    leads.eraseLeadContact(
      await requireCompany(),
      leadId,
      contactId,
      input,
      await getRequestMeta(),
    ),
  );
export const logMessageSentAction = async (leadId: string, input: unknown) =>
  change(async () =>
    leads.logMessageSent(await requireCompany(), leadId, input, await getRequestMeta()),
  );
export const addLeadSampleAction = async (leadId: string, input: unknown) =>
  change(async () =>
    leads.addLeadSample(await requireCompany(), leadId, input, await getRequestMeta()),
  );
export const updateLeadSampleAction = async (leadId: string, sampleId: string, input: unknown) =>
  change(async () =>
    leads.updateLeadSample(await requireCompany(), leadId, sampleId, input, await getRequestMeta()),
  );
export const addLeadFileAction = async (leadId: string, form: FormData) =>
  change(async () =>
    leads.addLeadFile(
      await requireCompany(),
      leadId,
      await fileFromForm(form),
      await getRequestMeta(),
    ),
  );
export const makeBuyerAction = async (leadId: string, input: unknown = {}) =>
  change(async () =>
    leads.makeBuyer(await requireCompany(), leadId, input, await getRequestMeta()),
  );
export const saveLeadSettingsAction = async (input: unknown) =>
  change(async () => leads.saveLeadSettings(await requireCompany(), input, await getRequestMeta()));
export const addLeadSourceAction = async (input: unknown) =>
  change(async () => leads.addLeadSource(await requireCompany(), input, await getRequestMeta()));
export const setLeadSourceActiveAction = async (sourceId: string, input: unknown) =>
  change(async () =>
    leads.setLeadSourceActive(await requireCompany(), sourceId, input, await getRequestMeta()),
  );
export const addSuppressionAction = async (input: unknown) =>
  change(async () => leads.addSuppression(await requireCompany(), input, await getRequestMeta()));
