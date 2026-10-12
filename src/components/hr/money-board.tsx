"use client";

import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { Amount } from "@/components/accounts/privacy";
import { FormAlert } from "@/components/forms/field";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCount, formatDay } from "@/lib/display";
import type { MoneyBreakdown, MoneyKind, MoneySummary } from "@/modules/hr/money.service";
import { getMoneyBreakdownAction } from "@/server/actions/hr.actions";

import { FlagBadge } from "./badges";
import { EmployeeAvatar } from "./employee-avatar";
import { hrHref, minutesText } from "./labels";
import { hoursText, MONEY_KIND_LABELS, periodText } from "./money-labels";

type Person = MoneySummary["kinds"][MoneyKind]["people"][number];

const ORDER: readonly MoneyKind[] = ["salary", "conveyance", "bonus", "overtime"];

/** "3 months", "12 trips" or "14.5 hours" for one person's line in a total. */
function countText(kind: MoneyKind, p: Person, currency: string) {
  if (kind === "conveyance")
    return `${formatCount(p.count, currency)} ${p.count === 1 ? "trip" : "trips"}`;
  if (kind === "overtime" && p.hours) return hoursText(p.hours);
  return `${formatCount(p.count, currency)} ${p.count === 1 ? "month" : "months"}`;
}

/** The line under a total: who got it and how many trips or hours. */
function hintOf(kind: MoneyKind, k: MoneySummary["kinds"][MoneyKind], currency: string) {
  const people = `${formatCount(k.people.length, currency)} ${k.people.length === 1 ? "person" : "people"}`;
  if (k.people.length === 0) return "Nobody in these days";
  if (kind === "conveyance") {
    return `${formatCount(k.count, currency)} ${k.count === 1 ? "trip" : "trips"} · ${people}`;
  }
  if (kind === "overtime" && k.hours) return `${hoursText(k.hours)} · ${people}`;
  return people;
}

/**
 * The four totals of HR > Money. A total opens who got it, largest first; a
 * person opens their months or trips in the period, each with what it was for
 * and whether it is paid. Amounts hide behind the page's eye.
 */
