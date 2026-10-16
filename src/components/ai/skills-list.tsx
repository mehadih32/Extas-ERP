"use client";

import { PlusIcon } from "lucide-react";
import Link from "next/link";

import { useDay } from "@/components/ai/when";
import { Field } from "@/components/forms/field";
import { StatusBadge, type Tone } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { SkillStanding } from "@/modules/ai/skills";
import type { SkillList } from "@/modules/ai/skills.service";

/*
 * AI Center > Skills: every skill taught to Mehedi 2.0 and the agents under
 * him (or one agent's), with its version, whether it passed its test and
 * whether it is on. The owner teaches a new one from here.
 */

export const SKILL_TONES: Record<SkillStanding, Tone> = {
  PASSED: "done",
  FAILED: "warn",
  UNTESTED: "open",
  NO_EXAMPLES: "plain",
};

export function SkillsList({ list: l }: { list: SkillList }) {
  const day = useDay();
  const newHref = `/ai/skills/new${l.agent ? `?agent=${encodeURIComponent(l.agent)}` : ""}`;
  return (
    <div className="grid gap-6">
      <Panel
        title="Skills"
        id="ai-skills-heading"
        action={
          l.can.manage ? (
            <Button asChild size="sm">
              <Link href={newHref}>
                <PlusIcon aria-hidden />
                Teach a new skill
              </Link>
            </Button>
          ) : undefined
        }
      >
        <p className="mt-1 text-sm text-muted-foreground">
          What you teach the AI in plain words: when to use the skill, the steps, do&apos;s and
          don&apos;ts, examples and knowledge. Every change is a new version you can undo. An agent
          uses a skill on Do only after its newest version passes the test; until then its work asks
          you first.
        </p>
        <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
          <Field id="skills-agent" label="Agent" className="min-w-56">
            <NativeSelect id="skills-agent" name="agent" defaultValue={l.agent ?? ""}>
              <option value="">Every agent</option>
              {l.agents.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" size="sm" variant="outline">
            Show
          </Button>
        </form>
        {l.skills.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No skills yet{l.agent ? " for this agent" : ""}.
            {l.can.manage ? " Teach one with “Teach a new skill”." : ""}
          </p>
        ) : (
          <ul className="mt-4 divide-y">
            {l.skills.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="grid min-w-0 gap-1">
                  <Link
                    href={`/ai/skills/${s.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {s.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {s.agentName} · version {s.version} · {s.examples} examples · {s.files} files ·
                    changed {day(s.updatedAt)}
                  </span>
                  <span className="line-clamp-2 text-sm">{s.whenToUse}</span>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <StatusBadge tone={SKILL_TONES[s.test.standing]}>{s.test.text}</StatusBadge>
                  {!s.on && <StatusBadge tone="closed">Switched off</StatusBadge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
