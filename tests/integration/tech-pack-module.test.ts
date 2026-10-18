import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * Tech Pack as its own module (v6.4): a tech pack started from a buyer's brief
 * and references before any order or production project exists, the list of
 * every tech pack with its search and filters, linking one to a style in
 * production or a catalogue style when the order comes (and the bookings of
 * that style then following its approval exactly as before), the tech packs
 * made before v6.4 filled in by the migration, the old project addresses and
 * PDFs still working, who sees the Tech Pack menu, and each company's tech
 * packs kept to itself.
 */
const signedIn = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/auth/context", async (original) => {
  const real = await original<typeof import("@/modules/auth/context")>();
  const { AppError } = await import("@/lib/errors");
  const ctx = () => {
    if (!signedIn.ctx) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
    return signedIn.ctx as import("@/modules/auth/context").CompanyContext;
  };
  const holds = (keys: string[]) => keys.some((k) => ctx().permissions.has(k as never));
  return {
    ...real,
    requireCompany: async () => ctx(),
    requirePermission: async (...keys: string[]) => {
      if (keys.some((k) => !ctx().permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx();
    },
    requireAnyPermission: async (...keys: string[]) => {
      if (!holds(keys)) throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      return ctx();
    },
  };
});

import { GET as projectPdfRoute } from "@/app/api/production/projects/[projectId]/tech-pack/route";
import { GET as projectMeasurementsRoute } from "@/app/api/production/projects/[projectId]/tech-pack/measurements/route";
import { GET as techPackPdfRoute } from "@/app/api/tech-packs/[techPackId]/pdf/route";
import { GET as techPackMeasurementsRoute } from "@/app/api/tech-packs/[techPackId]/measurements/route";
import { phoneTabs, topBarFold, visibleNavItems } from "@/components/shell/nav-items";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { standInForClaude } from "@/modules/ai/claude";
import { setBudget } from "@/modules/ai/costs.service";
import { setAiSwitch, setApiKey } from "@/modules/ai/settings.service";
import { getFileForDownload } from "@/modules/files/file.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as materials from "@/modules/materials/material.service";
import * as parties from "@/modules/parties/party.service";
import * as batches from "@/modules/production/batch.service";
import * as bookings from "@/modules/production/booking.service";
import * as needs from "@/modules/production/material-need.service";
import * as projects from "@/modules/production/project.service";
import * as ai from "@/modules/production/tech-pack-ai.service";
import * as approval from "@/modules/production/tech-pack-approval.service";
import { measurementsFile } from "@/modules/production/tech-pack-export";
import * as files from "@/modules/production/tech-pack-files.service";
import * as register from "@/modules/production/tech-pack-register.service";
import { getTechPackScreen } from "@/modules/production/tech-pack-screen.service";
import * as spec from "@/modules/production/tech-pack-spec.service";
import { techPackPdf, techPackPdfOf } from "@/modules/production/tech-pack.service";
import { recordHref } from "@/modules/reminders/links";
import { DEFAULT_ROLE_PERMISSIONS } from "@/modules/rbac/permissions";
import { createRole } from "@/modules/rbac/role.service";
import {
  approveTechPackOfAction,
  createTechPackAction,
  getProjectTechPackAction,
  getTechPackScreenAction,
  listTechPacksAction,
  makeChartAction,
  saveToTechPackAction,
  updateTechPackDetailsAction,
} from "@/server/actions/tech-pack.actions";

import { claudeMessage } from "../fixtures/claude";
import { png } from "../fixtures/images";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const KEY = "sk-ant-api03-test0123456789abcdWXYZ";
const YEAR = new Date().getFullYear();

async function expectAppError(promise: Promise<unknown>, code: string, message?: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (message) expect((error as AppError).message).toMatch(message);
  return error as AppError;
}

const photo = (name = "brief.png") => ({ fileName: name, bytes: png({ width: 4, height: 4 }) });

const BRIEF =
  "Nordic Wear AB: men's piqué polo, 220 GSM, 2-button placket, flat-knit collar with one tipping, side vents, S to 2XL.";

const CHART = {
  garmentKind: "POLO",
  unit: "INCH",
  sizes: "S, M, L",
  baseSize: "S",
  chest: 40,
  chestBasis: "AUTO",
  chestGrade: 2,
  length: 28,
};

/**
 * Extas with one person per role and a company of its own for an outsider; two
 * buyers, two catalogue styles, a batch with a polo (jersey and buttons per
 * piece) and a tee, a closed project, and a mill and a trims house.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const other = await makeCompany("Extas Uttara");
  const join = async (roleId: string, who: string, companyId = company.id) => {
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, companyId, roleId);
    return contextFor(user.id, companyId);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner");
  const pm = await join(roles.PRODUCTION_MANAGER, "pm");
  const store = await join(roles.WAREHOUSE_TEAM, "store");
  const sales = await join(roles.SALES_EXECUTIVE, "sales");
  const outsider = await join(other.roles.SUPER_ADMIN, "outsider", other.company.id);

  const sizes = [];
  for (const name of ["S", "M", "L"]) sizes.push(await catalog.createSize(owner, { name }));
  const navy = await catalog.createColor(owner, { name: "Navy", hexCode: "#1f2a44" });
  const polos = await catalog.createCategory(owner, { name: "Polo shirts" });
  const style = await styles.createStyle(owner, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: polos.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  const teeStyle = await styles.createStyle(owner, {
    code: "EX-TS-001",
    name: "Crew Tee",
    categoryId: polos.id,
    retailPrice: 650,
    wholesalePrice: 400,
  });
  await matrix.generateMatrix(owner, style.id, {
    colorIds: [navy.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({ where: { styleId: style.id } });
  const buyer = async (name: string, ctx = owner) =>
    (await parties.createParty(ctx, { kind: "BUYER", name })).party;
  const nordic = await buyer("Nordic Wear AB");
  const hansa = await buyer("Hansa Mode GmbH");
  const theirBuyer = await buyer("Uttara Buyer", outsider);
  const supplier = async (name: string) =>
    (await parties.createParty(owner, { kind: "SUPPLIER", name })).party;
  const mill = await supplier("Narayanganj Fabrics");
  const trims = await supplier("Dhaka Trims House");
  const knit = await supplier("Gazipur Knit Factory");
  const jersey = await materials.createMaterial(pm, {
    name: "Pique 220 GSM",
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
    buyerId: nordic.id,
    targetDate: "2026-12-20",
    targets: variants.map((v) => ({ variantId: v.id, quantity: 100 })),
  });
  await needs.setMaterialNeeds(pm, polo.id, {
    needs: [
      { materialId: jersey.id, perPiece: 0.28, wastagePercent: 5, split: "COLOUR" },
      { materialId: buttons.id, perPiece: 3, placement: "Button" },
    ],
  });
  const tee = await projects.createProject(pm, {
    name: "Brand B tee",
    targetDate: "2026-12-20",
    targetQuantity: 50,
  });
  const closed = await projects.createProject(pm, {
    name: "Old tee",
    targetDate: "2026-12-20",
    targetQuantity: 10,
  });
  await projects.cancelProject(owner, closed.id, { reason: "Buyer dropped it" });
  const theirs = await projects.createProject(outsider, {
    name: "Their polo",
    targetDate: "2026-12-20",
    targetQuantity: 10,
  });
  return {
    company,
    owner,
    pm,
    store,
    sales,
    outsider,
    style,
    teeStyle,
    nordic,
    hansa,
    theirBuyer,
    trims,
    buttons,
    batch,
    polo,
    tee,
    closed,
    theirs,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** A tech pack from the buyer's brief, with one reference photo. */
