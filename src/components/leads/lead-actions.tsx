"use client";

import {
  ArchiveIcon,
  CalendarClockIcon,
  FileTextIcon,
  FileUpIcon,
  FlagIcon,
  MailIcon,
  MessageCircleIcon,
  NotebookPenIcon,
  PackageIcon,
  PencilIcon,
  UserPlusIcon,
  UserRoundCheckIcon,
  UsersIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { usePinPrompt } from "@/components/ai/pin-prompt";
import { Field, FormAlert } from "@/components/forms/field";
import { readAmount, textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/result";
import type { LeadDetail } from "@/modules/leads/lead.service";
import {
  CATEGORY_LABELS,
  NEXT_KIND_LABELS,
  PAYMENT_LABELS,
  SAMPLE_STATUS_LABELS,
  STAGE_LABELS,
  STAGE_ORDER,
} from "@/modules/leads/labels";
import { whatsappLink } from "@/modules/parties/contact";
import {
  addLeadContactAction,
  addLeadFileAction,
  addLeadSampleAction,
  assignLeadAction,
  changeLeadStageAction,
  editLeadAction,
  eraseLeadContactAction,
  logLeadActivityAction,
  logMessageSentAction,
  makeBuyerAction,
  setLeadArchivedAction,
  setNextStepAction,
  updateLeadContactAction,
  updateLeadSampleAction,
} from "@/server/actions/leads.actions";

/*
 * What can be done on Lead 360. Every change is a new line in the lead's
 * history (it is never edited or deleted). The email and WhatsApp buttons open
 * the person's own mail app or WhatsApp with the text filled in; the ERP sends
 * nothing itself, and "I sent it" logs it.
 */

type Contact = LeadDetail["contacts"][number];
type Sample = LeadDetail["samples"][number];
type Dialog =
  | { kind: "log" }
  | { kind: "next" }
  | { kind: "stage" }
  | { kind: "assign" }
  | { kind: "sample" }
  | { kind: "sampleUpdate"; sample: Sample }
  | { kind: "contact" }
  | { kind: "contactEdit"; contact: Contact }
  | { kind: "erase"; contact: Contact }
  | { kind: "edit" }
  | { kind: "sent"; channel: "EMAIL" | "WHATSAPP"; contact: Contact; subject?: string };

const LOG_KINDS = [
  ["CALL", "Call"],
  ["MEETING", "Meeting"],
  ["FAIR_MEETING", "Met at a fair"],
  ["EMAIL_OUT", "Email sent"],
  ["EMAIL_IN", "Email received"],
  ["WHATSAPP", "WhatsApp"],
  ["NOTE", "Note"],
] as const;

const optional = (form: FormData, name: string) => textOf(form, name) || null;

/** The text the email and WhatsApp buttons start with (the person changes it in their own app). */
export function messageText(lead: LeadDetail, contact: Contact, me: string) {
  const first = contact.name.split(" ")[0] ?? contact.name;
  const subject = `${lead.companyName} for ${lead.name}`;
  const body = `Dear ${first},\n\nThank you for your time. ${lead.companyName} makes ${lead.products.length ? lead.products.join(", ") : "garments"} for buyers like ${lead.name}. Could we send you our catalogue and a few samples?\n\nBest regards,\n${me}\n${lead.companyName}`;
  const whatsapp = `Hello ${first}, this is ${me} from ${lead.companyName}. Thank you for your time. Could we send you our catalogue for ${lead.name}?`;
  return { subject, body, whatsapp };
}

function useRun() {
  const router = useRouter();
  return async <T,>(result: Promise<ActionResult<T>>, close: () => void) => {
    const done = await result;
    if (!done.ok) return done.error;
    close();
    router.refresh();
    return undefined;
  };
}

/** The buttons at the top of Lead 360 and the windows they open. */
export function LeadActions({ lead }: { lead: LeadDetail }) {
  const router = useRouter();
  const run = useRun();
  const [open, setOpen] = useState<Dialog | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const close = () => setOpen(null);
  const a = lead.access;

  function newQuotation() {
    startTransition(async () => {
      const result = await makeBuyerAction(lead.id);
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      router.push(`/sales/quotations/new?buyer=${encodeURIComponent(result.data.partyId)}`);
    });
  }

  function makeBuyer() {
    startTransition(async () => {
      const result = await makeBuyerAction(lead.id);
      if (!result.ok) setMessage(result.error.message);
      else router.refresh();
    });
  }

  function archive() {
    startTransition(async () => {
      const result = await setLeadArchivedAction(lead.id, !lead.archived);
      if (!result.ok) setMessage(result.error.message);
      else router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      {a.manage && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setOpen({ kind: "log" })} className="w-full sm:w-auto">
            <NotebookPenIcon aria-hidden />
            Log activity
          </Button>
          <Button
            variant="outline"
            onClick={() => setOpen({ kind: "next" })}
            className="w-full sm:w-auto"
          >
            <CalendarClockIcon aria-hidden />
            Set next step
          </Button>
          <Button
            variant="outline"
            onClick={() => setOpen({ kind: "stage" })}
            className="w-full sm:w-auto"
          >
            <FlagIcon aria-hidden />
            Change stage
          </Button>
          {a.assign && (
            <Button
              variant="outline"
              onClick={() => setOpen({ kind: "assign" })}
              className="w-full sm:w-auto"
            >
              <UsersIcon aria-hidden />
              Give to
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setOpen({ kind: "edit" })}
            className="w-full sm:w-auto"
          >
            <PencilIcon aria-hidden />
            Edit details
          </Button>
          {a.convert && !lead.buyer && (
            <Button
              variant="outline"
              onClick={makeBuyer}
              disabled={pending}
              className="w-full sm:w-auto"
            >
              <UserRoundCheckIcon aria-hidden />
              Make buyer
            </Button>
          )}
          {a.convert && (
            <Button
              variant="outline"
              onClick={newQuotation}
              disabled={pending}
              className="w-full sm:w-auto"
            >
              <FileTextIcon aria-hidden />
              New quotation
            </Button>
          )}
          <Button variant="ghost" onClick={archive} disabled={pending} className="w-full sm:w-auto">
            <ArchiveIcon aria-hidden />
            {lead.archived ? "Bring back" : "Archive"}
          </Button>
        </div>
      )}
      {message && <FormAlert>{message}</FormAlert>}
      {open && <LeadDialogs lead={lead} open={open} close={close} run={run} setOpen={setOpen} />}
    </div>
  );
}

/** Contacts with their email and WhatsApp buttons, and (for the owner) erasing their data. */
export function LeadContacts({ lead, me }: { lead: LeadDetail; me: string }) {
  const run = useRun();
  const [open, setOpen] = useState<Dialog | null>(null);
  const close = () => setOpen(null);
  return (
    <div className="grid gap-3">
      {lead.contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No contact person yet.</p>
      ) : (
        <ul className="grid gap-3">
          {lead.contacts.map((c) => {
            const text = messageText(lead, c, me);
            const mail = c.email
              ? `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(text.subject)}&body=${encodeURIComponent(text.body)}`
              : null;
            const wa = whatsappLink(c.whatsapp ?? c.phone, text.whatsapp);
            const blocked = c.doNotContact || c.erased;
            return (
              <li key={c.id} className="rounded-md border p-3">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 font-medium break-words">
                    {c.name}
                    {c.isPrimary && <span className="text-muted-foreground"> · Main contact</span>}
                    {c.isDecisionMaker && <span className="text-muted-foreground"> · Decides</span>}
                  </p>
                  {blocked && (
                    <span className="text-[0.8125rem] text-destructive">Do not contact</span>
                  )}
                </div>
                {!c.erased && (
                  <p className="mt-1 text-[0.8125rem] break-words text-muted-foreground">
                    {[c.jobTitle, c.email, c.phone, c.whatsapp && `WhatsApp ${c.whatsapp}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {!blocked && mail && lead.access.manage && (
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={mail}
                        onClick={() =>
                          setOpen({
                            kind: "sent",
                            channel: "EMAIL",
                            contact: c,
                            subject: text.subject,
                          })
                        }
                      >
                        <MailIcon aria-hidden />
                        Write email
                      </a>
                    </Button>
                  )}
                  {!blocked && wa && lead.access.manage && (
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={wa}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setOpen({ kind: "sent", channel: "WHATSAPP", contact: c })}
                      >
                        <MessageCircleIcon aria-hidden />
                        Open WhatsApp
                      </a>
                    </Button>
                  )}
                  {!c.erased && lead.access.manage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpen({ kind: "contactEdit", contact: c })}
                    >
                      <PencilIcon aria-hidden />
                      Edit contact
                    </Button>
                  )}
                  {!c.erased && lead.access.erase && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setOpen({ kind: "erase", contact: c })}
                    >
                      Erase personal data
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {lead.access.manage && (
        <Button
          variant="outline"
          className="w-full sm:w-auto sm:justify-self-start"
          onClick={() => setOpen({ kind: "contact" })}
        >
          <UserPlusIcon aria-hidden />
          Add contact
        </Button>
      )}
      {open && <LeadDialogs lead={lead} open={open} close={close} run={run} setOpen={setOpen} />}
    </div>
  );
}

/** Samples sent to the lead, each with "Update". */
export function LeadSamples({ lead }: { lead: LeadDetail }) {
  const run = useRun();
  const [open, setOpen] = useState<Dialog | null>(null);
  const close = () => setOpen(null);
  return (
    <div className="grid gap-3">
      {lead.samples.length === 0 ? (
        <p className="text-sm text-muted-foreground">No samples yet.</p>
      ) : (
        <ul className="grid gap-2">
          {lead.samples.map((s) => (
            <li key={s.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="min-w-0 font-medium break-words">
                  {s.description}
                  {s.quantity ? ` · ${s.quantity} pcs` : ""}
                </p>
                <span className="text-muted-foreground">{SAMPLE_STATUS_LABELS[s.status]}</span>
              </div>
              <p className="mt-1 text-[0.8125rem] break-words text-muted-foreground">
                {[
                  s.sentOn && `Sent ${s.sentOn}`,
                  s.courier,
                  s.trackingNo && `Tracking ${s.trackingNo}`,
                  s.feedback && `Feedback: ${s.feedback}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {lead.access.manage && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1"
                  onClick={() => setOpen({ kind: "sampleUpdate", sample: s })}
                >
                  Update
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {lead.access.manage && (
        <Button
          variant="outline"
          className="w-full sm:w-auto sm:justify-self-start"
          onClick={() => setOpen({ kind: "sample" })}
        >
          <PackageIcon aria-hidden />
          Add sample
        </Button>
      )}
      {open && <LeadDialogs lead={lead} open={open} close={close} run={run} setOpen={setOpen} />}
    </div>
  );
}

/** Files kept on the lead, and "Add file" (a photo or a PDF). */
export function LeadFiles({ lead }: { lead: LeadDetail }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  return (
    <div className="grid gap-3">
      {lead.files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {lead.files.map((f) => (
            <li key={f.id} className="break-words">
              <a
                href={`/api/files/${encodeURIComponent(f.fileId)}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {f.fileName}
              </a>{" "}
              <span className="text-muted-foreground">
                {f.sizeKb} KB · {f.addedOn}
              </span>
            </li>
          ))}
        </ul>
      )}
      {lead.access.manage && (
        <>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            aria-label="Add file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.set("file", file);
              startTransition(async () => {
                const result = await addLeadFileAction(lead.id, form);
                setMessage(result.ok ? undefined : result.error.message);
                if (result.ok) router.refresh();
                if (input.current) input.current.value = "";
              });
            }}
          />
          <Button
            variant="outline"
            className="w-full sm:w-auto sm:justify-self-start"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            <FileUpIcon aria-hidden />
            Add file
          </Button>
        </>
      )}
      {message && <FormAlert>{message}</FormAlert>}
    </div>
  );
}

function ContactFields({
  fieldError,
  contact,
}: {
  fieldError: (name: string) => string | undefined;
  contact?: Contact;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="contact-name" label="Contact name" error={fieldError("name")}>
        <Input id="contact-name" name="name" defaultValue={contact?.name ?? ""} />
      </Field>
      <Field id="contact-title" label="Job title">
        <Input id="contact-title" name="jobTitle" defaultValue={contact?.jobTitle ?? ""} />
      </Field>
      <Field id="contact-email" label="Email" error={fieldError("email")}>
        <Input id="contact-email" name="email" type="email" defaultValue={contact?.email ?? ""} />
      </Field>
      <Field id="contact-phone" label="Phone" error={fieldError("phone")}>
        <Input id="contact-phone" name="phone" type="tel" defaultValue={contact?.phone ?? ""} />
      </Field>
      <Field id="contact-whatsapp" label="WhatsApp" error={fieldError("whatsapp")}>
        <Input
          id="contact-whatsapp"
          name="whatsapp"
          type="tel"
          defaultValue={contact?.whatsapp ?? ""}
        />
      </Field>
      <div className="grid content-end gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isDecisionMaker" defaultChecked={contact?.isDecisionMaker} />
          This person decides
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isPrimary" defaultChecked={contact?.isPrimary} />
          Main contact
        </label>
        {contact && (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="doNotContact" defaultChecked={contact.doNotContact} />
            Do not contact
          </label>
        )}
      </div>
    </div>
  );
}

const contactInput = (form: FormData) => ({
  name: textOf(form, "name"),
  jobTitle: optional(form, "jobTitle"),
  email: optional(form, "email"),
  phone: optional(form, "phone"),
  whatsapp: optional(form, "whatsapp"),
  isDecisionMaker: form.get("isDecisionMaker") === "on",
  isPrimary: form.get("isPrimary") === "on",
});

function SampleFields({
  fieldError,
  sample,
}: {
  fieldError: (name: string) => string | undefined;
  sample?: Sample;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="sample-what" label="What sample" error={fieldError("description")}>
        <Input
          id="sample-what"
          name="description"
          defaultValue={sample?.description ?? ""}
          placeholder="Polo, navy, size M"
        />
      </Field>
      <Field id="sample-qty" label="Pieces" error={fieldError("quantity")}>
        <Input
          id="sample-qty"
          name="quantity"
          inputMode="numeric"
          defaultValue={sample?.quantity ?? ""}
        />
      </Field>
      <Field id="sample-status" label="Sample status">
        <NativeSelect
          id="sample-status"
          name="status"
          defaultValue={sample?.status ?? "REQUESTED"}
          containerClassName="sm:w-full"
        >
          {Object.entries(SAMPLE_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="sample-sent" label="Sent on" error={fieldError("sentOn")}>
        <Input id="sample-sent" name="sentOn" type="date" defaultValue={sample?.sentOn ?? ""} />
      </Field>
      <Field id="sample-courier" label="Courier">
        <Input id="sample-courier" name="courier" defaultValue={sample?.courier ?? ""} />
      </Field>
      <Field id="sample-tracking" label="Tracking number">
        <Input id="sample-tracking" name="trackingNo" defaultValue={sample?.trackingNo ?? ""} />
      </Field>
      <Field id="sample-feedback" label="Their feedback" className="sm:col-span-2">
        <Textarea id="sample-feedback" name="feedback" defaultValue={sample?.feedback ?? ""} />
      </Field>
    </div>
  );
}

const sampleInput = (form: FormData) => {
  const qty = Number(textOf(form, "quantity"));
  return {
    description: textOf(form, "description"),
    quantity: textOf(form, "quantity") && Number.isInteger(qty) && qty > 0 ? qty : null,
    status: textOf(form, "status") || "REQUESTED",
    courier: optional(form, "courier"),
    trackingNo: optional(form, "trackingNo"),
    sentOn: optional(form, "sentOn"),
    feedback: optional(form, "feedback"),
  };
};

function LeadDialogs({
  lead,
  open,
  close,
  run,
  setOpen,
}: {
  lead: LeadDetail;
  open: Dialog;
  close: () => void;
  run: ReturnType<typeof useRun>;
  setOpen: (d: Dialog | null) => void;
}) {
  const { withPin, dialog: pinDialog } = usePinPrompt();
  const router = useRouter();
  void setOpen;
  switch (open.kind) {
    case "log":
      return (
        <FormDialog
          title="Log activity"
          description="A call, a meeting, an email or a note. It is added to the history, which nobody can change or delete; to correct it, log a new note."
          submitLabel="Add to history"
          pendingLabel="Adding"
          errorTitle="We could not log it"
          onClose={close}
          onSubmit={(form) =>
            run(
              logLeadActivityAction(lead.id, {
                kind: textOf(form, "kind"),
                summary: textOf(form, "summary"),
                body: optional(form, "body"),
                contactId: optional(form, "contactId"),
                occurredOn: optional(form, "occurredOn"),
              }),
              close,
            )
          }
        >
          {(fieldError) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="log-kind" label="What happened">
                <NativeSelect
                  id="log-kind"
                  name="kind"
                  defaultValue="CALL"
                  containerClassName="sm:w-full"
                >
                  {LOG_KINDS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="log-on" label="On" error={fieldError("occurredOn")}>
                <Input
                  id="log-on"
                  name="occurredOn"
                  type="date"
                  defaultValue={lead.today}
                  max={lead.today}
                />
              </Field>
              <Field id="log-contact" label="With">
                <NativeSelect id="log-contact" name="contactId" containerClassName="sm:w-full">
                  <option value="">Nobody in particular</option>
                  {lead.contacts
                    .filter((c) => !c.erased)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field
                id="log-summary"
                label="Summary"
                error={fieldError("summary")}
                className="sm:col-span-2"
              >
                <Input id="log-summary" name="summary" placeholder="Talked about polo prices" />
              </Field>
              <Field id="log-body" label="Details" className="sm:col-span-2">
                <Textarea id="log-body" name="body" />
              </Field>
            </div>
          )}
        </FormDialog>
      );
    case "next":
      return (
        <FormDialog
          title="Set next step"
          description="What to do next and on which day. The person who follows the lead up is reminded in the inbox a day before and on the day."
          submitLabel="Save the next step"
          pendingLabel="Saving"
          errorTitle="We could not save the next step"
          onClose={close}
          onSubmit={(form) =>
            run(
              setNextStepAction(lead.id, {
                nextActionKind: textOf(form, "nextActionKind"),
                nextActionOn: textOf(form, "nextActionOn"),
                nextActionNote: optional(form, "nextActionNote"),
              }),
              close,
            )
          }
        >
          {(fieldError) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="next-kind" label="Next step">
                <NativeSelect
                  id="next-kind"
                  name="nextActionKind"
                  defaultValue={lead.nextActionKind ?? "EMAIL"}
                  containerClassName="sm:w-full"
                >
                  {Object.entries(NEXT_KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="next-on" label="Next step on" error={fieldError("nextActionOn")}>
                <Input
                  id="next-on"
                  name="nextActionOn"
                  type="date"
                  defaultValue={lead.nextActionOn ?? lead.today}
                />
              </Field>
              <Field id="next-note" label="Next step note" className="sm:col-span-2">
                <Input
                  id="next-note"
                  name="nextActionNote"
                  defaultValue={lead.nextActionNote ?? ""}
                />
              </Field>
            </div>
          )}
        </FormDialog>
      );
    case "stage":
      return (
        <FormDialog
          title="Change stage"
          description="Lost needs a reason (price, no reply, minimum quantity, chose another supplier). Nurture puts the lead on hold until the day you pick."
          submitLabel="Change stage"
          pendingLabel="Changing"
          errorTitle="We could not change the stage"
          onClose={close}
          onSubmit={(form) =>
            run(
              changeLeadStageAction(lead.id, {
                stage: textOf(form, "stage"),
                reason: optional(form, "reason"),
                lookAgainOn: optional(form, "lookAgainOn"),
              }),
              close,
            )
          }
        >
          {(fieldError) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="stage-to" label="Stage">
                <NativeSelect
                  id="stage-to"
                  name="stage"
                  defaultValue={lead.stage}
                  containerClassName="sm:w-full"
                >
                  {STAGE_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="stage-again" label="Look again on" error={fieldError("lookAgainOn")}>
                <Input id="stage-again" name="lookAgainOn" type="date" />
              </Field>
              <Field
                id="stage-reason"
                label="Why lost"
                error={fieldError("reason")}
                className="sm:col-span-2"
              >
                <Input id="stage-reason" name="reason" placeholder="Price, no reply, MOQ…" />
              </Field>
            </div>
          )}
        </FormDialog>
      );
    case "assign":
      return (
        <FormDialog
          title="Give to"
          description="Who follows this lead up. They see it in their list and get its reminders."
          submitLabel="Give the lead"
          pendingLabel="Giving"
          errorTitle="We could not give the lead"
          onClose={close}
          onSubmit={(form) =>
            run(assignLeadAction(lead.id, { ownerUserId: optional(form, "ownerUserId") }), close)
          }
        >
          {(fieldError) => (
            <Field id="assign-to" label="Followed by" error={fieldError("ownerUserId")}>
              <NativeSelect
                id="assign-to"
                name="ownerUserId"
                defaultValue={lead.owner?.id ?? ""}
                containerClassName="sm:w-full"
              >
                <option value="">Nobody yet</option>
                {lead.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </FormDialog>
      );
    case "edit":
      return (
        <FormDialog
          title="Edit details"
          description="The company's details. The history notes what changed."
          submitLabel="Save the details"
          pendingLabel="Saving"
          errorTitle="We could not save the details"
          className="sm:max-w-2xl"
          onClose={close}
          onSubmit={(form) => {
            const amount = (name: string) => {
              const v = readAmount(textOf(form, name));
              return v === "invalid" ? "invalid" : v;
            };
            const price = amount("targetPrice");
            const value = amount("expectedValue");
            if (price === "invalid" || value === "invalid") {
              return Promise.resolve(
                problem({
                  ...(price === "invalid" ? { targetPrice: "Enter an amount like 4.50" } : {}),
                  ...(value === "invalid" ? { expectedValue: "Enter an amount like 120000" } : {}),
                }),
              );
            }
            const pieces = Number(textOf(form, "piecesPerStyle"));
            return run(
              editLeadAction(lead.id, {
                name: textOf(form, "name"),
                website: optional(form, "website"),
                country: optional(form, "country"),
                city: optional(form, "city"),
                category: textOf(form, "category"),
                products: textOf(form, "products")
                  .split(",")
                  .map((w) => w.trim())
                  .filter(Boolean),
                piecesPerStyle:
                  textOf(form, "piecesPerStyle") && Number.isInteger(pieces) && pieces > 0
                    ? pieces
                    : null,
                targetPrice: price,
                expectedValue: value,
                paymentTerms: optional(form, "paymentTerms"),
                sourceId: optional(form, "sourceId"),
                sourceNote: optional(form, "sourceNote"),
                doNotContact: form.get("doNotContact") === "on",
              }),
              close,
            );
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="edit-name" label="Company name" error={fieldError("name")}>
                <Input id="edit-name" name="name" defaultValue={lead.name} />
              </Field>
              <Field id="edit-website" label="Website">
                <Input id="edit-website" name="website" defaultValue={lead.website ?? ""} />
              </Field>
              <Field id="edit-country" label="Country">
                <Input id="edit-country" name="country" defaultValue={lead.country ?? ""} />
              </Field>
              <Field id="edit-city" label="City">
                <Input id="edit-city" name="city" defaultValue={lead.city ?? ""} />
              </Field>
              <Field id="edit-category" label="Kind of company">
                <NativeSelect
                  id="edit-category"
                  name="category"
                  defaultValue={lead.category}
                  containerClassName="sm:w-full"
                >
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="edit-products" label="Products they want">
                <Input id="edit-products" name="products" defaultValue={lead.products.join(", ")} />
              </Field>
              <Field id="edit-pieces" label="Pieces per style" error={fieldError("piecesPerStyle")}>
                <Input
                  id="edit-pieces"
                  name="piecesPerStyle"
                  inputMode="numeric"
                  defaultValue={lead.piecesPerStyle ?? ""}
                />
              </Field>
              <Field
                id="edit-price"
                label={`Their price per piece (${lead.currency})`}
                error={fieldError("targetPrice")}
              >
                <Input
                  id="edit-price"
                  name="targetPrice"
                  inputMode="decimal"
                  defaultValue={lead.targetPrice ?? ""}
                />
              </Field>
              <Field
                id="edit-value"
                label={`Expected value (${lead.currency})`}
                error={fieldError("expectedValue")}
              >
                <Input
                  id="edit-value"
                  name="expectedValue"
                  inputMode="decimal"
                  defaultValue={lead.expectedValue ?? ""}
                />
              </Field>
              <Field id="edit-payment" label="How they would pay">
                <NativeSelect
                  id="edit-payment"
                  name="paymentTerms"
                  defaultValue={lead.paymentTerms ?? ""}
                  containerClassName="sm:w-full"
                >
                  <option value="">Not known yet</option>
                  {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="edit-source" label="Source">
                <NativeSelect
                  id="edit-source"
                  name="sourceId"
                  defaultValue={lead.source?.id ?? ""}
                  containerClassName="sm:w-full"
                >
                  <option value="">Not set</option>
                  {lead.sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="edit-source-note" label="Source note">
                <Input
                  id="edit-source-note"
                  name="sourceNote"
                  defaultValue={lead.sourceNote ?? ""}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="doNotContact" defaultChecked={lead.doNotContact} />
                Nobody at this company is to be contacted
              </label>
            </div>
          )}
        </FormDialog>
      );
    case "contact":
      return (
        <FormDialog
          title="Add contact"
          description="Another person at this company. If their email or phone is on “Do not contact”, they are kept but never offered for email or WhatsApp."
          submitLabel="Add the contact"
          pendingLabel="Adding"
          errorTitle="We could not add the contact"
          onClose={close}
          onSubmit={(form) => run(addLeadContactAction(lead.id, contactInput(form)), close)}
        >
          {(fieldError) => <ContactFields fieldError={fieldError} />}
        </FormDialog>
      );
    case "contactEdit":
      return (
        <FormDialog
          title="Edit contact"
          description="A contact on “Do not contact” stays there."
          submitLabel="Save the contact"
          pendingLabel="Saving"
          errorTitle="We could not save the contact"
          onClose={close}
          onSubmit={(form) =>
            run(
              updateLeadContactAction(lead.id, open.contact.id, {
                ...contactInput(form),
                doNotContact: form.get("doNotContact") === "on",
              }),
              close,
            )
          }
        >
          {(fieldError) => <ContactFields fieldError={fieldError} contact={open.contact} />}
        </FormDialog>
      );
    case "erase":
      return (
        <>
          <FormDialog
            title="Erase personal data"
            description={`${open.contact.name}'s name, job title, email and phones are blanked for good. Their email and phone stay on “Do not contact” as a code, so nobody contacts them again. The lead and its history stay; no money or stock is touched. It needs your PIN.`}
            submitLabel="Erase for good"
            pendingLabel="Erasing"
            destructive
            errorTitle="We could not erase the data"
            onClose={close}
            onSubmit={(form) =>
              withPin((pin) =>
                eraseLeadContactAction(lead.id, open.contact.id, {
                  pin,
                  reason: optional(form, "reason"),
                }),
              ).then((result) => {
                if (!result.ok) return result.error;
                close();
                router.refresh();
                return undefined;
              })
            }
          >
            {() => (
              <Field
                id="erase-reason"
                label="Why"
                hint="Kept in the activity log, without the person's details."
              >
                <Input id="erase-reason" name="reason" placeholder="They asked us to" />
              </Field>
            )}
          </FormDialog>
          {pinDialog}
        </>
      );
    case "sample":
      return (
        <FormDialog
          title="Add sample"
          description="A sample for this lead. Courier or making costs are recorded in Expenses; nothing here moves money."
          submitLabel="Add the sample"
          pendingLabel="Adding"
          errorTitle="We could not add the sample"
          className="sm:max-w-2xl"
          onClose={close}
          onSubmit={(form) => run(addLeadSampleAction(lead.id, sampleInput(form)), close)}
        >
          {(fieldError) => <SampleFields fieldError={fieldError} />}
        </FormDialog>
      );
    case "sampleUpdate":
      return (
        <FormDialog
          title="Update sample"
          description="Its status, courier, tracking number and the buyer's feedback."
          submitLabel="Save the sample"
          pendingLabel="Saving"
          errorTitle="We could not save the sample"
          className="sm:max-w-2xl"
          onClose={close}
          onSubmit={(form) =>
            run(updateLeadSampleAction(lead.id, open.sample.id, sampleInput(form)), close)
          }
        >
          {(fieldError) => <SampleFields fieldError={fieldError} sample={open.sample} />}
        </FormDialog>
      );
    case "sent":
      return (
        <FormDialog
          title={open.channel === "EMAIL" ? "Did you send the email?" : "Did you send the message?"}
          description="Your own mail app or WhatsApp opened with the text filled in; the ERP sent nothing. Once you have sent it, log it here."
          submitLabel="I sent it"
          pendingLabel="Logging"
          errorTitle="We could not log it"
          onClose={close}
          onSubmit={() =>
            run(
              logMessageSentAction(lead.id, {
                channel: open.channel,
                contactId: open.contact.id,
                subject: open.subject,
              }),
              close,
            )
          }
        >
          {() => null}
        </FormDialog>
      );
  }
}
