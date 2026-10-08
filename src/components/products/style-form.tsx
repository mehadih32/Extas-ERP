"use client";

import { LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import type { CategoryOption, StyleDetails } from "@/modules/inventory/screens.service";
import { createStyleAction, updateStyleAction } from "@/server/actions/inventory.actions";

import { AMOUNT_HINT, readAmount, textOf } from "./form-values";

const FIELDS = [
  "code",
  "name",
  "categoryId",
  "brandId",
  "fabric",
  "description",
  "wholesalePrice",
  "retailPrice",
] as const;
type FieldName = (typeof FIELDS)[number];

const indented = (c: CategoryOption) => `${"   ".repeat(c.depth)}${c.name}`;

/**
 * A style's details: code, name, category, brand, fabric, description and the
 * prices its SKUs sell at unless one has its own. For new styles and for
 * editing; both need inventory.manage, as the style actions check.
 */
export function StyleForm({
  style,
  categories,
  brands,
  currency,
}: {
  /** The style being edited, or null for a new one. */
  style: StyleDetails | null;
  categories: CategoryOption[];
  brands: Array<{ id: string; name: string }>;
  currency: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<ActionError>();
  const [problems, setProblems] = useState<Partial<Record<FieldName, string>>>({});
  const [pending, startTransition] = useTransition();
  const fieldError = (name: FieldName) => problems[name] ?? error?.fieldErrors?.[name]?.[0];
  const hasFieldErrors = FIELDS.some((f) => fieldError(f));
  const described = (name: FieldName, hint = false) =>
    fieldError(name) ? `${name}-error` : hint ? `${name}-hint` : undefined;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const wholesale = readAmount(textOf(form, "wholesalePrice"));
    const retail = readAmount(textOf(form, "retailPrice"));
    const found: Partial<Record<FieldName, string>> = {};
    if (!textOf(form, "categoryId")) found.categoryId = "Choose the category it is filed under.";
    if (wholesale === "invalid") found.wholesalePrice = AMOUNT_HINT;
    if (retail === "invalid") found.retailPrice = AMOUNT_HINT;
    setProblems(found);
    if (Object.keys(found).length > 0 || wholesale === "invalid" || retail === "invalid") return;

    const input = {
      code: textOf(form, "code"),
      name: textOf(form, "name"),
      categoryId: textOf(form, "categoryId"),
      brandId: textOf(form, "brandId") || null,
      fabric: textOf(form, "fabric") || null,
      description: textOf(form, "description") || null,
      wholesalePrice: wholesale ?? 0,
      retailPrice: retail ?? 0,
    };
    startTransition(async () => {
      const result = style
        ? await updateStyleAction(style.id, input)
        : await createStyleAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/products/${result.data.id}?${style ? "saved" : "created"}=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <Field
          id="code"
          label="Style code"
          hint={
            style ? "Its SKUs keep their codes, so printed tags stay valid." : "Like EX-PL-001."
          }
          error={fieldError("code")}
        >
          <Input
            id="code"
            name="code"
            defaultValue={style?.code}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="uppercase"
            aria-invalid={Boolean(fieldError("code"))}
            aria-describedby={described("code", true)}
            required
            autoFocus={!style}
          />
        </Field>
        <Field id="name" label="Name" error={fieldError("name")}>
          <Input
            id="name"
            name="name"
            defaultValue={style?.name}
            autoComplete="off"
            aria-invalid={Boolean(fieldError("name"))}
            aria-describedby={described("name")}
            required
          />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="categoryId" label="Category" error={fieldError("categoryId")}>
          <NativeSelect
            id="categoryId"
            name="categoryId"
            defaultValue={style?.category.id ?? ""}
            containerClassName="sm:w-full"
            className="md:h-10"
            aria-invalid={Boolean(fieldError("categoryId"))}
            aria-describedby={described("categoryId")}
            required
          >
            {!style && (
              <option value="" disabled>
                Choose a category
              </option>
            )}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {indented(c)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="brandId" label="Brand" error={fieldError("brandId")}>
          <NativeSelect
            id="brandId"
            name="brandId"
            defaultValue={style?.brand?.id ?? ""}
            containerClassName="sm:w-full"
            className="md:h-10"
            aria-invalid={Boolean(fieldError("brandId"))}
            aria-describedby={described("brandId")}
          >
            <option value="">No brand</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="wholesalePrice"
          label={`Wholesale price (${currency})`}
          hint="Per piece, for buyers."
          error={fieldError("wholesalePrice")}
        >
          <Input
            id="wholesalePrice"
            name="wholesalePrice"
            inputMode="decimal"
            defaultValue={style?.wholesalePrice ?? ""}
            placeholder="0.00"
            autoComplete="off"
            aria-invalid={Boolean(fieldError("wholesalePrice"))}
            aria-describedby={described("wholesalePrice", true)}
          />
        </Field>
        <Field
          id="retailPrice"
          label={`Retail price (${currency})`}
          hint="Per piece, for shoppers."
          error={fieldError("retailPrice")}
        >
          <Input
            id="retailPrice"
            name="retailPrice"
            inputMode="decimal"
            defaultValue={style?.retailPrice ?? ""}
            placeholder="0.00"
            autoComplete="off"
            aria-invalid={Boolean(fieldError("retailPrice"))}
            aria-describedby={described("retailPrice", true)}
          />
        </Field>
      </div>
      <Field id="fabric" label="Fabric (optional)" error={fieldError("fabric")}>
        <Input
          id="fabric"
          name="fabric"
          defaultValue={style?.fabric ?? ""}
          placeholder="Like 100% cotton pique, 220 GSM"
          autoComplete="off"
          aria-invalid={Boolean(fieldError("fabric"))}
          aria-describedby={described("fabric")}
        />
      </Field>
      <Field id="description" label="Description (optional)" error={fieldError("description")}>
        <Textarea
          id="description"
          name="description"
          defaultValue={style?.description ?? ""}
          rows={4}
          aria-invalid={Boolean(fieldError("description"))}
          aria-describedby={described("description")}
        />
      </Field>

      {error && error.code !== "INTERNAL" && !hasFieldErrors && (
        <FormAlert>{error.message}</FormAlert>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href={style ? `/products/${style.id}` : "/products"}>Cancel</Link>
        </Button>
        <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {style ? (pending ? "Saving" : "Save changes") : pending ? "Adding" : "Add the style"}
        </Button>
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title={style ? "We could not save the style" : "We could not add the style"}
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}
