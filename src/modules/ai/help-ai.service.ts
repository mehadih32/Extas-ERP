import { z } from "zod";

import { AppError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import type { CompanyContext } from "@/modules/auth/context";
import { findHelpArticle, helpSearchEntries } from "@/modules/help";
import { guideText } from "@/modules/help/guide-text";
import { rankHelp } from "@/modules/help/search";

import { aiReady, askClaude, textOf } from "./claude";
import { getMonthCost } from "./costs.service";

/*
 * The Help AI (Help Center > "Ask the Help AI"): anyone signed in asks how to
 * do something, in Bengali or English, and the AI answers from the guides of
 * the manual that match the question best (their What, Why, How, buttons and
 * fields, what happens next and common mistakes), naming the guides it read. It only
 * explains: it has no tools and changes nothing. It answers only while the
 * company's AI is on (the guides and the search work without it), its cost
 * line says "Help AI" on the Help Center, and the people who see the AI
 * Center also see today's and this month's AI cost under it.
 */

export const helpQuestionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, "Write your question")
    .max(500, "Keep the question under 500 characters"),
});

/** Questions one person may ask in a minute. */
const PER_MINUTE = 6;

/** Guides read for one question. */
const GUIDES = 4;

/** The AI cost for the people who see the AI Center; null for everyone else. */
async function costFor(ctx: CompanyContext) {
  return ctx.can("ai.view") || ctx.can("ai.manage") ? getMonthCost(ctx) : null;
}

/** Whether the Help AI answers now, and the cost line for those who see it. */
export async function getHelpAi(ctx: CompanyContext) {
  const [ready, cost] = await Promise.all([aiReady(ctx.company.id), costFor(ctx)]);
  return { on: ready.on, offText: ready.on ? null : ready.text, cost };
}

export type HelpAi = Awaited<ReturnType<typeof getHelpAi>>;

/** The Help AI's instructions (also used to test its skills). */
export const HELP_AI_SYSTEM = (company: string) =>
  [
    `You are the Help AI of ${company}'s ERP (Extas ERP). You explain how to use the ERP to its staff.`,
    "Answer only from the guides given with the question. Never invent a screen, button or field: if the guides do not cover it, say so in one line and suggest asking the admin.",
    "Answer in the language of the question (Bengali or English). In Bengali write numbers with Western digits (0-9).",
    "Keep the app's English names of menus, buttons and fields exactly as the guides write them, in quotes.",
    "Be short: for a how-to, numbered steps; end with the guide's name to read more.",
    "You cannot do anything in the ERP yourself, and you never ask for passwords or PINs.",
  ].join("\n");

/** Answers one question from the manual. */
export async function askHelp(ctx: CompanyContext, input: unknown) {
  const { question } = helpQuestionSchema.parse(input);
  checkRateLimit(`help-ai:${ctx.user.id}`, PER_MINUTE, 60_000);
  const ready = await aiReady(ctx.company.id);
  if (!ready.on) {
    throw new AppError("UNAVAILABLE", `${ready.text} The guides below still answer your search.`);
  }
  const permissions = [...ctx.permissions];
  const found = rankHelp(helpSearchEntries(permissions), question, GUIDES);
  const guides = found.flatMap((r) => {
    const hit = findHelpArticle(r.sectionId, r.slug);
    return hit ? [{ ...hit, open: r.open }] : [];
  });
  // Each guide whole (v6.4 L13), so the AI knows every button the guide explains.
  const book = guides
    .map(({ section, article, open }) => guideText(section, article, open))
    .join("\n\n");
  const { message } = await askClaude(ctx.company.id, {
    task: "help.answer",
    agent: "Help AI",
    userId: ctx.user.id,
    screen: "/help",
    why: `Help question: ${question.slice(0, 200)}`,
    system: HELP_AI_SYSTEM(ctx.company.name),
    messages: [
      {
        role: "user",
        content: `The guides:\n\n${book || "(No guide matches this question.)"}\n\nThe question: ${question}`,
      },
    ],
    maxTokens: 1500,
    effort: "low",
    timeoutMs: 45_000,
  });
  return {
    answer: textOf(message) || "The AI did not answer. Try the search below.",
    guides: guides.map(({ section, article }) => ({
      section: section.id,
      slug: article.slug,
      title: article.title,
    })),
    cost: await costFor(ctx),
  };
}

export type HelpAnswer = Awaited<ReturnType<typeof askHelp>>;
