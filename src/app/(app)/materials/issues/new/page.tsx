import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { IssueForm } from "@/components/materials/issue-form";
import { materialsHref } from "@/components/materials/labels";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getIssueFormAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Issue to production" };

const idParam = (value: string | string[] | undefined) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : undefined;

/**
 * An issue note (materials to a production project) or, with ?kind=return, a
 * return note (unused materials back from it): for the store team
 * (materials.manage), the permission both actions check. ?project= starts it
 * for one project.
 */
export default async function NewIssuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const query = await searchParams;
  const kind = query.kind === "return" ? "RETURN" : "ISSUE";
  if (!ctx.can("materials.manage")) {
    return (
      <MaterialsNoAccess title="Issuing materials is not part of your role">
        The store team hands materials to production and takes back what is left.
      </MaterialsNoAccess>
    );
  }
  const result = await getIssueFormAction({ kind, projectId: idParam(query.project) });
  if (!result.ok) {
    return (
      <SectionError title="Issue note" heading="The form could not load" error={result.error} />
    );
  }
  const project = result.data.project;
  // People who open production projects came from the project's page.
  const back =
    project && ctx.can("production.view")
      ? { href: materialsHref.project(project.id), label: project.code }
      : { href: materialsHref.issues, label: "All issue notes" };

  return (
    <div className="grid gap-6">
      <BackLink href={back.href}>{back.label}</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">
          {kind === "ISSUE" ? "Issue to production" : "Take back from production"}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {kind === "ISSUE"
            ? "Materials handed to a project leave the store at their average cost, which goes into the project's cost."
            : "Unused materials come back into the store at the cost they went out at, and come off the project's cost."}
        </p>
      </div>
      <IssueForm form={result.data} currency={ctx.company.currency} cancelHref={back.href} />
    </div>
  );
}
