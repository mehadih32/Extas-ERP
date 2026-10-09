"use client";

import { useRouter } from "next/navigation";

import { Field } from "@/components/forms/field";

import { productionHref } from "./labels";
import { ProjectPicker } from "./pickers";

/** The project goods are received for: a project in production or on hold. */
export function ChooseProject() {
  const router = useRouter();
  return (
    <div className="grid max-w-xl gap-2">
      <Field
        id="receive-project"
        label="Which project are the goods for?"
        hint="Projects in production or on hold. Search by code, name or buyer."
      >
        <ProjectPicker
          id="receive-project"
          purpose="RECEIVE"
          value={null}
          autoFocus
          describedBy="receive-project-hint"
          onChange={(project) => project && router.push(productionHref.newDelivery(project.id))}
        />
      </Field>
    </div>
  );
}
