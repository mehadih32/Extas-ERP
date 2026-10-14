"use client";

import type { BookingSource, DocumentLanguage, GarmentCategory } from "@prisma/client";
import { PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LANGUAGE_LABELS } from "@/modules/production/booking-presets";

import { standardTermList } from "./booking-draft";
import { Segmented } from "./booking-form-bits";

const LANGUAGES = (["EN", "BN"] as const).map((value) => ({
  value,
  label: LANGUAGE_LABELS[value],
}));

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((line, i) => line.trim() === b[i]?.trim());

/**
 * The booking's terms and conditions, one condition per box, numbered as the
 * PDF prints them. "English" and "বাংলা" swap the standard terms for the
 * other language; terms someone changed are only replaced when they say so.
 */
export function TermsEditor({
  source,
  category,
  collar,
  language,
  terms,
  onChange,
  error,
}: {
  source: BookingSource;
  category: GarmentCategory;
  collar: boolean;
  language: DocumentLanguage;
  terms: string[];
  onChange: (next: { language: DocumentLanguage; terms: string[] }) => void;
  error?: string;
}) {
  const [offer, setOffer] = useState<DocumentLanguage | null>(null);
  const standard = (lang: DocumentLanguage) => standardTermList(source, category, lang, collar);
  const isStandard = same(terms, standard(language));

  function switchTo(next: DocumentLanguage) {
    if (next === language) return;
    if (isStandard || terms.every((t) => !t.trim())) {
      onChange({ language: next, terms: standard(next) });
      setOffer(null);
    } else {
      onChange({ language: next, terms });
      setOffer(next);
    }
  }

  const change = (i: number, text: string) =>
    onChange({ language, terms: terms.map((t, j) => (j === i ? text : t)) });

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <span className="text-sm font-medium">Language of the terms</span>
          <span className="text-[0.8125rem] text-muted-foreground">
            The PDF prints the terms in this language.
          </span>
        </div>
        <Segmented
          label="Language of the terms"
          options={LANGUAGES}
          value={language}
          onChange={switchTo}
        />
      </div>
      {offer && (
        <FormAlert tone="note">
          <span className="block">
            You changed the terms. Load the standard {LANGUAGE_LABELS[offer]} terms instead? Your
            changes will be replaced.
          </span>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onChange({ language, terms: standard(offer) });
                setOffer(null);
              }}
            >
              Load the standard terms
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOffer(null)}>
              Keep mine
            </Button>
          </span>
        </FormAlert>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <ol className="grid gap-2" aria-label="Terms and conditions">
        {terms.map((term, i) => (
          <li key={i} className="flex min-w-0 items-start gap-2">
            <span className="mt-2.5 w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
              {i + 1}.
            </span>
            <label htmlFor={`term-${i}`} className="sr-only">
              Condition {i + 1}
            </label>
            <Textarea
              id={`term-${i}`}
              value={term}
              onChange={(e) => change(i, e.target.value.replace(/\r?\n/g, " "))}
              lang={language === "BN" ? "bn" : "en"}
              className="[field-sizing:content] min-h-16"
              maxLength={1200}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-1 shrink-0 text-muted-foreground"
              aria-label={`Remove condition ${i + 1}`}
              onClick={() => onChange({ language, terms: terms.filter((_, j) => j !== i) })}
            >
              <XIcon aria-hidden />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => onChange({ language, terms: [...terms, ""] })}
        >
          <PlusIcon aria-hidden />
          Add a condition
        </Button>
        {!isStandard && (
          <Button
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            onClick={() => {
              onChange({ language, terms: standard(language) });
              setOffer(null);
            }}
          >
            <RotateCcwIcon aria-hidden />
            Reset to the standard terms
          </Button>
        )}
      </div>
      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
        Write a heading before a colon (&quot;Shade: …&quot;) and the PDF prints it in bold. Empty
        boxes are left out.
      </p>
    </div>
  );
}
