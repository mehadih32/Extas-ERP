import type { BackgroundJob, Company, Prisma } from "@prisma/client";

import { ASSET_KIND_WORDS, ASSET_RETURN_WORDS } from "@/components/hr/asset-labels";
import { dateOnly, localDay } from "@/lib/dates";
import { formatAmount, formatDay } from "@/lib/format";
import { PDF_MIME } from "@/lib/pdf";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/audit.service";
import { loadPrintLogo } from "@/modules/companies/logo.service";
import { letterheadOf } from "@/modules/documents/builders";
import { documentFileName, type PrintDocument } from "@/modules/documents/model";
import { renderDocumentPdf } from "@/modules/documents/render";
import { deleteStoredFile, writeGeneratedFile } from "@/modules/files/file.service";
import { type ClearanceFigures, clearanceFigures } from "@/modules/hr/exit.service";
import { tenureOn, tenureText } from "@/modules/hr/tenure";

/*
 * The experience and clearance certificate, made by the background queue
 * ("exit.certificate" jobs, jobs/handlers.ts) when HR deactivates someone (or
 * asks for it again): on the company letterhead, who they are, when they
 * worked here and for how long, the company items they held and gave back,
 * and what money was still to settle either way that day. The PDF is locked
 * against editing and kept in the employee's papers (kind CLEARANCE).
 */

const employeeSelect = {
  id: true,
  code: true,
  name: true,
  designation: true,
  department: true,
  joinDate: true,
  exitDate: true,
  status: true,
  userId: true,
} satisfies Prisma.EmployeeSelect;

type Leaver = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;

type Returned = {
  name: string;
  kind: keyof typeof ASSET_KIND_WORDS;
  tag: string | null;
  issuedOn: Date;
  returnedOn: Date | null;
  returnCondition: "GOOD" | "DAMAGED" | "LOST" | null;
};

const day = (d: Date | string) => formatDay(typeof d === "string" ? d : dateOnly(d));

/** The printed certificate for one leaver on `madeOn`. */
export function certificateDocument(
  company: Company,
  e: Leaver,
  items: Returned[],
  money: Omit<ClearanceFigures, "items">,
  madeOn: string,
): PrintDocument {
  const joined = dateOnly(e.joinDate);
  const left = e.exitDate ? dateOnly(e.exitDate) : madeOn;
  // Counted up to and including the last working day.
  const through = new Date(`${left}T00:00:00Z`);
  through.setUTCDate(through.getUTCDate() + 1);
  const tenure = tenureText(tenureOn(joined, through.toISOString().slice(0, 10)));
  const role = [e.designation, e.department ? `in ${e.department}` : null]
    .filter(Boolean)
    .join(" ");
  const companyName = company.legalName ?? company.name;
  const amount = (v: string) => formatAmount(v, 2, company.currency);
  const none = (v: string) => Number(v) === 0;
  const dues = [
    {
      label: "Salary still to pay them",
      text: none(money.salaryOwed) ? "Nothing" : amount(money.salaryOwed),
    },
    {
      label: "Advances they still owe",
      text: none(money.advancesOwed) ? "Nothing" : amount(money.advancesOwed),
    },
    {
      label: "Claims still to pay them",
      text: none(money.claimsOwed)
        ? money.claimsWaiting > 0
          ? `Nothing approved yet; ${money.claimsWaiting} waiting for Accounts`
          : "Nothing"
        : amount(money.claimsOwed),
    },
    ...(money.finalPayrollMissing
      ? [
          {
            label: "Final salary",
            text: `Comes with the ${money.finalPayrollMissing} payroll, not approved yet`,
          },
        ]
      : []),
  ];
  const settled =
    none(money.salaryOwed) &&
    none(money.advancesOwed) &&
    none(money.claimsOwed) &&
    money.claimsWaiting === 0 &&
    !money.finalPayrollMissing;
  return {
    type: "CLEARANCE_CERTIFICATE",
    title: "Experience & Clearance Certificate",
    subtitle: e.name,
    reference: `${e.code} · ${left}`,
    letterhead: letterheadOf(company),
    meta: [
      { label: "Issued", value: day(madeOn) },
      { label: "Employee code", value: e.code },
      { label: "Last working day", value: day(left) },
    ],
    parties: [
      {
        heading: "Employee",
        lines: [e.name, `Employee code: ${e.code}`, ...(role ? [role] : [])],
      },
      {
        heading: "Employment",
        lines: [`Joined: ${day(joined)}`, `Last working day: ${day(left)}`, `With us: ${tenure}`],
      },
    ],
    blocks: [
      {
        kind: "text",
        title: "To whom it may concern",
        paragraphs: [
          `This is to certify that ${e.name} (employee code ${e.code}) worked at ${companyName}${
            role ? ` as ${role}` : ""
          } from ${day(joined)} to ${day(left)}, a period of ${tenure}.`,
          items.length === 0
            ? "They held no company items."
            : items.every((i) => i.returnCondition !== "LOST")
              ? `They handed back every company item they held (${items.length}).`
              : "They handed back the company items they held, apart from those marked lost below, which are settled.",
          "We thank them for their work and wish them every success.",
        ],
      },
      {
        kind: "table",
        title: "Company items",
        columns: [
          { label: "Item", weight: 3 },
          { label: "Tag or serial", weight: 2 },
          { label: "Given", weight: 2 },
          { label: "Back", weight: 2 },
          { label: "", weight: 2 },
        ],
        rows: items.map((i) => ({
          cells: [
            i.name,
            i.tag ?? "",
            day(i.issuedOn),
            i.returnedOn ? day(i.returnedOn) : "",
            i.returnCondition ? ASSET_RETURN_WORDS[i.returnCondition] : "",
          ],
          details: [ASSET_KIND_WORDS[i.kind]],
        })),
        empty: "No company items were given to them.",
      },
      {
        kind: "list",
        title: settled ? "Dues: all settled" : `Dues on ${day(madeOn)}`,
        items: dues,
      },
      {
        kind: "note",
        text: `Made by Extas ERP from ${companyName}'s records on ${day(madeOn)}. This copy cannot be edited.`,
      },
    ],
    signatures: ["Human Resources", "Authorised signature"],
  };
}

