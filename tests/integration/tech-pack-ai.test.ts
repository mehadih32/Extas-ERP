import { readFile } from "node:fs/promises";
import path from "node:path";

import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * Tech pack AI (part 6): the full measurement chart from the buyer's few
 * points, the owner's instructions, saved references (Save to Tech Pack),
 * logos with their machine files checked and the owner's tick, colours with
 * lab dips against the buyer's limit, the AI draft, experts and the review
 * board, and approval held back while anything is red.
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
  return {
    ...real,
    requireCompany: async () => ctx(),
    requirePermission: async (...keys: string[]) => {
      if (keys.some((k) => !ctx().permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx();
    },
  };
});

import { POST as share } from "@/app/api/production/share/route";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { aiAccountOf } from "@/modules/ai/account";
import { AiAskFirst, standInForClaude } from "@/modules/ai/claude";
import { setBudget } from "@/modules/ai/costs.service";
import { setAiSwitch, setApiKey } from "@/modules/ai/settings.service";
import { getFileForDownload, storeUpload } from "@/modules/files/file.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as materials from "@/modules/materials/material.service";
import * as parties from "@/modules/parties/party.service";
import * as batches from "@/modules/production/batch.service";
import { designFacts, readExp, writeDst, type Design } from "@/modules/production/logo-files";
import * as needs from "@/modules/production/material-need.service";
import * as projects from "@/modules/production/project.service";
import * as ai from "@/modules/production/tech-pack-ai.service";
import { approveTechPack } from "@/modules/production/tech-pack-approval.service";
import { digitizingBrief, measurementsFile } from "@/modules/production/tech-pack-export";
import * as files from "@/modules/production/tech-pack-files.service";
import { getTechPackScreen } from "@/modules/production/tech-pack-screen.service";
import * as spec from "@/modules/production/tech-pack-spec.service";
import { draftTechPackAction } from "@/server/actions/tech-pack.actions";

import { claudeMessage } from "../fixtures/claude";
import { png } from "../fixtures/images";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const KEY = "sk-ant-api03-test0123456789abcdWXYZ";

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

const photo = () => ({ fileName: "sample.png", bytes: png({ width: 4, height: 4 }) });

/** A 27 × 10 mm logo in two colours. */
const SQUARE: Design = {
  stitches: [
    { x: 0, y: 0, kind: "JUMP" },
    { x: 100, y: 0, kind: "STITCH" },
    { x: 100, y: 100, kind: "STITCH" },
    { x: 0, y: 100, kind: "STITCH" },
    { x: 0, y: 0, kind: "STITCH" },
    { x: 0, y: 0, kind: "COLOR" },
    { x: 250, y: 50, kind: "JUMP" },
    { x: 270, y: 50, kind: "STITCH" },
    { x: 270, y: 50, kind: "END" },
  ],
};
const dst = () => ({
  fileName: "CHEST LOGO.DST",
  bytes: Buffer.from(writeDst(SQUARE, "CHEST LOGO")),
});

const SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect x="0" y="0" width="120" height="100" fill="#cc0000"/>
  <circle cx="160" cy="50" r="40" fill="#1f2a44"/>
