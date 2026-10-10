import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Reports & documents screens decide what to show and offer from flags the
 * server sends with the data (can.delete, can.letterhead, the kinds of
 * document listed...). These tests open the screens' data as each built-in
 * role plus a "Front desk" role that only writes letters, and then try the
 * changes through the same Server Actions the buttons call: each must work
 * exactly when the screen offers it. Payslip PDFs must reach only salary
 * viewers and the employee whose payslip it is. Next.js' request helpers are
 * replaced as in screens.test.ts.
 */
const browser = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      browser.cookies.has(name) ? { name, value: browser.cookies.get(name)! } : undefined,
    set: (name: string, value: string) => void browser.cookies.set(name, value),
    delete: (name: string) => void browser.cookies.delete(name),
  }),
  headers: async () => browser.headers,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`Redirected to ${url}`), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
      redirectedTo: url,
    });
  },
  notFound: () => {
    throw Object.assign(new Error("Not found"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  },
  useRouter: () => ({}),
  usePathname: () => "/reports",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import PrintedDocumentsPage from "@/app/(app)/reports/documents/page";
import NewReportPage from "@/app/(app)/reports/new/page";
import ReportsPage from "@/app/(app)/reports/page";
import SavedReportPage from "@/app/(app)/reports/saved/[exportId]/page";
import TemplatePage from "@/app/(app)/reports/templates/[templateId]/page";
import TemplatesPage from "@/app/(app)/reports/templates/page";
import { SectionError } from "@/components/dashboard/section-error";
import {
  DocumentsNoAccess,
  ReportsNoAccess,
  TemplatesNoAccess,
} from "@/components/reports/no-access";
import { STARTER_HTML } from "@/components/reports/starter-html";
import { visibleReportsTabs } from "@/components/reports/tabs";
import { visibleNavItems } from "@/components/shell/nav-items";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { localDay } from "@/lib/dates";
import type { ActionResult } from "@/lib/result";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import type { CompanyContext } from "@/modules/auth/context";
import { createSession } from "@/modules/auth/session.service";
import * as employees from "@/modules/hr/employee.service";
import * as payroll from "@/modules/hr/payroll.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import { createRole } from "@/modules/rbac/role.service";
import { allowedMetrics } from "@/modules/reports/catalog";
import { reportsKeys } from "@/modules/reports/rules";
import * as orders from "@/modules/sales/order.service";
import * as quotations from "@/modules/sales/quotation.service";
import {
  getDocumentAction,
  getDocumentsScreenAction,
  listDocumentRowsAction,
  printDocumentAction,
} from "@/server/actions/documents.actions";
import {
  deleteReportExportAction,
  generateReportAction,
  getReportBuilderScreenAction,
  getReportsScreenAction,
  getSavedReportScreenAction,
  listReportRowsAction,
} from "@/server/actions/reports.actions";
import {
  createHtmlTemplateAction,
  deleteTemplateAction,
  fillTemplateAction,
  findLetterPartiesAction,
  getTemplateScreenAction,
  getTemplatesScreenAction,
  setTemplatePlaceholdersAction,
  templateChoicesAction,
  updateTemplateAction,
} from "@/server/actions/templates.actions";
import { requireCompanyPage } from "@/server/pages/guards";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const BUILT_IN = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  sales: "SALES_EXECUTIVE",
  store: "WAREHOUSE_TEAM",
  accounts: "ACCOUNTS",
  employee: "EMPLOYEE",
} as const;
type Who = keyof typeof BUILT_IN | "desk";
const EVERYONE: Who[] = [...(Object.keys(BUILT_IN) as Who[]), "desk"];
const TZ = "Asia/Dhaka";

async function signInAs(userId: string, companyId: string) {
  const { token } = await createSession(userId, companyId);
  browser.cookies.set(SESSION_COOKIE, token);
}

/** A refusal must come from the access rules, not from some other failure. */
function expectRuleRefusal(result: ActionResult<unknown>, label: string) {
  if (result.ok) return;
  expect(
    ["FORBIDDEN", "CONFLICT", "VALIDATION", "NOT_FOUND"],
    `${label}: ${result.error.message}`,
  ).toContain(result.error.code);
}

/** The change works exactly when the screen offered it. */
function expectOffered(result: ActionResult<unknown>, offered: boolean, label: string) {
  expect(result.ok, `${label}${result.ok ? "" : `: ${result.error.message}`}`).toBe(offered);
  expectRuleRefusal(result, label);
}

function data<T>(result: ActionResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/** What a page rendered: "no access", an error, the page, or where it sent the person. */
async function rendered(page: () => Promise<React.ReactElement>): Promise<string> {
  let element: React.ReactElement;
  try {
    element = await page();
  } catch (error) {
    const to = (error as { redirectedTo?: string }).redirectedTo;
    if (to) return `redirect ${to}`;
    throw error;
  }
  if (
    element.type === ReportsNoAccess ||
    element.type === DocumentsNoAccess ||
    element.type === TemplatesNoAccess
  )
    return "no access";
  if (element.type === SectionError) return "error";
  return "page";
}

const params = <T>(value: T) => Promise.resolve(value);
const noQuery = () => Promise.resolve({});

/** "YYYY-MM" `n` months before this one. */
function monthsAgo(n: number) {
  const [y, m] = localDay(new Date(), TZ).split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
}

/**
 * Extas with one person in each built-in role and a "Front desk" role that may
 * only print letters; a polo in stock, the buyer Rahim Traders with a quotation
 * and an invoiced order; Sabbir (the Employee's login) and Nasrin on payroll,
 * with last month's payroll approved and this month's a draft.
 */
async function factory() {
  const { company, roles } = await makeCompany("Extas");
  const owner = await makeUser("owner@extas.test");
  await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);
  const ownerCtx = await contextFor(owner.id, company.id);
  const deskRole = await createRole(ownerCtx, {
    name: "Front desk",
    permissions: ["documents.letterhead"],
  });
  const roleOf: Record<Who, string> = {
    owner: roles.SUPER_ADMIN,
    production: roles.PRODUCTION_MANAGER,
    sales: roles.SALES_EXECUTIVE,
    store: roles.WAREHOUSE_TEAM,
    accounts: roles.ACCOUNTS,
    employee: roles.EMPLOYEE,
    desk: deskRole.id,
  };
  const people: Partial<Record<Who, { id: string }>> = { owner };
  for (const who of EVERYONE) {
    if (who === "owner") continue;
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, company.id, roleOf[who]);
    people[who] = user;
  }
  await ensureControlAccounts(company.id);

  const sizes = [];
  for (const size of ["S", "M"]) sizes.push(await catalog.createSize(ownerCtx, { name: size }));
  const navy = await catalog.createColor(ownerCtx, { name: "Navy", hexCode: "#1F2A44" });
  const tops = await catalog.createCategory(ownerCtx, { name: "Tops" });
  const polo = await styles.createStyle(ownerCtx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ownerCtx, polo.id, {
    colorIds: [navy.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await ownerCtx.db.productVariant.findMany({ where: { styleId: polo.id } });
  for (const v of variants) {
    await stock.adjustStock(ownerCtx, {
      variantId: v.id,
      quantity: 10,
      type: "OPENING",
      unitCost: 500,
    });
  }
  const buyer = (
    await parties.createParty(ownerCtx, {
      kind: "BUYER",
      name: "Rahim Traders",
      address: "Mirpur 10, Dhaka",
    })
  ).party;
  const quotation = await quotations.createQuotation(ownerCtx, {
    partyId: buyer.id,
    validUntil: "2099-12-31",
    items: [
      {
        styleId: polo.id,
        description: "Pique polo",
        sizeBreakdown: { S: 10, M: 20 },
        unitPrice: 650,
      },
    ],
  });
  const order = await orders.createOrder(ownerCtx, {
    channel: "WHOLESALE",
    partyId: buyer.id,
    lines: [{ variantId: variants[0]!.id, quantity: 2 }],
  });
  const invoice = await ownerCtx.db.invoice.findUniqueOrThrow({ where: { orderId: order.id } });

  const hire = (name: string) =>
    employees.createEmployee(ownerCtx, { name, joinDate: "2025-01-01", salary: 25000 });
  const sabbir = await hire("Sabbir Ahmed");
  const nasrin = await hire("Nasrin Akter");
  await employees.grantPortalAccess(ownerCtx, sabbir.id, { userId: people.employee!.id });
  const approved = await payroll.createPayrollRun(ownerCtx, { month: monthsAgo(2) });
  await payroll.approvePayrollRun(ownerCtx, approved.id);
  const draft = await payroll.createPayrollRun(ownerCtx, { month: monthsAgo(1) });
  const line = (run: typeof approved, employeeId: string) =>
    run.items.find((i) => i.employee.id === employeeId)!.id;

  return {
    company,
    people: people as Record<Who, { id: string }>,
    owner: ownerCtx,
    buyer,
    polo,
    quotation,
    invoice,
    payslips: {
      sabbir: line(approved, sabbir.id),
      nasrin: line(approved, nasrin.id),
      sabbirDraft: line(draft, sabbir.id),
    },
    approved,
  };
}

type Factory = Awaited<ReturnType<typeof factory>>;

async function as(env: Factory, who: Who): Promise<CompanyContext> {
  await signInAs(env.people[who].id, env.company.id);
  return requireCompanyPage();
}

run("Reports & documents screens", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-reports-screens-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("shows each page to the people its actions let in, and nothing to the others", async () => {
    const env = await factory();

    for (const who of EVERYONE) {
      const ctx = await as(env, who);
      const k = reportsKeys(ctx);
      const tabs = visibleReportsTabs(ctx.permissions).map((t) => t.href);
      expect(tabs, who).toEqual([
        ...(k.reports ? ["/reports"] : []),
        ...(k.documents ? ["/reports/documents"] : []),
        ...(k.templates ? ["/reports/templates"] : []),
      ]);
      const inMenu = visibleNavItems([...ctx.permissions]).some((i) => i.href === "/reports");
      expect(inMenu, who).toBe(tabs.length > 0);

      const reports = await getReportsScreenAction();
      expectOffered(reports, k.reports, `${who} reports`);
      const builder = await getReportBuilderScreenAction({}, {});
      expectOffered(builder, k.reports, `${who} builder`);
      if (builder.ok) {
        expect(
          builder.data.metrics.map((m) => m.key),
          who,
        ).toEqual(allowedMetrics(ctx));
      }
      const documents = await getDocumentsScreenAction();
      expectOffered(documents, k.documents, `${who} documents`);
      if (documents.ok) {
        expect(
          documents.data.types.map((t) => t.key),
          who,
        ).toEqual(k.documentTypes);
        expect(documents.data.can, who).toMatchObject({
          letterhead: k.letterhead,
          pickParty: ctx.can("parties.view"),
          templates: k.templates,
        });
      }
      expectOffered(await getTemplatesScreenAction(), k.templates, `${who} templates`);

      // The pages show the same, and Reports sends people without it to what they have.
      const reportsPage = await rendered(() => ReportsPage({ searchParams: noQuery() }));
      expect(reportsPage, who).toBe(
        k.reports
          ? "page"
          : k.documents
            ? "redirect /reports/documents"
            : k.templates
              ? "redirect /reports/templates"
              : "no access",
      );
      expect(await rendered(() => NewReportPage({ searchParams: noQuery() })), who).toBe(
        k.reports ? "page" : "no access",
      );
      expect(await rendered(() => PrintedDocumentsPage({ searchParams: noQuery() })), who).toBe(
        k.documents ? "page" : "no access",
      );
      expect(await rendered(() => TemplatesPage()), who).toBe(k.templates ? "page" : "no access");
    }
  });

  it("makes, opens and deletes reports exactly as the screens offer", async () => {
    const env = await factory();

    await as(env, "owner");
    const sales = data(
      await generateReportAction({ title: "Sales this month", metrics: ["SALES"], format: "PDF" }),
      "owner makes a report",
    );
    expect(sales).toMatchObject({ title: "Sales this month", format: "PDF", status: "SUCCEEDED" });
    const shown = data(
      await getReportBuilderScreenAction({ metrics: "SALES" }, { show: true }),
      "owner shows it",
    );
    expect(shown.previewError).toBeNull();
    expect(shown.preview?.title).toBeTruthy();
    expect(
      await rendered(() =>
        SavedReportPage({ params: params({ exportId: sales.id }), searchParams: noQuery() }),
      ),
    ).toBe("page");

    // Accounts sees it but may not delete it; Accounts' own report it may.
    await as(env, "accounts");
    const listed = data(await listReportRowsAction({}), "accounts lists");
    const row = listed.items.find((r) => r.id === sales.id)!;
    expect(row.can.delete).toBe(false);
    expectOffered(await deleteReportExportAction(sales.id), row.can.delete, "accounts deletes");
    const own = data(
      await generateReportAction({ metrics: ["PROFIT_AND_LOSS"], format: "EXCEL" }),
      "accounts makes one",
    );
    const mine = data(await getReportsScreenAction({ mine: "1" }), "accounts' own");
    expect(mine.list.items.map((r) => r.id)).toEqual([own.id]);
    expect(mine.list.items[0]!.can.delete).toBe(true);

    // The production manager may not see sales figures: no preview, no saved sales report.
    await as(env, "production");
    const refused = data(
      await getReportBuilderScreenAction({ metrics: "SALES" }, { show: true }),
      "production shows sales",
    );
    expect(refused.preview).toBeNull();
    expect(refused.previewError?.code).toBe("FORBIDDEN");
    expectOffered(await getSavedReportScreenAction(sales.id), false, "production opens sales");
    expect(
      await rendered(() =>
        SavedReportPage({ params: params({ exportId: sales.id }), searchParams: noQuery() }),
      ),
    ).toBe("no access");

    await as(env, "accounts");
    expectOffered(await deleteReportExportAction(own.id), true, "accounts deletes its own");
    await as(env, "owner");
    const screen = data(await getSavedReportScreenAction(sales.id), "owner opens");
    expect(screen.can).toEqual({ delete: true, makeAgain: true });
    expectOffered(await deleteReportExportAction(sales.id), true, "owner deletes");
  });

  it("lists printed documents with links only to what each person may open", async () => {
    const env = await factory();

    await as(env, "owner");
    const print = async (input: unknown) =>
      data(await printDocumentAction(input), JSON.stringify(input));
    const quote = await print({ type: "QUOTATION", id: env.quotation.id });
    const invoice = await print({ type: "COMMERCIAL_INVOICE", id: env.invoice.id });
    const statement = await print({ type: "LEDGER_STATEMENT", partyId: env.buyer.id });
    const sheet = await print({ type: "STOCK_AVAILABILITY", styleIds: [env.polo.id] });
    const pad = await print({ type: "LETTERHEAD" });
    const nasrin = await print({ type: "PAYSLIP", id: env.payslips.nasrin });
    const all = [quote, invoice, statement, sheet, pad, nasrin];

    const expected: Record<Who, string[]> = {
      owner: all.map((d) => d.id),
      accounts: [quote, invoice, statement, pad, nasrin].map((d) => d.id),
      sales: [quote, invoice, statement, sheet, pad].map((d) => d.id),
      store: [quote, invoice, sheet].map((d) => d.id),
      production: [sheet, pad].map((d) => d.id),
      desk: [pad.id],
      employee: [],
    };
    for (const who of EVERYONE) {
      const ctx = await as(env, who);
      const screen = await getDocumentsScreenAction();
      expectOffered(screen, expected[who].length > 0, `${who} documents`);
      if (!screen.ok) continue;
      const rows = screen.data.list.items;
      expect(rows.map((d) => d.id).sort(), who).toEqual([...expected[who]].sort());
      const link = (id: string) => rows.find((d) => d.id === id)?.source?.href ?? null;
      if (expected[who].includes(quote.id)) {
        expect(link(quote.id), who).toBe(`/sales/quotations/${env.quotation.id}`);
        expect(link(invoice.id), who).toBe(`/sales/invoices/${env.invoice.id}`);
      }
      if (expected[who].includes(statement.id)) {
        expect(link(statement.id), who).toBe(`/parties/buyers/${env.buyer.id}/statement`);
      }
      if (expected[who].includes(sheet.id)) {
        expect(link(sheet.id), who).toBe(`/products/${env.polo.id}`);
      }
      if (expected[who].includes(nasrin.id)) {
        expect(link(nasrin.id), who).toBe(
          `/hr/payroll/${env.approved.id}/payslips/${env.payslips.nasrin}`,
        );
      }
      // Filtering by a kind this person may not see is refused, not empty.
      const payslips = await listDocumentRowsAction({ type: "PAYSLIP" });
      expectOffered(payslips, ctx.can("hr.payroll") || ctx.can("accounts.view"), `${who} payslips`);
    }
  });

  it("gives an employee their own approved payslips as PDFs, and nobody else's", async () => {
    const env = await factory();

    await as(env, "employee");
    const own = await printDocumentAction({ type: "PAYSLIP", id: env.payslips.sabbir });
    expectOffered(own, true, "employee prints own payslip");
    const doc = data(own, "own payslip");
    expect(doc.title).toContain("Sabbir Ahmed");
    expectOffered(await getDocumentAction(doc.id), true, "employee opens it again");
    expectOffered(
      await printDocumentAction({ type: "PAYSLIP", id: env.payslips.nasrin }),
      false,
      "employee prints someone else's",
    );
    expectOffered(
      await printDocumentAction({ type: "PAYSLIP", id: env.payslips.sabbirDraft }),
      false,
      "employee prints a draft",
    );
    // The archive is not theirs to browse.
    expectOffered(await getDocumentsScreenAction(), false, "employee lists documents");

    // Someone else's copy stays closed to them.
    await as(env, "accounts");
    const theirs = data(
      await printDocumentAction({ type: "PAYSLIP", id: env.payslips.nasrin }),
      "accounts prints Nasrin's",
    );
    const draft = data(
      await printDocumentAction({ type: "PAYSLIP", id: env.payslips.sabbirDraft }),
      "accounts prints a draft",
    );
    expect(draft.title).toContain("Sabbir Ahmed");
    await as(env, "employee");
    expectOffered(await getDocumentAction(theirs.id), false, "employee opens Nasrin's");

    // Sales may not print payslips at all.
    await as(env, "sales");
    expectOffered(
      await printDocumentAction({ type: "PAYSLIP", id: env.payslips.sabbir }),
      false,
      "sales prints a payslip",
    );
  });

  it("lets only the owner change templates, and whoever prints the kind fill them", async () => {
    const env = await factory();

    await as(env, "owner");
    const quoteDesign = data(
      await createHtmlTemplateAction({
        name: "Our quotation",
        documentType: "QUOTATION",
        html: STARTER_HTML.QUOTATION,
        isDefault: true,
      }),
      "owner writes a quotation template",
    );
    const letter = data(
      await createHtmlTemplateAction({
        name: "Our letter",
        documentType: "LETTERHEAD",
        html: STARTER_HTML.LETTERHEAD,
      }),
      "owner writes a letter template",
    );
    const screen = data(await getTemplateScreenAction(quoteDesign.id), "owner opens it");
    expect(screen.template.unmapped).toEqual([]);
    expect(screen.html).toBe(STARTER_HTML.QUOTATION);
    expect(screen.sample).toMatchObject({ id: env.quotation.id });
    expect(
      await rendered(() =>
        TemplatePage({ params: params({ templateId: quoteDesign.id }), searchParams: noQuery() }),
      ),
    ).toBe("page");

    for (const who of EVERYONE) {
      const ctx = await as(env, who);
      const manage = ctx.can("templates.manage");
      expectOffered(await getTemplateScreenAction(quoteDesign.id), manage, `${who} opens`);
      expectOffered(
        await setTemplatePlaceholdersAction(quoteDesign.id, {
          placeholders: [{ tag: "{Terms}", sourcePath: "document.terms", format: "upper" }],
        }),
        manage,
        `${who} maps a tag`,
      );
      expectOffered(
        await updateTemplateAction(quoteDesign.id, { name: `Our quotation (${who})` }),
        manage,
        `${who} renames`,
      );

      // Templates are offered to whoever may print the kind, and fill when offered.
      const choices = data(await templateChoicesAction("QUOTATION"), `${who} choices`);
      expect(choices.length > 0, who).toBe(ctx.can("sales.view"));
      expectOffered(
        await fillTemplateAction(quoteDesign.id, { id: env.quotation.id }),
        choices.length > 0,
        `${who} fills the quotation`,
      );
      const letters = data(await templateChoicesAction("LETTERHEAD"), `${who} letters`);
      expect(
        letters.map((t) => t.id),
        who,
      ).toEqual(ctx.can("documents.letterhead") ? [letter.id] : []);
      expectOffered(
        await fillTemplateAction(letter.id, {}),
        letters.length > 0,
        `${who} writes a letter`,
      );
      // Addressing a letter needs the buyers and suppliers.
      const found = await findLetterPartiesAction({ search: "rahim" });
      expectOffered(found, ctx.can("parties.view"), `${who} finds a buyer`);
      if (found.ok)
        expect(
          found.data.map((p) => p.name),
          who,
        ).toEqual(["Rahim Traders"]);
      if (letters.length > 0) {
        expectOffered(
          await fillTemplateAction(letter.id, { partyId: env.buyer.id }),
          ctx.can("parties.view"),
          `${who} writes to Rahim Traders`,
        );
      }
      expect(await rendered(() => TemplatesPage()), who).toBe(manage ? "page" : "no access");
    }

    // Switched off, it is no longer offered or filled; deleted, it is gone.
    await as(env, "owner");
    data(await updateTemplateAction(quoteDesign.id, { isActive: false }), "switch off");
    await as(env, "sales");
    expect(data(await templateChoicesAction("QUOTATION"), "sales choices")).toEqual([]);
    expectOffered(
      await fillTemplateAction(quoteDesign.id, { id: env.quotation.id }),
      false,
      "sales fills a switched-off template",
    );
    await as(env, "owner");
    expectOffered(await deleteTemplateAction(quoteDesign.id), true, "owner deletes");
    expectOffered(await getTemplateScreenAction(quoteDesign.id), false, "opens a deleted one");
    const groups = data(await getTemplatesScreenAction(), "owner's templates").groups;
    expect(groups.find((g) => g.type === "LETTERHEAD")!.templates.map((t) => t.id)).toEqual([
      letter.id,
    ]);
    expect(groups.find((g) => g.type === "QUOTATION")!.templates).toEqual([]);
    // Unknown kinds offer nothing rather than failing.
    expect(data(await templateChoicesAction("PAYSLIP"), "payslip choices")).toEqual([]);
  });
});
