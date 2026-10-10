"use client";

import { ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { PartyRow } from "@/modules/parties/screens.service";
import { listPartyRowsAction } from "@/server/actions/parties.actions";

import { GradeBadge, StatusBadge, VerifiedBadge } from "./badges";
import {
  balanceText,
  balanceTone,
  BUYER_TYPE_LABELS,
  categoryText,
  kindLabel,
  partyHref,
} from "./labels";
import { type PartyListView, partyListQuery } from "./list-view";

const TONE: Record<ReturnType<typeof balanceTone>, string> = {
  owed: "text-primary",
  owing: "text-destructive",
  settled: "text-muted-foreground",
};

function SystemBadge() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      System
    </Badge>
  );
}

function PartyCard({
  party,
  currency,
  supplies,
}: {
  party: PartyRow;
  currency: string;
  /** Shown on the suppliers' list: what they supply. */
  supplies: boolean;
}) {
  const contact = [party.contactPerson, party.phone].filter(Boolean).join(" · ");
  const categories = supplies ? categoryText(party.supplierCategories) : "";
  return (
    <li>
      <Link
        href={partyHref(party)}
        className="group block rounded-lg border bg-card p-4 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="eyebrow truncate">
            {party.code} · {kindLabel(party)}
          </p>
          <div className="-my-1 flex shrink-0 gap-1.5">
            {party.isWalkIn && <SystemBadge />}
            <StatusBadge status={party.status} />
            {party.grade && <GradeBadge grade={party.grade} />}
          </div>
        </div>
        <p className="mt-2 flex items-center gap-1.5 font-serif text-lg leading-snug text-primary">
          <span className="min-w-0 break-words">{party.name}</span>
          {party.isVerified && <VerifiedBadge />}
          <ChevronRightIcon
            aria-hidden
            className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        </p>
        {categories && <p className="mt-1 text-sm">{categories}</p>}
        {(contact || party.city) && (
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {[contact, party.city].filter(Boolean).join(" · ")}
          </p>
        )}
        <p
          className={cn(
            "mt-3 border-t pt-3 text-sm font-medium tabular-nums",
            TONE[balanceTone(party.balance)],
          )}
        >
          {balanceText(party.balance, currency)}
        </p>
      </Link>
    </li>
  );
}

/**
 * The buyers or suppliers found: cards on phones, a table on computers, each
 * opening the profile, with "Show more" for the next page. The page gives it a
 * new key when the filters change.
 */
export function PartyList({
  initial,
  view,
  currency,
}: {
  initial: { items: PartyRow[]; nextCursor?: string };
  view: PartyListView;
  currency: string;
}) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const buyers = view.list === "buyers";
  const noun = buyers ? "Buyers" : "Suppliers";

  function more() {
    startTransition(async () => {
      const result = await listPartyRowsAction(partyListQuery(view, cursor));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setItems((shown) => [...shown, ...result.data.items]);
      setCursor(result.data.nextCursor);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:hidden" aria-label={noun}>
        {items.map((party) => (
          <PartyCard key={party.id} party={party} currency={currency} supplies={!buyers} />
        ))}
      </ul>
      <div className="hidden md:block">
        <Table aria-label={noun}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              {buyers ? <TableHead>Type</TableHead> : <TableHead>Category</TableHead>}
              <TableHead>Contact</TableHead>
              <TableHead className="hidden lg:table-cell">City</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((party) => (
              <TableRow key={party.id}>
                <TableCell className="py-3">
                  <Link
                    href={partyHref(party)}
                    className="group inline-flex max-w-full items-center gap-1.5 rounded-sm font-medium text-primary outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                  >
                    <span className="truncate">{party.name}</span>
                    {party.isVerified && <VerifiedBadge />}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{party.code}</span>
                    {!buyers && party.kind === "BOTH" && <span>· Also a buyer</span>}
                    {buyers && party.kind === "BOTH" && <span>· Also a supplier</span>}
                    {party.isWalkIn && <SystemBadge />}
                    <StatusBadge status={party.status} />
                  </div>
                </TableCell>
                {buyers ? (
                  <TableCell className="text-muted-foreground">
                    {party.buyerType ? BUYER_TYPE_LABELS[party.buyerType] : ""}
                  </TableCell>
                ) : (
                  <TableCell className="max-w-48 text-muted-foreground">
                    {categoryText(party.supplierCategories) || (
                      <>
                        <span aria-hidden>–</span>
                        <span className="sr-only">Not set</span>
                      </>
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <div className="max-w-56 truncate">{party.contactPerson ?? ""}</div>
                  {party.phone && (
                    <div className="text-[0.8125rem] text-muted-foreground">{party.phone}</div>
                  )}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {party.city ?? ""}
                </TableCell>
                <TableCell>
                  {party.grade ? (
                    <GradeBadge grade={party.grade} />
                  ) : (
                    <span className="text-muted-foreground">
                      <span aria-hidden>–</span>
                      <span className="sr-only">No grade</span>
                    </span>
                  )}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium whitespace-nowrap",
                    TONE[balanceTone(party.balance)],
                  )}
                >
                  {balanceText(party.balance, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {cursor && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-self-center sm:w-auto"
          disabled={pending}
          onClick={more}
        >
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Loading" : `Show more ${noun.toLowerCase()}`}
        </Button>
      )}
      <ActionErrorDialog
        error={error}
        title={`We could not load more ${noun.toLowerCase()}`}
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
