"use client";

import { LoaderCircleIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { TemplateScreen } from "@/modules/reports/screens.service";
import { setTemplatePlaceholdersAction } from "@/server/actions/templates.actions";

import { reportsHref } from "./labels";
import { CASE_LABELS, DataOptions } from "./tag-mapping";

type Template = TemplateScreen["template"];
type Catalog = TemplateScreen["catalog"];
type Align = "left" | "center" | "right";

/** A placed tag as it is edited; positions in points from the page's top-left corner. */
type Draft = {
  key: string;
  tag: string;
  sourcePath: string;
  format: string;
  page: number;
  x: number;
  y: number;
  fontSize: number;
  bold: boolean;
  align: Align;
  width: number | null;
};

/** 72 points to the inch, 25.4 mm to the inch. */
const toMm = (pt: number) => Math.round(((pt * 25.4) / 72) * 10) / 10;
const toPt = (mm: number) => Math.round(((mm * 72) / 25.4) * 100) / 100;

const ALIGN_LABELS: Array<[Align, string]> = [
  ["left", "Left"],
  ["center", "Centre"],
  ["right", "Right"],
];

const bare = (tag: string) => tag.replace(/[{}\s]/g, "");

/** A tag name not yet placed: {BuyerName}, then {BuyerName2}, {BuyerName3}... */
function freeName(base: string, drafts: Draft[]): string {
  const taken = new Set(drafts.map((d) => bare(d.tag).toLowerCase()));
  const name = bare(base) || "Tag";
  if (!taken.has(name.toLowerCase())) return `{${name}}`;
  for (let n = 2; ; n++) {
    if (!taken.has(`${name}${n}`.toLowerCase())) return `{${name}${n}}`;
  }
}

function MmInput({
  id,
  label,
  value,
  onChange,
  optional = false,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (mm: number | null) => void;
  optional?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className="text-[0.8125rem]">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.5"
        min={0}
        value={value === null ? "" : toMm(value)}
        placeholder={optional ? "Fits the text" : undefined}
        onChange={(e) => {
          const text = e.target.value.trim();
          if (text === "") return onChange(optional ? null : 0);
          const mm = Number(text);
          if (Number.isFinite(mm) && mm >= 0) onChange(toPt(mm));
        }}
      />
    </div>
  );
}

/**
 * Where each tag prints on a PDF or picture template: click the page to add a
 * tag there (or to move the chosen one), and set its size, width, line-up and
 * letter case. Positions are in millimetres from the page's top-left corner.
 * A picture shows behind the page; a PDF's design opens beside it, and "Try
 * it" shows the result.
 */
export function TagPlacement({ template, catalog }: { template: Template; catalog: Catalog }) {
  const pages = template.pages ?? [];
  const start = (): Draft[] =>
    template.placeholders.map((p, i) => ({
      key: `placed-${i}`,
      tag: p.tag,
      sourcePath: p.sourcePath ?? "",
      format: p.format ?? "",
      page: p.page ?? 1,
      x: p.x ?? 0,
      y: p.y ?? 0,
      fontSize: p.fontSize ?? 10,
      bold: p.bold ?? false,
      align: (p.align ?? "left") as Align,
      width: p.width ?? null,
    }));
  const [drafts, setDrafts] = useState(start);
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ x: number; y: number } | null>(null);
  const [counter, setCounter] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  // When the server's placed tags change (saved here, or a new file) and nothing
  // is being edited, show them as they are now.
  const version = JSON.stringify(template.placeholders);
  const [shownVersion, setShownVersion] = useState(version);
  if (version !== shownVersion) {
    setShownVersion(version);
    if (!dirty) {
      setDrafts(start());
      setChosen(null);
    }
  }
  const size = pages[page - 1] ?? { width: 595.28, height: 841.89 };
  const selected = drafts.find((d) => d.key === chosen) ?? null;
  const onPage = drafts.filter((d) => d.page === page);

  function edit(key: string, patch: Partial<Draft>) {
    setDirty(true);
    setSaved(false);
    setDrafts((now) => now.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function add(path: string, at: { x: number; y: number }) {
    const entry = catalog.find((c) => c.path === path);
    const key = `new-${counter}`;
    setCounter((n) => n + 1);
    setDirty(true);
    setSaved(false);
    setDrafts((now) => [
      ...now,
      {
        key,
        tag: freeName(entry?.tag ?? "MyTag", now),
        sourcePath: entry?.path ?? "",
        format: "",
        page,
        x: at.x,
        y: at.y,
        fontSize: 10,
        bold: false,
        align: "left",
        width: null,
      },
    ]);
    setChosen(key);
    setAdding(null);
  }

  function remove(key: string) {
    setDirty(true);
    setSaved(false);
    setDrafts((now) => now.filter((d) => d.key !== key));
    setChosen(null);
  }

  function clickPage(event: React.MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.round(((event.clientX - box.left) / box.width) * size.width * 100) / 100;
    const y = Math.round(((event.clientY - box.top) / box.height) * size.height * 100) / 100;
    if (selected) edit(selected.key, { x, y, page });
    else setAdding({ x, y });
  }

  function save() {
    startTransition(async () => {
      const result = await setTemplatePlaceholdersAction(template.id, {
        placeholders: drafts.map((d) => ({
          tag: d.tag,
          sourcePath: d.sourcePath || null,
          format: d.format || null,
          page: d.page,
          x: d.x,
          y: d.y,
          fontSize: d.fontSize,
          bold: d.bold,
          align: d.align,
          width: d.width,
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDirty(false);
      setSaved(true);
    });
  }

  const label = (d: Draft) =>
    catalog.find((c) => c.path === d.sourcePath)?.label ?? "Prints nothing";
  const where = (d: Draft) =>
    `${pages.length > 1 ? `page ${d.page}, ` : ""}${toMm(d.x)} mm from the left, ${toMm(d.y)} mm from the top`;

  return (
    <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
      <div className="grid min-w-0 grid-cols-1 gap-3">
        {pages.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Page">
            {pages.map((_, i) => (
              <Button
                key={i}
                type="button"
                size="sm"
                variant={page === i + 1 ? "default" : "outline"}
                aria-pressed={page === i + 1}
                onClick={() => {
                  setPage(i + 1);
                  setChosen(null);
                  setAdding(null);
                }}
              >
                Page {i + 1}
              </Button>
            ))}
          </div>
        )}
        <p className="text-[0.8125rem] text-muted-foreground">
          {selected
            ? `Click the page to move ${selected.tag}.`
            : "Click the page where a tag should print."}{" "}
          Page size {toMm(size.width)} × {toMm(size.height)} mm.
          {template.format === "PDF" && (
            <>
              {" "}
              Your PDF is not drawn here:{" "}
              <a
                href={`${reportsHref.templateFile(template.id)}?inline=1`}
                target="_blank"
                rel="noopener"
                className="text-primary underline-offset-4 hover:underline"
              >
                open it
              </a>{" "}
              beside this page, and try the template to check the result.
            </>
          )}
        </p>
        <div
          role="presentation"
          onClick={clickPage}
          className="relative w-full max-w-2xl cursor-crosshair overflow-hidden rounded-md border bg-white shadow-sm"
          style={{
            aspectRatio: `${size.width} / ${size.height}`,
            containerType: "inline-size",
            ...(template.format === "PDF"
              ? {
                  // A line every 10 mm.
                  backgroundImage:
                    "linear-gradient(to right, rgb(11 61 46 / 0.07) 1px, transparent 1px), linear-gradient(to bottom, rgb(11 61 46 / 0.07) 1px, transparent 1px)",
                  backgroundSize: `${(toPt(10) / size.width) * 100}% ${(toPt(10) / size.height) * 100}%`,
                }
              : {}),
          }}
        >
          {template.format === "IMAGE" && (
            // eslint-disable-next-line @next/next/no-img-element -- the template's own file, served by the app
            <img
              src={`${reportsHref.templateFile(template.id)}?inline=1`}
              alt=""
              className="pointer-events-none absolute inset-0 size-full select-none"
              draggable={false}
            />
          )}
          {onPage.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAdding(null);
                setChosen(d.key === chosen ? null : d.key);
              }}
              className={cn(
                "absolute truncate rounded-[2px] border px-0.5 leading-tight whitespace-nowrap text-[#0b3d2e] outline-none",
                d.key === chosen
                  ? "border-primary bg-primary/15 ring-2 ring-primary/40"
                  : "border-dashed border-primary/50 bg-white/70 hover:bg-primary/10",
                !d.sourcePath && "border-destructive/60 text-destructive",
                d.bold && "font-bold",
              )}
              style={{
                left: `${(d.x / size.width) * 100}%`,
                top: `${(d.y / size.height) * 100}%`,
                fontSize: `max(${(d.fontSize / size.width) * 100}cqw, 7px)`,
                ...(d.width
                  ? { width: `${(d.width / size.width) * 100}%`, textAlign: d.align }
                  : { maxWidth: `${100 - (d.x / size.width) * 100}%` }),
              }}
              aria-label={`${d.tag}: ${label(d)}, ${where(d)}`}
              aria-pressed={d.key === chosen}
            >
              {d.tag}
            </button>
          ))}
          {adding && (
            <span
              aria-hidden
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive ring-2 ring-white"
              style={{
                left: `${(adding.x / size.width) * 100}%`,
                top: `${(adding.y / size.height) * 100}%`,
              }}
            />
          )}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4">
        {adding && (
          <div className="grid gap-3 rounded-md border bg-secondary/60 p-3">
            <p className="text-sm">
              Add a tag {toMm(adding.x)} mm from the left, {toMm(adding.y)} mm from the top.
            </p>
            <Label htmlFor="add-tag" className="sr-only">
              What it prints
            </Label>
            <NativeSelect
              id="add-tag"
              defaultValue=""
              containerClassName="sm:w-full"
              onChange={(e) => e.target.value && add(e.target.value, adding)}
            >
              <option value="" disabled>
                Pick what it prints
              </option>
              {catalog.map((c) => (
                <option key={c.path} value={c.path}>
                  {c.label}
                  {c.item ? " (each line)" : ""}
                </option>
              ))}
            </NativeSelect>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => setAdding(null)}
            >
              Cancel
            </Button>
          </div>
        )}

        {selected && (
          <fieldset className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{selected.tag}</legend>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="placed-data" className="text-[0.8125rem]">
                Prints
              </Label>
              <NativeSelect
                id="placed-data"
                value={selected.sourcePath}
                containerClassName="sm:w-full"
                onChange={(e) => edit(selected.key, { sourcePath: e.target.value })}
              >
                <DataOptions catalog={catalog} />
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MmInput
                id="placed-x"
                label="From the left (mm)"
                value={selected.x}
                onChange={(pt) => edit(selected.key, { x: Math.min(pt ?? 0, size.width) })}
              />
              <MmInput
                id="placed-y"
                label="From the top (mm)"
                value={selected.y}
                onChange={(pt) => edit(selected.key, { y: Math.min(pt ?? 0, size.height) })}
              />
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="placed-size" className="text-[0.8125rem]">
                  Text size
                </Label>
                <NativeSelect
                  id="placed-size"
                  value={String(selected.fontSize)}
                  containerClassName="sm:w-full"
                  onChange={(e) => edit(selected.key, { fontSize: Number(e.target.value) })}
                >
                  {[7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32].map((n) => (
                    <option key={n} value={n}>
                      {n} pt
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="placed-case" className="text-[0.8125rem]">
                  Letters
                </Label>
                <NativeSelect
                  id="placed-case"
                  value={selected.format}
                  containerClassName="sm:w-full"
                  onChange={(e) => edit(selected.key, { format: e.target.value })}
                >
                  {CASE_LABELS.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <MmInput
                id="placed-width"
                label="Width (mm)"
                optional
                value={selected.width}
                onChange={(pt) => edit(selected.key, { width: pt && pt > 0 ? pt : null })}
              />
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="placed-align" className="text-[0.8125rem]">
                  Line up
                </Label>
                <NativeSelect
                  id="placed-align"
                  value={selected.align}
                  disabled={!selected.width}
                  containerClassName="sm:w-full"
                  onChange={(e) => edit(selected.key, { align: e.target.value as Align })}
                >
                  {ALIGN_LABELS.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.bold}
                onChange={(e) => edit(selected.key, { bold: e.target.checked })}
                className="size-4 cursor-pointer accent-primary"
              />
              Bold
            </label>
            <p className="text-[0.8125rem] text-muted-foreground">
              Give it a width to line it up left, centre or right; longer text is cut to fit.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setChosen(null)}>
                Done
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => remove(selected.key)}
              >
                <Trash2Icon aria-hidden />
                Remove
              </Button>
            </div>
          </fieldset>
        )}

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-medium">Placed tags</h4>
            {!adding && !selected && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAdding({ x: toPt(20), y: toPt(20) })}
              >
                <PlusIcon aria-hidden />
                Add a tag
              </Button>
            )}
          </div>
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None yet. Click the page where the buyer&apos;s name, the date or the total should
              print.
            </p>
          ) : (
            <ul className="grid grid-cols-1 divide-y rounded-md border" aria-label="Placed tags">
              {drafts.map((d) => (
                <li key={d.key} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      setPage(d.page);
                      setAdding(null);
                      setChosen(d.key === chosen ? null : d.key);
                    }}
                    aria-pressed={d.key === chosen}
                    className={cn(
                      "grid w-full gap-0.5 px-3 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:bg-accent",
                      d.key === chosen && "bg-secondary",
                    )}
                  >
                    <span className="flex min-w-0 items-baseline justify-between gap-2">
                      <code className="truncate text-sm font-medium">{d.tag}</code>
                      <span
                        className={cn(
                          "shrink-0 text-[0.8125rem]",
                          d.sourcePath ? "text-muted-foreground" : "text-destructive",
                        )}
                      >
                        {label(d)}
                      </span>
                    </span>
                    <span className="truncate text-[0.75rem] text-muted-foreground">
                      {where(d)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {saved && !dirty && (
          <FormAlert tone="success">Saved. Try it to see where everything prints.</FormAlert>
        )}
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={!dirty || pending}
            onClick={save}
          >
            {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
            {pending ? "Saving" : "Save the placed tags"}
          </Button>
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              className="w-full sm:w-auto"
              disabled={pending}
              onClick={() => {
                setDrafts(start());
                setChosen(null);
                setAdding(null);
                setDirty(false);
              }}
            >
              Undo the changes
            </Button>
          )}
        </div>
      </div>
      <ActionErrorDialog
        error={error}
        title="We could not save the placed tags"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
