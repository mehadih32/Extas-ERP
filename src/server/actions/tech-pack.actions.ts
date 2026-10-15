"use server";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import { formFields, MAX_UPLOAD_BYTES } from "@/modules/files/file.service";
import * as ai from "@/modules/production/tech-pack-ai.service";
import * as files from "@/modules/production/tech-pack-files.service";
import * as screen from "@/modules/production/tech-pack-screen.service";
import * as spec from "@/modules/production/tech-pack-spec.service";

/*
 * A style's tech pack (/production/projects/:id/tech-pack). Each returns
 * { ok: true, data } or { ok: false, error }.
 *   production.view            the tech pack screen
 *   production.manage          the chart, instructions, AI draft, experts and
 *                              review board, references, logos and colours
 *   production.logo.approve    the owner's logo tick
 * An AI action the owner wants to be asked about first fails with
 * error.fieldErrors.aiAskFirst; sending it again with costOk goes on.
 */

const view = () => requirePermission("production.view");
const manage = () => requirePermission("production.manage");
const tick = () => requirePermission("production.logo.approve");

const page = (projectId: string) => `/production/projects/${projectId}/tech-pack`;

/** Runs a change and refreshes the tech pack and the project page. */
const change = <T>(projectId: string, work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath(page(projectId));
    revalidatePath(`/production/projects/${projectId}`);
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

const costOkOf = (form: FormData) => form.get("costOk") === "true";

export const getTechPackScreenAction = async (projectId: string) =>
  runAction(async () => screen.getTechPackScreen(await view(), projectId));

// ---------------------------------------------------------------- chart and instructions

export const makeChartAction = async (projectId: string, input: unknown) =>
  change(projectId, async () => {
    const chart = await spec.makeChart(await manage(), projectId, input, await getRequestMeta());
    return { rows: chart.rows.length };
  });
export const setMeasurementAction = async (projectId: string, input: unknown) =>
  change(projectId, async () => {
    await spec.setMeasurement(await manage(), projectId, input, await getRequestMeta());
    return { id: projectId };
  });
export const confirmMeasurementRowAction = async (projectId: string, code: string) =>
  change(projectId, async () => {
    await spec.confirmMeasurementRow(await manage(), projectId, code, await getRequestMeta());
    return { id: projectId };
  });
export const addMeasurementRowAction = async (projectId: string, input: unknown) =>
  change(projectId, async () => {
    await spec.addMeasurementRow(await manage(), projectId, input, await getRequestMeta());
    return { id: projectId };
  });
export const removeMeasurementRowAction = async (projectId: string, code: string) =>
  change(projectId, async () => {
    await spec.removeMeasurementRow(await manage(), projectId, code, await getRequestMeta());
    return { id: projectId };
  });
export const setInstructionsAction = async (projectId: string, input: unknown) =>
  change(projectId, async () =>
    spec.setInstructions(await manage(), projectId, input, await getRequestMeta()),
  );

// ---------------------------------------------------------------- AI

export const draftTechPackAction = async (projectId: string, input: unknown) =>
  change(projectId, async () =>
    ai.draftTechPack(await manage(), projectId, input, await getRequestMeta()),
  );
export const decideDraftLineAction = async (projectId: string, draftId: string, input: unknown) =>
  change(projectId, async () =>
    ai.decideDraftLine(await manage(), projectId, draftId, input, await getRequestMeta()),
  );
export const askExpertAction = async (projectId: string, input: unknown) =>
  change(projectId, async () =>
    ai.askExpert(await manage(), projectId, input, await getRequestMeta()),
  );
export const runReviewBoardAction = async (projectId: string, input: unknown) =>
  change(projectId, async () =>
    ai.runReviewBoard(await manage(), projectId, input, await getRequestMeta()),
  );
/** The mill's report read by the AI into options for the form (not saved as options). */
export const readLabDipReportAction = async (projectId: string, colourId: string, form: FormData) =>
  change(projectId, async () =>
    ai.readLabDipReport(
      await manage(),
      projectId,
      colourId,
      { costOk: costOkOf(form) },
      await requiredFile(form),
      await getRequestMeta(),
    ),
  );
export const estimateColourAction = async (projectId: string, colourId: string, form: FormData) =>
  change(projectId, async () =>
    ai.estimateColourFromPhoto(
      await manage(),
      projectId,
      colourId,
      { costOk: costOkOf(form) },
      await requiredFile(form),
      await getRequestMeta(),
    ),
  );

// ---------------------------------------------------------------- references

/** Save to Tech Pack: a photo (`file`), a link and a note (form fields). */
export const addReferenceAction = async (projectId: string, form: FormData) =>
  change(projectId, async () =>
    files.addReference(
      await manage(),
      projectId,
      formFields(form),
      await optionalFile(form),
      await getRequestMeta(),
    ),
  );
export const removeReferenceAction = async (projectId: string, referenceId: string) =>
  change(projectId, async () =>
    files.removeReference(await manage(), projectId, referenceId, await getRequestMeta()),
  );

/** The open styles to save a reference to (the Save to Tech Pack page). */
export const pickTechPackProjectsAction = async (search: string) =>
  runAction(async () => {
    const ctx = await manage();
    const q = search.trim();
    const rows = await ctx.db.productionProject.findMany({
      where: {
        status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] },
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, code: true, name: true },
    });
    return rows;
  });