const fromBrief = (env: Env, more: Record<string, unknown> = {}) =>
  register.createTechPack(
    env.pm,
    {
      title: "Nordic polo SS27",
      buyerId: env.nordic.id,
      season: "SS27",
      brief: BRIEF,
      ...more,
    },
    [photo()],
  );

const DRAFT = {
  item: "Men's piqué polo, 2-button placket, flat-knit collar",
  garment: "POLO",
  lines: [
    { section: "Fabric", text: "Piqué 220 GSM", signal: "green", why: "Buyer's brief" },
    { section: "Trims & Labels", text: "Button size not given", signal: "red" },
  ],
  questions: ["Which colours, and how many pieces of each?"],
  rules: [],
};

async function switchOn(env: Env) {
  await setAiSwitch(env.owner, true);
  await setApiKey(env.owner, { key: KEY });
  await setBudget(env.owner, {
    monthly: "5000",
    daily: "",
    perOrder: "",
    perStaffMonthly: "",
    perAgentMonthly: "",
    askAbove: "",
    alertPercent: "80",
    atLimit: "STOP",
    usdRate: "122",
  });
}

function standIn(inputs: Record<string, unknown>) {
  const sent: Array<{ tool: string; text: string }> = [];
  standInForClaude(async ({ body }) => {
    const tool = (body.tools?.[0] as Anthropic.Tool | undefined)?.name ?? "";
    sent.push({ tool, text: JSON.stringify(body.messages) });
    return claudeMessage(
      [
        {
          type: "tool_use",
          id: `toolu_${sent.length}`,
          name: tool,
          input: inputs[tool] ?? {},
        } as Anthropic.ToolUseBlock,
      ],
      body.model,
    );
  });
  return sent;
}

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

