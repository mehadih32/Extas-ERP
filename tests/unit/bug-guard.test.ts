import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

/*
 * v6.4 C: Bug Guard, the owner's all-round auditor. The rules that need no
 * database: its default schedule (every 3 days at night), the report in
 * simple Bengali grouped Urgent / Important / Can wait with Fix, Ignore and
 * Remind me later, the bot's button codes, the issue sent to Claude Code
 * carrying no data, the scrubbing of errors, what counts as a secret, and the
 * things it can never do (checked in its own code).
 */

import { readButton } from "@/modules/ai/bot/render";
import { guardIssue } from "@/modules/ai/full-check/texts";
import { countsAsForm } from "@/components/shell/usage-beacon";
import {
  renderCorrection,
  renderFinding,
  summaryText,
  weekText,
} from "@/modules/bug-guard/bot-texts";
import { SECRET_PATTERNS, SECURITY_CHECKS, secretIn } from "@/modules/bug-guard/checks/security";
import { apiKeyHint, newApiKey, newWebhookSecret } from "@/modules/ecommerce/keys";
import { describePlan, planProblem } from "@/modules/bug-guard/corrections";
import { plainMessage } from "@/modules/bug-guard/server-errors";
import { defaultSchedule, settingsSchema, TIMEZONE } from "@/modules/bug-guard/settings.service";
import { describeSchedule, nextRunAt } from "@/lib/schedule";

const APP = "https://erp.test";
const ID = "ckguardfinding0000000001";

describe("Bug Guard's schedule", () => {
  it("runs every 3 days at night by default, from today", () => {
    const now = new Date("2026-10-16T09:00:00Z"); // 15:00 in Dhaka
    const s = defaultSchedule(now);
    expect(s).toMatchObject({ mode: "DAYS", every: 3, times: ["02:00"], startDay: "2026-10-16" });
    expect(describeSchedule(s)).toMatch(/3 days/);
    // Next: 2026-10-19 02:00 Dhaka = 2026-10-18 20:00 UTC.
    expect(nextRunAt(s, TIMEZONE, now)?.toISOString()).toBe("2026-10-18T20:00:00.000Z");
  });

  it("takes every N hours, weekly days or chosen dates, and a weekly summary day", () => {
    expect(
      settingsSchema.parse({ schedule: { mode: "HOURS", every: 6, times: ["01:00"] } }),
    ).toMatchObject({ weeklyDay: 6, weeklyTime: "10:00", autoPrepare: false });
    expect(
      settingsSchema.parse({
        schedule: { mode: "WEEKLY", times: ["23:30"], weekdays: [1, 4] },
        weeklyDay: 0,
        weeklyTime: "09:15",
        autoPrepare: true,
      }),
    ).toMatchObject({ weeklyDay: 0, autoPrepare: true });
    expect(() =>
      settingsSchema.parse({
        schedule: { mode: "DAYS", every: 1, times: ["02:00"] },
        weeklyTime: "25:00",
      }),
    ).toThrow();
  });
});

