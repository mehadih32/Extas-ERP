"use client";

import {
  BellIcon,
  CircleCheckIcon,
  CircleXIcon,
  CloudIcon,
  CopyIcon,
  DatabaseBackupIcon,
  DownloadIcon,
  FlaskConicalIcon,
  GlobeIcon,
  KeyRoundIcon,
  PlusIcon,
  RotateCcwIcon,
  ServerIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { PinField } from "@/components/ai/pin-prompt";
import { useWhen } from "@/components/ai/when";
import { Field, FormAlert } from "@/components/forms/field";
import { type Tone, StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import {
  BACKING_UP,
  BACKUP_POLL_LIMIT_MS,
  BACKUP_POLL_MS,
  backupProgress,
  backupSize as size,
} from "@/modules/backups/progress";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reach } from "@/lib/reach";
import { cn } from "@/lib/utils";
import type { getBackupOverview, presentRun } from "@/modules/backups/backup.service";
import type { DriveBackup } from "@/modules/backups/drive-copies";
import type { DriveStatus } from "@/modules/backups/drive-status";
import { keyStrength } from "@/modules/backups/key-words";
import {
  checkGoogleSignInAction,
  clearCloudflareAction,
  disconnectGoogleDriveAction,
  driveStatusAction,
  listDriveBackupsAction,
  recordServerDrillAction,
  requestRestoreAction,
  restoreStatusAction,
  runBackupNowAction,
  setCloudflareAction,
  makeCopyCodeAction,
  setCopyBlockedAction,
  setGoogleClientAction,
  setKeepKeyInDriveAction,
  setRecoveryKeyAction,
  setUpGitHubAlertAction,
  startGoogleSignInAction,
  testCloudflareAction,
  testRestoreNowAction,
  updateBackupConfigAction,
  applyCopyCodeAction,
} from "@/server/actions/backups.actions";

/*
 * Settings > Backups (the platform owner only), simple first (G10): one big
 * line says how the backups are, the next how much work could be lost now;
 * then Back up now, the schedule, the recovery key, and the restore guide.
 * Below: Google Drive, Cloudflare, the late-backup alert on GitHub, the backups
 * in Drive (restore one) and the one command for a new server. Works at 390, 768, 1366 and 1920 px.
 */

type Overview = Awaited<ReturnType<typeof getBackupOverview>>;
type Config = Overview["config"];
type Run = ReturnType<typeof presentRun>;
type Message = { tone: "success" | "error" | "note"; text: string };
type SetMessage = (m: Message | undefined) => void;

const STATUS: Record<string, { text: string; tone: Tone }> = {
  QUEUED: { text: "Waiting", tone: "open" },
  RUNNING: { text: "Running", tone: "open" },
  SUCCEEDED: { text: "Done", tone: "done" },
  FAILED: { text: "Failed", tone: "warn" },
};

const KIND: Record<string, string> = {
  BACKUP: "Backup",
  SAFETY_COPY: "Update safety copy",
  TEST_RESTORE: "Restore drill",
  RESTORE: "Restore",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function BackupsScreen({ overview }: { overview: Overview }) {
  const [message, setMessage] = useState<Message>();
  const { config } = overview;
  const locked = config.recoveryKey.set || Boolean(config.recoveryKey.legacyInUse);
  const notReady = !locked
    ? "Set your recovery key: backups are locked with it before they go to Google Drive. Until then they stay on this server only."
    : !config.googleDrive.connected
      ? "Connect Google Drive: until then backups stay on this server only, and are lost with it."
      : null;

  return (
    <div className="grid min-w-0 gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
      <StatusPanel overview={overview} notReady={notReady} setMessage={setMessage} />
      <SchedulePanel config={config} setMessage={setMessage} />
      <RecoveryKeyPanel config={config} setMessage={setMessage} />
      <DrivePanel config={config} locked={locked} setMessage={setMessage} />
      {(overview.copies.canShare || overview.copies.copies.length > 0) && (
        <CopiesPanel copies={overview.copies} setMessage={setMessage} />
      )}
      <CloudflarePanel config={config} setMessage={setMessage} />
      <GitHubAlertPanel config={config} githubRepo={overview.githubRepo} setMessage={setMessage} />
      <DriveBackupsPanel
        ready={!notReady}
        keyInDrive={Boolean(config.recoveryKey.inDriveAt)}
        setMessage={setMessage}
      />
      <NewServerPanel overview={overview} />
    </div>
  );
}

function StatusPanel({
  overview,
  notReady,
  setMessage,
}: {
  overview: Overview;
  notReady: string | null;
  setMessage: SetMessage;
}) {
  const when = useWhen({ year: true });
  const [pending, startTransition] = useTransition();
  const [drilling, setDrilling] = useState(false);
  const [recording, setRecording] = useState(false);
  const { config, health, lastRun } = overview;
  const router = useRouter();
  // The backup this screen waits for: one started with Back up now, or one already
  // running when the page opened. The page is read again every few seconds until
  // it is done (and in Google Drive, or known to stay on the server).
  const [watching, setWatching] = useState<string | null>(() =>
    lastRun && (lastRun.status === "QUEUED" || lastRun.status === "RUNNING") ? lastRun.id : null,
  );
  const watched = lastRun && lastRun.id === watching ? lastRun : null;
  const progress = watched ? backupProgress(watched) : null;

  // Until the watched backup is done (or for 30 minutes at most).
  const keepAsking = watching !== null && !(progress?.done ?? false);
  useEffect(() => {
    if (!keepAsking) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > BACKUP_POLL_LIMIT_MS) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, BACKUP_POLL_MS);
    return () => clearInterval(timer);
  }, [keepAsking, router]);

  // The watched backup moved on: say where it stands.
  const progressText = progress?.text;
  const progressTone = progress?.done ? progress.tone : "note";
  useEffect(() => {
    if (progressText) setMessage({ tone: progressTone, text: progressText });
  }, [progressText, progressTone, setMessage]);
  const good = health.level === "good";
  const Icon = good
    ? CircleCheckIcon
    : health.level === "warning"
      ? TriangleAlertIcon
      : CircleXIcon;

  return (
    <Panel
      title="Backups"
      id="backups-heading"
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await runBackupNowAction();
                setMessage(
                  result.ok
                    ? { tone: "success", text: BACKING_UP }
                    : { tone: "error", text: result.error.message },
                );
                if (result.ok) setWatching(result.data.id);
              })
            }
          >
            <DatabaseBackupIcon aria-hidden />
            Back up now
          </Button>
          <GuideLinks />
        </div>
      }
    >
      <div className="mt-4 grid gap-4">
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border p-4",
            good
              ? "border-emerald-600/40 bg-emerald-600/5"
              : health.level === "warning"
                ? "border-amber-500/50 bg-amber-500/5"
                : "border-destructive/50 bg-destructive/5",
          )}
        >
          <Icon
            aria-hidden
            className={cn(
              "mt-0.5 size-7 shrink-0",
              good
                ? "text-emerald-600"
                : health.level === "warning"
                  ? "text-amber-600"
                  : "text-destructive",
            )}
          />
          <div className="grid min-w-0 gap-1">
            <p className="text-lg font-semibold break-words sm:text-xl">{health.line}</p>
            <p className="text-sm break-words text-muted-foreground">{health.loseLine}</p>
          </div>
        </div>
        {notReady && (
          <FormAlert tone="error">
            <span className="font-medium">Backups are not safe yet.</span> {notReady}
          </FormAlert>
        )}
        <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <Fact label="Next backup">
            {config.nextRunAt ? when(config.nextRunAt) : "Backups are switched off"}
            <span className="block text-xs text-muted-foreground">{config.scheduleText}</span>
          </Fact>
          <Fact label="Last backup">
            {lastRun ? <RunLine run={lastRun} when={when} /> : "None yet"}
          </Fact>
          <Fact label="Last restore drill">
            {overview.lastTestRestore ? (
              <RunLine run={overview.lastTestRestore} when={when} />
            ) : (
              "None yet"
            )}
            <span className="mt-2 block">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!config.googleDrive.connected}
                onClick={() => setDrilling(true)}
              >
                <FlaskConicalIcon aria-hidden />
                Run drill now
              </Button>
            </span>
          </Fact>
          {overview.thisDrill ? (
            <Fact label="This restore drill">
              <ServerDrillLine drill={overview.thisDrill} when={when} />
            </Fact>
          ) : (
            <Fact label="Last new-server drill">
              {overview.lastServerDrill ? (
                <ServerDrillLine drill={overview.lastServerDrill} when={when} />
              ) : (
                "None yet"
              )}
              <span className="mt-2 block">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRecording(true)}
                >
                  <ServerIcon aria-hidden />
                  Record a drill
                </Button>
              </span>
            </Fact>
          )}
        </dl>
        {overview.notSent > 0 && (
          <p className="text-sm text-muted-foreground">
            On this server, not yet in Google Drive: {overview.notSent} (sent again within the
            hour).
          </p>
        )}
      </div>

      {recording && (
        <FormDialog
          title="Record a drill on a new server"
          description="After a restore drill on a test server (the restore guide's “Practice: a restore drill”), type the drill copy's web address. This ERP reads the drill's time and result from it, while it still runs, and shows them here. Nothing on the drill copy changes."
          submitLabel="Record"
          pendingLabel="Reading the drill"
          errorTitle="The drill could not be recorded"
          onClose={() => setRecording(false)}
          onSubmit={async (form) => {
            const result = await recordServerDrillAction({
              address: String(form.get("address") ?? ""),
            });
            if (!result.ok) return result.error;
            setRecording(false);
            setMessage({ tone: "success", text: "The drill is recorded." });
          }}
        >
          {(fieldError) => (
            <Field
              id="drill-address"
              label="The drill copy's web address"
              hint="For example drill.extasbd.com: the address you typed at “Test web address for this drill”."
              error={fieldError("address")}
            >
              <Input
                id="drill-address"
                name="address"
                autoComplete="off"
                inputMode="url"
                placeholder="drill.extasbd.com"
              />
            </Field>
          )}
        </FormDialog>
      )}

      {drilling && (
        <FormDialog
          title="Run the restore drill now"
          description="The newest backup in Google Drive is restored into a temporary database, every table and file is compared with the backup, and the temporary database is deleted. Your live data is not touched. The result comes to your inbox and Telegram."
          submitLabel="Run drill now"
          pendingLabel="Starting the drill"
          errorTitle="The drill could not start"
          onClose={() => setDrilling(false)}
          onSubmit={async (form) => {
            const result = await testRestoreNowAction({
              key: String(form.get("key") ?? "") || undefined,
            });
            if (!result.ok) return result.error;
            setDrilling(false);
            setMessage({
              tone: "success",
              text: "The drill is running. It takes a few minutes; the result comes to your inbox and Telegram.",
            });
          }}
        >
          {(fieldError) =>
            config.recoveryKey.inDriveAt ? (
              <p className="text-sm text-muted-foreground">
                Your recovery key is kept in Google Drive: the drill reads it from there.
              </p>
            ) : (
              <Field
                id="drill-key"
                label="Recovery key (for this drill only)"
                hint="Without it the drill checks every file's checksum only. It is not saved."
                error={fieldError("key")}
              >
                <Input id="drill-key" name="key" type="password" autoComplete="off" />
              </Field>
            )
          }
        </FormDialog>
      )}
    </Panel>
  );
}

