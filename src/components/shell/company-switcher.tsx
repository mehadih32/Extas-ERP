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

const triggerStyle =
  "inline-flex h-9 max-w-[11rem] items-center gap-2 rounded-md border border-primary-foreground/20 px-2.5 text-sm text-primary-foreground transition-colors outline-none sm:max-w-[16rem] sm:px-3 md:max-w-[8.5rem] lg:max-w-[16rem]";

/**
 * The blueprint's multi-company switcher in the top bar. Switching re-checks
 * access on the server (switchCompanyAction) and reloads the screen for the
 * new company's data and the person's role there.
 */
export function CompanySwitcher({
  companies,
  activeCompany,
}: {
  companies: ShellCompany[];
  activeCompany: { id: string; name: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();

  if (companies.length <= 1) {
    return (
      <span className={cn(triggerStyle, "border-transparent")}>
        <Building2Icon className="size-4 shrink-0 opacity-70" aria-hidden />
        <span className="truncate">{activeCompany.name}</span>
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
          )}
          aria-label={`Company: ${activeCompany.name}. Switch company`}
          disabled={pending}
        >
          {pending ? (
            <LoaderCircleIcon className="size-4 shrink-0 animate-spin" aria-hidden />
          ) : (
            <Building2Icon className="size-4 shrink-0 opacity-70" aria-hidden />
          )}
          <span className="truncate">{activeCompany.name}</span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="eyebrow">Switch company</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={activeCompany.id} onValueChange={switchTo}>
            {companies.map((company) => (
              <DropdownMenuRadioItem key={company.id} value={company.id}>
                <span className="min-w-0">
                  <span className="block truncate">{company.name}</span>
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
