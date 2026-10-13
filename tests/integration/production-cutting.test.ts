import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A style's cutting and embroidery: cutting reports by colour and size (typed
 * in or read by AI from a photo), the cross-checks against the fabric, the
 * collars ordered for each colour and size and the accessories issued (with an
 * instant alert when one runs short), pieces sent out for embroidery and what
 * came back, spoiled ones replaced from cutting at once, the cutting and sewing
 * dates and their warnings, and the Fabric Fault Note into the fault log.
 */
const browser = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      browser.cookies.has(name) ? { name, value: browser.cookies.get(name)! } : undefined,
    set: (name: string, value: string) => void browser.cookies.set(name, value),
    delete: (name: string) => void browser.cookies.delete(name),
  }),
  headers: async () => browser.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { addDays, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/result";
import { createSession } from "@/modules/auth/session.service";
import * as files from "@/modules/files/file.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as materials from "@/modules/materials/material.service";
import * as parties from "@/modules/parties/party.service";
import type { IntakeParser } from "@/modules/production/ai-intake";
import * as batchIssue from "@/modules/production/batch-issue.service";
import * as bookings from "@/modules/production/booking.service";
import * as batches from "@/modules/production/batch.service";
import * as cutting from "@/modules/production/cutting.service";
import * as faults from "@/modules/production/fault.service";
import * as needs from "@/modules/production/material-need.service";
import * as projects from "@/modules/production/project.service";
import * as receive from "@/modules/production/receive.service";
import {
  createCuttingReportAction,
  getCuttingScreenAction,
} from "@/server/actions/production.actions";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  accounts: "ACCOUNTS",
  store: "WAREHOUSE_TEAM",
} as const;
type Who = keyof typeof ROLES;

