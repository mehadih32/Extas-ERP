"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as compliance from "@/modules/compliance/compliance.service";
import { fileFromForm } from "@/modules/files/file.service";

/*
 * Licences and registrations Server Actions (trade licence, VAT / BIN, TIN...).
 *   compliance.view    the list, a record with its history, the summary
 *   compliance.manage  add, edit, renew, archive, restore, delete, scans
 * Each returns { ok: true, data } or { ok: false, error }.
 */

const view = () => requireAnyPermission("compliance.view", "compliance.manage");
const manage = () => requirePermission("compliance.manage");

export const listComplianceAction = async (query: unknown = {}) =>
  runAction(async () => compliance.listCompliance(await view(), query));
export const complianceSummaryAction = async () =>
  runAction(async () => compliance.complianceSummary(await view()));
export const getComplianceAction = async (recordId: string) =>
  runAction(async () => compliance.getCompliance(await view(), recordId));
export const createComplianceAction = async (input: unknown) =>
  runAction(async () => compliance.createCompliance(await manage(), input, await getRequestMeta()));
export const updateComplianceAction = async (recordId: string, input: unknown) =>
  runAction(async () =>
    compliance.updateCompliance(await manage(), recordId, input, await getRequestMeta()),
  );
export const renewComplianceAction = async (recordId: string, input: unknown) =>
  runAction(async () =>
    compliance.renewCompliance(await manage(), recordId, input, await getRequestMeta()),
  );
export const archiveComplianceAction = async (recordId: string) =>
  runAction(async () =>
    compliance.archiveCompliance(await manage(), recordId, await getRequestMeta()),
  );
export const restoreComplianceAction = async (recordId: string) =>
  runAction(async () =>
    compliance.restoreCompliance(await manage(), recordId, await getRequestMeta()),
  );
export const deleteComplianceAction = async (recordId: string) =>
  runAction(async () =>
    compliance.deleteCompliance(await manage(), recordId, await getRequestMeta()),
  );
/** The form needs a `file` field with the scan (JPG, PNG, WebP or PDF). */
export const attachComplianceScanAction = async (recordId: string, form: FormData) =>
  runAction(async () => {
    const ctx = await manage();
    return compliance.attachScan(ctx, recordId, await fileFromForm(form), await getRequestMeta());
  });
export const removeComplianceScanAction = async (recordId: string) =>
  runAction(async () => compliance.removeScan(await manage(), recordId, await getRequestMeta()));
