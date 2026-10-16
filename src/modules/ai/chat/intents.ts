/*
 * What the owner asked Mehedi 2.0 in the chat (or on the bot), read by rules
 * before any AI is called: the commands of the blueprint (v6.2) in Bengali or
 * English. Anything else is a free question, answered by Claude when the AI is
 * on (chat.service.ts). Bengali digits are read as Western ones. Pure: no
 * database, no server code; tested on its own.
 */

export type ReportPeriod = "today" | "yesterday" | "7d" | "month";
export type ReportKind = "SALES" | "PROFIT_AND_LOSS" | "STOCK_ALERTS" | "SUMMARY";

export type Intent =
  | { kind: "ai.stop_all" }
  | { kind: "ai.resume" }
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "order.new" }
  | { kind: "order.status"; ref: string }
  | { kind: "report.pdf"; period: ReportPeriod; report: ReportKind; email: boolean }
  | { kind: "cost.summary"; days: number }
  | { kind: "control.accounts_today" }
  | { kind: "costing"; ref: string | null }
  | { kind: "profit.set"; ref: string | null; percent: number }
  | { kind: "delete"; what: string; ref: string | null; oldDraftBookings: boolean }
  | { kind: "messaging.mode"; supplier: "send" | "draft" }
  | { kind: "draft.send" }
  | { kind: "draft.write"; party: string; about: string | null }
  | { kind: "teach"; text: string }
  | { kind: "expert"; expert: string; question: string }
  | { kind: "task"; title: string; who: string | null; due: string | null }
  | { kind: "follow_up"; party: string; due: string; about: string | null }
  | { kind: "free"; text: string };

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

/**
 * Bengali letters with a dot below (য়, ড়, ঢ়) can be typed as one character
 * or two: the text and every pattern are read in the same (NFC) form.
 */
const N = (re: RegExp) => new RegExp(re.source.normalize("NFC"), re.flags);

/** "২৬১১-০০২" → "2611-002"; also tidies spaces. */
export function westernDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    const at = BENGALI_DIGITS.indexOf(ch);
    out += at >= 0 ? String(at) : ch;
  }
  return out.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** A store prefix from a shared bot: "EXTAS: today's sales report" (v6.1). */
export function storePrefix(text: string): { store: string | null; rest: string } {
  const m = /^([A-Za-z][\w .&-]{1,40}?)\s*[:：]\s*(\S[\s\S]*)$/.exec(text.trim());
  if (!m) return { store: null, rest: text.trim() };
  const store = m[1]!.trim();
  // "Rule:", "Teach:", "Task:" and the like are commands, not stores.
  if (/^(rule|teach|task|follow ?up|note|re|fw|q)$/i.test(store)) {
    return { store: null, rest: text.trim() };
  }
  return { store, rest: m[2]!.trim() };
}

/** A record number in the text: "2611-002", "CS-2026-0003", "PO-2026-00004", "EX-PL-001". */
export function refIn(text: string): string | null {
  const patterns = [
    /\b[A-Z]{1,6}(?:-[A-Z0-9]{1,8}){1,4}\b/gi,
    /\b\d{2,6}[-/]\d{1,6}(?:[-/]\d{1,6})?\b/g,
    /#\s*\w[\w-]{1,30}/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const ref = m[0].replace(/^#\s*/, "").toUpperCase();
      // A number has digits ("follow-up" and "e-mail" are words).
      if (/\d/.test(ref) && !/^\d{4}-\d{2}-\d{2}$/.test(ref)) return ref;
    }
  }
  return null;
}

/** "tomorrow" / "কাল" → +1 day; "today" / "আজ"; "in 3 days" / "৩ দিন পর"; a YYYY-MM-DD. */
export function dueIn(text: string): string | null {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (iso) return iso[1]!;
  if (has(text, /পরশু|day after tomorrow/i)) return "+2";
  if (has(text, /আগামীকাল|কাল|tomorrow/i)) return "+1";
  if (has(text, /আজ|today/i)) return "+0";
  const days = N(/(\d{1,3})\s*(?:দিন|days?)\s*(?:পর|later)?/i).exec(text);
  if (days) return `+${Number(days[1])}`;
  const weeks = N(/(\d{1,2})\s*(?:সপ্তাহ|weeks?)/i).exec(text);
  if (weeks) return `+${Number(weeks[1]) * 7}`;
  if (has(text, /next week|আগামী সপ্তাহ/i)) return "+7";
  return null;
}

const has = (text: string, re: RegExp) => N(re).test(text);

