import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { FRESH_START_RUNNING, noteFreshStartRunning } from "@/lib/fresh-start-guard";
import { prisma } from "@/lib/prisma";
import { TENANT_MODELS } from "@/lib/tenant-db";
import { rawBalance } from "@/modules/accounts/balances";
import { ensureAccountsSetup } from "@/modules/accounts/setup";
import * as bank from "@/modules/accounts/bank.service";
import * as loans from "@/modules/accounts/loans.service";
import * as moneyInOut from "@/modules/accounts/money-in-out.service";
import { asAi } from "@/modules/ai/account";
import { setPin } from "@/modules/ai/settings.service";
import { getBackupConfig } from "@/modules/backups/backup-core";
import { pruneBackups } from "@/modules/backups/drive-copies";
import * as files from "@/modules/files/file.service";
import { ensureHrSetup } from "@/modules/hr/setup";
import {
  type FreshStartBackup,
  getFreshStart,
  startFreshStart,
} from "@/modules/fresh-start/fresh-start.service";
import { erases, type FreshStartTicks, where } from "@/modules/fresh-start/plan";
import { wipeCompany } from "@/modules/fresh-start/wipe";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import { WEBHOOK_JOB } from "@/modules/ecommerce/webhooks";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PIN = "2468";
const OK_BACKUP: FreshStartBackup = async () => ({
  ok: true,
  runId: "stub-run",
  name: "2026-11-12_stub",
});
const READY = async () => null;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("photo")]);

