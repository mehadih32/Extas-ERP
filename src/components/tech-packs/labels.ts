import type { TechPackListStatus } from "@/modules/production/tech-pack-register.service";

/** Where a tech pack stands, as the list and its filter say it. */
export const TECH_PACK_STATUSES: readonly TechPackListStatus[] = [
  "DRAFT",
  "FABRIC_LOCKED",
  "APPROVED",
];

export const TECH_PACK_STATUS_LABELS: Record<TechPackListStatus, string> = {
  DRAFT: "Draft",
  FABRIC_LOCKED: "Fabric part locked",
  APPROVED: "Approved",
};