function reportPeriod(text: string): ReportPeriod {
  if (has(text, /গতকাল|yesterday/i)) return "yesterday";
  if (has(text, /সপ্তাহ|৭ দিন|7 days|week/i)) return "7d";
  if (has(text, /মাস|month/i)) return "month";
  return "today";
}

function reportKind(text: string): ReportKind {
  if (has(text, /লাভ|প্রফিট|profit|p&l|p\s*and\s*l/i)) return "PROFIT_AND_LOSS";
  if (has(text, /স্টক|stock|inventory/i)) return "STOCK_ALERTS";
  if (has(text, /সেল|বিক্রি|sales?\b/i)) return "SALES";
  return "SUMMARY";
}

const TEACH = N(/^(?:নিয়ম|শেখো|শিখে রাখো|rule|teach)\s*[:：-]\s*([\s\S]{3,})$/i);
const EXPERT = N(/^@\s*(X\d{2})\b[\s,:-]*([\s\S]+)$/i);
const TASK = N(
  /^(?:task|কাজ)\s*[:：-]\s*(.+?)(?:\s*(?:,|\||for|-)\s*(?:to\s+)?([^,|]+?)(?:কে)?)?(?:\s*(?:,|\||by|due)\s*(.+))?$/i,
);
const FOLLOW_UP = N(
  /^(?:follow[- ]?up|ফলো[- ]?আপ)\s*(?:with)?\s*[:：-]?\s*(.+?)\s*(?:,|\||on|by)\s*([^,|]+?)(?:\s*(?:,|\|)\s*(.+))?$/i,
);

/** Reads one message. The store prefix is read by the caller (storePrefix). */
export function readIntent(raw: string): Intent {
  const text = westernDigits(raw);

  // Stop and resume first: they work even while everything else waits.
  if (
    has(text, /^(সব\s*)?থামাও|সব বন্ধ করো|stop (everything|all)|^pause\b|^stop\b/i) &&
    text.length <= 40
  ) {
    return { kind: "ai.stop_all" };
  }
  if (
    has(text, /আবার চালু|চালু করো|কাজ শুরু করো|^resume\b|start again|carry on|^continue\b/i) &&
    text.length <= 40
  ) {
    return { kind: "ai.resume" };
  }

  // "পাঠাও" alone (or "send it"): the draft shown last is shown again to confirm (nothing is sent by words).
  if (N(/^(পাঠাও|পাঠিয়ে দাও|send|send it|send now)[.!।]?$/i).test(text))
    return { kind: "draft.send" };

  const teach = TEACH.exec(text);
  if (teach) return { kind: "teach", text: teach[1]!.trim() };

  const expert = EXPERT.exec(text);
  if (expert)
    return { kind: "expert", expert: expert[1]!.toUpperCase(), question: expert[2]!.trim() };

  const task = TASK.exec(text);
  if (task) {
    const who = task[2]?.trim() || null;
    // "কাজ: বুকিং চেক করো, কাল পর্যন্ত": a day where the person would be is the day.
    if (who && !task[3] && dueIn(who)) {
      return { kind: "task", title: task[1]!.trim(), who: null, due: dueIn(who) };
    }
    return { kind: "task", title: task[1]!.trim(), who, due: task[3] ? dueIn(task[3]) : null };
  }

  const follow = FOLLOW_UP.exec(text);
  if (follow) {
    const due = dueIn(follow[2]!);
    if (due) {
      return { kind: "follow_up", party: follow[1]!.trim(), due, about: follow[3]?.trim() || null };
    }
  }

  if (N(/^(help|commands|কী কী পারো|কি কি পারো|সাহায্য|কমান্ড)[?？]?$/i).test(text)) {
    return { kind: "help" };
  }
  if (N(/^(status|কেমন আছ|কী অবস্থা|কি অবস্থা|তোমার অবস্থা)[?？]?$/i).test(text)) {
    return { kind: "status" };
  }

  if (has(text, /নতুন অর্ডার|new order/i)) return { kind: "order.new" };

  // Deleting is never done: it becomes a Deletion request.
  if (has(text, /মুছে|ডিলিট|delete|remove|erase/i)) {
    return {
      kind: "delete",
      what: text,
      ref: refIn(text),
      oldDraftBookings: has(text, /ড্রাফট|draft/i) && has(text, /বুকিং|booking/i),
    };
  }

  if (has(text, /সাপ্লায়ার|supplier/i) && has(text, /নিজে পাঠাও|send (it )?yourself|you send/i)) {
    return { kind: "messaging.mode", supplier: "send" };
  }
  if (
    has(text, /সাপ্লায়ার|supplier/i) &&
    has(text, /খসড়া|draft/i) &&
    !has(text, /বায়ার|buyer/i)
  ) {
    return { kind: "messaging.mode", supplier: "draft" };
  }

  if (has(text, /accounts|অ্যাকাউন্টস|হিসাব/i) && has(text, /খুলে দাও|open/i)) {
    return { kind: "control.accounts_today" };
  }

  if (has(text, /রিপোর্ট|report/i) && has(text, /pdf|পিডিএফ|দাও|পাঠাও|send|give|make/i)) {
    return {
      kind: "report.pdf",
      period: reportPeriod(text),
      report: reportKind(text),
      email: has(text, /ইমেইল|ইমেল|email|mail/i),
    };
  }

  const profit = N(
    /(?:profit|প্রফিট|লাভ)\D{0,20}?(\d{1,2}(?:\.\d{1,2})?)\s*%|(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:profit|প্রফিট|লাভ)/i,
  ).exec(text);
  if (profit) {
    return { kind: "profit.set", ref: refIn(text), percent: Number(profit[1] ?? profit[2]) };
  }

  if (has(text, /কস্টিং|costing|cost sheet|কস্ট শিট/i))
    return { kind: "costing", ref: refIn(text) };

  if (
    has(text, /খরচ|cost|spend|spent/i) &&
    has(text, /দিন|days?|week|সপ্তাহ|month|মাস|today|আজ/i)
  ) {
    const days = N(/(\d{1,3})\s*(?:দিন|days?)/i).exec(text);
    return {
      kind: "cost.summary",
      days: days
        ? Math.min(Math.max(Number(days[1]), 1), 90)
        : has(text, /মাস|month/i)
          ? 30
          : has(text, /সপ্তাহ|week/i)
            ? 7
            : 1,
    };
  }

  const ref = refIn(text);
  if (ref && has(text, /অবস্থা|status|কোথায়|where is|কতদূর|update/i)) {
    return { kind: "order.status", ref };
  }

  const draft = N(
    /(?:draft|খসড়া)\s*(?:a\s+)?(?:reply|follow[- ]?up|email|message|মেইল|মেসেজ)?\s*(?:to|for)\s+([^,]+?)(?:(?:\s*,\s*(?:about\s+)?|\s+about\s+)(.+))?$/i,
  ).exec(text);
  if (draft)
    return { kind: "draft.write", party: draft[1]!.trim(), about: draft[2]?.trim() || null };

  return { kind: "free", text };
}

