import { EXPERTS } from "./experts";
import { AI_TASKS, type AiTaskKey } from "./models";

/*
 * The ERP's AI agents: Mehedi 2.0 (the company's AI, by the name the owner
 * gave it) and the helpers under him: the tech pack experts, the tech pack
 * orchestrator, the review board and the Help AI. Each can be given its own model on
 * AI Center > Models (it wins over the task's model for that agent's work).
 * Agents appear in the cost lines by name; agentKeyOf finds which one wrote a
 * line. Plain data and functions.
 */

export type AiAgent = { key: string; name: string; what: string };

export function aiAgents(assistantName: string): AiAgent[] {
  return [
    {
      key: "mehedi",
      name: assistantName,
      what: "The company's AI: the chat, the bot, order plans, drafts, reports and reminders",
    },
    ...EXPERTS.map((e) => ({ key: e.id, name: `${e.id} ${e.name}`, what: e.work })),
    {
      key: "orchestrator",
      name: "Tech pack orchestrator",
      what: "Picks the experts a tech pack question needs and puts their answers together",
    },
    {
      key: "review",
      name: "Review board",
      what: "Checks a finished tech pack against the books before it goes to you",
    },
    {
      key: "help",
      name: "Help AI",
      what: "Answers staff questions on the Help Center from the manual; changes nothing",
    },
  ];
}

/**
 * The AI work each agent does (a skill of the agent holds Do at Ask on the
 * actions that use this work, until it passes its test). Mehedi 2.0 does all
 * of it.
 */
export function agentTasks(key: string): readonly AiTaskKey[] {
  if (key === "mehedi") return AI_TASKS.map((t) => t.key);
  if (key === "help") return ["help.answer"];
  // The tech pack's work: the experts, the orchestrator and the review board.
  if (key === "orchestrator" || key === "review") return ["techpack.draft"];
  return EXPERTS.some((e) => e.id === key) ? ["techpack.draft"] : [];
}

/**
 * The Control cells of an agent's own work (AI Center > Control), shown on
 * Agents; Mehedi 2.0 works within every cell, and the Help AI within none (it
 * only explains).
 */
export function agentCells(key: string): readonly string[] {
  if (key === "mehedi" || key === "help") return [];
  if (key === "X01") return ["ai.production.techpack.draft", "ai.production.booking.send"];
  // Consumption, fabric and cutting wastage feed the costing.
  if (["X04", "X05", "X10"].includes(key)) {
    return ["ai.production.techpack.draft", "ai.production.costing"];
  }
  return ["ai.production.techpack.draft"];
}

/** Which agent a cost line's agent name is ("X05 Textile…" and "X05" are both X05), or null. */
export function agentKeyOf(agent: string | null | undefined, assistantName: string): string | null {
  if (!agent) return "mehedi";
  const name = agent.trim();
  if (name === assistantName || name === "Mehedi 2.0") return "mehedi";
  const expert = /^(X\d{2})\b/.exec(name)?.[1];
  if (expert) return EXPERTS.some((e) => e.id === expert) ? expert : null;
  if (name === "Tech pack orchestrator") return "orchestrator";
  if (name === "Review board") return "review";
  if (name === "Help AI") return "help";
  return null;
}
