"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as reports from "@/modules/reports/export.service";

/*
 * Report Builder Server Actions (reports.export). Each returns { ok: true, data } or
 * { ok: false, error }. Each metric needs its own permission too. Files download from
 * GET /api/reports/exports/:exportId/download.
 */

const exporter = () => requirePermission("reports.export");

export const reportBuilderOptionsAction = async () =>
  runAction(async () => reports.reportBuilderOptions(await exporter()));
export const previewReportAction = async (input: unknown) =>
  runAction(async () => reports.previewReport(await exporter(), input));
export const generateReportAction = async (input: unknown) =>
  runAction(async () => reports.generateReport(await exporter(), input, await getRequestMeta()));
export const listReportExportsAction = async (query: unknown) =>
  runAction(async () => reports.listReportExports(await exporter(), query));
export const getReportExportAction = async (exportId: string) =>
  runAction(async () => reports.getReportExport(await exporter(), exportId));
export const deleteReportExportAction = async (exportId: string) =>
  runAction(async () =>
    reports.deleteReportExport(await exporter(), exportId, await getRequestMeta()),
  );
