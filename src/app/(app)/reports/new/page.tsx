import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { builderQuery, builderViewFrom, reportsHref } from "@/components/reports/labels";
import { ReportsNoAccess } from "@/components/reports/no-access";
import { ReportBuilder } from "@/components/reports/report-builder";
import { ReportPreview } from "@/components/reports/report-preview";
import { BackLink } from "@/components/settings/back-link";
import { localDay } from "@/lib/dates";
import { getReportBuilderScreenAction } from "@/server/actions/reports.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Make a report" };

/**
 * The Report Builder (reports.export): the period and the figures this person
 * may see (the others are not offered), the report on screen when asked for
 * ("?show=1"), and making it as a PDF or Excel file.
 */
export default async function ReportBuilderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = builderViewFrom(await searchParams);
  const result = await getReportBuilderScreenAction(builderQuery(view), { show: view.show });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <ReportsNoAccess />;
    return (
      <SectionError
        title="Make a report"
        heading="The Report Builder could not load"
        error={result.error}
      />
    );
  }
  const s = result.data;
  if (s.metrics.length === 0) {
    return (
      <ReportsNoAccess title="None of the report's figures are part of your role">
        Reports show sales, profit and stock, and each needs its own permission. Your administrator
        can give your role the permission to see them.
      </ReportsNoAccess>
    );
  }
  const problem = s.previewError
    ? [s.previewError.message, ...Object.values(s.previewError.fieldErrors ?? {}).flat()]
        .filter((m, i, all) => all.indexOf(m) === i)
        .join(" ")
    : null;

  return (
    <section aria-labelledby="builder-heading" className="grid grid-cols-1 gap-6">
      <BackLink href={reportsHref.reports}>All reports</BackLink>
      <div>
        <h2 id="builder-heading" className="font-serif text-2xl text-primary">
          Make a report
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Choose the period and the figures. Show the report on screen to check it, then make it as
          a PDF or an Excel file to keep and share.
        </p>
      </div>
      <ReportBuilder
        view={view}
        metrics={s.metrics}
        periods={s.periods}
        defaults={s.defaults}
        today={localDay(new Date(), ctx.company.timezone)}
      >
        {problem ? (
          <FormAlert>{problem}</FormAlert>
        ) : s.preview ? (
          <ReportPreview doc={s.preview} />
        ) : null}
      </ReportBuilder>
    </section>
  );
}
