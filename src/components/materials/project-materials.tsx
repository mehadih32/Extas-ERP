import { PlusIcon, SendIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";

import { Panel } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";
import type { ProjectMaterialsPanel } from "@/modules/materials/screens.service";

import { IssueKindBadge, OrderBadge } from "./badges";
import { materialsHref, quantity } from "./labels";

const linkClass = "text-primary underline-offset-4 hover:underline";
const NOTES_SHOWN = 5;

/**
 * A production project's raw materials, on its Production page: what the
 * store handed it and took back, what it still holds, purchase orders still
 * due for it and its issue notes. Costs show to people who see material
 * prices; the store team issues and takes back, buyers order for it.
 */
export function ProjectMaterials({
  panel,
  currency,
  canOpenNotes,
}: {
  panel: ProjectMaterialsPanel;
  currency: string;
  /** Whether the issue notes list opens (materials.view). */
  canOpenNotes: boolean;
}) {
  const { project, materials, notes, orders, seeCosts, can } = panel;
  const any = can.issue || can.takeBack || can.order;

  return (
    <Panel
      title="Raw materials"
      id="materials-heading"
      action={
        canOpenNotes && notes.length > NOTES_SHOWN ? (
          <Link
            href={`${materialsHref.issues}?project=${encodeURIComponent(project.id)}`}
            className={`text-sm ${linkClass}`}
          >
            All notes
          </Link>
        ) : undefined
      }
    >
      {any && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {can.issue && (
            <Button asChild size="sm" className="w-full sm:w-auto">
              <Link href={materialsHref.newIssue("issue", project.id)}>
                <SendIcon aria-hidden />
                Issue materials
              </Link>
            </Button>
          )}
          {can.takeBack && (
            <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
              <Link href={materialsHref.newIssue("return", project.id)}>
                <Undo2Icon aria-hidden />
                Take back unused
              </Link>
            </Button>
          )}
          {can.order && (
            <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
              <Link href={materialsHref.newOrder({ project: project.id })}>
                <PlusIcon aria-hidden />
                Order for it
              </Link>
            </Button>
          )}
        </div>
      )}

      {materials.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing has been issued from the store yet. Fabric and trims handed to the factory are
          recorded with an issue note, and their cost joins the project&apos;s.
        </p>
      ) : (
        <ul className="mt-4 grid divide-y" aria-label="Materials with the project">
          {materials.map((m) => {
            const q = (text: string) => quantity(text, m.unit, currency);
            return (
              <li
                key={m.material.id}
                className="flex min-w-0 items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words">
                    {m.material.href ? (
                      <Link href={m.material.href} className={linkClass}>
                        {m.material.code}
                      </Link>
                    ) : (
                      m.material.code
                    )}{" "}
                    · {m.material.name}
                  </p>
                  <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                    {q(m.issued)} issued
                    {/[1-9]/.test(m.returned) ? ` · ${q(m.returned)} back` : ""}
                  </p>
                </div>
                <div className="text-right text-sm whitespace-nowrap tabular-nums">
                  <p className="font-medium">{q(m.held)}</p>
                  {seeCosts && m.value && (
                    <p className="text-[0.8125rem] text-muted-foreground">
                      {money(m.value, currency)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {seeCosts && panel.materialCost && materials.length > 0 && (
        <p className="mt-4 flex items-baseline justify-between gap-3 border-t pt-4 text-sm font-medium tabular-nums">
          <span>Materials cost</span>
          <span className="font-serif text-lg">{money(panel.materialCost, currency)}</span>
        </p>
      )}

      {orders.length > 0 && (
        <>
          <h4 className="eyebrow mt-6">Still to arrive</h4>
          <ul className="mt-3 grid divide-y" aria-label="Purchase orders still to arrive">
            {orders.map((o) => (
              <li key={o.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  {o.href ? (
                    <Link href={o.href} className={`font-medium ${linkClass}`}>
                      {o.number}
                    </Link>
                  ) : (
                    <span className="font-medium">{o.number}</span>
                  )}
                  <OrderBadge status={o.status} />
                </p>
                <p className="text-[0.8125rem] break-words text-muted-foreground">
                  {o.supplier?.name}
                  {o.expectedOn ? ` · expected ${formatDay(o.expectedOn)}` : ""}
                </p>
                <p className="text-[0.8125rem] break-words tabular-nums">
                  {o.lines
                    .filter((l) => /[1-9]/.test(l.pending))
                    .map((l) => `${l.code} ${quantity(l.pending, l.unit, currency)}`)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      {notes.length > 0 && (
        <>
          <h4 className="eyebrow mt-6">Issue notes</h4>
          <ul className="mt-3 grid divide-y" aria-label="Issue notes">
            {notes.slice(0, NOTES_SHOWN).map((n) => (
              <li
                key={n.id}
                className="flex min-w-0 items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="min-w-0 text-sm">
                  {n.href ? (
                    <Link href={n.href} className={`font-medium ${linkClass}`}>
                      {n.number}
                    </Link>
                  ) : (
                    <span className="font-medium">{n.number}</span>
                  )}
                  <span className="text-muted-foreground"> · {formatDay(n.day)}</span>
                </span>
                <IssueKindBadge kind={n.kind} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
