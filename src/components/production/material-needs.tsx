import {
  FileDownIcon,
  PackageCheckIcon,
  PackageOpenIcon,
  PencilIcon,
  ScrollTextIcon,
  ShoppingCartIcon,
} from "lucide-react";
import Link from "next/link";

import { OrderBadge } from "@/components/materials/badges";
import { quantity } from "@/components/materials/labels";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { BatchMaterials, NeedsPanel } from "@/modules/production/material-screens.service";

import { productionHref, SPLIT_LABELS } from "./labels";
import { MaterialThumb } from "./material-thumb";

const linkClass = "text-primary underline-offset-4 hover:underline";
const isZero = (text: string) => !/[1-9]/.test(text);

/** "120 kg needed · 80 kg ordered · 40 kg to order", the last in amber while some is left. */
function NeedLine({
  total,
  ordered,
  toOrder,
  unit,
  currency,
}: {
  total: string;
  ordered: string;
  toOrder: string;
  unit: NeedsPanel["needs"][number]["unit"];
  currency: string;
}) {
  const q = (text: string) => quantity(text, unit, currency);
  return (
    <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
      {q(total)} needed · {q(ordered)} ordered ·{" "}
      {isZero(toOrder) ? (
        <span className="text-emerald-700 dark:text-emerald-400">All ordered</span>
      ) : (
        <span className="font-medium text-amber-700 dark:text-amber-400">
          {q(toOrder)} to order
        </span>
      )}
    </p>
  );
}

/**
 * A style's "Materials per piece" on its page: each material with what one piece
 * takes and what the pieces need, ordered and still to order (per colour, or
 * colour and size, when it is split), the batch orders it has a share of, the
 * tech pack and, for a Production Manager, "Edit materials".
 */