// ---------------------------------------------------------------- logos

export const saveLogoAction = async (projectId: string, logoId: string | null, input: unknown) =>
  change(projectId, async () =>
    files.saveLogo(await manage(), projectId, logoId, input, await getRequestMeta()),
  );
export const removeLogoAction = async (projectId: string, logoId: string) =>
  change(projectId, async () =>
    files.removeLogo(await manage(), projectId, logoId, await getRequestMeta()),
  );
/** The artwork, a machine file or the sew-out photo: `file` with `kind`, `source` and `note`. */
export const uploadLogoFileAction = async (projectId: string, logoId: string, form: FormData) =>
  change(projectId, async () => {
    const result = await files.uploadLogoFile(
      await manage(),
      projectId,
      logoId,
      formFields(form),
      await requiredFile(form),
      await getRequestMeta(),
    );
    return { id: result.id, verdict: result.check?.verdict ?? null, picture: result.picture };
  });
export const draftLogoFromVectorAction = async (projectId: string, logoId: string) =>
  change(projectId, async () => {
    const result = await files.draftLogoFromVector(
      await manage(),
      projectId,
      logoId,
      await getRequestMeta(),
    );
    return { id: result.id, verdict: result.check.verdict, stitches: result.check.stitches };
  });
export const tickLogoAction = async (projectId: string, logoId: string) =>
  change(projectId, async () =>
    files.tickLogo(await tick(), projectId, logoId, await getRequestMeta()),
  );
export const untickLogoAction = async (projectId: string, logoId: string) =>
  change(projectId, async () =>
    files.untickLogo(await tick(), projectId, logoId, await getRequestMeta()),
  );

// ---------------------------------------------------------------- colours

export const saveColourAction = async (
  projectId: string,
  colourId: string | null,
  input: unknown,
) =>
  change(projectId, async () =>
    files.saveColour(await manage(), projectId, colourId, input, await getRequestMeta()),
  );
export const removeColourAction = async (projectId: string, colourId: string) =>
  change(projectId, async () =>
    files.removeColour(await manage(), projectId, colourId, await getRequestMeta()),
  );
export const addLabDipsAction = async (projectId: string, colourId: string, input: unknown) =>
  change(projectId, async () =>
    files.addLabDips(await manage(), projectId, colourId, input, await getRequestMeta()),
  );
export const removeLabDipAction = async (projectId: string, optionId: string) =>
  change(projectId, async () =>
    files.removeLabDip(await manage(), projectId, optionId, await getRequestMeta()),
  );
export const setLabDipStatusAction = async (projectId: string, colourId: string, input: unknown) =>
  change(projectId, async () =>
    files.setLabDipStatus(await manage(), projectId, colourId, input, await getRequestMeta()),
  );
