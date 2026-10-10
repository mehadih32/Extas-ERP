import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Compliance screens decide what to show and offer from flags the server
 * sends with the data (can.renew, can.archive, can.scan...). These tests open
 * the screens' data as each built-in role plus a "Licence clerk" role that only
 * manages licences, then try the changes through the same Server Actions the
 * buttons call: each must work exactly when the screen offers it. Next.js'
 * request helpers are replaced as in screens.test.ts.
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
  usePathname: () => "/compliance",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import ComplianceRecordPage from "@/app/(app)/compliance/[recordId]/page";
import CompliancePage from "@/app/(app)/compliance/page";
import { ComplianceNoAccess } from "@/components/compliance/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { visibleNavItems } from "@/components/shell/nav-items";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { addDays, localDay } from "@/lib/dates";
import type { ActionResult } from "@/lib/result";
import type { CompanyContext } from "@/modules/auth/context";
import { createSession } from "@/modules/auth/session.service";
import { complianceKeys } from "@/modules/compliance/rules";
import { createRole } from "@/modules/rbac/role.service";
import {
  archiveComplianceAction,
  attachComplianceScanAction,
  createComplianceAction,
  deleteComplianceAction,
  getComplianceRecordScreenAction,
  getComplianceScreenAction,
  removeComplianceScanAction,
  renewComplianceAction,
  restoreComplianceAction,
  updateComplianceAction,
} from "@/server/actions/compliance.actions";
import { requireCompanyPage } from "@/server/pages/guards";

import { png } from "../fixtures/images";
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
type Who = keyof typeof BUILT_IN | "clerk";
const EVERYONE: Who[] = [...(Object.keys(BUILT_IN) as Who[]), "clerk"];
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

/** What a page rendered: "no access", an error, or the page. */
async function rendered(page: Promise<React.ReactElement>): Promise<string> {
  const element = await page;
  if (element.type === ComplianceNoAccess) return "no access";
  if (element.type === SectionError) return "error";
  return "page";
}

const params = <T>(value: T) => Promise.resolve(value);
const noQuery = () => Promise.resolve({});
const today = () => localDay(new Date(), TZ);

function scanForm(name = "licence.png") {
  const form = new FormData();
  form.set("file", new File([png({ width: 40, height: 30 })], name, { type: "image/png" }));
  return form;
}

/** Extas with one person in each built-in role and a "Licence clerk" who only manages licences. */
async function factory() {
  const { company, roles } = await makeCompany("Extas");
  const owner = await makeUser("owner@extas.test");
  await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);
  const ownerCtx = await contextFor(owner.id, company.id);
  const clerkRole = await createRole(ownerCtx, {
    name: "Licence clerk",
    permissions: ["compliance.manage"],
  });
  const roleOf: Record<Who, string> = {
    owner: roles.SUPER_ADMIN,
    production: roles.PRODUCTION_MANAGER,
    sales: roles.SALES_EXECUTIVE,
    store: roles.WAREHOUSE_TEAM,
    accounts: roles.ACCOUNTS,
    employee: roles.EMPLOYEE,
    clerk: clerkRole.id,
  };
  const people: Partial<Record<Who, { id: string }>> = { owner };
  for (const who of EVERYONE) {
    if (who === "owner") continue;
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, company.id, roleOf[who]);
    people[who] = user;
  }
  return { company, people: people as Record<Who, { id: string }> };
}

type Factory = Awaited<ReturnType<typeof factory>>;

async function as(env: Factory, who: Who): Promise<CompanyContext> {
  await signInAs(env.people[who].id, env.company.id);
  return requireCompanyPage();
}

