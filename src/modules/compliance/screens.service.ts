import type { CompanyContext } from "@/modules/auth/context";
import {
  complianceSummary,
  type ComplianceView,
  getCompliance,
  listCompliance,
} from "@/modules/compliance/compliance.service";
import {
  canArchive,
  canDelete,
  canRenew,
  canRestore,
  complianceKeys,
} from "@/modules/compliance/rules";

/*
 * What the Compliance screens show: the licences and registrations in force
 * (or their history), where the company stands (what needs renewing, which of
 * the trade licence, BIN and TIN are missing), and one record with its earlier
 * terms. What the person looking may do comes from the same rules the service
 * uses (compliance/rules.ts): compliance.view sees, compliance.manage changes.
 */

export async function getComplianceScreen(
  ctx: CompanyContext,
  raw: unknown = {},
  now: Date = new Date(),
) {
  const [list, summary] = await Promise.all([
    listCompliance(ctx, raw, now),
    complianceSummary(ctx, now),
  ]);
  return { today: list.today, items: list.items, summary, can: complianceKeys(ctx) };
}

export type ComplianceScreen = Awaited<ReturnType<typeof getComplianceScreen>>;
export type ComplianceRow = ComplianceView;

/** One record, its earlier terms, and what may be done with it. */
export async function getComplianceRecordScreen(
  ctx: CompanyContext,
  recordId: string,
  now: Date = new Date(),
) {
  const record = await getCompliance(ctx, recordId, now);
  const { manage } = complianceKeys(ctx);
  return {
    record,
    can: {
      edit: manage,
      renew: manage && canRenew(record).ok,
      archive: manage && canArchive(record).ok,
      restore: manage && canRestore(record).ok,
      delete: manage && canDelete(record).ok,
      scan: manage,
    },
  };
}

export type ComplianceRecordScreen = Awaited<ReturnType<typeof getComplianceRecordScreen>>;
