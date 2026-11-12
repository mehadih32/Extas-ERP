import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { TaTemplateForm } from "@/components/ta/ta-template-form";
import { getTaTemplateAction } from "@/server/actions/ta.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "T&A template" };

/** The company's T&A template (company.settings): every order's T&A is made from it. */
export default async function TaTemplatePage() {
  await requireCompanyPage();
  const result = await getTaTemplateAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <ProductionNoAccess title="Changing the T&A template is not part of your role">
          Your administrator can give your role the permission to change company settings.
        </ProductionNoAccess>
      );
    }
    return (
      <SectionError
        title="T&A template"
        heading="The template could not load"
        error={result.error}
      />
    );
  }
  return (
    <section aria-labelledby="ta-template-heading" className="grid gap-6">
      <BackLink href="/production/ta-calendar">T&amp;A calendar</BackLink>
      <div>
        <h2 id="ta-template-heading" className="font-serif text-2xl text-primary">
          T&amp;A template
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          The steps every order gets from its ship date. A change counts for orders that get their
          T&amp;A after it; each order&apos;s own days can be changed on the order.
        </p>
      </div>
      <TaTemplateForm template={result.data} />
    </section>
  );
}
