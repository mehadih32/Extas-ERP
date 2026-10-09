import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { materialsHref } from "@/components/materials/labels";
import { MaterialForm } from "@/components/materials/material-form";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getMaterialFormAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Add a material" };

/** A new raw material: for the store and buyers (materials.manage or materials.purchase). */
export default async function NewMaterialPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.can("materials.manage") && !ctx.can("materials.purchase")) {
    return (
      <MaterialsNoAccess title="Adding materials is not part of your role">
        The store team and Production Managers add raw materials.
      </MaterialsNoAccess>
    );
  }
  const result = await getMaterialFormAction();
  if (!result.ok) {
    return (
      <SectionError title="Add a material" heading="The form could not load" error={result.error} />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href={materialsHref.stock}>All materials</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Add a material</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Added once, then ordered, bought, counted and issued to production. Its stock starts at
          zero; record its opening stock or a purchase next.
        </p>
      </div>
      <MaterialForm form={result.data} />
    </div>
  );
}