/** The commands the chat knows without the AI, as the help shows them (Bengali, verbatim). */
export const COMMAND_HELP: ReadonlyArray<{ say: string; does: string }> = [
  { say: "সব থামাও", does: "Stops all AI work at once (Pause)." },
  { say: "আবার চালু করো", does: "Lets the AI work again after a pause." },
  {
    say: "অর্ডার 2611-002-এর অবস্থা",
    does: "The status of an order, costing, booking or project.",
  },
  {
    say: "আজকের সেল রিপোর্ট PDF দাও",
    does: 'Makes the report PDF (add "ইমেইল" to get it by email).',
  },
  { say: "শেষ 7 দিনের খরচ", does: "What the AI cost, by task and agent." },
  { say: "আজকের জন্য Accounts খুলে দাও", does: "A change card: Accounts open for the AI today." },
  { say: "CS-2026-0001 কস্টিং", does: "The costing sheet and its Order check card." },
  { say: "CS-2026-0001 profit 12%", does: "A change card: the profit % of that order." },
  {
    say: "সাপ্লায়ারকে নিজে পাঠাও",
    does: "A change card: supplier messages go without asking (buyers stay drafts).",
  },
  { say: "Draft follow-up to <buyer>, about <order>", does: "A draft for you to check and send." },
  {
    say: "পাঠাও",
    does: "Shows the draft shown last again, with its buyer and subject: press Send under it to send it.",
  },
  { say: "নিয়ম: <the rule>", does: "A House Rule proposal; it counts once you approve it." },
  { say: "কাজ: <what>, <who>কে, কাল পর্যন্ত", does: "A change card that makes a task." },
  { say: "Follow up: <buyer>, in 3 days, <order>", does: "A change card: the follow-up date." },
  {
    say: "পুরোনো ড্রাফট বুকিংগুলো মুছে দাও",
    does: "Never deleted: a Deletion request for you to decide.",
  },
  { say: "@X07 <question>", does: "Only that expert answers (needs the AI on)." },
];
