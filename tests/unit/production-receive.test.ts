import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { productionHref } from "@/components/production/labels";
import {
  ruleSummary,
  supplierGrade,
  type SupplierReportCard,
} from "@/modules/production/report-card.service";
import { SHORT_ALLOWANCE, shortExtra } from "@/modules/production/short-extra";

describe("Challan vs Actual (Short/Extra)", () => {
  it("lets fabric be 2% short and the rest 1% before it is a fault", () => {
    expect(SHORT_ALLOWANCE).toEqual({ FABRIC: 2, OTHER: 1 });
    expect(shortExtra(100, 100, "FABRIC")).toEqual({ level: "MATCH", difference: 0, percent: 0 });
    expect(shortExtra(100, 98, "FABRIC")).toEqual({
      level: "SHORT_WITHIN",
      difference: -2,
      percent: 2,
    });
    expect(shortExtra(100, 97.9, "FABRIC").level).toBe("SHORT");
    expect(shortExtra(1000, 990, "TRIM")).toMatchObject({ level: "SHORT_WITHIN", percent: 1 });
    expect(shortExtra(1000, 989, "TRIM")).toMatchObject({
      level: "SHORT",
      difference: -11,
      percent: 1.1,
    });
    expect(shortExtra(50, 52.5, "FABRIC")).toEqual({ level: "EXTRA", difference: 2.5, percent: 5 });
  });

  it("needs a challan figure to judge, and counts nothing that came as all short", () => {
    expect(shortExtra(null, 40, "FABRIC").level).toBe("NO_CHALLAN");
    expect(shortExtra(12, 0, "PACKAGING")).toEqual({
      level: "SHORT",
      difference: -12,
      percent: 100,
    });
    // Three decimals, without float dust.
    expect(shortExtra(0.3, 0.1, "FABRIC").difference).toBe(-0.2);
  });
});

describe("The supplier report card", () => {
  it("grades on time first, then the faults", () => {
    expect(supplierGrade(null, 0)).toBeNull();
    expect(supplierGrade(95, 1)).toBe("A");
    expect(supplierGrade(95, 2)).toBe("B");
    expect(supplierGrade(75, 0)).toBe("B");
    expect(supplierGrade(60, 0)).toBe("C");
    expect(supplierGrade(40, 0)).toBe("D");
  });

  it("sums up in plain words without AI", () => {
    const ZERO = new Prisma.Decimal(0);
    const card = {
      supplier: { name: "Noman Textile Mills" },
      onTime: { judged: 4, onTime: 3, percent: 75 },
      averageDaysLate: 6,
      deliveries: [{}, {}, {}],
      shortDeliveries: 1,
      faults: [{}],
      openFaults: { count: 1, amount: new Prisma.Decimal("12500") },
      deducted: ZERO,
      grade: "B",
    } as unknown as SupplierReportCard;
    expect(ruleSummary(card, "BDT")).toBe(
      "Noman Textile Mills delivered 3 of 4 orders on time (75%) in the last 12 months; late ones came 6 days late on average. " +
        "1 of 3 delivery lines checked against the challan came short. " +
        "1 fault is still open, 12,500.00 BDT to deduct from the next payment. " +
        "Grade B: reliable, follow up on the open points.",
    );
    const clean = {
      ...card,
      shortDeliveries: 0,
      faults: [],
      openFaults: { count: 0, amount: ZERO },
    };
    expect(ruleSummary(clean as SupplierReportCard, "BDT")).toMatch(
      /Every delivery checked against its challan was in full\. Nothing is in the fault log\./,
    );
  });
});

describe("Fault log links", () => {
  it("narrows the log by batch, supplier and status", () => {
    expect(productionHref.faults()).toBe("/production/faults");
    expect(productionHref.faults({ batchId: "b1", status: "OPEN" })).toBe(
      "/production/faults?batchId=b1&status=OPEN",
    );
    expect(productionHref.receive("b 1", "o1")).toBe("/production/batches/b%201/receive?order=o1");
    expect(productionHref.issue("b1")).toBe("/production/batches/b1/issue");
    expect(productionHref.reportCard("s1")).toBe("/api/production/suppliers/s1/report-card");
  });
});
