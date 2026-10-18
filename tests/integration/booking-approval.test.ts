import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Booking approval, revisions, Fabric first and the booking book: a booking is
 * a draft until the owner approves it, and no goods arrive on it before; it is
 * then marked as sent. A change to its items after that makes the next revision
 * (R1, R2), listing what changed and the fabric at risk, approved again. With
 * Fabric first on a batch, its fabric waits for each style's locked fabric part
 * and its trims for the approved tech pack. The booking book puts every booking
 * of a batch in one PDF, with the pages of each part on its cover.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import type { Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as materials from "@/modules/materials/material.service";
import * as purchases from "@/modules/materials/purchase.service";
import * as parties from "@/modules/parties/party.service";
import { renderWithParts } from "@/modules/documents/render";
import * as batches from "@/modules/production/batch.service";
import {
  bookingBookData,
  bookingBookDocument,
  bookingBookPdf,
} from "@/modules/production/booking-book.service";
import { bookingDocument } from "@/modules/production/booking-pdf.service";
import * as bookings from "@/modules/production/booking.service";
import * as needs from "@/modules/production/material-need.service";
import * as projects from "@/modules/production/project.service";
import * as receive from "@/modules/production/receive.service";
import * as techPacks from "@/modules/production/tech-pack-approval.service";
import { createRole } from "@/modules/rbac/role.service";

import { pdfProblems } from "../../scripts/full-check/pdf-text.mjs";
import { pdfLines } from "../fixtures/pdf";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  store: "WAREHOUSE_TEAM",
  sales: "SALES_EXECUTIVE",
} as const;
type Who = keyof typeof ROLES;

async function expectAppError(promise: Promise<unknown>, code: string, message?: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (message) expect((error as AppError).message).toMatch(message);
  return error as AppError;
}

/**
 * Extas with one person per role; a batch with a polo in Navy and White × S M L
 * and a tee (a total only), each with jersey and buttons per piece; a mill and
 * a trims house.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const people = {} as Record<Who, { id: string }>;
  for (const [who, role] of Object.entries(ROLES) as Array<[Who, keyof typeof roles]>) {
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, company.id, roles[role]);
    people[who] = user;
  }
  const owner = await contextFor(people.owner.id, company.id);
  const pm = await contextFor(people.production.id, company.id);
  const store = await contextFor(people.store.id, company.id);
  const sales = await contextFor(people.sales.id, company.id);
  const sizes = [];
  for (const name of ["S", "M", "L"]) sizes.push(await catalog.createSize(owner, { name }));
  const navy = await catalog.createColor(owner, { name: "Navy", hexCode: "#1f2a44" });
  const white = await catalog.createColor(owner, { name: "White", hexCode: "#FFFFFF" });
  const polos = await catalog.createCategory(owner, { name: "Polo shirts" });
  const style = await styles.createStyle(owner, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: polos.id,
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
  const jersey = await materials.createMaterial(pm, {
    name: "Single Jersey 180 GSM",
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
    name: "Winter 2026",
    factoryId: knit.id,
    targetDate: "2026-12-20",
  });
  const polo = await projects.createProject(pm, {
    name: "Brand A polo",
    batchId: batch.id,
    targetDate: "2026-12-20",
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
    targetDate: "2026-12-20",
    targetQuantity: 50,
  });
  await needs.setMaterialNeeds(pm, polo.id, {
    needs: [
      { materialId: jersey.id, perPiece: 0.285, wastagePercent: 5, split: "COLOUR" },
      { materialId: buttons.id, perPiece: 3, placement: "Button" },
    ],
  });
  await needs.setMaterialNeeds(pm, tee.id, {
    needs: [
      { materialId: jersey.id, perPiece: 0.3, split: "COLOUR" },
      { materialId: buttons.id, perPiece: 3 },
    ],
  });
  return { owner, pm, store, sales, mill, trims, jersey, buttons, batch, polo, tee };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** A fabric booking from the mill: on the batch (shared out over its styles) or on its own. */
const fabricBooking = (env: Env, quantity: number, more: Record<string, unknown> = {}) => ({
  source: "SUPPLIER_PO",
  category: "KNITWEAR",
  supplierId: env.mill.id,
  lines: [{ materialId: env.jersey.id, quantity, unitPrice: 400 }],
  ...more,
});

