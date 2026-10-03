"use client";

import { ArrowRightIcon, LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { FormAlert } from "@/components/forms/field";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import { selectCompanyAction } from "@/server/actions/auth-forms.actions";

type Choice = { id: string; name: string; roleName: string | null };

export function CompanyChoices({
  companies,
  activeCompanyId,
}: {
  companies: Choice[];
  activeCompanyId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<string>();
  const [error, setError] = useState<ActionError>();

  function choose(companyId: string) {
    setChosen(companyId);
    setError(undefined);
    startTransition(async () => setError(await selectCompanyAction(companyId)));
  }

  return (
    <div className="mt-8 grid gap-3">
      <ul className="grid gap-2">
        {companies.map((company) => (
          <li key={company.id}>
            <button
              type="button"
              onClick={() => choose(company.id)}
              disabled={pending}
              className={cn(
                "group flex w-full cursor-pointer items-center justify-between gap-4 rounded-md border bg-card px-4 py-3.5 text-left transition-colors outline-none hover:border-primary/40 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-wait",
                company.id === activeCompanyId && "border-primary/40",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{company.name}</span>
                {company.roleName && (
                  <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                    {company.roleName}
                  </span>
                )}
              </span>
              {pending && chosen === company.id ? (
                <LoaderCircleIcon
                  className="size-4 shrink-0 animate-spin text-primary"
                  aria-hidden
                />
              ) : (
                <ArrowRightIcon
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                  aria-hidden
                />
              )}
            </button>
          </li>
        ))}
      </ul>
      {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
      <ActionErrorDialog
        error={error?.code === "INTERNAL" ? error : undefined}
        title="That company did not open"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
