"use client";

import type { MeasurementUnit, RawMaterialKind } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormFooter } from "@/components/accounts/form-bits";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { MaterialForm as MaterialFormData } from "@/modules/materials/screens.service";
import { createMaterialAction, updateMaterialAction } from "@/server/actions/materials.actions";

import {
  KIND_HINTS,
  KIND_LABELS,
  KINDS,
  materialsHref,
  readQuantity,
  UNIT_NAMES,
  UNITS,
} from "./labels";
import { SupplierPicker } from "./pickers";
import { useMaterialsForm } from "./use-form";

type Party = { id: string; code: string; name: string };

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * A raw material's details: its name, kind and unit, colour and
 * specification, the stock level that marks it running low and its usual
 * supplier. A new one gets the next code of its kind unless one is typed. The
 * unit is fixed once the material has been bought, counted or ordered.
 */
export function MaterialForm({ form: data }: { form: MaterialFormData }) {
  const router = useRouter();
  const form = useMaterialsForm();
  const { fieldError } = form;
  const m = data.material;
  const [kind, setKind] = useState<RawMaterialKind>(m?.kind ?? "FABRIC");
  const [unit, setUnit] = useState<MeasurementUnit>(m?.unit ?? "METER");
  const [supplier, setSupplier] = useState<Party | null>(m?.supplier ?? null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    const name = textOf(values, "name");
    if (name.length < 2) found.name = "Enter the material's name.";
    const code = textOf(values, "code");
    if (m && !code) found.code = "Enter the code.";
    else if (code && (code.length < 2 || !CODE_PATTERN.test(code))) {
      found.code = "Use letters, digits and - . / _ only (2 or more).";
    }
    const levelText = textOf(values, "reorderLevel");
    const level = levelText ? readQuantity(levelText, unit, { allowZero: true }) : null;
    if (typeof level === "string") found.reorderLevel = level;
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;

    const fields = {
      name,
      kind,
      unit,
      color: textOf(values, "color") || null,
      specification: textOf(values, "specification") || null,
      reorderLevel: level as number | null,
      supplierId: supplier?.id ?? null,
      notes: textOf(values, "notes") || null,
    };
    form.startTransition(async () => {
      const result = m
        ? await updateMaterialAction(m.id, { ...fields, code })
        : await createMaterialAction({ ...fields, code: code || undefined });
      if (!result.ok) return form.setError(result.error);
      router.push(`${materialsHref.material(result.data.id)}?${m ? "saved" : "created"}=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field id="name" label="Name" error={fieldError("name")}>
          <Input
            id="name"
            name="name"
            defaultValue={m?.name}
            maxLength={160}
            autoComplete="off"
            placeholder="Like: Single jersey 160 GSM"
            aria-invalid={Boolean(fieldError("name"))}
            aria-describedby={fieldError("name") ? "name-error" : undefined}
            autoFocus={!m}
          />
        </Field>
        <Field
          id="code"
          label={m ? "Code" : "Code (optional)"}
          hint={m ? undefined : "Left empty, it gets the next code of its kind."}
          error={fieldError("code")}
        >
          <Input
            id="code"
            name="code"
            defaultValue={m?.code}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="characters"
            aria-invalid={Boolean(fieldError("code"))}
            aria-describedby={fieldError("code") ? "code-error" : m ? undefined : "code-hint"}
          />
        </Field>
        <Field id="kind" label="Kind" hint={KIND_HINTS[kind]} error={fieldError("kind")}>
          <NativeSelect
            id="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as RawMaterialKind)}
            containerClassName="sm:w-full"
            aria-describedby="kind-hint"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          id="unit"
          label="Counted in"
          hint={
            data.unitLocked ?? "How the store counts it, bills price it and issues hand it out."
          }
          error={fieldError("unit")}
        >
          <NativeSelect
            id="unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as MeasurementUnit)}
            disabled={Boolean(data.unitLocked)}
            containerClassName="sm:w-full"
            aria-describedby="unit-hint"
            aria-invalid={Boolean(fieldError("unit"))}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_NAMES[u]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="color" label="Colour (optional)" error={fieldError("color")}>
          <Input
            id="color"
            name="color"
            defaultValue={m?.color}
            maxLength={60}
            autoComplete="off"
          />
        </Field>
        <Field
          id="reorderLevel"
          label="Running low at (optional)"
          hint="It shows as running low at or below this. Left empty, it never does."
          error={fieldError("reorderLevel")}
        >
          <Input
            id="reorderLevel"
            name="reorderLevel"
            inputMode="decimal"
            defaultValue={m?.reorderLevel}
            autoComplete="off"
            aria-invalid={Boolean(fieldError("reorderLevel"))}
            aria-describedby={
              fieldError("reorderLevel") ? "reorderLevel-error" : "reorderLevel-hint"
            }
          />
        </Field>
      </div>
      <Field
        id="specification"
        label="Specification (optional)"
        hint="GSM, width, composition, size: what a supplier needs to send the right thing."
        error={fieldError("specification")}
      >
        <Textarea
          id="specification"
          name="specification"
          rows={2}
          maxLength={500}
          defaultValue={m?.specification}
          aria-describedby="specification-hint"
        />
      </Field>
      <Field id="supplierId" label="Usual supplier (optional)" error={fieldError("supplierId")}>
        <SupplierPicker
          id="supplierId"
          value={supplier}
          onChange={setSupplier}
          invalid={Boolean(fieldError("supplierId"))}
          describedBy={fieldError("supplierId") ? "supplierId-error" : undefined}
        />
      </Field>
      <Field id="notes" label="Notes (optional)" error={fieldError("notes")}>
        <Textarea id="notes" name="notes" rows={2} maxLength={2000} defaultValue={m?.notes} />
      </Field>
      {m && !m.isActive && (
        <FormAlert tone="note">
          This material is archived. Saving keeps it archived; bring it back from its page.
        </FormAlert>
      )}
      <FormFooter
        form={form}
        cancelHref={m ? materialsHref.material(m.id) : materialsHref.stock}
        submitLabel={m ? "Save the changes" : "Add the material"}
        errorTitle={m ? "We could not save the material" : "We could not add the material"}
      />
    </form>
  );
}