const receiveOne = (env: Env, orderId: string, lineId: string) =>
  purchases.createPurchase(env.pm, {
    purchaseOrderId: orderId,
    paymentType: "DUE",
    items: [{ purchaseOrderLineId: lineId, quantity: 1 }],
  });

run("Booking approval and revisions", () => {
  beforeEach(resetDb);

  it("keeps a booking a draft until the owner approves it, and no goods arrive before", async () => {
    const env = await setup();
    const made = await bookings.createBooking(
      env.pm,
      fabricBooking(env, 56.895, { batchId: env.batch.id }),
    );
    expect(made).toMatchObject({ stage: "DRAFT", revision: 0, docNo: `${made.number}-R0` });

    // The owner sees the checks: the in-house date is missing, the tech packs not approved.
    const seen = await bookings.getBooking(env.owner, made.id);
    expect(seen.can).toMatchObject({ approve: true, markSent: false, receive: false });
    expect(seen.checks).toEqual(
      expect.arrayContaining([
        { text: "Books 1 item(s)", state: "ok" },
        { text: "Each item's style shares add up to it", state: "ok" },
        { text: "Set the in-house date (Deliver by) in the paperwork", state: "block" },
        {
          text: `The tech pack of ${env.polo.code}, ${env.tee.code} is not approved yet`,
          state: "warn",
        },
      ]),
    );
    // Only the owner approves; a block stops even the owner.
    expect((await bookings.getBooking(env.pm, made.id)).can.approve).toBe(false);
    await expectAppError(bookings.approveBooking(env.pm, made.id), "FORBIDDEN");
    await expectAppError(bookings.approveBooking(env.owner, made.id), "CONFLICT", /in-house date/);

    // Nothing arrives on a draft, and the batch's receive does not offer it.
    await expectAppError(
      receiveOne(env, made.orderId, made.lines[0]!.id),
      "CONFLICT",
      /draft booking: it is approved before goods arrive/,
    );
    expect((await receive.getBatchReceive(env.pm, env.batch.id)).orders).toEqual([]);

    // The paperwork changes without a new revision.
    const dated = await bookings.updateBookingPaperwork(env.pm, made.id, {
      expectedDate: "2030-11-15",
    });
    expect(dated).toMatchObject({ stage: "DRAFT", revision: 0 });

    const approved = await bookings.approveBooking(env.owner, made.id);
    expect(approved).toMatchObject({
      stage: "APPROVED",
      approvedBy: { name: expect.any(String) },
      can: { approve: false, receive: true },
      checks: [],
    });
    const kept = await prisma.bookingRevision.findMany({ where: { bookingId: made.id } });
    expect(kept.map((r) => r.revision)).toEqual([0]);
    const basis = await prisma.booking.findUniqueOrThrow({
      where: { id: made.id },
      select: { fabricBasis: true },
    });
    expect(Object.keys(basis.fabricBasis as object).sort()).toEqual(
      [env.polo.id, env.tee.id].sort(),
    );
    await expectAppError(bookings.approveBooking(env.owner, made.id), "CONFLICT", /already/);

    // Whoever makes the booking marks it as sent; the store cannot.
    await expectAppError(bookings.markBookingSent(env.store, made.id), "FORBIDDEN");
    const sent = await bookings.markBookingSent(env.pm, made.id);
    expect(sent).toMatchObject({ stage: "SENT", sentBy: { name: expect.any(String) } });
    await expectAppError(bookings.markBookingSent(env.pm, made.id), "CONFLICT", /already/);

    // Now the goods arrive.
    expect((await receive.getBatchReceive(env.pm, env.batch.id)).orders.map((o) => o.id)).toEqual([
      made.orderId,
    ]);
    await receiveOne(env, made.orderId, made.lines[0]!.id);
    const log = await prisma.auditLog.findMany({
      where: { entityType: "Booking", entityId: made.id },
      orderBy: { createdAt: "asc" },
      select: { summary: true },
    });
    expect(log.map((l) => l.summary)).toEqual(
      expect.arrayContaining([
        `Approved booking ${made.number}-R0 to Narayanganj Fabrics`,
        `Marked booking ${made.number}-R0 as sent to Narayanganj Fabrics`,
      ]),
    );
  });

  it("makes revision R1 when a sent booking changes, with the changes and the fabric at risk", async () => {
    const env = await setup();
    const input = (jersey: number, price: number) => ({
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.mill.id,
      expectedDate: "2030-11-15",
      lines: [
        { materialId: env.jersey.id, quantity: jersey, unitPrice: price },
        { materialId: env.buttons.id, quantity: 300, unitPrice: 1.5 },
      ],
    });
    const made = await bookings.createBooking(env.pm, input(60, 400));
    await bookings.approveBooking(env.owner, made.id);
    await bookings.markBookingSent(env.pm, made.id);

    const r1 = await bookings.updateBooking(env.pm, made.id, input(70, 420));
    const jersey = `${made.lines[0]!.material.code} Single Jersey 180 GSM`;
    expect(r1).toMatchObject({
      stage: "DRAFT",
      revision: 1,
      revisionLabel: "R1",
      docNo: `${made.number}-R1`,
      approvedOn: null,
      sentOn: null,
      can: { receive: false },
    });
    expect(r1.changes).toEqual({
      from: 0,
      wasSent: true,
      changes: [
        { item: `${jersey}: quantity`, was: "60 kg", now: "70 kg" },
        { item: `${jersey}: price`, was: "400", now: "420", cost: true },
      ],
      atRisk: [{ unit: "KG", quantity: "60" }],
    });
    // The store does not see prices, not even in what changed.
    const forStore = await bookings.getBooking(env.store, made.id);
    expect(forStore.changes?.changes.map((c) => c.item)).toEqual([`${jersey}: quantity`]);
    await expectAppError(receiveOne(env, made.orderId, r1.lines[0]!.id), "CONFLICT");

    // Changed again while a draft: still R1, compared with R0.
    const again = await bookings.updateBooking(env.pm, made.id, input(65, 400));
    expect(again.revision).toBe(1);
    expect(again.changes?.changes).toEqual([
      { item: `${jersey}: quantity`, was: "60 kg", now: "65 kg" },
    ]);

    // The supplier's copy says which revision it is and what changed.
    const doc = bookingDocument(env.pm, again);
    expect(doc).toMatchObject({ reference: `${made.number}-R1`, stamp: { text: "Draft" } });
    const changes = doc.blocks.find((b) => b.kind === "table" && b.title === "Changes from R0");
    expect(changes?.kind === "table" && changes.rows.map((r) => r.cells)).toEqual([
      [`${jersey}: quantity`, "60 kg", "65 kg"],
    ]);
    expect(doc.frame!.fields[0]).toEqual({ label: "Doc no", value: `${made.number}-R1` });

    const approved = await bookings.approveBooking(env.owner, made.id);
    expect(approved).toMatchObject({ stage: "APPROVED", revision: 1 });
    const kept = await prisma.bookingRevision.findMany({
      where: { bookingId: made.id },
      orderBy: { revision: "asc" },
    });
    expect(kept.map((r) => r.revision)).toEqual([0, 1]);
    expect(kept[1]!.snapshot).toMatchObject({ lines: [{ quantity: "65" }, { quantity: "300" }] });

    // Saving it unchanged makes no new revision.
    const same = await bookings.updateBooking(env.pm, made.id, input(65, 400));
    expect(same).toMatchObject({ stage: "APPROVED", revision: 1 });
  });

  it("keeps the first state of a booking made before approvals when it changes", async () => {
    const env = await setup();
    const made = await bookings.createBooking(env.pm, fabricBooking(env, 60));
    // Bookings made before approvals were counted as sent, without a kept revision.
    await prisma.booking.update({
      where: { id: made.id },
      data: { stage: "SENT", sentAt: new Date() },
    });
    const changed = await bookings.updateBooking(env.pm, made.id, fabricBooking(env, 75));
    expect(changed).toMatchObject({ stage: "DRAFT", revision: 1 });
    expect(changed.changes?.changes[0]).toMatchObject({ was: "60 kg", now: "75 kg" });
    const first = await prisma.bookingRevision.findUniqueOrThrow({
      where: { bookingId_revision: { bookingId: made.id, revision: 0 } },
    });
    expect(first.snapshot).toMatchObject({ lines: [{ quantity: "60" }] });
  });
});

