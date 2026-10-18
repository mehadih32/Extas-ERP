"use server";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import { formFields, MAX_UPLOAD_BYTES } from "@/modules/files/file.service";
import * as ai from "@/modules/production/tech-pack-ai.service";
import { TECH_PACK_READ } from "@/modules/production/tech-pack-access";
import * as approval from "@/modules/production/tech-pack-approval.service";
import * as files from "@/modules/production/tech-pack-files.service";
import * as register from "@/modules/production/tech-pack-register.service";
import * as screen from "@/modules/production/tech-pack-screen.service";
import * as spec from "@/modules/production/tech-pack-spec.service";

/*
 * Tech packs (/tech-packs, and a style's own from /production/projects/:id).
 * Each returns { ok: true, data } or { ok: false, error }.
 *   production.view            the list, a tech pack's screen, a project's tech pack
 *                              (also production.techpack.approve and
 *                              production.logo.approve, who need the page to
 *                              approve it or tick its logos: TECH_PACK_READ)
 *   production.manage          a new tech pack, its details and links, the chart,
 *                              instructions, AI draft, experts and review board,
 *                              references, logos and colours
 *   production.techpack.approve  locking the fabric part and approving
 *   production.logo.approve    the owner's logo tick
 * An AI action the owner wants to be asked about first fails with
 * error.fieldErrors.aiAskFirst; sending it again with costOk goes on.
 */

const view = () => requireAnyPermission(...TECH_PACK_READ);
const manage = () => requirePermission("production.manage");
const tick = () => requirePermission("production.logo.approve");
const approve = () => requirePermission("production.techpack.approve");

/** Refreshes the tech pack pages and the projects' pages (their tech pack panel). */
function refresh(techPackId?: string) {
  revalidatePath("/tech-packs");
  if (techPackId) revalidatePath(`/tech-packs/${techPackId}`);
  revalidatePath("/production/projects/[projectId]", "page");
  revalidatePath("/production/projects/[projectId]/tech-pack", "page");
}

/** Runs a change to a tech pack and refreshes its pages. */
const change = <T>(techPackId: string, work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    refresh(techPackId);
    return result;
  });

/** The optional `file` of a form, as an upload. */
async function optionalFile(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION", "Files can be up to 10 MB.");
  return { fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) };
}

async function requiredFile(form: FormData) {
  const upload = await optionalFile(form);
  if (!upload) throw new AppError("VALIDATION", "Choose a file to upload.");
  return upload;
}

