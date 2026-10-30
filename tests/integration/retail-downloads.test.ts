import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PUT as summaryRoute } from "@/app/api/v1/ecommerce/daily-summaries/[date]/route";
import { prisma } from "@/lib/prisma";
import { unzipSync } from "fflate";
import * as downloads from "@/modules/retail/downloads.service";
import * as pad from "@/modules/retail/pad.service";
import { createRole } from "@/modules/rbac/role.service";
import * as stores from "@/modules/retail/stores.service";

import { png } from "../fixtures/images";
import { callShop, type Shop, setupShop } from "./ecommerce-helpers";
import { addToCompany, contextFor, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const day = (date: string) => ({
  date,
  orders: { count: 42, pieces: 61 },
  sales: { gross: 98500, discounts: 6200, customerReturns: 3900, net: 88400 },
  income: { deliveryCharges: 3700 },
  deliveries: { delivered: 37, failed: 2, returned: 3, codPending: 21500 },
  costs: {
    goods: 41250,
    returnLosses: 650,
    packaging: 1850,
    delivery: 4600,
    paymentFees: 650,
    accessories: 400,
    ads: { facebook: 5200, instagram: 0, google: 1300, tiktok: 0, other: 0 },
    other: 900,
  },
  returns: { handedBackPieces: 4, approvedCredit: 2600, waitingCheckValue: 11700 },
  customers: { new: 18, returning: 11 },
  incomplete: [],
  netProfit: 35300,
});

/* Downloads, the store's pad and the year-end summary (plan v6 sec 12 and 14). */
run("Business downloads (plan v6 sec 12)", () => {
  let shop: Shop;
  let uploads: string;
  let store: Awaited<ReturnType<typeof stores.createStore>>;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-retail-downloads-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    shop = await setupShop();
    store = await stores.createStore(shop.owner, {
      name: "Extas Retail",
      kind: "ONLINE",
      warehouseId: shop.warehouse.id,
      integrationId: shop.integration.id,
      address: "House 12, Road 3, Dhaka",
      phone: "01700000000",
    });
    await callShop(shop, summaryRoute, {
      method: "PUT",
      path: "/daily-summaries/2026-11-15",
      params: { date: "2026-11-15" },
      body: day("2026-11-15"),
    });
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("makes a store's PDF on its own pad and the Excel file with every day, and logs both", async () => {
    await pad.uploadStoreLogo(shop.owner, store.id, {
      fileName: "logo.png",
      bytes: png({ width: 120, height: 40 }),
    });
    const pdf = await downloads.businessReportFile(shop.owner, {
      scope: "store",
      storeId: store.id,
      parts: [...downloads.BANK_REPORT, "chart", "days"],
      format: "pdf",
    });
    expect(pdf.mimeType).toBe("application/pdf");
    expect(pdf.fileName).toContain("Extas Retail 2026-11-01 to 2026-11-20");
    const text = pdf.bytes.toString("latin1");
    expect(text.startsWith("%PDF")).toBe(true);
    expect(text).toContain("/Subtype /Image");

    const xlsx = await downloads.businessReportFile(shop.owner, {
      scope: "store",
      storeId: store.id,
      parts: ["summary", "days"],
      format: "xlsx",
    });
    const files = unzipSync(new Uint8Array(xlsx.bytes));
    const sheets = Object.keys(files).filter((f) => f.startsWith("xl/worksheets/sheet"));
    expect(sheets).toHaveLength(2);
    const everyDay = new TextDecoder().decode(files["xl/worksheets/sheet2.xml"]);
    expect(everyDay).toContain("2026-11-15");
    expect(everyDay).toContain("88400");

    const logged = await prisma.auditLog.findMany({
      where: { action: "EXPORT", entityId: store.id },
    });
    // Both logged (in either order: they can share a moment).
    expect(logged).toHaveLength(2);
    expect(logged.map((l) => l.summary)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("(PDF)"),
        expect.stringContaining("(Excel)"),
      ]),
    );
    // Every day's rows are Excel only: a PDF of them alone is refused.
    await expect(
      downloads.businessReportFile(shop.owner, {
        scope: "store",
        storeId: store.id,
        parts: ["days"],
        format: "pdf",
      }),
    ).rejects.toThrow("only in Excel");
  });

  it("lets only those who may see the page download it", async () => {
    await expect(
      downloads.businessReportFile(shop.accounts, {
        scope: "store",
        storeId: store.id,
        parts: ["summary"],
        format: "pdf",
      }),
    ).rejects.toThrow();
    const overview = await downloads.buildBusinessReport(shop.owner, "overview", undefined, {}, [
      "summary",
      "months",
      "statement",
    ]);
    expect(overview.store).toBeNull();
    expect(overview.parts.map((p) => p.title)).toEqual([
      "Summary",
      "By month",
      "What the stores owe",
    ]);
    expect(overview.parts[1]!.table!.rows).toEqual([
      ["Nov 2026", 0, expect.any(Number), expect.any(Number)],
    ]);
  });

  it("keeps each store's year-end summary once the year is over, made once", async () => {
    await prisma.user.update({ where: { id: shop.owner.user.id }, data: { isSuperAdmin: true } });
    expect(await pad.makeYearReports(new Date("2026-12-31T12:00:00Z"))).toBe(0);
    expect(await pad.makeYearReports(new Date("2027-01-01T00:30:00Z"))).toBe(1);
    expect(await pad.makeYearReports(new Date("2027-01-02T00:30:00Z"))).toBe(0);
    const [kept] = await pad.listYearReports(shop.owner, store.id);
    expect(kept).toMatchObject({ year: 2026 });
    const file = await pad.yearReportFile(shop.owner, kept!.id);
    expect(file.bytes.toString("latin1").startsWith("%PDF")).toBe(true);

    // It carries the ERP's books: someone who only looks at the stores never gets it,
    // and sees no costs beside the store's hand prices either.
    const role = await createRole(shop.owner, {
      name: "Store watcher",
      permissions: ["dashboard.view", "retail.view"],
    });
    const user = await makeUser("watcher@extas.test");
    await addToCompany(user.id, shop.company.id, role.id);
    const watcher = await contextFor(user.id, shop.company.id);
    expect(await pad.listYearReports(watcher, store.id)).toEqual([]);
    await expect(pad.yearReportFile(watcher, kept!.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const page = await stores.getStore(watcher, store.id);
    for (const h of page.handPrices) expect([h.costWhenSet, h.costNow]).toEqual([null, null]);
  });
});
