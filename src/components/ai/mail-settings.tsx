"use client";

import { MailIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { useDay } from "@/components/ai/when";
import { Field, FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { MailSettingsScreen } from "@/modules/mail/mail.service";
import {
  removeMailSettingsAction,
  saveMailSettingsAction,
  sendTestMailAction,
  setReplyRemindHoursAction,
} from "@/server/actions/mehedi.actions";

/*
 * AI Center > Settings, the email part (ai.manage): the company's mailbox that
 * drafts are sent from when the owner presses Send (the password is kept
 * locked and never shown), a test email, and after how many hours an unsent
 * buyer draft reminds the owner.
 */

export function MailSettings({
  mail: m,
  replyRemindHours,
}: {
  mail: MailSettingsScreen;
  replyRemindHours: number;
}) {
  const day = useDay();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"mail" | "hours" | null>(null);
  const [secure, setSecure] = useState(m.own?.secure ?? false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();

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
        title="Email for sending"
        id="ai-mail-heading"
        action={
          <Button type="button" size="sm" onClick={() => setDialog("mail")}>
            <MailIcon aria-hidden />
            {m.own ? "Change the email" : "Add the email"}
          </Button>
        }
      >
        <div className="mt-2 grid gap-2 text-sm">
          {m.own ? (
            <>
              <p>
                Drafts go from <span className="font-medium">{m.own.fromAddress}</span> through{" "}
                {m.own.host}:{m.own.port}
                {m.own.username ? `, signed in as ${m.own.username}` : ""}.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={m.own.testedAt ? "done" : "warn"}>
                  {m.own.testedAt ? `Tested ${day(m.own.testedAt)}` : "Not tested yet"}
                </StatusBadge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(() => sendTestMailAction(), "A test email is on its way to you.")
                  }
                >
                  Send a test email
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(() => removeMailSettingsAction(), "The email for sending is removed.")
                  }
                >
                  Remove
                </Button>
              </div>
            </>
          ) : m.server ? (
            <p>
              The server&apos;s email ({m.server.fromAddress}) is used until you add the
              company&apos;s own.
            </p>
          ) : (
            <p className="text-muted-foreground">
              No email yet: drafts can be written but not sent. Add the company&apos;s mailbox to
              send them.
            </p>
          )}
          <p className="text-[0.8125rem] text-muted-foreground">
            For Gmail: turn on 2-Step Verification, make an App password (Google Account &gt;
            Security &gt; App passwords) and use smtp.gmail.com, port 587, your Gmail address and
            that App password.
          </p>
        </div>
      </Panel>

      <Panel
        title="Reminder for unsent buyer drafts"
        id="ai-remind-heading"
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => setDialog("hours")}>
            Change
          </Button>
        }
      >
        <p className="mt-2 text-sm">
          A draft for a buyer that is still not sent after{" "}
          <span className="font-medium">{replyRemindHours} hours</span> reminds you once in the
          inbox.
        </p>
      </Panel>

      {dialog === "mail" && (
        <FormDialog
          title={m.own ? "Change the email for sending" : "Add the email for sending"}
          description="The mailbox drafts are sent from when you press Send. The password is locked before it is saved and never shown again."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not save the email"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            const result = await saveMailSettingsAction({
              host: String(form.get("host") ?? ""),
              port: String(form.get("port") ?? ""),
              secure,
              username: String(form.get("username") ?? ""),
              password: String(form.get("password") ?? ""),
              fromAddress: String(form.get("fromAddress") ?? ""),
              fromName: String(form.get("fromName") ?? ""),
            });
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: "Saved. Send a test email to check it." });
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <Field id="mail-host" label="Mail server" error={fieldError("host")}>
                  <Input
                    id="mail-host"
                    name="host"
                    defaultValue={m.own?.host ?? "smtp.gmail.com"}
                    required
                  />
                </Field>
                <Field id="mail-port" label="Port" error={fieldError("port")}>
                  <Input
                    id="mail-port"
                    name="port"
                    inputMode="numeric"
                    defaultValue={m.own?.port ?? 587}
                    required
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={secure} onCheckedChange={(on) => setSecure(on === true)} />
                Secure connection from the start (port 465)
              </label>
              <Field id="mail-user" label="Sign-in name" error={fieldError("username")}>
                <Input
                  id="mail-user"
                  name="username"
                  autoComplete="off"
                  defaultValue={m.own?.username ?? ""}
                />
              </Field>
              <Field
                id="mail-password"
                label="Password"
                hint={m.own?.hasPassword ? "Empty keeps the saved password." : undefined}
                error={fieldError("password")}
              >
                <Input
                  id="mail-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                />
              </Field>
              <Field id="mail-from" label="From address" error={fieldError("fromAddress")}>
                <Input
                  id="mail-from"
                  name="fromAddress"
                  type="email"
                  defaultValue={m.own?.fromAddress ?? ""}
                  required
                />
              </Field>
              <Field id="mail-from-name" label="From name" error={fieldError("fromName")}>
                <Input
                  id="mail-from-name"
                  name="fromName"
                  defaultValue={m.own?.fromName ?? ""}
                  maxLength={100}
                />
              </Field>
            </div>
          )}
        </FormDialog>
      )}

      {dialog === "hours" && (
        <FormDialog
          title="Reminder for unsent buyer drafts"
          description="After how many hours an unsent draft for a buyer reminds you."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not save the reminder"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            const result = await setReplyRemindHoursAction({
              hours: String(form.get("hours") ?? ""),
            });
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: "The reminder is saved." });
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <Field id="remind-hours" label="Hours" error={fieldError("hours")}>
              <Input
                id="remind-hours"
                name="hours"
                inputMode="numeric"
                defaultValue={replyRemindHours}
                required
              />
            </Field>
          )}
        </FormDialog>
      )}
    </div>
  );
}
