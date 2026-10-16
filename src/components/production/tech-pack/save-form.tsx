"use client";

import { CheckIcon, LoaderCircleIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { productionHref } from "@/components/production/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NOT_REACHED, reach } from "@/lib/reach";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { SaveTarget } from "@/modules/production/tech-pack-register.service";
import { pickSaveTargetsAction, saveToTechPackAction } from "@/server/actions/tech-pack.actions";

/*
 * The Save to Tech Pack form: the tech pack (one started from a buyer's brief,
 * or an open style in production's own, searched by number, code or name),
 * the shared photo or one chosen here, the link and a note.
 */

type Pick = SaveTarget;

export function SaveToTechPackForm({
  sharedFileId,
  link,
  note,
  problem,
}: {
  sharedFileId: string | null;
  link: string;
  note: string;
  problem: string | null;
}) {
  const [search, setSearch] = useState("");
  const [styles, setStyles] = useState<Pick[]>([]);
  const [unreached, setUnreached] = useState(false);
  const [chosen, setChosen] = useState<Pick | null>(null);
  const [loading, startLoading] = useTransition();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const [saved, setSaved] = useState<{ pick: Pick; techPackId: string } | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () =>
        startLoading(async () => {
          const result = await reach(() => pickSaveTargetsAction(search));
          setStyles(result.ok ? result.data : []);
          setUnreached(!result.ok && result.error.message === NOT_REACHED);
        }),
      250,
    );
    return () => clearTimeout(timer);
  }, [search]);

  if (saved) {
    return (
      <div className="grid max-w-xl gap-4 rounded-lg border bg-card p-5 sm:p-6">
        <FormAlert tone="success">
          Saved to {saved.pick.code} · {saved.pick.name}.
        </FormAlert>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={productionHref.techPackOf(saved.techPackId)}>Open the tech pack</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/production/save">Save another</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid max-w-xl gap-5 rounded-lg border bg-card p-5 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!chosen) {
          setError({ code: "VALIDATION", message: "Pick the tech pack to save it to." });
          return;
        }
        const form = new FormData(event.currentTarget);
        if (sharedFileId) form.set("sharedFileId", sharedFileId);
        startTransition(async () => {
          const result = await reach(() => saveToTechPackAction(chosen, form));
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setSaved({ pick: chosen, techPackId: result.data.techPackId });
        });
      }}
    >
      {problem && <FormAlert>{problem}</FormAlert>}
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Tech pack</legend>
        {chosen ? (
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <span className="min-w-0 break-words">
              {chosen.code} · {chosen.name}
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setChosen(null)}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                aria-label="Find a tech pack"
                placeholder="Tech pack no., style code or name"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <ul className="grid max-h-64 divide-y overflow-y-auto rounded-md border">
              {loading && styles.length === 0 ? (
                <li className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
                  Finding tech packs
                </li>
              ) : styles.length === 0 ? (
                <li className="p-3 text-sm text-muted-foreground">
                  {unreached ? NOT_REACHED : "No tech pack or open style matches."}
                </li>
              ) : (
                styles.map((s) => (
                  <li key={`${s.kind}-${s.id}`}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between gap-3 p-3 text-left text-sm hover:bg-secondary/50",
                      )}
                      onClick={() => setChosen(s)}
                    >
                      <span className="min-w-0 break-words">
                        <span className="font-medium">{s.code}</span> · {s.name}
                        <span className="block text-[0.8125rem] text-muted-foreground">
                          {s.kind === "TECH_PACK" ? "Tech pack" : "Production project"}
                          {s.buyer ? ` · ${s.buyer}` : ""}
                        </span>
                      </span>
                      <CheckIcon className="size-4 opacity-0" aria-hidden />
                    </button>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </fieldset>

      {sharedFileId ? (
        <div className="grid gap-2">
          <span className="text-sm font-medium">Shared photo</span>
          {/* eslint-disable-next-line @next/next/no-img-element -- the photo just shared */}
          <img
            src={productionHref.file(sharedFileId)}
            alt="The shared photo"
            className="max-h-64 w-auto rounded-md border object-contain"
          />
        </div>
      ) : (
        <Field
          id="save-file"
          label="Photo"
          hint="JPG, PNG, WebP or PDF, up to 10 MB."
          error={error?.fieldErrors?.file?.[0]}
        >
          <Input
            id="save-file"
            name="file"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
          />
        </Field>
      )}
      <Field id="save-link" label="Link" error={error?.fieldErrors?.link?.[0]}>
        <Input
          id="save-link"
          name="link"
          type="url"
          inputMode="url"
          defaultValue={link}
          placeholder="https://"
        />
      </Field>
      <Field
        id="save-note"
        label="Note"
        hint="e.g. 4-hole MOP button, about 18L"
        error={error?.fieldErrors?.note?.[0]}
      >
        <Textarea id="save-note" name="note" rows={2} defaultValue={note} />
      </Field>
      {error && !error.fieldErrors && <FormAlert>{error.message}</FormAlert>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Saving" : "Save to Tech Pack"}
        </Button>
      </div>
    </form>
  );
}
