import type { SystemRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  builderQuery,
  builderSearch,
  builderViewFrom,
  fileSize,
  reportsHref,
} from "@/components/reports/labels";
import { STARTER_HTML } from "@/components/reports/starter-html";
import { visibleReportsTabs } from "@/components/reports/tabs";
import { phoneTabs, visibleNavItems } from "@/components/shell/nav-items";
import { archiveTypes, mayPrintType, printableTypes } from "@/modules/documents/print.service";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  type PermissionKey,
} from "@/modules/rbac/permissions";
import { mayDeleteReport, reportsKeys } from "@/modules/reports/rules";
import { checkHtml, htmlTags } from "@/modules/templates/html";
import { defaultPath, TEMPLATE_TYPES } from "@/modules/templates/tags";

const role = (name: SystemRole): string[] => [...DEFAULT_ROLE_PERMISSIONS[name]];
const holding = (keys: readonly string[]) => ({
  can: (key: PermissionKey) => keys.includes(key),
});
const tabs = (permissions: string[]) => visibleReportsTabs(permissions).map((t) => t.label);
const nav = (permissions: string[]) => visibleNavItems(permissions).map((i) => i.href);

describe("Reports & documents in the menu, by role", () => {
  it("gives each role the tabs its Server Actions let it open", () => {
    expect(tabs(role("SUPER_ADMIN"))).toEqual(["Reports", "Printed documents", "Templates"]);
    expect(tabs(role("ACCOUNTS"))).toEqual(["Reports", "Printed documents"]);
    expect(tabs(role("PRODUCTION_MANAGER"))).toEqual(["Reports", "Printed documents"]);
    expect(tabs(role("SALES_EXECUTIVE"))).toEqual(["Printed documents"]);
    expect(tabs(role("WAREHOUSE_TEAM"))).toEqual(["Printed documents"]);
    expect(tabs(role("EMPLOYEE"))).toEqual([]);
    expect(nav(role("EMPLOYEE"))).not.toContain("/reports");
    // Under More on the phone, after HR & payroll.
    expect(phoneTabs(visibleNavItems(role("ACCOUNTS"))).more.map((i) => i.href)).toEqual([
      "/materials",
      "/parties",
      "/hr",
      "/reports",
      "/planner",
      "/compliance",
    ]);
  });

  it("shows Printed documents exactly when there is some kind of document to list", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    const sets: string[][] = [
      ...keys.map((key) => [key]),
      ...(Object.keys(DEFAULT_ROLE_PERMISSIONS) as SystemRole[]).map(role),
      ["portal.self", "hr.view"],
    ];
    for (const held of sets) {
      const listed = archiveTypes(holding(held)).length > 0;
      expect(tabs(held).includes("Printed documents"), held.join(",")).toBe(listed);
      expect(reportsKeys(holding(held)).documents, held.join(",")).toBe(listed);
      // The menu entry shows whenever any tab does.
      expect(nav(held).includes("/reports"), held.join(",")).toBe(tabs(held).length > 0);
    }
  });

  it("names what each role may do", () => {
    expect(reportsKeys(holding(role("SUPER_ADMIN")))).toMatchObject({
      reports: true,
      documents: true,
      templates: true,
      letterhead: true,
    });
    expect(reportsKeys(holding(role("ACCOUNTS")))).toMatchObject({
      reports: true,
      templates: false,
      letterhead: true,
    });
    expect(reportsKeys(holding(role("SALES_EXECUTIVE")))).toMatchObject({
      reports: false,
      templates: false,
      letterhead: true,
    });
    expect(reportsKeys(holding(role("WAREHOUSE_TEAM"))).documentTypes).not.toContain(
      "LEDGER_STATEMENT",
    );
  });
});

describe("payslip PDFs", () => {
  it("lets salary viewers print any payslip and list them all", () => {
    for (const key of ["hr.manage", "hr.payroll", "accounts.view"]) {
      expect(mayPrintType(holding([key]), "PAYSLIP"), key).toBe(true);
      expect(archiveTypes(holding([key])), key).toContain("PAYSLIP");
    }
  });

  it("lets an employee print their own, without listing anyone's", () => {
    const employee = holding(role("EMPLOYEE"));
    expect(mayPrintType(employee, "PAYSLIP")).toBe(true);
    expect(printableTypes(employee)).toEqual(["PAYSLIP"]);
    expect(archiveTypes(employee)).toEqual([]);
    // Seeing the staff list is not seeing salaries.
    expect(mayPrintType(holding(["hr.view"]), "PAYSLIP")).toBe(false);
  });
});

