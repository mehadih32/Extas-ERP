import type { ProductionStage, ProductionStatus } from "@prisma/client";
import { PlusIcon } from "lucide-react";
import Link from "next/link";

import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";

import { PROJECT_STATUS_LABELS, productionHref, STAGE_LABELS } from "./labels";

type StartedProject = {
  id: string;
  code: string;
  name: string;
  stage: ProductionStage;
  status: ProductionStatus;
  targetOn: string | null;
};

/** Where a project stands: its stage while it is being made, else its status. */
function standing(project: StartedProject) {
  if (project.status === "ACTIVE") return STAGE_LABELS[project.stage];
  if (project.status === "ON_HOLD") {
    return `${PROJECT_STATUS_LABELS.ON_HOLD} at ${STAGE_LABELS[project.stage]}`;
  }
  return PROJECT_STATUS_LABELS[project.status];
}

/**
 * The production projects started from a sales order or a proforma, on its
 * page, with "Start production" for Production Managers (`startHref`, null when
 * not offered). Nothing shows when there is neither.
 */
export function StartedProjects({
  projects,
  startHref,
  canOpen,
}: {
  projects: StartedProject[];
  startHref: string | null;
  canOpen: boolean;
}) {
  if (projects.length === 0 && !startHref) return null;
  return (
    <Panel
      title="Production"
      id="production-heading"
      action={
        startHref ? (
          <Button asChild variant="outline" size="sm">
            <Link href={startHref}>
              <PlusIcon aria-hidden />
              Start production
            </Link>
          </Button>
        ) : undefined
      }
    >
      {projects.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Not in production yet. Start a project to have its pieces made, with the colours and sizes
          filled in.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {projects.map((project) => (
            <li key={project.id} className="min-w-0 text-sm">
              <p className="font-medium break-words">
                {canOpen ? (
                  <Link
                    href={productionHref.project(project.id)}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {project.code}
                  </Link>
                ) : (
                  project.code
                )}{" "}
                · {project.name}
              </p>
              <p className="text-[0.8125rem] text-muted-foreground">
                {standing(project)}
                {project.targetOn &&
                project.status !== "COMPLETED" &&
                project.status !== "CANCELLED"
                  ? ` · due ${formatDay(project.targetOn)}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