/**
 * The "exit.certificate" job: makes the certificate and adds it to the
 * employee's papers. Safe to run again: a certificate made since the job was
 * asked for is kept and no second one is made.
 */
export async function runExitCertificateJob(
  job: Pick<BackgroundJob, "payload" | "createdAt">,
): Promise<void> {
  const payload = (job.payload ?? {}) as { employeeId?: unknown; requestedById?: unknown };
  if (typeof payload.employeeId !== "string") throw new Error("The job does not name an employee.");
  const employee = await prisma.employee.findUnique({
    where: { id: payload.employeeId },
    select: { ...employeeSelect, companyId: true, company: true },
  });
  if (!employee) return;
  const already = await prisma.employeeDocument.count({
    where: { employeeId: employee.id, kind: "CLEARANCE", createdAt: { gte: job.createdAt } },
  });
  if (already > 0) return;

  const company = employee.company;
  const madeOn = localDay(new Date(), company.timezone);
  const [figures, items] = await Promise.all([
    clearanceFigures(prisma, employee.companyId, employee),
    prisma.employeeAsset.findMany({
      where: { employeeId: employee.id },
      orderBy: { issuedOn: "asc" },
      select: {
        name: true,
        kind: true,
        tag: true,
        issuedOn: true,
        returnedOn: true,
        returnCondition: true,
      },
    }),
  ]);
  const model = certificateDocument(company, employee, items, figures, madeOn);
  const logo = await loadPrintLogo(employee.companyId);
  const bytes = await renderDocumentPdf(model, { logo: logo?.bytes ?? null, protect: true });
  const stored = await writeGeneratedFile(employee.companyId, "clearance", ".pdf", bytes);
  const label = `Experience and clearance - ${employee.code} ${employee.name}`;
  try {
    await prisma.$transaction(async (tx) => {
      const file = await tx.fileAsset.create({
        data: {
          companyId: employee.companyId,
          uploadedById: null,
          fileName: documentFileName(company.name, label),
          mimeType: PDF_MIME,
          sizeBytes: stored.sizeBytes,
          storagePath: stored.storagePath,
          checksum: stored.checksum,
        },
      });
      await tx.employeeDocument.create({
        data: {
          companyId: employee.companyId,
          employeeId: employee.id,
          kind: "CLEARANCE",
          title: `Experience and clearance certificate, ${formatDay(madeOn)}`,
          fileId: file.id,
          addedById: typeof payload.requestedById === "string" ? payload.requestedById : null,
        },
      });
    });
  } catch (error) {
    await deleteStoredFile(stored);
    throw error;
  }
  await recordAudit({
    companyId: employee.companyId,
    userId: null,
    action: "CREATE",
    entityType: "Employee",
    entityId: employee.id,
    summary: `Made the experience and clearance certificate for ${employee.code} ${employee.name}`,
  });
}