describe("deleting a saved report", () => {
  it("is for its maker or a Super Admin", () => {
    const report = { requestedById: "u1" };
    expect(mayDeleteReport({ userId: "u1", isOwner: false }, report).ok).toBe(true);
    expect(mayDeleteReport({ userId: "u2", isOwner: true }, report).ok).toBe(true);
    const other = mayDeleteReport({ userId: "u2", isOwner: false }, report);
    expect(other).toMatchObject({ ok: false, code: "FORBIDDEN" });
    // A report whose maker has gone can still be deleted by a Super Admin.
    expect(mayDeleteReport({ userId: "u2", isOwner: false }, { requestedById: null }).ok).toBe(
      false,
    );
    expect(mayDeleteReport({ userId: "u2", isOwner: true }, { requestedById: null }).ok).toBe(true);
  });
});

describe("the Report Builder's choices in the address bar", () => {
  it("reads only known choices and writes them back the same way", () => {
    const view = builderViewFrom({
      title: "  Weekly sales  ",
      period: "ONE_WEEK",
      metrics: "SALES,NONSENSE,TOP_SELLERS",
      topLimit: "15",
      slowDays: "12345",
      show: "1",
    });
    expect(view).toMatchObject({
      title: "Weekly sales",
      period: "ONE_WEEK",
      metrics: ["SALES", "TOP_SELLERS"],
      topLimit: 15,
      slowDays: undefined,
      show: true,
    });
    expect(builderSearch(view)).toBe(
      "?title=Weekly+sales&period=ONE_WEEK&metrics=SALES%2CTOP_SELLERS&topLimit=15&show=1",
    );
    expect(builderQuery(view)).toEqual({
      title: "Weekly sales",
      period: "ONE_WEEK",
      metrics: ["SALES", "TOP_SELLERS"],
      topLimit: 15,
      alertLimit: undefined,
      slowDays: undefined,
      coverDays: undefined,
    });
  });

  it("treats chosen dates as a custom period and leaves out the default", () => {
    const custom = builderViewFrom({ from: "2026-09-01", to: "2026-09-30", period: "THIS_YEAR" });
    expect(custom).toMatchObject({ period: "CUSTOM", from: "2026-09-01", to: "2026-09-30" });
    expect(builderSearch(custom)).toBe("?from=2026-09-01&to=2026-09-30");
    expect(builderQuery(custom)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(builderQuery(custom)).not.toHaveProperty("period");
    expect(builderViewFrom({ from: "2026-02-30" }).from).toBeUndefined();
    expect(builderSearch({ period: "THIS_MONTH" })).toBe("");
    expect(builderViewFrom({ period: "SOMEDAY" }).period).toBeUndefined();
  });
});

describe("Reports & documents words and addresses", () => {
  it("builds the addresses the screens link to", () => {
    expect(reportsHref.report("a/b")).toBe("/reports/saved/a%2Fb");
    expect(reportsHref.documents("PAYSLIP")).toBe("/reports/documents?type=PAYSLIP");
    expect(reportsHref.documents()).toBe("/reports/documents");
    expect(reportsHref.templateFile("t1")).toBe("/api/templates/t1/file");
  });

  it("writes file sizes for people", () => {
    expect(fileSize(null)).toBe("");
    expect(fileSize(900)).toBe("900 bytes");
    expect(fileSize(12_800)).toBe("13 KB");
    expect(fileSize(1_468_006)).toBe("1.4 MB");
  });

  it("starts every kind of HTML template from a page the server accepts, with known tags", () => {
    for (const type of TEMPLATE_TYPES) {
      const html = STARTER_HTML[type];
      expect(html, type).toBeTruthy();
      expect(() => checkHtml(html!), type).not.toThrow();
      const unknown = htmlTags(html!).filter((tag) => defaultPath(tag, type) === null);
      expect(unknown, type).toEqual([]);
    }
  });
});
