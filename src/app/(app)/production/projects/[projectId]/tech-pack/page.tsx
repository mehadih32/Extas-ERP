import { FileDownIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { productionHref } from "@/components/production/labels";
import { AiPanel } from "@/components/production/tech-pack/ai-panel";
import { ChartPanel } from "@/components/production/tech-pack/chart-panel";
import { ColoursPanel } from "@/components/production/tech-pack/colours-panel";
import { LogosPanel } from "@/components/production/tech-pack/logos-panel";
import { ReferencesPanel } from "@/components/production/tech-pack/references-panel";
import { Completeness, SignalLegend } from "@/components/production/tech-pack/signals";
import { TechPackApprovalPanel } from "@/components/production/tech-pack-approval";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import { getTechPackScreenAction } from "@/server/actions/tech-pack.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Tech pack" };

/**
 * A style's tech pack: the measurement chart, the AI draft and the experts,
 * saved references, logos and colours, each marked green, yellow or red, and
 * the completeness %. Read with production.view; changes need production.manage.
 */
export default async function TechPackPage({ params }: { params: Promise<{ projectId: string }> }) {
  await requireCompanyPage();
  const { projectId } = await params;
  const result = await getTechPackScreenAction(projectId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <SectionError title="Tech pack" heading="The tech pack could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const p = screen.project;
  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.project(p.id)}>
        {p.code} · {p.name}
      </BackLink>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">
            {p.style ? `${p.style.code} · ` : ""}
            {p.buyer ?? "In-house"}
          </p>
          <h2 className="mt-2 font-serif text-2xl break-words text-primary">Tech pack</h2>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={productionHref.techPack(p.id)} download>
            <FileDownIcon aria-hidden />
            Tech pack PDF
          </a>
        </Button>
      </div>

      <section
        aria-label="Completeness"
        className="grid gap-3 rounded-lg border bg-card p-5 sm:p-6"
      >
        <Completeness percent={screen.completeness} signals={screen.signals} />
        <SignalLegend />
      </section>

      <TechPackApprovalPanel projectId={p.id} code={p.code} techPack={screen.approval} onTechPack />

      <ChartPanel
        projectId={p.id}
        chart={screen.chart}
        suggestion={screen.draft?.output.chart ?? null}
        canEdit={screen.can.edit}
      />
      <AiPanel screen={screen} />
      <ReferencesPanel screen={screen} />
      <LogosPanel screen={screen} />
      <ColoursPanel screen={screen} />
    </div>
  );
}
