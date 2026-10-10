"use client";

import type { NoteTab } from "@prisma/client";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useOptimistic, useRef, useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Field } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { addDays } from "@/lib/dates";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { NoteView } from "@/modules/notepad/note.service";
import {
  createNoteAction,
  deleteNoteAction,
  markNoteAction,
  reorderNotesAction,
  updateNoteAction,
} from "@/server/actions/notepad.actions";

import { dayWords } from "./labels";

/** Today, tomorrow and the day after, as the work plan's day choices. */
function planChoices(today: string) {
  return ["Today", "Tomorrow", "The day after"].map((label, n) => ({
    day: addDays(today, n),
    label,
  }));
}

const noteText = (note: NoteView) => note.title || note.content;

/**
 * A tab's notes, each with what may be done with it: tick (routine and work
 * plan), change, pin (general notes), move up or down and delete. Ticks show at
 * once and are saved behind them. Notes are the person's own.
 */
export function NoteRows({
  notes,
  tab,
  today,
  label,
  checks = tab !== "GENERAL",
  movable = true,
}: {
  notes: NoteView[];
  tab: NoteTab;
  today: string;
  /** What the list is, for screen readers ("Daily routine"). */
  label: string;
  checks?: boolean;
  /** Moving up and down (off while searching). */
  movable?: boolean;
}) {
  const [ticks, setTick] = useOptimistic(
    new Map(notes.map((n) => [n.id, n.done])),
    (state, change: { id: string; done: boolean }) => new Map(state).set(change.id, change.done),
  );
  const [error, setError] = useState<ActionError>();
  const [editing, setEditing] = useState<NoteView | null>(null);
  const [deleting, setDeleting] = useState<NoteView | null>(null);
  const [, startTransition] = useTransition();

  function tick(note: NoteView, done: boolean) {
    startTransition(async () => {
      setTick({ id: note.id, done });
      const result = await markNoteAction(note.id, { done });
      if (!result.ok) setError(result.error);
    });
  }

  function pin(note: NoteView) {
    startTransition(async () => {
      const result = await updateNoteAction(note.id, { isPinned: !note.isPinned });
      if (!result.ok) setError(result.error);
    });
  }

  /** Moves a note one place within its group (pinned, unpinned, or one day). */
  function move(note: NoteView, by: -1 | 1) {
    const group = notes.filter((n) => n.isPinned === note.isPinned);
    const index = group.findIndex((n) => n.id === note.id);
    const other = group[index + by];
    if (!other) return;
    const ids = group.map((n) => n.id);
    ids[index] = other.id;
    ids[index + by] = note.id;
    startTransition(async () => {
      const result = await reorderNotesAction({ tab, ids });
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      <ul className="grid divide-y" aria-label={label}>
        {notes.map((note) => {
          const done = ticks.get(note.id) ?? note.done;
          const group = notes.filter((n) => n.isPinned === note.isPinned);
          const index = group.findIndex((n) => n.id === note.id);
          return (
            <li key={note.id} className="flex items-start gap-1 py-1">
              {checks ? (
                <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50 md:min-h-9">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4.5 shrink-0 cursor-pointer accent-primary"
                    checked={done}
                    onChange={(e) => tick(note, e.target.checked)}
                  />
                  <span
                    className={cn(
                      "min-w-0 text-sm leading-snug break-words whitespace-pre-wrap",
                      done && "text-muted-foreground line-through",
                    )}
                  >
                    {note.title && <span className="block font-medium">{note.title}</span>}
                    {note.content}
                  </span>
                </label>
              ) : (
                <div className="min-w-0 flex-1 px-2 py-2.5">
                  {note.title && (
                    <p className="flex items-center gap-1.5 text-sm font-medium break-words">
                      {note.isPinned && (
                        <PinIcon aria-label="Pinned" className="size-3.5 shrink-0 text-primary" />
                      )}
                      {note.title}
                    </p>
                  )}
                  <p
                    className={cn(
                      "text-sm leading-relaxed break-words whitespace-pre-wrap",
                      note.title ? "mt-1 text-muted-foreground" : "",
                    )}
                  >
                    {!note.title && note.isPinned && (
                      <PinIcon
                        aria-label="Pinned"
                        className="mr-1.5 inline size-3.5 align-[-0.125em] text-primary"
                      />
                    )}
                    {note.content}
                  </p>
                </div>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0 md:size-9"
                    aria-label={`More for ${noteText(note).slice(0, 60)}`}
                  >
                    <EllipsisVerticalIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={() => setEditing(note)}>
                    <PencilIcon aria-hidden />
                    Change
                  </DropdownMenuItem>
                  {tab === "GENERAL" && (
                    <DropdownMenuItem onSelect={() => pin(note)}>
                      {note.isPinned ? <PinOffIcon aria-hidden /> : <PinIcon aria-hidden />}
                      {note.isPinned ? "Unpin" : "Pin to the top"}
                    </DropdownMenuItem>
                  )}
                  {movable && index > 0 && (
                    <DropdownMenuItem onSelect={() => move(note, -1)}>
                      <ArrowUpIcon aria-hidden />
                      Move up
                    </DropdownMenuItem>
                  )}
                  {movable && index < group.length - 1 && (
                    <DropdownMenuItem onSelect={() => move(note, 1)}>
                      <ArrowDownIcon aria-hidden />
                      Move down
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(note)}>
                    <Trash2Icon aria-hidden />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
      {editing && (
        <NoteDialog note={editing} tab={tab} today={today} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this note?"
          description={`"${noteText(deleting).slice(0, 120)}" is removed for good.`}
          confirmLabel="Delete the note"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the note"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const result = await deleteNoteAction(deleting.id);
            if (!result.ok) return result.error;
            setDeleting(null);
          }}
        />
      )}
      <ActionErrorDialog
        error={error}
        title="We could not change the note"
        onClose={() => setError(undefined)}
      />
    </>
  );
}

/**
 * Writes or changes a note: a work plan item has its day (today, tomorrow or
 * the day after), a general note may have a title and be pinned.
 */
export function NoteDialog({
  note,
  tab,
  today,
  day,
  onClose,
}: {
  note?: NoteView;
  tab: NoteTab;
  today: string;
  /** A new work plan item's day. */
  day?: string;
  onClose: () => void;
}) {
  const editing = Boolean(note);
  const choices = planChoices(today);
  // An item carried over keeps its old day unless another is picked.
  const overdueDay = note?.planDate && note.planDate < today ? note.planDate : null;

  return (
    <FormDialog
      title={editing ? "Change the note" : tab === "GENERAL" ? "Write a note" : "Add to the plan"}
      description="Only you see your notepad."
      submitLabel={editing ? "Save" : "Add"}
      pendingLabel="Saving"
      errorTitle="We could not save the note"
      onClose={onClose}
      onSubmit={async (form) => {
        const content = textOf(form, "content");
        if (!content) return problem({ content: "Write something." });
        const planDate = textOf(form, "planDate");
        const input = {
          content,
          ...(tab === "GENERAL" ? { title: textOf(form, "title") || null } : {}),
          ...(tab === "GENERAL" ? { isPinned: form.get("isPinned") === "on" } : {}),
          ...(tab === "NEXT_3_DAYS" && planDate && planDate !== overdueDay ? { planDate } : {}),
        };
        const result = note
          ? await updateNoteAction(note.id, input)
          : await createNoteAction({ tab, ...input });
        if (!result.ok) return result.error;
        onClose();
      }}
    >
      {(fieldError) => (
        <>
          {tab === "GENERAL" && (
            <Field id="note-title" label="Title (optional)" error={fieldError("title")}>
              <Input
                id="note-title"
                name="title"
                maxLength={200}
                defaultValue={note?.title ?? ""}
                autoComplete="off"
              />
            </Field>
          )}
          <Field id="note-content" label="Note" error={fieldError("content")}>
            <Textarea
              id="note-content"
              name="content"
              rows={tab === "GENERAL" ? 6 : 3}
              maxLength={5000}
              defaultValue={note?.content ?? ""}
              aria-invalid={Boolean(fieldError("content"))}
            />
          </Field>
          {tab === "NEXT_3_DAYS" && (
            <Field id="note-day" label="Day" error={fieldError("planDate")}>
              <NativeSelect
                id="note-day"
                name="planDate"
                defaultValue={overdueDay ?? note?.planDate ?? day ?? today}
                containerClassName="sm:w-full"
              >
                {overdueDay && (
                  <option value={overdueDay}>Keep it on {dayWords(overdueDay, today)}</option>
                )}
                {choices.map((c) => (
                  <option key={c.day} value={c.day}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {tab === "GENERAL" && (
            <label className="flex h-11 cursor-pointer items-center gap-2 text-sm md:h-9">
              <input
                type="checkbox"
                name="isPinned"
                defaultChecked={note?.isPinned ?? false}
                className="size-4 cursor-pointer accent-primary"
              />
              Pin to the top
            </label>
          )}
        </>
      )}
    </FormDialog>
  );
}

/**
 * A one-line box to add a routine or work plan item quickly; the work plan
 * asks which day.
 */
export function QuickAdd({
  tab,
  today,
  placeholder,
}: {
  tab: "DAILY_ROUTINE" | "NEXT_3_DAYS";
  today: string;
  placeholder: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const choices = planChoices(today);
  const inputId = `quick-add-${tab}`;

  function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const content = textOf(form, "content");
    if (!content) {
      setError("Write something first.");
      return;
    }
    const planDate = textOf(form, "planDate");
    startTransition(async () => {
      const result = await createNoteAction({
        tab,
        content,
        ...(tab === "NEXT_3_DAYS" ? { planDate: planDate || today } : {}),
      });
      if (!result.ok) {
        if (result.error.code === "VALIDATION") setError(result.error.message);
        else setFailure(result.error);
        return;
      }
      setError(undefined);
      formRef.current?.reset();
      formRef.current?.querySelector<HTMLInputElement>("input[name=content]")?.focus();
    });
  }

  return (
    <form ref={formRef} onSubmit={add} className="grid gap-2">
      <label htmlFor={inputId} className="sr-only">
        {placeholder}
      </label>
      <div className="grid gap-2 sm:flex sm:items-center">
        <Input
          id={inputId}
          name="content"
          maxLength={5000}
          placeholder={placeholder}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="sm:flex-1"
          onChange={() => error && setError(undefined)}
        />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex">
          {tab === "NEXT_3_DAYS" ? (
            <>
              <label htmlFor={`${inputId}-day`} className="sr-only">
                Day
              </label>
              <NativeSelect id={`${inputId}-day`} name="planDate" defaultValue={today}>
                {choices.map((c) => (
                  <option key={c.day} value={c.day}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </>
          ) : (
            <span className="sm:hidden" />
          )}
          <Button type="submit" disabled={pending}>
            <PlusIcon aria-hidden />
            {pending ? "Adding" : "Add"}
          </Button>
        </div>
      </div>
      {error && (
        <p id={`${inputId}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ActionErrorDialog
        error={failure}
        title="We could not add it"
        onClose={() => setFailure(undefined)}
      />
    </form>
  );
}

/** "Write a note" for the general notes. */
export function WriteNoteButton({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden />
        Write a note
      </Button>
      {open && <NoteDialog tab="GENERAL" today={today} onClose={() => setOpen(false)} />}
    </>
  );
}