/** The restore guide with "Your restore details", made when it is asked for. */
function GuideLinks() {
  return (
    <>
      <Button asChild variant="outline">
        <a href="/api/backups/guide?lang=bn" download>
          <DownloadIcon aria-hidden />
          Download the restore guide
        </a>
      </Button>
      <Button asChild variant="ghost">
        <a href="/api/backups/guide?lang=en" download>
          English copy
        </a>
      </Button>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border p-3">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1 break-words">{children}</dd>
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
        <span className="text-xs break-words text-destructive">{run.error ?? run.driveError}</span>
      )}
    </span>
  );
}

type ServerDrill = NonNullable<Overview["thisDrill"]>;

/** A restore drill on a new server: when, how long it took, and how it went. */
function ServerDrillLine({
  drill,
  when,
}: {
  drill: ServerDrill;
  when: (d: Date | string) => string;
}) {
  const at = drill.finishedAt ?? drill.startedAt;
  const took =
    drill.seconds === null
      ? null
      : `Took ${Math.floor(drill.seconds / 60)} min ${drill.seconds % 60} s`;
  const status =
    drill.result === "worked"
      ? { text: "Worked", tone: "done" as Tone }
      : drill.result === "problems"
        ? { text: "Had problems", tone: "warn" as Tone }
        : { text: "Running", tone: "open" as Tone };
  return (
    <span className="grid gap-1">
      <span className="flex flex-wrap items-center gap-2">
        {at && <span>{when(at)}</span>}
        <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
        {took && <span className="text-muted-foreground">{took}</span>}
      </span>
      {drill.address && (
        <span className="text-xs break-all text-muted-foreground">
          <GlobeIcon aria-hidden className="mr-1 inline size-3" />
          {drill.address}
        </span>
      )}
      {drill.result === "problems" && (
        <span className="text-xs break-words text-destructive">
          {[
            drill.problems ? `${drill.problems} table(s) or file(s) did not match` : null,
            drill.screenProblems ? `${drill.screenProblems} screen(s) did not open` : null,
            drill.https === false ? "HTTPS did not work" : null,
          ]
            .filter(Boolean)
            .join("; ") || "See the end of the restore in PuTTY."}
        </span>
      )}
    </span>
  );
}

type PanelProps = { config: Config; setMessage: SetMessage };

// =============================================================================
// The schedule and keeping rules (G1, G2) and the monthly drill
// =============================================================================

