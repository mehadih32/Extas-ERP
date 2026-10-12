import type { Company } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { ASSET_KIND_WORDS, ASSET_KINDS, ASSET_RETURNS } from "@/components/hr/asset-labels";
import { MY_HR_TABS } from "@/components/hr/tabs";
import type { PrintDocument } from "@/modules/documents/model";
import { certificateDocument } from "@/modules/hr/exit-pdf";

/*
 * Leaving: the Experience & Clearance Certificate HR has made when someone is
 * deactivated (who they are, how long they worked here, the company items they
 * gave back and what money was still to settle), and the words for company
 * items.
 */

const company = {
  name: "Extras",
  legalName: "Extras Fashion Ltd.",
  address: "House 12, Road 5\nDhanmondi, Dhaka 1205",
  phone: "01711-000000",
  email: null,
  website: null,
  letterheadFooter: null,
  primaryColor: "#123456",
  accentColor: "#654321",
  currency: "BDT",
} as unknown as Company;

const rina = {
  id: "e1",
  code: "EMP-0007",
  name: "Rina Begum",
  designation: "Merchandiser",
  department: "Sales",
  joinDate: new Date("2024-03-01T00:00:00Z"),
  exitDate: new Date("2026-10-10T00:00:00Z"),
  status: "RESIGNED" as const,
  userId: "u1",
};

const settled = {
  salaryOwed: "0.00",
  advancesOwed: "0.00",
  claimsOwed: "0.00",
  claimsWaiting: 0,
  finalPayrollMissing: null,
};

const laptop = {
  name: "Dell laptop",
  kind: "LAPTOP" as const,
  tag: "LT-0042",
  issuedOn: new Date("2024-03-01T00:00:00Z"),
  returnedOn: new Date("2026-10-10T00:00:00Z"),
  returnCondition: "GOOD" as const,
};

const blockOf = <K extends PrintDocument["blocks"][number]["kind"]>(doc: PrintDocument, kind: K) =>
  doc.blocks.find((b) => b.kind === kind) as Extract<PrintDocument["blocks"][number], { kind: K }>;

describe("the experience and clearance certificate", () => {
  it("says who they are, when they worked here and that they handed everything back", () => {
    const doc = certificateDocument(company, rina, [laptop], settled, "2026-10-12");
    expect(doc.type).toBe("CLEARANCE_CERTIFICATE");
    expect(doc.title).toBe("Experience & Clearance Certificate");
    expect(doc.subtitle).toBe("Rina Begum");
    expect(doc.reference).toBe("EMP-0007 · 2026-10-10");
    expect(doc.letterhead.legalName).toBe("Extras Fashion Ltd.");
    const text = blockOf(doc, "text");
    expect(text.title).toBe("To whom it may concern");
    // 1 Mar 2024 up to and including 10 Oct 2026.
    expect(text.paragraphs[0]).toMatch(
      /^This is to certify that Rina Begum \(employee code EMP-0007\) worked at Extras Fashion Ltd\. as Merchandiser in Sales from .+ to .+, a period of 2 years, 7 months and 10 days\.$/,
    );
    expect(text.paragraphs[1]).toBe("They handed back every company item they held (1).");
    const table = blockOf(doc, "table");
    expect(table.title).toBe("Company items");
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.cells[0]).toBe("Dell laptop");
    expect(table.rows[0]!.cells[1]).toBe("LT-0042");
    expect(table.rows[0]!.cells[4]).toBe("Returned");
    expect(table.rows[0]!.details).toEqual(["Laptop or computer"]);
    const dues = blockOf(doc, "list");
    expect(dues.title).toBe("Dues: all settled");
    expect(dues.items.map((i) => i.text)).toEqual(["Nothing", "Nothing", "Nothing"]);
    expect(doc.signatures).toEqual(["Human Resources", "Authorised signature"]);
  });

  it("shows what is still to settle, a lost item and a final payroll not approved yet", () => {
    const doc = certificateDocument(
      company,
      { ...rina, designation: null, department: null },
      [{ ...laptop, returnCondition: "LOST" }],
      {
        salaryOwed: "12000.00",
        advancesOwed: "3000.00",
        claimsOwed: "0.00",
        claimsWaiting: 2,
        finalPayrollMissing: "October 2026",
      },
      "2026-10-12",
    );
    const text = blockOf(doc, "text");
    expect(text.paragraphs[0]).toMatch(/worked at Extras Fashion Ltd\. from /);
    expect(text.paragraphs[1]).toMatch(/apart from those marked lost below/);
    expect(blockOf(doc, "table").rows[0]!.cells[4]).toBe("Lost");
    const dues = blockOf(doc, "list");
    expect(dues.title).toMatch(/^Dues on /);
    expect(dues.items.map((i) => i.label)).toEqual([
      "Salary still to pay them",
      "Advances they still owe",
      "Claims still to pay them",
      "Final salary",
    ]);
    expect(dues.items[0]!.text).toMatch(/12,000\.00/);
    expect(dues.items[2]!.text).toBe("Nothing approved yet; 2 waiting for Accounts");
    expect(dues.items[3]!.text).toBe("Comes with the October 2026 payroll, not approved yet");
  });

  it("says so when they held no company items", () => {
    const doc = certificateDocument(company, rina, [], settled, "2026-10-12");
    expect(blockOf(doc, "text").paragraphs[1]).toBe("They held no company items.");
    expect(blockOf(doc, "table").empty).toBe("No company items were given to them.");
  });
});

describe("company items and my money", () => {
  it("has words for every kind of item and every way it comes back", () => {
    expect(ASSET_KINDS).toHaveLength(9);
    for (const kind of ASSET_KINDS) expect(ASSET_KIND_WORDS[kind]).toBeTruthy();
    expect(ASSET_RETURNS).toEqual(["GOOD", "DAMAGED", "LOST"]);
  });

  it("gives My HR a Money tab after the payslips", () => {
    const hrefs = MY_HR_TABS.map((t) => t.href);
    expect(hrefs.indexOf("/me/ledger")).toBe(hrefs.indexOf("/me/payslips") + 1);
  });
});