describe("Bug Guard's report", () => {
  const finding = {
    id: ID,
    severity: "URGENT" as const,
    area: "DATA" as const,
    title: "PO-2026-00012 এর মোট তার লাইনগুলোর যোগফলের সাথে মিলছে না।",
    href: "/purchases/orders/abc",
    place: "Purchases > PO-2026-00012",
    why: "ভুল মোট দিয়ে সাপ্লায়ারকে বেশি টাকা দেওয়া হতে পারে।",
    fix: "মোটটা লাইনগুলোর যোগফলে ঠিক করুন।",
    fixKind: "DATA" as const,
    evidence: [{ label: "লাইনগুলোর যোগফল", value: "1,250.00" }],
    correction: {
      kind: "SET" as const,
      changes: [
        {
          model: "PurchaseOrder",
          id: "po1",
          field: "totalAmount",
          before: "1300.00",
          after: "1250.00",
          label: "PO-2026-00012 এর মোট",
        },
      ],
    },
  };

  it("says what, where, why and the fix, with Fix, Ignore and Remind me later", () => {
    const out = renderFinding(finding, APP);
    expect(out.text).toContain("জরুরি");
    expect(out.text).toContain(`কী সমস্যা: ${finding.title}`);
    expect(out.text).toContain(`${APP}/purchases/orders/abc`);
    expect(out.text).toContain(`কেন দরকারি: ${finding.why}`);
    expect(out.text).toContain(`সমাধান: ${finding.fix}`);
    expect(out.text).toContain("1,300 → 1,250");
    expect(out.buttons).toEqual([
      [
        { label: "Fix", data: `bg:${ID}:f` },
        { label: "Ignore", data: `bg:${ID}:i` },
        { label: "Remind me later", data: `bg:${ID}:l` },
      ],
    ]);
    for (const b of out.buttons.flat()) expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64);
    // A note has nothing to fix.
    expect(
      renderFinding({ ...finding, fixKind: "NONE" }, APP).buttons[0]!.map((b) => b.label),
    ).toEqual(["Ignore", "Remind me later"]);
  });

  it("groups the summary Urgent, Important, Can wait, and says when all is well", () => {
    const text = summaryText(
      {
        company: "EXTAS",
        at: new Date("2026-10-16T20:00:00Z"),
        checked: 30,
        failedChecks: [],
        newCount: 2,
        fixedCount: 1,
        open: [
          { severity: "LATER", title: "পরের কাজ", href: null },
          { severity: "URGENT", title: "জরুরি কাজ", href: null },
          { severity: "IMPORTANT", title: "দরকারি কাজ", href: null },
        ],
      },
      APP,
    );
    const urgent = text.indexOf("🔴 জরুরি");
    const important = text.indexOf("🟠 গুরুত্বপূর্ণ");
    const later = text.indexOf("🟢 পরে দেখলেও চলবে");
    expect(urgent).toBeGreaterThan(0);
    expect(important).toBeGreaterThan(urgent);
    expect(later).toBeGreaterThan(important);
    expect(text).toContain(`${APP}/ai/bug-guard`);
    const fine = summaryText(
      {
        company: "EXTAS",
        at: new Date(),
        checked: 30,
        failedChecks: [],
        newCount: 0,
        fixedCount: 0,
        open: [],
      },
      APP,
    );
    expect(fine).toContain("সব ঠিক আছে");
    expect(
      weekText(
        {
          company: "EXTAS",
          from: new Date("2026-10-10T04:00:00Z"),
          to: new Date("2026-10-17T04:00:00Z"),
          runs: 2,
          found: 0,
          fixed: 0,
          corrections: 0,
          securitySteps: 0,
          open: { urgent: 0, important: 0, later: 3 },
        },
        APP,
      ),
    ).toContain("সব ঠিক আছে");
  });

  it("offers Apply and Cancel on a correction, and Undo once applied", () => {
    const prepared = renderCorrection(
      { id: ID, summary: "a → b", status: "PREPARED", title: "t" },
      APP,
    );
    expect(prepared.buttons[0]!.map((b) => b.data)).toEqual([`bc:${ID}:a`, `bc:${ID}:x`]);
    expect(prepared.text).toMatch(/ব্যাকআপ/);
    const applied = renderCorrection(
      { id: ID, summary: "a → b", status: "APPLIED", title: "t" },
      APP,
    );
    expect(applied.buttons[0]!.map((b) => b.data)).toEqual([`bc:${ID}:u`]);
  });

  it("reads its button codes back, and nothing else", () => {
    expect(readButton(`bg:${ID}:f`)).toEqual({ kind: "guard", findingId: ID, choice: "fix" });
    expect(readButton(`bg:${ID}:i`)).toEqual({ kind: "guard", findingId: ID, choice: "ignore" });
    expect(readButton(`bg:${ID}:l`)).toEqual({ kind: "guard", findingId: ID, choice: "later" });
    expect(readButton(`bg:run:${ID}`)).toEqual({ kind: "guard-run", companyId: ID });
    expect(readButton(`bc:${ID}:a`)).toEqual({
      kind: "guard-correction",
      correctionId: ID,
      choice: "apply",
    });
    expect(readButton(`bc:${ID}:u`)).toEqual({
      kind: "guard-correction",
      correctionId: ID,
      choice: "undo",
    });
    expect(readButton(`bg:${ID}:x`)).toBeNull();
    expect(readButton(`bc:${ID}:d`)).toBeNull();
    expect(readButton("bg:run")).toBeNull();
  });
});

