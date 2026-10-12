import type { BackgroundJob, Company, Prisma } from "@prisma/client";

import { localDay, localTime } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import { PDF_MIME } from "@/lib/pdf";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/audit.service";
import { loadPrintLogo } from "@/modules/companies/logo.service";
import { letterheadOf } from "@/modules/documents/builders";
import { documentFileName, type PrintDocument } from "@/modules/documents/model";
import { renderDocumentPdf } from "@/modules/documents/render";
import { deleteStoredFile, writeGeneratedFile } from "@/modules/files/file.service";
import { maskedPhone, paragraphsOf, SIGN_METHOD_LABELS } from "@/modules/hr/terms";
import { textOfVersion } from "@/modules/hr/terms.service";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * The signed copy of the terms of employment, made by the background queue
 * ("terms.pdf" jobs, jobs/handlers.ts) after someone agrees: the terms as they
 * read them on the company letterhead, then the record of the agreement (name,
 * code and NID at that moment, the time, IP address and device, how they
 * agreed, the text's fingerprint) and the signature drawn on the screen. The
 * PDF is locked against editing and kept in the employee's papers (kind
 * TERMS), which only HR and the employee open.
 */

const acceptanceInclude = {
  version: true,
  company: true,
  employee: { select: { id: true, designation: true, department: true, userId: true } },
} satisfies Prisma.TermsAcceptanceInclude;

type Acceptance = Prisma.TermsAcceptanceGetPayload<{ include: typeof acceptanceInclude }>;

/** "12 Oct 2026 at 09:41 (Asia/Dhaka)". */
function whenText(at: Date, timezone: string): string {
  return `${formatDay(localDay(at, timezone))} at ${localTime(at, timezone)} (${timezone})`;
}

/** The printed document for one agreement. */
export function termsDocument(a: Acceptance, company: Company): PrintDocument {
  const text = textOfVersion(a.version);
  const tz = company.timezone;
  const how =
    a.method === "SMS_CODE"
      ? `${SIGN_METHOD_LABELS.SMS_CODE}${a.phone ? ` to ${maskedPhone(a.phone)}` : ""}`
      : SIGN_METHOD_LABELS.SIGNATURE;
  const signedAt = `${whenText(a.signedAt, tz)} · ${a.signedAt.toISOString()}`;
  const role = [a.employee.designation, a.employee.department].filter(Boolean).join(", ");
  return {
    type: "SIGNED_TERMS",
    title: "Terms of employment",
    subtitle: `Signed copy · version ${a.version.version}`,
    reference: `Terms v${a.version.version} · ${a.codeAtSigning}`,
    letterhead: letterheadOf(company),
    meta: [
      { label: "Version", value: String(a.version.version) },
      {
        label: "Published",
        value: a.version.publishedAt ? formatDay(localDay(a.version.publishedAt, tz)) : "",
      },
      { label: "Agreed", value: formatDay(localDay(a.signedAt, tz)) },
    ],
    parties: [
      {
        heading: "Employee",
        lines: [
          a.nameAtSigning,
          `Employee code: ${a.codeAtSigning}`,
          `NID: ${a.nidAtSigning ?? "Not on file"}`,
          ...(role ? [role] : []),
        ],
      },
      {
        heading: "Agreed",
        lines: [how, whenText(a.signedAt, tz), `IP address: ${a.ipAddress ?? "Not known"}`],
      },
    ],
    blocks: [
      ...(text.intro
        ? [{ kind: "text" as const, title: text.title, paragraphs: paragraphsOf(text.intro) }]
        : []),
      ...text.sections.map((s) => ({
        kind: "text" as const,
        title: s.title,
        paragraphs: paragraphsOf(s.body),
      })),
      {
        kind: "list",
        title: "Record of agreement",
        items: [
          { label: "Name", text: a.nameAtSigning },
          { label: "Employee code", text: a.codeAtSigning },
          { label: "NID", text: a.nidAtSigning ?? "Not on file" },
          { label: "Agreed on", text: signedAt },
          { label: "IP address", text: a.ipAddress ?? "Not known" },
          { label: "Device", text: a.userAgent ?? "Not known" },
          { label: "How", text: how },
          { label: "Text fingerprint (SHA-256)", text: a.textHash },
        ],
      },
      {
        kind: "note",
        text: `${a.nameAtSigning} read these terms to the end in Extas ERP and agreed to them. This copy was made by the app at that moment and cannot be edited. The fingerprint identifies the exact text they read: any change to the text gives a different fingerprint.`,
      },
    ],
    signatures: [a.method === "SIGNATURE" ? a.nameAtSigning : `${a.nameAtSigning} (by SMS code)`],
  };
}

