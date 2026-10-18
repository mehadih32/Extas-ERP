"use client";

import {
  ExternalLinkIcon,
  GitMergeIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  ScanSearchIcon,
  SendIcon,
  WandSparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { usePinPrompt } from "@/components/ai/pin-prompt";
import { useWhen } from "@/components/ai/when";
import { Field, FormAlert } from "@/components/forms/field";
import { type Tone, StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { reach } from "@/lib/reach";
import type { FullCheckScreen as Check } from "@/modules/ai/full-check/full-check.service";
import { noProblemsText } from "@/modules/ai/full-check/texts";
import {
  askClaudeCodeAction,
  lookAgainAction,
  mergeFixAction,
  removeGitHubAction,
  saveGitHubAction,
  sendFixAction,
  startFullCheckAction,
  testGitHubAction,
} from "@/server/actions/full-check.actions";

/*
 * AI Center > Full check (the platform owner only): connect GitHub, run the
 * check on GitHub's computers, read each problem with its screenshot, send one
 * or all to Claude Code, ask Claude Code for something new, and merge a ready
 * fix with the PIN (the Deploy workflow then installs it safely).
 */

type Message = { tone: "success" | "error"; text: string };
type Run = Check["runs"][number];
type Problem = Check["problems"][number];
type Fix = NonNullable<Check["requests"][number]["fix"]>;

/** How often the page looks again while a check runs or a fix is on its way. */
const WATCH_MS = 15_000;

const RUN_STATUS: Record<string, { text: string; tone: Tone }> = {
  STARTING: { text: "Starting on GitHub", tone: "open" },
  RUNNING: { text: "Checking now", tone: "open" },
  DONE: { text: "Finished", tone: "done" },
  FAILED: { text: "Did not finish", tone: "warn" },
};

const REQUEST_TONE: Record<string, Tone> = {
  SENT: "open",
  PR_OPEN: "open",
  MERGED: "done",
  STOPPED: "closed",
};

export function FullCheckScreen({ check: c }: { check: Check }) {
  const router = useRouter();
  const when = useWhen({ year: true });
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message>();
  const { withPin, dialog: pinDialog } = usePinPrompt();
  const shown = c.runs.find((r) => r.id === c.shown) ?? null;
  const waiting = !!c.going || c.requests.some((r) => r.state === "SENT" || r.state === "PR_OPEN");

  // A check runs on GitHub, and Claude Code works there: look again now and then.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), WATCH_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);

  const run = (
    work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>,
    done: string,
  ) =>
    startTransition(async () => {
      const result = await reach(work);
      setMessage(
        result.ok ? { tone: "success", text: done } : { tone: "error", text: result.error.message },
      );
      if (result.ok) router.refresh();
    });

  const unsent = c.problems.filter((p) => !p.request).length;
  // Claude Code works only once main is locked on GitHub (the server checks it again each time).
  const canSend = c.github.connected && c.github.mainLocked === true;

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
      {pinDialog}

      <Panel
        title="Full check"
        id="full-check-heading"
        action={
          <Button
            type="button"
            size="sm"
            disabled={pending || !c.github.connected || !!c.going}
            onClick={() =>
              run(
                startFullCheckAction,
                "GitHub is starting the Full check. It takes up to about 25 minutes; this page shows the report when it is done.",
              )
            }
          >
            <ScanSearchIcon aria-hidden />
            Run the full check
          </Button>
        }
      >
        <div className="mt-2 grid gap-3 text-sm">
          <p className="text-muted-foreground">
            GitHub&apos;s computer opens every screen as you and as each role, every PDF, every link
            and every button that changes nothing, and lists each problem with a screenshot. It
            takes up to about 25 minutes.{" "}
            {c.site === "live"
              ? "This is the live site, so the check only reads: it never changes data here. Anything that writes is checked on the demo site."
              : "This is the demo site, so the check may also press buttons that write."}
          </p>
          {!c.github.connected && (
            <p className="text-muted-foreground">Connect GitHub below first.</p>
          )}
          {c.github.connected && c.github.mainLocked !== true && <LockMainFirst />}
          {c.going && (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="open">
                {RUN_STATUS[c.going.status]?.text ?? c.going.status}
              </StatusBadge>
              <span className="text-muted-foreground">Started {when(c.going.startedAt)}</span>
              {c.going.githubRunUrl && (
                <a
                  href={c.going.githubRunUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  Watch it on GitHub
                  <ExternalLinkIcon aria-hidden className="size-3.5" />
                </a>
              )}
            </div>
          )}
        </div>
      </Panel>

      {shown ? (
        <Panel
          title="What the check found"
          id="full-check-report-heading"
          action={
            unsent > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || !canSend}
                onClick={() =>
                  run(
                    () => sendFixAction({ runId: shown.id }),
                    "Sent to Claude Code as one issue. Its pull request shows below when it is ready.",
                  )
                }
              >
                <WandSparklesIcon aria-hidden />
                Fix all
              </Button>
            ) : undefined
          }
        >
          <RunSummary run={shown} when={when} />
          {c.problems.length === 0 ? (
            shown.status === "DONE" ? (
              <p className="mt-4 text-sm">{noProblemsText(shown.summary)}</p>
            ) : null
          ) : (
            <ul className="mt-4 grid gap-3">
              {c.problems.map((p) => (
                <ProblemRow
                  key={p.id}
                  problem={p}
                  pending={pending}
                  connected={canSend}
                  onFix={() =>
                    run(
                      () => sendFixAction({ problemIds: [p.id] }),
                      "Sent to Claude Code. Its pull request shows below when it is ready.",
                    )
                  }
                />
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <p className="text-sm text-muted-foreground">
          No finished check yet. Press Run the full check.
        </p>
      )}

      {c.runs.length > 0 && (
        <Panel title="Checks" id="full-check-runs-heading">
          <ul className="mt-3 grid gap-2 text-sm">
            {c.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                <span>{when(r.startedAt)}</span>
                <span className="text-muted-foreground">
                  {r.site === "demo" ? "Demo site" : "Live site"}
                  {r.by ? `, ${r.by}` : ""}
                </span>
                <StatusBadge tone={RUN_STATUS[r.status]?.tone ?? "plain"}>
                  {RUN_STATUS[r.status]?.text ?? r.status}
                </StatusBadge>
                {r.status === "DONE" && (
                  <span>
                    {r.problems} problem{r.problems === 1 ? "" : "s"}
                  </span>
                )}
                {r.note && <span className="text-muted-foreground">{r.note}</span>}
                {r.status === "DONE" && r.id !== c.shown && (
                  <Link
                    href={`/ai/full-check?run=${r.id}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Show
                  </Link>
                )}
                {r.githubRunUrl && (
                  <a
                    href={r.githubRunUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    On GitHub
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <AskPanel
        pending={pending}
        connected={canSend}
        locked={!c.github.connected || c.github.mainLocked === true}
        onAsk={(text, clear) =>
          startTransition(async () => {
            const result = await askClaudeCodeAction({ text });
            setMessage(
              result.ok
                ? {
                    tone: "success",
                    text: `Sent to Claude Code as issue #${result.data.issueNumber}. Its pull request shows below when it is ready.`,
                  }
                : { tone: "error", text: result.error.message },
            );
            if (result.ok) {
              clear();
              router.refresh();
            }
          })
        }
      />

      <Panel
        title="Claude Code"
        id="full-check-requests-heading"
        action={
          c.requests.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || !c.github.connected}
              onClick={() => run(lookAgainAction, "Looked on GitHub again.")}
            >
              <RefreshCwIcon aria-hidden />
              Look again
            </Button>
          ) : undefined
        }
      >
        {c.requests.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing sent to Claude Code yet. The ERP looks on GitHub every 2 minutes and tells you
            when a fix is ready to merge.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {c.requests.map((r) => (
              <li key={r.id} className="grid gap-2 rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={REQUEST_TONE[r.state] ?? "plain"}>
                    {r.kind === "FIX" ? "Fix" : "Request"}
                  </StatusBadge>
                  <span className="font-medium">{r.title}</span>
                </div>
                <p>{r.stateText}</p>
                <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                  <span>
                    {when(r.createdAt)}
                    {r.by ? `, ${r.by}` : ""}
                  </span>
                  {r.issueUrl && (
                    <a
                      href={r.issueUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Issue #{r.issueNumber}
                    </a>
                  )}
                  {r.prUrl && (
                    <a
                      href={r.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      PR #{r.prNumber}
                    </a>
                  )}
                </div>
                {r.state === "PR_OPEN" && r.fix && <FixFacts fix={r.fix} />}
                {r.canMerge && r.headSha && (
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const sha = r.headSha!;
                          const result = await withPin((pin) => mergeFixAction(r.id, { pin, sha }));
                          setMessage(
                            result.ok
                              ? {
                                  tone: "success",
                                  text: `Merged PR #${r.prNumber}. The safe update installs it now (it backs up first and goes back by itself if anything fails).`,
                                }
                              : { tone: "error", text: result.error.message },
                          );
                          if (result.ok) router.refresh();
                        })
                      }
                    >
                      <GitMergeIcon aria-hidden />
                      Merge
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <GitHubPanel github={c.github} pending={pending} run={run} />
    </div>
  );
}

/** How many changed files are listed before "and N more". */
const FILES_SHOWN = 15;

/** Who opened a fix's pull request and the files it changes, read before Merge. */
function FixFacts({ fix }: { fix: Fix }) {
  const careful = new Set(fix.careful);
  return (
    <div className="grid gap-2 rounded-md bg-muted/40 p-2 text-xs">
      <p>
        Opened by <span className="font-medium">{fix.author ?? "someone"}</span>
        {fix.openedByErp ? " (the ERP opened it from Claude Code's branch)" : ""}. It changes{" "}
        {fix.filesTotal} file{fix.filesTotal === 1 ? "" : "s"}:
      </p>
      <ul className="grid gap-1">
        {fix.files.slice(0, FILES_SHOWN).map((f) => (
          <li key={f.name} className="flex min-w-0 flex-wrap items-center gap-x-2">
            <code className="min-w-0 break-all">{f.name}</code>
            <span className="text-muted-foreground">
              +{f.added} −{f.removed}
            </span>
            {careful.has(f.name) && <StatusBadge tone="warn">Look twice</StatusBadge>}
          </li>
        ))}
        {fix.filesTotal > FILES_SHOWN && (
          <li className="text-muted-foreground">
            and {fix.filesTotal - FILES_SHOWN} more on GitHub
          </li>
        )}
      </ul>
      {fix.careful.length > 0 && (
        <p className="text-amber-700 dark:text-amber-400">
          {fix.careful.length === 1 ? "One file" : `${fix.careful.length} files`} marked “Look
          twice” run, build or install the ERP, or set Claude Code&apos;s rules: open the pull
          request on GitHub and read them before you merge.
        </p>
      )}
    </div>
  );
}

function RunSummary({ run: r, when }: { run: Run; when: ReturnType<typeof useWhen> }) {
  return (
    <div className="mt-2 grid gap-3 text-sm">
      <p className="text-muted-foreground">
        {r.site === "demo" ? "Demo site" : "Live site"}, {when(r.startedAt)}
        {r.summary
          ? `: ${r.summary.screens} screens, ${r.summary.pdfs} PDFs and files, ${r.summary.links} links in ${Math.round(r.summary.seconds / 60)} minutes.`
          : "."}
      </p>
      {r.summary && r.summary.roles.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-normal">Role</th>
                <th className="py-1 pr-3 font-normal">Checked as</th>
                <th className="py-1 pr-3 font-normal">Screens</th>
                <th className="py-1 pr-3 font-normal">PDFs</th>
                <th className="py-1 font-normal">Note</th>
              </tr>
            </thead>
            <tbody>
              {r.summary.roles.map((x) => (
                <tr key={`${x.role}-${x.member}`} className="border-t">
                  <td className="py-1 pr-3">{x.role}</td>
                  <td className="py-1 pr-3">{x.member}</td>
                  <td className="py-1 pr-3">{x.screens}</td>
                  <td className="py-1 pr-3">{x.pdfs}</td>
                  <td className="py-1 text-muted-foreground">
                    {[
                      x.note?.replace(/\.$/, ""),
                      x.skipped
                        ? `${x.skipped} ${x.skipped === 1 ? "write" : "writes"} stopped`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(". ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProblemRow({
  problem: p,
  pending,
  connected,
  onFix,
}: {
  problem: Problem;
  pending: boolean;
  connected: boolean;
  onFix: () => void;
}) {
  const opens =
    !p.screen.includes("[") && p.screen.startsWith("/") && !p.screen.startsWith("/api/");
  return (
    <li className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-[1fr_auto]">
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={p.kind === "SLOW" ? "open" : "warn"}>{p.kindLabel}</StatusBadge>
          <span className="text-muted-foreground">as {p.role}</span>
        </div>
        <p className="font-medium">{p.text}</p>
        <p className="break-all text-muted-foreground">
          {opens ? (
            <Link href={p.screen} className="text-primary underline-offset-4 hover:underline">
              {p.screen}
            </Link>
          ) : (
            p.screen
          )}
        </p>
        {p.detail && (
          <details>
            <summary className="cursor-pointer text-muted-foreground">Details</summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
              {p.detail}
            </pre>
          </details>
        )}
        <div className="mt-1">
          {p.request ? (
            <p className="text-muted-foreground">Claude Code: {p.request.text}</p>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || !connected}
              onClick={onFix}
            >
              <WandSparklesIcon aria-hidden />
              Fix with Claude Code
            </Button>
          )}
        </div>
      </div>
      {p.shot && (
        <a
          href={`/api/full-check/shots/${p.id}`}
          target="_blank"
          rel="noreferrer"
          className="block w-full sm:w-56"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- served by /api/full-check/shots with its own checks */}
          <img
            src={`/api/full-check/shots/${p.id}`}
            alt={`Screenshot of ${p.screen}`}
            loading="lazy"
            className="w-full rounded border"
          />
        </a>
      )}
    </li>
  );
}

/** Shown until GitHub says main is locked: Claude Code waits for it. */
function LockMainFirst() {
  return (
    <div className="grid gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <p className="font-medium">Lock main first</p>
      <p>
        Nothing goes to Claude Code until the main branch on GitHub has its ruleset, so changes
        reach it only through a pull request (Help: Full check, step 4). Then press Test the
        connection below.
      </p>
    </div>
  );
}

function AskPanel({
  pending,
  connected,
  locked,
  onAsk,
}: {
  pending: boolean;
  connected: boolean;
  /** False while main on GitHub is not locked yet. */
  locked: boolean;
  onAsk: (text: string, clear: () => void) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Panel title="Ask Claude Code" id="full-check-ask-heading">
      <div className="mt-2 grid gap-3 text-sm">
        <p className="text-muted-foreground">
          A new ability or a change, in plain words (English or Bengali). Claude Code makes it with
          a test on GitHub; you merge it here when its checks pass.
        </p>
        <p className="text-amber-700 dark:text-amber-400">
          What you write becomes a GitHub issue that anyone who can see the repository reads. Leave
          out buyer names, prices, phone numbers and other business data.
        </p>
        {!locked && <LockMainFirst />}
        <Field id="ask-claude-code" label="What should Claude Code build or change?">
          <Textarea
            id="ask-claude-code"
            value={text}
            maxLength={4000}
            rows={4}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <div>
          <Button
            type="button"
            size="sm"
            disabled={pending || !connected || text.trim().length < 10}
            onClick={() => onAsk(text, () => setText(""))}
          >
            <SendIcon aria-hidden />
            Send to Claude Code
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function GitHubPanel({
  github: g,
  pending,
  run,
}: {
  github: Check["github"];
  pending: boolean;
  run: (
    work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>,
    done: string,
  ) => void;
}) {
  const [repo, setRepo] = useState(g.repo ?? "");
  const [token, setToken] = useState("");
  return (
    <Panel title="GitHub" id="full-check-github-heading">
      <div className="mt-2 grid gap-3 text-sm">
        <p className="text-muted-foreground">
          The ERP starts the check and talks to Claude Code with a GitHub token for one repository.
          The token is kept locked and never shown again; only its last 4 characters are.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="github-repo" label="Repository" hint="owner/name, e.g. mehadih32/Extas-ERP">
            <Input
              id="github-repo"
              value={repo}
              autoComplete="off"
              onChange={(event) => setRepo(event.target.value)}
            />
          </Field>
          <Field
            id="github-token"
            label="Token"
            hint={
              g.hint
                ? `Saved: ending ${g.hint}. Leave empty to keep it.`
                : "It starts with github_pat_"
            }
          >
            <Input
              id="github-token"
              type="password"
              value={token}
              autoComplete="off"
              onChange={(event) => setToken(event.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await saveGitHubAction({ repo, token });
                if (result.ok) setToken("");
                return result;
              }, "Saved. Press Test the connection.")
            }
          >
            <KeyRoundIcon aria-hidden />
            Save
          </Button>
          {g.connected && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(testGitHubAction, "Tested: read the result below.")}
              >
                Test the connection
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(removeGitHubAction, "The GitHub connection is taken out.")}
              >
                Take out
              </Button>
            </>
          )}
        </div>
        {g.test && (
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={g.test.ok ? "done" : "warn"}>
                {g.test.ok ? "Ready" : "Not ready yet"}
              </StatusBadge>
            </div>
            <ul className="list-disc pl-5">
              {g.test.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
