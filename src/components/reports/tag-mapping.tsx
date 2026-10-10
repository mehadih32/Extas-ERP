"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { TemplateScreen } from "@/modules/reports/screens.service";
import { setTemplatePlaceholdersAction } from "@/server/actions/templates.actions";

type Catalog = TemplateScreen["catalog"];
type Format = "upper" | "lower" | null;

export const CASE_LABELS: Array<[string, string]> = [
  ["", "As it is"],
  ["upper", "CAPITALS"],
  ["lower", "small letters"],
];

/** The catalogue as choices: what each tag can print, lines last. */
export function DataOptions({ catalog }: { catalog: Catalog }) {
  const whole = catalog.filter((c) => !c.item);
  const lines = catalog.filter((c) => c.item);
  return (
    <>
      <option value="">Nothing (prints empty)</option>
      <optgroup label="The document">
        {whole.map((c) => (
          <option key={c.path} value={c.path}>
            {c.label}
          </option>
        ))}
      </optgroup>
      {lines.length > 0 && (
        <optgroup label="Each line of the document">
          {lines.map((c) => (
            <option key={c.path} value={c.path}>
              {c.label} (each line)
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

/**
 * The tags found in a Word or HTML template, each with the data it prints and
 * its letter case. Tags the system knows are matched on upload; others print
 * nothing until they are given data here.
 */
export function TagMapping({
  templateId,
  placeholders,
  catalog,
}: {
  templateId: string;
  placeholders: TemplateScreen["template"]["placeholders"];
  catalog: Catalog;
}) {
  const start = () =>
    placeholders.map((p) => ({
      tag: p.tag,
      sourcePath: p.sourcePath ?? "",
      format: (p.format ?? "") as string,
    }));
  const [rows, setRows] = useState(start);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const initial = start();
  const dirty = rows.some(
    (r, i) => r.sourcePath !== initial[i]?.sourcePath || r.format !== initial[i]?.format,
  );

  function change(index: number, patch: Partial<(typeof rows)[number]>) {
    setSaved(false);
    setRows((now) => now.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function save() {
    startTransition(async () => {
      const result = await setTemplatePlaceholdersAction(templateId, {
        placeholders: rows.map((r) => ({
          tag: r.tag,
          sourcePath: r.sourcePath || null,
          format: (r.format || null) as Format,
        })),
      });
      if (!result.ok) setError(result.error);
      else setSaved(true);
    });
  }

  if (rows.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        No tags were found in this template. Type tags like {"{BuyerName}"} where the data goes (see
        the list of tags below), then replace the file.
      </p>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-4">
      <ul className="grid grid-cols-1 divide-y rounded-md border" aria-label="Tags">
        {rows.map((r, index) => {
          const id = `tag-${index}`;
          return (
            <li
              key={r.tag}
              className="grid min-w-0 grid-cols-1 gap-2 p-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_10rem] sm:items-center sm:gap-3"
            >
              <code
                className={cn(
                  "min-w-0 truncate text-sm font-medium",
                  !r.sourcePath && "text-destructive",
                )}
              >
                {r.tag}
              </code>
              <div className="min-w-0">
                <label htmlFor={`${id}-data`} className="sr-only">
                  What {r.tag} prints
                </label>
                <NativeSelect
                  id={`${id}-data`}
                  value={r.sourcePath}
                  onChange={(e) => change(index, { sourcePath: e.target.value })}
                  containerClassName="sm:w-full"
                  aria-invalid={!r.sourcePath}
                >
                  <DataOptions catalog={catalog} />
                </NativeSelect>
              </div>
              <div className="min-w-0">
                <label htmlFor={`${id}-case`} className="sr-only">
                  Letter case of {r.tag}
                </label>
                <NativeSelect
                  id={`${id}-case`}
                  value={r.format}
                  onChange={(e) => change(index, { format: e.target.value })}
                  containerClassName="sm:w-full"
                >
                  {CASE_LABELS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </li>
          );
        })}
      </ul>
      {saved && !dirty && <FormAlert tone="success">Saved. Try it to see the result.</FormAlert>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={!dirty || pending}
          onClick={save}
        >
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Saving" : "Save what the tags print"}
        </Button>
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            disabled={pending}
            onClick={() => setRows(start())}
          >
            Undo the changes
          </Button>
        )}
      </div>
      <ActionErrorDialog
        error={error}
        title="We could not save the tags"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
