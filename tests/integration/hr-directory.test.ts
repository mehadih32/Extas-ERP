import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The employee directory: the four counts at the top (matching the HR
 * Overview), each person's photo, time here, leave today and contact numbers,
 * the search over every contact field with the quick filters, what each
 * person's ⋮ menu offers, and the photo route (anyone who sees employees and
 * the employee themselves; the browser keeps a photo by its paper).
 */
const signedIn = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/modules/auth/context", async (original) => ({
  ...(await original<typeof import("@/modules/auth/context")>()),
  requireCompany: async () => signedIn.ctx,
}));

import { GET as photoRoute } from "@/app/api/hr/employees/[employeeId]/photo/route";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as directory from "@/modules/hr/directory.service";
import * as employees from "@/modules/hr/employee.service";
import * as screens from "@/modules/hr/screens.service";
import * as vault from "@/modules/hr/vault.service";
import { createRole } from "@/modules/rbac/role.service";

import { png } from "../fixtures/images";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** A Dhaka wall-clock time on Monday 12 Oct 2026, a working day. */
const NOW = new Date("2026-10-12T10:00:00+06:00");
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const picture = () => ({ fileName: "face.png", bytes: png({ width: 40, height: 40 }) });
const pdf = () => ({
  fileName: "face.pdf",
  bytes: Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n"),
});

