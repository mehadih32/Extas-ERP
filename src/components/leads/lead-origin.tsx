import Link from "next/link";

import { formatDay } from "@/lib/display";
import type { leadOfBuyer } from "@/modules/leads/lead.service";
import { ACTIVITY_LABELS } from "@/modules/leads/labels";

type Origin = NonNullable<Awaited<ReturnType<typeof leadOfBuyer>>>;

/** Buyer 360's "Came from lead": where the buyer came from and the lead's history before it. */
export function LeadOrigin({ origin }: { origin: Origin }) {
  return (
    <section aria-labelledby="lead-origin-heading" className="grid gap-3 rounded-md border p-4">
      <h2 id="lead-origin-heading" className="font-serif text-xl text-primary">
        Came from lead
      </h2>
      <p className="text-sm break-words">
        <Link
          href={`/sales/leads/${encodeURIComponent(origin.id)}`}
          className="font-medium text-primary hover:underline"
        >
          {origin.number}
        </Link>
        {origin.source ? ` · ${origin.source}` : ""}
        {origin.sourceNote ? ` · ${origin.sourceNote}` : ""} · added {formatDay(origin.addedOn)}
      </p>
      <ol className="grid gap-2">
        {origin.history.map((h) => (
          <li key={h.id} className="border-l-2 pl-3 text-sm">
            <span className="text-[0.8125rem] text-muted-foreground">
              {formatDay(h.on)} · {ACTIVITY_LABELS[h.kind]}
            </span>
            <span className="block break-words">{h.summary}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