describe("Bug Guard's corrections", () => {
  it("only adds records (stock movements, balanced entries), never sets a figure, and shows before → after", () => {
    // v6.4.1 B4: a stored figure is never set, not even a total.
    expect(
      planProblem({
        kind: "SET",
        changes: [
          { model: "User", id: "u", field: "isSuperAdmin", before: "0", after: "1", label: "x" },
        ],
      }),
    ).toMatch(/no longer changes stored figures/);
    expect(
      planProblem({
        kind: "SET",
        changes: [
          {
            model: "PurchaseOrder",
            id: "po",
            field: "totalAmount",
            before: "1300.00",
            after: "1250.00",
            label: "x",
          },
        ],
      }),
    ).toMatch(/no longer changes stored figures/);
    const stock = {
      kind: "STOCK" as const,
      balanceId: "sb",
      variantId: "v",
      warehouseId: "w",
      grade: "A_GRADE" as const,
      stored: 100,
      moved: 95,
      label: "POLO-NVY-M (Main, A-grade)",
    };
    expect(planProblem(stock)).toBeNull();
    expect(describePlan(stock)).toContain("+5 পিস");
    expect(describePlan(stock)).toContain("95 → 100");
    expect(planProblem({ ...stock, moved: 100 })).toMatch(/nothing to change/);
    expect(planProblem({ ...stock, stored: -1 })).toMatch(/below zero/);
    expect(planProblem({ ...stock, stored: 1.5 })).toMatch(/not numbers/);
    expect(
      planProblem({
        kind: "JOURNAL",
        date: "2026-10-16",
        description: "x",
        lines: [
          { accountId: "a", account: "Cash", debit: "10.00", credit: "0" },
          { accountId: "b", account: "Sales", debit: "0", credit: "9.00" },
        ],
      }),
    ).toMatch(/does not balance/);
    const entry = {
      kind: "JOURNAL" as const,
      date: "2026-10-16",
      description: "রাউন্ডিং সমন্বয়",
      lines: [
        { accountId: "a", account: "Cash", debit: "0.50", credit: "0" },
        { accountId: "b", account: "Rounding", debit: "0", credit: "0.50" },
      ],
    };
    expect(planProblem(entry)).toBeNull();
    expect(describePlan(entry)).toContain("Cash: ডেবিট 0.5");
  });
});

