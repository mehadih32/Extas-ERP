"use client";

import { CameraIcon, FileSearchIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import { askFirstOf } from "@/components/ai/ask-first";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { productionHref } from "@/components/production/labels";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import { LIGHTS } from "@/modules/production/tech-pack-labels";
import type { TechPackScreen } from "@/modules/production/tech-pack-screen.service";
import {
  addLabDipsAction,
  estimateColourAction,
  readLabDipReportAction,
  removeColourAction,
  removeLabDipAction,
  saveColourAction,
  setLabDipStatusAction,
} from "@/server/actions/tech-pack.actions";

import { SignalMark } from "./signals";

/*
 * Colours and lab dips: each colour with the buyer's code and ΔE limit, the
 * dye mill's lab dip rounds with a pass or fail on each option against that
 * limit (ΔE CMC 2:1, and a metamerism index above 1 fails), what to send the
 * buyer, and the buyer's approval. The AI can read the mill's report into the
 * form (a person checks it before saving) and give an approximate Pantone from
 * a photo; a colour from a photo is never more than "approx.".
 */

type Colour = TechPackScreen["colours"][number];
type ReadOption = {
  letter: string;
  deltaE: number;
  dl: number | null;
  dc: number | null;
  dh: number | null;
  mi: number | null;
  light: string | null;
};

const STATUS_TEXT = {
  OPEN: "Open",
  BUYER_APPROVED: "Buyer approved",
  BEST_CAN_DO: "Best can do",
} as const;

const signed = (n: number | null) => (n === null ? "" : n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2));