export function MoneyBoard({ summary, currency }: { summary: MoneySummary; currency: string }) {
  const [kind, setKind] = useState<MoneyKind | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [detail, setDetail] = useState<MoneyBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(0);
  const { period } = summary;
  const when = periodText(period);

  function close() {
    asked.current += 1;
    setKind(null);
    setPerson(null);
    setDetail(null);
    setError(null);
  }

  async function open(k: MoneyKind, p: Person) {
    const ask = ++asked.current;
    setPerson(p);
    setDetail(null);
    setError(null);
    const result = await getMoneyBreakdownAction({
      kind: k,
      employeeId: p.employee.id,
      range: period.range,
      from: period.from ?? undefined,
      to: period.to,
    });
    // A newer choice (or closing) wins over an answer that comes back late.
    if (ask !== asked.current) return;
    if (result.ok) setDetail(result.data);
    else setError(result.error.message);
  }

  const k = kind ? summary.kinds[kind] : null;
  return (
    <>
      <ul aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ORDER.map((key) => {
          const total = summary.kinds[key];
          return (
            <li key={key} className="min-w-0">
              <button
                type="button"
                onClick={() => setKind(key)}
                className="block h-full w-full min-w-0 rounded-lg border bg-card p-4 text-left transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
              >
                <span className="eyebrow block">{MONEY_KIND_LABELS[key]}</span>
                <span className="mt-1 block font-serif text-xl leading-tight break-words text-primary lining-nums tabular-nums">
                  <Amount>{money(total.total, currency)}</Amount>
                </span>
                <span className="mt-1 flex items-center justify-between gap-2 text-[0.8125rem] text-muted-foreground">
                  <span>{hintOf(key, total, currency)}</span>
                  <ChevronRightIcon className="size-4 shrink-0" aria-hidden />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog open={kind !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-2xl">
          {kind && k && !person && (
            <>
              <DialogHeader>
                <DialogTitle>{MONEY_KIND_LABELS[kind]}</DialogTitle>
                <DialogDescription>
                  {when} · <Amount>{money(k.total, currency)}</Amount>
                </DialogDescription>
              </DialogHeader>
              {k.people.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody got any in these days.</p>
              ) : (
                <ul aria-label="People" className="-mx-2 grid">
                  {k.people.map((p) => (
                    <li key={p.employee.id}>
                      <button
                        type="button"
                        onClick={() => open(kind, p)}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                      >
                        <EmployeeAvatar
                          employeeId={p.employee.id}
                          photoId={p.employee.photoId}
                          name={p.employee.name}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium break-words text-primary">
                            {p.employee.name}
                          </span>
                          <span className="block text-[0.8125rem] break-words text-muted-foreground">
                            {[p.employee.code, p.employee.designation].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm tabular-nums">
                            <Amount>{money(p.amount, currency)}</Amount>
                          </span>
                          <span className="block text-[0.8125rem] text-muted-foreground">
                            {countText(kind, p, currency)}
                          </span>
                        </span>
                        <ChevronRightIcon
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {kind && person && (
            <>
              <DialogHeader className="gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2 w-fit"
                  onClick={() => {
                    asked.current += 1;
                    setPerson(null);
                    setDetail(null);
                    setError(null);
                  }}
                >
                  <ArrowLeftIcon aria-hidden />
                  Everyone
                </Button>
                <div className="flex items-center gap-3 pr-6">
                  <EmployeeAvatar
                    employeeId={person.employee.id}
                    photoId={person.employee.photoId}
                    name={person.employee.name}
                    size="md"
                  />
                  <div className="min-w-0">
                    <DialogTitle className="break-words">{person.employee.name}</DialogTitle>
                    <DialogDescription>
                      {MONEY_KIND_LABELS[kind]} · {when} ·{" "}
                      <Amount>{money(person.amount, currency)}</Amount>
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              {error ? (
                <FormAlert>{error}</FormAlert>
              ) : !detail ? (
                <p aria-busy="true" className="text-sm text-muted-foreground">
                  Getting the details…
                </p>
              ) : (
                <BreakdownList detail={detail} currency={currency} />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One person's months or trips, newest first. */
function BreakdownList({ detail, currency }: { detail: MoneyBreakdown; currency: string }) {
  const trips = detail.kind === "conveyance";
  if (detail.lines.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing in these days.</p>;
  }
  return (
    <ol
      aria-label={`${detail.employee.name}'s ${trips ? "trips" : "months"}`}
      className="grid divide-y"
    >
      {detail.lines.map((l) => (
        <li key={l.id} className="grid gap-1.5 py-3 first:pt-0 last:pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {trips ? formatDay(l.date) : l.title}
                {trips && <span className="font-normal text-muted-foreground"> · {l.title}</span>}
              </p>
              {l.purpose && (
                <p className="text-[0.8125rem] break-words text-muted-foreground">{l.purpose}</p>
              )}
            </div>
            <span className="shrink-0 text-sm tabular-nums">
              <Amount>{money(l.amount, currency)}</Amount>
            </span>
          </div>
          {l.details.length > 0 && (
            <p className="text-[0.8125rem] text-muted-foreground">
              {l.details.map((d, i) => (
                <span key={d.label}>
                  {i > 0 && " · "}
                  {d.label} {d.minus && "− "}
                  <Amount>{money(d.amount, currency)}</Amount>
                  {d.note && `: ${d.note}`}
                </span>
              ))}
            </p>
          )}
          {l.days.length > 0 && (
            <ul
              aria-label={`Overtime days in ${l.title}`}
              className="grid gap-0.5 border-l-2 pl-3 text-[0.8125rem]"
            >
              {l.days.map((d) => (
                <li key={d.date}>
                  {formatDay(d.date)} · {minutesText(d.minutes)}
                  {d.dayOff ? " · day off" : ""}
                  {d.reason && <span className="text-muted-foreground"> · {d.reason}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {l.state && <FlagBadge tone={l.state.tone}>{l.state.label}</FlagBadge>}
            {l.payslip && (
              <Link
                href={hrHref.payslip(l.payslip.runId, l.payslip.itemId)}
                className="text-[0.8125rem] text-primary underline-offset-4 hover:underline"
              >
                Open the payslip
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
