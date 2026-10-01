import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { TENANT_MODELS, withCompany } from "@/lib/tenant-db";

describe("tenant model detection", () => {
  it("treats company-owned models as tenant data and global ones as not", () => {
    expect(TENANT_MODELS.has("SalesOrder")).toBe(true);
    expect(TENANT_MODELS.has("Role")).toBe(true);
    expect(TENANT_MODELS.has("User")).toBe(false);
    expect(TENANT_MODELS.has("Company")).toBe(false);
  });
});

describe("withCompany", () => {
  it("adds companyId to plain (unchecked) data", () => {
    expect(withCompany("Brand", { name: "X" }, "c1")).toEqual({ name: "X", companyId: "c1" });
  });

  it("connects the company when relation-style writes are used", () => {
    expect(withCompany("Style", { name: "X", category: { connect: { id: "k" } } }, "c1")).toEqual({
      name: "X",
      category: { connect: { id: "k" } },
      company: { connect: { id: "c1" } },
    });
  });

  it("refuses data aimed at another company", () => {
    expect(() => withCompany("Brand", { name: "X", companyId: "c2" }, "c1")).toThrow(AppError);
    expect(() =>
      withCompany("Brand", { name: "X", company: { connect: { id: "c2" } } }, "c1"),
    ).toThrow(AppError);
  });
});
