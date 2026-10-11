"use client";

import {
  BanknoteIcon,
  FileSignatureIcon,
  FileTextIcon,
  LoaderCircleIcon,
  PlusIcon,
  ReceiptIcon,
  ShoppingCartIcon,
} from "lucide-react";
import Link from "next/link";

import { usePrintDocument } from "@/components/documents/print-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** The quick actions this person's role allows, decided on the server. */
export type QuickActionKeys = {
  newOrder: boolean;
  receivePayment: boolean;
  quotation: boolean;
  expense: boolean;
  letterhead: boolean;
};

export const QUICK_ACTION_HREFS = {
  newOrder: "/sales/orders/new",
  receivePayment: "/sales/payments?receive=1",
  quotation: "/sales/quotations/new",
  expense: "/accounts/expenses/new",
} as const;

const LINKS = [
  { key: "newOrder", label: "New order", icon: ShoppingCartIcon },
  { key: "receivePayment", label: "Receive payment", icon: BanknoteIcon },
  { key: "quotation", label: "Quick quotation", icon: FileSignatureIcon },
  { key: "expense", label: "New expense", icon: ReceiptIcon },
] as const;

/**
 * The (+) at the top right of the Home screen: the everyday things to start
 * from anywhere, each shown only to the people whose role allows it. The blank
 * letterhead is made here and offered to open or save.
 */
export function QuickActions({ can, className }: { can: QuickActionKeys; className?: string }) {
  const letterhead = usePrintDocument(
    { type: "LETTERHEAD" },
    {
      eyebrow: "Letterhead",
      description: "The company letterhead with nothing written on it, ready to print.",
      errorTitle: "We could not make the letterhead",
    },
  );
  const links = LINKS.filter((l) => can[l.key]);
  if (links.length === 0 && !can.letterhead) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            aria-label="Quick actions"
            className={cn("size-10 shrink-0 sm:w-auto", className)}
          >
            {letterhead.pending ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : (
              <PlusIcon aria-hidden />
            )}
            <span className="hidden sm:inline">New</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {links.map(({ key, label, icon: Icon }) => (
            <DropdownMenuItem key={key} asChild>
              <Link href={QUICK_ACTION_HREFS[key]}>
                <Icon aria-hidden />
                {label}
              </Link>
            </DropdownMenuItem>
          ))}
          {can.letterhead && (
            <DropdownMenuItem disabled={letterhead.pending} onSelect={() => letterhead.print()}>
              <FileTextIcon aria-hidden />
              {letterhead.pending ? "Making the letterhead" : "Blank letterhead pad"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {letterhead.dialogs}
    </>
  );
}
