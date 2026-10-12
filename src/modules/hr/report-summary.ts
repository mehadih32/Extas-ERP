import { createHash } from "node:crypto";

import { formatAmount, formatDay } from "@/lib/format";

/*
 * The few sentences at the top of an employee's 360° report. Written from the
 * report's own figures by rules; when an AI key is set (AI_API_KEY with
 * AI_SUMMARY_MODEL, or the intake model), the Claude API words them instead
 * from the same figures: no name, phone or other personal detail is sent, the
 * answer is capped at a few sentences, and the same figures are never asked
 * about twice while the app runs. Any failure falls back to the rules.
 */

export type ReportFacts = {
  /** "1 Nov 2025" to "12 Oct 2026". */
  from: string;
  to: string;
  post: string | null;
  /** "2 years, 3 months and 4 days". */
  tenure: string;
  attendance: {
    workingDays: number;
    present: number;
    absent: number;
    leave: number;
    late: number;
  };
  overtimeHours: number;
  /**
   * Tasks that fell due by today (due = onTime + late + overdue), and every
   * task still open, overdue or not.
   */
  tasks: { due: number; onTime: number; late: number; overdue: number; open: number };
  /** Only what the reader may see: salary for people who see salaries, trips for claims. */
  money: {
    currency: string;
    salary?: string;
    bonus?: string;
    overtimePay?: string;
    conveyance?: { amount: string; trips: number };
  };
};

export type ReportSummary = { text: string; by: "ai" | "rules" };

const plural = (n: number, one: string, many = `${one}s`) =>
  `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? one : many}`;

/** Present days as a share of working days, "96%"; null without working days. */
export function attendanceRate(a: ReportFacts["attendance"]): string | null {
  return a.workingDays > 0 ? `${Math.round((a.present / a.workingDays) * 100)}%` : null;
}

/** The summary from the figures alone. */
export function ruleSummary(f: ReportFacts): string {
  const a = f.attendance;
  const amount = (v: string) => `${f.money.currency} ${formatAmount(v, 2, f.money.currency)}`;
  const sentences: string[] = [];
  const rate = attendanceRate(a);
  if (rate) {
    const misses = [
      a.absent > 0 && `${plural(a.absent, "day")} absent`,
      a.leave > 0 && `${plural(a.leave, "day")} on leave`,
      a.late > 0 && `${plural(a.late, "late arrival")}`,
    ].filter(Boolean);
    sentences.push(
      `Present on ${Number.isInteger(a.present) ? a.present : a.present.toFixed(1)} of ${a.workingDays} working days (${rate}) from ${formatDay(
        f.from,
      )} to ${formatDay(f.to)}${misses.length ? `, with ${misses.join(", ")}` : ""}.`,
    );
  } else {
    sentences.push(`No working days between ${formatDay(f.from)} and ${formatDay(f.to)}.`);
  }
  if (f.overtimeHours > 0) {
    sentences.push(`Worked ${plural(f.overtimeHours, "hour")} of approved overtime.`);
  }
  const t = f.tasks;
  if (t.due > 0) {
    sentences.push(
      `Finished ${t.onTime + t.late} of ${plural(t.due, "task")} due, ${t.onTime} on time${
        t.overdue > 0 ? `; ${t.overdue} overdue` : ""
      }.`,
    );
  }
  const notDue = t.open - t.overdue;
  if (notDue > 0) {
    sentences.push(
      `${notDue} ${t.due > 0 ? "more " : ""}${notDue === 1 ? "task is" : "tasks are"} still open.`,
    );
  }
  const m = f.money;
  const paid = [
    m.salary && `${amount(m.salary)} in salary`,
    m.bonus && Number(m.bonus) > 0 && `${amount(m.bonus)} in bonuses`,
    m.overtimePay && Number(m.overtimePay) > 0 && `${amount(m.overtimePay)} for overtime`,
  ].filter(Boolean);
  if (paid.length) sentences.push(`Paid ${paid.join(", ")} on approved payrolls.`);
  if (m.conveyance && m.conveyance.trips > 0) {
    sentences.push(
      `Claimed ${amount(m.conveyance.amount)} of conveyance over ${plural(m.conveyance.trips, "trip")}.`,
    );
  }
  return sentences.join(" ");
}

/** The words asked of the AI; the figures go as compact JSON. */
const INSTRUCTIONS =
  "Summarise this employee record for a printed HR report in 2 or 3 plain sentences, at most 70 words. " +
  "Use only the figures given; never invent any. Mention attendance, overtime, tasks and pay where given. " +
  "Say 'the employee', never a name or he/she. Neutral tone, no advice, no lists, no headings.";

/** Answers kept while the app runs, by figures; the oldest goes first past this many. */
const KEPT = 200;
const kept = new Map<string, string>();

function keep(key: string, text: string) {
  kept.delete(key);
  kept.set(key, text);
  if (kept.size > KEPT) kept.delete(kept.keys().next().value!);
}

export type SummaryOptions = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

/** The configured AI writer's key and model, or null until both are set. */
function aiConfig(options: SummaryOptions) {
  // Settings left empty in .env arrive as "" and mean "not set".
  const apiKey = (options.apiKey ?? process.env.AI_API_KEY)?.trim();
  const model =
    options.model?.trim() ||
    process.env.AI_SUMMARY_MODEL?.trim() ||
    process.env.AI_INTAKE_MODEL?.trim();
  return apiKey && model ? { apiKey, model } : null;
}

/** Whether summaries are worded by AI (an AI key and model are set). */
export function aiSummaryOn(): boolean {
  return aiConfig({}) !== null;
}

/** The summary: by AI when it is set up and answers, otherwise by the rules. */
export async function summarise(
  facts: ReportFacts,
  options: SummaryOptions = {},
): Promise<ReportSummary> {
  const rules = ruleSummary(facts);
  const config = aiConfig(options);
  if (!config) return { text: rules, by: "rules" };
  const figures = JSON.stringify(facts);
  const key = createHash("sha256").update(`${config.model}\n${figures}`).digest("hex");
  const known = kept.get(key);
  if (known) return { text: known, by: "ai" };

  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  try {
    const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 200,
        temperature: 0.2,
        system: INSTRUCTIONS,
        messages: [{ role: "user", content: figures }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`[report-summary] ${response.status}`, (await response.text()).slice(0, 300));
      return { text: rules, by: "rules" };
    }
    const json = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return { text: rules, by: "rules" };
    keep(key, text.slice(0, 800));
    return { text: text.slice(0, 800), by: "ai" };
  } catch (error) {
    console.error("[report-summary] request failed", error);
    return { text: rules, by: "rules" };
  }
}
