import type { Prisma } from "@prisma/client";

import { localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { aiOn } from "@/modules/ai/claude";
import { EXPERTS } from "@/modules/ai/experts";
import type { CompanyContext } from "@/modules/auth/context";
import { adviseRounds, checkOption, visualOnly } from "@/modules/production/colour-check";
import type { FileCheck } from "@/modules/production/logo-files";
import { chartSignals } from "@/modules/production/measurements";
import {
  type ColourEstimate,
  type DraftOutput,
  type ExpertAnswer,
  readDraft,
  type ReviewOutput,
} from "@/modules/production/tech-pack-ai.service";
import { getTechPack } from "@/modules/production/tech-pack-approval.service";
import { techPackGaps } from "@/modules/production/tech-pack-gaps";
import {
  getChart,
  INSTRUCTION_SECTIONS,
  loadTechPackProject,
  readInstructions,
} from "@/modules/production/tech-pack-spec.service";

/*
 * A style's tech pack screen: its approval, the measurement chart, the
 * owner's instructions and the latest AI draft, saved references, logos,
 * colours with their lab dips, expert answers and review board findings,
 * the completeness % and the red gaps that keep it from being approved.
 * Plain values only (no Decimals), read with production.view.
 */

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const fileLink = (f: { id: string; fileName: string; mimeType: string } | null) =>
  f ? { id: f.id, fileName: f.fileName, mimeType: f.mimeType } : null;

export async function getTechPackScreen(ctx: CompanyContext, projectId: string) {
  const project = await loadTechPackProject(ctx, projectId);
  const [approval, chart, row, on, gaps] = await Promise.all([
    getTechPack(ctx, project.id),
    getChart(ctx, project.id),
    ctx.db.techPack.findUnique({
      where: { projectId: project.id },
      select: {
        instructions: true,
        references: {
          orderBy: { createdAt: "desc" },
          include: {
            file: { select: { id: true, fileName: true, mimeType: true } },
            savedBy: { select: { name: true } },
          },
        },
        logos: {
          orderBy: { createdAt: "asc" },
          include: {
            artworkFile: { select: { id: true, fileName: true, mimeType: true } },
            machineFile: { select: { id: true, fileName: true, mimeType: true } },
            sewOutFile: { select: { id: true, fileName: true, mimeType: true } },
            tickedBy: { select: { name: true } },
          },
        },
        colours: {
          orderBy: { createdAt: "asc" },
          include: {
            options: { orderBy: [{ round: "asc" }, { letter: "asc" }] },
            reportFile: { select: { id: true, fileName: true, mimeType: true } },
          },
        },
        aiDrafts: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { createdBy: { select: { name: true } } },
        },
        expertAnswers: {
          orderBy: { createdAt: "desc" },
          take: 12,
          include: { askedBy: { select: { name: true } } },
        },
      },
    }),
    aiOn(ctx.company.id),
    // The style was found through the company's own client; its gaps are read with it too.
    techPackGaps(prisma, project.id),
  ]);

  const logos = (row?.logos ?? []).map((l) => {
    const check = (l.fileCheck as unknown as FileCheck | null) ?? null;
    const signal = l.tickedAt ? "green" : l.machineFileId && l.sewOutFileId ? "yellow" : "red";
    return {
      id: l.id,
      name: l.name,
      placement: l.placement,
      widthMm: num(l.widthMm),
      heightMm: num(l.heightMm),
      threads: l.threads,
      colours: l.colours,
      fabric: l.fabric,
      approvedStitches: l.approvedStitches,
      reference: l.reference,
      source: l.source,
      machineFormat: l.machineFormat,
      check,
      artwork: fileLink(l.artworkFile),
      machineFile: fileLink(l.machineFile),
      sewOut: fileLink(l.sewOutFile),
      sewOutNote: l.sewOutNote,
      tickedOn: l.tickedAt ? localDay(l.tickedAt, ctx.company.timezone) : null,
      tickedBy: l.tickedBy?.name ?? null,
      signal: signal as "green" | "yellow" | "red",
    };
  });

  const colours = (row?.colours ?? []).map((c) => {
    const limit = Number(c.deltaLimit);
    const options = c.options.map((o) => {
      const plain = {
        id: o.id,
        round: o.round,
        letter: o.letter,
        light: o.light,
        deltaE: Number(o.deltaE),
        dl: num(o.dl),
        dc: num(o.dc),
        dh: num(o.dh),
        mi: num(o.mi),
        readByAi: o.readByAi,
        note: o.note,
      };
      return { ...plain, check: checkOption(plain, limit) };
    });
    const advice = adviseRounds(options, limit, c.name);
    const settled = c.status !== "OPEN";
    const signal = settled
      ? "green"
      : visualOnly(c.name) || advice.send.length > 0
        ? "yellow"
        : "red";
    return {
      id: c.id,
      name: c.name,
      code: c.code,
      codeSource: c.codeSource,
      estimate: (c.photoEstimate as unknown as ColourEstimate | null) ?? null,
      deltaLimit: limit,
      primaryLight: c.primaryLight,
      secondaryLight: c.secondaryLight,
      status: c.status,
      approvedOption: c.approvedOption,
      report: fileLink(c.reportFile),
      visualOnly: visualOnly(c.name),
      options,
      advice,
      signal: signal as "green" | "yellow" | "red",
    };
  });

  const latest = row?.aiDrafts[0] ?? null;
  const draft = latest
    ? {
        id: latest.id,
        mode: latest.mode,
        model: latest.model,
        day: localDay(latest.createdAt, ctx.company.timezone),
        createdBy: latest.createdBy?.name ?? null,
        output: readDraft(latest.output) as DraftOutput,
      }
    : null;

  const answers = (row?.expertAnswers ?? []).map((a) => ({
    id: a.id,
    expert: a.expert,
    kind: a.kind,
    question: a.question,
    answer: a.answer,
    detail: a.kind === "QUESTION" ? ((a.findings as unknown as ExpertAnswer | null) ?? null) : null,
    findings:
      a.kind === "REVIEW" ? ((a.findings as unknown as ReviewOutput["findings"] | null) ?? []) : [],
    askedBy: a.askedBy?.name ?? null,
    day: localDay(a.createdAt, ctx.company.timezone),
  }));

  // Completeness: the share of green among everything that carries a signal.
  const cells = chartSignals(chart.rows);
  const lines = draft?.output?.lines ?? [];
  const lineGreen = lines.filter((l) => l.decision || l.signal === "green").length;
  const lineRed = lines.filter((l) => !l.decision && l.signal === "red").length;
  const tally = {
    green:
      cells.green +
      lineGreen +
      logos.filter((l) => l.signal === "green").length +
      colours.filter((c) => c.signal === "green").length,
    yellow:
      cells.yellow +
      (lines.length - lineGreen - lineRed) +
      logos.filter((l) => l.signal === "yellow").length +
      colours.filter((c) => c.signal === "yellow").length,
    red:
      cells.red +
      lineRed +
      logos.filter((l) => l.signal === "red").length +
      colours.filter((c) => c.signal === "red").length,
  };
  const total = tally.green + tally.yellow + tally.red;
  const may = ctx.can("production.manage");
  const open = !["COMPLETED", "CANCELLED"].includes(project.status);

  return {
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      style: project.style,
      buyer: project.buyer?.name ?? null,
    },
    approval,
    chart,
    instructions: readInstructions(row?.instructions),
    instructionSections: INSTRUCTION_SECTIONS,
    draft,
    references: (row?.references ?? []).map((r) => ({
      id: r.id,
      link: r.link,
      note: r.note,
      file: fileLink(r.file),
      savedBy: r.savedBy?.name ?? null,
      day: localDay(r.createdAt, ctx.company.timezone),
    })),
    logos,
    colours,
    answers,
    experts: EXPERTS.map((e) => ({ id: e.id, name: e.name })),
    signals: tally,
    completeness: total === 0 ? 0 : Math.round((tally.green / total) * 100),
    gaps,
    aiOn: on,
    can: {
      edit: may && open,
      ai: may && open && on,
      tick: ctx.can("production.logo.approve"),
    },
  };
}

export type TechPackScreen = Awaited<ReturnType<typeof getTechPackScreen>>;
