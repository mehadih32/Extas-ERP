"use client";

import {
  CloudIcon,
  CopyIcon,
  DatabaseBackupIcon,
  FlaskConicalIcon,
  KeyRoundIcon,
  RotateCcwIcon,
  ServerIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import { PinField } from "@/components/ai/pin-prompt";
import { useWhen } from "@/components/ai/when";
import { Field, FormAlert } from "@/components/forms/field";
import { type Tone, StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { getBackupOverview, presentRun } from "@/modules/backups/backup.service";
import type { DriveBackup } from "@/modules/backups/drive-copies";
import {
  checkGoogleSignInAction,
  confirmRecoveryKeyAction,
  disconnectGoogleDriveAction,
  listDriveBackupsAction,
  makeRecoveryKeyAction,
  requestRestoreAction,
  restoreStatusAction,
  runBackupNowAction,
  setGoogleClientAction,
  showRestoreCommandAction,
  startGoogleSignInAction,
  testRestoreNowAction,
  updateBackupConfigAction,
} from "@/server/actions/backups.actions";

/*
 * Settings > Backups (the platform owner only): every day's backup is locked
 * with the owner's recovery key and kept in their Google Drive; the server's
 * copy goes once Google's copy is checked. Connect Drive with a code on the
 * phone, set the time and how many to keep, back up now, see the backups in
 * Drive, test a restore, restore one, and the one command for a new server.
 */

type Overview = Awaited<ReturnType<typeof getBackupOverview>>;
type Run = ReturnType<typeof presentRun>;
type Message = { tone: "success" | "error" | "note"; text: string };

const STATUS: Record<string, { text: string; tone: Tone }> = {
  QUEUED: { text: "Waiting", tone: "open" },
  RUNNING: { text: "Running", tone: "open" },
  SUCCEEDED: { text: "Done", tone: "done" },
  FAILED: { text: "Failed", tone: "warn" },
};

const KIND: Record<string, string> = {
  BACKUP: "Daily backup",
  SAFETY_COPY: "Update safety copy",
  TEST_RESTORE: "Test restore",
  RESTORE: "Restore",
};

export function size(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function BackupsScreen({ overview }: { overview: Overview }) {
  const when = useWhen({ year: true });
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message>();
  const { config } = overview;

  const run = (work: () => Promise<{ ok: boolean; error?: { message: string } }>, done: string) =>
    startTransition(async () => {
      const result = await work();
      setMessage(
        result.ok
          ? { tone: "success", text: done }
          : { tone: "error", text: result.error!.message },
      );
    });

  const notReady = !config.recoveryKey.made
    ? "Make the recovery key: backups are locked with it before they go to Google Drive. Until then they stay on this server only."
    : !config.googleDrive.connected
      ? "Connect Google Drive: until then backups stay on this server only, and are lost with it."
      : null;

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
      {notReady && (
        <FormAlert tone="error">
          <span className="font-medium">Backups are not safe yet.</span> {notReady}
        </FormAlert>
      )}
      {config.recoveryKey.made && !config.recoveryKey.savedAt && (
        <FormAlert tone="error">
          Confirm you wrote down the recovery key (below). Without it a backup cannot be opened on a
          new server.
        </FormAlert>
      )}

      <Panel
        title="Backups"
        id="backups-heading"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  runBackupNowAction,
                  "Backing up now. It takes a few minutes; this page shows it when it is done.",
                )
              }
            >
              <DatabaseBackupIcon aria-hidden />
              Back up now
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || !config.googleDrive.connected || !config.recoveryKey.made}
              onClick={() =>
                run(
                  testRestoreNowAction,
                  "Testing a restore into a temporary database. The result comes to your inbox and the bot.",
                )
              }
            >
              <FlaskConicalIcon aria-hidden />
              Test a restore now
            </Button>
          </div>
        }
      >
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Fact label="Last backup">
            {overview.lastRun ? <RunLine run={overview.lastRun} when={when} /> : "None yet"}
          </Fact>
          <Fact label="Next backup">
            {config.nextRunAt ? when(config.nextRunAt) : "Daily backups are off"}
          </Fact>
          <Fact label="Last test restore">
            {overview.lastTestRestore ? (
              <RunLine run={overview.lastTestRestore} when={when} />
            ) : (
              "None yet"
            )}
          </Fact>
          <Fact label="On this server, not yet in Drive">
            {overview.notSent === 0
              ? "Nothing"
              : `${overview.notSent} (sent again within the hour)`}
          </Fact>
        </dl>
      </Panel>

      <DrivePanel
        config={config}
        pending={pending}
        startTransition={startTransition}
        setMessage={setMessage}
      />
      <RecoveryKeyPanel config={config} setMessage={setMessage} />
      <SchedulePanel config={config} setMessage={setMessage} />
      <DriveBackupsPanel ready={!notReady} setMessage={setMessage} />
      <NewServerPanel setMessage={setMessage} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function RunLine({ run, when }: { run: Run; when: (d: Date | string) => string }) {
  const status = STATUS[run.status] ?? { text: run.status, tone: "plain" as Tone };
  return (
    <span className="grid gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span>{when(run.startedAt)}</span>
        <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
        {run.checkedAt && <StatusBadge tone="done">Checked in Drive</StatusBadge>}
        {run.sizeBytes ? (
          <span className="text-muted-foreground">{size(run.sizeBytes)}</span>
        ) : null}
      </span>
      {(run.error || run.driveError) && (
        <span className="text-xs text-destructive">{run.error ?? run.driveError}</span>
      )}
    </span>
  );
}

