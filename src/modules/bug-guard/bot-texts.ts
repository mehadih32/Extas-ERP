import type { BotButton, BotOut } from "@/modules/ai/bot/render";
import { clip } from "@/modules/ai/bot/render";

import { describePlan } from "./corrections";
import {
  AREA_BN,
  type Area,
  type CorrectionPlan,
  type FixKind,
  SEVERITIES,
  SEVERITY_BN,
  type Severity,
} from "./types";

/*
 * Bug Guard's words on the bot and in the inbox, in simple Bengali (Western
 * digits; the ERP's own English labels kept as they are). The buttons carry
 * short codes (render.ts readButton):
 *   bg:<finding>:f|i|l   Fix, Ignore, Remind me later
 *   bg:run:<company>     Run now
 *   bc:<correction>:a|x|u  Apply (with the PIN), Cancel, Undo (with the PIN)
 * Pure: no database and no network.
 */

export const DOT: Record<Severity, string> = { URGENT: "🔴", IMPORTANT: "🟠", LATER: "🟢" };

const link = (appUrl: string, href: string | null | undefined) =>
  href ? (href.startsWith("http") ? href : `${appUrl.replace(/\/$/, "")}${href}`) : null;

export const guardUrl = (appUrl: string) => `${appUrl.replace(/\/$/, "")}/ai/bug-guard`;

const when = (at: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);

export type FindingText = {
  id: string;
  severity: Severity;
  area: Area;
  title: string;
  href: string | null;
  place: string | null;
  why: string;
  fix: string;
  fixKind: FixKind;
  evidence: Array<{ label: string; value: string }> | null;
  correction: CorrectionPlan | null;
};

/** One finding with its buttons: what, where, why, the fix. */
export function renderFinding(f: FindingText, appUrl: string): BotOut {
  const where = [f.place, link(appUrl, f.href)].filter(Boolean).join(" ");
  const lines = [
    `${DOT[f.severity]} ${SEVERITY_BN[f.severity]} · ${AREA_BN[f.area]}`,
    `কী সমস্যা: ${f.title}`,
    where ? `কোথায়: ${where}` : "",
    `কেন দরকারি: ${f.why}`,
    `সমাধান: ${f.fix}`,
    ...(f.evidence ?? []).slice(0, 6).map((e) => `• ${e.label}: ${e.value}`),
    f.correction ? `\nঠিক করলে যা বদলাবে:\n${describePlan(f.correction)}` : "",
  ];
  const buttons: BotButton[] = [
    ...(f.fixKind === "NONE" ? [] : [{ label: "Fix", data: `bg:${f.id}:f` }]),
    { label: "Ignore", data: `bg:${f.id}:i` },
    { label: "Remind me later", data: `bg:${f.id}:l` },
  ];
  return { text: clip(lines.filter(Boolean).join("\n")), buttons: [buttons] };
}

/** A prepared correction, waiting for Apply (with the PIN) or Cancel; Undo once applied. */
export function renderCorrection(
  c: { id: string; summary: string; status: string; title: string },
  appUrl: string,
): BotOut {
  if (c.status === "APPLIED") {
    return {
      text: clip(
        `ঠিক করা হয়েছে: ${c.title}\n${c.summary}\nভুল হলে Undo চাপুন (PIN লাগবে): আগের অবস্থা ফিরে আসবে।`,
      ),
      buttons: [[{ label: "Undo", data: `bc:${c.id}:u` }]],
    };
  }
  return {
    text: clip(
      [
        `সংশোধন তৈরি: ${c.title}`,
        c.summary,
        "Apply চাপলে (PIN লাগবে) আগে একটা পুরো ব্যাকআপ হবে, তারপর ঠিক করা হবে। কোনো লেখা অঙ্ক বা পুরোনো এন্ট্রি বদলায় না, শুধু নতুন রেকর্ড বসে; পরে Undo করা যায়।",
        guardUrl(appUrl),
      ].join("\n"),
    ),
    buttons: [
      [
        { label: "Apply", data: `bc:${c.id}:a` },
        { label: "Cancel", data: `bc:${c.id}:x` },
      ],
    ],
  };
}