function TimeList({
  times,
  onChange,
  single,
}: {
  times: string[];
  onChange: (times: string[]) => void;
  single?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {times.map((time, i) => (
        <span key={i} className="flex items-center gap-1">
          <Input
            aria-label={`Time ${i + 1}`}
            type="time"
            className="w-32"
            value={time}
            onChange={(e) => onChange(times.map((t, j) => (j === i ? e.target.value : t)))}
          />
          {!single && times.length > 1 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remove time ${i + 1}`}
              onClick={() => onChange(times.filter((_, j) => j !== i))}
            >
              <XIcon aria-hidden />
            </Button>
          )}
        </span>
      ))}
      {!single && times.length < 12 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...times, "12:00"])}
        >
          <PlusIcon aria-hidden />
          Add a time
        </Button>
      )}
    </div>
  );
}

function SchedulePanel({ config, setMessage }: PanelProps) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const s = config.schedule;
  const [mode, setMode] = useState(s.mode);
  const [every, setEvery] = useState(String(s.every));
  const [times, setTimes] = useState(s.times.length ? s.times : ["02:00"]);
  const [weekdays, setWeekdays] = useState<number[]>(s.weekdays);
  const [dates, setDates] = useState<string[]>(s.dates.length ? s.dates : [""]);
  const [forever, setForever] = useState(config.driveKeepDays === null);
  const [enabled, setEnabled] = useState(config.isEnabled);
  const [days, setDays] = useState(String(config.driveKeepDays ?? 90));
  // Switching backups off, or fewer days in Drive, needs the PIN (G12).
  const fewerDays =
    !forever &&
    Number(days) > 0 &&
    (config.driveKeepDays === null || Number(days) < config.driveKeepDays);
  const lessSafe = (config.isEnabled && !enabled) || fewerDays;

  const schedule = () => {
    if (mode === "HOURS") return { mode, every: Number(every), times: times.slice(0, 1) };
    if (mode === "DAYS") return { mode, every: Number(every), times };
    if (mode === "WEEKLY") return { mode, times, weekdays };
    return { mode, dates: dates.filter(Boolean).map((d) => d.replace("T", " ")) };
  };
  const scheduleError = Object.entries(errors).find(([k]) => k.startsWith("schedule"))?.[1]?.[0];
  const fieldError = (name: string) => errors[name]?.[0];

  return (
    <Panel title="When to back up" id="backups-schedule-heading">
      <form
        className="mt-3 grid gap-5 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          startTransition(async () => {
            const result = await updateBackupConfigAction({
              schedule: schedule(),
              isEnabled: enabled,
              serverKeep: Number(form.get("serverKeep")),
              driveKeepDays: forever ? null : Number(days),
              drillEnabled: form.get("drillEnabled") === "on",
              drillDay: Number(form.get("drillDay")),
              drillTime: String(form.get("drillTime") ?? ""),
              pin: lessSafe ? String(form.get("pin") ?? "") || undefined : undefined,
            });
            setErrors(result.ok ? {} : (result.error.fieldErrors ?? {}));
            setMessage(
              result.ok
                ? { tone: "success", text: `Saved: ${result.data.scheduleText}.` }
                : { tone: "error", text: result.error.message },
            );
          });
        }}
      >
        <p className="text-muted-foreground">
          Now: {config.scheduleText} ({config.timezone} time).
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="backup-mode" label="How often" error={scheduleError}>
            <select
              id="backup-mode"
              className="h-9 w-full rounded-md border bg-background px-3"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="HOURS">Every few hours</option>
              <option value="DAYS">Every day, or every few days</option>
              <option value="WEEKLY">On chosen weekdays</option>
              <option value="DATES">On chosen dates</option>
            </select>
          </Field>
          {(mode === "HOURS" || mode === "DAYS") && (
            <Field
              id="backup-every"
              label={mode === "HOURS" ? "Every how many hours" : "Every how many days"}
              hint={mode === "HOURS" ? "1 to 12" : "1 is every day"}
            >
              <Input
                id="backup-every"
                type="number"
                min={1}
                max={mode === "HOURS" ? 12 : 30}
                value={every}
                onChange={(e) => setEvery(e.target.value)}
              />
            </Field>
          )}
        </div>
        {mode !== "DATES" && (
          <div className="grid gap-2">
            <span className="font-medium">
              {mode === "HOURS" ? "Starting at" : "At these times"}
            </span>
            <TimeList
              times={mode === "HOURS" ? times.slice(0, 1) : times}
              single={mode === "HOURS"}
              onChange={setTimes}
            />
          </div>
        )}
        {mode === "WEEKLY" && (
          <fieldset className="grid gap-2">
            <legend className="font-medium">On these days</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {WEEKDAYS.map((day, i) => (
                <label key={day} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={weekdays.includes(i)}
                    onChange={(e) =>
                      setWeekdays(
                        e.target.checked ? [...weekdays, i] : weekdays.filter((d) => d !== i),
                      )
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {mode === "DATES" && (
          <div className="grid gap-2">
            <span className="font-medium">On these dates</span>
            <div className="flex flex-wrap items-center gap-2">
              {dates.map((d, i) => (
                <Input
                  key={i}
                  aria-label={`Date ${i + 1}`}
                  type="datetime-local"
                  className="w-full sm:w-56"
                  value={d.replace(" ", "T")}
                  onChange={(e) => setDates(dates.map((x, j) => (j === i ? e.target.value : x)))}
                />
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDates([...dates, ""])}
              >
                <PlusIcon aria-hidden />
                Add a date
              </Button>
            </div>
          </div>
        )}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="isEnabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Back up on this schedule
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="backup-server-keep"
            label="Keep on this server"
            hint="The newest backups, 3 to 7"
            error={errors.serverKeep?.[0]}
          >
            <select
              id="backup-server-keep"
              name="serverKeep"
              className="h-9 w-full rounded-md border bg-background px-3"
              defaultValue={config.serverKeep}
            >
              {[3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} backups
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-2">
            <Field
              id="backup-drive-days"
              label="Keep in Google Drive for (days)"
              hint="The newest one always stays"
              error={errors.driveKeepDays?.[0]}
            >
              <Input
                id="backup-drive-days"
                name="driveKeepDays"
                type="number"
                min={7}
                max={3650}
                disabled={forever}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={forever}
                onChange={(e) => setForever(e.target.checked)}
              />
              Keep for ever
            </label>
          </div>
        </div>

        <div className="grid gap-3 rounded-md border p-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="drillEnabled" defaultChecked={config.drill.enabled} />
            Run the monthly restore drill
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="drill-day"
              label="Day of the month"
              hint="1 to 28"
              error={errors.drillDay?.[0]}
            >
              <Input
                id="drill-day"
                name="drillDay"
                type="number"
                min={1}
                max={28}
                defaultValue={config.drill.day}
              />
            </Field>
            <Field id="drill-time" label="Drill time" error={errors.drillTime?.[0]}>
              <Input
                id="drill-time"
                name="drillTime"
                type="time"
                defaultValue={config.drill.time}
              />
            </Field>
          </div>
        </div>
        {lessSafe && (
          <div className="grid gap-2 sm:max-w-xs">
            <PinField
              id="schedule-pin"
              hint="Needed to switch backups off or keep them in Google Drive for fewer days. You are told on Telegram too."
              error={fieldError("pin") ?? fieldError("pinNotSet")}
            />
          </div>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        </div>
      </form>
    </Panel>
  );
}

// =============================================================================
// The recovery key (A9, G4, G5)
// =============================================================================

function KeyFields({ fieldError }: { fieldError: (name: string) => string | undefined }) {
  const [typed, setTyped] = useState("");
  const strength = typed ? keyStrength(typed) : null;
  return (
    <>
      <Field
        id="key-new"
        label="New recovery key"
        hint={
          strength?.hint ??
          "Any word, sentence or pattern you will remember, at least 6 characters (10 or more is safer)."
        }
        error={fieldError("key")}
      >
        <Input
          id="key-new"
          name="key"
          type="password"
          autoComplete="new-password"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </Field>
      <Field id="key-confirm" label="Type it again" error={fieldError("confirm")}>
        <Input id="key-confirm" name="confirm" type="password" autoComplete="new-password" />
      </Field>
    </>
  );
}

function RecoveryKeyPanel({ config, setMessage }: PanelProps) {
  const when = useWhen({ year: true });
  const [asking, setAsking] = useState<"set" | "change" | "put" | "remove" | null>(null);
  const [forgot, setForgot] = useState(false);
  const key = config.recoveryKey;
  const drive = config.googleDrive.connected;

  return (
    <Panel
      title="Recovery key"
      id="backups-key-heading"
      action={
        <Button
          type="button"
          size="sm"
          variant={key.set ? "outline" : "default"}
          onClick={() => setAsking(key.set ? "change" : "set")}
        >
          <KeyRoundIcon aria-hidden />
          {key.set ? "Change the recovery key" : "Set your recovery key"}
        </Button>
      }
    >
      <div className="mt-3 grid gap-3 text-sm">
        <p className="text-muted-foreground">
          Every backup is locked before it leaves the server. Only your recovery key opens it: not
          us, not Google. You choose it yourself: any word, sentence or pattern you will remember.
        </p>
        {key.legacyInUse && (
          <FormAlert tone="error">
            Backups are still locked with the old key card from v6.3 (key {key.legacyInUse.id}). Set
            your own recovery key now.
          </FormAlert>
        )}
        {key.set ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="done">Set</StatusBadge>
            <span>Key {key.pairId}</span>
            {key.setAt && <span className="text-muted-foreground">since {when(key.setAt)}</span>}
          </div>
        ) : (
          !key.legacyInUse && <p>No recovery key yet.</p>
        )}
        {key.set && (
          <div className="grid gap-2 rounded-md border p-3">
            <p className="font-medium">Keep my recovery key in Google Drive</p>
            <p className="text-muted-foreground">
              {key.keepInDrive
                ? key.inDriveAt
                  ? `On: your key is in the restore guide in your Google Drive backup folder (since ${when(key.inDriveAt)}). A restore fills it in by itself.`
                  : drive
                    ? "On, but your key is not in Google Drive yet: type it once to put it there."
                    : "On: your key goes to Google Drive once Google Drive is connected and you type it once."
                : "Off: you type your key when you restore. Keep it written down safely."}
            </p>
            <p className="text-xs text-muted-foreground">
              Keep 2-Step Verification on for the Google account that holds your backups.
            </p>
            <div className="flex flex-wrap gap-2">
              {(!key.keepInDrive || !key.inDriveAt) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!drive}
                  onClick={() => setAsking("put")}
                >
                  Put my key in Google Drive
                </Button>
              )}
              {(key.keepInDrive || key.inDriveAt) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setAsking("remove")}
                >
                  Take my key out of Google Drive
                </Button>
              )}
            </div>
          </div>
        )}
        {key.legacy && (
          <p className="text-muted-foreground">
            Backups made before {key.legacy.retiredAt ? when(key.legacy.retiredAt) : "your key"}{" "}
            open only with the old key card (key {key.legacy.id}).
          </p>
        )}
        {key.earlier.map((e) => (
          <p key={e.pairId} className="text-muted-foreground">
            Backups made before {when(e.until)} open only with your earlier recovery key (key{" "}
            {e.pairId}).
          </p>
        ))}
      </div>

      {(asking === "set" || asking === "change") && (
        <FormDialog
          title={asking === "set" ? "Set your recovery key" : "Change the recovery key"}
          description={
            asking === "set"
              ? "Choose a key you will remember for years. Write it down too, and keep it away from the office."
              : "Your new key opens every backup, old and new."
          }
          submitLabel="Save the key"
          pendingLabel="Saving the key"
          errorTitle="The key could not be saved"
          onClose={() => {
            setAsking(null);
            setForgot(false);
          }}
          onSubmit={async (form) => {
            const result = await setRecoveryKeyAction({
              pin: form.get("pin") || undefined,
              key: String(form.get("key") ?? ""),
              confirm: String(form.get("confirm") ?? ""),
              currentKey: String(form.get("currentKey") ?? "") || undefined,
              forgotCurrent: forgot || undefined,
              keepInDrive: asking === "set" ? form.get("keepInDrive") === "on" : undefined,
            });
            if (!result.ok) return result.error;
            setAsking(null);
            setForgot(false);
            setMessage({
              tone: result.data.driveProblem ? "note" : "success",
              text: `${result.data.message}${result.data.driveProblem ? ` ${result.data.driveProblem}` : ""}`,
            });
          }}
        >
          {(fieldError) => (
            <>
              {asking === "change" && (
                <>
                  {!forgot && (
                    <Field
                      id="key-current"
                      label="Current recovery key"
                      error={fieldError("currentKey")}
                    >
                      <Input
                        id="key-current"
                        name="currentKey"
                        type="password"
                        autoComplete="current-password"
                      />
                    </Field>
                  )}
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={forgot}
                      onChange={(e) => setForgot(e.target.checked)}
                    />
                    <span>
                      I forgot my current key
                      {forgot && (
                        <span className="block text-destructive">
                          Backups made before now will open only with the forgotten key.
                        </span>
                      )}
                    </span>
                  </label>
                </>
              )}
              <KeyFields fieldError={fieldError} />
              {asking === "set" && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="keepInDrive" defaultChecked className="mt-1" />
                  <span>
                    Keep my recovery key in Google Drive
                    <span className="block text-muted-foreground">
                      A restore then fills it in by itself. Keep 2-Step Verification on for that
                      Google account.
                    </span>
                  </span>
                </label>
              )}
              <PinField id="key-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
            </>
          )}
        </FormDialog>
      )}

      {(asking === "put" || asking === "remove") && (
        <FormDialog
          title={
            asking === "put" ? "Put my key in Google Drive" : "Take my key out of Google Drive"
          }
          description={
            asking === "put"
              ? "Type your recovery key once. It goes into the restore guide in your Drive backup folder; this server does not keep it."
              : "The key file and the guide with your key are deleted from Google Drive. You then type your key when you restore."
          }
          submitLabel={asking === "put" ? "Put it in Drive" : "Take it out"}
          pendingLabel="Saving"
          errorTitle="It could not be changed"
          onClose={() => setAsking(null)}
          onSubmit={async (form) => {
            const result = await setKeepKeyInDriveAction({
              pin: form.get("pin") || undefined,
              keep: asking === "put",
              key: String(form.get("key") ?? "") || undefined,
            });
            if (!result.ok) return result.error;
            setAsking(null);
            setMessage({
              tone: result.data.driveProblem ? "note" : "success",
              text:
                result.data.driveProblem ??
                (asking === "put"
                  ? "Your recovery key is in Google Drive now."
                  : "Your recovery key is out of Google Drive now."),
            });
          }}
        >
          {(fieldError) => (
            <>
              {asking === "put" && (
                <Field id="keep-key" label="Recovery key" error={fieldError("key")}>
                  <Input id="keep-key" name="key" type="password" autoComplete="current-password" />
                </Field>
              )}
              <PinField id="keep-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
            </>
          )}
        </FormDialog>
      )}
    </Panel>
  );
}

// =============================================================================
// Google Drive
// =============================================================================

function DrivePanel({ config, locked, setMessage }: PanelProps & { locked: boolean }) {
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<{
    userCode: string;
    verificationUrl: string;
    interval: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [ownClient, setOwnClient] = useState(false);
  const [usingCode, setUsingCode] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [status, setStatus] = useState<DriveStatus | null>(null);
  // Bumped after each Connect, so the state is read again even for the same account.
  const [signIns, setSignIns] = useState(0);
  const { connected, account } = config.googleDrive;

  // Once connected: is Google still letting the ERP in, and how much room is in the Drive?
  useEffect(() => {
    if (!connected) return;
    let live = true;
    void driveStatusAction()
      .then((result) => {
        if (live && result.ok) setStatus(result.data);
      })
      // No answer from the ERP itself: shown like Google not answering.
      .catch(() => {
        if (live) setStatus({ state: "unreachable" });
      });
    return () => {
      live = false;
    };
  }, [connected, account, signIns]);

  // While a code is shown, ask every few seconds whether the owner said yes at Google.
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
        if (result.data.status === "connected") {
          setStatus(null);
          setSignIns((n) => n + 1);
        }
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
      if (result.ok) {
        setCopied(false);
        setCode(result.data);
      } else setMessage({ tone: "error", text: result.error.message });
    });
  const reconnect = connected && status?.state === "reconnect";

  return (
    <Panel
      title="Google Drive"
      id="backups-drive-heading"
      action={
        connected ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setDisconnecting(true)}
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
        {connected ? (
          <p className="break-words">
            Connected to <span className="font-medium">{account ?? "your Google account"}</span>.
            Backups go to the folder &quot;Extas ERP Backups&quot; in its Drive.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Backups go to your own Google Drive, locked with your recovery key. The ERP can see only
            the files it makes there. Give this ERP a Google account of its own, one that no other
            Extas ERP server backs up to, so the backups of two servers never mix in one folder.
          </p>
        )}
        {!locked && (
          <p className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
            <KeyRoundIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            Set your recovery key first (above): backups go to Google Drive only once they are
            locked with it.
          </p>
        )}
        {connected &&
          status?.state === "connected" &&
          status.freeBytes !== null &&
          Boolean(status.totalBytes) && (
            <p className="text-muted-foreground">
              Free in this Drive: {size(status.freeBytes)} of {size(status.totalBytes)}.
            </p>
          )}
        {connected && status?.state === "unreachable" && (
          <p className="text-muted-foreground">
            Google Drive could not be reached just now; the ERP tries again by itself.
          </p>
        )}
        {reconnect && !code && (
          <div className="grid gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-4">
            <p className="flex items-start gap-2 font-medium text-destructive">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              Google ended the ERP&apos;s access to this Drive.
            </p>
            <p>
              The access was removed or ran out, or this server&apos;s Google client changed. New
              backups stay on this server until you reconnect; they go to Drive within the hour
              after you do.
            </p>
            <div>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => setReconnecting(true)}
              >
                <RotateCcwIcon aria-hidden />
                Reconnect Google Drive
              </Button>
            </div>
          </div>
        )}
        {code && (
          <div className="grid min-w-0 gap-3 rounded-md border border-primary/40 bg-primary/5 p-4">
            <ol className="grid list-decimal gap-1 pl-5">
              <li>Press Open Google (it opens in a new tab), or open the address on your phone.</li>
              <li>Sign in to your own Google account and enter the code below.</li>
              <li>Press Allow. This page notices by itself.</li>
            </ol>
            <p className="font-mono text-2xl tracking-widest break-all text-primary">
              {code.userCode}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(code.userCode);
                    setCopied(true);
                  } catch {
                    setMessage({
                      tone: "error",
                      text: "The code was not copied: type it at Google as shown.",
                    });
                  }
                }}
              >
                <CopyIcon aria-hidden />
                {copied ? "Copied" : "Copy code"}
              </Button>
              <Button asChild size="sm">
                <a href={code.verificationUrl} target="_blank" rel="noreferrer">
                  <GlobeIcon aria-hidden />
                  Open Google
                </a>
              </Button>
              <span className="text-xs break-all text-muted-foreground">
                {code.verificationUrl.replace(/^https:\/\//, "")}
              </span>
            </div>
          </div>
        )}
        {config.googleDrive.available ? (
          <p className="break-all text-muted-foreground">
            Google client: <span className="font-mono">{config.googleDrive.clientId}</span>
            {config.googleDrive.fromExtas
              ? " (from Extas, by a copy code)"
              : config.googleDrive.setOnScreen
                ? " (your own)"
                : " (set up by Extas on this server)"}
          </p>
        ) : (
          <p className="text-muted-foreground">
            Google Drive is not set up on this server yet. Use the copy code Extas gave you, or your
            own Google client below.
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {!config.googleDrive.setOnScreen && (
            <button
              type="button"
              className="text-left underline"
              onClick={() => setUsingCode(true)}
            >
              Use a copy code
            </button>
          )}
          <button type="button" className="text-left underline" onClick={() => setOwnClient(true)}>
            {config.googleDrive.setOnScreen && !config.googleDrive.fromExtas
              ? "Change your own Google client (advanced)"
              : "Use your own Google client (advanced)"}
          </button>
        </div>
        {ownClient && (
          <GoogleClientDialog setMessage={setMessage} onDone={() => setOwnClient(false)} />
        )}
        {usingCode && (
          <FormDialog
            title="Use a copy code"
            description="Extas gives each copy of the ERP a code once. With it, this server backs up with Extas's Google client, so you never open Google Cloud. Then press Connect Google Drive and sign in with your own Google account."
            submitLabel="Use the code"
            pendingLabel="Asking Extas"
            errorTitle="The copy code was not used"
            onClose={() => setUsingCode(false)}
            onSubmit={async (form) => {
              const result = await applyCopyCodeAction({
                code: form.get("code"),
                pin: form.get("pin") || undefined,
              });
              if (!result.ok) return result.error;
              setUsingCode(false);
              setMessage({
                tone: "success",
                text: "The Google client from Extas is saved. Now press Connect Google Drive.",
              });
            }}
          >
            {(fieldError) => (
              <>
                <Field id="copy-code" label="Copy code" error={fieldError("code")}>
                  <Input
                    id="copy-code"
                    name="code"
                    autoComplete="off"
                    placeholder="EXTAS-ABCD-EFGH-JKMN-PQRS-TVWX"
                  />
                </Field>
                <PinField id="copy-code-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
              </>
            )}
          </FormDialog>
        )}
      </div>
      {reconnecting && (
        <FormDialog
          title="Reconnect Google Drive"
          description="This replaces the ERP's Google sign-in, so it needs your PIN. Then sign in with the Google account this server backs up to."
          submitLabel="Show the code"
          pendingLabel="Asking Google"
          errorTitle="Google Drive was not reconnected"
          onClose={() => setReconnecting(false)}
          onSubmit={async (form) => {
            const result = await startGoogleSignInAction({ pin: form.get("pin") || undefined });
            if (!result.ok) return result.error;
            setReconnecting(false);
            setCopied(false);
            setCode(result.data);
          }}
        >
          {(fieldError) => (
            <PinField
              id="drive-reconnect-pin"
              error={fieldError("pin") ?? fieldError("pinNotSet")}
            />
          )}
        </FormDialog>
      )}
      {disconnecting && (
        <FormDialog
          destructive
          title="Disconnect Google Drive"
          description="New backups then stay on this server only, and are lost with it. The backups already in Drive stay there. You are told on Telegram too."
          submitLabel="Disconnect"
          pendingLabel="Disconnecting"
          errorTitle="Google Drive was not disconnected"
          onClose={() => setDisconnecting(false)}
          onSubmit={async (form) => {
            const result = await disconnectGoogleDriveAction({
              pin: form.get("pin") || undefined,
            });
            if (!result.ok) return result.error;
            setDisconnecting(false);
            setStatus(null);
            setMessage({
              tone: "note",
              text: "Google Drive is disconnected; backups stay on this server only.",
            });
          }}
        >
          {(fieldError) => (
            <PinField
              id="drive-disconnect-pin"
              error={fieldError("pin") ?? fieldError("pinNotSet")}
            />
          )}
        </FormDialog>
      )}
    </Panel>
  );
}

function GoogleClientDialog({
  setMessage,
  onDone,
}: {
  setMessage: SetMessage;
  onDone: () => void;
}) {
  return (
    <FormDialog
      title="Your own Google client"
      description={
        <>
          Only if you want your own Google Cloud client instead of the one Extas set up: make one of
          the type &quot;TVs and Limited Input devices&quot; and paste its ID and secret here. A new
          client ends the Drive connection (connect again after), and the restore guide then prints
          your client. The steps are in the{" "}
          <Link className="underline" href="/help/settings/backups-google-setup">
            Google setup guide
          </Link>
          .
        </>
      }
      submitLabel="Save the Google client"
      pendingLabel="Saving"
      errorTitle="The Google client was not saved"
      onClose={onDone}
      onSubmit={async (form) => {
        const result = await setGoogleClientAction({
          clientId: form.get("clientId"),
          clientSecret: form.get("clientSecret"),
          pin: form.get("pin") || undefined,
        });
        if (!result.ok) return result.error;
        onDone();
        setMessage({
          tone: "success",
          text: "The Google client is saved. Now press Connect Google Drive.",
        });
      }}
    >
      {(fieldError) => (
        <>
          <Field id="google-client-id" label="Client ID" error={fieldError("clientId")}>
            <Input
              id="google-client-id"
              name="clientId"
              autoComplete="off"
              placeholder="1234-abc.apps.googleusercontent.com"
            />
          </Field>
          <Field id="google-client-secret" label="Client secret" error={fieldError("clientSecret")}>
            <Input
              id="google-client-secret"
              name="clientSecret"
              type="password"
              autoComplete="off"
            />
          </Field>
          <PinField
            id="google-client-pin"
            error={fieldError("pin") ?? fieldError("pinNotSet")}
            hint="Changing the Google client makes backups less safe until Drive is connected again."
          />
        </>
      )}
    </FormDialog>
  );
}

// =============================================================================
// Copies of this ERP (copy codes, owner's decision 2026-10-29)
// =============================================================================

const COPY_STATE: Record<string, { text: string; tone: Tone }> = {
  WAITING: { text: "Code not used yet", tone: "open" },
  EXPIRED: { text: "Code too old", tone: "warn" },
  IN_USE: { text: "In use", tone: "done" },
  BLOCKED: { text: "Blocked", tone: "warn" },
};

function CopiesPanel({
  copies,
  setMessage,
}: {
  copies: Overview["copies"];
  setMessage: SetMessage;
}) {
  const when = useWhen({ year: true });
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<{ code: string; codeExpiresAt: Date } | null>(null);
  const [copied, setCopied] = useState(false);
  const [blocking, setBlocking] = useState<{ id: string; label: string; blocked: boolean } | null>(
    null,
  );
  return (
    <Panel
      title="Copies of this ERP"
      id="copies"
      action={
        copies.canShare && (
          <Button type="button" size="sm" onClick={() => setMaking(true)}>
            <PlusIcon aria-hidden />
            Make a copy code
          </Button>
        )
      }
    >
      <div className="grid min-w-0 gap-3 text-sm">
        <p className="text-muted-foreground">
          When you sell a copy of the ERP, make a copy code for it and give the code to the buyer.
          They enter it once on their Backups screen, so their copy backs up to their own Google
          Drive with your Google client. A code works once, for 30 days. Block stops the code at
          once and the copy at its next daily check-in.
        </p>
        <p>
          In use: {copies.counts.inUse} · Code not used yet: {copies.counts.waiting} · Blocked:{" "}
          {copies.counts.blocked}
        </p>
        {made && (
          <div className="grid min-w-0 gap-2 rounded-md border border-primary/40 bg-primary/5 p-4">
            <p>Give this code to the buyer. It is shown only now.</p>
            <p className="font-mono text-xl tracking-wider break-all text-primary">{made.code}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(made.code);
                    setCopied(true);
                  } catch {
                    setMessage({ tone: "error", text: "The code was not copied: write it down." });
                  }
                }}
              >
                <CopyIcon aria-hidden />
                {copied ? "Copied" : "Copy code"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Works until {when(made.codeExpiresAt)}
              </span>
            </div>
          </div>
        )}
        {copies.copies.length === 0 ? (
          <p className="text-muted-foreground">No copy codes yet.</p>
        ) : (
          <ul className="grid min-w-0 gap-2">
            {copies.copies.map((c) => (
              <li
                key={c.id}
                className="flex min-w-0 flex-wrap items-start justify-between gap-2 rounded-md border p-3"
              >
                <div className="grid min-w-0 gap-1">
                  <p className="font-medium break-words">{c.label}</p>
                  <StatusBadge tone={COPY_STATE[c.state]!.tone}>
                    {COPY_STATE[c.state]!.text}
                  </StatusBadge>
                  {c.address && <p className="text-xs break-all">{c.address}</p>}
                  <p className="text-xs text-muted-foreground">
                    {c.state === "WAITING" || c.state === "EXPIRED"
                      ? `Code works until ${when(c.codeExpiresAt)}`
                      : `Last check-in: ${c.lastSeenAt ? when(c.lastSeenAt) : "not yet"} · Google Drive: ${c.driveConnected ? "connected" : "not connected"}`}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setBlocking({ id: c.id, label: c.label, blocked: c.state !== "BLOCKED" })
                  }
                >
                  {c.state === "BLOCKED" ? "Unblock" : "Block"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {making && (
        <FormDialog
          title="Make a copy code"
          description="Write who the copy is for. The code is shown once: give it to the buyer."
          submitLabel="Make the code"
          pendingLabel="Making"
          errorTitle="The copy code was not made"
          onClose={() => setMaking(false)}
          onSubmit={async (form) => {
            const result = await makeCopyCodeAction({
              label: form.get("label"),
              pin: form.get("pin") || undefined,
            });
            if (!result.ok) return result.error;
            setMaking(false);
            setCopied(false);
            setMade({ code: result.data.code, codeExpiresAt: result.data.codeExpiresAt });
          }}
        >
          {(fieldError) => (
            <>
              <Field id="copy-label" label="Who it is for" error={fieldError("label")}>
                <Input
                  id="copy-label"
                  name="label"
                  autoComplete="off"
                  placeholder="Rahim Fashions"
                />
              </Field>
              <PinField id="copy-make-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
            </>
          )}
        </FormDialog>
      )}
      {blocking && (
        <FormDialog
          destructive={blocking.blocked}
          title={blocking.blocked ? "Block this copy" : "Unblock this copy"}
          description={
            blocking.blocked
              ? `${blocking.label}: the code stops working, and a copy in use stops sending new backups to Google Drive at its next daily check-in.`
              : `${blocking.label}: the copy may use your Google client again.`
          }
          submitLabel={blocking.blocked ? "Block" : "Unblock"}
          pendingLabel="Saving"
          errorTitle="The copy was not changed"
          onClose={() => setBlocking(null)}
          onSubmit={async (form) => {
            const result = await setCopyBlockedAction({
              copyId: blocking.id,
              blocked: blocking.blocked,
              pin: form.get("pin") || undefined,
            });
            if (!result.ok) return result.error;
            setBlocking(null);
          }}
        >
          {(fieldError) => (
            <PinField id="copy-block-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
          )}
        </FormDialog>
      )}
    </Panel>
  );
}

// =============================================================================
// Cloudflare (G9)
// =============================================================================

export const CLOUDFLARE_STEPS = [
  "Sign in at dash.cloudflare.com.",
  "Click the person icon at the top right, then My Profile.",
  "On the left, click API Tokens, then Create Token.",
  "Next to Edit zone DNS, click Use template.",
  "Under Permissions, keep Zone, DNS, Edit, and click Add more to add Zone, Zone, Read.",
  "Under Zone Resources, choose Include, Specific zone, and your domain (for example extasbd.com).",
  "Click Continue to summary, then Create Token.",
  "Copy the token (Cloudflare shows it once) and paste it here with your domain and PIN.",
];

function CloudflarePanel({ config, setMessage }: PanelProps) {
  const when = useWhen({ year: true });
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<"set" | "remove" | null>(null);
  const cf = config.cloudflare;
  return (
    <Panel
      title="Cloudflare (for a new server)"
      id="backups-cloudflare-heading"
      action={
        <div className="flex flex-wrap gap-2">
          {cf.set && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await testCloudflareAction();
                  setMessage(
                    result.ok
                      ? {
                          tone: "success",
                          text: `The Cloudflare token works.${result.data.records
                            .map((r) => ` ${r.name} points to ${r.content}.`)
                            .join("")}`,
                        }
                      : { tone: "error", text: result.error.message },
                  );
                })
              }
            >
              Test
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={cf.set ? "outline" : "default"}
            onClick={() => setAsking("set")}
          >
            <GlobeIcon aria-hidden />
            {cf.set ? "Change the token" : "Save the Cloudflare token"}
          </Button>
        </div>
      }
    >
      <div className="mt-3 grid gap-3 text-sm">
        <p className="text-muted-foreground">
          On a new server, the restore points your domain at the new server and gets the HTTPS
          certificate by itself, using this token. It can only read your domain and edit its DNS
          records, nothing else.
        </p>
        {cf.set ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="done">Saved</StatusBadge>
            <span>{cf.zone}</span>
            <span className="text-muted-foreground">token ending {cf.tokenHint}</span>
            {cf.checkedAt && (
              <span className="text-muted-foreground">checked {when(cf.checkedAt)}</span>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setAsking("remove")}>
              Remove
            </Button>
          </div>
        ) : (
          <p>Not saved. Without it, a new server needs you to change the DNS by hand.</p>
        )}
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer font-medium">How to make the token</summary>
          <ol className="mt-2 grid list-decimal gap-1 pl-5">
            {CLOUDFLARE_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>
      </div>

      {asking === "set" && (
        <FormDialog
          title="Save the Cloudflare token"
          description="Cloudflare is asked whether the token works before it is saved. It is never shown again."
          submitLabel="Save and test"
          pendingLabel="Asking Cloudflare"
          errorTitle="The token was not saved"
          onClose={() => setAsking(null)}
          onSubmit={async (form) => {
            const result = await setCloudflareAction({
              pin: form.get("pin") || undefined,
              zone: String(form.get("zone") ?? ""),
              token: String(form.get("token") ?? ""),
            });
            if (!result.ok) return result.error;
            setAsking(null);
            setMessage({ tone: "success", text: "The Cloudflare token works and is saved." });
          }}
        >
          {(fieldError) => (
            <>
              <Field
                id="cf-zone"
                label="Your domain"
                hint="For example extasbd.com"
                error={fieldError("zone")}
              >
                <Input id="cf-zone" name="zone" autoComplete="off" defaultValue={cf.zone ?? ""} />
              </Field>
              <Field id="cf-token" label="API token" error={fieldError("token")}>
                <Input id="cf-token" name="token" type="password" autoComplete="off" />
              </Field>
              <PinField id="cf-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
            </>
          )}
        </FormDialog>
      )}
      {asking === "remove" && (
        <FormDialog
          destructive
          title="Remove the Cloudflare token"
          description="A new server then needs the DNS changed by hand."
          submitLabel="Remove"
          pendingLabel="Removing"
          errorTitle="It was not removed"
          onClose={() => setAsking(null)}
          onSubmit={async (form) => {
            const result = await clearCloudflareAction({ pin: form.get("pin") || undefined });
            if (!result.ok) return result.error;
            setAsking(null);
            setMessage({ tone: "note", text: "The Cloudflare token is removed." });
          }}
        >
          {(fieldError) => (
            <PinField id="cf-remove-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
          )}
        </FormDialog>
      )}
    </Panel>
  );
}

// =============================================================================
// The late-backup alert on GitHub (A13)
// =============================================================================

export const GITHUB_ALERT_STEPS = [
  "Sign in at github.com with the account that owns the ERP's repository.",
  "Click your picture at the top right, then Settings, then Developer settings (at the bottom on the left).",
  "Click Personal access tokens, then Fine-grained tokens, then Generate new token.",
  "Name it Backup alert and set Expiration to 1 day: it is used once.",
  "Under Repository access, choose Only select repositories and pick the ERP's repository.",
  "Under Repository permissions, set Secrets to Read and write.",
  "Click Generate token, copy it and paste it here with your PIN.",
];

function GitHubAlertPanel({
  config,
  githubRepo,
  setMessage,
}: PanelProps & { githubRepo: string | null }) {
  const when = useWhen({ year: true });
  const [asking, setAsking] = useState(false);
  const alert = config.githubAlert;
  return (
    <Panel
      title="Late-backup alert on GitHub"
      id="backups-github-alert-heading"
      action={
        <Button
          type="button"
          size="sm"
          variant={alert.setAt ? "outline" : "default"}
          onClick={() => setAsking(true)}
        >
          <BellIcon aria-hidden />
          {alert.setAt ? "Set it up again" : "Set up the alert on GitHub"}
        </Button>
      }
    >
      <div className="mt-3 grid gap-3 text-sm">
        <p className="text-muted-foreground">
          Every 6 hours GitHub looks at the newest backup in Google Drive and tells you on Telegram
          when it is late, even when this server is down. Once a week it says all is well. The ERP
          sends GitHub what it needs, locked so only GitHub can read it: nothing is shown here.
        </p>
        {alert.setAt ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StatusBadge tone="done">Set up</StatusBadge>
            <span className="break-all">{alert.repo}</span>
            <span className="text-muted-foreground">{when(alert.setAt)}</span>
          </div>
        ) : (
          <p>Not set up. Connect Google Drive and the Telegram bot first.</p>
        )}
        <p className="text-muted-foreground">
          Set it up again after you connect Google Drive or the Telegram bot again. To try it, open
          the repository&apos;s Actions tab, choose Backup watch, then Run workflow: a message comes
          on Telegram.
        </p>
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer font-medium">How to make the GitHub token</summary>
          <ol className="mt-2 grid list-decimal gap-1 pl-5">
            {GITHUB_ALERT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>
      </div>

      {asking && (
        <FormDialog
          title="Set up the alert on GitHub"
          description="The ERP locks its Google Drive sign-in and the Telegram bot to your repository's key and sends them to GitHub. The token is used once and not kept."
          submitLabel="Send to GitHub"
          pendingLabel="Sending to GitHub"
          errorTitle="The alert was not set up"
          onClose={() => setAsking(false)}
          onSubmit={async (form) => {
            const result = await setUpGitHubAlertAction({
              pin: form.get("pin") || undefined,
              repo: String(form.get("repo") ?? ""),
              token: String(form.get("token") ?? ""),
            });
            if (!result.ok) return result.error;
            setAsking(false);
            setMessage({
              tone: "success",
              text: `The alert is set up on GitHub (${result.data.repo}). Try it: Actions, Backup watch, Run workflow.`,
            });
          }}
        >
          {(fieldError) => (
            <>
              <Field
                id="gh-alert-repo"
                label="Repository"
                hint="For example mehadih32/Extas-ERP"
                error={fieldError("repo")}
              >
                <Input
                  id="gh-alert-repo"
                  name="repo"
                  autoComplete="off"
                  defaultValue={alert.repo ?? githubRepo ?? ""}
                />
              </Field>
              <Field id="gh-alert-token" label="GitHub token" error={fieldError("token")}>
                <Input id="gh-alert-token" name="token" type="password" autoComplete="off" />
              </Field>
              <PinField id="gh-alert-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
            </>
          )}
        </FormDialog>
      )}
    </Panel>
  );
}

// =============================================================================
// The backups in Google Drive, and restore
// =============================================================================

function DriveBackupsPanel({
  ready,
  keyInDrive,
  setMessage,
}: {
  ready: boolean;
  keyInDrive: boolean;
  setMessage: SetMessage;
}) {
  const when = useWhen({ year: true });
  const [items, setItems] = useState<DriveBackup[] | null>(null);
  const [error, setError] = useState<string>();
  const [restoring, setRestoring] = useState<DriveBackup | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    void reach(() => listDriveBackupsAction()).then((result) => {
      if (result.ok) setItems(result.data.items);
      else setError(result.error.message);
    });
    void reach(() => restoreStatusAction()).then((result) => {
      if (result.ok && result.data.waiting) setWaiting(String(result.data.waiting.name));
    });
  }, [ready]);

  return (
    <Panel title="Backups in Google Drive" id="backups-list-heading">
      <div className="mt-3 grid gap-3 text-sm">
        {!ready && (
          <p className="text-muted-foreground">
            Set your recovery key and connect Google Drive first.
          </p>
        )}
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {waiting && (
          <FormAlert tone="note">
            The restore of {waiting} is with the server: it saves a safety copy, restores, starts
            the ERP again and checks every screen. The ERP stops for a few minutes; the result comes
            to your inbox and Telegram.
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
                    <td className="py-2 pr-3">
                      {KIND[b.kind]}
                      {b.format === 2 && (
                        <span className="block text-xs text-muted-foreground">
                          Old key card (key {b.keyId})
                        </span>
                      )}
                    </td>
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
              key: String(form.get("key") ?? "") || undefined,
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
              {(!keyInDrive || restoring.format === 2) && (
                <Field
                  id="restore-key"
                  label={restoring.format === 2 ? "Old key card" : "Recovery key"}
                  error={fieldError("key")}
                >
                  <Input id="restore-key" name="key" type="password" autoComplete="off" />
                </Field>
              )}
              <PinField id="restore-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
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

// =============================================================================
// A new server (G8)
// =============================================================================

function NewServerPanel({ overview }: { overview: Overview }) {
  const { command, commandLines } = overview.newServer;
  const [copied, setCopied] = useState(false);
  return (
    <Panel
      title="Restore on a new server"
      id="backups-new-server-heading"
      action={
        <div className="flex flex-wrap gap-2">
          <GuideLinks />
        </div>
      }
    >
      <div className="mt-3 grid gap-3 text-sm">
        <p className="text-muted-foreground">
          If this server is lost, the restore guide takes you from a new Azure server to a working
          ERP, step by step: make the server, open PuTTY, paste the one command below, answer its
          questions and approve the Google sign-in on your phone. Keep the guide on your computer.
        </p>
        {command ? (
          <div className="grid min-w-0 gap-2">
            <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap">
              {commandLines ? commandLines.join("\n") : command}
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(command);
                  setCopied(true);
                }}
              >
                <CopyIcon aria-hidden />
                {copied ? "Copied" : "Copy the command"}
              </Button>
              <span className="text-xs text-muted-foreground">
                It holds no password or key: it asks for what it needs.
              </span>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2">
            <ServerIcon aria-hidden className="size-4 shrink-0" />
            The command is ready after the next update of the server.
          </p>
        )}
      </div>
    </Panel>
  );
}
