import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ComplianceBadge } from "@/components/compliance/badges";
import {
  COMPLIANCE_TYPE_LABELS,
  complianceHref,
  expiryWords,
} from "@/components/compliance/labels";
import { ComplianceNoAccess } from "@/components/compliance/no-access";
import { RecordActions, ScanPanel } from "@/components/compliance/record-actions";
import { SectionError } from "@/components/dashboard/section-error";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { BackLink } from "@/components/settings/back-link";
import { localDay } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import { formatInstantDay } from "@/lib/format";
import { getComplianceRecordScreenAction } from "@/server/actions/compliance.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Licence" };

const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * One licence or registration (compliance.view): its number, issuer, dates,
 * when reminders start, its scan and its earlier terms; renewing, correcting,
 * archiving and the scan need compliance.manage.
 */
export default async function ComplianceRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ recordId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const { recordId } = await params;
  const { added, renewed } = await searchParams;
  const result = await getComplianceRecordScreenAction(recordId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <ComplianceNoAccess />;
    return (
      <SectionError title="Licence" heading="The record could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { record: r, can } = screen;
  const tz = ctx.company.timezone;
  const live = r.status !== "SUPERSEDED" && r.status !== "ARCHIVED";
  const today = localDay(new Date(), tz);

  return (
    <div className="grid grid-cols-1 gap-6">
      <BackLink href={complianceHref.list}>All licences</BackLink>
      <RecordHeader
        eyebrow={COMPLIANCE_TYPE_LABELS[r.type]}
        title={r.title}
        badges={<ComplianceBadge status={r.status} />}
      >
        {r.expiryDate && live && (
          <p
            className={
              r.status === "EXPIRED" || r.status === "EXPIRING"
                ? "mt-2 text-sm text-destructive"
                : "mt-2 text-sm text-muted-foreground"
            }
          >
            {expiryWords(r.daysLeft)}
          </p>
        )}
      </RecordHeader>
      {r.renewal && (
        <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
          This term was renewed.{" "}
          <Link href={complianceHref.record(r.renewal.id)} className={linkClass}>
            Open the term in force
          </Link>
          {r.renewal.expiryDate && `, valid to ${formatDay(r.renewal.expiryDate)}`}.
        </p>
      )}
      <RecordActions
        key={`${r.id}-${r.status}`}
        screen={screen}
        today={today}
        notice={
          added === "1"
            ? `Added.${can.scan && !r.scan ? " Add the scan below." : ""}`
            : renewed === "1"
              ? `Renewed. The term before is kept as history.${can.scan ? " Add the new scan below." : ""}`
              : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title="Details" id="record-details-heading">
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Fact label="Number">{r.number ?? "Not entered"}</Fact>
            <Fact label="Issued by">{r.issuingAuthority ?? "Not entered"}</Fact>
            <Fact label="Issued on">{r.issueDate ? formatDay(r.issueDate) : "Not entered"}</Fact>
            <Fact label="Expires on">{r.expiryDate ? formatDay(r.expiryDate) : "No expiry"}</Fact>
            {r.expiryDate && live && (
              <Fact label="Reminders">
                From {r.renewFrom ? formatDay(r.renewFrom) : ""}, {r.alertDaysBefore} days before it
                expires
              </Fact>
            )}
            {r.archivedAt && <Fact label="Archived on">{formatInstantDay(r.archivedAt, tz)}</Fact>}
            {r.supersededAt && (
              <Fact label="Renewed on">{formatInstantDay(r.supersededAt, tz)}</Fact>
            )}
          </dl>
          {r.notes && (
            <p className="mt-5 border-t pt-4 text-sm leading-relaxed whitespace-pre-wrap">
              {r.notes}
            </p>
          )}
        </Panel>

        <div className="grid content-start gap-6">
          <Panel title="Scan" id="record-scan-heading">
            <div className="mt-4">
              <ScanPanel recordId={r.id} scan={r.scan} canChange={can.scan} />
            </div>
          </Panel>

          {r.history.length > 0 && (
            <Panel title="Earlier terms" id="record-history-heading">
              <ul className="mt-4 grid divide-y" aria-label="Earlier terms">
                {r.history.map((h) => (
                  <li key={h.id} className="py-2.5 text-sm first:pt-0 last:pb-0">
                    <Link href={complianceHref.record(h.id)} className={linkClass}>
                      {h.issueDate ? formatDay(h.issueDate) : "Unknown start"} to{" "}
                      {h.expiryDate ? formatDay(h.expiryDate) : "no expiry"}
                    </Link>
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      {h.number ?? "No number"}
                      {h.scan ? " · scan kept" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
