import { DownloadIcon, ExternalLinkIcon, EyeIcon, RefreshCwIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { ReportBadges } from "@/components/reports/badges";
import { builderSearch, fileSize, reportsHref } from "@/components/reports/labels";
import { ReportsNoAccess } from "@/components/reports/no-access";
import { DeleteReport } from "@/components/reports/report-actions";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import type { PeriodPreset } from "@/modules/accounts/periods";
import type { ReportMetricKey } from "@/modules/reports/catalog";
import { getSavedReportScreenAction } from "@/server/actions/reports.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Report" };

/**
 * A saved report (reports.export, and only when its reader may see every figure
 * in it): what it covers, who made it, its file to open or download, and making
 * it again or showing the same days on screen.
 */
export default async function SavedReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ exportId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const [{ exportId }, query] = await Promise.all([params, searchParams]);
  const result = await getSavedReportScreenAction(exportId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN")
      return (
        <ReportsNoAccess title="This report is not open to you">
          It shows figures your role cannot see. Ask the person who made it, or make your own with
          the figures you can see.
        </ReportsNoAccess>
      );
    return <SectionError title="Report" heading="The report could not load" error={result.error} />;
  }
  const { report: r, can } = result.data;
  const metrics = r.metrics as ReportMetricKey[];
  const options = r.options;
  const again = {
    title: r.title,
    period: r.period as PeriodPreset | "CUSTOM",
    ...(r.period === "CUSTOM" ? { from: r.from, to: r.to } : {}),
    metrics,
    topLimit: options?.topLimit,
    alertLimit: options?.alertLimit,
    slowDays: options?.slowDays,
    coverDays: options?.coverDays,
  };
  const sameDays = { ...again, period: "CUSTOM" as const, from: r.from, to: r.to, show: true };
  const isPdf = r.format === "PDF";

  return (
    <div className="grid grid-cols-1 gap-6">
      <BackLink href={reportsHref.reports}>All reports</BackLink>
      <RecordHeader
        eyebrow={`Report · ${r.range}`}
        title={r.title}
        badges={<ReportBadges format={r.format} status={r.status} />}
      />
      {query.made === "1" && r.downloadable && (
        <FormAlert tone="success">
          The report is ready. {isPdf ? "Open it or download it below." : "Download it below."}
        </FormAlert>
      )}
      {r.status === "FAILED" && (
        <FormAlert>
          This report could not be made: {r.error ?? "something went wrong"}. Make it again.
        </FormAlert>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {r.downloadable && isPdf && (
          <Button asChild className="w-full sm:w-auto">
            <a href={`${reportsHref.download(r.id)}?inline=1`} target="_blank" rel="noopener">
              <ExternalLinkIcon aria-hidden />
              Open the PDF
            </a>
          </Button>
        )}
        {r.downloadable && (
          <Button asChild variant={isPdf ? "outline" : "default"} className="w-full sm:w-auto">
            <a href={reportsHref.download(r.id)} download>
              <DownloadIcon aria-hidden />
              Download
            </a>
          </Button>
        )}
        {can.makeAgain && (
          <>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={reportsHref.builder(builderSearch(sameDays))}>
                <EyeIcon aria-hidden />
                Show on screen
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={reportsHref.builder(builderSearch(again))}>
                <RefreshCwIcon aria-hidden />
                Make it again
              </Link>
            </Button>
          </>
        )}
        {can.delete && <DeleteReport id={r.id} title={r.title} />}
      </div>

      <Panel title="What it covers" id="report-facts-heading">
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Period">
            {r.periodLabel}: {r.range}
          </Fact>
          <Fact label="Figures">{r.metricLabels.join(", ")}</Fact>
          {metrics.includes("TOP_SELLERS") && options && (
            <Fact label="Top sellers listed">{options.topLimit}</Fact>
          )}
          {metrics.includes("STOCK_ALERTS") && options && (
            <Fact label="Stock alerts">
              {options.alertLimit} items each; slow when stock lasts over {options.coverDays} days
              at the last {options.slowDays} days&apos; sales
            </Fact>
          )}
          <Fact label="Made by">{r.requestedBy?.name ?? "Someone no longer here"}</Fact>
          <Fact label="Made on">{r.madeOn}</Fact>
          {r.fileName && (
            <Fact label="File">
              {r.fileName}
              {r.sizeBytes !== null && (
                <span className="text-muted-foreground"> · {fileSize(r.sizeBytes)}</span>
              )}
            </Fact>
          )}
        </dl>
        {r.period !== "CUSTOM" && (
          <p className="mt-4 text-[0.8125rem] text-muted-foreground">
            Made again, &quot;{r.periodLabel}&quot; covers the days up to the day it is made;
            &quot;Show on screen&quot; shows these same days.
          </p>
        )}
      </Panel>
    </div>
  );
}
