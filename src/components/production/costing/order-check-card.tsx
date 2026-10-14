import { Panel } from "@/components/sales/detail-bits";
import { cn } from "@/lib/utils";
import type { CheckRow, CheckSignal } from "@/modules/costing/order-check";

/*
 * The Order check card: five checks, each green, yellow or red with its
 * one-line reason. No score and no refusal: the owner decides.
 */

const SIGNAL: Record<CheckSignal, { label: string; dot: string; row: string }> = {
  green: { label: "Fine", dot: "bg-success", row: "border-success/25" },
  yellow: { label: "Look again", dot: "bg-amber-400", row: "border-amber-400/40" },
  red: { label: "A problem", dot: "bg-destructive", row: "border-destructive/30" },
};

export function OrderCheckCard({ rows }: { rows: CheckRow[] }) {
  return (
    <Panel title="Order check card" id="order-check-heading">
      <p className="mt-1 text-sm text-muted-foreground">
        Five checks to read before you take the order. It never declines anything: you decide.
      </p>
      <ul className="mt-4 grid gap-2">
        {rows.map((r) => {
          const s = SIGNAL[r.signal];
          return (
            <li
              key={r.key}
              className={cn("flex items-start gap-3 rounded-md border bg-background p-3", s.row)}
            >
              <span
                role="img"
                aria-label={s.label}
                title={s.label}
                className={cn("mt-1 size-3 shrink-0 rounded-full", s.dot)}
              />
              <div className="min-w-0 text-sm">
                <p className="font-medium">{r.label}</p>
                <p className="mt-0.5 break-words text-muted-foreground">{r.reason}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