run("Tech Pack as its own module", () => {
  let env: Env;
  beforeEach(async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await resetDb();
    env = await setup();
  });
  afterEach(() => {
    signedIn.ctx = null;
    standInForClaude(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("starts a tech pack from the buyer's brief and references, with no order or project", async () => {
    const made = await fromBrief(env, { link: "https://www.etsy.com/listing/42" });
    expect(made.number).toBe(`TP-${YEAR}-00001`);
    const row = await prisma.techPack.findUniqueOrThrow({
      where: { id: made.id },
      include: { references: { include: { file: true } } },
    });
    expect(row).toMatchObject({
      companyId: env.company.id,
      projectId: null,
      styleId: null,
      buyerId: env.nordic.id,
      title: "Nordic polo SS27",
      season: "SS27",
      brief: BRIEF,
      status: "DRAFT",
      createdById: env.pm.user.id,
    });
    // The photo and the link are its first saved references.
    expect(row.references.map((r) => [Boolean(r.file), r.link])).toEqual(
      expect.arrayContaining([
        [true, null],
        [false, "https://www.etsy.com/listing/42"],
      ]),
    );
    // Logged as made, under the tech pack.
    const log = await prisma.auditLog.findMany({
      where: { entityType: "TechPack", entityId: made.id },
      select: { action: true, summary: true, byAi: true },
    });
    expect(log).toContainEqual({
      action: "CREATE",
      summary: `Started tech pack ${made.number} "Nordic polo SS27" from the buyer's brief`,
      byAi: false,
    });

    // The next one takes the next number; another company starts at 1.
    expect((await fromBrief(env, { title: "Second" })).number).toBe(`TP-${YEAR}-00002`);
    const theirs = await register.createTechPack(env.outsider, { title: "Their polo" }, []);
    expect(theirs.number).toBe(`TP-${YEAR}-00001`);

    // A title is needed; the buyer and style must be this company's.
    await expect(register.createTechPack(env.pm, { title: " " }, [])).rejects.toThrow(ZodError);
    await expectAppError(
      register.createTechPack(env.pm, { title: "X", buyerId: env.theirBuyer.id }, []),
      "NOT_FOUND",
    );
    await expectAppError(
      register.createTechPack(env.pm, { title: "X", buyerId: env.trims.id }, []),
      "NOT_FOUND",
      /buyer/,
    );
    await expectAppError(
      register.createTechPack(env.outsider, { title: "X", styleId: env.style.id }, []),
      "NOT_FOUND",
    );
    // Only people who change tech packs start one, in the action and in the service.
    await expectAppError(register.createTechPack(env.store, { title: "X" }, []), "FORBIDDEN");
    signedIn.ctx = env.store;
    const form = new FormData();
    form.set("title", "From the store");
    const refused = await createTechPackAction(form);
    expect(refused.ok).toBe(false);
    signedIn.ctx = env.pm;
    form.append("files", new File([new Uint8Array(photo().bytes)], "a.png", { type: "image/png" }));
    const viaAction = await createTechPackAction(form);
    expect(viaAction.ok).toBe(true);
    if (viaAction.ok) {
      expect(viaAction.data.number).toBe(`TP-${YEAR}-00003`);
      expect(
        await prisma.techPackReference.count({ where: { techPackId: viaAction.data.id } }),
      ).toBe(1);
    }
  });

  it("keeps everything the tech pack page has for a tech pack without a project", async () => {
    const { id } = await fromBrief(env);
    // The page: its own details, nothing linked yet, nothing to approve without a style in production.
    let screen = await getTechPackScreen(env.store, id);
    expect(screen.techPack).toMatchObject({
      id,
      number: `TP-${YEAR}-00001`,
      title: "Nordic polo SS27",
      season: "SS27",
      brief: BRIEF,
      buyer: { id: env.nordic.id, name: "Nordic Wear AB" },
      style: null,
      project: null,
    });
    expect(screen.approval).toMatchObject({ needsProject: true, status: "DRAFT" });
    expect(screen.approval.can).toEqual({ lock: false, approve: false });
    expect(screen.can).toMatchObject({ edit: false, link: false });
    expect(screen.references).toHaveLength(1);

    // The chart, instructions, references, logos and colours all work on it.
    await spec.makeChart(env.pm, id, CHART);
    await spec.setMeasurement(env.pm, id, { code: "SHOULDER", size: "M", value: 17.75 });
    await spec.setInstructions(env.pm, id, { Packing: "Single polybag" });
    await files.addReference(env.pm, id, { link: "https://example.com/polo", note: "Collar" });
    const { id: logoId } = await files.saveLogo(env.pm, id, null, {
      name: "Chest logo",
      widthMm: "27",
    });
    const { id: colourId } = await files.saveColour(env.pm, id, null, {
      name: "Navy",
      code: "19-4052 TCX",
    });
    await files.addLabDips(env.pm, id, colourId, {
      round: 1,
      options: [{ letter: "A", deltaE: "0.7" }],
    });
    screen = await getTechPackScreen(env.pm, id);
    expect(screen.chart.rows.length).toBeGreaterThan(5);
    expect(screen.instructions).toEqual({ Packing: "Single polybag" });
    expect(screen.references).toHaveLength(2);
    expect(screen.logos.map((l) => l.id)).toEqual([logoId]);
    expect(screen.colours[0]!.options[0]!.check.verdict).toBe("PASS");
    expect(screen.gaps).toEqual(["Logo without the owner's tick: Chest logo"]);
    expect(screen.can).toMatchObject({ edit: true, link: true });
    // The reference photo opens for everyone who sees production.
    const photoId = screen.references.find((r) => r.file)!.file!.id;
    await expect(getFileForDownload(env.store, photoId)).resolves.toBeTruthy();
    await expectAppError(getFileForDownload(env.sales, photoId), "FORBIDDEN");

    // The measurement sheet and the tech pack PDF carry its number and the brief.
    const sheet = await measurementsFile(env.store, id, "xlsx");
    expect(sheet.fileName).toMatch(new RegExp(`Measurements TP-${YEAR}-00001`));
    const pdf = await techPackPdfOf(env.store, id);
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.fileName).toMatch(new RegExp(`Tech pack TP-${YEAR}-00001`));
    signedIn.ctx = env.store;
    const viaRoute = await techPackPdfRoute(
      new Request("https://erp.example.test/api/tech-packs/x/pdf"),
      params({ techPackId: id }),
    );
    expect(viaRoute.status).toBe(200);
    expect(viaRoute.headers.get("content-type")).toMatch(/pdf/);
    const sheetRoute = await techPackMeasurementsRoute(
      new Request("https://erp.example.test/api/tech-packs/x/measurements?format=pdf"),
      params({ techPackId: id }),
    );
    expect(sheetRoute.status).toBe(200);

    // Approval needs a style in production: its fabric part comes from there.
    await expectAppError(
      approval.approveTechPackOf(env.owner, id),
      "CONFLICT",
      /Link it to a production project/,
    );
    await expectAppError(
      approval.lockFabricPartOf(env.owner, id),
      "CONFLICT",
      /Link it to a production project/,
    );
    await expectAppError(approval.approveTechPackOf(env.pm, id), "FORBIDDEN");
  });

  it("drafts with AI from the buyer's brief and references when there is no order", async () => {
    const { id } = await fromBrief(env);
    await switchOn(env);
    const sent = standIn({ record_tech_pack_draft: DRAFT });
    await ai.draftTechPack(env.pm, id, { mode: "ASK", costOk: true });
    expect(sent.map((s) => s.tool)).toEqual(["record_tech_pack_draft"]);
    // The brief goes with the saved reference photo; nothing about an order it does not have.
    expect(sent[0]!.text).toContain("flat-knit collar with one tipping");
    expect(sent[0]!.text).toContain('"type":"image"');
    expect(sent[0]!.text).toContain("Nordic Wear AB");
    const screen = await getTechPackScreen(env.pm, id);
    expect(screen.draft?.output.lines).toHaveLength(2);
    expect(screen.gaps).toEqual(["1 red line(s) in the AI draft need an OK or a change"]);
    // Its cost and its log line are the tech pack's, marked AI.
    const usage = await prisma.aiUsage.findMany({ select: { recordType: true, recordId: true } });
    expect(usage).toEqual([{ recordType: "TechPack", recordId: id }]);
    const log = await prisma.auditLog.findMany({
      where: { entityType: "TechPack", entityId: id, byAi: true },
      select: { summary: true },
    });
    expect(log.map((l) => l.summary)).toEqual([expect.stringMatching(/AI drafted the tech pack/)]);
    expect(recordHref(env.store, { type: "TechPack", id })).toBe(`/tech-packs/${id}`);
    expect(recordHref(env.sales, { type: "TechPack", id })).toBeNull();
  });

  it("lists every tech pack with search and filters for buyer, style, season and status", async () => {
    const a = await fromBrief(env);
    const b = await register.createTechPack(
      env.pm,
      { title: "Hansa crew tee", buyerId: env.hansa.id, styleId: env.teeStyle.id, season: "AW26" },
      [],
    );
    // A style in production starts its own tech pack (as before v6.4) and it is in the list too.
    const fromProject = await register.startProjectTechPack(env.pm, env.polo.id);
    await approval.approveTechPack(env.owner, env.polo.id);
    const all = await register.listTechPacks(env.store, {});
    expect(all.rows.map((r) => r.id).sort()).toEqual([a.id, b.id, fromProject.id].sort());
    const polo = all.rows.find((r) => r.id === fromProject.id)!;
    expect(polo).toMatchObject({
      number: `TP-${YEAR}-00003`,
      title: "Brand A polo",
      buyer: "Nordic Wear AB",
      status: "APPROVED",
      project: { id: env.polo.id, code: env.polo.code },
    });
    expect(all.rows.find((r) => r.id === b.id)).toMatchObject({
      style: { code: "EX-TS-001", name: "Crew Tee" },
      season: "AW26",
      status: "DRAFT",
      project: null,
      updatedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(all.filters.seasons).toEqual(["AW26", "SS27"]);
    expect(all.filters.buyers.map((x) => x.name)).toEqual(["Hansa Mode GmbH", "Nordic Wear AB"]);
    expect(all.filters.styles.map((x) => x.code)).toEqual(["EX-PL-001", "EX-TS-001"]);
    expect(all.can.create).toBe(false);
    expect((await register.listTechPacks(env.pm, {})).can.create).toBe(true);

    const ids = async (query: Record<string, unknown>) =>
      (await register.listTechPacks(env.store, query)).rows.map((r) => r.id).sort();
    expect(await ids({ q: "crew" })).toEqual([b.id]);
    expect(await ids({ q: `TP-${YEAR}-00001` })).toEqual([a.id]);
    expect(await ids({ q: env.polo.code })).toEqual([fromProject.id]);
    expect(await ids({ q: "nordic" })).toEqual([a.id, fromProject.id].sort());
    expect(await ids({ buyer: env.hansa.id })).toEqual([b.id]);
    expect(await ids({ style: env.teeStyle.id })).toEqual([b.id]);
    expect(await ids({ season: "SS27" })).toEqual([a.id]);
    expect(await ids({ status: "APPROVED" })).toEqual([fromProject.id]);
    expect(await ids({ status: "DRAFT" })).toEqual([a.id, b.id].sort());
    expect(await ids({ status: "DRAFT", buyer: env.nordic.id })).toEqual([a.id]);
    expect(await ids({ q: "nothing like this" })).toEqual([]);

    // A locked fabric part shows as its own status.
    await register.linkTechPackToProject(env.pm, b.id, { projectId: env.tee.id });
    await needs.setMaterialNeeds(env.pm, env.tee.id, {
      needs: [{ materialId: env.buttons.id, perPiece: 1 }],
    });
    expect(await ids({ status: "FABRIC_LOCKED" })).toEqual([]);

    // Another company's list is its own.
    expect((await register.listTechPacks(env.outsider, {})).rows).toEqual([]);
    // Someone who does not see production is refused, in the action and the service.
    await expectAppError(register.listTechPacks(env.sales, {}), "FORBIDDEN");
    signedIn.ctx = env.sales;
    expect((await listTechPacksAction({})).ok).toBe(false);
    signedIn.ctx = env.store;
    const listed = await listTechPacksAction({ status: "APPROVED" });
    expect(listed.ok && listed.data.rows.map((r) => r.id)).toEqual([fromProject.id]);
  });

  it("links a tech pack to a style in production and a catalogue style while it is not approved", async () => {
    const { id, number } = await register.createTechPack(
      env.pm,
      { title: "Polo from the brief", brief: BRIEF },
      [],
    );
    await files.saveColour(env.pm, id, null, { name: "Navy" });
    // Not for the store, not to another company's project, not to a closed one.
    await expectAppError(
      register.linkTechPackToProject(env.store, id, { projectId: env.polo.id }),
      "FORBIDDEN",
    );
    await expectAppError(
      register.linkTechPackToProject(env.pm, id, { projectId: env.theirs.id }),
      "NOT_FOUND",
    );
    await expectAppError(
      register.linkTechPackToProject(env.outsider, id, { projectId: env.theirs.id }),
      "NOT_FOUND",
    );
    await expectAppError(
      register.linkTechPackToProject(env.pm, id, { projectId: env.closed.id }),
      "CONFLICT",
      /cancelled/,
    );

    // Linked: the project's style and buyer fill the empty ones.
    const linked = await register.linkTechPackToProject(env.pm, id, { projectId: env.polo.id });
    expect(linked).toMatchObject({ id, projectId: env.polo.id });
    const row = await prisma.techPack.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      projectId: env.polo.id,
      buyerId: env.nordic.id,
      styleId: env.style.id,
    });
    // The project's tech pack panel opens it.
    const panel = await approval.getTechPack(env.store, env.polo.id);
    expect(panel).toMatchObject({ techPackId: id, number });
    const start = await register.getProjectTechPackStart(env.store, env.polo.id);
    expect(start.techPackId).toBe(id);
    // Its colours are there under the project now; the old project address finds it.
    expect((await getTechPackScreen(env.store, id)).techPack.project).toMatchObject({
      id: env.polo.id,
      code: env.polo.code,
    });
    signedIn.ctx = env.store;
    const open = await getProjectTechPackAction(env.polo.id);
    expect(open.ok && open.data.techPackId).toBe(id);

    // A project with a tech pack of its own takes no other.
    const second = await register.createTechPack(env.pm, { title: "Another polo" }, []);
    await expectAppError(
      register.linkTechPackToProject(env.pm, second.id, { projectId: env.polo.id }),
      "CONFLICT",
      new RegExp(`already has its tech pack ${number}`),
    );
    const tee = await register.startProjectTechPack(env.pm, env.tee.id);
    await expectAppError(
      register.linkTechPackToProject(env.pm, second.id, { projectId: env.tee.id }),
      "CONFLICT",
      /already has its tech pack/,
    );
    expect((await register.findLinkableProjects(env.pm, "")).map((p) => p.id)).toEqual([]);
    expect((await register.findLinkableTechPacks(env.pm, "")).map((t) => t.id)).toEqual([
      second.id,
    ]);
    await expectAppError(register.startProjectTechPack(env.pm, env.tee.id), "CONFLICT");
    expect(tee.id).not.toBe(second.id);

    // A catalogue style: this company's only.
    await expectAppError(
      register.linkTechPackToStyle(env.outsider, id, { styleId: env.teeStyle.id }),
      "NOT_FOUND",
    );
    await register.linkTechPackToStyle(env.pm, id, { styleId: env.teeStyle.id });
    expect((await prisma.techPack.findUniqueOrThrow({ where: { id } })).styleId).toBe(
      env.teeStyle.id,
    );

    // Taken off again and put back while it is a draft.
    await register.linkTechPackToProject(env.pm, id, { projectId: null });
    expect((await prisma.techPack.findUniqueOrThrow({ where: { id } })).projectId).toBeNull();
    expect((await approval.getTechPack(env.store, env.polo.id)).techPackId).toBeNull();
    await register.linkTechPackToProject(env.pm, id, { projectId: env.polo.id });

    // Approved: its links no longer change; a locked fabric part keeps its project too.
    await approval.approveTechPackOf(env.owner, id);
    await expectAppError(
      register.linkTechPackToProject(env.pm, id, { projectId: null }),
      "CONFLICT",
      /approved/,
    );
    await expectAppError(
      register.linkTechPackToStyle(env.pm, id, { styleId: env.style.id }),
      "CONFLICT",
      /approved/,
    );
    expect((await getTechPackScreen(env.pm, id)).can.link).toBe(false);
    await needs.setMaterialNeeds(env.pm, env.tee.id, {
      needs: [
        {
          materialId: (await prisma.rawMaterial.findFirstOrThrow({ where: { kind: "FABRIC" } })).id,
          perPiece: 0.3,
        },
      ],
    });
    await approval.lockFabricPart(env.owner, env.tee.id);
    await expectAppError(
      register.linkTechPackToProject(env.pm, tee.id, { projectId: null }),
      "CONFLICT",
      /fabric part is locked/,
    );

    // Each link is in the log, under the tech pack and under the project.
    const log = await prisma.auditLog.findMany({
      where: { summary: { contains: number } },
      select: { entityType: true, entityId: true, summary: true },
    });
    expect(log).toEqual(
      expect.arrayContaining([
        {
          entityType: "TechPack",
          entityId: id,
          summary: `Linked tech pack ${number} to ${env.polo.code} Brand A polo`,
        },
        {
          entityType: "ProductionProject",
          entityId: env.polo.id,
          summary: `Linked tech pack ${number} to ${env.polo.code} Brand A polo`,
        },
        {
          entityType: "TechPack",
          entityId: id,
          summary: `Took tech pack ${number} off ${env.polo.code} Brand A polo`,
        },
        {
          entityType: "TechPack",
          entityId: id,
          summary: `Linked tech pack ${number} to the style EX-TS-001 Crew Tee`,
        },
      ]),
    );
  });

  it("makes a style's bookings follow the approval of the tech pack linked to it", async () => {
    // Buttons on the batch wait for the polo's tech pack, as before v6.4.
    const made = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.trims.id,
      expectedDate: "2030-11-20",
      batchId: env.batch.id,
      lines: [{ materialId: env.buttons.id, quantity: 900, unitPrice: 2 }],
    });
    await expectAppError(
      bookings.approveBooking(env.owner, made.id),
      "CONFLICT",
      /Collar, cuff and trims wait for the tech pack/,
    );
    // A tech pack from the buyer's brief, approved for nothing until it is linked.
    const { id } = await fromBrief(env);
    await expectAppError(
      bookings.approveBooking(env.owner, made.id),
      "CONFLICT",
      /Collar, cuff and trims wait for the tech pack/,
    );
    await register.linkTechPackToProject(env.pm, id, { projectId: env.polo.id });
    await expectAppError(
      bookings.approveBooking(env.owner, made.id),
      "CONFLICT",
      /Collar, cuff and trims wait for the tech pack/,
    );
    const approved = await approval.approveTechPackOf(env.owner, id);
    expect(approved.status).toBe("APPROVED");
    expect((await approval.getTechPack(env.store, env.polo.id)).status).toBe("APPROVED");
    const booked = await bookings.approveBooking(env.owner, made.id);
    expect(booked.stage).toBe("APPROVED");
    // Approving through the project page is the same tech pack.
    expect(await prisma.techPack.count({ where: { projectId: env.polo.id } })).toBe(1);
    await approval.approveTechPack(env.owner, env.polo.id);
    expect(await prisma.techPack.count()).toBe(1);
  });

  it("keeps the old project addresses and PDFs working", async () => {
    // A project with no tech pack yet: nothing is made by looking.
    signedIn.ctx = env.store;
    const before = await getProjectTechPackAction(env.polo.id);
    expect(before.ok && before.data).toMatchObject({
      techPackId: null,
      project: { id: env.polo.id, code: env.polo.code },
      can: { start: false, link: false },
    });
    expect(await prisma.techPack.count()).toBe(0);
    const pdf = await projectPdfRoute(
      new Request("https://erp.example.test/api/production/projects/x/tech-pack"),
      params({ projectId: env.polo.id }),
    );
    expect(pdf.status).toBe(200);
    expect(await prisma.techPack.count()).toBe(0);
    signedIn.ctx = env.pm;
    const canStart = await getProjectTechPackAction(env.polo.id);
    expect(canStart.ok && canStart.data.can).toEqual({ start: true, link: true });

    // Saving to the project's tech pack (Save to Tech Pack, the approval panel) starts it.
    const ref = await files.addReference(
      env.pm,
      await spec.ensureProjectTechPack(env.pm, env.polo.id),
      { link: "https://example.com/a" },
    );
    const tp = await prisma.techPack.findUniqueOrThrow({ where: { projectId: env.polo.id } });
    expect(ref.techPackId).toBe(tp.id);
    expect(tp).toMatchObject({ number: `TP-${YEAR}-00001`, title: "Brand A polo" });
    expect(await spec.ensureProjectTechPack(env.pm, env.polo.id)).toBe(tp.id);
    await spec.makeChart(env.pm, tp.id, CHART);

    // The project's PDF and measurement sheet, as before, with the chart in them.
    signedIn.ctx = env.store;
    const again = await projectPdfRoute(
      new Request("https://erp.example.test/api/production/projects/x/tech-pack"),
      params({ projectId: env.polo.id }),
    );
    expect(again.status).toBe(200);
    expect(again.headers.get("content-type")).toMatch(/pdf/);
    const sheet = await projectMeasurementsRoute(
      new Request("https://erp.example.test/api/production/projects/x/tech-pack/measurements"),
      params({ projectId: env.polo.id }),
    );
    expect(sheet.status).toBe(200);
    const direct = await techPackPdf(env.store, env.polo.id);
    expect(direct.fileName).toMatch(new RegExp(`Tech pack ${env.polo.code}`));
    // The tech pack's own PDF for a linked one is the style's, with its materials.
    expect((await techPackPdfOf(env.store, tp.id)).fileName).toBe(direct.fileName);
    const open = await getProjectTechPackAction(env.polo.id);
    expect(open.ok && open.data.techPackId).toBe(tp.id);
    // A project of another company is not found.
    signedIn.ctx = env.outsider;
    const notTheirs = await getProjectTechPackAction(env.polo.id);
    expect(!notTheirs.ok && notTheirs.error.code).toBe("NOT_FOUND");
  });

  it("fills in the tech packs made before v6.4 and carries on their numbers", async () => {
    // Two tech packs as v6.3 made them: no number, title, buyer or style of their own.
    await prisma.productionProject.update({
      where: { id: env.tee.id },
      data: { styleId: env.teeStyle.id, buyerId: env.hansa.id },
    });
    const old = async (projectId: string, createdAt: string) =>
      prisma.techPack.create({
        data: { companyId: env.company.id, projectId, createdAt: new Date(createdAt) },
      });
    const first = await old(env.polo.id, `${YEAR}-03-01T09:00:00Z`);
    const second = await old(env.tee.id, `${YEAR}-04-01T09:00:00Z`);
    const migration = (folder: string, from: string, to: string) => {
      const sql = readFileSync(
        join(process.cwd(), "prisma", "migrations", folder, "migration.sql"),
        "utf8",
      );
      return sql.slice(sql.indexOf(from), sql.indexOf(to));
    };
    const backfill = migration(
      "20261203090000_v64_tech_pack_module",
      "-- Backfill (begin)",
      "-- Backfill (end)",
    );
    for (const statement of backfill.split(";").filter((s) => /UPDATE/.test(s))) {
      await prisma.$executeRawUnsafe(statement);
    }
    await prisma.documentSequence.deleteMany({ where: { docType: "TECH_PACK" } });
    await prisma.$executeRawUnsafe(
      migration("20261203090000_v64_tech_pack_numbers", "INSERT", "-- Counter (end)"),
    );

    const rows = await prisma.techPack.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.id, r.number, r.title, r.buyerId, r.styleId])).toEqual([
      [first.id, `TP-${YEAR}-00001`, "Brand A polo", env.nordic.id, env.style.id],
      [second.id, `TP-${YEAR}-00002`, "Brand B tee", env.hansa.id, env.teeStyle.id],
    ]);
    // In the list with what was filled in; the next new one carries on the numbers.
    const list = await register.listTechPacks(env.store, { buyer: env.hansa.id });
    expect(list.rows).toEqual([
      expect.objectContaining({
        id: second.id,
        number: `TP-${YEAR}-00002`,
        title: "Brand B tee",
        buyer: "Hansa Mode GmbH",
        style: { id: env.teeStyle.id, code: "EX-TS-001", name: "Crew Tee" },
        project: expect.objectContaining({ id: env.tee.id }),
      }),
    ]);
    expect((await fromBrief(env)).number).toBe(`TP-${YEAR}-00003`);
    // Their pages open as before, through the project or by the tech pack.
    expect((await getTechPackScreen(env.store, first.id)).techPack.project?.id).toBe(env.polo.id);
  });

  it("shows the Tech Pack menu to those who open tech packs, and keeps each company's own", async () => {
    const menu = (permissions: readonly string[]) =>
      visibleNavItems([...permissions]).map((i) => i.href);
    for (const ctx of [env.owner, env.pm, env.store]) {
      expect(menu([...ctx.permissions])).toContain("/tech-packs");
    }
    expect(menu([...env.sales.permissions])).not.toContain("/tech-packs");
    expect(menu(DEFAULT_ROLE_PERMISSIONS.EMPLOYEE)).not.toContain("/tech-packs");
    expect(menu(DEFAULT_ROLE_PERMISSIONS.ACCOUNTS)).toContain("/tech-packs");
    // Right after Production; every entry still reachable on the phone and the top bar.
    const owner = visibleNavItems([...env.owner.permissions]);
    const at = owner.findIndex((i) => i.href === "/tech-packs");
    expect(owner[at - 1]!.href).toBe("/production");
    expect(owner[at]!.label).toBe("Tech Pack");
    // The phone's tab bar keeps its four; Tech Pack opens first under More.
    const phone = phoneTabs(owner);
    expect(phone.tabs.map((i) => i.href)).toEqual(["/", "/sales", "/production", "/accounts"]);
    expect(phone.more[0]!.href).toBe("/tech-packs");
    expect([...phone.tabs, ...phone.more].map((i) => i.href).sort()).toEqual(
      owner.map((i) => i.href).sort(),
    );
    expect(owner.map((_, i) => topBarFold(i))).toContain("all");

    // The pages: refused to sales, not found for another company.
    const { id } = await fromBrief(env);
    signedIn.ctx = env.sales;
    const refused = await getTechPackScreenAction(id);
    expect(!refused.ok && refused.error.code).toBe("FORBIDDEN");
    await expectAppError(getTechPackScreen(env.sales, id), "FORBIDDEN");
    signedIn.ctx = env.outsider;
    const hidden = await getTechPackScreenAction(id);
    expect(!hidden.ok && hidden.error.code).toBe("NOT_FOUND");
    await expectAppError(spec.makeChart(env.outsider, id, CHART), "NOT_FOUND");
    await expectAppError(
      files.addReference(env.outsider, id, { link: "https://example.com" }),
      "NOT_FOUND",
    );
    await expectAppError(techPackPdfOf(env.outsider, id), "NOT_FOUND");
    await expectAppError(
      register.updateTechPackDetails(env.outsider, id, { title: "Mine now" }),
      "NOT_FOUND",
    );
    expect(await register.findLinkableTechPacks(env.outsider, "")).toEqual([]);
    expect((await register.pickSaveTargets(env.outsider, "")).map((p) => p.id)).toEqual([
      env.theirs.id,
    ]);
    // Their own picks list this company's open tech packs and styles in production.
    const picks = await register.pickSaveTargets(env.pm, "");
    expect(picks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "TECH_PACK", id, code: `TP-${YEAR}-00001` }),
        expect.objectContaining({ kind: "PROJECT", id: env.polo.id, code: env.polo.code }),
      ]),
    );
    expect(picks.some((p) => p.id === env.closed.id)).toBe(false);

    // Saving to an open style in production starts its tech pack; a closed one or another
    // company's is refused, and nothing is started for them.
    const teeTechPack = await register.techPackForSave(env.pm, { kind: "PROJECT", id: env.tee.id });
    expect(teeTechPack).toBe(
      (await prisma.techPack.findUniqueOrThrow({ where: { projectId: env.tee.id } })).id,
    );
    await expectAppError(
      register.techPackForSave(env.pm, { kind: "PROJECT", id: env.closed.id }),
      "CONFLICT",
    );
    await expectAppError(
      register.techPackForSave(env.pm, { kind: "PROJECT", id: env.theirs.id }),
      "NOT_FOUND",
    );
    expect(
      await prisma.techPack.count({ where: { projectId: { in: [env.closed.id, env.theirs.id] } } }),
    ).toBe(0);
    signedIn.ctx = env.pm;
    const form = new FormData();
    form.set("link", "https://example.com/collar");
    const saved = await saveToTechPackAction({ kind: "TECH_PACK", id }, form);
    expect(saved.ok && saved.data.techPackId).toBe(id);
    signedIn.ctx = env.outsider;
    const notTheirs = await saveToTechPackAction({ kind: "TECH_PACK", id }, form);
    expect(!notTheirs.ok && notTheirs.error.code).toBe("NOT_FOUND");
  });

  it("opens the tech pack to whoever approves it, to read and approve but not change (v6.4.1 C5)", async () => {
    // A role with only "approve tech packs", and one with only the logo tick.
    const roleWith = async (
      name: string,
      key: "production.techpack.approve" | "production.logo.approve",
    ) => {
      const role = await createRole(env.owner, { name, permissions: ["dashboard.view", key] });
      const user = await makeUser(`${name.toLowerCase().replace(/\W+/g, "-")}@extas.test`);
      await addToCompany(user.id, env.company.id, role.id);
      return contextFor(user.id, env.company.id);
    };
    const approver = await roleWith("Tech pack approver", "production.techpack.approve");
    const ticker = await roleWith("Logo approver", "production.logo.approve");
    const { id } = await fromBrief(env);
    await register.linkTechPackToProject(env.pm, id, { projectId: env.polo.id });

    // The Tech Pack menu, the list, the page and the old project address open for both.
    for (const ctx of [approver, ticker]) {
      expect(visibleNavItems([...ctx.permissions]).map((i) => i.href)).toContain("/tech-packs");
      signedIn.ctx = ctx;
      const list = await listTechPacksAction({});
      expect(list.ok && list.data.rows.map((r) => r.id)).toEqual([id]);
      expect(list.ok && list.data.can.create).toBe(false);
      const old = await getProjectTechPackAction(env.polo.id);
      expect(old.ok && old.data.techPackId).toBe(id);
    }
    signedIn.ctx = approver;
    const opened = await getTechPackScreenAction(id);
    expect(opened.ok).toBe(true);
    const screen = opened.ok ? opened.data : null;
    // Read only: no editing, linking or AI; the approval is theirs.
    expect(screen!.can).toEqual({ edit: false, ai: false, tick: false, link: false });
    expect(screen!.approval.can.approve).toBe(true);
    expect((await getTechPackScreen(approver, id)).techPack.id).toBe(id);
    // Its PDF, measurement sheet and reference photo open too.
    const pdf = await techPackPdfRoute(
      new Request("https://erp.example.test/api/tech-packs/x/pdf"),
      params({ techPackId: id }),
    );
    expect(pdf.status).toBe(200);
    const sheet = await techPackMeasurementsRoute(
      new Request("https://erp.example.test/api/tech-packs/x/measurements?format=pdf"),
      params({ techPackId: id }),
    );
    // No chart yet, so there is no sheet to give, but the reader is not refused.
    expect(sheet.status).toBe(404);
    const photoId = screen!.references.find((r) => r.file)!.file!.id;
    await expect(getFileForDownload(approver, photoId)).resolves.toBeTruthy();
    await expect(getFileForDownload(ticker, photoId)).resolves.toBeTruthy();

    // Changing anything is refused, in the action and in the service.
    const details = await updateTechPackDetailsAction(id, { title: "Changed" });
    expect(!details.ok && details.error.code).toBe("FORBIDDEN");
    const chart = await makeChartAction(id, CHART);
    expect(!chart.ok && chart.error.code).toBe("FORBIDDEN");
    await expectAppError(spec.makeChart(approver, id, CHART), "FORBIDDEN");
    await expectAppError(
      register.updateTechPackDetails(approver, id, { title: "Changed" }),
      "FORBIDDEN",
    );
    await expectAppError(
      files.addReference(approver, id, { link: "https://example.com" }),
      "FORBIDDEN",
    );
    const started = await createTechPackAction(new FormData());
    expect(!started.ok && started.error.code).toBe("FORBIDDEN");
    expect((await prisma.techPack.findUniqueOrThrow({ where: { id } })).title).toBe(
      "Nordic polo SS27",
    );

    // Approving works from the page.
    const approved = await approveTechPackOfAction(id);
    expect(approved.ok).toBe(true);
    expect((await prisma.techPack.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");

    // The logo approver reads it and ticks logos, but cannot approve or change it.
    signedIn.ctx = ticker;
    const theirs = await getTechPackScreenAction(id);
    expect(theirs.ok && theirs.data.can).toEqual({
      edit: false,
      ai: false,
      tick: true,
      link: false,
    });
    expect(theirs.ok && theirs.data.approval.can).toEqual({ lock: false, approve: false });
    await expectAppError(approval.approveTechPackOf(ticker, id), "FORBIDDEN");

    // Someone with neither (sales) still cannot open it.
    signedIn.ctx = env.sales;
    const refused = await getTechPackScreenAction(id);
    expect(!refused.ok && refused.error.code).toBe("FORBIDDEN");
    await expectAppError(register.listTechPacks(env.sales, {}), "FORBIDDEN");
    await expectAppError(getFileForDownload(env.sales, photoId), "FORBIDDEN");
    const salesSheet = await techPackMeasurementsRoute(
      new Request("https://erp.example.test/api/tech-packs/x/measurements?format=pdf"),
      params({ techPackId: id }),
    );
    expect(salesSheet.status).toBe(403);
  });

  it("changes a tech pack's details and logs them", async () => {
    const { id, number } = await fromBrief(env);
    await expectAppError(
      register.updateTechPackDetails(env.store, id, { title: "No" }),
      "FORBIDDEN",
    );
    await register.updateTechPackDetails(env.pm, id, {
      title: "Nordic polo SS27 v2",
      buyerId: env.hansa.id,
      season: "",
      brief: "Updated brief",
    });
    const row = await prisma.techPack.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      title: "Nordic polo SS27 v2",
      buyerId: env.hansa.id,
      season: null,
      brief: "Updated brief",
    });
    await expectAppError(
      register.updateTechPackDetails(env.pm, id, { title: "X", buyerId: env.theirBuyer.id }),
      "NOT_FOUND",
    );
    const log = await prisma.auditLog.findFirst({
      where: { entityType: "TechPack", entityId: id, action: "UPDATE" },
    });
    expect(log?.summary).toBe(`${number}: changed its details`);
  });

  it("keeps an approved tech pack's title, buyer and brief; its season can still change", async () => {
    const { id, number } = await fromBrief(env);
    await register.linkTechPackToProject(env.pm, id, { projectId: env.polo.id });
    await approval.approveTechPackOf(env.owner, id);
    const kept = { title: "Nordic polo SS27", buyerId: env.nordic.id, brief: BRIEF };
    for (const change of [
      { title: "Nordic polo SS28" },
      { buyerId: env.hansa.id },
      { buyerId: "" },
      { brief: "Another brief" },
      { brief: "" },
    ]) {
      await expectAppError(
        register.updateTechPackDetails(env.pm, id, { ...kept, season: "SS27", ...change }),
        "CONFLICT",
        new RegExp(`^${number} is approved: its title, buyer and brief no longer change`),
      );
    }
    expect(await prisma.techPack.findUniqueOrThrow({ where: { id } })).toMatchObject({
      title: "Nordic polo SS27",
      buyerId: env.nordic.id,
      brief: BRIEF,
      season: "SS27",
    });
    // Its season (a label to find it by) still changes, with the rest sent as it is.
    await register.updateTechPackDetails(env.pm, id, { ...kept, season: "SS27 drop 2" });
    expect((await prisma.techPack.findUniqueOrThrow({ where: { id } })).season).toBe("SS27 drop 2");
    await register.updateTechPackDetails(env.pm, id, { title: kept.title, season: "SS27" });
    expect((await prisma.techPack.findUniqueOrThrow({ where: { id } })).season).toBe("SS27");
  });

  it("keeps no file of a tech pack that could not be started", async () => {
    const dir = await mkdtemp(join(tmpdir(), "extras-tech-pack-start-"));
    vi.stubEnv("UPLOAD_DIR", dir);
    const kept = async () =>
      (await readdir(dir, { recursive: true, withFileTypes: true })).filter((f) => f.isFile());
    try {
      const before = await prisma.fileAsset.count();
      // The second file is not a photo or a PDF: nothing starts, and the first photo goes too.
      await expectAppError(
        register.createTechPack(env.pm, { title: "Hansa tee" }, [
          photo(),
          { fileName: "notes.txt", bytes: Buffer.from("not a photo") },
        ]),
        "VALIDATION",
      );
      // The tech pack cannot be saved after its photos were: they go too.
      vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("The database went away"));
      await expect(
        register.createTechPack(env.pm, { title: "Hansa tee" }, [photo(), photo("back.png")]),
      ).rejects.toThrow("The database went away");
      expect(await prisma.techPack.count({ where: { title: "Hansa tee" } })).toBe(0);
      expect(await prisma.fileAsset.count()).toBe(before);
      expect(await kept()).toEqual([]);

      // Started, its photos stay.
      await register.createTechPack(env.pm, { title: "Hansa tee" }, [photo(), photo("back.png")]);
      expect(await prisma.fileAsset.count()).toBe(before + 2);
      expect(await kept()).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
