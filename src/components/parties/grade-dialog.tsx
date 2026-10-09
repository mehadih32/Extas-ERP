"use client";

import type { PartyGrade } from "@prisma/client";
import { LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionError } from "@/lib/result";

import { ChoiceList } from "./choice-list";
import { GRADE_LABELS } from "./labels";

const NONE = "NONE";

const OPTIONS = [
  { value: "A_PLUS", label: `Grade ${GRADE_LABELS.A_PLUS}`, hint: "Your best accounts." },
  { value: "A", label: `Grade ${GRADE_LABELS.A}`, hint: "Strong and reliable." },
  { value: "B", label: `Grade ${GRADE_LABELS.B}`, hint: "Average." },
  { value: "C", label: `Grade ${GRADE_LABELS.C}`, hint: "To watch." },
  { value: NONE, label: "No grade", hint: "Not graded yet." },
] as const;

/**
 * Grades a buyer or supplier A+ to C (or takes the grade away). The grades are
 * the company's own judgement, for example by how much and how reliably an
 * account buys, supplies and pays.
 */
export function GradeDialog({
  name,
  grade,
  onSave,
  onClose,
}: {
  name: string;
  grade: PartyGrade | null;
  /** Runs the Server Action and returns its error, if any. */
  onSave: (grade: PartyGrade | null) => Promise<ActionError | undefined>;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = String(new FormData(event.currentTarget).get("grade") ?? NONE);
    startTransition(async () => {
      setError(await onSave(chosen === NONE ? null : (chosen as PartyGrade)));
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grade {name}</DialogTitle>
          <DialogDescription>
            Grades are your own judgement, for example by how much and how reliably they buy, supply
            and pay. They show on the profile and in the lists, and the lists can be filtered by
            them.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5">
          <ChoiceList name="grade" legend="Grade" options={OPTIONS} defaultValue={grade ?? NONE} />
          {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending ? "Saving" : "Save the grade"}
            </Button>
          </DialogFooter>
        </form>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title="We could not save the grade"
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