export function ColoursPanel({ screen }: { screen: TechPackScreen }) {
  const { project, colours, can } = screen;
  const [open, setOpen] = useState<
    | { kind: "colour"; colour: Colour | null }
    | { kind: "remove"; colour: Colour }
    | {
        kind: "dips";
        colour: Colour;
        round: number;
        options: ReadOption[];
        readByAi: boolean;
        notes: string | null;
      }
    | { kind: "read"; colour: Colour }
    | { kind: "photo"; colour: Colour }
    | { kind: "approve"; colour: Colour }
    | null
  >(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();

  const run = (work: () => Promise<{ ok: true } | { ok: false; error: ActionError }>) =>
    startTransition(async () => {
      const result = await work();
      setError(result.ok ? undefined : result.error);
    });
  const nextRound = (c: Colour) =>
    c.options.length ? Math.max(...c.options.map((o) => o.round)) + 1 : 1;

  return (
    <Panel
      title="Colours and lab dips"
      id="tech-pack-colours-heading"
      action={
        can.edit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen({ kind: "colour", colour: null })}
          >
            <PlusIcon aria-hidden />
            Add a colour
          </Button>
        ) : null
      }
    >
      {error && (
        <div className="mt-3">
          <FormAlert>{error.message}</FormAlert>
        </div>
      )}
      {colours.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No colour yet. Add each colour with the buyer&apos;s code and ΔE limit; the dye
          mill&apos;s lab dip report is then checked option by option. No bulk dyeing before the
          buyer approves a lab dip.
        </p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {colours.map((c) => {
            const rounds = [...new Set(c.options.map((o) => o.round))].sort((a, b) => a - b);
            return (
              <li key={c.id} className="rounded-md border p-3">
                <div className="flex items-start gap-3">
                  <SignalMark signal={c.signal} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">
                      {c.name}
                      {c.code && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · {c.code}
                          {c.codeSource === "IMAGE_ESTIMATE" ? " (approx.)" : ""}
                        </span>
                      )}
                    </p>
                    <p className="text-[0.8125rem] text-muted-foreground">
                      {c.visualOnly
                        ? "Approved by eye"
                        : `ΔE CMC limit ${c.deltaLimit.toFixed(2)} · ${c.primaryLight}${c.secondaryLight ? ` and ${c.secondaryLight}` : ""}`}{" "}
                      · {STATUS_TEXT[c.status]}
                      {c.approvedOption ? ` (${c.approvedOption})` : ""}
                    </p>
                  </div>
                  {can.edit && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Change the colour"
                        onClick={() => setOpen({ kind: "colour", colour: c })}
                      >
                        <PencilIcon aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Remove the colour"
                        onClick={() => setOpen({ kind: "remove", colour: c })}
                      >
                        <Trash2Icon aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>

                {c.estimate && (
                  <div className="mt-3 rounded-md bg-secondary/40 p-2.5 text-sm">
                    <p className="font-medium">
                      From a photo (approx.):{" "}
                      {c.estimate.codes
                        .map((x) => `${x.code}${x.name ? ` ${x.name}` : ""}`)
                        .join(", ") || "no match"}
                    </p>
                    <p className="text-muted-foreground">
                      Confidence {c.estimate.confidence}. {c.estimate.why}
                    </p>
                    {c.estimate.next && <p className="text-[0.8125rem]">{c.estimate.next}</p>}
                  </div>
                )}

                {rounds.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[34rem] text-sm">
                      <thead className="text-left text-[0.75rem] text-muted-foreground">
                        <tr>
                          <th className="py-1 pr-2 font-normal">Round</th>
                          <th className="py-1 pr-2 font-normal">Option</th>
                          <th className="py-1 pr-2 font-normal">Light</th>
                          <th className="py-1 pr-2 text-right font-normal">ΔE</th>
                          <th className="py-1 pr-2 text-right font-normal">dL</th>
                          <th className="py-1 pr-2 text-right font-normal">dC</th>
                          <th className="py-1 pr-2 text-right font-normal">dH</th>
                          <th className="py-1 pr-2 text-right font-normal">MI</th>
                          <th className="py-1 pr-2 font-normal">Check</th>
                          <th className="py-1" />
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {c.options.map((o) => (
                          <tr key={o.id} className="align-top">
                            <td className="py-1.5 pr-2">{o.round}</td>
                            <td className="py-1.5 pr-2 font-medium">
                              {o.letter}
                              {o.readByAi && (
                                <span className="ml-1 text-xs text-muted-foreground">AI</span>
                              )}
                            </td>
                            <td className="py-1.5 pr-2">{o.light ?? c.primaryLight}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">
                              {o.deltaE.toFixed(2)}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">{signed(o.dl)}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">{signed(o.dc)}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">{signed(o.dh)}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">
                              {o.mi === null ? "" : o.mi.toFixed(2)}
                            </td>
                            <td className="py-1.5 pr-2">
                              <span
                                className={cn(
                                  "font-medium",
                                  o.check.verdict === "PASS" ? "text-success" : "text-destructive",
                                )}
                              >
                                {o.check.verdict}
                              </span>
                              <span className="block text-[0.75rem] text-muted-foreground">
                                {o.check.why}
                              </span>
                              {o.check.warning && (
                                <span className="block text-[0.75rem] text-amber-700 dark:text-amber-400">
                                  {o.check.warning}
                                </span>
                              )}
                            </td>
                            <td className="py-1">
                              {can.edit && c.status === "OPEN" && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Remove option ${o.letter} of round ${o.round}`}
                                  disabled={pending}
                                  onClick={() => run(() => removeLabDipAction(project.id, o.id))}
                                >
                                  <Trash2Icon aria-hidden />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {c.status === "OPEN" && <p className="mt-3 text-sm">{c.advice.next}</p>}
                {c.report && (
                  <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                    The mill&apos;s report:{" "}
                    <a
                      href={productionHref.file(c.report.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {c.report.fileName}
                    </a>
                  </p>
                )}

                {can.edit && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {c.status === "OPEN" && !c.visualOnly && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setOpen({
                            kind: "dips",
                            colour: c,
                            round: nextRound(c),
                            options: [],
                            readByAi: false,
                            notes: null,
                          })
                        }
                      >
                        <PlusIcon aria-hidden />
                        Add lab dips
                      </Button>
                    )}
                    {can.ai && c.status === "OPEN" && !c.visualOnly && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setOpen({ kind: "read", colour: c })}
                      >
                        <FileSearchIcon aria-hidden />
                        {"Read the mill's report"}
                      </Button>
                    )}
                    {can.ai && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpen({ kind: "photo", colour: c })}
                      >
                        <CameraIcon aria-hidden />
                        Colour from a photo
                      </Button>
                    )}
                    {c.status === "OPEN" && (c.options.length > 0 || c.visualOnly) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setOpen({ kind: "approve", colour: c })}
                      >
                        {"Buyer's answer"}
                      </Button>
                    )}
                    {c.status !== "OPEN" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() =>
                          run(() => setLabDipStatusAction(project.id, c.id, { status: "OPEN" }))
                        }
                      >
                        Open again
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open?.kind === "colour" && (
        <ColourDialog projectId={project.id} colour={open.colour} onClose={() => setOpen(null)} />
      )}

      {open?.kind === "remove" && (
        <ConfirmDialog
          title={`Remove ${open.colour.name}?`}
          description="The colour and its lab dip rounds are taken off this tech pack."
          confirmLabel="Remove"
          pendingLabel="Removing"
          destructive
          onClose={() => setOpen(null)}
          onConfirm={async () => {
            const result = await removeColourAction(project.id, open.colour.id);
            if (!result.ok) return result.error;
            setOpen(null);
          }}
        />
      )}

      {open?.kind === "dips" && (
        <LabDipsDialog
          projectId={project.id}
          colour={open.colour}
          round={open.round}
          options={open.options}
          readByAi={open.readByAi}
          notes={open.notes}
          onClose={() => setOpen(null)}
        />
      )}

      {open?.kind === "read" && (
        <AiUploadDialog
          title={`Read the mill's report for ${open.colour.name}`}
          description="Upload the dye mill's lab dip report (PDF or photo). The AI reads the options into the form; check them before you save."
          accept="application/pdf,image/jpeg,image/png,image/webp"
          submitLabel="Read"
          onClose={() => setOpen(null)}
          send={(form) => readLabDipReportAction(project.id, open.colour.id, form)}
          onDone={(data) => {
            const read = data as {
              round: number | null;
              notes: string | null;
              options: ReadOption[];
            };
            setOpen({
              kind: "dips",
              colour: open.colour,
              round: read.round ?? nextRound(open.colour),
              options: read.options,
              readByAi: true,
              notes: read.notes,
            });
          }}
        />
      )}

      {open?.kind === "photo" && (
        <AiUploadDialog
          title={`Colour of ${open.colour.name} from a photo`}
          description="An approximate Pantone suggestion only: a photo's colour depends on the light and the screen. The buyer's code and the mill's lab dip decide."
          accept="image/jpeg,image/png,image/webp"
          submitLabel="Suggest"
          onClose={() => setOpen(null)}
          send={(form) => estimateColourAction(project.id, open.colour.id, form)}
          onDone={() => setOpen(null)}
        />
      )}

      {open?.kind === "approve" && (
        <ApproveDialog projectId={project.id} colour={open.colour} onClose={() => setOpen(null)} />
      )}
    </Panel>
  );
}

function ColourDialog({
  projectId,
  colour,
  onClose,
}: {
  projectId: string;
  colour: Colour | null;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title={colour ? `Change ${colour.name}` : "Add a colour"}
      description="The buyer's colour code and the ΔE CMC limit the lab dips are checked against (1.0 when the buyer gives none)."
      submitLabel="Save"
      pendingLabel="Saving"
      errorTitle="We could not save the colour"
      onClose={onClose}
      onSubmit={async (form) => {
        const result = await saveColourAction(
          projectId,
          colour?.id ?? null,
          Object.fromEntries(form),
        );
        if (!result.ok) return result.error;
        onClose();
      }}
    >
      {(fieldError) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="colour-name" label="Colour" error={fieldError("name")}>
            <Input
              id="colour-name"
              name="name"
              defaultValue={colour?.name ?? ""}
              placeholder="Navy"
              required
            />
          </Field>
          <Field
            id="colour-code"
            label="Buyer's code"
            hint="Pantone TCX or the buyer's own."
            error={fieldError("code")}
          >
            <Input
              id="colour-code"
              name="code"
              defaultValue={colour?.code ?? ""}
              placeholder="19-4052 TCX"
            />
          </Field>
          <Field id="colour-limit" label="ΔE limit" error={fieldError("deltaLimit")}>
            <Input
              id="colour-limit"
              name="deltaLimit"
              inputMode="decimal"
              defaultValue={colour?.deltaLimit ?? "1.0"}
            />
          </Field>
          <Field id="colour-light" label="Main light" error={fieldError("primaryLight")}>
            <NativeSelect
              id="colour-light"
              name="primaryLight"
              defaultValue={colour?.primaryLight ?? "D65"}
              containerClassName="sm:w-full"
            >
              {LIGHTS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="colour-light2" label="Second light" error={fieldError("secondaryLight")}>
            <NativeSelect
              id="colour-light2"
              name="secondaryLight"
              defaultValue={colour?.secondaryLight ?? ""}
              containerClassName="sm:w-full"
            >
              <option value="">None</option>
              {LIGHTS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      )}
    </FormDialog>
  );
}

const EMPTY: ReadOption = {
  letter: "",
  deltaE: Number.NaN,
  dl: null,
  dc: null,
  dh: null,
  mi: null,
  light: null,
};

function LabDipsDialog({
  projectId,
  colour,
  round,
  options,
  readByAi,
  notes,
  onClose,
}: {
  projectId: string;
  colour: Colour;
  round: number;
  options: ReadOption[];
  readByAi: boolean;
  notes: string | null;
  onClose: () => void;
}) {
  const start =
    options.length > 0 ? options : ["A", "B", "C"].map((letter) => ({ ...EMPTY, letter }));
  const [rows, setRows] = useState(start);
  const text = (n: number | null) => (n === null || Number.isNaN(n) ? "" : String(n));
  const cells = ["deltaE", "dl", "dc", "dh", "mi"] as const;
  const CELL_LABEL = { deltaE: "ΔE", dl: "dL", dc: "dC", dh: "dH", mi: "MI" } as const;

  return (
    <FormDialog
      title={`Lab dips for ${colour.name}`}
      description={
        readByAi
          ? "Read from the mill's report by the AI. Check every number against the report before you save."
          : "Type each option as the dye mill's report gives it. Only ΔE is needed; MI fails an option above 1."
      }
      submitLabel="Save"
      pendingLabel="Saving"
      errorTitle="We could not save the lab dips"
      className="sm:max-w-3xl"
      onClose={onClose}
      onSubmit={async (form) => {
        const value = (key: string) => String(form.get(key) ?? "");
        const result = await addLabDipsAction(projectId, colour.id, {
          round: value("round"),
          readByAi,
          options: rows.map((_, i) => ({
            letter: value(`options.${i}.letter`),
            deltaE: value(`options.${i}.deltaE`),
            dl: value(`options.${i}.dl`),
            dc: value(`options.${i}.dc`),
            dh: value(`options.${i}.dh`),
            mi: value(`options.${i}.mi`),
            light: value(`options.${i}.light`),
          })),
        });
        if (!result.ok) return result.error;
        onClose();
      }}
    >
      {(fieldError) => (
        <div className="grid gap-4">
          {notes && (
            <FormAlert tone="note">
              <p>{notes}</p>
            </FormAlert>
          )}
          <Field id="dips-round" label="Round" error={fieldError("round")} className="w-28">
            <Input id="dips-round" name="round" inputMode="numeric" defaultValue={round} />
          </Field>
          {fieldError("options") && <FormAlert>{fieldError("options")}</FormAlert>}
          <div className="grid gap-3">
            {rows.map((row, i) => (
              <fieldset
                key={i}
                className="grid grid-cols-3 gap-2 rounded-md border p-2 sm:grid-cols-8"
              >
                <legend className="sr-only">Option {i + 1}</legend>
                <Field
                  id={`dip-${i}-letter`}
                  label="Option"
                  error={fieldError(`options.${i}.letter`)}
                >
                  <Input
                    id={`dip-${i}-letter`}
                    name={`options.${i}.letter`}
                    defaultValue={row.letter}
                    maxLength={2}
                  />
                </Field>
                {cells.map((cell) => (
                  <Field
                    key={cell}
                    id={`dip-${i}-${cell}`}
                    label={CELL_LABEL[cell]}
                    error={fieldError(`options.${i}.${cell}`)}
                  >
                    <Input
                      id={`dip-${i}-${cell}`}
                      name={`options.${i}.${cell}`}
                      inputMode="decimal"
                      defaultValue={text(row[cell])}
                    />
                  </Field>
                ))}
                <Field id={`dip-${i}-light`} label="Light" error={fieldError(`options.${i}.light`)}>
                  <NativeSelect
                    id={`dip-${i}-light`}
                    name={`options.${i}.light`}
                    defaultValue={row.light ?? ""}
                    containerClassName="sm:w-full"
                  >
                    <option value="">{colour.primaryLight}</option>
                    {LIGHTS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="flex items-end">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove option ${i + 1}`}
                    disabled={rows.length === 1}
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                </div>
              </fieldset>
            ))}
          </div>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={rows.length >= 12}
              onClick={() =>
                setRows([
                  ...rows,
                  { ...EMPTY, letter: String.fromCharCode(65 + Math.min(rows.length, 25)) },
                ])
              }
            >
              <PlusIcon aria-hidden />
              Add an option
            </Button>
          </div>
        </div>
      )}
    </FormDialog>
  );
}

/** Uploads a file to an AI action; asks first when the owner wants that, then "Go on". */
function AiUploadDialog({
  title,
  description,
  accept,
  submitLabel,
  send,
  onDone,
  onClose,
}: {
  title: string;
  description: string;
  accept: string;
  submitLabel: string;
  send: (
    form: FormData,
  ) => Promise<{ ok: true; data: unknown } | { ok: false; error: ActionError }>;
  onDone: (data: unknown) => void;
  onClose: () => void;
}) {
  const [costOk, setCostOk] = useState(false);
  return (
    <FormDialog
      title={title}
      description={description}
      submitLabel={costOk ? "Go on" : submitLabel}
      pendingLabel="Reading"
      errorTitle="The AI could not do that"
      onClose={onClose}
      onSubmit={async (form) => {
        if (costOk) form.set("costOk", "true");
        const result = await send(form);
        if (!result.ok) {
          if (askFirstOf(result.error) && !costOk) {
            setCostOk(true);
            return {
              code: "CONFLICT",
              message: `${result.error.message} Press "Go on" to send it.`,
            };
          }
          return result.error;
        }
        onDone(result.data);
      }}
    >
      {(fieldError) => (
        <Field
          id="ai-file"
          label="Choose the file"
          hint="Up to 5 MB for a photo, 10 MB for a PDF."
          error={fieldError("file")}
        >
          <Input id="ai-file" name="file" type="file" accept={accept} required />
        </Field>
      )}
    </FormDialog>
  );
}

function ApproveDialog({
  projectId,
  colour,
  onClose,
}: {
  projectId: string;
  colour: Colour;
  onClose: () => void;
}) {
  const passing = colour.options.filter((o) => o.check.verdict === "PASS");
  const [answer, setAnswer] = useState<"BUYER_APPROVED" | "BEST_CAN_DO">(
    passing.length > 0 || colour.visualOnly ? "BUYER_APPROVED" : "BEST_CAN_DO",
  );
  return (
    <FormDialog
      title={`The buyer's answer on ${colour.name}`}
      description="Record what the buyer approved. Bulk dyeing follows the approved option only."
      submitLabel="Save"
      pendingLabel="Saving"
      errorTitle="We could not save the buyer's answer"
      onClose={onClose}
      onSubmit={async (form) => {
        const optionId = form.get("optionId");
        const input =
          answer === "BUYER_APPROVED"
            ? { status: answer, ...(optionId ? { optionId: String(optionId) } : {}) }
            : { status: answer };
        const result = await setLabDipStatusAction(projectId, colour.id, input);
        if (!result.ok) return result.error;
        onClose();
      }}
    >
      {(fieldError) => (
        <div className="grid gap-4">
          <Field id="dip-answer" label="Answer" error={fieldError("status")}>
            <NativeSelect
              id="dip-answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value as typeof answer)}
              containerClassName="sm:w-full"
            >
              <option value="BUYER_APPROVED">
                {colour.visualOnly && colour.options.length === 0
                  ? "Buyer approved it by eye"
                  : "Buyer approved an option"}
              </option>
              <option value="BEST_CAN_DO">Best can do (the buyer accepts the closest)</option>
            </NativeSelect>
          </Field>
          {answer === "BUYER_APPROVED" && colour.options.length > 0 && (
            <Field id="dip-option" label="Approved option" error={fieldError("optionId")}>
              <NativeSelect
                id="dip-option"
                name="optionId"
                defaultValue={passing[0]?.id ?? colour.options[0]?.id}
                containerClassName="sm:w-full"
              >
                {colour.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.letter}, round {o.round} (ΔE {o.deltaE.toFixed(2)}, {o.check.verdict})
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </div>
      )}
    </FormDialog>
  );
}
