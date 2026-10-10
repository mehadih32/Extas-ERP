import type { ComplianceType } from "@prisma/client";

import { COMPLIANCE_TYPE_LABELS, type ComplianceStatus } from "@/modules/compliance/status";

/*
 * The words, addresses and list filters of the Compliance screens (licences and
 * registrations).
 */

export { COMPLIANCE_TYPE_LABELS };

export const COMPLIANCE_TYPES: readonly ComplianceType[] = [
  "TRADE_LICENSE",
  "VAT_BIN",
  "TIN",
  "IRC",
  "ERC",
  "BGMEA_BKMEA",
  "FIRE_LICENSE",
  "ENVIRONMENT",
  "OTHER",
];

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  VALID: "Valid",
  EXPIRING: "Renew soon",
  EXPIRED: "Expired",
  NO_EXPIRY: "No expiry",
  SUPERSEDED: "Renewed",
  ARCHIVED: "Archived",
};

/** "Expires in 12 days", "Expires today", "Expired 3 days ago", "No expiry". */
export function expiryWords(daysLeft: number | null): string {
  if (daysLeft === null) return "No expiry";
  if (daysLeft === 0) return "Expires today";
  if (daysLeft === 1) return "Expires tomorrow";
  if (daysLeft > 0) return `Expires in ${daysLeft} days`;
  if (daysLeft === -1) return "Expired yesterday";
  return `Expired ${-daysLeft} days ago`;
}

const enc = encodeURIComponent;

export const complianceHref = {
  list: "/compliance",
  record: (id: string) => `/compliance/${enc(id)}`,
  /** The scan in the browser, or saved with `download`. */
  scan: (id: string, version?: string, download = false) => {
    const query = new URLSearchParams({
      ...(version ? { v: version } : {}),
      ...(download ? { download: "1" } : {}),
    }).toString();
    return `/api/compliance/${enc(id)}/scan${query ? `?${query}` : ""}`;
  },
};

// --- The list's filters, as they appear in the address bar --------------------------------

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

export const COMPLIANCE_SHOWS = ["current", "renew", "expired", "history"] as const;
export type ComplianceShow = (typeof COMPLIANCE_SHOWS)[number];

export const COMPLIANCE_SHOW_LABELS: Record<ComplianceShow, string> = {
  current: "In force",
  renew: "Renew soon",
  expired: "Expired",
  history: "With renewed and archived",
};

export type ComplianceListView = { show: ComplianceShow; type?: ComplianceType; q?: string };

export function complianceViewFrom(params: SearchParams): ComplianceListView {
  const show = COMPLIANCE_SHOWS.find((s) => s === first(params.show)) ?? "current";
  const type = COMPLIANCE_TYPES.find((t) => t === first(params.type));
  const q = first(params.q)?.slice(0, 100);
  return { show, ...(type ? { type } : {}), ...(q ? { q } : {}) };
}

export function complianceListSearch(view: ComplianceListView): string {
  const query = new URLSearchParams(
    Object.entries({
      show: view.show === "current" ? undefined : view.show,
      type: view.type,
      q: view.q,
    }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  return query ? `?${query}` : "";
}

export const isComplianceFiltered = (view: ComplianceListView) =>
  view.show !== "current" || Boolean(view.type || view.q);

export function complianceListQuery(view: ComplianceListView) {
  return {
    ...(view.show === "renew" ? { status: "EXPIRING" } : {}),
    ...(view.show === "expired" ? { status: "EXPIRED" } : {}),
    ...(view.show === "history" ? { history: true } : {}),
    ...(view.type ? { type: view.type } : {}),
    ...(view.q ? { search: view.q } : {}),
  };
}
