"use client";

import { Building2Icon, ChevronsUpDownIcon, LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import { switchCompanyAction } from "@/server/actions/auth.actions";

import type { ShellCompany } from "./types";

/*
 * v6.4.1 C1: the company's name is never cut with "...". A long name ("Extas Apparel
 * Sourcing & Buying House Limited") wraps onto two or three short lines in smaller
 * text, and the button grows to hold them. On a tablet (md) the top bar is tight, so
 * there the building icon steps aside to give the name its room.
 */
const triggerStyle =
  "inline-flex min-h-9 max-w-[11rem] min-w-0 items-center gap-2 rounded-md border border-primary-foreground/20 px-2.5 py-1 text-sm text-primary-foreground transition-colors outline-none sm:max-w-[16rem] sm:px-3 md:max-w-[8.5rem] md:gap-1.5 md:px-2 lg:max-w-[16rem] lg:gap-2 lg:px-3";

/** The name on the button: whole, wrapped, smaller where the bar is tight. */
const nameStyle =
  "min-w-0 text-left text-xs leading-tight break-words sm:text-sm md:text-xs lg:text-sm";

/** The building icon (the top bar hides it on a tablet, where the name needs the room). */
const iconStyle = "size-4 shrink-0 opacity-70";

/**
 * The blueprint's multi-company switcher in the top bar. Switching re-checks
 * access on the server (switchCompanyAction) and reloads the screen for the
 * new company's data and the person's role there.
 */
export function CompanySwitcher({
  companies,
  activeCompany,
  className,
  wide = false,
}: {
  companies: ShellCompany[];
  activeCompany: { id: string; name: string };
  /** Extra classes for the button (the modern side menu makes it full width). */
  className?: string;
  /** The side menu's full-width button: room for the building icon at every width. */
  wide?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();

  if (companies.length <= 1) {
    return (
      <span className={cn(triggerStyle, "border-transparent", className)}>
        <Building2Icon className={cn(iconStyle, !wide && "md:max-lg:hidden")} aria-hidden />
        <span className={nameStyle}>{activeCompany.name}</span>
      </span>
    );
  }

  function switchTo(companyId: string) {
    if (companyId === activeCompany.id) return;
    startTransition(async () => {
      const result = await switchCompanyAction(companyId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            triggerStyle,
            "cursor-pointer hover:bg-primary-foreground/10 focus-visible:ring-[3px] focus-visible:ring-primary-foreground/30 data-[state=open]:bg-primary-foreground/10",
            className,
          )}
          aria-label={`Company: ${activeCompany.name}. Switch company`}
          disabled={pending}
        >
          {pending ? (
            <LoaderCircleIcon className="size-4 shrink-0 animate-spin" aria-hidden />
          ) : (
            <Building2Icon className={cn(iconStyle, !wide && "md:max-lg:hidden")} aria-hidden />
          )}
          <span className={nameStyle}>{activeCompany.name}</span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="eyebrow">Switch company</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={activeCompany.id} onValueChange={switchTo}>
            {companies.map((company) => (
              <DropdownMenuRadioItem key={company.id} value={company.id}>
                <span className="min-w-0">
                  <span className="block break-words">{company.name}</span>
                  {company.roleName && (
                    <span className="block text-xs text-muted-foreground">{company.roleName}</span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <ActionErrorDialog
        error={error}
        title="The company did not change"
        onClose={() => {
          setError(undefined);
          // The list may be out of date (access removed, company closed): fetch it again.
          router.refresh();
        }}
      />
    </>
  );
}