export function MaterialNeedsPanel({ panel, currency }: { panel: NeedsPanel; currency: string }) {
  const { project: p, needs, orders, can } = panel;
  return (
    <Panel
      title="Materials per piece"
      id="material-needs-heading"
      action={
        can.edit ? (
          <Button asChild variant="outline" size="sm">
            <Link href={productionHref.materials(p.id)}>
              <PencilIcon aria-hidden />
              {needs.length === 0 ? "Add materials" : "Edit materials"}
            </Link>
          </Button>
        ) : undefined
      }
    >
      {needs.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          No materials per piece yet. Say what one piece takes (fabric, collar, buttons, labels) and
          what to order is worked out from the pieces
          {panel.hasGrid ? " of each colour and size" : ""}.
        </p>
      ) : (
        <ul className="mt-4 grid divide-y" aria-label="Materials per piece">
          {needs.map((n) => (
            <li key={n.id} className="flex min-w-0 gap-3 py-3 first:pt-0 last:pb-0">
              <MaterialThumb imageId={n.imageId} alt={n.material.name} />
              <div className="grid min-w-0 flex-1 gap-1">
                <p className="text-sm break-words">
                  {n.placement && <span className="font-medium">{n.placement}: </span>}
                  {n.material.href ? (
                    <Link href={n.material.href} className={linkClass}>
                      {n.material.code} · {n.material.name}
                    </Link>
                  ) : (
                    `${n.material.code} · ${n.material.name}`
                  )}
                </p>
                <p className="text-[0.8125rem] tabular-nums">
                  {n.perPiece} · {SPLIT_LABELS[n.split]}
                </p>
                <NeedLine
                  total={n.total}
                  ordered={n.ordered}
                  toOrder={n.toOrder}
                  unit={n.unit}
                  currency={currency}
                />
                {n.parts.length > 1 && (
                  <details className="group text-[0.8125rem]">
                    <summary className="cursor-pointer text-primary select-none">
                      {n.split === "COLOUR" ? "By colour" : "By colour and size"}
                    </summary>
                    <ul className="mt-1.5 grid gap-0.5 text-muted-foreground tabular-nums sm:grid-cols-2">
                      {n.parts.map((pt) => (
                        <li key={`${pt.colorName}|${pt.sizeName}`}>
                          {pt.colorName}
                          {pt.sizeName ? ` ${pt.sizeName}` : ""}:{" "}
                          {quantity(pt.quantity, n.unit, currency)} for {pt.pieces} pcs
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {n.notes && (
                  <p className="text-[0.8125rem] break-words text-muted-foreground">{n.notes}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {orders.length > 0 && (
        <>
          <h4 className="eyebrow mt-6">On purchase orders</h4>
          <ul className="mt-2 grid gap-2">
            {orders.map((o) => (
              <li key={o.id} className="rounded-md border px-3 py-2 text-sm">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {o.href ? (
                    <Link href={o.href} className={`font-medium ${linkClass}`}>
                      {o.number}
                    </Link>
                  ) : (
                    <span className="font-medium">{o.number}</span>
                  )}
                  <OrderBadge status={o.status} />
                  <span className="text-muted-foreground">{o.supplier}</span>
                </p>
                <p className="mt-0.5 text-[0.8125rem] text-muted-foreground tabular-nums">
                  This style&apos;s share:{" "}
                  {o.lines
                    .map((l) => `${l.code} ${quantity(l.quantity, l.unit, currency)}`)
                    .join(", ")}
                  {o.expectedOn ? ` · expected ${formatDay(o.expectedOn)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      {panel.techPackNotes && (
        <>
          <h4 className="eyebrow mt-6">Making notes</h4>
          <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-line">
            {panel.techPackNotes}
          </p>
        </>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={productionHref.techPack(p.id)} download>
            <FileDownIcon aria-hidden />
            Tech pack (PDF)
          </a>
        </Button>
        {can.orderForBatch && p.batch && needs.some((n) => !isZero(n.toOrder)) && (
          <Button asChild size="sm">
            <Link href={productionHref.batchOrders(p.batch.id)}>
              <ShoppingCartIcon aria-hidden />
              Make purchase orders
            </Link>
          </Button>
        )}
      </div>
    </Panel>
  );
}

/**
 * The batch's materials: each material its styles need, with what is needed,
 * ordered and still to order over all of them, and "Make purchase orders".
 */
export function BatchMaterialsPanel({
  data,
  currency,
}: {
  data: BatchMaterials;
  currency: string;
}) {
  const without = data.styles.filter((s) => s.needs === 0);
  const left = data.materials.filter((m) => !isZero(m.toOrder));
  // Fabric is booked with a booking; trims and accessories go on purchase orders.
  const fabricLeft = left.some((m) => m.material.kind === "FABRIC");
  const othersLeft = left.some((m) => m.material.kind !== "FABRIC");
  return (
    <Panel
      title="Materials"
      id="batch-materials-heading"
      action={
        (data.can.book || data.can.order) && data.materials.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-2">
            {data.can.book && (
              <Button asChild size="sm" variant={fabricLeft ? "default" : "outline"}>
                <Link href={productionHref.newBooking(data.batch.id)}>
                  <ScrollTextIcon aria-hidden />
                  Book fabric
                </Link>
              </Button>
            )}
            {data.can.order && (
              <Button asChild size="sm" variant={othersLeft ? "default" : "outline"}>
                <Link href={productionHref.batchOrders(data.batch.id)}>
                  <ShoppingCartIcon aria-hidden />
                  Make purchase orders
                </Link>
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {data.materials.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {data.styles.length === 0
            ? "No open style to buy materials for."
            : "Give each style its materials per piece and the batch's fabric and accessories add up here, ready to order from each supplier in one go."}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            {left.length === 0
              ? "Everything the styles need is on order."
              : `${left.length} of ${data.materials.length} still to order.`}
          </p>
          <ul className="mt-4 grid divide-y" aria-label="Batch materials">
            {data.materials.map((m) => (
              <li key={m.material.id} className="flex min-w-0 gap-3 py-3 first:pt-0 last:pb-0">
                <MaterialThumb imageId={m.imageId} alt={m.material.name} />
                <div className="grid min-w-0 flex-1 gap-1">
                  <p className="text-sm break-words">
                    {m.material.href ? (
                      <Link href={m.material.href} className={`font-medium ${linkClass}`}>
                        {m.material.code} · {m.material.name}
                      </Link>
                    ) : (
                      <span className="font-medium">
                        {m.material.code} · {m.material.name}
                      </span>
                    )}
                  </p>
                  <p className="text-[0.8125rem] break-words text-muted-foreground">
                    {[m.placements.join(", "), `for ${m.styles.join(", ")}`, m.supplier?.name]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <NeedLine
                    total={m.needed}
                    ordered={m.ordered}
                    toOrder={m.toOrder}
                    unit={m.material.unit}
                    currency={currency}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {without.length > 0 && data.materials.length > 0 && (
        <p
          className={cn(
            "mt-4 rounded-md border px-3 py-2 text-[0.8125rem]",
            "border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200",
          )}
        >
          No materials per piece yet for{" "}
          {without.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <Link href={productionHref.project(s.id)} className="underline underline-offset-4">
                {s.code}
              </Link>
            </span>
          ))}
          ; their fabric and accessories are not counted here.
        </p>
      )}
      {(data.can.receive || data.can.issue) && (
        <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
          {data.can.receive && (
            <Button asChild size="sm" variant="outline">
              <Link href={productionHref.receive(data.batch.id)}>
                <PackageCheckIcon aria-hidden />
                Receive a delivery
              </Link>
            </Button>
          )}
          {data.can.issue && (
            <Button asChild size="sm" variant="outline">
              <Link href={productionHref.issue(data.batch.id)}>
                <PackageOpenIcon aria-hidden />
                Issue to styles
              </Link>
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}