async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const member = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roleId);
    return user;
  };
  const owner = await contextFor((await member(roles.SUPER_ADMIN, "owner")).id, company.id);
  const viewerRole = await createRole(owner, { name: "HR Viewer", permissions: ["hr.view"] });
  const viewer = await contextFor((await member(viewerRole.id, "viewer")).id, company.id);
  const sales = await contextFor((await member(roles.SALES_EXECUTIVE, "sales")).id, company.id);
  const sumonUser = await member(roles.EMPLOYEE, "sumon");
  const hire = (name: string, joinDate: string, extra: Record<string, unknown> = {}) =>
    employees.createEmployee(owner, { name, joinDate, salary: 30000, ...extra });

  const sumon = await hire("Sumon Mia", "2024-07-01", {
    phone: "01712-345678",
    whatsapp: "01811 222333",
    email: "sumon@mail.test",
    department: "Cutting",
    designation: "Cutter",
  });
  await employees.grantPortalAccess(owner, sumon.id, { userId: sumonUser.id });
  const rina = await hire("Rina Begum", "2026-10-02", { department: "Sewing" });
  const karim = await hire("Karim Uddin", "2025-03-15", { department: "Sewing" });
  await employees.updateEmployee(owner, karim.id, { status: "ON_LEAVE" });
  const jamal = await hire("Jamal Hossain", "2025-01-01", { department: "Finishing" });
  const tania = await hire("Tania Akter", "2026-10-22");
  const babul = await hire("Babul Sheikh", "2023-01-01");
  await employees.exitEmployee(owner, babul.id, {
    exitDate: "2026-09-30",
    status: "RESIGNED",
  });

  // Rina is on approved leave today; Jamal is marked absent.
  const leaveType = await prisma.leaveType.findFirstOrThrow({ where: { companyId: company.id } });
  await prisma.leaveRequest.create({
    data: {
      companyId: company.id,
      employeeId: rina.id,
      leaveTypeId: leaveType.id,
      startDate: day("2026-10-12"),
      endDate: day("2026-10-13"),
      days: 2,
      status: "APPROVED",
    },
  });
  await prisma.attendance.create({
    data: {
      companyId: company.id,
      employeeId: jamal.id,
      date: day("2026-10-12"),
      status: "ABSENT",
    },
  });

  return {
    company,
    owner,
    viewer,
    sales,
    sumonCtx: await contextFor(sumonUser.id, company.id),
    leaveType,
    sumon,
    rina,
    karim,
    jamal,
    tania,
    babul,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

const rowOf = (rows: Awaited<ReturnType<typeof screens.listEmployeeRows>>["items"], id: string) =>
  rows.find((r) => r.id === id)!;

run("the employee directory", () => {
  let env: Env;

  beforeEach(async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    await resetDb();
    env = await setup();
  }, 30_000);
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts everyone, in today, on leave and new joiners as the HR Overview does", async () => {
    const list = await screens.getEmployeeList(env.viewer, {});
    const overview = await screens.getOverviewScreen(env.viewer);

    expect(list.stats).toMatchObject({
      // Everyone working here, Tania (joining on the 22nd) included; Babul has left.
      total: 5,
      dayType: "WORKING",
      absent: 1,
      onApprovedLeave: 1,
      onLongLeave: 1,
      // Rina on leave today and Karim on long leave.
      onLeave: 2,
      // Rina joined on the 2nd; Tania joins later and is not new yet.
      newJoiners: 1,
    });
    expect(list.stats.total).toBe(overview.headcount.current);
    // In today: employed today (Sumon, Rina, Karim, Jamal) less Jamal absent and Rina away.
    const { totals } = overview.register;
    const awayAllDay = overview.onLeaveToday.filter((r) => !r.halfDay).length;
    expect(list.stats.present).toBe(totals.employees - totals.absent - awayAllDay);
    expect(list.stats.present).toBe(2);
  });

  it("gives each person their photo, time here, leave today and contacts", async () => {
    const first = await vault.addEmployeeDocument(
      env.owner,
      env.sumon.id,
      { kind: "PHOTO" },
      picture(),
    );
    // A newer photo paper that is a PDF stays a paper: the picture is still the photo.
    await vault.addEmployeeDocument(env.owner, env.sumon.id, { kind: "PHOTO" }, pdf());

    const { items, seeSalaries, can, today } = await screens.getEmployeeList(env.viewer, {});
    expect(today).toBe("2026-10-12");
    expect(seeSalaries).toBe(false);
    expect(items.map((r) => r.name)).toEqual([
      "Sumon Mia",
      "Rina Begum",
      "Karim Uddin",
      "Jamal Hossain",
      "Tania Akter",
    ]);
    expect(rowOf(items, env.sumon.id)).toMatchObject({
      photoId: first.id,
      tenure: "2 yrs 3 mos",
      phone: "01712-345678",
      whatsapp: "01811 222333",
      email: "sumon@mail.test",
      hasLogin: true,
      isMe: false,
      onLeaveToday: null,
      salary: null,
    });
    expect(rowOf(items, env.rina.id)).toMatchObject({
      photoId: null,
      tenure: "10 days",
      onLeaveToday: { leaveType: env.leaveType.name, halfDay: false },
    });
    expect(rowOf(items, env.karim.id)).toMatchObject({ status: "ON_LEAVE", tenure: "1 yr 6 mos" });
    expect(rowOf(items, env.tania.id).tenure).toBeNull();
    // Only HR viewing: no tasks to give and nobody to deactivate.
    expect(can).toEqual({ add: false, assignTask: false, deactivate: false });

    // People who left: their time here up to their last day, and never on leave.
    const all = await screens.listEmployeeRows(env.viewer, { former: true });
    expect(rowOf(all.items, env.babul.id)).toMatchObject({
      isCurrent: false,
      tenure: "3 yrs 8 mos",
      onLeaveToday: null,
    });

    // The owner sees salaries and may give tasks and deactivate.
    const owners = await screens.getEmployeeList(env.owner, {});
    expect(owners.seeSalaries).toBe(true);
    expect(rowOf(owners.items, env.sumon.id).salary).toBe("30000.00");
    expect(owners.can).toEqual({ add: true, assignTask: true, deactivate: true });
  });

  it("marks the person looking, so they are not offered deactivating themselves", async () => {
    const hrRole = await createRole(env.owner, {
      name: "HR Manager",
      permissions: ["hr.view", "hr.manage", "portal.self"],
    });
    await prisma.companyMembership.update({
      where: { companyId_userId: { companyId: env.company.id, userId: env.sumonCtx.user.id } },
      data: { roleId: hrRole.id },
    });
    const sumonAsHr = await contextFor(env.sumonCtx.user.id, env.company.id);
    const { items } = await screens.getEmployeeList(sumonAsHr, {});
    expect(rowOf(items, env.sumon.id).isMe).toBe(true);
    expect(rowOf(items, env.rina.id).isMe).toBe(false);
  });

  it("searches every contact field and filters active, missing info and department", async () => {
    const names = async (query: Record<string, unknown>) =>
      (await screens.listEmployeeRows(env.viewer, query)).items.map((r) => r.name);

    expect(await names({ search: "222333" })).toEqual(["Sumon Mia"]);
    expect(await names({ search: "SUMON@MAIL" })).toEqual(["Sumon Mia"]);
    expect(await names({ search: "sewing" })).toEqual(["Rina Begum", "Karim Uddin"]);
    expect(await names({ search: "Cutter" })).toEqual(["Sumon Mia"]);
    expect(await names({ search: "345678" })).toEqual(["Sumon Mia"]);
    expect(await names({ department: "Sewing" })).toEqual(["Rina Begum", "Karim Uddin"]);
    // Active only leaves out Karim on long leave.
    expect(await names({ status: "ACTIVE", department: "Sewing" })).toEqual(["Rina Begum"]);

    // Missing info: everyone missing something; filling Sumon's record takes him off.
    expect(await names({ incomplete: true })).toContain("Sumon Mia");
    await employees.updateEmployee(env.owner, env.sumon.id, {
      nid: "1990123456789",
      bloodGroup: "B+",
      referenceName: "Abdul Karim",
      referencePhone: "01700000000",
      referenceRelation: "Uncle",
      salaryMethod: "BKASH",
      walletNumber: "01712345678",
    });
    expect(await names({ incomplete: true })).not.toContain("Sumon Mia");
  });

  it("serves the photo to people who see employees and to the employee", async () => {
    const paper = await vault.addEmployeeDocument(
      env.owner,
      env.sumon.id,
      { kind: "PHOTO" },
      picture(),
    );
    const bytes = picture().bytes;

    const viewed = await directory.getEmployeePhoto(env.viewer, env.sumon.id);
    expect(viewed.photoId).toBe(paper.id);
    expect(Buffer.compare(viewed.file.bytes, bytes)).toBe(0);
    expect((await directory.getEmployeePhoto(env.sumonCtx, env.sumon.id)).photoId).toBe(paper.id);
    await expect(directory.getEmployeePhoto(env.sales, env.sumon.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Sumon sees only his own photo.
    await vault.addEmployeeDocument(env.owner, env.rina.id, { kind: "PHOTO" }, picture());
    await expect(directory.getEmployeePhoto(env.sumonCtx, env.rina.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // A PDF photo is not shown as a photo; someone with no picture has none.
    await vault.addEmployeeDocument(env.owner, env.karim.id, { kind: "PHOTO" }, pdf());
    await expect(directory.getEmployeePhoto(env.viewer, env.karim.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Another company's employee is not found.
    const other = await makeCompany("Other");
    const stranger = await prisma.employee.create({
      data: {
        companyId: other.company.id,
        code: "EMP-0001",
        name: "Stranger",
        joinDate: day("2025-01-01"),
        baseSalary: 1,
      },
    });
    await expect(directory.getEmployeePhoto(env.viewer, stranger.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("lets the browser keep a photo asked for by its paper", async () => {
    const paper = await vault.addEmployeeDocument(
      env.owner,
      env.sumon.id,
      { kind: "PHOTO" },
      picture(),
    );
    const get = (query: string, ctx: CompanyContext) => {
      signedIn.ctx = ctx;
      return photoRoute(
        new Request(`http://erp.test/api/hr/employees/${env.sumon.id}/photo${query}`),
        {
          params: Promise.resolve({ employeeId: env.sumon.id }),
        },
      );
    };

    const kept = await get(`?v=${paper.id}`, env.viewer);
    expect(kept.status).toBe(200);
    expect(kept.headers.get("content-type")).toBe("image/png");
    expect(kept.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(kept.headers.get("x-content-type-options")).toBe("nosniff");
    expect(
      Buffer.from(await kept.arrayBuffer())
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");

    const latest = await get("", env.viewer);
    expect(latest.headers.get("cache-control")).toBe("private, no-cache");

    expect((await get(`?v=${paper.id}`, env.sales)).status).toBe(403);
    expect((await get("?v=nope", env.viewer)).status).toBe(404);
  });
});
