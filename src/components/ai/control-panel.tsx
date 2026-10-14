"use client";

import { ChevronRightIcon, ClockIcon, LockIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { CELL_HINTS, CELL_LABELS, type CellState } from "@/modules/ai/control-tree";
import type { AiControl, AiControlNode } from "@/modules/ai/control.service";
import {
  applyPresetAction,
  endGrantAction,
  giveGrantAction,
  setControlCellAction,
} from "@/server/actions/ai.actions";

/*
 * Control: the access tree with Do / Ask / Off on every cell. Setting an area
 * sets everything in it; a cell set differently from its area is an exception,
 * shown in amber. A lock marks cells that ask you even when their area is Do
 * (money, prices, anything that leaves the company); what goes to a buyer is
 * never Do. Presets set many cells at once; a grant opens a cell for a while.
 */

const STATES: CellState[] = ["DO", "ASK", "OFF"];

const STATE_STYLES: Record<CellState, string> = {
  DO: "bg-primary text-primary-foreground",
  ASK: "bg-secondary text-primary",
  OFF: "bg-muted text-muted-foreground",
};

function CellSwitch({
  node,
  disabled,
  onSet,
}: {
  node: AiControlNode;
  disabled: boolean;
  onSet: (state: CellState) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`${node.label}: what the AI may do`}
      className="inline-flex shrink-0 overflow-hidden rounded-md border"
    >
      {STATES.map((state) => {
        const chosen = node.state === state;
        const blocked = state === "DO" && node.most !== "DO";
        return (
          <button
            key={state}
            type="button"
            role="radio"
            aria-checked={chosen}
            title={blocked ? "What goes to a buyer always waits for your OK" : CELL_HINTS[state]}
            disabled={disabled || blocked}
            onClick={() => !chosen && onSet(state)}
            className={cn(
              "min-w-11 px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              chosen ? STATE_STYLES[state] : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {CELL_LABELS[state]}
          </button>
        );
      })}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  canManage,
  pending,
  onSet,
}: {
  node: AiControlNode;
  depth: number;
  canManage: boolean;
  pending: boolean;
  onSet: (node: AiControlNode, state: CellState) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const branch = Boolean(node.children);
  return (
    <li className="grid gap-1">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md px-2 py-1.5",
          node.exception && "bg-amber-50 dark:bg-amber-950/30",
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {branch ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="inline-flex min-w-0 items-center gap-1 text-left text-sm font-medium"
            >
              <ChevronRightIcon
                aria-hidden
                className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")}
              />
              <span className="break-words">{node.label}</span>
            </button>
          ) : (
            <span className="min-w-0 pl-5 text-sm break-words">{node.label}</span>
          )}
          {node.locked && (
            <LockIcon
              aria-label="Asks you even when its area is Do"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          )}
          {node.exception && (
            <span className="text-[0.75rem] text-amber-700 dark:text-amber-500">
              set on its own
            </span>
          )}
          {node.heldAtAsk && <span className="text-[0.75rem] text-muted-foreground">asks you</span>}
          {node.granted && (
            <span className="inline-flex items-center gap-1 text-[0.75rem] text-primary">
              <ClockIcon aria-hidden className="size-3" />
              open now
            </span>
          )}
        </div>
        <CellSwitch node={node} disabled={!canManage || pending} onSet={(s) => onSet(node, s)} />
      </div>
      {branch && open && (
        <ul className="grid gap-1 border-l pl-3 sm:ml-2 sm:pl-4">
          {node.children!.map((child) => (
            <TreeNode
              key={child.ref}
              node={child}
              depth={depth + 1}
              canManage={canManage}
              pending={pending}
              onSet={onSet}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Every cell with its path, for the grant picker ("Accounts › The books"). */
function flatten(node: AiControlNode, path: string[] = []): Array<{ ref: string; text: string }> {
  const here = node.ref === "b:all" ? [] : [...path, node.label];
  const self = node.ref === "b:all" ? [] : [{ ref: node.ref, text: here.join(" › ") }];
  return [...self, ...(node.children ?? []).flatMap((c) => flatten(c, here))];
}

const when = (at: Date | string | null) =>
  at
    ? new Date(at).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "until you end it";

export function ControlPanel({ control: c }: { control: AiControl }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();
  const [preset, setPreset] = useState<(typeof c.presets)[number] | null>(null);
  const [granting, setGranting] = useState(false);
  const canManage = c.can.manage;

  const setNode = (node: AiControlNode, state: CellState) =>
    startTransition(async () => {
      const result = await setControlCellAction({ node: node.ref, state });
      setMessage(
        result.ok
          ? {
              tone: "success",
              text: `${node.label}: ${CELL_LABELS[state]}${node.children ? ", with everything in it" : ""}.`,
            }
          : { tone: "error", text: result.error.message },
      );
    });

  return (
    <div className="grid gap-6">
      {!c.enabled && (
        <FormAlert tone="note">
          AI is off, so nothing here runs yet. You can still set it up before you turn AI on.
        </FormAlert>
      )}
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}

      {canManage && (
        <Panel title="Presets" id="presets-heading">
          <p className="mt-1 text-sm text-muted-foreground">
            One click sets many cells. Locked cells still ask you, and buyer messages always wait
            for your OK.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {c.presets.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPreset(p)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="What the AI may do"
        id="control-tree-heading"
        action={
          canManage ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setGranting(true)}>
              <ClockIcon aria-hidden />
              Open a cell for a while
            </Button>
          ) : undefined
        }
      >
        <dl className="mt-3 grid gap-1 text-[0.8125rem] text-muted-foreground sm:grid-cols-3">
          {STATES.map((s) => (
            <div key={s} className="flex gap-1.5">
              <dt className="font-medium text-foreground">{CELL_LABELS[s]}:</dt>
              <dd>{CELL_HINTS[s]}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-4 grid gap-1" aria-label="Control cells">
          <TreeNode
            node={c.tree}
            depth={0}
            canManage={canManage}
            pending={pending}
            onSet={setNode}
          />
        </ul>
        <p className="mt-4 text-[0.8125rem] text-muted-foreground">
          Deleting has no cell: the AI never deletes data. It sends you a Deletion request instead.
          It can never change roles or permissions, and it never sees backups.
        </p>
      </Panel>

      <Panel title="Open for a while" id="grants-heading">
        {c.grants.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing is open for a while now. Cells opened for today, until a date or for one task
            show here and close by themselves.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {c.grants.map((g) => (
              <li
                key={g.id}
                className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="grid min-w-0 gap-0.5 text-sm">
                  <span className="font-medium break-words">{g.note ?? g.path}</span>
                  <span className="text-[0.8125rem] text-muted-foreground">
                    {g.record ? `${g.record} · ` : ""}
                    Ends {when(g.expiresAt)}
                    {g.by ? ` · opened by ${g.by}` : ""}
                  </span>
                </div>
                {canManage && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await endGrantAction(g.id);
                        setMessage(
                          result.ok
                            ? { tone: "success", text: "Closed again." }
                            : { tone: "error", text: result.error.message },
                        );
                      })
                    }
                  >
                    End now
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {preset && (
        <FormDialog
          title={`${preset.label}?`}
          description={preset.hint}
          submitLabel="Use this preset"
          pendingLabel="Saving"
          errorTitle="We could not use the preset"
          onClose={() => setPreset(null)}
          onSubmit={async () => {
            const result = await applyPresetAction(preset.id);
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: `${preset.label}: done.` });
            setPreset(null);
          }}
        >
          {() => null}
        </FormDialog>
      )}

      {granting && (
        <GrantDialog
          cells={flatten(c.tree)}
          onClose={() => setGranting(false)}
          onDone={(text) => {
            setMessage({ tone: "success", text });
            setGranting(false);
          }}
        />
      )}
    </div>
  );
}

function GrantDialog({
  cells,
  onClose,
  onDone,
}: {
  cells: Array<{ ref: string; text: string }>;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [scope, setScope] = useState<"TODAY" | "UNTIL">("TODAY");
  return (
    <FormDialog
      title="Open a cell for a while"
      description="The cell works as Do until the time is up, then goes back to its own setting by itself. Locked cells open only when you pick that exact cell."
      submitLabel="Open it"
      pendingLabel="Opening"
      errorTitle="We could not open the cell"
      onClose={onClose}
      onSubmit={async (form) => {
        const node = String(form.get("node") ?? "");
        const until = String(form.get("until") ?? "");
        const result = await giveGrantAction({
          node,
          scope,
          ...(scope === "UNTIL" ? { until } : {}),
        });
        if (!result.ok) return result.error;
        onDone(
          `${cells.find((c) => c.ref === node)?.text ?? "The cell"} is open ${
            scope === "TODAY" ? "for today" : `until ${until}`
          }.`,
        );
      }}
    >
      {(fieldError) => (
        <div className="grid gap-4">
          <Field id="grant-node" label="Cell" error={fieldError("node")}>
            <NativeSelect id="grant-node" name="node" containerClassName="sm:w-full" required>
              {cells.map((c) => (
                <option key={c.ref} value={c.ref}>
                  {c.text}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="grant-scope" label="For how long">
            <NativeSelect
              id="grant-scope"
              containerClassName="sm:w-full"
              value={scope}
              onChange={(e) => setScope(e.target.value as "TODAY" | "UNTIL")}
            >
              <option value="TODAY">For today</option>
              <option value="UNTIL">Until a date</option>
            </NativeSelect>
          </Field>
          {scope === "UNTIL" && (
            <Field id="grant-until" label="Last day" error={fieldError("until")}>
              <Input id="grant-until" name="until" type="date" required />
            </Field>
          )}
        </div>
      )}
    </FormDialog>
  );
}