run("Compliance screens", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-compliance-screens-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("offers each change exactly to the people the service lets make it", async () => {
    const env = await factory();
    const licence = async (who: Who) => {
      await as(env, "owner");
      return data(
        await createComplianceAction({
          type: "TRADE_LICENSE",
          title: `Trade licence (${who})`,
          number: "TRAD/DNCC/0451",
          expiryDate: addDays(today(), 20),
        }),
        `${who} licence`,
      );
    };

    for (const who of EVERYONE) {
      const record = await licence(who);
      const ctx = await as(env, who);
      const keys = complianceKeys(ctx);
      const inMenu = visibleNavItems([...ctx.permissions]).some((i) => i.href === "/compliance");
      expect(inMenu, who).toBe(keys.view);
      expect(await rendered(CompliancePage({ searchParams: noQuery() })), who).toBe(
        keys.view ? "page" : "no access",
      );
      expect(
        await rendered(
          ComplianceRecordPage({
            params: params({ recordId: record.id }),
            searchParams: noQuery(),
          }),
        ),
        `${who} record`,
      ).toBe(keys.view ? "page" : "no access");

      const list = await getComplianceScreenAction();
      expectOffered(list, keys.view, `${who} list`);
      if (list.ok) expect(list.data.can, who).toEqual(keys);
      const screen = await getComplianceRecordScreenAction(record.id);
      expectOffered(screen, keys.view, `${who} record`);
      const can = screen.ok
        ? screen.data.can
        : { edit: false, renew: false, archive: false, restore: false, delete: false, scan: false };
      expect(can, who).toEqual({
        edit: keys.manage,
        renew: keys.manage,
        archive: keys.manage,
        restore: false,
        delete: keys.manage,
        scan: keys.manage,
      });

      expectOffered(
        await updateComplianceAction(record.id, { issuingAuthority: "Dhaka North" }),
        can.edit,
        `${who} corrects`,
      );
      expectOffered(
        await attachComplianceScanAction(record.id, scanForm()),
        can.scan,
        `${who} adds a scan`,
      );
      expectOffered(await removeComplianceScanAction(record.id), can.scan, `${who} removes it`);
      expectOffered(await restoreComplianceAction(record.id), can.restore, `${who} restores`);
      const renewed = await renewComplianceAction(record.id, {
        expiryDate: addDays(today(), 385),
        issueDate: today(),
      });
      expectOffered(renewed, can.renew, `${who} renews`);
      if (!renewed.ok) {
        expectOffered(await archiveComplianceAction(record.id), can.archive, `${who} archives`);
        expectOffered(await deleteComplianceAction(record.id), can.delete, `${who} deletes`);
        continue;
      }

      // The renewed term is history: it may be corrected, nothing else.
      const old = data(await getComplianceRecordScreenAction(record.id), `${who} old term`);
      expect(old.record.status, who).toBe("SUPERSEDED");
      expect(old.can, who).toEqual({
        edit: true,
        renew: false,
        archive: false,
        restore: false,
        delete: false,
        scan: true,
      });
      expectOffered(
        await renewComplianceAction(record.id, { expiryDate: addDays(today(), 800) }),
        old.can.renew,
        `${who} renews the old term`,
      );
      expectOffered(await archiveComplianceAction(record.id), old.can.archive, `${who} old`);
      expectOffered(await deleteComplianceAction(record.id), old.can.delete, `${who} old`);

      // The new term: archive, then restore, then delete (the old one is in force again).
      const current = data(await getComplianceRecordScreenAction(renewed.data.id), "new term");
      expect(current.record.previous?.id).toBe(record.id);
      expect(current.record.history.map((h) => h.id)).toEqual([record.id]);
      expectOffered(
        await archiveComplianceAction(renewed.data.id),
        current.can.archive,
        `${who} archives`,
      );
      const archived = data(await getComplianceRecordScreenAction(renewed.data.id), "archived");
      expect(archived.can).toMatchObject({ renew: false, archive: false, restore: true });
      expectOffered(
        await renewComplianceAction(renewed.data.id, { expiryDate: addDays(today(), 900) }),
        archived.can.renew,
        `${who} renews an archived one`,
      );
      expectOffered(
        await restoreComplianceAction(renewed.data.id),
        archived.can.restore,
        `${who} restores`,
      );
      expectOffered(
        await deleteComplianceAction(renewed.data.id),
        current.can.delete,
        `${who} deletes`,
      );
      const back = data(await getComplianceRecordScreenAction(record.id), "back in force");
      expect(back.record.status, who).toBe("EXPIRING");
      expect(back.can.renew, who).toBe(true);
    }
  });

  it("shows where the company stands: what needs renewing, what is missing, the numbers", async () => {
    const env = await factory();
    await as(env, "owner");
    const empty = data(await getComplianceScreenAction(), "empty");
    expect(empty.summary.missing.map((m) => m.type)).toEqual(["TRADE_LICENSE", "VAT_BIN", "TIN"]);

    const bin = data(
      await createComplianceAction({ type: "VAT_BIN", number: "000123456-0101" }),
      "bin",
    );
    const fire = data(
      await createComplianceAction({
        type: "FIRE_LICENSE",
        expiryDate: addDays(today(), -3),
        alertDaysBefore: 30,
      }),
      "fire",
    );
    const trade = data(
      await createComplianceAction({
        type: "TRADE_LICENSE",
        number: "TRAD/DNCC/0451",
        expiryDate: addDays(today(), 10),
      }),
      "trade",
    );

    await as(env, "accounts");
    const screen = data(await getComplianceScreenAction(), "screen");
    expect(screen.can).toEqual({ view: true, manage: false });
    expect(screen.summary.counts).toMatchObject({
      total: 3,
      expiring: 1,
      expired: 1,
      noExpiry: 1,
    });
    expect(screen.summary.needsRenewal.map((r) => r.id)).toEqual([fire.id, trade.id]);
    expect(screen.summary.missing.map((m) => m.type)).toEqual(["TIN"]);
    expect(screen.summary.numbers).toMatchObject({
      bin: "000123456-0101",
      tradeLicense: "TRAD/DNCC/0451",
      tin: null,
    });
    // The list's filters.
    const renew = data(await getComplianceScreenAction({ status: "EXPIRING" }), "renew soon");
    expect(renew.items.map((r) => r.id)).toEqual([trade.id]);
    const tin = data(await getComplianceScreenAction({ type: "VAT_BIN" }), "by kind");
    expect(tin.items.map((r) => r.id)).toEqual([bin.id]);
  });
});
