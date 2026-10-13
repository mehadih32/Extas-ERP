import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { CuttingActions, CuttingReports, EmbroideryJobs } from "@/components/production/cutting";
import {
  CrossChecks,
  CuttingGrid,
  DateWarnings,
  goodPieces,
  MilestoneText,
} from "@/components/production/cutting-summary";
import { pieces, productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { Fact } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { formatCount } from "@/lib/display";
import { getCuttingScreenAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Cutting and embroidery" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * A style's cutting (production.view, like GET /api/production/projects/:id/cutting):
 * pieces cut by colour and size, the cross-checks against the fabric, collars and
 * accessories, the cutting reports, the pieces out for embroidery or print, and
 * the cutting and sewing dates. Production Managers record it all here.
 */
export default async function CuttingPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const result = await getCuttingScreenAction(projectId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return (
      <SectionError title="Cutting" heading="The cutting could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { project: p, totals, milestones } = screen;
  const currency = ctx.company.currency;
  const short = Number(one(query.short) ?? 0);
  const notice = one(query.saved)
    ? `${one(query.saved)} was saved: ${one(query.pieces)} pieces cut.`
    : one(query.sent)
      ? `${one(query.sent)} was sent out.`
      : one(query.back)
        ? `${one(query.back)}: ${one(query.good)} good pieces came back.`
        : one(query.replaced)
          ? `${one(query.replaced)} was saved: ${one(query.pieces)} spoiled pieces cut again. Production was alerted.${
              one(query.logged) ? ` ${one(query.logged)} went into the fault log.` : ""
            }${
              one(query.charged) && one(query.off) && one(query.house)
                ? ` ${one(query.charged)}: ${money(one(query.off)!, currency)} came off ${one(query.house)}'s Supplier Due.`
                : ""
            }`
          : one(query.dates) === "1"
            ? "The cutting and sewing dates were saved."
            : undefined;

  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.project(p.id)}>
        {p.code} · {p.name}
      </BackLink>
      <div>
        <p className="eyebrow">{p.code}</p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">
          Cutting and embroidery
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Each day&apos;s cutting by colour and size, checked at once against the fabric, the
          collars and cuffs ordered and the accessories issued. Pieces out for embroidery or print
          come back here, and spoiled ones are cut again straight away.
        </p>
      </div>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {one(query.saved) && short > 0 && (
        <FormAlert>
          What was cut runs short of {short} {short === 1 ? "material" : "materials"}. Production
          and the store were alerted; see the cross-checks.
        </FormAlert>
      )}
      {one(query.fault) && (
        <FormAlert tone="success">
          {one(query.fault)} went into the supplier&apos;s{" "}
          <Link
            href={productionHref.faults({ batchId: p.batch?.id })}
            className="underline underline-offset-4"
          >
            fault log
          </Link>{" "}
          to deduct.
        </FormAlert>
      )}
      <DateWarnings warnings={screen.warnings} />
      <CuttingActions screen={screen} currency={currency} />
      <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-card p-5 sm:p-6 md:grid-cols-5">
        <Fact label="Cut">
          {formatCount(goodPieces(totals), currency)} of {pieces(p.target, currency)}
        </Fact>
        <Fact label="Out">{pieces(totals.out, currency)}</Fact>
        <Fact label="Spoiled">
          {pieces(totals.spoiled, currency)}
          {totals.replaced > 0 && (
            <span className="text-muted-foreground"> · {totals.replaced} cut again</span>
          )}
        </Fact>
        <Fact label="Cutting by">
          <MilestoneText m={milestones.cutting} />
        </Fact>
        <Fact label="Sewing by">
          <MilestoneText m={milestones.sewing} />
        </Fact>
      </dl>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <CuttingGrid screen={screen} currency={currency} />
          <CrossChecks checks={screen.checks} />
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <EmbroideryJobs screen={screen} currency={currency} />
          <CuttingReports screen={screen} currency={currency} />
        </div>
      </div>
    </div>
  );
}
