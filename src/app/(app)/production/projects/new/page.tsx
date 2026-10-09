import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { ProductionNoAccess } from "@/components/production/no-access";
import { ProjectForm } from "@/components/production/project-form";
import { BackLink } from "@/components/settings/back-link";
import { getProjectFormAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New production project" };

/** A new production project: for production.manage, the permission createProjectAction checks. */
export default async function NewProjectPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.manage")) {
    return (
      <ProductionNoAccess title="Starting projects is not part of your role">
        Production Managers start projects. Your administrator can give your role that permission.
      </ProductionNoAccess>
    );
  }
  const result = await getProjectFormAction();
  if (!result.ok) {
    return (
      <SectionError title="New project" heading="The form could not load" error={result.error} />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href="/production/projects">All projects</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">New project</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          A batch to make in a factory. Its costs and deliveries are added once it is created.
        </p>
      </div>
      <ProjectForm form={result.data} />
    </div>
  );
}
