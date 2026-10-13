import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { FinishingActions, FinishingReports } from "@/components/production/finishing";
import {
  FinalUnitCost,
  FinishingGrid,
  GradeFacts,
  PackingListState,
} from "@/components/production/finishing-summary";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getFinishingScreenAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Finishing and QC" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * A style's finishing (production.view, like GET /api/production/projects/:id/finishing):
 * pieces graded A, B and C (mending) with rejects and missing apart, by colour and size,
 * the reports, the full packing list that moves the A and B pieces to stock, and for cost
 * viewers the final unit cost, total cost ÷ (A + B).
 */
export default async function FinishingPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const result = await getFinishingScreenAction(projectId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return (
      <SectionError title="Finishing" heading="The finishing could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { project: p, totals } = screen;
  const currency = ctx.company.currency;
  const q = (key: string) => one(query[key]);
  const packedNotice = q("packed")
    ? `${q("packed")} was received: ${Number(q("a")) + Number(q("b"))} pieces (${q("a")} A-grade, ${q("b")} B-grade) went to stock${
        q("delivery") ? ` on ${q("delivery")}` : ""
      }.${Number(q("missing")) > 0 ? ` ${q("missing")} missing.` : ""}${
        q("closed") === "1" ? ` ${p.code} is closed.` : ""
      }`
    : undefined;
  const notice =
    packedNotice ??
    (q("counted")
      ? `${q("counted")} was saved: A ${q("a")} · B ${q("b")} · C ${q("c")} · reject ${q("reject")}.`
      : q("mended")
        ? `${q("mended")} was saved: back from mending A ${q("a")} · B ${q("b")} · reject ${q("reject")}.`
        : undefined);

  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.project(p.id)}>
        {p.code} · {p.name}
      </BackLink>
      <div>
        <p className="eyebrow">{p.code}</p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">Finishing and QC</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every piece is graded A, B or C (mending), or rejected for a sewing fault. The full
          packing list moves only the A and B pieces to the Sales stock and records what is missing.
        </p>
      </div>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {q("fault") && (
        <FormAlert>
          The missing pieces went into {p.factory}&apos;s{" "}
          <Link
            href={productionHref.faults({ batchId: p.batch?.id })}
            className="underline underline-offset-4"
          >
            fault log
          </Link>{" "}
          as {q("fault")}, to deduct from the CM.
        </FormAlert>
      )}
      {!q("packed") && <PackingListState screen={screen} />}
      {!screen.cutRecorded && (
        <FormAlert tone="note">
          No cutting is recorded for {p.code}, so nothing limits the counts and missing pieces are
          not worked out.{" "}
          <Link href={productionHref.cutting(p.id)} className="underline underline-offset-4">
            Open cutting
          </Link>
        </FormAlert>
      )}
      <FinishingActions screen={screen} currency={currency} />
      <GradeFacts
        totals={totals}
        currency={currency}
        className="rounded-lg border bg-card p-5 sm:p-6"
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <FinishingGrid screen={screen} currency={currency} />
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <FinalUnitCost screen={screen} currency={currency} />
          <FinishingReports screen={screen} currency={currency} />
        </div>
      </div>
    </div>
  );
}