describe("What goes to Claude Code and into the log", () => {
  it("puts no message, screen text or record ids in the public issue", () => {
    const issue = guardIssue({
      facts: {
        route: "/sales/orders/ckorder000000000000000001",
        method: "POST",
        status: 500,
        errorType: "TypeError",
        stack: [
          "at buildTotals (/app/.next/server/chunks/ssr/sales_order_123.js:120:7)",
          "at /home/app/node_modules/next/dist/server.js:1:1",
        ],
        times: 4,
      },
      site: "live",
      at: "2026-10-16 10:00 UTC",
      issue: 7,
    });
    expect(issue.body).toContain("@claude");
    expect(issue.body).not.toContain("ckorder000000000000000001");
    expect(issue.body).toContain("/.next/server/chunks/ssr/sales_order_123.js:120:7");
    expect(issue.body).not.toContain("node_modules");
    expect(issue.body).toContain("error type TypeError");
  });

  it("takes quoted text, numbers, addresses and ids out of an error's message", () => {
    const m = plainMessage(
      'Customer "Rahim Traders" owes 125000.50 to rahim@example.com at https://x.test/a ckabcdefghij0123456789xyz\nsecond line',
    );
    expect(m).not.toMatch(/Rahim|125000|example\.com|x\.test|ckabcdefghij/);
    expect(m).not.toContain("second line");
  });

  it("knows a key or token when it sees one", () => {
    // Made at run time, so the repository itself never holds a token-shaped text.
    expect(secretIn(`my key is ${"sk-" + "ant-"}api03-abcdefghijklmnopqrstuvwxyz012345`)).toBe(
      "Anthropic key",
    );
    expect(secretIn(`token ${"gh" + "p_"}abcdefghijklmnopqrstuvwxyz0123456789`)).toBe(
      "GitHub token",
    );
    expect(secretIn("PO-2026-00012 total 125000")).toBeNull();
    // An online shop's key and webhook secret, as "Generate key" makes them; not their hint.
    const shopKey = newApiKey();
    expect(secretIn(`here is the key ${shopKey} for the site`)).toBe("Online shop API key");
    expect(secretIn(`secret: ${newWebhookSecret()}`)).toBe("Online shop webhook secret");
    expect(
      secretIn(`Rotated the API key of the online shop "Web" (${apiKeyHint(shopKey)})`),
    ).toBeNull();
  });

  it("counts a form as half done only for real fields of a form that saves", () => {
    expect(countsAsForm({ role: null, method: "post" }, "text")).toBe(true);
    expect(countsAsForm({ role: "search", method: "post" }, "text")).toBe(false);
    expect(countsAsForm({ role: null, method: "get" }, "text")).toBe(false);
    expect(countsAsForm({ role: null, method: "post" }, "checkbox")).toBe(false);
  });
});

