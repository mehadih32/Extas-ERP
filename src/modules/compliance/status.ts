import type { ComplianceType } from "@prisma/client";

import { daysBetween } from "@/lib/dates";

/*
 * Where a licence or registration stands on a given day (company time):
 *   VALID      expires after its renewal window opens (alertDaysBefore)
 *   EXPIRING   inside the renewal window, not expired yet
 *   EXPIRED    the expiry day has passed
 *   NO_EXPIRY  nothing to renew (e.g. a TIN or BIN with no end date)
 * Renewed records are SUPERSEDED and taken-off ones ARCHIVED; both stay as history.
 */

export const COMPLIANCE_TYPE_LABELS: Record<ComplianceType, string> = {
  TRADE_LICENSE: "Trade licence",
  VAT_BIN: "VAT registration (BIN)",
  TIN: "Tax ID (TIN)",
  IRC: "Import registration (IRC)",
  ERC: "Export registration (ERC)",
  BGMEA_BKMEA: "BGMEA / BKMEA membership",
  FIRE_LICENSE: "Fire licence",
  ENVIRONMENT: "Environment clearance",
  OTHER: "Other licence",
};

/** The records a business should always have on file; the dashboard lists the missing ones. */
export const CORE_COMPLIANCE_TYPES: readonly ComplianceType[] = ["TRADE_LICENSE", "VAT_BIN", "TIN"];

export type ComplianceStatus =
  "VALID" | "EXPIRING" | "EXPIRED" | "NO_EXPIRY" | "SUPERSEDED" | "ARCHIVED";

export function complianceStatus(
  doc: {
    expiryDate: string | null;
    alertDaysBefore: number;
    supersededAt?: Date | null;
    archivedAt?: Date | null;
  },
  today: string,
): { status: ComplianceStatus; daysLeft: number | null } {
  const daysLeft = doc.expiryDate ? daysBetween(today, doc.expiryDate) : null;
  if (doc.archivedAt) return { status: "ARCHIVED", daysLeft };
  if (doc.supersededAt) return { status: "SUPERSEDED", daysLeft };
  if (daysLeft === null) return { status: "NO_EXPIRY", daysLeft };
  if (daysLeft < 0) return { status: "EXPIRED", daysLeft };
  if (daysLeft <= doc.alertDaysBefore) return { status: "EXPIRING", daysLeft };
  return { status: "VALID", daysLeft };
}
