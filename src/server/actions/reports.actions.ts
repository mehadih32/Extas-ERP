"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as reports from "@/modules/reports/export.service";
import * as screens from "@/modules/reports/screens.service";

/*
 * Report Builder Server Actions (reports.export). Each returns { ok: true, data } or
 * { ok: false, error }. Each metric needs its own permission too. Files download from
 * GET /api/reports/exports/:exportId/download. Changes refresh the screens.
 */

const exporter = () => requirePermission("reports.export");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

export const reportBuilderOptionsAction = async () =>
  runAction(async () => reports.reportBuilderOptions(await exporter()));
export const previewReportAction = async (input: unknown) =>
  runAction(async () => reports.previewReport(await exporter(), input));
export const generateReportAction = async (input: unknown) =>
  change(async () => {
    const report = await reports.generateReport(await exporter(), input, await getRequestMeta());
    return { id: report.id, title: report.title, format: report.format, status: report.status };
  });
export const listReportExportsAction = async (query: unknown) =>
  runAction(async () => reports.listReportExports(await exporter(), query));
export const getReportExportAction = async (exportId: string) =>
  runAction(async () => reports.getReportExport(await exporter(), exportId));
export const deleteReportExportAction = async (exportId: string) =>
  change(async () =>
    reports.deleteReportExport(await exporter(), exportId, await getRequestMeta()),
  );

// --- Screens -----------------------------------------------------------------------------

export const getReportsScreenAction = async (query: unknown = {}) =>
  runAction(async () => screens.getReportsScreen(await exporter(), query));
export const listReportRowsAction = async (query: unknown) =>
  runAction(async () => screens.listReportRows(await exporter(), query));
export const getReportBuilderScreenAction = async (query: unknown, options: { show?: boolean }) =>
  runAction(async () => screens.getReportBuilderScreen(await exporter(), query, options));
export const getSavedReportScreenAction = async (exportId: string) =>
  runAction(async () => screens.getSavedReportScreen(await exporter(), exportId));
