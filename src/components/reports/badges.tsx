import type { JobStatus, ReportFormat, TemplateFormat } from "@prisma/client";

import { StatusBadge } from "@/components/sales/badges";

import { FORMAT_LABELS, TEMPLATE_FORMAT_LABELS } from "./labels";

/** A saved report's file kind, and "Failed" when it could not be made. */
export function ReportBadges({ format, status }: { format: ReportFormat; status: JobStatus }) {
  return (
    <>
      <StatusBadge tone="plain">{FORMAT_LABELS[format]}</StatusBadge>
      {status === "FAILED" && <StatusBadge tone="warn">Failed</StatusBadge>}
      {(status === "QUEUED" || status === "RUNNING") && (
        <StatusBadge tone="open">Being made</StatusBadge>
      )}
    </>
  );
}

/** A template's kind, whether it is offered first, and whether it is switched off. */
export function TemplateBadges({
  format,
  isDefault,
  isActive,
}: {
  format: TemplateFormat;
  isDefault: boolean;
  isActive: boolean;
}) {
  return (
    <>
      <StatusBadge tone="plain">{TEMPLATE_FORMAT_LABELS[format]}</StatusBadge>
      {isDefault && <StatusBadge tone="done">Default</StatusBadge>}
      {!isActive && <StatusBadge tone="closed">Switched off</StatusBadge>}
    </>
  );
}
