import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A master batch's contracts: the fabric, accessories and factory (CM)
 * agreements to draft from its orders and factory, drafted with plain-rule
 * clauses (no AI key in tests), reviewed and changed, the factory's CM per
 * piece saved on its styles, signed and then kept as signed, printed, and
 * deleted while a draft. Who may read and change them follows the money rule.
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
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/result";
import { createSession } from "@/modules/auth/session.service";
import * as materials from "@/modules/materials/material.service";
import * as parties from "@/modules/parties/party.service";
import * as batchOrders from "@/modules/production/batch-orders.service";
import * as bookings from "@/modules/production/booking.service";
import * as batches from "@/modules/production/batch.service";
import * as contracts from "@/modules/production/contract.service";
import * as needs from "@/modules/production/material-need.service";
import * as projects from "@/modules/production/project.service";
import {
  createContractAction,
  deleteContractAction,
  getBatchContractsAction,
  getContractScreenAction,
  updateContractAction,
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
 * A batch at a knit factory with a polo (300 pcs) and a tee (200 pcs): jersey
 * and rib from a mill, buttons from a trims house; the batch's orders made with
 * the jersey priced and the rest priced at receive.
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
  const supplier = async (name: string) =>
    (await parties.createParty(owner, { kind: "SUPPLIER", name, phone: "01700000000" })).party;
  const mill = await supplier("Narayanganj Fabrics");
  const trims = await supplier("Dhaka Trims House");
  const knit = await supplier("Gazipur Knit Factory");
  const other = await supplier("Savar Sewing Unit");
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
    name: "Winter 2026",
    factoryId: knit.id,
    targetDate: "2026-12-20",
  });
  const polo = await projects.createProject(pm, {
    name: "Brand A polo",
    batchId: batch.id,
    targetDate: "2026-12-20",
    targetQuantity: 300,
  });
  const tee = await projects.createProject(pm, {
    name: "Brand B tee",
    batchId: batch.id,
    targetDate: "2026-12-10",
    targetQuantity: 200,
  });
  await needs.setMaterialNeeds(pm, polo.id, {
    needs: [
      { materialId: jersey.id, perPiece: 0.25, placement: "Main body" },
      { materialId: rib.id, perPiece: 0.03, placement: "Collar" },
      { materialId: buttons.id, perPiece: 3, placement: "Button" },
    ],
  });
  await needs.setMaterialNeeds(pm, tee.id, {
    needs: [{ materialId: jersey.id, perPiece: 0.2, placement: "Main body" }],
  });
  return {
    company,
    people,
    owner,
    pm,
    accounts,
    store,
    mill,
    trims,
    knit,
    other,
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

/** The fabric booked with a booking (as a batch's fabric must be), the buttons on a batch order. */
async function orderAll(env: Env) {
  const fabric = await bookings.createBooking(env.pm, {
    source: "SUPPLIER_PO",
    category: "KNITWEAR",
    supplierId: env.mill.id,
    batchId: env.batch.id,
    expectedDate: "2030-11-15",
    lines: [
      { materialId: env.jersey.id, quantity: 115, unitPrice: 520 },
      { materialId: env.rib.id, quantity: 9 },
    ],
  });
  const trims = await batchOrders.createBatchOrders(env.pm, env.batch.id, {
    orders: [
      {
        supplierId: env.trims.id,
        expectedDate: "2030-11-20",
        lines: [{ materialId: env.buttons.id, quantity: 900 }],
      },
    ],
  });
  return {
    batch: trims.batch,
    orders: [{ id: fabric.orderId, number: fabric.number }, ...trims.orders],
  };
}

run("Production renovation: batch contracts", () => {
  let env: Env;

  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  it("offers the contracts to draft and drafts each from the batch with plain-rule clauses", async () => {
    // Before ordering: the usual suppliers of the styles' materials and the batch's factory.
    let panel = await contracts.getBatchContracts(env.pm, env.batch.id);
    expect(panel.contracts).toEqual([]);
    expect(panel.toDraft.map((t) => `${t.kind} ${t.party.name}`)).toEqual([
      "FABRIC Narayanganj Fabrics",
      "ACCESSORIES Dhaka Trims House",
      "FACTORY_CM Gazipur Knit Factory",
    ]);

    // A fabric draft before ordering covers what the styles still need, price to agree.
    const early = await contracts.createContract(env.pm, env.batch.id, {
      kind: "FABRIC",
      partyId: env.mill.id,
    });
    expect(early.number).toMatch(/^AGR-\d{4}-00001$/);
    let screen = await contracts.getContractScreen(env.pm, early.id);
    expect(screen.goods?.ordered).toBe(false);
    expect(screen.goods?.rows.map((r) => [r.material.name, r.quantity, r.unitPrice])).toEqual([
      ["Single Jersey 180 GSM", "115", null],
      ["1x1 Rib 220 GSM", "9", null],
    ]);
    expect(screen.contract.clauses.map((c) => c.title)).toEqual([
      "What is bought",
      "Quality",
      "Delivery",
      "Weighing and Short/Extra",
      "Fabric faults",
      "Price and payment",
      "Disagreements",
    ]);
    expect(screen.contract.clauses[0]!.text).toContain("Narayanganj Fabrics");
    expect(screen.contract.clauses[0]!.text).toContain(env.batch.code);

    // Once ordered, it covers the mill's order lines: jersey priced, rib at receive.
    const made = await orderAll(env);
    screen = await contracts.getContractScreen(env.pm, early.id);
    expect(screen.goods?.ordered).toBe(true);
    expect(
      screen.goods?.rows.map((r) => [r.material.code, r.quantity, r.unitPrice, r.amount, r.order]),
    ).toEqual([
      [env.jersey.code, "115", "520.00", "59800.00", made.orders[0]!.number],
      [env.rib.code, "9", null, null, made.orders[0]!.number],
    ]);

    // One of each kind per party.
    await expectAppError(
      contracts.createContract(env.pm, env.batch.id, { kind: "FABRIC", partyId: env.mill.id }),
      "CONFLICT",
    );
    // A factory none of the styles is made at has nothing to agree.
    await expectAppError(
      contracts.createContract(env.pm, env.batch.id, {
        kind: "FACTORY_CM",
        partyId: env.other.id,
      }),
      "CONFLICT",
    );

    const acc = await contracts.createContract(env.pm, env.batch.id, {
      kind: "ACCESSORIES",
      partyId: env.trims.id,
    });
    const accScreen = await contracts.getContractScreen(env.pm, acc.id);
    expect(accScreen.goods?.rows.map((r) => [r.material.code, r.quantity, r.unitPrice])).toEqual([
      [env.buttons.code, "900", null],
    ]);
    expect(accScreen.contract.clauses.find((c) => c.title === "Price and payment")?.text).toMatch(
      /continuous ledger/,
    );

    const cm = await contracts.createContract(env.pm, env.batch.id, {
      kind: "FACTORY_CM",
      partyId: env.knit.id,
    });
    const cmScreen = await contracts.getContractScreen(env.pm, cm.id);
    expect(cmScreen.styles?.map((s) => [s.code, s.pieces, s.cmRate, s.dueOn])).toEqual([
      [env.polo.code, 300, null, "2026-12-20"],
      [env.tee.code, 200, null, "2026-12-10"],
    ]);
    expect(cmScreen.cm).toEqual({ total: "0.00", toAgree: 2 });
    expect(cmScreen.contract.clauses[0]!.text).toMatch(/agreed in writing before cutting/);

    panel = await contracts.getBatchContracts(env.pm, env.batch.id);
    expect(panel.toDraft).toEqual([]);
    expect(panel.contracts.map((c) => [c.kind, c.party.name, c.signedOn])).toEqual([
      ["FABRIC", "Narayanganj Fabrics", null],
      ["ACCESSORIES", "Dhaka Trims House", null],
      ["FACTORY_CM", "Gazipur Knit Factory", null],
    ]);
    const audit = await prisma.auditLog.findMany({
      where: { entityType: "ProductionContract" },
      select: { summary: true },
      orderBy: { createdAt: "asc" },
    });
    expect(audit[0]!.summary).toBe(
      `Drafted ${early.number}, the fabric supply agreement with Narayanganj Fabrics for ${env.batch.code}`,
    );
  });

  it("saves the reviewed clauses and CM, keeps a signed contract and prints it", async () => {
    const cm = await contracts.createContract(env.pm, env.batch.id, {
      kind: "FACTORY_CM",
      partyId: env.knit.id,
    });
    const screen = await contracts.getContractScreen(env.pm, cm.id);
    const clauses = [
      ...screen.contract.clauses.slice(0, 2),
      { title: "Samples", text: "Two pre-production samples per colour before cutting." },
    ];
    await contracts.updateContract(env.pm, cm.id, {
      clauses,
      cmRates: [
        { projectId: env.polo.id, cmRate: 45.5 },
        { projectId: env.tee.id, cmRate: 32 },
      ],
    });
    let after = await contracts.getContractScreen(env.pm, cm.id);
    expect(after.contract.clauses).toEqual(clauses);
    expect(after.styles?.map((s) => [s.cmRate, s.totalCm])).toEqual([
      ["45.50", "13650.00"],
      ["32.00", "6400.00"],
    ]);
    expect(after.cm).toEqual({ total: "20050.00", toAgree: 0 });
    const polo = await prisma.productionProject.findUniqueOrThrow({ where: { id: env.polo.id } });
    expect(polo.cmRate?.toFixed(2)).toBe("45.50");
    // Agreed per piece, as every agreement before the per-dozen choice: kept as it was.
    expect([polo.cmPer, polo.cmPerDozen]).toEqual(["PIECE", null]);
    expect(after.styles?.map((s) => [s.cmPer, s.cmAmount])).toEqual([
      ["PIECE", "45.50"],
      ["PIECE", "32.00"],
    ]);

    // A rate for a style the agreement does not cover, and a signed day after today.
    await expectAppError(
      contracts.updateContract(env.pm, cm.id, {
        clauses,
        cmRates: [{ projectId: "not-a-style", cmRate: 10 }],
      }),
      "VALIDATION",
    );
    await expectAppError(
      contracts.updateContract(env.pm, cm.id, { clauses, signedOn: "2999-01-01" }),
      "VALIDATION",
    );

    // Signed: the terms and CM stay until the signed day is cleared; the day itself can be saved again.
    await contracts.updateContract(env.pm, cm.id, { clauses, signedOn: "2026-10-01" });
    await expectAppError(
      contracts.updateContract(env.pm, cm.id, {
        clauses: clauses.slice(0, 2),
        signedOn: "2026-10-01",
      }),
      "CONFLICT",
    );
    await expectAppError(
      contracts.updateContract(env.pm, cm.id, {
        clauses,
        signedOn: "2026-10-01",
        cmRates: [{ projectId: env.tee.id, cmRate: 30 }],
      }),
      "CONFLICT",
    );
    await contracts.updateContract(env.pm, cm.id, {
      clauses,
      signedOn: "2026-10-01",
      cmRates: [{ projectId: env.tee.id, cmRate: 32 }],
    });
    await expectAppError(contracts.deleteContract(env.pm, cm.id), "CONFLICT");
    await expectAppError(batches.deleteBatch(env.pm, env.batch.id), "CONFLICT");

    // The printed contract: both sides, the styles with their CM and total, numbered clauses.
    after = await contracts.getContractScreen(env.pm, cm.id);
    expect(after.contract.signedOn).toBe("2026-10-01");
    const doc = contracts.contractDocument(env.pm, await contracts.getContract(env.pm, cm.id));
    expect(doc.title).toBe("Making (CM) agreement");
    expect(doc.meta).toContainEqual({ label: "Signed on", value: "1 Oct 2026" });
    expect(doc.parties[1]!.lines).toEqual(["Gazipur Knit Factory", "01700000000"]);
    const table = doc.blocks[0]!;
    expect(table.kind === "table" && table.columns.map((c) => c.label)).toEqual([
      "#",
      "Style",
      "Pieces",
      "CM a piece",
      "Total CM",
      "Deliver by",
    ]);
    expect(table.kind === "table" && table.rows.map((r) => r.cells.slice(1, 5))).toEqual([
      [`${env.polo.code} · Brand A polo`, "300", "45.50", "13,650.00"],
      [`${env.tee.code} · Brand B tee`, "200", "32.00", "6,400.00"],
      ["Total", "500", "", "20,050.00"],
    ]);
    expect(
      doc.blocks.filter((b) => b.kind === "text").map((b) => b.kind === "text" && b.title),
    ).toEqual(["1. What is made", "2. Materials", "3. Samples"]);
    expect(doc.signatures).toEqual(["For Extras", "For Gazipur Knit Factory", "Witness"]);
    const pdf = await contracts.contractPdf(env.pm, cm.id);
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.fileName).toContain("Making (CM) agreement");

    // Cleared: it is a draft again, can change and be deleted.
    await contracts.updateContract(env.pm, cm.id, { clauses: clauses.slice(0, 2), signedOn: null });
    await contracts.deleteContract(env.pm, cm.id);
    expect(await prisma.productionContract.count()).toBe(0);
  });

  it("takes the CM per piece or per dozen, keeps it as agreed and works the money per piece", async () => {
    const cm = await contracts.createContract(env.pm, env.batch.id, {
      kind: "FACTORY_CM",
      partyId: env.knit.id,
    });
    const { clauses } = (await contracts.getContractScreen(env.pm, cm.id)).contract;
    // Polo 120 a dozen (10 a piece); tee 100 a dozen (8.333... a piece).
    await contracts.updateContract(env.pm, cm.id, {
      clauses,
      cmRates: [
        { projectId: env.polo.id, cmRate: 120, cmPer: "DOZEN" },
        { projectId: env.tee.id, cmRate: 100, cmPer: "DOZEN" },
      ],
    });
    const polo = await prisma.productionProject.findUniqueOrThrow({ where: { id: env.polo.id } });
    expect([polo.cmPer, polo.cmPerDozen?.toFixed(2), polo.cmRate?.toFixed(2)]).toEqual([
      "DOZEN",
      "120.00",
      "10.00",
    ]);
    let screen = await contracts.getContractScreen(env.pm, cm.id);
    // 300 × 120 ÷ 12 = 3,000; 200 × 100 ÷ 12 = 1,666.67 (not 200 × 8.33 = 1,666.00).
    expect(screen.styles?.map((s) => [s.cmPer, s.cmAmount, s.cmRate, s.totalCm])).toEqual([
      ["DOZEN", "120.00", "10.00", "3000.00"],
      ["DOZEN", "100.00", "8.33", "1666.67"],
    ]);
    expect(screen.cm).toEqual({ total: "4666.67", toAgree: 0 });

    // Printed the way it was agreed.
    const doc = contracts.contractDocument(env.pm, await contracts.getContract(env.pm, cm.id));
    const table = doc.blocks[0]!;
    expect(table.kind === "table" && table.columns[3]!.label).toBe("CM");
    expect(table.kind === "table" && table.rows.map((r) => r.cells.slice(1, 5))).toEqual([
      [`${env.polo.code} · Brand A polo`, "300", "120.00 a dozen", "3,000.00"],
      [`${env.tee.code} · Brand B tee`, "200", "100.00 a dozen", "1,666.67"],
      ["Total", "500", "", "4,666.67"],
    ]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ProductionContract", action: "UPDATE" },
    });
    expect(audit.summary).toContain(`${env.polo.code} 120.00 a dozen`);

    // Signed: the same CM saved again is no change; the same figure per piece is one.
    await contracts.updateContract(env.pm, cm.id, { clauses, signedOn: "2026-10-01" });
    await contracts.updateContract(env.pm, cm.id, {
      clauses,
      signedOn: "2026-10-01",
      cmRates: [{ projectId: env.polo.id, cmRate: 120, cmPer: "DOZEN" }],
    });
    await expectAppError(
      contracts.updateContract(env.pm, cm.id, {
        clauses,
        signedOn: "2026-10-01",
        cmRates: [{ projectId: env.polo.id, cmRate: 120, cmPer: "PIECE" }],
      }),
      "CONFLICT",
    );

    // Back to per piece: the dozen price is cleared and it works as before.
    await contracts.updateContract(env.pm, cm.id, {
      clauses,
      signedOn: null,
      cmRates: [{ projectId: env.polo.id, cmRate: 11 }],
    });
    const back = await prisma.productionProject.findUniqueOrThrow({ where: { id: env.polo.id } });
    expect([back.cmPer, back.cmPerDozen, back.cmRate?.toFixed(2)]).toEqual([
      "PIECE",
      null,
      "11.00",
    ]);
    screen = await contracts.getContractScreen(env.pm, cm.id);
    expect(screen.styles?.map((s) => [s.cmPer, s.cmAmount, s.totalCm])).toEqual([
      ["PIECE", "11.00", "3300.00"],
      ["DOZEN", "100.00", "1666.67"],
    ]);
  });

  it("lets Accounts read contracts, only Production Managers change them, and no one else see them", async () => {
    await signInAs(env, "production");
    const made = data(
      await createContractAction(env.batch.id, { kind: "FACTORY_CM", partyId: env.knit.id }),
      "draft",
    );
    expect(data(await getBatchContractsAction(env.batch.id), "panel").can.draft).toBe(true);

    await signInAs(env, "accounts");
    const panel = data(await getBatchContractsAction(env.batch.id), "accounts panel");
    expect(panel.can.draft).toBe(false);
    expect(panel.contracts).toHaveLength(1);
    expect(data(await getContractScreenAction(made.id), "accounts screen").can.edit).toBe(false);
    const refused = await updateContractAction(made.id, {
      clauses: [{ title: "x", text: "y" }],
    });
    expect(!refused.ok && refused.error.code).toBe("FORBIDDEN");

    await signInAs(env, "store");
    const hidden = await getBatchContractsAction(env.batch.id);
    expect(!hidden.ok && hidden.error.code).toBe("FORBIDDEN");
    const screen = await getContractScreenAction(made.id);
    expect(!screen.ok && screen.error.code).toBe("FORBIDDEN");
    const gone = await deleteContractAction(made.id);
    expect(!gone.ok && gone.error.code).toBe("FORBIDDEN");
    await expectAppError(contracts.contractPdf(env.store, made.id), "FORBIDDEN");

    // Another company's contract is not found.
    const { company: elsewhere, roles } = await makeCompany("Elsewhere");
    const stranger = await makeUser("pm@elsewhere.test");
    await addToCompany(stranger.id, elsewhere.id, roles.PRODUCTION_MANAGER);
    const theirs = await contextFor(stranger.id, elsewhere.id);
    await expectAppError(contracts.getContractScreen(theirs, made.id), "NOT_FOUND");
    await expectAppError(contracts.getBatchContracts(theirs, env.batch.id), "NOT_FOUND");
  });
});
