import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { AddSuppressionForm } from "@/components/leads/lead-settings-forms";
import { EmptyState } from "@/components/products/bits";
import { SalesNoAccess } from "@/components/sales/no-access";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { SUPPRESSION_KIND_LABELS, SUPPRESSION_REASON_LABELS } from "@/modules/leads/labels";
import { listSuppressionsAction } from "@/server/actions/leads.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Do not contact" };

/**
 * "Do not contact": emails, email domains and phones nobody contacts. Kept only
 * as a code with a short hint, so it still works after a person's data is erased.
 */
export default async function DoNotContactPage() {
  const ctx = await requireCompanyPage();
  const result = await listSuppressionsAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError title="Do not contact" heading="The list could not load" error={result.error} />
    );
  }
  const rows = result.data;
  const canAdd = ctx.can("leads.manage");
  return (
    <section aria-labelledby="dnc-heading" className="grid gap-6">
      <BackLink href="/sales/leads">All leads</BackLink>
      <div>
        <h2 id="dnc-heading" className="font-serif text-2xl text-primary">
          Do not contact
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          People who asked not to be contacted, and people whose data was erased. Their leads stay,
          but the email and WhatsApp buttons never open for them. Only a short hint is shown.
        </p>
      </div>
      {canAdd && <AddSuppressionForm />}
      {rows.length === 0 ? (
        <EmptyState title="Nobody on the list">
          Add an email or phone when someone asks not to be contacted again.
        </EmptyState>
      ) : (
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="min-w-0 font-medium break-all">{r.hint}</span>
              <span className="text-muted-foreground">
                {SUPPRESSION_KIND_LABELS[r.kind]} · {SUPPRESSION_REASON_LABELS[r.reason]} · added{" "}
                {formatDay(r.addedOn)}
                {r.note ? ` · ${r.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
