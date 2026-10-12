"use client";

import { MegaphoneIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import type { NoticeView } from "@/modules/hr/notice.service";
import { NOTICE_LIMITS } from "@/modules/hr/schemas";
import {
  postNoticeAction,
  putBackNoticeAction,
  takeDownNoticeAction,
  updateNoticeAction,
} from "@/server/actions/hr.actions";

import { useNotice } from "./use-notice";

const checkboxClass = "size-4 cursor-pointer accent-primary";
const smallText = "block text-[0.8125rem] text-muted-foreground";

/** The notice's fields, read and checked before asking the server. */
function readNotice(form: FormData, today: string) {
  const title = textOf(form, "title");
  const body = textOf(form, "body");
  const showUntil = textOf(form, "showUntil");
  const errors: Record<string, string> = {};
  if (!title) errors.title = "Write a title.";
  if (!body) errors.body = "Write the notice.";
  if (showUntil && showUntil < today) errors.showUntil = "Pick today or a later day.";
  if (Object.keys(errors).length > 0) return problem(errors);
  return { title, body, pinned: form.get("pinned") === "on", showUntil: showUntil || null };
}

function NoticeFields({
  notice,
  today,
  fieldError,
}: {
  notice?: NoticeView;
  today: string;
  fieldError: (name: string) => string | undefined;
}) {
  return (
    <>
      <Field id="notice-title" label="Title" error={fieldError("title")}>
        <Input
          id="notice-title"
          name="title"
          maxLength={NOTICE_LIMITS.title}
          required
          placeholder="Office closed on Thursday"
          defaultValue={notice?.title}
          aria-invalid={Boolean(fieldError("title"))}
        />
      </Field>
      <Field id="notice-body" label="Notice" error={fieldError("body")}>
        <Textarea
          id="notice-body"
          name="body"
          rows={6}
          maxLength={NOTICE_LIMITS.body}
          required
          defaultValue={notice?.body}
          aria-invalid={Boolean(fieldError("body"))}
        />
      </Field>
      <Field
        id="notice-until"
        label="Show until (optional)"
        hint="The last day staff see it. Left empty, it stays until you take it down."
        error={fieldError("showUntil")}
      >
        <Input
          id="notice-until"
          name="showUntil"
          type="date"
          min={today}
          defaultValue={notice?.showUntil ?? ""}
          aria-invalid={Boolean(fieldError("showUntil"))}
        />
      </Field>
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="pinned"
          defaultChecked={notice?.pinned ?? false}
          className={`${checkboxClass} mt-0.5`}
        />
        <span>
          Keep it at the top
          <span className={smallText}>Pinned notices come first on the board.</span>
        </span>
      </label>
    </>
  );
}

/**
 * "Post a notice" (hr.manage): a title and the text for every employee, kept
 * at the top or not, with an optional last day. Staff with a login hear about
 * it in the app.
 */
export function PostNoticeButton({ today, className }: { today: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice();
  return (
    <div className={className}>
      <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <MegaphoneIcon aria-hidden />
        Post a notice
      </Button>
      {notice && (
        <div className="mt-3">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      )}
      {open && (
        <FormDialog
          title="Post a notice"
          description="Every employee sees it in My HR > Notices. Staff with a login are told in the app, and on their phone once push notifications are connected."
          submitLabel="Post the notice"
          pendingLabel="Posting"
          errorTitle="We could not post the notice"
          className="sm:max-w-xl"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const input = readNotice(form, today);
            if ("code" in input) return input;
            const result = await postNoticeAction(input);
            if (!result.ok) return result.error;
            const { told, noLogin } = result.data;
            setNotice(
              `The notice is up. ${told === 1 ? "1 person was" : `${told} people were`} told in the app.${
                noLogin > 0
                  ? ` ${noLogin === 1 ? "1 employee has" : `${noLogin} employees have`} no login: tell them another way.`
                  : ""
              }`,
            );
            setOpen(false);
          }}
        >
          {(fieldError) => <NoticeFields today={today} fieldError={fieldError} />}
        </FormDialog>
      )}
    </div>
  );
}

/** Change, take down or put back one notice (hr.manage). */
export function NoticeActions({ notice: n, today }: { notice: NoticeView; today: string }) {
  const [editing, setEditing] = useState(false);
  const [takingDown, setTakingDown] = useState(false);
  const [message, setMessage] = useNotice();
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();

  function putBack() {
    startTransition(async () => {
      const result = await putBackNoticeAction(n.id);
      if (!result.ok) return setError(result.error);
      setMessage(
        result.data.state === "UP"
          ? "The notice is back up."
          : "The notice is back, but its last day has passed: change “Show until” to show it again.",
      );
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {n.state === "TAKEN_DOWN" ? (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={pending}
            onClick={putBack}
            aria-label={`Put back up: ${n.title}`}
          >
            Put back up
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setEditing(true)}
              aria-label={`Change: ${n.title}`}
            >
              Change
            </Button>
            {/* An ended notice is already off the board: changing its last day shows it again. */}
            {n.state === "UP" && (
              <Button
                type="button"
                variant="outline"
                className="w-full text-destructive hover:text-destructive sm:w-auto"
                onClick={() => setTakingDown(true)}
                aria-label={`Take down: ${n.title}`}
              >
                Take down
              </Button>
            )}
          </>
        )}
      </div>
      {message && <FormAlert tone="success">{message}</FormAlert>}

      {editing && (
        <FormDialog
          title="Change the notice"
          description="Staff see the new text with “Changed” and the time. Nobody is told again."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not change the notice"
          className="sm:max-w-xl"
          onClose={() => setEditing(false)}
          onSubmit={async (form) => {
            const input = readNotice(
              form,
              n.showUntil && n.showUntil < today ? n.showUntil : today,
            );
            if ("code" in input) return input;
            const result = await updateNoticeAction(n.id, input);
            if (!result.ok) return result.error;
            setMessage("The notice is saved.");
            setEditing(false);
          }}
        >
          {(fieldError) => <NoticeFields notice={n} today={today} fieldError={fieldError} />}
        </FormDialog>
      )}

      {takingDown && (
        <FormDialog
          title={`Take down “${n.title}”?`}
          description="Staff no longer see it. It stays here with who read it, and you can put it back up."
          submitLabel="Take down"
          pendingLabel="Taking down"
          destructive
          errorTitle="We could not take the notice down"
          onClose={() => setTakingDown(false)}
          onSubmit={async () => {
            const result = await takeDownNoticeAction(n.id);
            if (!result.ok) return result.error;
            setTakingDown(false);
          }}
        >
          {() => null}
        </FormDialog>
      )}

      <ActionErrorDialog
        error={error}
        title="We could not put the notice back up"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
