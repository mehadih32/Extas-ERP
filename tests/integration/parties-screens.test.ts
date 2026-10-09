import type { JournalSource } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Buyers & suppliers screens decide what to show and offer from flags the
 * server sends with the data (canCreate, can.edit, can.standing, can.statuses,
 * can.openingBalance, can.statement). These tests open the screens' data as
 * each built-in role and then try every change through the same Server Actions
 * the buttons call: each must work exactly when the screen offers it. Next.js'
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
  usePathname: () => "/parties",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import PartyPage from "@/app/(app)/parties/[list]/[partyId]/page";
import EditPartyPage from "@/app/(app)/parties/[list]/[partyId]/edit/page";
import StatementPage from "@/app/(app)/parties/[list]/[partyId]/statement/page";
import NewPartyPage from "@/app/(app)/parties/[list]/new/page";
import PartyListPage from "@/app/(app)/parties/[list]/page";
import DuesPage from "@/app/(app)/parties/dues/page";
import PartiesPage from "@/app/(app)/parties/page";
import { PartiesNoAccess } from "@/components/parties/no-access";
import { visiblePartiesTabs } from "@/components/parties/tabs";
import { visibleNavItems } from "@/components/shell/nav-items";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/result";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import type { CompanyContext } from "@/modules/auth/context";
import { createSession } from "@/modules/auth/session.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import { ensureWalkInParty } from "@/modules/parties/walk-in";
import {
  changePartyStatusAction,
  createPartyAction,
  getDuesScreenAction,
  getPartyFormAction,
  getPartyListAction,
  getPartyScreenAction,
  getStatementScreenAction,
  listPartyRowsAction,
  setOpeningBalanceAction,
  setPartyGradeAction,
  setPartyVerifiedAction,
  updatePartyAction,
} from "@/server/actions/parties.actions";
import { requireCompanyPage } from "@/server/pages/guards";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  sales: "SALES_EXECUTIVE",
  store: "WAREHOUSE_TEAM",
  accounts: "ACCOUNTS",
  employee: "EMPLOYEE",
} as const;
type Who = keyof typeof ROLES;

/** Opens the company as this person, as the browser does after they sign in. */
async function signInAs(userId: string, companyId: string) {
  const { token } = await createSession(userId, companyId);
  browser.cookies.set(SESSION_COOKIE, token);
}

/** A refusal must come from the access rules, not from some other failure. */
function expectRuleRefusal(result: ActionResult<unknown>, label: string) {
  if (result.ok) return;
  expect(["FORBIDDEN", "CONFLICT", "VALIDATION"], `${label}: ${result.error.message}`).toContain(
    result.error.code,
  );
}

function data<T>(result: ActionResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/** What a page rendered: the "not part of your role" notice, a redirect, or the page. */
async function rendered(page: Promise<React.ReactElement>): Promise<string> {
  try {
    const element = await page;
    return element.type === PartiesNoAccess ? "no access" : "page";
  } catch (error) {
    const to = (error as { redirectedTo?: string }).redirectedTo;
    if (to) return `redirect ${to}`;
    throw error;
  }
}

/**
 * Extras with one person in each built-in role, Walk-in customers, and three
 * accounts: Rahim Traders (a buyer invoiced 12,000 on 1 September who paid
 * 2,000 on 15 September), Karim Fashion (a buyer with no business yet) and
 * Delta Fabrics (a supplier who billed 5,000 on 10 September).
 */
async function market() {
  const { company, roles } = await makeCompany("Extras");
  const people = {} as Record<Who, { id: string }>;
  for (const [who, role] of Object.entries(ROLES) as Array<[Who, keyof typeof roles]>) {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roles[role]);
    people[who] = user;
  }
  const owner = await contextFor(people.owner.id, company.id);
  const accounts = await ensureControlAccounts(company.id);
  const walkInId = await ensureWalkInParty(company.id);

  const create = async (input: Record<string, unknown>) =>
    (await parties.createParty(owner, input)).party;
  const rahim = await create({
    kind: "BUYER",
    code: "B-RAHIM",
    name: "Rahim Traders",
    phone: "01711000001",
    city: "Dhaka",
    creditLimit: 50_000,
  });
  const karim = await create({ kind: "BUYER", name: "Karim Fashion", buyerType: "RETAIL" });
  const delta = await create({ kind: "SUPPLIER", name: "Delta Fabrics", city: "Narayanganj" });

  const post = async (
    date: string,
    sourceType: JournalSource,
    description: string,
    lines: Array<{ accountId: string; partyId?: string; debit?: number; credit?: number }>,
  ) =>
    prisma.journalEntry.create({
      data: {
        companyId: company.id,
        number: await nextDocumentNumber(prisma, company.id, "JOURNAL_VOUCHER"),
        date: new Date(`${date}T06:00:00Z`),
        sourceType,
        description,
        lines: {
          create: lines.map((l) => ({ ...l, debit: l.debit ?? 0, credit: l.credit ?? 0 })),
        },
      },
    });
  await post("2026-09-01", "SALE", "Invoice INV-1", [
    { accountId: accounts.RECEIVABLE, partyId: rahim.id, debit: 12_000 },
    { accountId: accounts.SALES, credit: 12_000 },
  ]);
  await post("2026-09-10", "SUPPLIER_BILL", "Bill from Delta", [
    { accountId: accounts.COGS, debit: 5_000 },
    { accountId: accounts.PAYABLE, partyId: delta.id, credit: 5_000 },
  ]);
  await post("2026-09-15", "PAYMENT", "Payment received", [
    { accountId: accounts.CASH, debit: 2_000 },
    { accountId: accounts.RECEIVABLE, partyId: rahim.id, credit: 2_000 },
  ]);
  return { company, people, owner, walkInId, rahim, karim, delta };
}