type PanelProps = {
  config: Overview["config"];
  setMessage: (m: Message | undefined) => void;
};

function DrivePanel({
  config,
  pending,
  startTransition,
  setMessage,
}: PanelProps & { pending: boolean; startTransition: React.TransitionStartFunction }) {
  const [code, setCode] = useState<{
    userCode: string;
    verificationUrl: string;
    interval: number;
  } | null>(null);
  const [editing, setEditing] = useState(!config.googleDrive.available);

  // While a code is shown, ask every few seconds whether the owner said yes on their phone.
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(
      async () => {
        const result = await checkGoogleSignInAction();
        if (!result.ok) {
          setCode(null);
          setMessage({ tone: "error", text: result.error.message });
          return;
        }
        if (result.data.status === "waiting") return;
        setCode(null);
        setMessage(
          result.data.status === "connected"
            ? {
                tone: "success",
                text: `Google Drive is connected${result.data.config.googleDrive.account ? ` (${result.data.config.googleDrive.account})` : ""}.`,
              }
            : {
                tone: "error",
                text:
                  result.data.status === "denied"
                    ? "Google Drive access was not given."
                    : "The code ran out; press Connect Google Drive again.",
              },
        );
      },
      Math.max(code.interval, 3) * 1000,
    );
    return () => clearInterval(timer);
  }, [code, setMessage]);

  const connect = () =>
    startTransition(async () => {
      const result = await startGoogleSignInAction();
      if (result.ok) setCode(result.data);
      else setMessage({ tone: "error", text: result.error.message });
    });

  return (
    <Panel
      title="Google Drive"
      id="backups-drive-heading"
      action={
        config.googleDrive.connected ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await disconnectGoogleDriveAction();
                setMessage(
                  result.ok
                    ? {
                        tone: "note",
                        text: "Google Drive is disconnected; backups stay on this server only.",
                      }
                    : { tone: "error", text: result.error.message },
                );
              })
            }
          >
            Disconnect
          </Button>
        ) : config.googleDrive.available ? (
          <Button type="button" size="sm" disabled={pending || Boolean(code)} onClick={connect}>
            <CloudIcon aria-hidden />
            Connect Google Drive
          </Button>
        ) : null
      }
    >
      <div className="mt-3 grid gap-3 text-sm">
        {config.googleDrive.connected ? (
          <p>
            Connected to{" "}
            <span className="font-medium">
              {config.googleDrive.account ?? "your Google account"}
            </span>
            . Backups go to the folder &quot;Extas ERP Backups&quot; in its Drive.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Backups go to your own Google Drive, locked with your recovery key. The ERP can see only
            the files it makes there.
          </p>
        )}
        {code && (
          <div className="grid gap-2 rounded-md border border-primary/40 bg-primary/5 p-4">
            <p>
              On your phone, open{" "}
              <a
                className="font-medium underline"
                href={code.verificationUrl}
                target="_blank"
                rel="noreferrer"
              >
                {code.verificationUrl.replace(/^https:\/\//, "")}
              </a>{" "}
              and enter this code:
            </p>
            <p className="font-mono text-2xl tracking-widest text-primary">{code.userCode}</p>
            <p className="text-muted-foreground">
              Then choose your Google account and allow access. This page notices by itself.
            </p>
          </div>
        )}
        {editing || !config.googleDrive.available ? (
          <GoogleClientForm
            config={config}
            setMessage={setMessage}
            onDone={() => setEditing(false)}
          />
        ) : (
          <p className="text-muted-foreground">
            Google client: <span className="font-mono">{config.googleDrive.clientId}</span>{" "}
            <button type="button" className="underline" onClick={() => setEditing(true)}>
              Change
            </button>
          </p>
        )}
      </div>
    </Panel>
  );
}

