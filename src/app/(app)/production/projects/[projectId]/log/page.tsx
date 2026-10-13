import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { ActionLogView } from "@/components/production/action-log";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getActionLogAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Action log" };

/**
 * A style's Employee Action Log (production.view, and production.manage or accounts.view;
 * like GET /api/production/projects/:id/action-log): every input on it, newest first,
 * with when, who and what.
 */
export default async function ProjectLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const result = await getActionLogAction({ projectId }, query);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <ProductionNoAccess title="The action log is not part of your role">
          Production Managers and Accounts read the action log. Your administrator can give your
          role that permission.
        </ProductionNoAccess>
      );
    }
    return (
      <SectionError
        title="Action log"
        heading="The action log could not load"
        error={result.error}
      />
    );
  }
  const log = result.data;
  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.project(log.subject.id)}>
        {log.subject.code} · {log.subject.name}
      </BackLink>
      <div>
        <p className="eyebrow">{log.subject.code}</p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">Action log</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every input on this style: who received the goods, who entered the cutting and finishing,
          who issued the materials, with the time. Nothing here can be changed or deleted.
        </p>
      </div>
      <ActionLogView log={log} href={productionHref.projectLog(log.subject.id)} />
    </div>
  );
}