</svg>`;

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
  await matrix.generateMatrix(owner, style.id, {
    colorIds: [navy.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { size: true },
  });
  const mill = (await parties.createParty(owner, { kind: "SUPPLIER", name: "Narayanganj Fabrics" }))
    .party;
  const knit = (
    await parties.createParty(owner, { kind: "SUPPLIER", name: "Gazipur Knit Factory" })
  ).party;
  const jersey = await materials.createMaterial(pm, {
    name: "Pique 220 GSM",
    kind: "FABRIC",
    unit: "KG",
    supplierId: mill.id,
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
    targets: variants.map((v) => ({ variantId: v.id, quantity: 100 })),
  });
  await needs.setMaterialNeeds(pm, polo.id, {
    needs: [{ materialId: jersey.id, perPiece: 0.28, wastagePercent: 5, split: "COLOUR" }],
  });
  // The style's tech pack, as its page starts it (v6.4: everything is keyed by the tech pack).
  const tp = await spec.ensureProjectTechPack(pm, polo.id);
  return { company, owner, pm, store, sales, outsider, polo, tp };
}

type Env = Awaited<ReturnType<typeof setup>>;

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

const rowOf = async (env: Env, code: string) =>
  (await spec.getChart(env.pm, env.tp)).rows.find((r) => r.code === code)!;

/** Claude answers each tool with its stand-in input, recording what it was sent. */
function standIn(inputs: Record<string, unknown>) {
  const sent: Array<{ model: string; tool: string; text: string }> = [];
  standInForClaude(async ({ body }) => {
    const tool = (body.tools?.[0] as Anthropic.Tool | undefined)?.name ?? "";
    const text = JSON.stringify(body.messages);
    sent.push({ model: body.model, tool, text });
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

const DRAFT = {
  item: "Men's piqué polo, 2-button placket, rib collar",
  garment: "POLO",
  lines: [
    { section: "Fabric", text: "Piqué 220 GSM, 100% cotton", signal: "green" },
    {
      section: "Construction",
      text: "Side vents 1.5 inch",
      signal: "yellow",
      why: "Seen in the photo",
    },
    {
      section: "Trims & Labels",
      text: "Button size not given",
      signal: "red",
      why: "Ask the buyer",
    },
  ],
  questions: ["Which button: 4-hole 18L or 2-hole 16L?"],
  rules: [{ section: "Packing", instruction: "Single polybag", result: "applied" }],
  chart: {
    unit: "INCH",
    sizes: ["S", "M", "L"],
    baseSize: "S",
    chest: 40,
    chestBasis: "FULL",
    chestGrade: 2,
    length: 28,
  },
};

const REVIEW = {
  summary: "Ready once the button is settled.",
  findings: [
    { seat: "X10", finding: "Button size missing", severity: "red" },
    { seat: "X01", finding: "Chest grade is regular", severity: "info" },
  ],
};

const ANSWER = {
  short_answer: "Allow 5% shrinkage in length for this piqué.",
  calculation: "28 × 1.05 = 29.4",
  risks: ["Wash test not done"],
  confidence: "medium",
  actions: ["Ask the mill for a wash test"],
};

const LAB = {
  round: 1,
  options: [
    { letter: "A", deltaE: 0.78, dl: 0.6, dc: -1.02, dh: 0.24, mi: 0.3, light: "D65" },
    { letter: "B", deltaE: 1.4 },
  ],
  notes: "Measured CMC 2:1",
};

const ESTIMATE = {
  codes: [{ code: "19-4052 TCX", name: "Classic Blue" }],
  confidence: "low",
  why: "Indoor light",
  next: "Ask the buyer for the code",
};

async function switchOn(env: Env, budget = "5000") {
  await setAiSwitch(env.owner, true);
  await setApiKey(env.owner, { key: KEY });
  await setBudget(env.owner, {
    monthly: budget,
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

run("Tech pack AI", () => {
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

  it("makes the full chart from the buyer's few points and keeps what people typed", async () => {
    await expectAppError(spec.makeChart(env.store, env.tp, CHART), "FORBIDDEN");
    await spec.makeChart(env.pm, env.tp, CHART);
    const chest = await rowOf(env, "CHEST");
    expect(chest.values).toMatchObject({ S: 40, M: 42, L: 44 });
    expect(chest.sources).toMatchObject({ S: "BUYER", M: "RULE" });
    expect((await rowOf(env, "LENGTH")).values).toMatchObject({ S: 28, M: 28.5, L: 29 });

    await spec.setMeasurement(env.pm, env.tp, { code: "SHOULDER", size: "M", value: 17.75 });
    await spec.confirmMeasurementRow(env.pm, env.tp, "LENGTH");
    expect((await rowOf(env, "SHOULDER")).sources.M).toBe("OWNER");
    // The buyer's own point stays the buyer's.
    expect((await rowOf(env, "LENGTH")).sources).toEqual({ S: "BUYER", M: "OWNER", L: "OWNER" });

    // Made again from a new chest: the rules move, what people typed or confirmed stays.
    await spec.makeChart(env.pm, env.tp, { ...CHART, chest: 41 });
    expect((await rowOf(env, "CHEST")).values).toMatchObject({ S: 41, M: 43 });
    expect((await rowOf(env, "SHOULDER")).values.M).toBe(17.75);
    expect((await rowOf(env, "LENGTH")).values).toMatchObject({ S: 28, M: 28.5, L: 29 });

    // A point the rules do not make is red until someone fills it.
    await spec.addMeasurementRow(env.pm, env.tp, { name: "Pocket position" });
    const screen = await getTechPackScreen(env.store, env.tp);
    expect(screen.gaps).toEqual(["Measurements missing: Pocket position"]);
    expect(screen.chart.signals.red).toBe(3);
    const own = screen.chart.rows.find((r) => r.name === "Pocket position")!;
    await spec.removeMeasurementRow(env.pm, env.tp, own.code);
    expect((await getTechPackScreen(env.store, env.tp)).gaps).toEqual([]);

    const pdf = await measurementsFile(env.store, env.tp, "pdf");
    expect(pdf.mimeType).toBe("application/pdf");
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const xlsx = await measurementsFile(env.store, env.tp, "xlsx");
    expect(xlsx.fileName).toMatch(/Measurements PRD-\d{4}-\d{5}.*\.xlsx$/);
    expect(xlsx.bytes.subarray(0, 2).toString()).toBe("PK");

    await expect(spec.makeChart(env.pm, env.tp, { ...CHART, baseSize: "XL" })).rejects.toThrow(
      ZodError,
    );
  });

  it("keeps the owner's instructions and the references saved to a style", async () => {
    await spec.setInstructions(env.pm, env.tp, {
      General: "Use the buyer's care label",
      Packing: "Single polybag, no tissue",
    });
    await files.addReference(env.pm, env.tp, {
      link: "https://www.etsy.com/listing/1",
      note: "Button",
    });
    const withPhoto = await files.addReference(env.pm, env.tp, { note: "Sample" }, photo());
    await expectAppError(files.addReference(env.pm, env.tp, { note: "Nothing" }), "VALIDATION");
    await expect(files.addReference(env.pm, env.tp, { link: "etsy.com/x" })).rejects.toThrow(
      ZodError,
    );

    // Save to Tech Pack: the photo shared from the phone is the sharer's own, for a day.
    const shared = await storeUpload(env.pm, photo());
    await expectAppError(
      files.addReference(env.owner, env.tp, { sharedFileId: shared.id }),
      "VALIDATION",
      /Share it again/,
    );
    await files.addReference(env.pm, env.tp, { sharedFileId: shared.id, note: "Shared" });

    const screen = await getTechPackScreen(env.store, env.tp);
    expect(screen.instructions).toMatchObject({ General: "Use the buyer's care label" });
    expect(screen.references).toHaveLength(3);
    expect(screen.references.find((r) => r.note === "Shared")?.file?.id).toBe(shared.id);
    expect(screen.can).toMatchObject({ edit: false, ai: false, tick: false });

    // Anyone who sees production opens the photo; others do not.
    const fileId = screen.references.find((r) => r.note === "Sample")!.file!.id;
    await expect(getFileForDownload(env.store, fileId)).resolves.toBeTruthy();
    await expectAppError(getFileForDownload(env.sales, fileId), "FORBIDDEN");

    await files.removeReference(env.pm, env.tp, withPhoto.id);
    expect((await getTechPackScreen(env.pm, env.tp)).references).toHaveLength(2);
    // Another company's style is not there.
    await expectAppError(getTechPackScreen(env.outsider, env.tp), "NOT_FOUND");
    await expectAppError(
      files.addReference(env.outsider, env.tp, { link: "https://example.com" }),
      "NOT_FOUND",
    );
  });

  it("checks logo machine files and keeps bulk to the owner's tick", async () => {
    const { id: logoId } = await files.saveLogo(env.pm, env.tp, null, {
      name: "Chest logo",
      placement: "Left chest",
      widthMm: "27",
      heightMm: "10",
      colours: "2",
      fabric: "PQ",
    });
    await expectAppError(
      files.uploadLogoFile(
        env.pm,
        env.tp,
        logoId,
        { kind: "MACHINE", source: "BUYER_FILE" },
        {
          fileName: "logo.emb",
          bytes: Buffer.from("anything"),
        },
      ),
      "VALIDATION",
      /Wilcom EMB is not used/,
    );
    await expectAppError(
      files.uploadLogoFile(env.pm, env.tp, logoId, { kind: "MACHINE" }, dst()),
      "VALIDATION",
      /buyer or the puncher/,
    );
    const uploaded = await files.uploadLogoFile(
      env.pm,
      env.tp,
      logoId,
      { kind: "MACHINE", source: "BUYER_FILE" },
      dst(),
    );
    expect(uploaded.check).toMatchObject({ verdict: "PASS", stitches: 5, widthMm: 27, colours: 2 });

    // One master, other machines' files from it.
    const exp = await files.logoMachineFile(env.store, env.tp, logoId, "EXP");
    expect(designFacts(readExp(new Uint8Array(exp.bytes)))).toMatchObject({
      stitches: 5,
      widthMm: 27,
    });
    const brief = await digitizingBrief(env.store, env.tp, logoId);
    expect(brief.bytes.subarray(0, 5).toString()).toBe("%PDF-");

    expect((await getTechPackScreen(env.pm, env.tp)).gaps).toEqual([
      "Logo without the owner's tick: Chest logo",
    ]);
    // The tick is the owner's, after the sew-out.
    await expectAppError(files.tickLogo(env.pm, env.tp, logoId), "FORBIDDEN");
    await expectAppError(files.tickLogo(env.owner, env.tp, logoId), "CONFLICT", /sew-out/);
    await files.uploadLogoFile(
      env.pm,
      env.tp,
      logoId,
      { kind: "SEW_OUT", note: "On bulk piqué" },
      photo(),
    );
    await files.tickLogo(env.owner, env.tp, logoId);
    let screen = await getTechPackScreen(env.pm, env.tp);
    expect(screen.gaps).toEqual([]);
    expect(screen.logos[0]).toMatchObject({ signal: "green", tickedBy: expect.any(String) });
    // A ticked logo is locked until the owner takes the tick back.
    await expectAppError(
      files.uploadLogoFile(
        env.pm,
        env.tp,
        logoId,
        { kind: "MACHINE", source: "FACTORY_PUNCHER" },
        dst(),
      ),
      "CONFLICT",
    );
    await expectAppError(
      files.removeLogo(env.pm, env.tp, logoId),
      "CONFLICT",
      /takes the tick back/,
    );
    await files.untickLogo(env.owner, env.tp, logoId);

    // The draft from the vector is the last resort.
    await expectAppError(
      files.draftLogoFromVector(env.pm, env.tp, logoId),
      "CONFLICT",
      /last resort/,
    );
    const { id: back } = await files.saveLogo(env.pm, env.tp, null, {
      name: "Back neck logo",
    });
    await files.uploadLogoFile(
      env.pm,
      env.tp,
      back,
      { kind: "ARTWORK" },
      {
        fileName: "logo.svg",
        bytes: Buffer.from(SVG),
      },
    );
    await expectAppError(files.draftLogoFromVector(env.pm, env.tp, back), "VALIDATION", /width/);
    await files.saveLogo(env.pm, env.tp, back, { name: "Back neck logo", widthMm: "40" });
    const drafted = await files.draftLogoFromVector(env.pm, env.tp, back);
    expect(drafted.check.stitches).toBeGreaterThan(50);
    expect(drafted.check.widthMm).toBeCloseTo(40, 0);
    screen = await getTechPackScreen(env.pm, env.tp);
    expect(screen.logos.find((l) => l.id === back)).toMatchObject({
      source: "AI_FROM_VECTOR",
      machineFormat: "DST",
    });
    // Never from a photo.
    const { id: photoLogo } = await files.saveLogo(env.pm, env.tp, null, {
      name: "Sleeve",
      widthMm: "30",
    });
    await files.uploadLogoFile(env.pm, env.tp, photoLogo, { kind: "ARTWORK" }, photo());
    await expectAppError(files.draftLogoFromVector(env.pm, env.tp, photoLogo), "CONFLICT", /SVG/);
  });

  it("checks lab dips against the buyer's limit and keeps the buyer's answer", async () => {
    const { id: colourId } = await files.saveColour(env.pm, env.tp, null, {
      name: "Navy",
      code: "19-4052 TCX",
      deltaLimit: "1.0",
      primaryLight: "D65",
    });
    await files.addLabDips(env.pm, env.tp, colourId, {
      round: 1,
      options: [
        { letter: "A", deltaE: "0.78" },
        { letter: "B", deltaE: "1.30" },
        { letter: "C", deltaE: "0.60", mi: "1.4" },
      ],
    });
    let navy = (await getTechPackScreen(env.store, env.tp)).colours[0]!;
    expect(navy.options.map((o) => [o.letter, o.check.verdict])).toEqual([
      ["A", "PASS"],
      ["B", "FAIL"],
      ["C", "FAIL"],
    ]);
    expect(navy.options[2]!.check.why).toMatch(/metamerism index is 1.40/);
    expect(navy.advice.send).toEqual(["A"]);
    expect(navy.signal).toBe("yellow");
    await expect(
      files.addLabDips(env.pm, env.tp, colourId, {
        round: 1,
        options: [
          { letter: "A", deltaE: "0.5" },
          { letter: "A", deltaE: "0.6" },
        ],
      }),
    ).rejects.toThrow(ZodError);

    await expectAppError(
      files.setLabDipStatus(env.pm, env.tp, colourId, { status: "BUYER_APPROVED" }),
      "VALIDATION",
      /Pick the option/,
    );
    await files.setLabDipStatus(env.pm, env.tp, colourId, {
      status: "BUYER_APPROVED",
      optionId: navy.options[0]!.id,
    });
    navy = (await getTechPackScreen(env.store, env.tp)).colours[0]!;
    expect(navy).toMatchObject({
      status: "BUYER_APPROVED",
      approvedOption: "A, round 1",
      signal: "green",
    });

    // White is approved by eye.
    const { id: white } = await files.saveColour(env.pm, env.tp, null, {
      name: "Optic White",
    });
    await files.setLabDipStatus(env.pm, env.tp, white, { status: "BUYER_APPROVED" });
    expect((await getTechPackScreen(env.pm, env.tp)).colours[1]).toMatchObject({
      approvedOption: "by eye",
      visualOnly: true,
    });
  });

  it("drafts, answers and reviews with AI only when it is on, and never approves anything", async () => {
    await files.saveColour(env.pm, env.tp, null, { name: "Navy" });
    await expectAppError(
      ai.draftTechPack(env.pm, env.tp, { mode: "ASK" }),
      "UNAVAILABLE",
      /switched off/,
    );
    await switchOn(env, "");
    const sent = standIn({
      record_tech_pack_draft: DRAFT,
      record_review: REVIEW,
      record_expert_answer: ANSWER,
      record_lab_dips: LAB,
      record_colour_estimate: ESTIMATE,
    });

    // Big work without a monthly budget shows the estimate first.
    signedIn.ctx = env.pm;
    const first = await draftTechPackAction(env.tp, { mode: "ASK" });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.fieldErrors?.aiAskFirst?.[0]).toMatch(/^BDT \d/);
    await expectAppError(ai.draftTechPack(env.pm, env.tp, { mode: "ASK" }), "CONFLICT").then((e) =>
      expect(e).toBeInstanceOf(AiAskFirst),
    );
    expect(sent).toHaveLength(0);
    const again = await draftTechPackAction(env.tp, { mode: "ASK", costOk: true });
    expect(again.ok).toBe(true);
    expect(sent.map((s) => s.tool)).toEqual(["record_tech_pack_draft"]);
    // The AI never sees prices or suppliers.
    expect(sent[0]!.text).not.toMatch(/Narayanganj|unitPrice|1450|wholesale/i);
    expect(sent[0]!.text).toContain("Pique 220 GSM");

    let screen = await getTechPackScreen(env.pm, env.tp);
    expect(screen.draft?.output.lines).toHaveLength(3);
    expect(screen.draft?.output.questions).toEqual(["Which button: 4-hole 18L or 2-hole 16L?"]);
    expect(screen.gaps).toEqual(["1 red line(s) in the AI draft need an OK or a change"]);
    expect(screen.can.ai).toBe(true);

    // Approval waits for the red line; a person's change turns it green.
    await expectAppError(
      approveTechPack(env.owner, env.polo.id),
      "CONFLICT",
      /red cells: 1 red line/,
    );
    await ai.decideDraftLine(env.pm, env.tp, screen.draft!.id, {
      index: 2,
      decision: "CHANGE",
      text: "4-hole 18L button",
    });
    await ai.decideDraftLine(env.pm, env.tp, screen.draft!.id, { index: 1, decision: "OK" });
    screen = await getTechPackScreen(env.pm, env.tp);
    expect(screen.draft?.output.lines.map((l) => l.decision)).toEqual([null, "OK", "CHANGED"]);
    expect(screen.gaps).toEqual([]);

    // With a budget: Auto mode adds the review board; experts answer; nothing changes by them.
    await switchOn(env);
    await ai.draftTechPack(env.pm, env.tp, { mode: "AUTO" });
    expect(sent.slice(1).map((s) => s.tool)).toEqual(["record_tech_pack_draft", "record_review"]);
    expect((await getTechPackScreen(env.pm, env.tp)).draft?.output.review?.findings).toHaveLength(
      2,
    );
    const answer = await ai.askExpert(env.pm, env.tp, {
      question: "How much shrinkage should we allow on this piqué?",
    });
    expect(answer.expert).toMatch(/^X\d\d$/);
    await ai.runReviewBoard(env.pm, env.tp, {});
    screen = await getTechPackScreen(env.pm, env.tp);
    expect(screen.answers.map((a) => a.kind).sort()).toEqual(["QUESTION", "REVIEW"]);
    expect(screen.answers.find((a) => a.kind === "QUESTION")?.detail?.actions).toEqual([
      "Ask the mill for a wash test",
    ]);
    expect(screen.approval.status).not.toBe("APPROVED");

    // The mill's report is read into the form, not saved as options.
    const colourId = screen.colours[0]!.id;
    const read = await ai.readLabDipReport(env.pm, env.tp, colourId, {}, photo());
    expect(read.options.map((o) => o.letter)).toEqual(["A", "B"]);
    expect(await prisma.labDipOption.count()).toBe(0);
    // A colour from a photo is only an approximate suggestion.
    await ai.estimateColourFromPhoto(env.pm, env.tp, colourId, {}, photo());
    const navy = (await getTechPackScreen(env.pm, env.tp)).colours[0]!;
    expect(navy).toMatchObject({ code: "19-4052 TCX", codeSource: "IMAGE_ESTIMATE" });
    expect(navy.report).not.toBeNull();
    expect(navy.estimate?.confidence).toBe("low");
    // Saved unchanged it stays approximate; the buyer's own code replaces it.
    await files.saveColour(env.pm, env.tp, colourId, { name: "Navy", code: "19-4052 TCX" });
    expect((await getTechPackScreen(env.pm, env.tp)).colours[0]!.codeSource).toBe("IMAGE_ESTIMATE");
    await files.saveColour(env.pm, env.tp, colourId, { name: "Navy", code: "19-3933 TCX" });
    expect((await getTechPackScreen(env.pm, env.tp)).colours[0]).toMatchObject({
      code: "19-3933 TCX",
      codeSource: "BUYER",
    });

    // People without production.manage cannot ask the AI.
    await expectAppError(
      ai.askExpert(env.store, env.tp, { question: "Is this fine?" }),
      "FORBIDDEN",
    );
    // Every call is in the cost log against the style.
    const usage = await prisma.aiUsage.findMany({ select: { recordId: true, task: true } });
    expect(new Set(usage.map((u) => u.recordId))).toEqual(new Set([env.polo.id]));
    expect(usage.length).toBe(sent.length);
    // What the AI wrote is marked AI in the log; a person's decision on a line is not.
    const log = await prisma.auditLog.findMany({
      where: { entityType: "ProductionProject", entityId: env.polo.id },
      select: { summary: true, byAi: true },
    });
    const marked = (pattern: RegExp) => log.filter((a) => pattern.test(a.summary ?? ""));
    expect(marked(/AI drafted the tech pack/).every((a) => a.byAi)).toBe(true);
    expect(marked(/AI drafted the tech pack/)).toHaveLength(2);
    expect(marked(/review board found/).every((a) => a.byAi)).toBe(true);
    expect(marked(/approx\. colour from a photo/).every((a) => a.byAi)).toBe(true);
    expect(
      log.filter((a) => !a.byAi && /AI drafted|review board|approx\./.test(a.summary ?? "")),
    ).toEqual([]);

    // What the AI made is saved under its own account, never the person's (v6.4, A11);
    // the person who asked is named in the log.
    const account = await aiAccountOf(env.company.id);
    const drafts = await prisma.techPackAiDraft.findMany({ select: { createdById: true } });
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.createdById === account.id)).toBe(true);
    const aiRows = await prisma.auditLog.findMany({
      where: { summary: { contains: "AI drafted the tech pack" } },
      select: { userId: true, byAi: true, summary: true },
    });
    expect(aiRows).toHaveLength(2);
    for (const row of aiRows) {
      expect(row).toMatchObject({ userId: account.id, byAi: true });
      expect(row.summary).toMatch(/\(asked by pm\)$/);
    }
    const others = await prisma.auditLog.findMany({
      where: { summary: { contains: "review board found" } },
      select: { userId: true, byAi: true, summary: true },
    });
    expect(others.length).toBeGreaterThan(0);
    for (const row of others) {
      expect(row).toMatchObject({ userId: account.id, byAi: true });
      expect(row.summary).toMatch(/\(asked by pm\)$/);
    }
    const shown = (await getTechPackScreen(env.pm, env.tp)).draft!;
    expect(shown).toMatchObject({ createdBy: account.name, askedBy: "pm" });
    // An expert's answer and the review board's findings: written by the AI, asked by pm.
    const answers = await prisma.techPackExpertAnswer.findMany({
      select: { kind: true, createdById: true, askedById: true },
    });
    expect(answers.map((a) => a.kind).sort()).toEqual(["QUESTION", "REVIEW"]);
    for (const a of answers) {
      expect(a, a.kind).toMatchObject({ createdById: account.id, askedById: env.pm.user.id });
    }
  });

  it("gives the answers kept before v6.4 their company's AI account as the author", async () => {
    const account = await aiAccountOf(env.company.id);
    const old = await prisma.techPackExpertAnswer.create({
      data: {
        companyId: env.company.id,
        techPackId: env.tp,
        expert: "X10",
        kind: "QUESTION",
        question: "How much shrinkage?",
        answer: "5% in length",
        model: "claude-sonnet-5-5",
        askedById: env.pm.user.id,
      },
    });
    expect(old.createdById).toBeNull();
    const sql = await readFile(
      path.join(
        process.cwd(),
        "prisma/migrations/20261214090000_tech_pack_expert_author/migration.sql",
      ),
      "utf8",
    );
    const backfill = sql.slice(sql.indexOf('UPDATE "TechPackExpertAnswer"'));
    await prisma.$executeRawUnsafe(backfill);
    expect(
      await prisma.techPackExpertAnswer.findUniqueOrThrow({
        where: { id: old.id },
        select: { createdById: true, askedById: true },
      }),
    ).toEqual({ createdById: account.id, askedById: env.pm.user.id });
  });

  it("approves the tech pack once nothing is red", async () => {
    await spec.makeChart(env.pm, env.tp, CHART);
    const { id: logoId } = await files.saveLogo(env.pm, env.tp, null, {
      name: "Chest logo",
      widthMm: "27",
    });
    await expectAppError(
      approveTechPack(env.owner, env.polo.id),
      "CONFLICT",
      /Logo without the owner's tick/,
    );
    await files.uploadLogoFile(
      env.pm,
      env.tp,
      logoId,
      { kind: "MACHINE", source: "FACTORY_PUNCHER" },
      dst(),
    );
    await files.uploadLogoFile(env.pm, env.tp, logoId, { kind: "SEW_OUT" }, photo());
    await files.tickLogo(env.owner, env.tp, logoId);
    const approved = await approveTechPack(env.owner, env.polo.id);
    expect(approved.status).toBe("APPROVED");
    const screen = await getTechPackScreen(env.pm, env.tp);
    expect(screen.completeness).toBeGreaterThan(0);
  });

  it("takes a photo shared from the phone and opens Save to Tech Pack with it", async () => {
    const post = (form: FormData, site = "none") =>
      share(
        new Request("https://erp.example.test/api/production/share", {
          method: "POST",
          headers: { "sec-fetch-site": site },
          body: form,
        }),
      );
    const form = () => {
      const f = new FormData();
      f.set("title", "Polo button");
      f.set("text", "Nice MOP button https://www.etsy.com/listing/42");
      f.set(
        "photo",
        new File([new Uint8Array(photo().bytes)], "button.png", { type: "image/png" }),
      );
      return f;
    };
    // Not signed in: to sign-in, then back to the page with the link and text.
    let response = await post(form());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(/\/sign-in\?next=%2Fproduction%2Fsave%3F/);
    expect(await prisma.fileAsset.count()).toBe(0);
    // A form on another site cannot post here.
    signedIn.ctx = env.pm;
    response = await post(form(), "cross-site");
    expect(response.status).toBe(403);
    expect(await prisma.fileAsset.count()).toBe(0);

    response = await post(form());
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/production/save");
    expect(location.searchParams.get("title")).toBe("Polo button");
    const fileId = location.searchParams.get("file")!;
    expect(await prisma.fileAsset.findUnique({ where: { id: fileId } })).toMatchObject({
      uploadedById: env.pm.user.id,
      mimeType: "image/png",
    });
    // Saved to the style from the page.
    await files.addReference(env.pm, env.tp, { sharedFileId: fileId, note: "MOP button" });
    expect((await getTechPackScreen(env.pm, env.tp)).references[0]?.file?.id).toBe(fileId);
    // Someone who cannot change production keeps nothing.
    signedIn.ctx = env.store;
    response = await post(form());
    expect(new URL(response.headers.get("location")!).searchParams.get("file")).toBeNull();
    expect(await prisma.fileAsset.count()).toBe(1);
  });
});