export type SummaryInput = {
  company: string;
  at: Date;
  checked: number;
  failedChecks: string[];
  newCount: number;
  fixedCount: number;
  open: Array<{ severity: Severity; title: string; href: string | null }>;
  note?: string | null;
  /** The check after an update of the live site (deploy.sh asks for it). */
  afterUpdate?: boolean;
};

/** The report of a run: counts, then the open problems grouped Urgent / Important / Can wait. */
export function summaryText(s: SummaryInput, appUrl: string): string {
  const count = (sev: Severity) => s.open.filter((o) => o.severity === sev).length;
  const head = [
    `Bug Guard${s.afterUpdate ? " · আপডেটের পরের চেক" : ""} · ${s.company} · ${when(s.at)}`,
    s.afterUpdate
      ? "নতুন ভার্শন চালু হওয়ার পর লাইভ ERP একবার চেক করা হলো (শুধু পড়ে দেখা, কোনো ডেটা বদলায়নি)।"
      : "",
    s.open.length === 0
      ? `✅ সব ঠিক আছে: ${s.checked}টি জিনিস দেখা হয়েছে, খোলা কোনো সমস্যা নেই।`
      : `খোলা সমস্যা: ${SEVERITIES.map((sev) => `${SEVERITY_BN[sev]} ${count(sev)}`).join(" · ")}`,
    `এবার নতুন ${s.newCount}টি, ঠিক হয়ে গেছে ${s.fixedCount}টি।`,
    s.failedChecks.length
      ? `যে চেকগুলো শেষ হয়নি: ${s.failedChecks.join(", ")} (পরের বার আবার চেষ্টা হবে)।`
      : "",
    s.note ?? "",
  ].filter(Boolean);
  const groups = SEVERITIES.map((sev) => {
    const list = s.open.filter((o) => o.severity === sev);
    if (list.length === 0) return "";
    const max = sev === "LATER" ? 5 : 10;
    return [
      `\n${DOT[sev]} ${SEVERITY_BN[sev]}`,
      ...list.slice(0, max).map((o) => `• ${o.title}`),
      list.length > max ? `• আরও ${list.length - max}টি` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }).filter(Boolean);
  return clip([...head, ...groups, `\nসব দেখুন ও ঠিক করুন: ${guardUrl(appUrl)}`].join("\n"));
}

export type WeekInput = {
  company: string;
  from: Date;
  to: Date;
  runs: number;
  found: number;
  fixed: number;
  corrections: number;
  securitySteps: number;
  open: { urgent: number; important: number; later: number };
};

/** The weekly summary, sent even when all is well. */
export function weekText(w: WeekInput, appUrl: string): string {
  const fine = w.open.urgent + w.open.important === 0;
  return clip(
    [
      `Bug Guard · সাপ্তাহিক সারাংশ · ${w.company}`,
      `${when(w.from)} থেকে ${when(w.to)}`,
      fine
        ? "✅ এই সপ্তাহে সব ঠিক আছে: জরুরি বা গুরুত্বপূর্ণ কোনো সমস্যা খোলা নেই।"
        : `খোলা আছে: জরুরি ${w.open.urgent} · গুরুত্বপূর্ণ ${w.open.important} · পরে দেখলেও চলবে ${w.open.later}`,
      `চেক হয়েছে ${w.runs} বার; নতুন সমস্যা ${w.found}টি; ঠিক হয়েছে ${w.fixed}টি; ডেটা সংশোধন ${w.corrections}টি; নিরাপত্তার পদক্ষেপ ${w.securitySteps}টি।`,
      guardUrl(appUrl),
    ].join("\n"),
  );
}

/** "Run now" on the bot, under Bug Guard's reports. */
export const runNowButton = (companyId: string): BotButton => ({
  label: "Run now",
  data: `bg:run:${companyId}`,
});