/** Every .ts and .tsx file under a folder. */
function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesIn(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("What Bug Guard can never do (C5)", () => {
  const root = path.resolve(__dirname, "../../src/modules/bug-guard");
  const files = filesIn(root).map((file) => ({
    file: path.relative(root, file),
    code: readFileSync(file, "utf8"),
  }));

  const NEVER: Array<[string, RegExp]> = [
    ["delete data", /\.(delete|deleteMany)\s*\(/],
    ["run raw writes", /\$executeRawUnsafe|\$queryRawUnsafe/],
    [
      "change roles or permissions",
      /rbac\/(role|member)|role\.service|member\.service|(rolePermission|memberPermission|companyMembership|role)\.(create|createMany|update|updateMany|upsert)\s*\(/,
    ],
    ["merge or deploy", /mergeFix|mergePull|dispatchDeploy|deploy\.yml/],
    ["send to buyers or suppliers", /sendDraft|sendMail|sendEmail|mail\.service|whatsapp/i],
    ["move money", /payment\.service|recordPayment|payments\.service|transfer\.service/],
    ["turn off backups", /updateBackupConfig|backupConfig\.(update|upsert)/],
  ];

  it("has no code that could", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const [what, pattern] of NEVER) {
      const found = files.filter((f) => pattern.test(f.code)).map((f) => f.file);
      expect(found, `Bug Guard must never ${what}`).toEqual([]);
    }
  });

  it("only writes through the corrections list, and only reads while it checks", () => {
    const checks = files.filter((f) => f.file.startsWith("checks/"));
    expect(checks.length).toBeGreaterThanOrEqual(5);
    for (const c of checks) {
      expect(c.code, `${c.file} writes`).not.toMatch(
        /\b(db|prisma|tx)\.\w+\.(create|createMany|update|updateMany|upsert)\s*\(/,
      );
    }
    const runner = files.find((f) => f.file === "runner.ts")!.code;
    expect(runner).toMatch(/readOnly\(READ_ONLY_WHY/);
    // There is no switch that turns its checks off: the schedule can only be changed, never removed.
    const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
    const settings = /model BugGuardSettings \{[\s\S]*?\n\}/.exec(schema)![0];
    expect(settings).not.toMatch(/\b(enabled|isEnabled|active|off)\b\s+Boolean/);
  });
});

describe("The server and the code (C2c)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bug-guard-"));
  const check = (key: string) => SECURITY_CHECKS.find((c) => c.key === key)!;
  const ctx = {
    companyId: "c1",
    now: new Date("2026-10-16T09:00:00Z"),
    since: new Date("2026-10-13T09:00:00Z"),
    platform: true,
    db: {} as never,
  };
  afterEach(() => {
    delete process.env.NPM_AUDIT_REPORT;
    delete process.env.HOST_STATUS_FILE;
  });

  it("reports packages with known weaknesses from npm's report, and nothing without one", async () => {
    process.env.NPM_AUDIT_REPORT = path.join(dir, "missing.json");
    expect(await check("security.packages").run(ctx)).toEqual([]);

    const report = path.join(dir, "npm-audit.json");
    writeFileSync(
      report,
      JSON.stringify({
        metadata: { vulnerabilities: { critical: 1, high: 1, moderate: 3 } },
        vulnerabilities: {
          next: { severity: "critical" },
          sharp: { severity: "high" },
          zod: { severity: "moderate" },
        },
      }),
    );
    process.env.NPM_AUDIT_REPORT = report;
    const [f] = await check("security.packages").run(ctx);
    expect(f!.severity).toBe("URGENT");
    expect(f!.fixKind).toBe("CODE");
    expect(f!.evidence!.map((e) => e.label)).toEqual(["next", "sharp"]);

    writeFileSync(report, JSON.stringify({ metadata: { vulnerabilities: { moderate: 3 } } }));
    expect(await check("security.packages").run(ctx)).toEqual([]);
  });

  it("reports the server's own security updates and a restart, as the owner's step", async () => {
    const status = path.join(dir, "host-status.json");
    process.env.HOST_STATUS_FILE = status;
    writeFileSync(status, JSON.stringify({ updates: 4, security: 0, rebootRequired: false }));
    expect(await check("security.host-updates").run(ctx)).toEqual([]);

    writeFileSync(
      status,
      JSON.stringify({
        updates: 20,
        security: 12,
        rebootRequired: true,
        checkedAt: "2026-10-16T04:41:00Z",
      }),
    );
    const [f] = await check("security.host-updates").run(ctx);
    expect(f!.severity).toBe("IMPORTANT");
    expect(f!.fixKind).toBe("MANUAL");
    expect(f!.title).toContain("12");
    expect(f!.title).toContain("রিস্টার্ট");
  });

  // The tests' own stand-ins say "test" or count 0123456789, or are Telegram's
  // documentation example.
  const FAKE = /test|0123456789|^123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ$/i;

  it("finds no key, token or password in the repository's own files", () => {
    const root = path.resolve(__dirname, "../..");
    let tracked: string[];
    try {
      tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
        .split("\n")
        .filter(Boolean);
    } catch {
      return; // Not a git checkout (the Docker image): nothing to scan.
    }
    const found: string[] = [];
    for (const file of tracked) {
      if (/\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz|keystore|jks)$/i.test(file)) continue;
      let text: string;
      try {
        text = readFileSync(path.join(root, file), "utf8");
      } catch {
        continue; // Deleted in the working tree.
      }
      for (const [kind, pattern] of SECRET_PATTERNS) {
        for (const [match] of text.matchAll(new RegExp(pattern.source, "g"))) {
          if (file.startsWith("tests/") && FAKE.test(match)) continue;
          found.push(`${file}: ${kind}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});
