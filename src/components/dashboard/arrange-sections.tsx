"use client";

import { ArrowUpDownIcon, LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { FormAlert } from "@/components/forms/field";
import { SortableRow, SortableRows } from "@/components/products/setup/sortable-rows";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import { HOME_SECTIONS, type HomeSectionKey } from "@/modules/dashboard/schemas";
import { setHomeSectionOrderAction } from "@/server/actions/dashboard.actions";

/** A Home section this person sees, by the name of its heading. */
export type HomeSectionItem = { key: HomeSectionKey; name: string };

const standardOrder = (keys: HomeSectionKey[]) =>
  [...keys].sort((a, b) => HOME_SECTIONS.indexOf(a) - HOME_SECTIONS.indexOf(b));

/** `keys` with `key` moved to `index`. */
function moveTo(keys: HomeSectionKey[], key: HomeSectionKey, index: number) {
  const rest = keys.filter((k) => k !== key);
  rest.splice(index, 0, key);
  return rest;
}

/**
 * "Arrange sections" by the date on the Home screen: the sections this person
 * sees, moved by dragging a handle or by choosing each one's place. Saving keeps
 * the order for this person and puts the screen in it.
 */
export function ArrangeSections({
  sections,
  className,
}: {
  /** In the order they are on the screen now. */
  sections: HomeSectionItem[];
  className?: string;
}) {
  const router = useRouter();
  const current = sections.map((s) => s.key);
  const names = new Map(sections.map((s) => [s.key, s.name]));
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(current);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const changed = order.join() !== current.join();
  const standard = order.join() === standardOrder(order).join();

  function openChange(next: boolean) {
    if (pending) return;
    if (next) {
      setOrder(current);
      setError(undefined);
    }
    setOpen(next);
  }

  function save() {
    startTransition(async () => {
      const result = await setHomeSectionOrderAction({ order });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Arrange sections"
          className={cn("text-muted-foreground hover:text-primary", className)}
        >
          <ArrowUpDownIcon aria-hidden />
          <span className="sm:hidden">Arrange</span>
          <span className="hidden sm:inline">Arrange sections</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Arrange sections</DialogTitle>
          <DialogDescription>
            Drag a section by its handle, or choose its place. The order is yours alone and stays
            after you refresh or sign in again.
          </DialogDescription>
        </DialogHeader>
        <SortableRows
          id="home-sections"
          label="Home sections"
          ids={order}
          onMove={(ids) => setOrder(ids as HomeSectionKey[])}
        >
          {order.map((key, index) => {
            const name = names.get(key) ?? key;
            return (
              <SortableRow key={key} id={key} name={name} disabled={pending}>
                <span className="min-w-0 flex-1 text-sm font-medium break-words">{name}</span>
                <NativeSelect
                  aria-label={`Place of ${name}`}
                  value={index}
                  disabled={pending}
                  onChange={(event) => setOrder(moveTo(order, key, Number(event.target.value)))}
                  containerClassName="w-auto shrink-0"
                >
                  {order.map((_, place) => (
                    <option key={place} value={place}>
                      {place + 1}
                    </option>
                  ))}
                </NativeSelect>
              </SortableRow>
            );
          })}
        </SortableRows>
        {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOrder(standardOrder(order))}
            disabled={pending || standard}
          >
            Reset to the standard order
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => openChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending || !changed}>
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending ? "Saving" : "Save the order"}
            </Button>
          </div>
        </DialogFooter>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title="We could not save the order"
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