function data<T>(result: ActionResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

/**
 * A batch with a polo in Navy (S 20, M 40, L 40) and White (S 10, M 20, L 10)
 * and a tee with no colours (50 pcs). The polo takes jersey by colour (0.25 kg
 * a piece), rib collars by colour and size (0.03 kg, 3 kg ordered: short of the
 * 4.2 kg they need) and three buttons; 20 kg of jersey and 1 kg of rib are
 * issued to it, and no buttons yet.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const people = {} as Record<Who, { id: string }>;
  for (const [who, role] of Object.entries(ROLES) as Array<[Who, keyof typeof roles]>) {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roles[role]);
    people[who] = user;
  }
  const owner = await contextFor(people.owner.id, company.id);
  const pm = await contextFor(people.production.id, company.id);
  const accounts = await contextFor(people.accounts.id, company.id);
  const store = await contextFor(people.store.id, company.id);
  const sizes = [];
  for (const name of ["S", "M", "L"]) sizes.push(await catalog.createSize(owner, { name }));
  const navy = await catalog.createColor(owner, { name: "Navy", hexCode: "#1f2a44" });
  const white = await catalog.createColor(owner, { name: "White", hexCode: "#FFFFFF" });
  const tops = await catalog.createCategory(owner, { name: "Tops" });
  const style = await styles.createStyle(owner, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(owner, style.id, {
    colorIds: [navy.id, white.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { size: true, color: true },
  });
  const sku = (color: string, size: string) =>
    variants.find((v) => v.color.name === color && v.size.name === size)!.id;
  const supplier = async (name: string) =>
    (await parties.createParty(owner, { kind: "SUPPLIER", name })).party;
  const mill = await supplier("Narayanganj Fabrics");
  const trims = await supplier("Dhaka Trims House");
  const knit = await supplier("Gazipur Knit Factory");
  const embroidery = await supplier("Mirpur Embroidery");
  const jersey = await materials.createMaterial(pm, {
    name: "Single Jersey 180 GSM",
    kind: "FABRIC",
    unit: "KG",
    supplierId: mill.id,
  });
  const rib = await materials.createMaterial(pm, {
    name: "1x1 Rib 220 GSM",
    kind: "FABRIC",
    unit: "KG",
    supplierId: mill.id,
  });
  const buttons = await materials.createMaterial(pm, {
    name: "Polo Button 18L",
    kind: "TRIM",
    unit: "PCS",
    supplierId: trims.id,
  });
  const batch = await batches.createBatch(pm, {
    name: "Winter 2030",
    factoryId: knit.id,
    targetDate: "2030-12-20",
  });
  const polo = await projects.createProject(pm, {
    name: "Brand A polo",
    batchId: batch.id,
    targetDate: "2030-12-20",
    targets: [
      { variantId: sku("Navy", "S"), quantity: 20 },
      { variantId: sku("Navy", "M"), quantity: 40 },
      { variantId: sku("Navy", "L"), quantity: 40 },
      { variantId: sku("White", "S"), quantity: 10 },
      { variantId: sku("White", "M"), quantity: 20 },
      { variantId: sku("White", "L"), quantity: 10 },
    ],
  });
  const tee = await projects.createProject(pm, {
    name: "Brand B tee",
    batchId: batch.id,
    targetDate: "2030-12-20",
    targetQuantity: 50,
  });
  await needs.setMaterialNeeds(pm, polo.id, {
    needs: [
      { materialId: jersey.id, perPiece: 0.25, split: "COLOUR", placement: "Main body" },
      { materialId: rib.id, perPiece: 0.03, split: "COLOUR_SIZE", placement: "Collar" },
      { materialId: buttons.id, perPiece: 3, placement: "Button" },
    ],
  });
  await needs.setMaterialNeeds(pm, tee.id, {
    needs: [{ materialId: jersey.id, perPiece: 0.2, split: "COLOUR", placement: "Main body" }],
  });
  await bookings.createBooking(pm, {
    source: "SUPPLIER_PO",
    category: "KNITWEAR",
    supplierId: mill.id,
    batchId: batch.id,
    expectedDate: "2030-11-15",
    lines: [
      { materialId: jersey.id, quantity: 50, unitPrice: 520 },
      { materialId: rib.id, quantity: 3, unitPrice: 600 },
    ],
  });
  const millOrderId = (
    await prisma.purchaseOrder.findFirstOrThrow({ where: { supplierId: mill.id } })
  ).id;
  const screen = await receive.getBatchReceive(pm, batch.id, millOrderId);
  await receive.receiveBatchDelivery(pm, batch.id, {
    orderId: millOrderId,
    lines: screen.order!.lines.map((l) => ({
      lineId: l.id,
      challanQuantity: Number(l.toCome),
      quantity: Number(l.toCome),
    })),
  });
  await batchIssue.issueToStyles(store, batch.id, {
    lines: [
      { projectId: polo.id, materialId: jersey.id, colorName: "Navy", quantity: 14 },
      { projectId: polo.id, materialId: jersey.id, colorName: "White", quantity: 6 },
      { projectId: polo.id, materialId: rib.id, colorName: "Navy", quantity: 1 },
    ],
  });
  await prisma.notificationLog.deleteMany();
  return {
    company,
    people,
    owner,
    pm,
    accounts,
    store,
    mill,
    embroidery,
    jersey,
    rib,
    buttons,
    batch,
    polo,
    tee,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function signInAs(env: Env, who: Who) {
  const { token } = await createSession(env.people[who].id, env.company.id);
  browser.cookies.set(SESSION_COOKIE, token);
}

const cell = (colorName: string | null, sizeName: string | null, quantity: number) => ({
  colorName,
  sizeName,
  quantity,
});

run("Production renovation: cutting, embroidery and the cutting and sewing dates", () => {
  let env: Env;

  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  it("records cutting by colour and size, cross-checks it and alerts on a shortage", async () => {
    const before = await cutting.getCuttingScreen(env.pm, env.polo.id);
    expect(before.hasGrid).toBe(true);
    expect(before.colours).toEqual(["Navy", "White"]);
    expect(before.sizes).toEqual(["S", "M", "L"]);
    expect(before.cells.map((c) => [c.colorName, c.sizeName, c.target, c.cut])).toEqual([
      ["Navy", "S", 20, 0],
      ["Navy", "M", 40, 0],
      ["Navy", "L", 40, 0],
      ["White", "S", 10, 0],
      ["White", "M", 20, 0],
      ["White", "L", 10, 0],
    ]);
    // The checks speak once cutting starts.
    expect(before.checks).toEqual([]);
    expect(before.milestones.cutting.level).toBe("UNSET");
    expect(before.can).toMatchObject({ record: true, faultNote: true, seeValues: true });
    expect(before.fabrics.map((f) => f.code).sort()).toEqual(
      [env.jersey.code, env.rib.code].sort(),
    );

    const made = await cutting.createCuttingReport(env.pm, env.polo.id, {
      lines: [cell("Navy", "S", 20), cell("Navy", "M", 40), cell("Navy", "L", 0)],
      fabricUsed: [{ materialId: env.jersey.id, quantity: 16 }],
      note: "Lay 1",
    });
    expect(made).toMatchObject({
      number: expect.stringMatching(/^CUT-/),
      pieces: 60,
      shortages: 3,
    });

    const after = await cutting.getCuttingScreen(env.pm, env.polo.id);
    expect(after.totals).toEqual({ cut: 60, spoiled: 0, out: 0, replaced: 0 });
    expect(after.reports).toHaveLength(1);
    expect(after.reports[0]).toMatchObject({
      number: made.number,
      kind: "CUT",
      pieces: 60,
      fabricUsed: [{ code: env.jersey.code, unit: "KG", quantity: "16" }],
      note: "Lay 1",
      readByAi: false,
    });
    // Zero cells are not kept.
    expect(after.reports[0]!.lines).toHaveLength(2);
    const byMaterial = new Map(after.checks.map((c) => [c.material.id, c]));
    // Jersey: 16 kg for 60 pieces is 3.75 a kg against 4 in the tech pack, and
    // the 4 kg left of the 20 issued cannot cut the 80 pieces still to cut.
    expect(byMaterial.get(env.jersey.id)).toMatchObject({
      about: "FABRIC",
      level: "SHORT",
      piecesPerUnit: { plan: 4, actual: 3.75 },
    });
    expect(byMaterial.get(env.jersey.id)!.text).toMatch(/short for the 80 pieces still to cut/);
    // Rib collars: what Navy S and M were cut needs more than was ordered for them.
    const collar = byMaterial.get(env.rib.id)!;
    expect(collar).toMatchObject({ about: "COLLAR_CUFF", level: "SHORT" });
    expect(collar.rows.map((r) => [r.colorName, r.sizeName, r.cut])).toEqual([
      ["Navy", "S", 20],
      ["Navy", "M", 40],
    ]);
    expect(collar.text).toMatch(/^Collar \(/);
    // Buttons: 60 pieces need 180; none issued.
    expect(byMaterial.get(env.buttons.id)).toMatchObject({ about: "ACCESSORY", level: "SHORT" });
    expect(byMaterial.get(env.buttons.id)!.text).toMatch(/180 pcs short/);
    expect(after.checks.every((c) => c.level === "SHORT")).toBe(true);

    // The alert reaches Production and the store, at once.
    const inbox = await prisma.notificationLog.findMany({ where: { channel: "IN_APP" } });
    const to = inbox.map((n) => n.userId);
    expect(to).toContain(env.people.production.id);
    expect(to).toContain(env.people.store.id);
    expect(to).not.toContain(env.people.accounts.id);
    expect(inbox[0]!.subject).toBe(`Cutting shortage on ${env.polo.code}`);
    expect(inbox[0]!.body).toMatch(new RegExp(`^After ${made.number} \\(60 pieces cut\\)`));
    expect(
      await prisma.auditLog.count({ where: { entityType: "CuttingReport", action: "CREATE" } }),
    ).toBe(1);

    // A style without colours has one cell.
    const tee = await cutting.createCuttingReport(env.pm, env.tee.id, {
      lines: [cell(null, null, 30)],
    });
    expect(tee.pieces).toBe(30);
    const teeScreen = await cutting.getCuttingScreen(env.pm, env.tee.id);
    expect(teeScreen.hasGrid).toBe(false);
    expect(teeScreen.cells).toEqual([
      expect.objectContaining({ colorName: null, sizeName: null, target: 50, cut: 30 }),
    ]);
  });

  it("refuses cutting that is not of the style, later, empty, or by the wrong role", async () => {
    const report = (lines: unknown[], extra: Record<string, unknown> = {}) =>
      cutting.createCuttingReport(env.pm, env.polo.id, { lines, ...extra });
    const notOfStyle = await expectAppError(report([cell("Black", "M", 5)]), "VALIDATION");
    expect(notOfStyle.details).toMatchObject({ "lines.0": expect.any(Array) });
    await expectAppError(report([cell("Navy", "M", 5), cell("Navy", "M", 6)]), "VALIDATION");
    await expectAppError(report([cell("Navy", "M", 0)]), "VALIDATION");
    const today = localDay(new Date(), env.company.timezone);
    await expectAppError(
      report([cell("Navy", "M", 5)], { cutOn: addDays(today, 1) }),
      "VALIDATION",
    );
    // Fabric used must be a fabric of the style.
    await expectAppError(
      report([cell("Navy", "M", 5)], { fabricUsed: [{ materialId: env.buttons.id, quantity: 2 }] }),
      "VALIDATION",
    );
    await expectAppError(
      cutting.createCuttingReport(env.store, env.polo.id, { lines: [cell("Navy", "M", 5)] }),
      "FORBIDDEN",
    );
    // The store and Accounts read it, without recording.
    expect((await cutting.getCuttingScreen(env.store, env.polo.id)).can).toMatchObject({
      record: false,
      faultNote: false,
      seeValues: false,
    });
    expect((await cutting.getCuttingScreen(env.accounts, env.polo.id)).can.record).toBe(false);
    expect(await prisma.cuttingReport.count()).toBe(0);

    // Through the action, too.
    await signInAs(env, "store");
    const refused = await createCuttingReportAction(env.polo.id, { lines: [cell("Navy", "M", 5)] });
    expect(refused.ok).toBe(false);
    expect(data(await getCuttingScreenAction(env.polo.id), "screen").project.code).toBe(
      env.polo.code,
    );
  });

  it("sends pieces for embroidery, takes them back and replaces the spoiled ones from cutting", async () => {
    const first = await cutting.createCuttingReport(env.pm, env.polo.id, {
      lines: [cell("Navy", "M", 40), cell("White", "M", 20)],
    });
    const today = localDay(new Date(), env.company.timezone);
    // No more than is cut and not already out.
    await expectAppError(
      cutting.sendToEmbroidery(env.pm, env.polo.id, {
        kind: "EMBROIDERY",
        lines: [cell("Navy", "S", 5)],
      }),
      "CONFLICT",
    );
    const job = await cutting.sendToEmbroidery(env.pm, env.polo.id, {
      kind: "EMBROIDERY",
      partyId: env.embroidery.id,
      dueOn: addDays(today, 5),
      lines: [cell("Navy", "M", 30)],
    });
    expect(job.number).toMatch(/^EMB-/);
    const tooMany = await expectAppError(
      cutting.sendToEmbroidery(env.pm, env.polo.id, {
        kind: "PRINT",
        lines: [cell("Navy", "M", 11)],
      }),
      "CONFLICT",
    );
    expect(tooMany.message).toMatch(/10 cut pieces are free to send/);
    await expectAppError(
      cutting.sendToEmbroidery(env.pm, env.polo.id, {
        kind: "EMBROIDERY",
        sentOn: today,
        dueOn: addDays(today, -1),
        lines: [cell("Navy", "M", 1)],
      }),
      "VALIDATION",
    );

    // Back a little at a time: 25 good and 3 spoiled, then the last 2.
    const back = await cutting.receiveFromEmbroidery(env.pm, job.id, {
      lines: [{ colorName: "Navy", sizeName: "M", received: 25, spoiled: 3 }],
    });
    expect(back).toMatchObject({
      good: 25,
      spoiled: 3,
      spoiledLines: [{ colorName: "Navy", sizeName: "M", quantity: 3 }],
    });
    await expectAppError(
      cutting.receiveFromEmbroidery(env.pm, job.id, {
        lines: [{ colorName: "Navy", sizeName: "M", received: 3, spoiled: 0 }],
      }),
      "VALIDATION",
    );
    await expectAppError(
      cutting.receiveFromEmbroidery(env.pm, job.id, {
        lines: [{ colorName: "White", sizeName: "M", received: 1, spoiled: 0 }],
      }),
      "VALIDATION",
    );
    let screen = await cutting.getCuttingScreen(env.pm, env.polo.id);
    expect(screen.jobs[0]).toMatchObject({
      number: job.number,
      kind: "EMBROIDERY",
      party: { id: env.embroidery.id, name: "Mirpur Embroidery" },
      sent: 30,
      back: 25,
      spoiled: 3,
      out: 2,
      toReplace: 3,
      late: false,
      receivedOn: null,
    });
    expect(screen.totals).toMatchObject({ cut: 60, spoiled: 3, out: 2 });

    // Replace from cutting at once, and log it against the embroidery house.
    await expectAppError(
      cutting.replaceFromCutting(env.pm, job.id, { lines: [cell("Navy", "M", 4)] }),
      "VALIDATION",
    );
    const replaced = await cutting.replaceFromCutting(env.pm, job.id, {
      lines: [cell("Navy", "M", 3)],
      logFault: true,
    });
    expect(replaced).toMatchObject({ pieces: 3, number: expect.stringMatching(/^CUT-/) });
    expect(replaced.fault?.number).toMatch(/^FLT-/);
    const fault = await prisma.supplierFault.findUniqueOrThrow({
      where: { id: replaced.fault!.id },
    });
    expect(fault).toMatchObject({
      supplierId: env.embroidery.id,
      kind: "QUALITY",
      projectId: env.polo.id,
      batchId: env.batch.id,
    });
    const alert = await prisma.notificationLog.findFirst({
      where: { subject: `Replace from cutting: ${env.polo.code}` },
    });
    expect(alert?.userId).toBeDefined();
    await expectAppError(
      cutting.replaceFromCutting(env.pm, job.id, { lines: [cell("Navy", "M", 1)] }),
      "VALIDATION",
    );

    const last = await cutting.receiveFromEmbroidery(env.pm, job.id, {
      lines: [{ colorName: "Navy", sizeName: "M", received: 2, spoiled: 0 }],
    });
    expect(last.spoiled).toBe(0);
    screen = await cutting.getCuttingScreen(env.pm, env.polo.id);
    expect(screen.jobs[0]).toMatchObject({ out: 0, toReplace: 0, receivedOn: today });
    expect(screen.totals).toEqual({ cut: 63, spoiled: 3, out: 0, replaced: 3 });
    expect(screen.reports.find((r) => r.kind === "REPLACEMENT")).toMatchObject({
      forJob: job.number,
      pieces: 3,
    });

    // A report whose pieces went out cannot be deleted; one entered by mistake can.
    await expectAppError(cutting.deleteCuttingReport(env.pm, first.id), "CONFLICT");
    const mistake = await cutting.createCuttingReport(env.pm, env.polo.id, {
      lines: [cell("White", "S", 4)],
    });
    await expectAppError(cutting.deleteCuttingReport(env.store, mistake.id), "FORBIDDEN");
    await cutting.deleteCuttingReport(env.pm, mistake.id);
    expect(await prisma.cuttingReport.count({ where: { id: mistake.id } })).toBe(0);
  });

  it("warns when cutting or sewing runs late, on the style and on its batch", async () => {
    const today = localDay(new Date(), env.company.timezone);
    await expectAppError(
      cutting.setMilestones(env.pm, env.polo.id, { cutBy: today, sewBy: addDays(today, -1) }),
      "VALIDATION",
    );
    await expectAppError(
      cutting.setMilestones(env.pm, env.polo.id, { cutBy: "2031-01-10" }),
      "VALIDATION",
    );
    await expectAppError(
      cutting.setMilestones(env.store, env.polo.id, { cutBy: today }),
      "FORBIDDEN",
    );
    await cutting.setMilestones(env.pm, env.polo.id, {
      cutBy: addDays(today, -2),
      sewBy: addDays(today, 2),
    });
    await cutting.createCuttingReport(env.pm, env.polo.id, { lines: [cell("Navy", "M", 40)] });
    const screen = await cutting.getCuttingScreen(env.pm, env.polo.id);
    expect(screen.project).toMatchObject({ cutBy: addDays(today, -2), sewBy: addDays(today, 2) });
    expect(screen.milestones.cutting).toMatchObject({ level: "LATE", days: 2 });
    expect(screen.milestones.sewing).toMatchObject({ level: "DUE_SOON", days: 2 });
    expect(screen.warnings).toEqual([
      { level: "LATE", text: "Cutting is 2 days late: 40 of 140 pieces cut." },
      { level: "DUE_SOON", text: "Sewing is due in 2 days." },
    ]);
    const onBatch = await cutting.batchDateWarnings(env.store, env.batch.id);
    expect(onBatch.map((w) => [w.project.code, w.level])).toEqual([
      [env.polo.code, "LATE"],
      [env.polo.code, "DUE_SOON"],
    ]);

    // Cutting everything is done, whatever the day.
    await cutting.createCuttingReport(env.pm, env.polo.id, {
      lines: [
        cell("Navy", "S", 20),
        cell("Navy", "L", 40),
        cell("White", "S", 10),
        cell("White", "M", 20),
        cell("White", "L", 10),
      ],
    });
    const done = await cutting.getCuttingScreen(env.pm, env.polo.id);
    expect(done.milestones.cutting.level).toBe("DONE");
    expect(done.warnings.map((w) => w.text)).toEqual(["Sewing is due in 2 days."]);

    // Clearing the days clears the warnings.
    await cutting.setMilestones(env.pm, env.polo.id, { cutBy: null, sewBy: null });
    expect(await cutting.batchDateWarnings(env.pm, env.batch.id)).toEqual([]);
  });

  it("logs a Fabric Fault Note with its photo into the supplier's fault log", async () => {
    const uploads = await mkdtemp(path.join(os.tmpdir(), "extras-uploads-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    try {
      const photo = await files.storeUpload(env.pm, {
        fileName: "hole.jpg",
        bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("hole")]),
      });
      await expectAppError(
        cutting.fabricFaultNote(env.pm, env.polo.id, {
          materialId: env.buttons.id,
          supplierId: env.mill.id,
          quantity: 2,
          note: "Not a fabric",
        }),
        "VALIDATION",
      );
      await expectAppError(
        cutting.fabricFaultNote(env.store, env.polo.id, {
          materialId: env.jersey.id,
          supplierId: env.mill.id,
          quantity: 2,
          note: "Holes in roll 3",
        }),
        "FORBIDDEN",
      );
      const note = await cutting.fabricFaultNote(env.pm, env.polo.id, {
        materialId: env.jersey.id,
        supplierId: env.mill.id,
        quantity: 2.5,
        amount: 1300,
        photoId: photo.id,
        note: "Holes in roll 3, set aside at cutting",
      });
      const list = await faults.listFaults(env.accounts, { supplierId: env.mill.id });
      expect(list.items[0]).toMatchObject({
        number: note.number,
        kind: "FABRIC_FAULT",
        quantity: "2.5",
        amount: "1300.00",
        photoId: photo.id,
        project: { id: env.polo.id },
        batch: { id: env.batch.id },
        material: { id: env.jersey.id },
      });
      // Everyone who reads the fault log opens the photo.
      const opened = await files.getFileForDownload(env.store, photo.id);
      expect(opened.asset.id).toBe(photo.id);
    } finally {
      vi.unstubAllEnvs();
      await rm(uploads, { recursive: true, force: true });
    }
  });

  it("reads a photo of the cutting sheet with AI into the style's colours and sizes", async () => {
    const uploads = await mkdtemp(path.join(os.tmpdir(), "extras-uploads-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    try {
      const photo = await files.storeUpload(env.pm, {
        fileName: "cutting.jpg",
        bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("sheet")]),
      });
      const parse = vi.fn<IntakeParser["parse"]>(async () => ({
        lines: [
          { sku: null, styleCode: null, color: "navy", size: "m", quantity: 38, grade: "A_GRADE" },
          { sku: null, styleCode: null, color: "NAVY", size: "M", quantity: 2, grade: "A_GRADE" },
          {
            sku: null,
            styleCode: null,
            color: "White",
            size: "Small",
            quantity: 10,
            grade: "A_GRADE",
          },
          {
            sku: null,
            styleCode: null,
            color: "Maroon",
            size: "XL",
            quantity: 5,
            grade: "A_GRADE",
          },
        ],
        confidence: 0.86,
        notes: "Two lays",
        model: "test",
      }));
      const read = await cutting.readCuttingPhoto(env.pm, env.polo.id, photo.id, { parse });
      expect(parse.mock.calls[0]![1]).toMatchObject({
        document: "CUTTING_REPORT",
        colors: ["Navy", "White"],
        sizes: ["S", "M", "L"],
      });
      expect(read).toEqual({
        lines: [
          { colorName: "Navy", sizeName: "M", quantity: 40 },
          { colorName: "White", sizeName: "S", quantity: 10 },
        ],
        unmatched: [{ color: "Maroon", size: "XL", quantity: 5 }],
        confidence: 86,
        notes: "Two lays",
      });
      // Nothing is saved until it is checked and saved.
      expect(await prisma.cuttingReport.count()).toBe(0);
      const saved = await cutting.createCuttingReport(env.pm, env.polo.id, {
        lines: read.lines,
        photoId: photo.id,
        readByAi: true,
      });
      expect(
        await prisma.cuttingReport.findUniqueOrThrow({ where: { id: saved.id } }),
      ).toMatchObject({ photoId: photo.id, readByAi: true });

      // Without AI set up, it says so.
      const off = await expectAppError(
        cutting.readCuttingPhoto(env.pm, env.polo.id, photo.id, null),
        "UNAVAILABLE",
      );
      expect(off.message).toMatch(/Type the pieces into the grid/);
    } finally {
      vi.unstubAllEnvs();
      await rm(uploads, { recursive: true, force: true });
    }
  });
});