/** The PDF bytes for one agreement, on the company letterhead. */
export async function renderTermsPdf(
  a: Acceptance,
  options: { logo?: Buffer | null; compress?: boolean } = {},
): Promise<Buffer> {
  const model = termsDocument(a, a.company);
  const signed = new Map<string, Buffer>();
  if (a.signature) signed.set(model.signatures[0]!, Buffer.from(a.signature));
  return renderDocumentPdf(model, {
    logo: options.logo ?? null,
    signed,
    protect: true,
    compress: options.compress,
  });
}

/**
 * The "terms.pdf" job: makes the signed copy and adds it to the employee's
 * papers. Safe to run again: an agreement that already has its copy (or no
 * longer exists) is left as it is.
 */
export async function runTermsPdfJob(job: Pick<BackgroundJob, "payload">): Promise<void> {
  const acceptanceId = (job.payload as { acceptanceId?: unknown } | null)?.acceptanceId;
  if (typeof acceptanceId !== "string") throw new Error("The job does not name an agreement.");
  const acceptance = await prisma.termsAcceptance.findUnique({
    where: { id: acceptanceId },
    include: acceptanceInclude,
  });
  if (!acceptance || acceptance.documentId) return;

  const logo = await loadPrintLogo(acceptance.companyId);
  const bytes = await renderTermsPdf(acceptance, { logo: logo?.bytes ?? null });
  const stored = await writeGeneratedFile(acceptance.companyId, "terms", ".pdf", bytes);
  const label = `Terms v${acceptance.version.version} - ${acceptance.codeAtSigning} ${acceptance.nameAtSigning}`;
  let made = false;
  try {
    made = await prisma.$transaction(async (tx) => {
      const file = await tx.fileAsset.create({
        data: {
          companyId: acceptance.companyId,
          uploadedById: null,
          fileName: documentFileName(acceptance.company.name, label),
          mimeType: PDF_MIME,
          sizeBytes: stored.sizeBytes,
          storagePath: stored.storagePath,
          checksum: stored.checksum,
        },
      });
      const document = await tx.employeeDocument.create({
        data: {
          companyId: acceptance.companyId,
          employeeId: acceptance.employeeId,
          kind: "TERMS",
          title: `Signed terms of employment, version ${acceptance.version.version}`,
          fileId: file.id,
          addedById: null,
        },
      });
      const linked = await tx.termsAcceptance.updateMany({
        where: { id: acceptance.id, documentId: null },
        data: { documentId: document.id },
      });
      if (linked.count === 0) {
        // Another run made it first: keep theirs.
        await tx.fileAsset.delete({ where: { id: file.id } });
        return false;
      }
      if (acceptance.employee.userId) {
        await sendInApp(
          tx,
          acceptance.companyId,
          [{ userId: acceptance.employee.userId, employeeId: acceptance.employeeId }],
          {
            subject: "Your signed copy of the terms",
            body: `Your signed copy of the terms of employment, version ${acceptance.version.version}, is in My HR > My details > My papers.`,
            entityType: "MyDetails",
            entityId: acceptance.employeeId,
          },
        );
      }
      return true;
    });
  } catch (error) {
    await deleteStoredFile(stored);
    throw error;
  }
  if (!made) {
    await deleteStoredFile(stored);
    return;
  }
  await recordAudit({
    companyId: acceptance.companyId,
    userId: null,
    action: "CREATE",
    entityType: "Employee",
    entityId: acceptance.employeeId,
    summary: `Made the signed copy of the terms of employment, version ${acceptance.version.version}, for ${acceptance.codeAtSigning} ${acceptance.nameAtSigning}`,
  });
}
