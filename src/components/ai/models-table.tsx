"use client";

import { useState, useTransition } from "react";

import { FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { AI_MODELS, modelInfo } from "@/modules/ai/models";
import type { AiModelsScreen } from "@/modules/ai/settings.service";
import { setFableAllowedAction, setTaskModelAction } from "@/server/actions/ai.actions";

/*
 * Models: which Claude model does each task. The system's choice is the big
 * model for thinking work and smaller ones for the rest; the owner can change
 * any task. Fable 5.1 costs the most and runs only while the owner allows it.
 */

const nameOf = (id: string) => modelInfo(id)?.label ?? id;

const dollars = (n: number) => `$${n < 1 ? n.toFixed(2) : n.toFixed(0)}`;

export function ModelsTable({ models: m }: { models: AiModelsScreen }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();
  const canManage = m.can.manage;

  const choose = (task: (typeof m.tasks)[number], value: string) =>
    startTransition(async () => {
      const result = await setTaskModelAction({ task: task.key, model: value || null });
      setMessage(
        result.ok
          ? {
              tone: "success",
              text: `${task.label}: ${value ? nameOf(value) : `back to ${nameOf(task.system)}`}.`,
            }
          : { tone: "error", text: result.error.message },
      );
    });

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}

      <Panel title="Which model does which task" id="ai-task-models-heading">
        <p className="mt-1 text-sm text-muted-foreground">
          The big model thinks (plans, costing, tech packs, checks); the medium one writes; the
          small one reads forms and gathers data. Change a task only when its work needs it.
        </p>
        <ul className="mt-4 divide-y">
          {m.tasks.map((t) => (
            <li
              key={t.key}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="grid min-w-0 gap-0.5">
                <span className="text-sm font-medium break-words">{t.label}</span>
                <span className="text-[0.8125rem] text-muted-foreground">
                  {t.module} · Runs on {nameOf(t.runsOn)}
                  {t.chosen && t.chosen !== t.runsOn
                    ? ` (${nameOf(t.chosen)} is not allowed now)`
                    : ""}
                </span>
              </div>
              {canManage ? (
                <NativeSelect
                  aria-label={`Model for ${t.label}`}
                  containerClassName="sm:w-64"
                  value={t.chosen ?? ""}
                  disabled={pending}
                  onChange={(e) => choose(t, e.target.value)}
                >
                  <option value="">System&apos;s choice ({nameOf(t.system)})</option>
                  {AI_MODELS.filter((x) => x.id !== t.system).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                      {x.id === "claude-fable-5-1" && !m.allowFable ? " (allow it below)" : ""}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <StatusBadge tone={t.chosen ? "warn" : "plain"}>
                  {t.chosen ? "Set by the owner" : "System's choice"}
                </StatusBadge>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Fable 5.1"
        id="ai-fable-heading"
        action={
          canManage ? (
            <Button
              type="button"
              size="sm"
              variant={m.allowFable ? "outline" : "default"}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await setFableAllowedAction(!m.allowFable);
                  setMessage(
                    result.ok
                      ? {
                          tone: "success",
                          text: m.allowFable ? "Fable 5.1 is stopped." : "Fable 5.1 is allowed.",
                        }
                      : { tone: "error", text: result.error.message },
                  );
                })
              }
            >
              {m.allowFable ? "Stop Fable 5.1" : "Allow Fable 5.1"}
            </Button>
          ) : undefined
        }
      >
        <p className="mt-1 text-sm text-muted-foreground">
          {m.allowFable
            ? "Allowed: tasks set to Fable 5.1 run on it. It costs the most, so stop it when the hard problem is solved."
            : "Not allowed: Fable 5.1 costs the most. Allow it only for a very hard problem; until then, tasks set to it run on their own model."}
        </p>
      </Panel>

      <Panel title="Prices" id="ai-prices-heading">
        <p className="mt-1 text-sm text-muted-foreground">
          US dollars per million tokens (about 750,000 words), from the Claude price list.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b text-left text-[0.8125rem] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Model</th>
                <th className="py-2 pr-3 font-medium">Size</th>
                <th className="py-2 pr-3 text-right font-medium">Reading</th>
                <th className="py-2 text-right font-medium">Writing</th>
              </tr>
            </thead>
            <tbody>
              {AI_MODELS.map((x) => (
                <tr key={x.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{x.label}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{x.size}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{dollars(x.input)}</td>
                  <td className="py-2 text-right tabular-nums">{dollars(x.output)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
