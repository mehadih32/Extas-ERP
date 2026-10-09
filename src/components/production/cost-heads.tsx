"use client";

import { ArchiveIcon, ArchiveRestoreIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { CostHeadsScreen } from "@/modules/production/screens.service";
import { createCostHeadAction, updateCostHeadAction } from "@/server/actions/production.actions";

import { COST_HEAD_CATEGORY_LABELS } from "./labels";

type Head = CostHeadsScreen["heads"][number];

const GROUPS = [
  {
    category: "PRODUCTION",
    title: "Making costs",
    hint: "Cutting, sewing, washing, printing, transport.",
  },
  { category: "RAW_MATERIAL", title: "Materials", hint: "Fabric, trims, buttons, packing." },
] as const;

/**
 * The cost heads bills and costs are filed under. Production Managers add,
 * rename, archive and restore them (production.manage, as the cost head actions
 * check); an archived head stays on old costs but is not offered for new ones.
 */
export function CostHeads({ screen }: { screen: CostHeadsScreen }) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Head | null>(null);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<ActionError>();
  const [busy, setBusy] = useState<string>();
  const [, startTransition] = useTransition();
  const { heads, canManage } = screen;
  const others = heads.filter((h) => h.category !== "PRODUCTION" && h.category !== "RAW_MATERIAL");

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 8_000);
    return () => clearTimeout(timer);
  }, [notice]);

  function setActive(head: Head, isActive: boolean) {
    setBusy(head.id);
    startTransition(async () => {
      const result = await updateCostHeadAction(head.id, { isActive });
      setBusy(undefined);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(isActive ? `${head.name} is back in use.` : `${head.name} is archived.`);
    });
  }

  const list = (items: Head[]) => (
    <ul className="mt-4 grid divide-y">
      {items.map((head) => (
        <li
          key={head.id}
          className={cn(
            "flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0",
            !head.isActive && "text-muted-foreground",
          )}
        >
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <span className="break-words">{head.name}</span>
            {!head.isActive && <StatusBadge tone="closed">Archived</StatusBadge>}
          </span>
          {canManage && (
            <span className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRenaming(head)}
                aria-label={`Rename ${head.name}`}
              >
                <PencilIcon aria-hidden />
                Rename
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy === head.id}
                onClick={() => setActive(head, !head.isActive)}
                aria-label={`${head.isActive ? "Archive" : "Restore"} ${head.name}`}
              >
                {head.isActive ? <ArchiveIcon aria-hidden /> : <ArchiveRestoreIcon aria-hidden />}
                {head.isActive ? "Archive" : "Restore"}
              </Button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="grid gap-6">
      {canManage && (
        <div>
          <Button type="button" className="w-full sm:w-auto" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden />
            Add a cost head
          </Button>
        </div>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {GROUPS.map((group) => {
          const items = heads.filter((h) => h.category === group.category);
          return (
            <Panel key={group.category} title={group.title} id={`${group.category}-heading`}>
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">{group.hint}</p>
              {items.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">None yet.</p>
              ) : (
                list(items)
              )}
            </Panel>
          );
        })}
        {others.length > 0 && (
          <Panel title="Other" id="other-heading">
            {list(others)}
          </Panel>
        )}
      </div>

      {adding && (
        <FormDialog
          title="Add a cost head"
          description="Bills and costs are filed under it, so the cost sheet shows where the money went."
          submitLabel="Add it"
          pendingLabel="Adding"
          errorTitle="We could not add the cost head"
          onClose={() => setAdding(false)}
          onSubmit={async (form) => {
            const name = textOf(form, "name");
            if (name.length < 2) return problem({ name: "Give it a name." });
            const result = await createCostHeadAction({
              name,
              category: textOf(form, "category") === "RAW_MATERIAL" ? "RAW_MATERIAL" : "PRODUCTION",
            });
            if (!result.ok) return result.error;
            setNotice(`${result.data.name} was added.`);
            setAdding(false);
          }}
        >
          {(fieldError) => (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field id="head-name" label="Name" error={fieldError("name")}>
                <Input
                  id="head-name"
                  name="name"
                  maxLength={80}
                  autoComplete="off"
                  placeholder="Like: Embroidery"
                  aria-invalid={Boolean(fieldError("name"))}
                  aria-describedby={fieldError("name") ? "head-name-error" : undefined}
                  autoFocus
                />
              </Field>
              <Field id="head-category" label="Kind">
                <NativeSelect
                  id="head-category"
                  name="category"
                  defaultValue="PRODUCTION"
                  containerClassName="sm:w-full"
                >
                  {(["PRODUCTION", "RAW_MATERIAL"] as const).map((c) => (
                    <option key={c} value={c}>
                      {COST_HEAD_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          )}
        </FormDialog>
      )}

      {renaming && (
        <FormDialog
          title={`Rename ${renaming.name}`}
          description="Costs already filed under it move with it."
          submitLabel="Rename"
          pendingLabel="Saving"
          errorTitle="We could not rename the cost head"
          onClose={() => setRenaming(null)}
          onSubmit={async (form) => {
            const name = textOf(form, "name");
            if (name.length < 2) return problem({ name: "Give it a name." });
            const result = await updateCostHeadAction(renaming.id, { name });
            if (!result.ok) return result.error;
            setNotice(`It is now called ${result.data.name}.`);
            setRenaming(null);
          }}
        >
          {(fieldError) => (
            <Field id="rename-name" label="Name" error={fieldError("name")}>
              <Input
                id="rename-name"
                name="name"
                defaultValue={renaming.name}
                maxLength={80}
                autoComplete="off"
                aria-invalid={Boolean(fieldError("name"))}
                aria-describedby={fieldError("name") ? "rename-name-error" : undefined}
                autoFocus
              />
            </Field>
          )}
        </FormDialog>
      )}

      <ActionErrorDialog
        error={error}
        title="We could not change the cost head"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
