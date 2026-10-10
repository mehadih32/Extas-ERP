import { StatusBadge, type Tone } from "@/components/sales/badges";
import type { ComplianceStatus } from "@/modules/compliance/status";

import { COMPLIANCE_STATUS_LABELS } from "./labels";

const TONES: Record<ComplianceStatus, Tone> = {
  VALID: "done",
  EXPIRING: "warn",
  EXPIRED: "warn",
  NO_EXPIRY: "done",
  SUPERSEDED: "closed",
  ARCHIVED: "closed",
};

export function ComplianceBadge({ status }: { status: ComplianceStatus }) {
  return <StatusBadge tone={TONES[status]}>{COMPLIANCE_STATUS_LABELS[status]}</StatusBadge>;
}
