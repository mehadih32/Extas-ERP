import { EXPERTS } from "./experts";

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
