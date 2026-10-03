import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { CompanyForms } from "@/components/settings/company/company-forms";
import { timeZoneChoices } from "@/components/settings/company/company-options";
import { CompanyView } from "@/components/settings/company/company-view";
import { getCompanyDetailsAction } from "@/server/actions/company.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Company" };

/**
 * The company's details, letterhead and business rules. Everyone in the company
 * may read them (like GET /api/company); company.settings may change them.
 */
export default async function CompanyPage() {
  await requireCompanyPage();
  const result = await getCompanyDetailsAction();
  if (!result.ok) {
    return (
      <SectionError
        title="Company"
        heading="The company details could not load"
        error={result.error}
      />
    );
  }
  const { details, canEdit } = result.data;

  return (
    <section aria-labelledby="company-heading" className="grid gap-6">
      <div>
        <h2 id="company-heading" className="font-serif text-2xl text-primary">
          Company
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          The company&apos;s details as they appear on documents and PDFs
          {canEdit ? ", and the rules the other screens follow." : "."}
        </p>
      </div>
      {canEdit ? (
        <CompanyForms details={details} timeZones={timeZoneChoices(details.timezone)} />
      ) : (
        <>
          <FormAlert tone="note">
            You can see the company details. Changing them needs the permission to edit the company
            settings.
          </FormAlert>
          <CompanyView details={details} />
        </>
      )}
    </section>
  );
}
