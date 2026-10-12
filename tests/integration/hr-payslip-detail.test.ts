import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A transparent payslip: every deduction says why it is taken (the days
 * missed, the advance it recovers, or the reason typed in for other
 * deductions, needed before the payroll is approved), and the staff claims
 * paid back with the salary are listed with their day and what they were for.
 * The draft payroll also says which claims still wait for Accounts.
 */
const signedIn = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/auth/context", async (original) => {
  const real = await original<typeof import("@/modules/auth/context")>();
  const { AppError } = await import("@/lib/errors");
  return {
    ...real,
    requirePermission: async (...keys: string[]) => {
      const ctx = signedIn.ctx as import("@/modules/auth/context").CompanyContext;
      if (keys.some((k) => !ctx.permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx;
    },
  };
});

import type { StaffClaimKind, StaffClaimStatus } from "@prisma/client";

import { POST as approveRoute } from "@/app/api/hr/payroll/[runId]/approve/route";
import { AppError } from "@/lib/errors";
import { payslipDocument } from "@/modules/documents/builders";
import { prisma } from "@/lib/prisma";
import * as advances from "@/modules/hr/advance.service";
import * as attendance from "@/modules/hr/attendance.service";
import * as employees from "@/modules/hr/employee.service";
import { myMoney } from "@/modules/hr/ledger.service";
import * as payroll from "@/modules/hr/payroll.service";
import { getPayrollScreen } from "@/modules/hr/screens.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** Monday 12 Oct 2026 in Dhaka; the payroll is for September. */
const NOW = new Date("2026-10-12T10:00:00+06:00");
const MONTH = "2026-09";

async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const member = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roleId);
    return user;
  };
  const owner = await contextFor((await member(roles.SUPER_ADMIN, "owner")).id, company.id);
  const sumonUser = await member(roles.EMPLOYEE, "sumon");
  const hire = (name: string) =>
    employees.createEmployee(owner, { name, joinDate: "2025-01-01", salary: 30000 });
  const sumon = await hire("Sumon Mia");
  const rina = await hire("Rina Begum");
  await employees.grantPortalAccess(owner, sumon.id, { userId: sumonUser.id });
  const advance = await advances.giveAdvance(owner, {
    employeeId: sumon.id,
    amount: 2500,
    date: "2025-01-01",
    installmentAmount: 500,
    isOpening: true,
  });
  let n = 0;
  const claim = (
    employeeId: string,
    date: string,
    data: {
      kind?: StaffClaimKind;
      status?: StaffClaimStatus;
      amount: number;
      approvedAmount?: number;
      fromPlace?: string;
      toPlace?: string;
      item?: string;
      quantity?: string;
      purpose?: string;
    },
  ) =>
    prisma.staffClaim.create({
      data: {
        companyId: company.id,
        employeeId,
        number: `CLM-T${++n}`,
        kind: data.kind ?? "CONVEYANCE",
        status: data.status ?? "APPROVED",
        date: new Date(`${date}T00:00:00Z`),
        amount: data.amount,
        approvedAmount: data.approvedAmount ?? null,
        fromPlace: data.fromPlace ?? null,
        toPlace: data.toPlace ?? null,
        item: data.item ?? null,
        quantity: data.quantity ?? null,
        purpose: data.purpose ?? null,
      },
    });
  const trip = await claim(sumon.id, "2026-09-03", {
    amount: 200,
    approvedAmount: 180,
    fromPlace: "Office",
    toPlace: "Bank",
    purpose: "Deposit cheques",
  });
  const thread = await claim(sumon.id, "2026-09-10", {
    kind: "LOCAL_MATERIAL",
    amount: 350,
    item: "Thread",
    quantity: "5 cones",
    purpose: "Sample stitching",
  });
  // Still waiting for Accounts, and one from after the month: neither is paid with September.
  await claim(sumon.id, "2026-09-15", {
    status: "PENDING",
    amount: 300,
    fromPlace: "Office",
    toPlace: "Port",
  });
  await claim(sumon.id, "2026-10-02", { amount: 90, fromPlace: "Office", toPlace: "Bank" });
  // Two days absent at the start of September (1 Sep 2026 is a Tuesday).
  for (const date of ["2026-09-01", "2026-09-02"]) {
    await attendance.markAttendance(owner, {
      date,
      entries: [{ employeeId: sumon.id, status: "ABSENT" }],
    });
  }
  return {
    owner,
    sumonCtx: await contextFor(sumonUser.id, company.id),
    sumon,
    rina,
    advance,
    trip,
    thread,
  };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const lineOf = (r: Awaited<ReturnType<typeof payroll.getPayrollRun>>, employeeId: string) =>
  r.items.find((i) => i.employee.id === employeeId)!;