function GoogleClientForm({ setMessage, onDone }: PanelProps & { onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  return (
    <form
      className="grid gap-3 rounded-md border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await setGoogleClientAction({
            clientId: form.get("clientId"),
            clientSecret: form.get("clientSecret"),
          });
          if (result.ok) {
            setErrors({});
            setMessage({
              tone: "success",
              text: "The Google client is saved. Now press Connect Google Drive.",
            });
            onDone();
          } else {
            setErrors(result.error.fieldErrors ?? {});
            setMessage({ tone: "error", text: result.error.message });
          }
        });
      }}
    >
      <p className="font-medium">Google setup (once)</p>
      <p className="text-muted-foreground">
        Make a Google Cloud client of the type &quot;TVs and Limited Input devices&quot; and paste
        its ID and secret here. The steps are in the{" "}
        <Link className="underline" href="/help/settings/backups-google-setup">
          Google setup guide
        </Link>
        .
      </p>
      <Field id="google-client-id" label="Client ID" error={errors.clientId?.[0]}>
        <Input
          id="google-client-id"
          name="clientId"
          autoComplete="off"
          placeholder="1234-abc.apps.googleusercontent.com"
        />
      </Field>
      <Field id="google-client-secret" label="Client secret" error={errors.clientSecret?.[0]}>
        <Input id="google-client-secret" name="clientSecret" type="password" autoComplete="off" />
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          Save the Google client
        </Button>
      </div>
    </form>
  );
}

function RecoveryKeyPanel({ config, setMessage }: PanelProps) {
  const [shown, setShown] = useState<{
    recoveryKey: string;
    keyId: string;
    replaced: boolean;
  } | null>(null);
  const [asking, setAsking] = useState<"make" | "replace" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const made = config.recoveryKey;

  return (
    <Panel
      title="Recovery key"
      id="backups-key-heading"
      action={
        <Button
          type="button"
          size="sm"
          variant={made.made ? "outline" : "default"}
          onClick={() => setAsking(made.made ? "replace" : "make")}
        >
          <KeyRoundIcon aria-hidden />
          {made.made ? "Make a new recovery key" : "Make the recovery key"}
        </Button>
      }
    >
      <div className="mt-3 grid gap-3 text-sm">
        <p className="text-muted-foreground">
          Every backup is locked with this key before it leaves the server. Without it a backup
          cannot be opened, by anyone, ever: not by us, not by Google. Keep it on paper, away from
          the office.
        </p>
        {made.made ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={made.savedAt ? "done" : "warn"}>
              {made.savedAt ? "Written down" : "Not confirmed yet"}
            </StatusBadge>
            <span>Key {made.id}</span>
            {!made.savedAt && (
              <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
                I wrote it down
              </Button>
            )}
          </div>
        ) : (
          <p>No recovery key yet.</p>
        )}
      </div>

      {asking && (
        <FormDialog
          title={asking === "make" ? "Make the recovery key" : "Make a new recovery key"}
          description={
            asking === "make"
              ? "The key is shown once. Have paper and a pen ready."
              : "Backups made before it open only with the old key: keep the old one too. Give your PIN to go on."
          }
          submitLabel="Show me the key"
          pendingLabel="Making it"
          errorTitle="The key could not be made"
          onClose={() => setAsking(null)}
          onSubmit={async (form) => {
            const result = await makeRecoveryKeyAction({ pin: form.get("pin") || undefined });
            if (!result.ok) return result.error;
            setAsking(null);
            setShown(result.data);
          }}
        >
          {(fieldError) =>
            asking === "replace" ? <PinField id="key-pin" error={fieldError("pin")} /> : null
          }
        </FormDialog>
      )}

      {shown && (
        <Dialog open onOpenChange={() => undefined}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Your recovery key</DialogTitle>
              <DialogDescription>
                Write it down now. It is never shown again. Without it no backup can be opened.
              </DialogDescription>
            </DialogHeader>
            <p className="rounded-md border bg-muted/40 p-4 text-center font-mono text-lg leading-relaxed break-all">
              {shown.recoveryKey}
            </p>
            <FormAlert tone="error">
              <TriangleAlertIcon aria-hidden className="hidden" />
              Keep it safe and private: anyone with this key and your Google account can open your
              backups.
            </FormAlert>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => void navigator.clipboard?.writeText(shown.recoveryKey)}
              >
                <CopyIcon aria-hidden />
                Copy
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setShown(null);
                  setConfirming(true);
                }}
              >
                I wrote it down
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {confirming && (
        <FormDialog
          title="Check your copy"
          description="Type the last group of 4 letters and digits of your recovery key."
          submitLabel="Confirm"
          pendingLabel="Checking"
          errorTitle="It could not be confirmed"
          onClose={() => setConfirming(false)}
          onSubmit={async (form) => {
            const result = await confirmRecoveryKeyAction({ lastGroup: form.get("lastGroup") });
            if (!result.ok) return result.error;
            setConfirming(false);
            setMessage({ tone: "success", text: "The recovery key is confirmed. Keep it safe." });
          }}
        >
          {(fieldError) => (
            <Field id="key-last-group" label="Last group" error={fieldError("lastGroup")}>
              <Input
                id="key-last-group"
                name="lastGroup"
                maxLength={4}
                autoComplete="off"
                className="font-mono uppercase"
              />
            </Field>
          )}
        </FormDialog>
      )}
    </Panel>
  );
}

