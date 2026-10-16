import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import { createSkill } from "@/modules/ai/skills.service";

/*
 * The v6.3 sample on the demo site: a skill taught to the fabric expert (X05)
 * in plain words, the way the owner would, with two examples. It waits for its
 * test (the AI stays off on the demo too), so AI Center > Skills and Agents
 * show a real skill with its version, examples and "Not tested". Once: when
 * the sample skill is there already it does nothing.
 */

export const V63_SAMPLE_SKILL = "Sample: pique polo fabric check";

export async function loadV63Samples(ctx: CompanyContext) {
  const there = await prisma.aiSkillVersion.findFirst({
    where: { companyId: ctx.company.id, name: V63_SAMPLE_SKILL },
    select: { id: true },
  });
  if (there) return null;
  const skill = await createSkill(ctx, "X05", {
    name: V63_SAMPLE_SKILL,
    whenToUse: "যখন পিকে পোলো শার্টের ফ্যাব্রিক বুকিং বা টেক প্যাকের ফ্যাব্রিক পাতা দেখতে হবে",
    steps: [
      "1. Read the fabric, GSM and composition on the booking",
      "2. A pique polo needs 200 to 240 GSM; 100% cotton or 60/40 CVC",
      "3. Shrinkage after wash must be within 5% length and width",
      "4. Name the booking and the line that is off",
    ].join("\n"),
    dos: "Name the booking and the style\nSay what the buyer's tech pack asks for",
    donts: "Never change the booking yourself\nNever write to the buyer",
    examples: [
      {
        situation: "A pique polo booking says 160 GSM, 100% cotton.",
        answer: "Too light for a pique polo: ask the mill for 200 to 240 GSM.",
      },
      {
        situation: "A pique polo booking says 220 GSM, 60/40 CVC, shrinkage 3%.",
        answer: "Fine: 220 GSM CVC with 3% shrinkage is inside the rules.",
      },
    ],
    notes: "Nordic Wear AB wants 220 GSM pique for every polo.",
  });
  return { id: skill.id, name: V63_SAMPLE_SKILL };
}
