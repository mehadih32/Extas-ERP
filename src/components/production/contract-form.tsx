"use client";

import { ArrowUpIcon, LoaderCircleIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormFooter, usePageForm } from "@/components/accounts/form-bits";
import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { ContractScreen } from "@/modules/production/contract.service";
import { redraftContractAction, updateContractAction } from "@/server/actions/production.actions";

import { productionHref } from "./labels";

type Row = { key: string; title: string; text: string };

let counter = 0;
const newKey = () => `clause-${++counter}`;
const rowsOf = (clauses: Array<{ title: string; text: string }>): Row[] =>
  clauses.map((c) => ({ key: newKey(), title: c.title, text: c.text }));

/** "450" or "450.50": a CM per piece, or a message. */
function readCm(text: string): number | null | string {
  const value = text.trim().replace(/,/g, "");
  if (!value) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return "Enter an amount like 45 or 45.50.";
  const n = Number(value);
  if (n > 1_000_000) return "That is too much for a piece.";
  return n;
}

/**
 * Reviewing a batch contract (Production Managers): each clause's title and
 * words, moved, removed or added; a fresh draft from the batch; the CM per
 * piece of the factory's styles; and the day both sides signed. A signed
 * contract keeps its terms until the signed day is cleared.
 */
export function ContractForm({ data, currency }: { data: ContractScreen; currency: string }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const c = data.contract;
  const [rows, setRows] = useState<Row[]>(() => rowsOf(c.clauses));
  const [signedOn, setSignedOn] = useState(c.signedOn ?? "");
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries((data.styles ?? []).map((s) => [s.id, s.cmRate ?? ""])),
  );
  const [drafting, startDrafting] = useTransition();
  const [notice, setNotice] = useState<string>();
  const locked = c.signedOn !== null && signedOn !== "";
  const href = productionHref.contract(data.batch.id, c.id);

  function change(key: string, next: Partial<Row>) {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }
  function moveUp(index: number) {
    setRows((all) => {
      const next = [...all];
      [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
      return next;
    });
  }

  function redraft() {
    setNotice(undefined);
    startDrafting(async () => {
      const result = await redraftContractAction(c.id);
      if (!result.ok) return form.setError(result.error);
      setRows(rowsOf(result.data.clauses));
      setNotice(
        result.data.byAi
          ? "Drafted again by AI from the batch as it is now. Read it, change what is not right and save."
          : "Drafted again from the batch as it is now. Read it, change what you like and save.",
      );
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Record<string, string> = {};
    rows.forEach((r, i) => {
      if (!r.title.trim()) found[`clauses.${i}.title`] = "Give the clause a title.";
      if (!r.text.trim()) found[`clauses.${i}.text`] = "Write what the clause says.";
    });
    if (rows.length === 0) found.clauses = "Keep at least one clause.";
    if (signedOn && signedOn > data.today) found.signedOn = "Choose today or an earlier day.";
    const cmRates = (data.styles ?? []).map((s, i) => {
      const value = readCm(rates[s.id] ?? "");
      if (typeof value === "string") found[`cmRates.${i}.cmRate`] = value;
      return { projectId: s.id, cmRate: typeof value === "number" ? value : null };
    });
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;
    form.startTransition(async () => {
      const result = await updateContractAction(c.id, {
        clauses: rows.map((r) => ({ title: r.title.trim(), text: r.text.trim() })),
        signedOn: signedOn || null,
        ...(data.styles ? { cmRates } : {}),
      });
      if (!result.ok) return form.setError(result.error);
      router.push(`${href}?saved=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      {data.styles && data.styles.length > 0 && (
        <fieldset className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5">
          <legend className="sr-only">CM per piece</legend>
          <div>
            <h3 className="font-serif text-lg text-primary">CM per piece</h3>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">
              The making charge agreed with {c.party.name} for each style. It prints on this
              contract and is used for the final CM settlement.
            </p>
          </div>
          <ul className="grid divide-y rounded-md border" aria-label="CM per style">
            {data.styles.map((s, i) => {
              const err = fieldError(`cmRates.${i}.cmRate`);
              const id = `cm-${s.id}`;
              return (
                <li
                  key={s.id}
                  className="grid min-w-0 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">
                      {s.code} · {s.name}
                    </p>
                    <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                      {s.pieces.toLocaleString("en-US")} pcs · by {formatDay(s.dueOn)}
                      {s.closed ? " · closed" : ""}
                    </p>
                  </div>
                  <Field id={id} label={`CM per piece (${currency})`} error={err}>
                    <Input
                      id={id}
                      inputMode="decimal"
                      value={rates[s.id] ?? ""}
                      onChange={(e) => setRates((all) => ({ ...all, [s.id]: e.target.value }))}
                      disabled={locked || s.closed}
                      autoComplete="off"
                      placeholder="To agree"
                      aria-invalid={Boolean(err)}
                    />
                  </Field>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <fieldset className="grid min-w-0 gap-4">
        <legend className="sr-only">Terms</legend>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-serif text-lg text-primary">Terms</h3>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">
              Each clause prints numbered under its title. Leave an empty line between paragraphs.
            </p>
          </div>
          {!locked && (
            <Button type="button" variant="outline" size="sm" onClick={redraft} disabled={drafting}>
              {drafting ? (
                <LoaderCircleIcon className="animate-spin" aria-hidden />
              ) : (
                <SparklesIcon aria-hidden />
              )}
              {drafting ? "Drafting" : data.aiOn ? "Draft again with AI" : "Draft again"}
            </Button>
          )}
        </div>
        {locked && (
          <FormAlert tone="success">
            Signed on {formatDay(c.signedOn!)}. Clear the signed day below to change its terms.
          </FormAlert>
        )}
        {notice && <FormAlert tone="success">{notice}</FormAlert>}
        {fieldError("clauses") && <FormAlert>{fieldError("clauses")}</FormAlert>}
        <ol className="grid grid-cols-1 gap-4" aria-label="Clauses">
          {rows.map((row, index) => {
            const err = (name: string) => fieldError(`clauses.${index}.${name}`);
            return (
              <li key={row.key} className="grid min-w-0 gap-3 rounded-lg border bg-card p-4 sm:p-5">
                <div className="flex items-start justify-between gap-2">
                  <p className="eyebrow">Clause {index + 1}</p>
                  {!locked && (
                    <div className="flex shrink-0 gap-1">
                      {index > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => moveUp(index)}
                          aria-label={`Move clause ${index + 1} up`}
                        >
                          <ArrowUpIcon aria-hidden />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
                        aria-label={`Remove clause ${index + 1}`}
                      >
                        <Trash2Icon aria-hidden />
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
                <Field id={`${row.key}-title`} label="Title" error={err("title")}>
                  <Input
                    id={`${row.key}-title`}
                    value={row.title}
                    onChange={(e) => change(row.key, { title: e.target.value })}
                    maxLength={80}
                    disabled={locked}
                    autoComplete="off"
                    aria-invalid={Boolean(err("title"))}
                  />
                </Field>
                <Field id={`${row.key}-text`} label="What it says" error={err("text")}>
                  <Textarea
                    id={`${row.key}-text`}
                    value={row.text}
                    onChange={(e) => change(row.key, { text: e.target.value })}
                    maxLength={2000}
                    rows={4}
                    disabled={locked}
                    aria-invalid={Boolean(err("text"))}
                  />
                </Field>
              </li>
            );
          })}
        </ol>
        {!locked && rows.length < 30 && (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto sm:justify-self-start"
            onClick={() => setRows((all) => [...all, { key: newKey(), title: "", text: "" }])}
          >
            <PlusIcon aria-hidden />
            Add a clause
          </Button>
        )}
      </fieldset>

      <Field
        id="signedOn"
        label="Signed on (optional)"
        error={fieldError("signedOn")}
        hint="Fill in once both sides have signed the printed copy. A signed contract keeps its terms."
      >
        <Input
          id="signedOn"
          type="date"
          max={data.today}
          value={signedOn}
          onChange={(e) => setSignedOn(e.target.value)}
          className="sm:max-w-56"
          aria-invalid={Boolean(fieldError("signedOn"))}
        />
      </Field>

      <FormFooter
        form={form}
        cancelHref={productionHref.batch(data.batch.id)}
        submitLabel="Save the contract"
        errorTitle="We could not save the contract"
      />
    </form>
  );
}
