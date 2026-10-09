import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { materialsHref } from "@/components/materials/labels";
import { MaterialForm } from "@/components/materials/material-form";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getMaterialFormAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Change a material" };

/** A raw material's details: for the store and buyers (materials.manage or materials.purchase). */
export default async function EditMaterialPage({
  params,
}: {
  params: Promise<{ materialId: string }>;
}) {
  const ctx = await requireCompanyPage();
  const { materialId } = await params;
  if (!ctx.can("materials.manage") && !ctx.can("materials.purchase")) {
    return (
      <MaterialsNoAccess title="Changing materials is not part of your role">
        The store team and Production Managers keep the materials list.
      </MaterialsNoAccess>
    );
  }
  const result = await getMaterialFormAction(materialId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <SectionError title="Material" heading="The material could not load" error={result.error} />
    );
  }
  const m = result.data.material!;

  return (
    <div className="grid gap-6">
      <BackLink href={materialsHref.material(m.id)}>{m.code}</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Change {m.code}</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Its stock and history stay as they are.
        </p>
      </div>
      <MaterialForm form={result.data} />
    </div>
  );
}