type Market = Awaited<ReturnType<typeof market>>;

async function as(env: Market, who: Who): Promise<CompanyContext> {
  await signInAs(env.people[who].id, env.company.id);
  return requireCompanyPage();
}

const params = <T>(value: T) => Promise.resolve(value);
const noQuery = () => Promise.resolve({});

run("Buyers & suppliers screens", () => {
  beforeEach(resetDb);

  it("shows each page to the people its actions let in, and nothing to the others", async () => {
    const env = await market();
    const seen: Record<string, unknown> = {};

    for (const who of Object.keys(ROLES) as Who[]) {
      const ctx = await as(env, who);
      const view = ctx.can("parties.view");
      const manage = ctx.can("parties.manage");
      const ledgerView = ctx.can("parties.ledger.view");
      seen[who] = { view, manage, ledger: ledgerView, opening: ctx.can("accounts.manage") };

      const inMenu = visibleNavItems([...ctx.permissions]).some((i) => i.href === "/parties");
      expect(inMenu, who).toBe(view || ledgerView);
      const tabs = visiblePartiesTabs(ctx.permissions).map((t) => t.href);
      expect(tabs, who).toEqual([
        ...(view ? ["/parties/buyers", "/parties/suppliers"] : []),
        ...(ledgerView ? ["/parties/dues"] : []),
      ]);

      // Each screen's data comes exactly to the people its page is shown to.
      expect((await getPartyListAction({ kind: "BUYER" })).ok, `${who}: buyers`).toBe(view);
      expect((await listPartyRowsAction({ kind: "SUPPLIER" })).ok, `${who}: more`).toBe(view);
      expect((await getPartyScreenAction(env.rahim.id)).ok, `${who}: profile`).toBe(view);
      expect((await getPartyFormAction()).ok, `${who}: new form`).toBe(manage);
      expect((await getPartyFormAction(env.rahim.id)).ok, `${who}: edit form`).toBe(manage);
      expect((await getStatementScreenAction(env.rahim.id, {})).ok, `${who}: statement`).toBe(
        ledgerView,
      );
      expect((await getDuesScreenAction()).ok, `${who}: dues`).toBe(ledgerView);

      // The pages show "not part of your role" in the same cases.
      const one = { list: "buyers", partyId: env.rahim.id };
      expect(await rendered(PartiesPage()), `${who}: /parties`).toBe(
        tabs[0] ? `redirect ${tabs[0]}` : "no access",
      );
      const list = PartyListPage({ params: params({ list: "buyers" }), searchParams: noQuery() });
      expect(await rendered(list), `${who}: list`).toBe(view ? "page" : "no access");
      const profile = PartyPage({ params: params(one), searchParams: noQuery() });
      expect(await rendered(profile), `${who}: profile`).toBe(view ? "page" : "no access");
      const adding = NewPartyPage({ params: params({ list: "suppliers" }) });
      expect(await rendered(adding), `${who}: new`).toBe(manage ? "page" : "no access");
      const editing = EditPartyPage({ params: params(one) });
      expect(await rendered(editing), `${who}: edit`).toBe(manage ? "page" : "no access");
      const statement = StatementPage({ params: params(one), searchParams: noQuery() });
      expect(await rendered(statement), `${who}: statement`).toBe(
        ledgerView ? "page" : "no access",
      );
      expect(await rendered(DuesPage()), `${who}: dues`).toBe(ledgerView ? "page" : "no access");
    }

    expect(seen).toEqual({
      owner: { view: true, manage: true, ledger: true, opening: true },
      production: { view: true, manage: false, ledger: false, opening: false },
      sales: { view: true, manage: true, ledger: true, opening: false },
      store: { view: false, manage: false, ledger: false, opening: false },
      accounts: { view: true, manage: false, ledger: true, opening: true },
      employee: { view: false, manage: false, ledger: false, opening: false },
    });
  }, 90_000);

  it("offers each change exactly to the people the actions let make it", async () => {
    const env = await market();
    const accounts = [env.rahim, env.karim, env.delta];
    const walkIn = await prisma.party.findUniqueOrThrow({ where: { id: env.walkInId } });

    for (const who of ["owner", "production", "sales", "accounts"] as const) {
      const ctx = await as(env, who);
      const manage = ctx.can("parties.manage");

      const list = data(await getPartyListAction({ kind: "SUPPLIER" }), who);
      expect(list.canCreate, who).toBe(manage);
      const added = await createPartyAction({ kind: "SUPPLIER", name: `Mill of ${who}` });
      expect(added.ok, `${who}: add a supplier`).toBe(list.canCreate);
      expectRuleRefusal(added, who);
      if (added.ok) await prisma.party.delete({ where: { id: added.data.party.id } });

      for (const party of [...accounts, walkIn]) {
        const label = `${who} on ${party.name}`;
        const before = await prisma.party.findUniqueOrThrow({ where: { id: party.id } });
        const restore = () =>
          prisma.party.update({
            where: { id: party.id },
            data: {
              notes: before.notes,
              grade: before.grade,
              isVerified: before.isVerified,
              verifiedAt: before.verifiedAt,
              status: before.status,
              statusChangedAt: before.statusChangedAt,
            },
          });
        const screen = data(await getPartyScreenAction(party.id), label);
        expect(screen.can.edit, label).toBe(manage);
        expect(screen.can.statement, label).toBe(ctx.can("parties.ledger.view"));

        const noted = await updatePartyAction(party.id, { notes: "Prefers bKash" });
        expect(noted.ok, `${label}: notes`).toBe(screen.can.edit);
        expectRuleRefusal(noted, label);

        const graded = await setPartyGradeAction(party.id, { grade: "A_PLUS" });
        expect(graded.ok, `${label}: grade`).toBe(screen.can.standing);
        expectRuleRefusal(graded, label);
        const badged = await setPartyVerifiedAction(party.id, { isVerified: true });
        expect(badged.ok, `${label}: badge`).toBe(screen.can.standing);
        expectRuleRefusal(badged, label);

        // Every account starts active: each status is offered exactly where it works.
        for (const status of ["DORMANT", "CLOSED"] as const) {
          const moved = await changePartyStatusAction(party.id, { status });
          expect(moved.ok, `${label}: ${status}`).toBe(screen.can.statuses.includes(status));
          expectRuleRefusal(moved, label);
          await restore();
        }
        expect(await getStatementScreenAction(party.id, {}).then((r) => r.ok), label).toBe(
          screen.can.statement,
        );
        await restore();
      }

      // Opening balances: what Rahim owed before go-live, set by the people who may.
      const rahim = data(await getPartyScreenAction(env.rahim.id), who);
      const opened = await setOpeningBalanceAction(env.rahim.id, { amount: 1_500 });
      expect(opened.ok, `${who}: opening balance`).toBe(rahim.can.openingBalance);
      expectRuleRefusal(opened, who);
      if (opened.ok) {
        expect(opened.data.balance).toBe("11500.00");
        await ledger.setOpeningBalance(env.owner, env.rahim.id, { amount: 0 });
      }
    }

    const offered = async (who: Who, party: { id: string }) => (
      await as(env, who),
      data(await getPartyScreenAction(party.id), who).can
    );
    expect(await offered("sales", env.rahim)).toEqual({
      edit: true,
      standing: true,
      statuses: ["DORMANT", "CLOSED"],
      openingBalance: false,
      statement: true,
    });
    expect((await offered("sales", env.delta)).statuses).toEqual(["CLOSED"]);
    expect(await offered("sales", walkIn)).toEqual({
      edit: true,
      standing: false,
      statuses: [],
      openingBalance: false,
      statement: true,
    });
    expect(await offered("accounts", env.rahim)).toEqual({
      edit: false,
      standing: false,
      statuses: [],
      openingBalance: true,
      statement: true,
    });
    expect(await offered("production", env.rahim)).toEqual({
      edit: false,
      standing: false,
      statuses: [],
      openingBalance: false,
      statement: false,
    });
  }, 120_000);

  it("keeps Walk-in customers to its name and notes, and the kind until the balance is settled", async () => {
    const env = await market();
    await as(env, "sales");
    const refusal = (result: ActionResult<unknown>) =>
      result.ok ? "saved" : [result.error.code, result.error.message];

    const walkIn = data(await getPartyFormAction(env.walkInId), "walk-in form");
    expect(walkIn.editable).toEqual(["name", "notes"]);
    expect(walkIn.party?.isWalkIn).toBe(true);
    expect(refusal(await updatePartyAction(env.walkInId, { notes: "Counter sales" }))).toBe(
      "saved",
    );
    expect(refusal(await updatePartyAction(env.walkInId, { phone: "01700000000" }))).toEqual([
      "VALIDATION",
      "Walk-in customers is kept by the system for sales without a buyer profile. Only its name and notes can change.",
    ]);
    const profile = data(await getPartyScreenAction(env.walkInId), "walk-in profile");
    expect(profile.party.isWalkIn).toBe(true);
    expect(profile.possibleDuplicates).toEqual([]);
    expect(profile.lastTransactionOn).toBeNull();

    // Its sales name no buyer, so its last business is its latest sale that went ahead.
    const counterSale = (number: string, on: string, status?: "CANCELLED") =>
      prisma.salesOrder.create({
        data: {
          companyId: env.company.id,
          number,
          channel: "POS",
          orderDate: new Date(`${on}T06:00:00Z`),
          status,
        },
      });
    await counterSale("SO-T-1", "2026-09-20");
    await counterSale("SO-T-2", "2026-09-25", "CANCELLED");
    const sold = data(await getPartyScreenAction(env.walkInId), "walk-in after sales");
    expect(sold.lastTransactionOn).toBe("2026-09-20");
    const control = await ensureControlAccounts(env.company.id);
    await prisma.journalEntry.create({
      data: {
        companyId: env.company.id,
        number: "JV-T-1",
        date: new Date("2026-09-20T06:00:00Z"),
        sourceType: "SALE",
        lines: {
          create: [
            { accountId: control.RECEIVABLE, partyId: env.walkInId, debit: 900, credit: 0 },
            { accountId: control.SALES, debit: 0, credit: 900 },
          ],
        },
      },
    });
    await as(env, "sales");
    const dues = data(await getDuesScreenAction(), "dues with Walk-in");
    expect(dues.receivables.find((r) => r.id === env.walkInId)?.lastTransactionOn).toBe(
      "2026-09-20",
    );

    // Rahim owes 10,000, so the form offers only buyer or both, and the action agrees.
    const rahim = data(await getPartyFormAction(env.rahim.id), "Rahim's form");
    expect(rahim.kinds).toEqual(["BUYER", "BOTH"]);
    expect(rahim.editable).toBeNull();
    expect(refusal(await updatePartyAction(env.rahim.id, { kind: "SUPPLIER" }))).toEqual([
      "CONFLICT",
      "Settle the balance before changing between buyer and supplier.",
    ]);
    const karim = data(await getPartyFormAction(env.karim.id), "Karim's form");
    expect(karim.kinds).toEqual(["BUYER", "SUPPLIER", "BOTH"]);
    expect(refusal(await updatePartyAction(env.karim.id, { kind: "SUPPLIER" }))).toBe("saved");

    // Closing an account that still owes leaves it settling, as the profile then shows.
    const closed = data(
      await changePartyStatusAction(env.rahim.id, { status: "CLOSED", reason: "Moved away" }),
      "close",
    );
    expect(closed.party.status).toBe("SETTLING");
    expect(closed.note).toMatch(/Balance of 10000.00 is still open/);
    const settling = data(await getPartyScreenAction(env.rahim.id), "settling");
    expect(settling.can.statuses).toEqual(["ACTIVE", "CLOSED"]);

    // A supplier's opening balance can only be what was owed to them.
    await as(env, "accounts");
    expect(refusal(await setOpeningBalanceAction(env.delta.id, { amount: 800 }))).toEqual([
      "VALIDATION",
      "A supplier's opening balance is what you owed them, so it cannot be an amount they owed you.",
    ]);
    expect(refusal(await setOpeningBalanceAction(env.delta.id, { amount: -800 }))).toBe("saved");
  }, 60_000);

  it("shows the same balances on the lists, the profile, the statement and the dues", async () => {
    const env = await market();
    await as(env, "sales");

    const buyers = data(await getPartyListAction({ kind: "BUYER" }), "buyers");
    expect(buyers.items.map((p) => [p.name, p.balance, p.isWalkIn])).toEqual([
      ["Karim Fashion", "0.00", false],
      ["Rahim Traders", "10000.00", false],
      ["Walk-in customers", "0.00", true],
    ]);
    const suppliers = data(await getPartyListAction({ kind: "SUPPLIER" }), "suppliers");
    expect(suppliers.items.map((p) => [p.name, p.balance])).toEqual([
      ["Delta Fabrics", "-5000.00"],
    ]);
    const found = data(await getPartyListAction({ kind: "BUYER", search: "0171100" }), "search");
    expect(found.items.map((p) => p.code)).toEqual(["B-RAHIM"]);

    const profile = data(await getPartyScreenAction(env.rahim.id), "profile");
    expect(profile.money).toMatchObject({
      balance: "10000.00",
      position: "RECEIVABLE",
      creditLimit: "50000.00",
      creditAvailable: "40000.00",
    });
    expect(profile.whatsappDigits).toBe("8801711000001");
    const delta = data(await getPartyScreenAction(env.delta.id), "Delta");
    expect([delta.money.balance, delta.money.position]).toEqual(["-5000.00", "PAYABLE"]);

    const whole = data(await getStatementScreenAction(env.rahim.id, {}), "statement");
    expect(whole.summary).toMatchObject({
      openingBalance: "0.00",
      totalDebit: "12000.00",
      totalCredit: "2000.00",
      closingBalance: "10000.00",
      transactionCount: 2,
    });
    expect(whole.lines.map((l) => [l.day, l.details, l.debit, l.credit, l.balance])).toEqual([
      ["2026-09-01", "Invoice INV-1", "12000.00", "0.00", "12000.00"],
      ["2026-09-15", "Payment received", "0.00", "2000.00", "10000.00"],
    ]);
    expect([whole.from, whole.to, whole.hiddenCount, whole.can.print]).toEqual([
      null,
      null,
      0,
      true,
    ]);
    const later = data(
      await getStatementScreenAction(env.rahim.id, { from: "2026-09-10", to: "2026-09-30" }),
      "from the 10th",
    );
    expect(later.summary).toMatchObject({ openingBalance: "12000.00", closingBalance: "10000.00" });
    expect(later.lines.map((l) => l.day)).toEqual(["2026-09-15"]);

    const dues = data(await getDuesScreenAction(), "dues");
    expect([dues.totalReceivable, dues.totalPayable]).toEqual(["10000.00", "5000.00"]);
    expect(dues.receivables.map((r) => [r.name, r.amount, r.kind])).toEqual([
      ["Rahim Traders", "10000.00", "BUYER"],
    ]);
    expect(dues.payables.map((r) => [r.name, r.amount, r.kind])).toEqual([
      ["Delta Fabrics", "5000.00", "SUPPLIER"],
    ]);
  }, 60_000);

  it("shows a taken code on the code field", async () => {
    const env = await market();
    await as(env, "sales");
    const result = await createPartyAction({ kind: "BUYER", name: "Rahim again", code: "b-rahim" });
    expect(result.ok ? "saved" : [result.error.code, result.error.fieldErrors]).toEqual([
      "CONFLICT",
      { code: ["Code B-RAHIM is already used."] },
    ]);
  }, 30_000);
});
