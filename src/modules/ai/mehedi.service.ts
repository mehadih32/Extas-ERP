import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";

import { getControl, type AiControlNode } from "./control.service";
import { getMonthCost } from "./costs.service";
import { listHouseRules } from "./house-rules.service";
import { BOOK_CODES, BOOKS, STATE_TEXT, testStanding } from "./knowledge";
import { getAiLogs } from "./logs.service";
import { aiLabel, aiSettingsOf, offReason, OFF_TEXT } from "./settings.service";

/*
 * AI Center > Mehedi 2.0: who he is (the owner's AI copy, expert X26, head of
 * X01–X25), what he may never do, how far Control lets him go, his budget,
 * his tests, what he did last, and Teach (the House Rules). Read with ai.view
 * or ai.manage; Pause and Teach are the owner's.
 */

/** The limits no Control setting and no grant can lift (blueprint, section 1). */
export const PERMANENT_LIMITS = [
  "Never deletes data: he sends you a Deletion request and you delete it yourself.",
  "Never changes his own or anyone's permissions or roles.",
  "Never spends beyond your budget.",
  "Never gives permissions to staff.",
  "Never changes your rules: he can only propose House Rules.",
  "Never changes a buyer's locked values.",
  "Never pretends to be you: everything he writes is labelled as the AI's.",
  "Nothing reaches a buyer without your OK: he drafts and reminds you.",
] as const;

function assertView(ctx: CompanyContext) {
  if (!ctx.can("ai.view") && !ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "You do not have permission to see the AI Center.");
  }
}

/** How many cells are Do, Ask and Off (leaves only, as the AI uses them). */
function countCells(nodes: readonly AiControlNode[], into = { DO: 0, ASK: 0, OFF: 0, granted: 0 }) {
  for (const node of nodes) {
    if (node.children?.length) countCells(node.children, into);
    else {
      into[node.state] += 1;
      if (node.granted) into.granted += 1;
    }
  }
  return into;
}

export async function getMehedi(ctx: CompanyContext) {
  assertView(ctx);
  const [settings, control, month, standing, rules, logs, drafts, requests] = await Promise.all([
    aiSettingsOf(ctx.company.id),
    getControl(ctx),
    getMonthCost(ctx),
    testStanding(ctx.company.id),
    listHouseRules(ctx).catch(() => null),
    getAiLogs(ctx, "ai"),
    ctx.db.aiDraft.count({ where: { status: { in: ["DRAFT", "FAILED"] } } }),
    Promise.all([
      ctx.db.aiPermissionRequest.count({ where: { status: "PENDING" } }),
      ctx.db.aiDeletionRequest.count({ where: { status: "PENDING" } }),
    ]),
  ]);
  const off = offReason(settings);
  const cells = countCells([control.tree]);
  const passed = BOOK_CODES.filter((c) => standing[c].state === "PASSED").length;
  return {
    name: settings.assistantName,
    shownName: `${settings.assistantName} · ${ctx.company.name} CEO (AI)`,
    label: aiLabel(settings),
    expertId: "X26",
    state: off ?? ("on" as const),
    stateText: off ? OFF_TEXT[off] : "On and working within Control.",
    paused: settings.pausedAt !== null,
    enabled: settings.enabled,
    limits: PERMANENT_LIMITS,
    control: cells,
    month,
    tests: {
      passed,
      total: BOOK_CODES.length,
      books: BOOK_CODES.map((code) => ({
        code,
        title: BOOKS[code].title,
        state: standing[code].state,
        text: STATE_TEXT[standing[code].state],
        last: standing[code].last,
        validUntil: standing[code].validUntil,
      })),
    },
    waiting: { drafts, permissions: requests[0], deletions: requests[1] },
    rules,
    work: logs.items.slice(0, 10),
    can: { manage: ctx.can("ai.manage") },
  };
}

export type MehediScreen = Awaited<ReturnType<typeof getMehedi>>;
