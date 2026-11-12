import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { LeadRulesForm, LeadSourcesForm } from "@/components/leads/lead-settings-forms";
import { SalesNoAccess } from "@/components/sales/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getLeadSettingsAction } from "@/server/actions/leads.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Lead settings" };

/** Lead settings (leads.settings): the lead check card's rules and the lead sources. */
export default async function LeadSettingsPage() {
  await requireCompanyPage();
  const result = await getLeadSettingsAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <SalesNoAccess title="Lead settings are not part of your role">
          The owner sets the lead check rules and the sources.
        </SalesNoAccess>
      );
    }
    return (
      <SectionError
        title="Lead settings"
        heading="The settings could not load"
        error={result.error}
      />
    );
  }
  return (
    <div className="grid gap-8">
      <BackLink href="/sales/leads">All leads</BackLink>
      <section aria-labelledby="lead-rules-heading" className="grid gap-4">
        <div>
          <h2 id="lead-rules-heading" className="font-serif text-2xl text-primary">
            Lead check rules
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Set once. Every lead&apos;s check card compares the lead with them: green, yellow or
            red, each with its reason.
          </p>
        </div>
        <LeadRulesForm page={result.data} />
      </section>
      <section aria-labelledby="lead-sources-heading" className="grid gap-4">
        <div>
          <h2 id="lead-sources-heading" className="font-serif text-2xl text-primary">
            Lead sources
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Where leads come from. Add each fair with its season, so the reports show which fair
            brought buyers. A source in use is switched off, never removed.
          </p>
        </div>
        <LeadSourcesForm page={result.data} />
      </section>
    </div>
  );
}
