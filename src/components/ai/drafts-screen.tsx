"use client";

import { CalendarClockIcon, PenLineIcon, SendIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DRAFT_KIND_LABELS, DRAFT_KINDS } from "@/modules/ai/draft-templates";
import type { DraftsScreen as Drafts } from "@/modules/ai/drafts.service";
import {
  closeFollowUpAction,
  createDraftAction,
  discardDraftAction,
  sendDraftAction,
  setFollowUpAction,
  updateDraftAction,
  writeDraftWithAiAction,
} from "@/server/actions/mehedi.actions";

/*
 * AI Center > Drafts: what Mehedi 2.0 (or the owner) drafted. A buyer's
 * message goes only when the owner presses Send; an unsent one reminds the
 * owner after the hours set in Settings. Follow-ups: on the day, a draft is
 * made and the owner reminded.
 */

const LISTS = [
  { value: "waiting", label: "Waiting" },
  { value: "sent", label: "Sent" },
  { value: "discarded", label: "Discarded" },
] as const;

const when = (at: Date | string | null) =>
  at
    ? new Date(at).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

type Draft = Drafts["drafts"][number];

export function DraftsScreen({ drafts: d }: { drafts: Drafts }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [creating, setCreating] = useState(false);
  const [following, setFollowing] = useState(false);
  const [words, setWords] = useState<{ subject: string; body: string; byAi: boolean } | null>(null);
  const [aiError, setAiError] = useState<string>();
  const manage = d.can.manage;

  const run = (
    work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>,
    done: string,
  ) =>
    startTransition(async () => {
      const result = await work();
      setMessage(
        result.ok ? { tone: "success", text: done } : { tone: "error", text: result.error.message },
      );
    });

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}

      <Panel
        title="Drafts"
        id="drafts-heading"
        action={
          manage && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setWords(null);
                setAiError(undefined);
                setCreating(true);
              }}
            >
              <PenLineIcon aria-hidden />
              New draft
            </Button>
          )
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing reaches a buyer until you press Send (or say &ldquo;পাঠাও&rdquo; in the chat). An
          unsent buyer draft reminds you after {d.replyRemindHours} hours.
        </p>
        <nav aria-label="Draft lists" className="mt-4 flex flex-wrap gap-2">
          {LISTS.map((l) => (
            <Link
              key={l.value}
              href={l.value === "waiting" ? "/ai/drafts" : `/ai/drafts?list=${l.value}`}
              aria-current={d.list === l.value ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                d.list === l.value
                  ? "border-primary bg-secondary text-primary"
                  : "text-muted-foreground",
              )}
            >
              {l.label} ({d.counts[l.value]})
            </Link>
          ))}
        </nav>
        {d.drafts.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No drafts here.</p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {d.drafts.map((x) => (
              <li
                key={x.id}
                id={`draft-${x.id}`}
                className="grid scroll-mt-24 gap-2 rounded-md border p-4 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{x.subject}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge tone="plain">{x.kindLabel}</StatusBadge>
                    {x.status === "FAILED" && <StatusBadge tone="warn">Not sent</StatusBadge>}
                    {x.status === "SENT" && <StatusBadge tone="done">Sent</StatusBadge>}
                  </div>
                </div>
                <p className="text-[0.8125rem] text-muted-foreground">
                  To {x.party?.name ?? "?"}
                  {x.toAddress ? ` (${x.toAddress})` : " (no email address yet)"} · by {x.by ?? "?"}
                  , {when(x.createdAt)}
                  {x.record ? ` · ${x.record}` : ""}
                  {x.sentAt ? ` · sent ${when(x.sentAt)}${x.sentBy ? ` by ${x.sentBy}` : ""}` : ""}
                </p>
                {x.error && <p className="text-[0.8125rem] text-destructive">{x.error}</p>}
                <pre className="max-h-72 overflow-auto rounded bg-muted/40 p-3 font-sans text-[0.8125rem] whitespace-pre-wrap">
                  {x.body}
                </pre>
                {manage && (x.status === "DRAFT" || x.status === "FAILED") && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending || !x.toAddress}
                      onClick={() => run(() => sendDraftAction(x.id), `Sent to ${x.toAddress}.`)}
                    >
                      <SendIcon aria-hidden />
                      Send
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing(x)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(() => discardDraftAction(x.id), "Discarded: it will not be sent.")
                      }
                    >
                      Discard
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Follow-ups"
        id="follow-ups"
        action={
          manage && (
            <Button type="button" size="sm" variant="outline" onClick={() => setFollowing(true)}>
              <CalendarClockIcon aria-hidden />
              Set a follow-up
            </Button>
          )
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">
          On the day, a follow-up draft is made for you and you are reminded. It goes only when you
          send it.
        </p>
        {d.followUps.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No follow-ups.</p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {d.followUps.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {f.party.name}
                    {f.record ? ` · ${f.record}` : ""}
                  </p>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {f.dueOn}
                    {f.note ? ` · ${f.note}` : ""}
                    {f.draftId ? " · draft made" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {f.status === "OPEN" ? (
                    <StatusBadge tone={f.due ? "warn" : "open"}>
                      {f.due ? "Due" : "Open"}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="closed">
                      {f.status === "DONE" ? "Done" : "Cancelled"}
                    </StatusBadge>
                  )}
                  {manage && f.status === "OPEN" && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => run(() => closeFollowUpAction(f.id, true), "Marked done.")}
                      >
                        Done
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => run(() => closeFollowUpAction(f.id, false), "Cancelled.")}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && (
        <FormDialog
          title="Edit the draft"
          description="Change the words or the address before you send it."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not save the draft"
          className="sm:max-w-2xl"
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            const result = await updateDraftAction(editing.id, {
              toAddress: String(form.get("toAddress") ?? ""),
              subject: String(form.get("subject") ?? ""),
              body: String(form.get("body") ?? ""),
            });
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: "The draft is saved." });
            setEditing(null);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              <Field id="draft-to" label="To (email)" error={fieldError("toAddress")}>
                <Input
                  id="draft-to"
                  name="toAddress"
                  type="email"
                  defaultValue={editing.toAddress ?? ""}
                />
              </Field>
              <Field id="draft-subject" label="Subject" error={fieldError("subject")}>
                <Input
                  id="draft-subject"
                  name="subject"
                  defaultValue={editing.subject}
                  maxLength={200}
                  required
                />
              </Field>
              <Field id="draft-body" label="Message" error={fieldError("body")}>
                <Textarea
                  id="draft-body"
                  name="body"
                  rows={12}
                  defaultValue={editing.body}
                  maxLength={8000}
                  required
                />
              </Field>
            </div>
          )}
        </FormDialog>
      )}

      {creating && (
        <FormDialog
          title="New draft"
          description="Write it yourself, or give the points and press Write with AI. It is kept as a draft until you send it."
          submitLabel="Save the draft"
          pendingLabel="Saving"
          errorTitle="We could not save the draft"
          className="sm:max-w-2xl"
          onClose={() => setCreating(false)}
          onSubmit={async (form) => {
            const result = await createDraftAction({
              kind: String(form.get("kind") ?? "OTHER"),
              partyId: String(form.get("partyId") ?? ""),
              toAddress: String(form.get("toAddress") ?? ""),
              subject: String(form.get("subject") ?? ""),
              body: String(form.get("body") ?? ""),
              byAi: words?.byAi ?? false,
            });
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: "The draft is saved in Waiting." });
            setCreating(false);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="new-kind" label="Kind" error={fieldError("kind")}>
                  <NativeSelect
                    id="new-kind"
                    name="kind"
                    defaultValue="BUYER_FOLLOW_UP"
                    containerClassName="sm:w-full"
                  >
                    {DRAFT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {DRAFT_KIND_LABELS[k]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="new-party" label="For" error={fieldError("partyId")}>
                  <NativeSelect
                    id="new-party"
                    name="partyId"
                    defaultValue=""
                    containerClassName="sm:w-full"
                  >
                    <option value="">Nobody chosen</option>
                    {d.parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <Field
                id="new-to"
                label="To (email)"
                hint="Empty: the party's own email."
                error={fieldError("toAddress")}
              >
                <Input id="new-to" name="toAddress" type="email" />
              </Field>
              <Field
                id="new-about"
                label="About"
                hint="The order or the matter, for Write with AI."
              >
                <Input id="new-about" name="about" maxLength={300} />
              </Field>
              <Field id="new-points" label="Your points" hint="One per line, for Write with AI.">
                <Textarea id="new-points" name="points" rows={3} maxLength={3000} />
              </Field>
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={(e) => {
                    const form = e.currentTarget.form;
                    if (!form) return;
                    const data = new FormData(form);
                    startTransition(async () => {
                      const result = await writeDraftWithAiAction({
                        kind: String(data.get("kind") ?? "OTHER"),
                        partyId: String(data.get("partyId") ?? ""),
                        about: String(data.get("about") ?? ""),
                        points: String(data.get("points") ?? ""),
                      });
                      if (result.ok) {
                        setWords(result.data);
                        setAiError(undefined);
                      } else setAiError(result.error.message);
                    });
                  }}
                >
                  <SparklesIcon aria-hidden />
                  Write with AI
                </Button>
                {aiError && <p className="mt-2 text-[0.8125rem] text-destructive">{aiError}</p>}
              </div>
              <Field id="new-subject" label="Subject" error={fieldError("subject")}>
                <Input
                  key={`s-${words?.subject ?? ""}`}
                  id="new-subject"
                  name="subject"
                  defaultValue={words?.subject ?? ""}
                  maxLength={200}
                  required
                />
              </Field>
              <Field id="new-body" label="Message" error={fieldError("body")}>
                <Textarea
                  key={`b-${words?.body.length ?? 0}`}
                  id="new-body"
                  name="body"
                  rows={10}
                  defaultValue={words?.body ?? ""}
                  maxLength={8000}
                  required
                />
              </Field>
            </div>
          )}
        </FormDialog>
      )}

      {following && (
        <FormDialog
          title="Set a follow-up"
          description="On the day, a follow-up draft is made for you and you are reminded. Nothing goes to the buyer until you send it."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not save the follow-up"
          onClose={() => setFollowing(false)}
          onSubmit={async (form) => {
            const result = await setFollowUpAction({
              partyId: String(form.get("partyId") ?? ""),
              dueOn: String(form.get("dueOn") ?? ""),
              recordLabel: String(form.get("recordLabel") ?? ""),
              note: String(form.get("note") ?? ""),
            });
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: "The follow-up is set." });
            setFollowing(false);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              <Field id="fu-party" label="Buyer" error={fieldError("partyId")}>
                <NativeSelect
                  id="fu-party"
                  name="partyId"
                  defaultValue=""
                  containerClassName="sm:w-full"
                  required
                >
                  <option value="">Pick the buyer</option>
                  {d.parties
                    .filter((p) => p.buyer)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field id="fu-day" label="Day" error={fieldError("dueOn")}>
                <Input id="fu-day" name="dueOn" type="date" required />
              </Field>
              <Field
                id="fu-order"
                label="Order"
                hint="As you name it: PO 4501."
                error={fieldError("recordLabel")}
              >
                <Input id="fu-order" name="recordLabel" maxLength={200} />
              </Field>
              <Field id="fu-note" label="Note" error={fieldError("note")}>
                <Textarea id="fu-note" name="note" rows={2} maxLength={1000} />
              </Field>
            </div>
          )}
        </FormDialog>
      )}
    </div>
  );
}