function SchedulePanel({ config, setMessage }: PanelProps) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  return (
    <Panel title="When and how many" id="backups-schedule-heading">
      <form
        className="mt-3 grid gap-4 text-sm sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          startTransition(async () => {
            const result = await updateBackupConfigAction({
              isEnabled: form.get("isEnabled") === "on",
              dailyTime: String(form.get("dailyTime") ?? ""),
              keepCount: Number(form.get("keepCount")),
              includeMedia: form.get("includeMedia") === "on",
              testRestoreEnabled: form.get("testRestoreEnabled") === "on",
            });
            setErrors(result.ok ? {} : (result.error.fieldErrors ?? {}));
            setMessage(
              result.ok
                ? { tone: "success", text: "Backup settings saved." }
                : { tone: "error", text: result.error.message },
            );
          });
        }}
      >
        <Field
          id="backup-time"
          label="Daily time"
          hint={`In ${config.timezone} time`}
          error={errors.dailyTime?.[0]}
        >
          <Input
            id="backup-time"
            name="dailyTime"
            type="time"
            defaultValue={config.dailyTime ?? "02:00"}
          />
        </Field>
        <Field
          id="backup-keep"
          label="How many to keep in Drive"
          hint="The newest checked one always stays"
          error={errors.keepCount?.[0]}
        >
          <Input
            id="backup-keep"
            name="keepCount"
            type="number"
            min={1}
            max={365}
            defaultValue={config.keepCount}
          />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isEnabled" defaultChecked={config.isEnabled} />
          Back up every day
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="includeMedia" defaultChecked={config.includeMedia} />
          Include uploaded files (logos, scans, packing lists)
        </label>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            name="testRestoreEnabled"
            defaultChecked={config.testRestore.enabled}
          />
          Every week, restore the newest backup into a temporary database to prove it works
          (Saturdays at 04:00)
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={pending}>
            Save
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function DriveBackupsPanel({
  ready,
  setMessage,
}: {
  ready: boolean;
  setMessage: (m: Message | undefined) => void;
}) {
  const when = useWhen({ year: true });
  const [items, setItems] = useState<DriveBackup[] | null>(null);
  const [error, setError] = useState<string>();
  const [restoring, setRestoring] = useState<DriveBackup | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    void listDriveBackupsAction().then((result) => {
      if (result.ok) setItems(result.data.items);
      else setError(result.error.message);
    });
    void restoreStatusAction().then((result) => {
      if (result.ok && result.data.waiting) setWaiting(String(result.data.waiting.name));
    });
  }, [ready]);

  return (
    <Panel title="Backups in Google Drive" id="backups-list-heading">
      <div className="mt-3 grid gap-3 text-sm">
        {!ready && (
          <p className="text-muted-foreground">
            Make the recovery key and connect Google Drive first.
          </p>
        )}
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {waiting && (
          <FormAlert tone="note">
            The restore of {waiting} is with the server: it saves a safety copy, restores, starts
            the ERP again and checks every screen. The ERP stops for a few minutes; the result comes
            to your inbox and the bot.
          </FormAlert>
        )}
        {ready && items === null && !error && (
          <p className="text-muted-foreground">Reading Google Drive…</p>
        )}
        {items?.length === 0 && <p className="text-muted-foreground">No backups in Drive yet.</p>}
        {items && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left">
              <thead className="text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Kind</th>
                  <th className="py-2 pr-3 font-medium">Size</th>
                  <th className="py-2 pr-3 font-medium">Checked</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.folderId} className="border-t">
                    <td className="py-2 pr-3">{b.createdAt ? when(b.createdAt) : b.name}</td>
                    <td className="py-2 pr-3">{KIND[b.kind]}</td>
                    <td className="py-2 pr-3">{size(b.bytes)}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge tone={b.checked ? "done" : "warn"}>
                        {b.checked ? "Checked" : "Not checked"}
                      </StatusBadge>
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!b.checked || Boolean(waiting)}
                        onClick={() => setRestoring(b)}
                      >
                        <RotateCcwIcon aria-hidden />
                        Restore
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {restoring && (
        <FormDialog
          destructive
          title={`Restore the backup of ${when(restoring.createdAt || restoring.name)}`}
          description="This replaces ALL of the ERP's data, in every company, with this backup. A safety copy of the data as it is now is saved first, so the restore can be undone. The ERP stops for a few minutes."
          submitLabel="Restore"
          pendingLabel="Downloading and checking the backup"
          errorTitle="The restore could not start"
          onClose={() => setRestoring(null)}
          onSubmit={async (form) => {
            const result = await requestRestoreAction({
              folderId: restoring.folderId,
              pin: form.get("pin") || undefined,
              confirm: String(form.get("confirm") ?? ""),
            });
            if (!result.ok) return result.error;
            setRestoring(null);
            setWaiting(restoring.name);
            setMessage({
              tone: "note",
              text: "The backup is checked and with the server now. The ERP stops for a few minutes while it is restored.",
            });
          }}
        >
          {(fieldError) => (
            <>
              <PinField id="restore-pin" error={fieldError("pin")} />
              <Field id="restore-confirm" label="Type RESTORE" error={fieldError("confirm")}>
                <Input id="restore-confirm" name="confirm" autoComplete="off" />
              </Field>
            </>
          )}
        </FormDialog>
      )}
    </Panel>
  );
}

function NewServerPanel({ setMessage }: { setMessage: (m: Message | undefined) => void }) {
  const [pending, startTransition] = useTransition();
  const [command, setCommand] = useState<string | null>(null);
  return (
    <Panel
      title="Restore on a new server"
      id="backups-new-server-heading"
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await showRestoreCommandAction();
              if (result.ok) setCommand(result.data.command);
              else setMessage({ tone: "error", text: result.error.message });
            })
          }
        >
          <ServerIcon aria-hidden />
          Show the command
        </Button>
      }
    >
      <div className="mt-3 grid gap-3 text-sm">
        <p className="text-muted-foreground">
          If this server is lost: make a new Ubuntu server on Azure, sign in to it, paste this one
          command and answer its questions (the web address, your recovery key, a Google sign-in
          code on your phone). It installs everything, restores the newest backup from Drive, starts
          the ERP with HTTPS and checks every screen. Keep a copy of the command with your recovery
          key.
        </p>
        {command && (
          <div className="grid gap-2">
            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap">
              {command}
            </pre>
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void navigator.clipboard?.writeText(command)}
              >
                <CopyIcon aria-hidden />
                Copy
              </Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