/** The `files` of a form (the New tech pack references), as uploads. */
async function manyFiles(form: FormData) {
  const chosen = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (chosen.length > register.MAX_START_FILES) {
    throw new AppError("VALIDATION", `Add at most ${register.MAX_START_FILES} files at once.`);
  }
  const uploads = [];
  for (const file of chosen) {
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION", "Files can be up to 10 MB.");
    uploads.push({ fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
  }
  return uploads;
}

const costOkOf = (form: FormData) => form.get("costOk") === "true";

// ---------------------------------------------------------------- the list, new, details, links

export const listTechPacksAction = async (query: unknown) =>
  runAction(async () => register.listTechPacks(await view(), query));

/** New tech pack: title, buyer, style, season, the buyer's brief, a link and reference `files`. */
export const createTechPackAction = async (form: FormData) =>
  runAction(async () => {
    const ctx = await manage();
    const fields = Object.fromEntries(
      ["title", "buyerId", "styleId", "season", "brief", "link"].map((k) => [
        k,
        typeof form.get(k) === "string" ? (form.get(k) as string) : undefined,
      ]),
    );
    const made = await register.createTechPack(
      ctx,
      fields,
      await manyFiles(form),
      await getRequestMeta(),
    );
    refresh(made.id);
    return made;
  });

export const getTechPackScreenAction = async (techPackId: string) =>
  runAction(async () => screen.getTechPackScreen(await view(), techPackId));

export const updateTechPackDetailsAction = async (techPackId: string, input: unknown) =>
  change(techPackId, async () =>
    register.updateTechPackDetails(await manage(), techPackId, input, await getRequestMeta()),
  );
export const linkTechPackToProjectAction = async (techPackId: string, input: unknown) =>
  change(techPackId, async () =>
    register.linkTechPackToProject(await manage(), techPackId, input, await getRequestMeta()),
  );
export const linkTechPackToStyleAction = async (techPackId: string, input: unknown) =>
  change(techPackId, async () =>
    register.linkTechPackToStyle(await manage(), techPackId, input, await getRequestMeta()),
  );

/** A style in production's tech pack: its id, or whether one can be started or linked. */
export const getProjectTechPackAction = async (projectId: string) =>
  runAction(async () => register.getProjectTechPackStart(await view(), projectId));
export const startProjectTechPackAction = async (projectId: string) =>
  runAction(async () => {
    const made = await register.startProjectTechPack(
      await manage(),
      projectId,
      await getRequestMeta(),
    );
    refresh(made.id);
    return made;
  });

export const findLinkableProjectsAction = async (search: string) =>
  runAction(async () => register.findLinkableProjects(await manage(), search));
export const findLinkableTechPacksAction = async (search: string) =>
  runAction(async () => register.findLinkableTechPacks(await manage(), search));
export const findTechPackBuyersAction = async (search: string) =>
  runAction(async () => register.findTechPackBuyers(await manage(), search));
export const findTechPackStylesAction = async (search: string) =>
  runAction(async () => register.findTechPackStyles(await manage(), search));

/** Locks the fabric part of the tech pack's style in production (from the tech pack's page). */
export const lockFabricPartOfAction = async (techPackId: string) =>
  change(techPackId, async () => {
    await approval.lockFabricPartOf(await approve(), techPackId, await getRequestMeta());
    return { id: techPackId };
  });
/** Approves the tech pack for its style in production (from the tech pack's page). */
export const approveTechPackOfAction = async (techPackId: string) =>
  change(techPackId, async () => {
    await approval.approveTechPackOf(await approve(), techPackId, await getRequestMeta());
    return { id: techPackId };
  });

// ---------------------------------------------------------------- chart and instructions

export const makeChartAction = async (techPackId: string, input: unknown) =>
  change(techPackId, async () => {
    const chart = await spec.makeChart(await manage(), techPackId, input, await getRequestMeta());
    return { rows: chart.rows.length };
  });
export const setMeasurementAction = async (techPackId: string, input: unknown) =>
  change(techPackId, async () => {
    await spec.setMeasurement(await manage(), techPackId, input, await getRequestMeta());
    return { id: techPackId };
  });
export const confirmMeasurementRowAction = async (techPackId: string, code: string) =>
  change(techPackId, async () => {
    await spec.confirmMeasurementRow(await manage(), techPackId, code, await getRequestMeta());
    return { id: techPackId };
  });
export const addMeasurementRowAction = async (techPackId: string, input: unknown) =>
  change(techPackId, async () => {
    await spec.addMeasurementRow(await manage(), techPackId, input, await getRequestMeta());
    return { id: techPackId };
  });
export const removeMeasurementRowAction = async (techPackId: string, code: string) =>
  change(techPackId, async () => {
    await spec.removeMeasurementRow(await manage(), techPackId, code, await getRequestMeta());
    return { id: techPackId };
  });
export const setInstructionsAction = async (techPackId: string, input: unknown) =>
  change(techPackId, async () =>
    spec.setInstructions(await manage(), techPackId, input, await getRequestMeta()),
  );

// ---------------------------------------------------------------- AI

export const draftTechPackAction = async (techPackId: string, input: unknown) =>
  change(techPackId, async () => ai.draftTechPack(await manage(), techPackId, input));
export const decideDraftLineAction = async (techPackId: string, draftId: string, input: unknown) =>
  change(techPackId, async () =>
    ai.decideDraftLine(await manage(), techPackId, draftId, input, await getRequestMeta()),
  );
export const askExpertAction = async (techPackId: string, input: unknown) =>
  change(techPackId, async () => ai.askExpert(await manage(), techPackId, input));
export const runReviewBoardAction = async (techPackId: string, input: unknown) =>
  change(techPackId, async () => ai.runReviewBoard(await manage(), techPackId, input));
/** The mill's report read by the AI into options for the form (not saved as options). */
export const readLabDipReportAction = async (
  techPackId: string,
  colourId: string,
  form: FormData,
) =>
  change(techPackId, async () =>
    ai.readLabDipReport(
      await manage(),
      techPackId,
      colourId,
      { costOk: costOkOf(form) },
      await requiredFile(form),
      await getRequestMeta(),
    ),
  );
export const estimateColourAction = async (techPackId: string, colourId: string, form: FormData) =>
  change(techPackId, async () =>
    ai.estimateColourFromPhoto(
      await manage(),
      techPackId,
      colourId,
      { costOk: costOkOf(form) },
      await requiredFile(form),
      await getRequestMeta(),
    ),
  );

// ---------------------------------------------------------------- references

/** Save to Tech Pack: a photo (`file`), a link and a note (form fields). */
export const addReferenceAction = async (techPackId: string, form: FormData) =>
  change(techPackId, async () =>
    files.addReference(
      await manage(),
      techPackId,
      formFields(form),
      await optionalFile(form),
      await getRequestMeta(),
    ),
  );
export const removeReferenceAction = async (techPackId: string, referenceId: string) =>
  change(techPackId, async () =>
    files.removeReference(await manage(), techPackId, referenceId, await getRequestMeta()),
  );

/** Where Save to Tech Pack can save: tech packs not linked yet, and open styles in production. */
export const pickSaveTargetsAction = async (search: string) =>
  runAction(async () => register.pickSaveTargets(await manage(), search));

/**
 * Save to Tech Pack: a photo (`file`, or `sharedFileId`), a link and a note to
 * a tech pack, or to a style in production's own (started if it has none).
 */
export const saveToTechPackAction = async (
  target: { kind: "TECH_PACK" | "PROJECT"; id: string },
  form: FormData,
) =>
  runAction(async () => {
    const ctx = await manage();
    const techPackId = await register.techPackForSave(ctx, target);
    const saved = await files.addReference(
      ctx,
      techPackId,
      formFields(form),
      await optionalFile(form),
      await getRequestMeta(),
    );
    refresh(techPackId);
    return saved;
  });

// ---------------------------------------------------------------- logos

export const saveLogoAction = async (techPackId: string, logoId: string | null, input: unknown) =>
  change(techPackId, async () =>
    files.saveLogo(await manage(), techPackId, logoId, input, await getRequestMeta()),
  );
export const removeLogoAction = async (techPackId: string, logoId: string) =>
  change(techPackId, async () =>
    files.removeLogo(await manage(), techPackId, logoId, await getRequestMeta()),
  );
/** The artwork, a machine file or the sew-out photo: `file` with `kind`, `source` and `note`. */
export const uploadLogoFileAction = async (techPackId: string, logoId: string, form: FormData) =>
  change(techPackId, async () => {
    const result = await files.uploadLogoFile(
      await manage(),
      techPackId,
      logoId,
      formFields(form),
      await requiredFile(form),
      await getRequestMeta(),
    );
    return { id: result.id, verdict: result.check?.verdict ?? null, picture: result.picture };
  });
export const draftLogoFromVectorAction = async (techPackId: string, logoId: string) =>
  change(techPackId, async () => {
    const result = await files.draftLogoFromVector(
      await manage(),
      techPackId,
      logoId,
      await getRequestMeta(),
    );
    return { id: result.id, verdict: result.check.verdict, stitches: result.check.stitches };
  });
export const tickLogoAction = async (techPackId: string, logoId: string) =>
  change(techPackId, async () =>
    files.tickLogo(await tick(), techPackId, logoId, await getRequestMeta()),
  );
export const untickLogoAction = async (techPackId: string, logoId: string) =>
  change(techPackId, async () =>
    files.untickLogo(await tick(), techPackId, logoId, await getRequestMeta()),
  );

// ---------------------------------------------------------------- colours

export const saveColourAction = async (
  techPackId: string,
  colourId: string | null,
  input: unknown,
) =>
  change(techPackId, async () =>
    files.saveColour(await manage(), techPackId, colourId, input, await getRequestMeta()),
  );
export const removeColourAction = async (techPackId: string, colourId: string) =>
  change(techPackId, async () =>
    files.removeColour(await manage(), techPackId, colourId, await getRequestMeta()),
  );
export const addLabDipsAction = async (techPackId: string, colourId: string, input: unknown) =>
  change(techPackId, async () =>
    files.addLabDips(await manage(), techPackId, colourId, input, await getRequestMeta()),
  );
export const removeLabDipAction = async (techPackId: string, optionId: string) =>
  change(techPackId, async () =>
    files.removeLabDip(await manage(), techPackId, optionId, await getRequestMeta()),
  );
export const setLabDipStatusAction = async (techPackId: string, colourId: string, input: unknown) =>
  change(techPackId, async () =>
    files.setLabDipStatus(await manage(), techPackId, colourId, input, await getRequestMeta()),
  );
