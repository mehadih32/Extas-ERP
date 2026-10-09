import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { ProjectForm } from "@/components/production/project-form";
import { BackLink } from "@/components/settings/back-link";
import { getProjectFormAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Edit production project" };

/** A project's details: for production.manage, the permission updateProjectAction checks. */
export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.manage")) {
    return (
      <ProductionNoAccess title="Changing projects is not part of your role">
        Production Managers change projects. Your administrator can give your role that permission.
      </ProductionNoAccess>
    );
  }
  const { projectId } = await params;
  const result = await getProjectFormAction(projectId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <SectionError title="Project" heading="The project could not load" error={result.error} />
    );
  }
  const project = result.data.project;
  if (!project) notFound();

  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.project(project.id)}>{project.code}</BackLink>
      <div>
        <p className="eyebrow">{project.code}</p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">Edit {project.name}</h2>
      </div>
      <ProjectForm form={result.data} />
    </div>
  );
}
