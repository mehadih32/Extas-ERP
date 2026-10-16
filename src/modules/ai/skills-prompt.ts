import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";

import { agentTasks } from "./agents";
import type { AiTaskKey } from "./models";
import { examplesOf, filesOf, type SkillContent, skillsPrompt } from "./skills";

/*
 * The skills an agent works with (its instructions) and the ones that hold its
 * Do at Ask (not passed yet), read from the database. Kept apart from the
 * skills screen's service, which asks the AI itself.
 */

type Newest = {
  id: string;
  agent: string;
  version: number;
  content: SkillContent;
  passed: boolean | null;
};

/** The newest version of every skill that is on (and of `also`, on or not), per agent. */
async function newestSkills(
  companyId: string,
  where: { agent?: string; also?: string },
  db: Db,
): Promise<Newest[]> {
  const skills = await db.aiSkill.findMany({
    where: {
      companyId,
      ...(where.agent ? { agent: where.agent } : {}),
      OR: [{ on: true }, ...(where.also ? [{ id: where.also }] : [])],
    },
    orderBy: { createdAt: "asc" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  return skills.flatMap((s) => {
    const v = s.versions[0];
    if (!v) return [];
    return [
      {
        id: s.id,
        agent: s.agent,
        version: v.version,
        passed: v.passed,
        content: {
          name: v.name,
          whenToUse: v.whenToUse,
          steps: v.steps,
          dos: v.dos,
          donts: v.donts,
          examples: examplesOf(v.examples),
          notes: v.notes,
          files: filesOf(v.files),
        },
      },
    ];
  });
}

/** The skills part of an agent's instructions (with `also`, a skill being tested), or null. */
export async function agentSkillsText(
  companyId: string,
  agent: string,
  also?: string,
  db: Db = prisma,
): Promise<string | null> {
  const skills = await newestSkills(companyId, { agent, also }, db);
  return skillsPrompt(skills).text;
}

/**
 * The skills that hold Do at Ask for this action: those of the agents doing
 * its AI work (not switched off) whose newest version has not passed its test.
 */
export async function skillsMissingFor(
  companyId: string,
  tasks: readonly AiTaskKey[],
  agentsOff: readonly string[],
  db: Db = prisma,
): Promise<Array<{ agent: string; name: string }>> {
  const skills = await newestSkills(companyId, {}, db);
  return skills
    .filter(
      (s) =>
        s.passed !== true &&
        !agentsOff.includes(s.agent) &&
        agentTasks(s.agent).some((t) => tasks.includes(t)),
    )
    .map((s) => ({ agent: s.agent, name: s.content.name }));
}
