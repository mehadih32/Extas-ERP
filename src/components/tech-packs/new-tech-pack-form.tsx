"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { productionHref } from "@/components/production/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import { createTechPackAction } from "@/server/actions/tech-pack.actions";

import { BuyerPicker, type Choice, StylePicker } from "./pickers";

/*
 * New tech pack: started from the buyer's brief and references before any
 * order or production project exists. Only the title is needed; the rest can
 * be added later on the tech pack's page.
 */

export function NewTechPackForm() {
  const router = useRouter();
  const [buyer, setBuyer] = useState<Choice | null>(null);
  const [style, setStyle] = useState<Choice | null>(null);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const fieldError = (name: string) => error?.fieldErrors?.[name]?.[0];

  return (
    <form
      className="grid max-w-2xl gap-5 rounded-lg border bg-card p-5 sm:p-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (buyer) form.set("buyerId", buyer.id);
        if (style) form.set("styleId", style.id);
        startTransition(async () => {
          const result = await createTechPackAction(form);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.push(productionHref.techPackOf(result.data.id));
        });
      }}
    >
      <Field
        id="tp-title"
        label="Title"
        hint="e.g. the buyer's style name and season"
        error={fieldError("title")}
      >
        <Input id="tp-title" name="title" required maxLength={160} autoComplete="off" />
      </Field>
      <div className="grid gap-2">
        <span className="text-sm font-medium" id="tp-buyer-label">
          Buyer
        </span>
        <BuyerPicker id="tp-buyer" value={buyer} onChange={setBuyer} />
        {fieldError("buyerId") && (
          <p className="text-[0.8125rem] text-destructive">{fieldError("buyerId")}</p>
        )}
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">Style (optional)</span>
        <StylePicker id="tp-style" value={style} onChange={setStyle} />
        {fieldError("styleId") && (
          <p className="text-[0.8125rem] text-destructive">{fieldError("styleId")}</p>
        )}
      </div>
      <Field id="tp-season" label="Season" hint="e.g. SS27" error={fieldError("season")}>
        <Input id="tp-season" name="season" maxLength={40} autoComplete="off" />
      </Field>
      <Field
        id="tp-brief"
        label="Buyer's brief"
        hint="What the buyer asked for: fabric, GSM, collar, trims, sizes, colours."
        error={fieldError("brief")}
      >
        <Textarea id="tp-brief" name="brief" rows={6} maxLength={5000} />
      </Field>
      <Field
        id="tp-files"
        label="Reference photos or PDFs"
        hint="Up to 6 files, each up to 10 MB."
        error={fieldError("files")}
      >
        <Input
          id="tp-files"
          name="files"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
        />
      </Field>
      <Field id="tp-link" label="Reference link" error={fieldError("link")}>
        <Input id="tp-link" name="link" type="url" inputMode="url" placeholder="https://" />
      </Field>
      {error && !error.fieldErrors && <FormAlert>{error.message}</FormAlert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Starting" : "Start tech pack"}
        </Button>
      </div>
    </form>
  );
}