/** A company with work in many parts of the ERP: money, stock, sales, loans, HR, files, retail. */
async function seed(name: string) {
  const { company, roles } = await makeCompany(name);
  const ownerUser = await makeUser(`owner@${company.slug}.test`, { isSuperAdmin: true });
  await addToCompany(ownerUser.id, company.id, roles.SUPER_ADMIN);
  const owner = await contextFor(ownerUser.id, company.id);
  // A Super Admin of the company who is not the platform owner.
  const adminUser = await makeUser(`admin@${company.slug}.test`);
  await addToCompany(adminUser.id, company.id, roles.SUPER_ADMIN);
  const admin = await contextFor(adminUser.id, company.id);
  await setPin(owner, { pin: PIN });
  await ensureAccountsSetup(company.id);
  await ensureHrSetup(company.id);
  const city = await bank.createBankAccount(owner, {
    bankName: "City Bank",
    accountName: name,
    accountNumber: `${name}-1234`,
  });

  await moneyInOut.addFund(owner, {
    ownerName: "Owner",
    accountId: city.ledgerAccountId,
    amount: 500000,
  });
  const t = localDay(new Date(), company.timezone);
  await loans.addLoan(owner, {
    lenderKind: "BANK",
    lenderName: "BRAC Bank",
    amount: 100000,
    takenOn: t,
    method: "BANK_TRANSFER",
    accountId: city.ledgerAccountId,
    installmentAmount: 10000,
    installmentsLeft: 12,
    nextDueDate: t,
    pin: PIN,
  });

  // Products, stock and a shop sale with its invoice.
  const size = await catalog.createSize(owner, { name: "M" });
  const navy = await catalog.createColor(owner, { name: "Navy", hexCode: "#1F2A44" });
  const tops = await catalog.createCategory(owner, { name: "Tops" });
  const polo = await styles.createStyle(owner, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(owner, polo.id, { colorIds: [navy.id], sizeIds: [size.id] });
  const variant = (await prisma.productVariant.findFirst({ where: { companyId: company.id } }))!;
  await stock.adjustStock(owner, {
    variantId: variant.id,
    quantity: 20,
    type: "OPENING",
    unitCost: 500,
  });
  const order = await orders.createOrder(owner, {
    channel: "POS",
    lines: [{ variantId: variant.id, quantity: 2, unitPrice: 1450 }],
    documents: { invoice: false },
  });
  await documents.issueInvoice(owner, order.id, {});

  // Buyers, suppliers and a retail store (with its own buyer).
  const buyer = await prisma.party.create({
    data: {
      companyId: company.id,
      code: "B-001",
      kind: "BUYER",
      name: "H&M",
      openingBalance: 5000,
    },
  });
  await prisma.party.create({
    data: { companyId: company.id, code: "S-001", kind: "SUPPLIER", name: "Mill" },
  });
  const storeParty = await prisma.party.create({
    data: { companyId: company.id, code: "R-001", kind: "BUYER", name: "Extas Retail" },
  });
  await prisma.retailStore.create({
    data: { companyId: company.id, name: "Extas Retail", partyId: storeParty.id, holdTold: true },
  });
  const material = await prisma.rawMaterial.create({
    data: {
      companyId: company.id,
      code: "FAB-1",
      name: "Jersey",
      kind: "FABRIC",
      unit: "KG",
      quantity: 10,
      stockValue: 5000,
      avgCost: 500,
      supplierId: buyer.id,
    },
  });

  // HR.
  const employee = await prisma.employee.create({
    data: {
      companyId: company.id,
      code: "E-001",
      name: "Rahim",
      joinDate: new Date("2026-01-01"),
      baseSalary: 20000,
    },
  });
  const leaveType = (await prisma.leaveType.findFirst({ where: { companyId: company.id } }))!;
  await prisma.leaveBalance.create({
    data: { employeeId: employee.id, leaveTypeId: leaveType.id, year: 2026, entitled: 10, used: 3 },
  });
  await prisma.salaryRevision.create({
    data: { employeeId: employee.id, effectiveFrom: new Date("2026-01-01"), amount: 20000 },
  });

  // Files: the logo (kept with the company), a style picture and a stray upload.
  const logo = await files.storeUpload(owner, { fileName: "logo.jpg", bytes: JPG });
  await prisma.company.update({ where: { id: company.id }, data: { logoFileId: logo.id } });
  const picture = await files.storeUpload(owner, { fileName: "polo.jpg", bytes: JPG });
  await prisma.style.update({
    where: { id: polo.id },
    data: { imageUrl: `/api/files/${picture.id}` },
  });
  const stray = await files.storeUpload(owner, { fileName: "receipt.jpg", bytes: JPG });

  // A note, a reminder in the inbox and an AI draft.
  await prisma.note.create({
    data: { companyId: company.id, userId: ownerUser.id, tab: "GENERAL", content: "Call Rahim" },
  });
  await prisma.notificationLog.create({
    data: {
      companyId: company.id,
      channel: "IN_APP",
      recipient: ownerUser.id,
      userId: ownerUser.id,
      body: "Hi",
    },
  });

  return {
    company,
    owner,
    admin,
    ownerUser,
    city,
    polo,
    variant,
    material,
    employee,
    logo,
    picture,
    stray,
  };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

/**
 * Every table's rows for one company (tables without companyId reach it through
 * their owner). PIN tries are left out: each PIN given is counted.
 */
async function countsFor(companyId: string) {
  const out: Record<string, number> = {};
  for (const model of Prisma.dmmf.datamodel.models) {
    if (model.name === "AiPinTry") continue;
    let sql: string;
    try {
      sql = TENANT_MODELS.has(model.name)
        ? `SELECT count(*)::int AS n FROM "${model.name}" WHERE "companyId" = $1`
        : `SELECT count(*)::int AS n FROM "${model.name}" WHERE ${where(model.name)}`;
    } catch {
      continue; // a platform table (users, sessions, backups)
    }
    const [row] = await prisma.$queryRawUnsafe<{ n: number }[]>(sql, companyId);
    out[model.name] = row!.n;
  }
  return out;
}

async function storedPath(fileId: string, root: string) {
  const asset = await prisma.fileAsset.findUnique({ where: { id: fileId } });
  return asset ? path.join(root, asset.storagePath) : null;
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

const NONE: FreshStartTicks = { keepParties: false, keepProducts: false, keepEmployees: false };

run("Fresh start", () => {
  let uploads: string;
  let a: Seeded;
  let b: Seeded;

  beforeEach(async () => {
    await resetDb();
    await prisma.freshStart.deleteMany();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-fresh-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    a = await seed("Alpha");
    b = await seed("Beta");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  const go = (ctx = a.owner, extra: Record<string, unknown> = {}, backup = OK_BACKUP) =>
    startFreshStart(ctx, { companyName: "Alpha", pin: PIN, ...extra }, undefined, {
      backup,
      readiness: READY,
      wait: true,
    });

  it("erases the company's business data only, keeps its settings, and leaves the other company untouched", async () => {
    const beforeA = await countsFor(a.company.id);
    const beforeB = await countsFor(b.company.id);
    expect(beforeA.JournalLine).toBeGreaterThan(0);
    expect(beforeA.StockMovement).toBeGreaterThan(0);
    expect(beforeA.Invoice).toBe(1);
    expect(beforeA.CapitalSource).toBeGreaterThan(0);
    const logoPath = (await storedPath(a.logo.id, uploads))!;
    const strayPath = (await storedPath(a.stray.id, uploads))!;
    const bStray = (await storedPath(b.stray.id, uploads))!;
    // The buyers that stay without the tick (Walk-in, the store's buyer) carry figures too.
    await prisma.party.updateMany({
      where: { companyId: a.company.id },
      data: { openingBalance: 7000, lastTransactionAt: new Date() },
    });

    const done = await go();
    expect(done).toMatchObject({ status: "DONE", backupName: "2026-11-12_stub" });

    const afterA = await countsFor(a.company.id);
    for (const [model, count] of Object.entries(afterA)) {
      if (model === "Party") {
        // Walk-in customers and the retail store's own buyer stay.
        expect(count, model).toBe(2);
      } else if (model === "FileAsset") {
        expect(count, model).toBe(1); // the logo
      } else if (model === "AuditLog") {
        expect(count, model).toBe(1); // "Fresh start"
      } else if (erases(model, NONE)) {
        expect(count, model).toBe(0);
      } else if (model === "FreshStart") {
        expect(count).toBe(1);
      } else {
        expect(count, model).toBe(beforeA[model]);
      }
    }
    // The other company: nothing changed.
    expect(await countsFor(b.company.id)).toEqual(beforeB);
    expect(await exists(bStray)).toBe(true);

    // Every balance is zero: no journal line is left.
    expect((await rawBalance(a.company.id, a.city.ledgerAccountId)).toFixed(2)).toBe("0.00");
    expect((await rawBalance(b.company.id, b.city.ledgerAccountId)).toFixed(2)).not.toBe("0.00");
    const accounts = await prisma.ledgerAccount.findMany({ where: { companyId: a.company.id } });
    expect(accounts.every((x) => x.openingBalance.isZero())).toBe(true);

    // Kept set-ups.
    expect(await prisma.bankAccount.count({ where: { companyId: a.company.id } })).toBe(1);
    const store = await prisma.retailStore.findFirstOrThrow({ where: { companyId: a.company.id } });
    expect(store.holdTold).toBe(false);
    expect(
      await prisma.party.count({ where: { companyId: a.company.id, systemRole: "WALK_IN" } }),
    ).toBe(1);
    // Notes and the planner are the business's work: erased.
    expect(await prisma.note.count({ where: { companyId: a.company.id } })).toBe(0);
    // The buyers that stay start from zero too.
    const left = await prisma.party.findMany({ where: { companyId: a.company.id } });
    expect(left).toHaveLength(2);
    for (const party of left) {
      expect(party.openingBalance.isZero(), party.name).toBe(true);
      expect(party.lastTransactionAt, party.name).toBeNull();
    }
    expect(
      (await prisma.company.findUniqueOrThrow({ where: { id: a.company.id } })).logoFileId,
    ).toBe(a.logo.id);

    // Files: the logo stays on disk, the stray upload is gone.
    expect(await exists(logoPath)).toBe(true);
    expect(await exists(strayPath)).toBe(false);

    // One activity-log row, written after the wipe.
    const log = await prisma.auditLog.findFirstOrThrow({ where: { companyId: a.company.id } });
    expect(log.entityType).toBe("FreshStart");
    expect(log.summary).toContain("Fresh start");
    expect(log.userId).toBe(a.ownerUser.id);

    // The card now says when and by whom, and cannot be used again.
    const card = await getFreshStart(a.owner, READY);
    expect(card.canUse).toBe(false);
    expect(card.record).toMatchObject({ status: "DONE", startedByName: a.ownerUser.name });
    await expectAppError(go(), "CONFLICT");
  });

  it("keeps buyers and suppliers, products and employees when ticked, with their figures back to zero", async () => {
    const beforeA = await countsFor(a.company.id);
    await go(a.owner, { keepParties: true, keepProducts: true, keepEmployees: true });
    const afterA = await countsFor(a.company.id);
    for (const model of [
      "Party",
      "Style",
      "ProductVariant",
      "RawMaterial",
      "Employee",
      "SalaryRevision",
      "LeaveBalance",
    ]) {
      expect(afterA[model], model).toBe(beforeA[model]);
    }
    expect(afterA.StockBalance).toBe(0);
    expect(afterA.SalesOrder).toBe(0);
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: a.variant.id } });
    expect(variant.avgCost.isZero()).toBe(true);
    const material = await prisma.rawMaterial.findUniqueOrThrow({ where: { id: a.material.id } });
    expect(material.quantity.isZero() && material.stockValue.isZero()).toBe(true);
    expect(material.supplierId).not.toBeNull();
    const buyer = await prisma.party.findFirstOrThrow({
      where: { companyId: a.company.id, code: "B-001" },
    });
    expect(buyer.openingBalance.isZero()).toBe(true);
    const balance = await prisma.leaveBalance.findFirstOrThrow({
      where: { employeeId: a.employee.id },
    });
    expect(balance.used.isZero()).toBe(true);
    // The style's picture is still in use, so its file stays.
    expect(await prisma.fileAsset.findUnique({ where: { id: a.picture.id } })).not.toBeNull();
    expect(await prisma.fileAsset.findUnique({ where: { id: a.stray.id } })).toBeNull();
  });

  it("keeps products but not suppliers: the material loses its erased supplier", async () => {
    await go(a.owner, { keepProducts: true });
    const material = await prisma.rawMaterial.findUniqueOrThrow({ where: { id: a.material.id } });
    expect(material.supplierId).toBeNull();
    expect(await prisma.employee.count({ where: { companyId: a.company.id } })).toBe(0);
  });

  it("refuses a wrong PIN, a wrong company name, anyone but the owner, and the AI", async () => {
    const before = await countsFor(a.company.id);
    await expectAppError(go(a.owner, { pin: "1111" }), "VALIDATION");
    await expectAppError(go(a.owner, { companyName: "alpha" }), "VALIDATION");
    await expectAppError(go(a.admin), "FORBIDDEN");
    await expectAppError(go(await asAi(a.owner)), "FORBIDDEN");
    expect((await getFreshStart(a.admin, READY)).visible).toBe(false);
    expect(await prisma.freshStart.count()).toBe(0);
    const after = await countsFor(a.company.id);
    expect(after).toEqual(before);
  });

  it("erases nothing when the backup fails or Drive is not ready, and may be tried again", async () => {
    const before = await countsFor(a.company.id);
    const failed = await go(a.owner, {}, async () => ({
      ok: false,
      reason:
        "the backup was made but is not checked in Google Drive (Google Drive is not connected)",
    }));
    expect(failed).toMatchObject({ status: "FAILED" });
    expect(failed!.error).toContain("Nothing was erased");
    expect(await countsFor(a.company.id)).toEqual({ ...before, FreshStart: 1 });

    // The real readiness check: no Google Drive here.
    await expectAppError(
      startFreshStart(a.owner, { companyName: "Alpha", pin: PIN }, undefined, {
        backup: OK_BACKUP,
        wait: true,
      }),
      "VALIDATION",
    );
    expect(await countsFor(a.company.id)).toEqual({ ...before, FreshStart: 1 });

    // Tried again once the backup works.
    expect(await go()).toMatchObject({ status: "DONE" });
  });

  it("refuses a second click while the first one runs", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const slowBackup: FreshStartBackup = async () => {
      await waiting;
      return { ok: true, runId: "stub-run", name: "slow" };
    };
    const first = await startFreshStart(a.owner, { companyName: "Alpha", pin: PIN }, undefined, {
      backup: slowBackup,
      readiness: READY,
    });
    expect(first).toMatchObject({ status: "BACKING_UP" });
    await expectAppError(go(), "CONFLICT");
    // Two clicks at the very same moment: one claim wins.
    release();
    await vi.waitFor(
      async () => expect((await prisma.freshStart.findFirstOrThrow()).status).toBe("DONE"),
      { timeout: 20_000, interval: 100 },
    );
  });

  it("two clicks at the same moment start one fresh start", async () => {
    const results = await Promise.allSettled([go(), go()]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((refused.reason as AppError).code).toBe("CONFLICT");
  });

  it("runs on the real database for every choice of ticks (checked, then undone)", async () => {
    const before = await countsFor(b.company.id);
    for (const keepParties of [false, true]) {
      for (const keepProducts of [false, true]) {
        for (const keepEmployees of [false, true]) {
          const ticks = { keepParties, keepProducts, keepEmployees };
          const undone = await prisma
            .$transaction(async (tx) => {
              const result = await wipeCompany(tx, b.company.id, ticks);
              expect(result.erased.JournalLine).toBeGreaterThan(0);
              throw new Error("undo");
            })
            .catch((e: unknown) => (e as Error).message);
          expect(undone).toBe("undo");
        }
      }
    }
    expect(await countsFor(b.company.id)).toEqual(before);
  });

  it("closes the company to every write while it runs; other companies go on (review 2026-11-12)", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const slowBackup: FreshStartBackup = async () => {
      await waiting;
      return { ok: true, runId: "stub-run", name: "slow" };
    };
    await startFreshStart(a.owner, { companyName: "Alpha", pin: PIN }, undefined, {
      backup: slowBackup,
      readiness: READY,
    });
    const note = (s: Seeded, content: string) => ({
      companyId: s.company.id,
      userId: s.ownerUser.id,
      tab: "GENERAL" as const,
      content,
    });
    // By its company, by the id of its row, and in raw SQL from the company's session.
    const late = await expectAppError(prisma.note.create({ data: note(a, "late") }), "CONFLICT");
    expect(late.message).toContain(FRESH_START_RUNNING);
    await expectAppError(
      prisma.productVariant.update({ where: { id: a.variant.id }, data: { barcode: "X-1" } }),
      "CONFLICT",
    );
    await expectAppError(
      a.owner.db.style.update({ where: { id: a.polo.id }, data: { name: "Renamed" } }),
      "CONFLICT",
    );
    // Reads go on, and so does every other company.
    expect(await prisma.style.count({ where: { companyId: a.company.id } })).toBe(1);
    await prisma.note.create({ data: note(b, "fine") });
    await b.owner.db.style.update({ where: { id: b.polo.id }, data: { name: "Renamed" } });
    // A second start is refused as running (before the PIN is even counted).
    await expectAppError(go(), "CONFLICT");

    release();
    await vi.waitFor(
      async () =>
        expect(
          (await prisma.freshStart.findFirstOrThrow({ where: { companyId: a.company.id } })).status,
        ).toBe("DONE"),
      { timeout: 20_000, interval: 100 },
    );
    await vi.waitFor(async () => {
      await prisma.note.create({ data: note(a, "after") });
    });
    expect(await prisma.note.count({ where: { companyId: a.company.id } })).toBe(1);
  });

  it("locks its tables, so a write saved meanwhile by another path waits until it is over", async () => {
    let wiped!: () => void;
    const locked = new Promise<void>((resolve) => (wiped = resolve));
    let over = false;
    const wipe = prisma
      .$transaction(
        async (tx) => {
          await wipeCompany(tx, b.company.id, NONE);
          wiped();
          await new Promise((resolve) => setTimeout(resolve, 500));
          over = true;
          throw new Error("undo");
        },
        { timeout: 60_000 },
      )
      .catch((e: unknown) => (e as Error).message);
    await locked;
    // A clock's raw SQL (no session, no company the guard could see).
    const sawOver = prisma
      .$executeRawUnsafe(`UPDATE "Note" SET "content" = 'x' WHERE "companyId" = $1`, b.company.id)
      .then(() => over);
    expect(await wipe).toBe("undo");
    expect(await sawOver).toBe(true);
  });

  it("settles a run no job holds (a stopped server, a restored backup) and holds nothing back", async () => {
    await prisma.freshStart.create({
      data: {
        companyId: a.company.id,
        status: "BACKING_UP",
        claimId: "a-server-that-stopped",
        startedByName: "Owner",
      },
    });
    // Writes go on: no job of this server runs it.
    await prisma.style.update({ where: { id: a.polo.id }, data: { name: "Still open" } });
    const card = await getFreshStart(a.owner, READY);
    expect(card.record).toMatchObject({
      status: "FAILED",
      error: "Interrupted: the server stopped. Nothing was erased.",
    });
    expect(card.canUse).toBe(true);
    expect(await go()).toMatchObject({ status: "DONE" });
  });

  it("a stale job never erases with newer ticks, nor moves a finished fresh start", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const oldRun = await prisma.backupRun.create({
      data: {
        trigger: "MANUAL",
        status: "SUCCEEDED",
        keepForever: true,
        label: "Before fresh start",
      },
    });
    const old = startFreshStart(a.owner, { companyName: "Alpha", pin: PIN }, undefined, {
      backup: async () => {
        await waiting;
        return { ok: true, runId: oldRun.id, name: "old" };
      },
      readiness: READY,
      wait: true,
    });
    await vi.waitFor(async () =>
      expect(await prisma.freshStart.count({ where: { companyId: a.company.id } })).toBe(1),
    );
    // The server "restarts" while the old job waits: the card settles its run.
    noteFreshStartRunning(a.company.id, null);
    expect((await getFreshStart(a.owner, READY)).record).toMatchObject({ status: "FAILED" });
    // A new run, keeping the buyers, finishes.
    expect(await go(a.owner, { keepParties: true })).toMatchObject({ status: "DONE" });
    const parties = await prisma.party.count({ where: { companyId: a.company.id } });
    expect(parties).toBeGreaterThan(2);

    // The old job wakes up: it erases nothing and leaves DONE as it was.
    release();
    await old;
    const row = await prisma.freshStart.findFirstOrThrow({ where: { companyId: a.company.id } });
    expect(row).toMatchObject({
      status: "DONE",
      keepParties: true,
      backupRunId: "stub-run",
      error: null,
    });
    expect(await prisma.party.count({ where: { companyId: a.company.id } })).toBe(parties);
    // Its own backup is an ordinary one again.
    expect(await prisma.backupRun.findUniqueOrThrow({ where: { id: oldRun.id } })).toMatchObject({
      keepForever: false,
      label: null,
    });
  });

  it("tells each connected shop its stock is zero and the erased SKUs are gone", async () => {
    const warehouse = {
      id: (await prisma.stockBalance.findFirstOrThrow({ where: { companyId: a.company.id } }))
        .warehouseId,
    };
    const shopOf = (s: Seeded, w: string | null) =>
      prisma.salesChannelIntegration.create({
        data: {
          companyId: s.company.id,
          name: "Website",
          platform: "CUSTOM_WEBSITE",
          warehouseId: w,
          isActive: true,
          apiKeyRef: `sha256:${s.company.id}`,
          webhookSecretRef: "sealed-secret",
          webhookUrl: "https://shop.example.com/hooks",
        },
      });
    const shop = await shopOf(a, warehouse.id);
    const other = await shopOf(b, null);
    const stockRows = await prisma.stockBalance.count({
      where: { companyId: a.company.id, warehouseId: warehouse.id, grade: "A_GRADE" },
    });
    expect(stockRows).toBeGreaterThan(0);

    await go();
    const events = await prisma.webhookEvent.findMany({ where: { integrationId: shop.id } });
    const stock = events.filter((e) => e.eventType === "stock.changed");
    expect(stock).toHaveLength(stockRows);
    for (const e of stock) {
      expect((e.payload as { data: Record<string, unknown> }).data).toMatchObject({
        onHand: 0,
        reserved: 0,
        available: 0,
      });
    }
    const variants = events.filter((e) => e.eventType === "variant.changed");
    expect(variants.map((e) => e.externalId)).toEqual([a.variant.sku]);
    expect((variants[0]!.payload as { data: Record<string, unknown> }).data).toMatchObject({
      sku: a.variant.sku,
      active: false,
      isNew: false,
    });
    // Each through the usual sender, and only for this company's shop.
    const jobs = await prisma.backgroundJob.findMany({ where: { kind: WEBHOOK_JOB } });
    expect(jobs.map((j) => (j.payload as { eventId: string }).eventId).sort()).toEqual(
      events.map((e) => e.id).sort(),
    );
    expect(await prisma.webhookEvent.count({ where: { integrationId: other.id } })).toBe(0);
  });

  it("sends nothing to the shops with ECOMMERCE_WEBHOOKS=off", async () => {
    vi.stubEnv("ECOMMERCE_WEBHOOKS", "off");
    const warehouse = {
      id: (await prisma.stockBalance.findFirstOrThrow({ where: { companyId: a.company.id } }))
        .warehouseId,
    };
    await prisma.salesChannelIntegration.create({
      data: {
        companyId: a.company.id,
        name: "Website",
        platform: "CUSTOM_WEBSITE",
        warehouseId: warehouse.id,
        isActive: true,
        apiKeyRef: "sha256:off",
        webhookSecretRef: "sealed-secret",
        webhookUrl: "https://shop.example.com/hooks",
      },
    });
    await go();
    expect(await prisma.webhookEvent.count({ where: { companyId: a.company.id } })).toBe(0);
  });

  it("never removes a backup kept for ever under the keeping rules", async () => {
    const config = await getBackupConfig();
    const old = new Date(Date.now() - 10 * 86_400_000);
    const kept = await prisma.backupRun.create({
      data: {
        trigger: "MANUAL",
        status: "SUCCEEDED",
        startedAt: old,
        keepForever: true,
        label: "Before fresh start",
      },
    });
    for (let i = 0; i < config.serverKeep + 2; i += 1) {
      await prisma.backupRun.create({
        data: {
          trigger: "SCHEDULED",
          status: "SUCCEEDED",
          startedAt: new Date(Date.now() - i * 3_600_000),
        },
      });
    }
    await pruneBackups(config);
    const after = await prisma.backupRun.findUniqueOrThrow({ where: { id: kept.id } });
    expect(after.filesDeletedAt).toBeNull();
    expect(
      await prisma.backupRun.count({ where: { filesDeletedAt: null, keepForever: false } }),
    ).toBe(config.serverKeep);
  });
});
