import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { getAppearanceAction } from "@/server/actions/appearance.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Appearance" };

/**
 * Each person's look: Legacy (the original, everyone's default) or Modern (a
 * side menu and the modern styles). Open to everyone; it changes only their
 * own screens.
 */
export default async function AppearancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const saved = (await searchParams).saved === "1";
  const result = await getAppearanceAction();
  if (!result.ok) {
    return (
      <SectionError title="Appearance" heading="Your look could not load" error={result.error} />
    );
  }
  const { interfaceStyle } = result.data;

  return (
    <section aria-labelledby="appearance-heading" className="grid max-w-3xl gap-6">
      <div>
        <h2 id="appearance-heading" className="font-serif text-2xl text-primary">
          Appearance
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Choose how Extas ERP looks for you. Everything works the same in both looks; you can
          switch back at any time.
        </p>
      </div>
      {saved && (
        <FormAlert tone="success">
          Saved. You are using the {interfaceStyle === "MODERN" ? "Modern" : "Legacy"} look.
        </FormAlert>
      )}
      <AppearanceForm current={interfaceStyle} />
    </section>
  );
}
