"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as compliance from "@/modules/compliance/compliance.service";
import * as screens from "@/modules/compliance/screens.service";
import { fileFromForm } from "@/modules/files/file.service";

/*
 * Licences and registrations Server Actions (trade licence, VAT / BIN, TIN...).
 *   compliance.view    the list, a record with its history, the summary
 *   compliance.manage  add, edit, renew, archive, restore, delete, scans
 * Each returns { ok: true, data } or { ok: false, error }. Changes refresh the
 * screens and hand back the record's id, kind and status only.
 */

const view = () => requireAnyPermission("compliance.view", "compliance.manage");
const manage = () => requirePermission("compliance.manage");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

const recordRef = (r: { id: string; title: string; typeLabel: string; status: string }) => ({
  id: r.id,
  title: r.title,
  typeLabel: r.typeLabel,
  status: r.status,
});

export const getComplianceScreenAction = async (query: unknown = {}) =>
  runAction(async () => screens.getComplianceScreen(await view(), query));
export const getComplianceRecordScreenAction = async (recordId: string) =>
  runAction(async () => screens.getComplianceRecordScreen(await view(), recordId));

export const listComplianceAction = async (query: unknown = {}) =>
  runAction(async () => compliance.listCompliance(await view(), query));
export const complianceSummaryAction = async () =>
  runAction(async () => compliance.complianceSummary(await view()));
export const getComplianceAction = async (recordId: string) =>
  runAction(async () => compliance.getCompliance(await view(), recordId));
export const createComplianceAction = async (input: unknown) =>
  change(async () =>
    recordRef(await compliance.createCompliance(await manage(), input, await getRequestMeta())),
  );
export const updateComplianceAction = async (recordId: string, input: unknown) =>
  change(async () =>
    recordRef(
      await compliance.updateCompliance(await manage(), recordId, input, await getRequestMeta()),
    ),
  );
export const renewComplianceAction = async (recordId: string, input: unknown) =>
  change(async () =>
    recordRef(
      await compliance.renewCompliance(await manage(), recordId, input, await getRequestMeta()),
    ),
  );
export const archiveComplianceAction = async (recordId: string) =>
  change(async () =>
    recordRef(await compliance.archiveCompliance(await manage(), recordId, await getRequestMeta())),
  );
export const restoreComplianceAction = async (recordId: string) =>
  change(async () =>
    recordRef(await compliance.restoreCompliance(await manage(), recordId, await getRequestMeta())),
  );
export const deleteComplianceAction = async (recordId: string) =>
  change(async () => compliance.deleteCompliance(await manage(), recordId, await getRequestMeta()));
/** The form needs a `file` field with the scan (JPG, PNG, WebP or PDF). */
export const attachComplianceScanAction = async (recordId: string, form: FormData) =>
  change(async () => {
    const ctx = await manage();
    return recordRef(
      await compliance.attachScan(ctx, recordId, await fileFromForm(form), await getRequestMeta()),
    );
  });
export const removeComplianceScanAction = async (recordId: string) =>
  change(async () =>
    recordRef(await compliance.removeScan(await manage(), recordId, await getRequestMeta())),
  );
