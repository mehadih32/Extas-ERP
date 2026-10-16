import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { ProjectTechPackStart } from "@/components/tech-packs/project-start";
import { getProjectTechPackAction } from "@/server/actions/tech-pack.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Tech pack" };

/**
 * A style in production's tech pack, from its project (the address from
 * before v6.4): opens the tech pack's own page, or, while the style has none,
 * offers to start its tech pack or link one started from the buyer's brief.
 * Nothing is made by opening it. Read with production.view.
 */
export default async function ProjectTechPackPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  await requireCompanyPage();
  const { projectId } = await params;
  const result = await getProjectTechPackAction(projectId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return (
      <SectionError title="Tech pack" heading="The tech pack could not load" error={result.error} />
    );
  }
  const start = result.data;
  if (start.techPackId) redirect(productionHref.techPackOf(start.techPackId));
  const p = start.project;
  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.project(p.id)}>
        {p.code} · {p.name}
      </BackLink>
      <div className="min-w-0">
        <h2 className="font-serif text-2xl break-words text-primary">Tech pack</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {p.code} has no tech pack yet.
        </p>
      </div>
      <ProjectTechPackStart project={p} can={start.can} />
    </div>
  );
}