run("What the supplier is told needs approval again (v6.3)", () => {
  beforeEach(resetDb);

  /** The paperwork as the form sends it: every field, changed or not. */
  const paperwork = (more: Record<string, unknown> = {}) => ({
    expectedDate: "2030-11-15",
    title: "Winter jersey",
    deliveryPlace: "Gazipur store",
    paymentTerms: "30 days after delivery",
    termsLanguage: "EN",
    terms: "Fabric must match the approved lab dip.\nDeliver in rolls of 20 kg.",
    ...more,
  });

  it("makes R1 when the in-house date, delivery place, payment terms or terms change after approval", async () => {
    const env = await setup();
    const made = await bookings.createBooking(
      env.pm,
      fabricBooking(env, 60, {
        expectedDate: "2030-11-15",
        deliveryPlace: "Gazipur store",
        paymentTerms: "30 days after delivery",
        terms: "Fabric must match the approved lab dip.\nDeliver in rolls of 20 kg.",
      }),
    );
    await bookings.approveBooking(env.owner, made.id);
    await bookings.markBookingSent(env.pm, made.id);

    // The title, references and notes are the company's own: no revision.
    const titled = await bookings.updateBookingPaperwork(
      env.pm,
      made.id,
      paperwork({ title: "Winter jersey, first lot", supplierRef: "NF-881", notes: "Call first" }),
    );
    expect(titled).toMatchObject({ stage: "SENT", revision: 0 });

    // A new delivery place makes R1, a draft that waits for approval; nothing arrives meanwhile.
    const moved = await bookings.updateBookingPaperwork(
      env.pm,
      made.id,
      paperwork({ deliveryPlace: "Ashulia cutting floor" }),
    );
    expect(moved).toMatchObject({ stage: "DRAFT", revision: 1, docNo: `${made.number}-R1` });
    expect(moved.changes?.changes).toEqual([
      { item: "Delivery place", was: "Gazipur store", now: "Ashulia cutting floor" },
    ]);
    await expectAppError(receiveOne(env, made.orderId, made.lines[0]!.id), "CONFLICT");
    await bookings.approveBooking(env.owner, made.id);

    // The in-house date, payment terms and one line of the terms: R2, each listed.
    const r2 = await bookings.updateBookingPaperwork(
      env.pm,
      made.id,
      paperwork({
        expectedDate: "2030-11-25",
        deliveryPlace: "Ashulia cutting floor",
        paymentTerms: "LC at sight",
        terms: "Fabric must match the approved lab dip.\nDeliver in rolls of 25 kg.",
      }),
    );
    expect(r2).toMatchObject({ stage: "DRAFT", revision: 2 });
    expect(r2.changes?.changes).toEqual([
      { item: "In-house date", was: "2030-11-15", now: "2030-11-25" },
      { item: "Payment terms", was: "30 days after delivery", now: "LC at sight" },
      {
        item: "Terms and conditions",
        was: "Line 2: Deliver in rolls of 20 kg.",
        now: "Line 2: Deliver in rolls of 25 kg.",
      },
    ]);
    const log = await prisma.auditLog.findMany({
      where: { entityType: "Booking", entityId: made.id, summary: { contains: "paperwork" } },
      orderBy: { createdAt: "asc" },
      select: { summary: true },
    });
    expect(log.at(-1)?.summary).toContain(`now draft ${made.number}-R2`);
  });

  it("compares a booking approved before v6.3 with its paperwork as it stands", async () => {
    const env = await setup();
    const made = await bookings.createBooking(
      env.pm,
      fabricBooking(env, 60, { expectedDate: "2030-11-15", paymentTerms: "30 days" }),
    );
    await bookings.approveBooking(env.owner, made.id);
    // A snapshot kept by v6.2 had no paperwork and no batch.
    const kept = await prisma.bookingRevision.findUniqueOrThrow({
      where: { bookingId_revision: { bookingId: made.id, revision: 0 } },
    });
    const old = Object.fromEntries(
      Object.entries(kept.snapshot as Record<string, Prisma.InputJsonValue>).filter(
        ([key]) => key !== "paperwork" && key !== "batch",
      ),
    );
    await prisma.bookingRevision.update({ where: { id: kept.id }, data: { snapshot: old } });

    const changed = await bookings.updateBookingPaperwork(
      env.pm,
      made.id,
      paperwork({ paymentTerms: "60 days", deliveryPlace: null, title: null, terms: null }),
    );
    expect(changed).toMatchObject({ stage: "DRAFT", revision: 1 });
    expect(changed.changes?.changes).toEqual([
      { item: "Payment terms", was: "30 days", now: "60 days" },
    ]);
    const filled = await prisma.bookingRevision.findUniqueOrThrow({ where: { id: kept.id } });
    expect(filled.snapshot).toMatchObject({ batch: null, paperwork: { paymentTerms: "30 days" } });
  });

  it("makes a revision when an approved booking goes on a batch, so the batch's checks apply", async () => {
    const env = await setup();
    // Buttons approved on their own: no style, so no tech pack to wait for.
    const made = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.trims.id,
      expectedDate: "2030-11-20",
      lines: [{ materialId: env.buttons.id, quantity: 720, unitPrice: 2 }],
    });
    await bookings.approveBooking(env.owner, made.id);
    const attached = await bookings.attachBooking(env.pm, made.id, { batchId: env.batch.id });
    expect(attached.booking).toMatchObject({ stage: "DRAFT", revision: 1 });
    expect(attached.booking.changes?.changes).toContainEqual({
      item: "Master batch",
      was: "None",
      now: env.batch.code,
    });
    // On the batch, the buttons wait for the styles' tech packs.
    const seen = await bookings.getBooking(env.owner, made.id);
    expect(seen.checks).toContainEqual({
      text: `Collar, cuff and trims wait for the tech pack of ${env.polo.code}, ${env.tee.code} to be approved`,
      state: "block",
      override: true,
    });
    await expectAppError(
      bookings.approveBooking(env.owner, made.id),
      "CONFLICT",
      /Collar, cuff and trims wait for the tech pack/,
    );

    // Taken off again after approval: another revision.
    await techPacks.approveTechPack(env.owner, env.polo.id);
    await techPacks.approveTechPack(env.owner, env.tee.id);
    await bookings.approveBooking(env.owner, made.id);
    const off = await bookings.detachBooking(env.pm, made.id);
    expect(off).toMatchObject({ stage: "DRAFT", revision: 2 });
    expect(off.changes?.changes).toContainEqual({
      item: "Master batch",
      was: env.batch.code,
      now: "None",
    });
  });

  it("makes trims for a style off any batch wait for that style's tech pack", async () => {
    const env = await setup();
    const made = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.trims.id,
      expectedDate: "2030-11-20",
      lines: [{ materialId: env.buttons.id, quantity: 720, unitPrice: 2 }],
    });
    // An order kept for one style without a batch (as Materials could set before).
    await prisma.purchaseOrder.update({
      where: { id: made.orderId },
      data: { projectId: env.polo.id },
    });
    const seen = await bookings.getBooking(env.owner, made.id);
    expect(seen.checks).toContainEqual({
      text: `Collar, cuff and trims wait for the tech pack of ${env.polo.code} to be approved`,
      state: "block",
      override: true,
    });
    await expectAppError(
      bookings.approveBooking(env.owner, made.id),
      "CONFLICT",
      /Collar, cuff and trims wait for the tech pack/,
    );
    await techPacks.approveTechPack(env.owner, env.polo.id);
    await bookings.approveBooking(env.owner, made.id);
  });

  it("counts only a fabric material as fabric, whatever role an older line says", async () => {
    const env = await setup();
    const made = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.trims.id,
      expectedDate: "2030-11-20",
      lines: [{ materialId: env.buttons.id, quantity: 720, unitPrice: 2 }],
    });
    await prisma.purchaseOrder.update({
      where: { id: made.orderId },
      data: { projectId: env.polo.id },
    });
    // A line saved before roles were checked: buttons marked as fabric.
    await prisma.purchaseOrderLine.updateMany({
      where: { orderId: made.orderId },
      data: { specs: { role: "FABRIC" } },
    });
    const seen = await bookings.getBooking(env.owner, made.id);
    expect(seen.checks).toContainEqual({
      text: `Collar, cuff and trims wait for the tech pack of ${env.polo.code} to be approved`,
      state: "block",
      override: true,
    });
    await expectAppError(
      bookings.approveBooking(env.owner, made.id),
      "CONFLICT",
      /Collar, cuff and trims wait for the tech pack/,
    );
  });

  it("counts an item in no style's materials list for every style of the batch", async () => {
    const env = await setup();
    await bookings.setFabricFirst(env.owner, env.batch.id, true);
    const rib = await materials.createMaterial(env.pm, {
      name: "1x1 Rib 220 GSM",
      kind: "FABRIC",
      unit: "KG",
      supplierId: env.mill.id,
    });
    const tape = await materials.createMaterial(env.pm, {
      name: "Neck Tape 10 mm",
      kind: "TRIM",
      unit: "PCS",
      supplierId: env.trims.id,
    });
    const made = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.mill.id,
      batchId: env.batch.id,
      expectedDate: "2030-11-20",
      lines: [
        { materialId: rib.id, quantity: 12, unitPrice: 450 },
        { materialId: tape.id, quantity: 300, unitPrice: 1 },
      ],
    });
    const seen = await bookings.getBooking(env.owner, made.id);
    expect(seen.checks).toEqual(
      expect.arrayContaining([
        {
          text: `${rib.code}, ${tape.code} are in no style's materials list: counted for every style of ${env.batch.code}`,
          state: "warn",
        },
        {
          text: `Fabric first: lock the fabric part of ${env.polo.code}, ${env.tee.code}`,
          state: "block",
        },
        {
          text: `Collar, cuff and trims wait for the tech pack of ${env.polo.code}, ${env.tee.code} to be approved`,
          state: "block",
          override: true,
        },
      ]),
    );
    // A reason passes the trims check, never the fabric lock.
    await expectAppError(
      bookings.approveBooking(env.owner, made.id, undefined, {
        overrideReason: "Buyer is waiting",
      }),
      "CONFLICT",
      /lock the fabric part/,
    );
  });

  it("lets the owner approve collar, cuff and trims before the tech pack with a reason, kept in the log", async () => {
    const env = await setup();
    const made = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.trims.id,
      batchId: env.batch.id,
      expectedDate: "2030-11-20",
      lines: [{ materialId: env.buttons.id, quantity: 720, unitPrice: 2 }],
    });
    await expectAppError(
      bookings.approveBooking(env.owner, made.id),
      "CONFLICT",
      /Collar, cuff and trims wait for the tech pack/,
    );
    await expect(
      bookings.approveBooking(env.owner, made.id, undefined, { overrideReason: "ok" }),
    ).rejects.toThrow(/at least 5 characters/);
    // The AI never approves past a check.
    const { asAi } = await import("@/modules/ai/account");
    await expectAppError(
      bookings.approveBooking(await asAi(env.owner), made.id, undefined, {
        overrideReason: "Buyer is waiting for buttons",
      }),
      "FORBIDDEN",
      /Only a person/,
    );
    // Approving bookings is not enough to approve past the tech pack: only the owner, or
    // whoever the owner gives "production.bookings.override".
    const company = await prisma.company.findFirstOrThrow();
    const approverRole = await createRole(env.owner, {
      name: "Booking approver",
      permissions: ["production.bookings.view", "production.bookings.approve"],
    });
    const approver = await makeUser("approver@extas.test");
    await addToCompany(approver.id, company.id, approverRole.id);
    const approverCtx = await contextFor(approver.id, company.id);
    expect((await bookings.getBooking(approverCtx, made.id)).can).toMatchObject({
      approve: true,
      override: false,
    });
    expect((await bookings.getBooking(env.owner, made.id)).can.override).toBe(true);
    await expectAppError(
      bookings.approveBooking(approverCtx, made.id, undefined, {
        overrideReason: "Buyer is waiting for buttons",
      }),
      "FORBIDDEN",
      /owner/,
    );
    const trusted = await createRole(env.owner, {
      name: "Trusted approver",
      permissions: [
        "production.bookings.view",
        "production.bookings.approve",
        "production.bookings.override",
      ],
    });
    const deputy = await makeUser("deputy@extas.test");
    await addToCompany(deputy.id, company.id, trusted.id);
    expect(
      (await bookings.getBooking(await contextFor(deputy.id, company.id), made.id)).can.override,
    ).toBe(true);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: made.id } })).stage).toBe(
      "DRAFT",
    );
    const approved = await bookings.approveBooking(env.owner, made.id, undefined, {
      overrideReason: "Buyer confirmed the buttons by email",
    });
    expect(approved).toMatchObject({ stage: "APPROVED", revision: 0 });
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Booking", entityId: made.id, summary: { startsWith: "Approved" } },
      select: { summary: true },
    });
    expect(log.summary).toBe(
      `Approved booking ${made.number}-R0 to Dhaka Trims House past a check (Collar, cuff and trims wait for the tech pack of ${env.polo.code}, ${env.tee.code} to be approved). Reason: Buyer confirmed the buttons by email`,
    );
  });
});