run("Transparent payslips", () => {
  let env: Env;
  beforeEach(async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    await resetDb();
    env = await setup();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("explains every deduction and lists the claims a draft is going to pay back", async () => {
    const draft = await payroll.createPayrollRun(env.owner, { month: MONTH });
    const line = lineOf(draft, env.sumon.id);
    expect([line.reimbursements, line.advanceDeduction, line.deductionReason]).toEqual([
      "530.00",
      "500.00",
      null,
    ]);

    const slip = await payroll.getPayslip(env.owner, draft.id, line.id);
    expect(slip.deductions).toEqual([
      expect.objectContaining({
        label: expect.stringMatching(/^Unpaid days \(2 x /),
        reason: "2 days absent",
      }),
      { label: "Advance recovery", amount: "500.00", reason: `Towards ${env.advance.number}` },
    ]);
    expect(slip.claims).toEqual([
      {
        id: env.trip.id,
        number: env.trip.number,
        kind: "CONVEYANCE",
        date: "2026-09-03",
        what: "Office to Bank",
        purpose: "Deposit cheques",
        amount: "180.00",
      },
      {
        id: env.thread.id,
        number: env.thread.number,
        kind: "LOCAL_MATERIAL",
        date: "2026-09-10",
        what: "Thread (5 cones)",
        purpose: "Sample stitching",
        amount: "350.00",
      },
    ]);
    expect([slip.claimsTotal, slip.claimsChanged]).toEqual(["530.00", false]);

    // Someone with nothing deducted and no claims: nothing to explain.
    const rina = await payroll.getPayslip(env.owner, draft.id, lineOf(draft, env.rina.id).id);
    expect([rina.deductions, rina.claims]).toEqual([[], []]);

    // The draft says a claim from September still waits for Accounts.
    const screen = await getPayrollScreen(env.owner, draft.id);
    expect(screen.claimsWaiting).toEqual({ count: 1, amount: "300.00", open: true });

    // A claim approved after the draft was worked out shows the draft is behind.
    await prisma.staffClaim.updateMany({
      where: { number: "CLM-T3" },
      data: { status: "APPROVED" },
    });
    const behind = await payroll.getPayslip(env.owner, draft.id, line.id);
    expect([behind.claims.length, behind.claimsTotal, behind.claimsChanged]).toEqual([
      3,
      "830.00",
      true,
    ]);
    const caughtUp = await payroll.recalculatePayrollRun(env.owner, draft.id);
    expect(lineOf(caughtUp, env.sumon.id).reimbursements).toBe("830.00");
    expect((await getPayrollScreen(env.owner, draft.id)).claimsWaiting).toBeNull();
  });

  it("needs a reason for other deductions before the payroll is approved", async () => {
    const draft = await payroll.createPayrollRun(env.owner, { month: MONTH });
    const itemId = lineOf(draft, env.sumon.id).id;

    // A reason goes with an amount; taking the amount off drops the reason.
    const alone = await expectAppError(
      payroll.updatePayrollItem(env.owner, draft.id, itemId, { deductionReason: "A fine" }),
      "VALIDATION",
    );
    expect(alone.details).toEqual({
      otherDeductions: ["Give the amount deducted along with the reason."],
    });
    const fined = await payroll.updatePayrollItem(env.owner, draft.id, itemId, {
      otherDeductions: 300,
      deductionReason: "  Late for the buyer's audit  ",
    });
    expect(lineOf(fined, env.sumon.id).deductionReason).toBe("Late for the buyer's audit");
    const cleared = await payroll.updatePayrollItem(env.owner, draft.id, itemId, {
      otherDeductions: 0,
    });
    expect(lineOf(cleared, env.sumon.id).deductionReason).toBeNull();
    // Working it out again keeps a reason with its amount.
    await payroll.updatePayrollItem(env.owner, draft.id, itemId, {
      otherDeductions: 750,
      deductionReason: "Broken scissors",
    });
    const again = await payroll.recalculatePayrollRun(env.owner, draft.id);
    expect(lineOf(again, env.sumon.id).deductionReason).toBe("Broken scissors");
    await payroll.updatePayrollItem(env.owner, draft.id, itemId, { deductionReason: null });

    // No reason: approving is refused and names who still needs one.
    const refused = await expectAppError(
      payroll.approvePayrollRun(env.owner, draft.id),
      "VALIDATION",
    );
    expect(refused.message).toBe(
      "Say why the other deductions are taken from Sumon Mia before approving.",
    );
    const blank = await expectAppError(
      payroll.approvePayrollRun(env.owner, draft.id, undefined, { reasons: { [itemId]: "   " } }),
      "VALIDATION",
    );
    expect(blank.message).toContain("Sumon Mia");
    expect((await payroll.getPayrollRun(env.owner, draft.id)).status).toBe("DRAFT");

    // The reason typed in while approving is kept and printed on the payslip.
    signedIn.ctx = env.owner;
    const response = await approveRoute(
      new Request(`http://localhost/api/hr/payroll/${draft.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reasons: { [itemId]: "Lost the cutting scissors" } }),
      }),
      { params: Promise.resolve({ runId: draft.id }) },
    );
    const body = await response.json();
    expect([response.status, body.ok, body.data.status]).toEqual([200, true, "APPROVED"]);
    expect(lineOf(body.data, env.sumon.id).deductionReason).toBe("Lost the cutting scissors");

    const slip = await payroll.getPayslip(env.owner, draft.id, itemId);
    expect(slip.deductions.map((d) => [d.label.replace(/ \(.*/, ""), d.amount, d.reason])).toEqual([
      ["Unpaid days", expect.any(String), "2 days absent"],
      ["Advance recovery", "500.00", `Taken back on ${env.advance.number}`],
      ["Other deductions", "750.00", "Lost the cutting scissors"],
    ]);
    // Approved: the claims are the ones it paid back.
    expect(slip.claims.map((c) => c.number)).toEqual([env.trip.number, env.thread.number]);
    expect(slip.claimsChanged).toBe(false);

    // The printed payslip carries the reasons and a table of the claims.
    const printed = await payslipDocument(env.owner, itemId);
    const table = (title: string) => {
      const block = printed.model.blocks.find((b) => b.kind === "table" && b.title === title);
      return block?.kind === "table" ? block.rows : [];
    };
    expect(table("Deductions").find((r) => r.cells[0] === "Other deductions")?.details).toEqual([
      "Lost the cutting scissors",
    ]);
    expect(table("Claims paid back").map((r) => r.cells)).toEqual([
      ["3 Sep 2026", env.trip.number, "Office to Bank · Deposit cheques", "180.00"],
      ["10 Sep 2026", env.thread.number, "Thread (5 cones) · Sample stitching", "350.00"],
      ["Total", "", "", "530.00"],
    ]);

    // The employee sees the same on their own payslip and in My money.
    const mine = await payroll.myPayslip(env.sumonCtx, itemId);
    expect(mine.deductions.at(-1)).toEqual({
      label: "Other deductions",
      amount: "750.00",
      reason: "Lost the cutting scissors",
    });
    expect(mine.claims.map((c) => [c.date, c.what, c.purpose])).toEqual([
      ["2026-09-03", "Office to Bank", "Deposit cheques"],
      ["2026-09-10", "Thread (5 cones)", "Sample stitching"],
    ]);
    const money = await myMoney(env.sumonCtx);
    expect(money.months[0]?.lines).toContainEqual({
      label: "Other deductions (Lost the cutting scissors)",
      amount: "750.00",
      sign: "-",
    });
  });

  it("keeps a reason given before approving, and asks nothing when nothing else is deducted", async () => {
    const draft = await payroll.createPayrollRun(env.owner, { month: MONTH });
    const itemId = lineOf(draft, env.sumon.id).id;
    await payroll.updatePayrollItem(env.owner, draft.id, itemId, {
      otherDeductions: 100,
      deductionReason: "Uniform",
    });
    const approved = await payroll.approvePayrollRun(env.owner, draft.id);
    expect(approved.status).toBe("APPROVED");
    expect(lineOf(approved, env.sumon.id).deductionReason).toBe("Uniform");

    // Reopened and approved again with a better reason; reasons for lines with
    // nothing deducted are ignored.
    await payroll.reopenPayrollRun(env.owner, draft.id, { reason: "Fix the uniform note" });
    const rinaItem = lineOf(approved, env.rina.id).id;
    const again = await payroll.approvePayrollRun(env.owner, draft.id, undefined, {
      reasons: { [itemId]: "Second uniform set", [rinaItem]: "Nothing" },
    });
    expect(lineOf(again, env.sumon.id).deductionReason).toBe("Second uniform set");
    expect(lineOf(again, env.rina.id).deductionReason).toBeNull();
  });
});