run("Fabric first and tech pack approval", () => {
  beforeEach(resetDb);

  it("books fabric once the fabric parts are locked and trims once the tech packs are approved", async () => {
    const env = await setup();
    await expectAppError(bookings.setFabricFirst(env.pm, env.batch.id, true), "FORBIDDEN");
    await bookings.setFabricFirst(env.owner, env.batch.id, true);

    const fabric = await bookings.createBooking(
      env.pm,
      fabricBooking(env, 56.895, { batchId: env.batch.id, expectedDate: "2030-11-15" }),
    );
    const blocked = await bookings.getBooking(env.owner, fabric.id);
    expect(blocked.checks).toContainEqual({
      text: `Fabric first: lock the fabric part of ${env.polo.code}, ${env.tee.code}`,
      state: "block",
    });
    await expectAppError(
      bookings.approveBooking(env.owner, fabric.id),
      "CONFLICT",
      /lock the fabric part/,
    );

    // Locking is the owner's; the Production Manager sees where it stands.
    const draft = await techPacks.getTechPack(env.pm, env.polo.id);
    expect(draft).toMatchObject({
      status: "DRAFT",
      fabricLocked: false,
      hasFabric: true,
      can: { lock: false, approve: false },
    });
    await expectAppError(techPacks.lockFabricPart(env.pm, env.polo.id), "FORBIDDEN");
    const locked = await techPacks.lockFabricPart(env.owner, env.polo.id);
    expect(locked).toMatchObject({ fabricLocked: true, changes: [], can: { lock: false } });
    await techPacks.lockFabricPart(env.owner, env.tee.id);
    expect(await bookings.approveBooking(env.owner, fabric.id)).toMatchObject({
      stage: "APPROVED",
    });

    // The trims wait for the whole tech pack.
    const buttons = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.trims.id,
      batchId: env.batch.id,
      expectedDate: "2030-11-20",
      lines: [{ materialId: env.buttons.id, quantity: 720, unitPrice: 2 }],
    });
    await expectAppError(
      bookings.approveBooking(env.owner, buttons.id),
      "CONFLICT",
      /trims wait for the tech pack/,
    );
    await techPacks.approveTechPack(env.owner, env.polo.id);
    await techPacks.approveTechPack(env.owner, env.tee.id);
    expect(await bookings.approveBooking(env.owner, buttons.id)).toMatchObject({
      stage: "APPROVED",
    });

    // The polo's fabric changes: in red on its tech pack and on the booking approved on it.
    await needs.setMaterialNeeds(env.pm, env.polo.id, {
      needs: [
        { materialId: env.jersey.id, perPiece: 0.3, wastagePercent: 5, split: "COLOUR" },
        { materialId: env.buttons.id, perPiece: 3, placement: "Button" },
      ],
    });
    const changed = await techPacks.getTechPack(env.owner, env.polo.id);
    expect(changed.status).toBe("APPROVED");
    expect(changed.changes).toEqual([
      {
        item: `${fabric.lines[0]!.material.code} Single Jersey 180 GSM: use`,
        was: "0.285 kg a piece + 5% wastage",
        now: "0.3 kg a piece + 5% wastage",
      },
    ]);
    expect(changed.can.approve).toBe(true);
    const onBooking = await bookings.getBooking(env.pm, fabric.id);
    // The fabric booked for the polo is at risk: in red on the booking, the list and the batch.
    const poloKg = fabric.lines[0]!.shares.filter((sh) => sh.project.id === env.polo.id).reduce(
      (t, sh) => t + Number(sh.quantity),
      0,
    );
    const atRisk = [{ unit: "KG", quantity: String(Number(poloKg.toFixed(3))) }];
    expect(onBooking.styleChanges).toEqual([
      {
        project: { id: env.polo.id, code: env.polo.code, name: "Brand A polo" },
        changes: changed.changes,
        atRisk,
      },
    ]);
    const listed = await bookings.listBookings(env.pm, { batchId: env.batch.id });
    expect(listed.items.map((b) => [b.id, b.fabricRisk])).toEqual(
      expect.arrayContaining([
        [fabric.id, { styles: [env.polo.code], atRisk }],
        [buttons.id, null],
      ]),
    );
    const panel = await bookings.getBatchBookings(env.pm, env.batch.id);
    expect(panel.fabricFirst).toMatchObject({ by: expect.any(String) });
    expect(panel.styles.map((s) => [s.code, s.status, s.changed])).toEqual([
      [env.polo.code, "APPROVED", 1],
      [env.tee.code, "APPROVED", 0],
    ]);
    expect(panel.attached.find((b) => b.id === fabric.id)?.fabricRisk).toEqual({
      styles: [env.polo.code],
      atRisk,
    });

    // Off again, an unapproved tech pack is only a warning.
    await bookings.setFabricFirst(env.owner, env.batch.id, false);
    expect((await bookings.getBatchBookings(env.pm, env.batch.id)).fabricFirst).toBeNull();
  });
});

run("The booking book", () => {
  beforeEach(resetDb);

  it("puts every booking of a batch in one book, with the pages of each part on its cover", async () => {
    const env = await setup();
    const fabric = await bookings.createBooking(
      env.pm,
      fabricBooking(env, 56.895, { batchId: env.batch.id, expectedDate: "2030-11-15" }),
    );
    await bookings.approveBooking(env.owner, fabric.id);
    await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.trims.id,
      batchId: env.batch.id,
      expectedDate: "2030-11-20",
      lines: [{ materialId: env.buttons.id, quantity: 720, unitPrice: 2 }],
    });

    const data = await bookingBookData(env.pm, env.batch.id);
    expect(data.styles.map((s) => [s.letter, s.code, s.colours.map((c) => c.code)])).toEqual([
      ["A", env.polo.code, ["A-01", "A-02"]],
      ["B", env.tee.code, []],
    ]);
    const first = bookingBookDocument(env.pm, data, "landscape", null);
    const counted = await renderWithParts(first);
    expect(counted.parts.map((p) => p.key)).toEqual([
      "cover",
      "order",
      `fabric:${env.mill.id}`,
      `trims:${env.trims.id}`,
      "summary",
      "sign-off",
      `swatch:${env.mill.id}`,
    ]);
    const doc = bookingBookDocument(env.pm, data, "landscape", counted.parts);
    const cover = doc.blocks.find((b) => b.kind === "table" && b.title === "Distribution list");
    if (cover?.kind !== "table") throw new Error("no distribution list");
    const page = (key: string) => {
      const p = counted.parts.find((x) => x.key === key)!;
      return p.first === p.last ? String(p.first) : `${p.first}–${p.last}`;
    };
    expect(cover.rows.map((r) => [r.cells[0], r.cells[1], r.cells[3], r.cells[5]])).toEqual([
      ["Merchandising", "Order summary", page("order"), "—"],
      ["Narayanganj Fabrics", "Fabric · FS-1", page(`fabric:${env.mill.id}`), "Approved"],
      ["Dhaka Trims House", "Trims · TS-1", page(`trims:${env.trims.id}`), "Draft"],
      [
        "Store and cutting",
        "Swatch list · Narayanganj Fabrics",
        page(`swatch:${env.mill.id}`),
        "Approved",
      ],
      ["Owner", "Summary & reconciliation", page("summary"), "—"],
      ["Owner", "Sign-off", page("sign-off"), "—"],
    ]);
    // The fabric part shares the jersey out by style and colour code; no prices anywhere.
    const fabricTable = doc.blocks.find(
      (b) => b.kind === "table" && b.title === "Fabric by style and colour",
    );
    expect(fabricTable?.kind === "table" && fabricTable.rows.map((r) => r.cells[4])).toEqual([
      "A-01 · Navy",
      "A-02 · White",
      "B · All colours",
      "",
    ]);
    const columns = doc.blocks.flatMap((b) =>
      b.kind === "table" ? b.columns.map((c) => c.label) : [],
    );
    expect(columns).not.toContain("Rate");
    expect(columns).not.toContain("Amount");

    const pdf = await bookingBookPdf(env.pm, env.batch.id, undefined, "portrait");
    expect(pdf.orientation).toBe("portrait");
    expect(pdf.fileName).toBe(`Extas - Booking book ${env.batch.code} Winter 2026.pdf`);
    const lines = pdfLines(pdf.bytes);
    for (const text of [
      "Booking book · Winter 2026",
      "DISTRIBUTION LIST",
      "FABRIC · FS-1",
      "TRIMS · TS-1",
      "Fabric booking · Narayanganj Fabrics",
      "Summary & reconciliation",
      "Supplier acknowledgement",
      "Fabric swatch list · Narayanganj Fabrics",
    ]) {
      expect(lines).toContain(text);
    }
    // The Full check's look finds nothing to flag: no figure cut short, every page numbered.
    expect(pdfProblems(pdf.bytes)).toEqual([]);
    expect(lines.join("\n")).toContain("(A-01, A-02 and so on)");
    // Anyone who sees bookings may print it; a Sales Executive may not.
    await expectAppError(bookingBookPdf(env.sales, env.batch.id), "FORBIDDEN");
  });
});
