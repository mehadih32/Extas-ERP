import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The sign-in screens' form handlers and the screens' gatekeepers, run against the
 * database with Next.js' request helpers replaced: a cookie jar, the request
 * headers, and redirect() throwing so the test can see where it sends people.
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
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { prisma } from "@/lib/prisma";
import { REQUESTED_PATH_HEADER } from "@/lib/routes";
import { login } from "@/modules/auth/auth.service";
import { requireCompany } from "@/modules/auth/context";
import { validateSessionToken } from "@/modules/auth/session.service";
import { canSeeFinancials, canSeeSalesAmounts, canSeeStock } from "@/modules/dashboard/access";
import {
  changePasswordFormAction,
  selectCompanyAction,
  signInFormAction,
  signOutAction,
} from "@/server/actions/auth-forms.actions";
import {
  getDashboardInsightsAction,
  getMetricCardsAction,
} from "@/server/actions/dashboard.actions";
import { requireCompanyPage, requireSessionPage } from "@/server/pages/guards";

import { PASSWORD, addToCompany, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

/** Where a screen or form handler sent the person (it must have redirected). */
async function redirectOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const to = (error as { redirectedTo?: string }).redirectedTo;
    if (to) return to;
    throw error;
  }
  throw new Error("Expected a redirect");
}

/** Signs the browser in, as the sign-in screen would. */
async function signInBrowser(email: string) {
  const { token } = await login({ email, password: PASSWORD });
  browser.cookies.set(SESSION_COOKIE, token);
  return token;
}

async function companyWithSalesExecutive(email = "sales@extras.test") {
  const { company, roles } = await makeCompany("Extras");
  const user = await makeUser(email);
  await addToCompany(user.id, company.id, roles.SALES_EXECUTIVE);
  return { company, roles, user };
}

run("sign-in screens and screen gatekeepers", () => {
  beforeEach(async () => {
    await resetDb();
    browser.cookies.clear();
    browser.headers = new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "vitest" });
  });

  describe("signing in", () => {
    it("keeps the email and says what went wrong, without signing in", async () => {
      await companyWithSalesExecutive();
      const state = await signInFormAction(
        null,
        form({ email: "sales@extras.test", password: "Wrong-pass1" }),
      );
      expect(state).toMatchObject({
        email: "sales@extras.test",
        error: { code: "INVALID_CREDENTIALS", message: "Incorrect email or password." },
      });
      expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
    });

    it("signs in and opens the page that was asked for", async () => {
      const { company } = await companyWithSalesExecutive();
      const to = await redirectOf(
        signInFormAction(
          null,
          form({ email: "sales@extras.test", password: PASSWORD, next: "/?period=this-month" }),
        ),
      );
      expect(to).toBe("/?period=this-month");
      const session = await validateSessionToken(browser.cookies.get(SESSION_COOKIE)!);
      expect(session?.session.activeCompanyId).toBe(company.id);
    });

    it("never sends people to another site after signing in", async () => {
      await companyWithSalesExecutive();
      for (const next of ["https://evil.example/", "//evil.example", "/sign-in"]) {
        browser.cookies.clear();
        const to = await redirectOf(
          signInFormAction(null, form({ email: "sales@extras.test", password: PASSWORD, next })),
        );
        expect(to, next).toBe("/");
      }
    });

    it("sends a temporary password to the new-password screen first", async () => {
      const { user } = await companyWithSalesExecutive();
      await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
      const to = await redirectOf(
        signInFormAction(
          null,
          form({ email: "sales@extras.test", password: PASSWORD, next: "/sales" }),
        ),
      );
      expect(to).toBe("/change-password");
    });

    it("sends someone without a company to the company list", async () => {
      await makeUser("new@extras.test");
      const to = await redirectOf(
        signInFormAction(null, form({ email: "new@extras.test", password: PASSWORD })),
      );
      expect(to).toBe("/select-company");
    });
  });

  describe("the screens' gatekeepers", () => {
    it("send a visitor without a session to sign in, and back to the page afterwards", async () => {
      browser.headers.set(REQUESTED_PATH_HEADER, "/sales?tab=open");
      expect(await redirectOf(requireCompanyPage())).toBe("/sign-in?next=%2Fsales%3Ftab%3Dopen");
      expect(await redirectOf(requireSessionPage())).toBe("/sign-in?next=%2Fsales%3Ftab%3Dopen");
      browser.headers.set(REQUESTED_PATH_HEADER, "/");
      expect(await redirectOf(requireCompanyPage())).toBe("/sign-in");
    });

    it("treat a session ended elsewhere like no session", async () => {
      await companyWithSalesExecutive();
      const token = await signInBrowser("sales@extras.test");
      await prisma.session.deleteMany();
      expect(browser.cookies.get(SESSION_COOKIE)).toBe(token);
      expect(await redirectOf(requireCompanyPage())).toBe("/sign-in");
    });

    it("hold everything back until a temporary password is replaced", async () => {
      const { user } = await companyWithSalesExecutive();
      await signInBrowser("sales@extras.test");
      await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
      expect(await redirectOf(requireCompanyPage())).toBe("/change-password");
      // The new-password screen itself only needs the session.
      expect((await requireSessionPage()).user.id).toBe(user.id);
    });

    it("send someone who lost access to the open company to the company list", async () => {
      const { company, user } = await companyWithSalesExecutive();
      await signInBrowser("sales@extras.test");
      await prisma.companyMembership.updateMany({
        where: { userId: user.id, companyId: company.id },
        data: { isActive: false },
      });
      expect(await redirectOf(requireCompanyPage())).toBe("/select-company");
    });

    it("let a signed-in member through with their role in the open company", async () => {
      const { company, user } = await companyWithSalesExecutive();
      await signInBrowser("sales@extras.test");
      const ctx = await requireCompanyPage();
      expect(ctx.user.id).toBe(user.id);
      expect(ctx.company.id).toBe(company.id);
      expect(ctx.role?.systemRole).toBe("SALES_EXECUTIVE");
    });
  });

  describe("changing the password", () => {
    it("catches two different new passwords before trying", async () => {
      const { user } = await companyWithSalesExecutive();
      await signInBrowser("sales@extras.test");
      const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const state = await changePasswordFormAction(
        null,
        form({
          currentPassword: PASSWORD,
          newPassword: "Rafiq2026x",
          confirmPassword: "Rafiq2026y",
        }),
      );
      expect(state?.error?.fieldErrors?.confirmPassword).toEqual([
        "The two new passwords do not match.",
      ]);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.passwordHash).toBe(before.passwordHash);
    });

    it("passes on the backend's own password rules", async () => {
      await companyWithSalesExecutive();
      await signInBrowser("sales@extras.test");
      const state = await changePasswordFormAction(
        null,
        form({ currentPassword: PASSWORD, newPassword: "short", confirmPassword: "short" }),
      );
      expect(state?.error?.code).toBe("VALIDATION");
      expect(state?.error?.fieldErrors?.newPassword?.length).toBeGreaterThan(0);
    });

    it("lets a new person into the app once their own password is set", async () => {
      const { user } = await companyWithSalesExecutive();
      await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
      await signInBrowser("sales@extras.test");
      const to = await redirectOf(
        changePasswordFormAction(
          null,
          form({
            currentPassword: PASSWORD,
            newPassword: "Rafiq2026x",
            confirmPassword: "Rafiq2026x",
          }),
        ),
      );
      expect(to).toBe("/");
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.mustChangePassword).toBe(false);
      expect((await requireCompany()).user.id).toBe(user.id);
    });

    it("signs out the person's other devices only when they ask", async () => {
      await companyWithSalesExecutive();
      const { token: otherDevice } = await login({
        email: "sales@extras.test",
        password: PASSWORD,
      });
      await signInBrowser("sales@extras.test");

      const kept = await changePasswordFormAction(
        null,
        form({
          currentPassword: PASSWORD,
          newPassword: "Rafiq2026x",
          confirmPassword: "Rafiq2026x",
        }),
      );
      expect(kept).toEqual({ changed: { otherSessionsRevoked: 0 } });
      expect(await validateSessionToken(otherDevice)).not.toBeNull();

      const signedOut = await changePasswordFormAction(
        null,
        form({
          currentPassword: "Rafiq2026x",
          newPassword: "Rafiq2027x",
          confirmPassword: "Rafiq2027x",
          signOutOtherDevices: "on",
        }),
      );
      expect(signedOut).toEqual({ changed: { otherSessionsRevoked: 1 } });
      expect(await validateSessionToken(otherDevice)).toBeNull();
      expect(await validateSessionToken(browser.cookies.get(SESSION_COOKIE)!)).not.toBeNull();
    });
  });

  describe("signing out and choosing a company", () => {
    it("ends this device's session and goes back to sign-in", async () => {
      await companyWithSalesExecutive();
      const token = await signInBrowser("sales@extras.test");
      expect(await redirectOf(signOutAction())).toBe("/sign-in");
      expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
      expect(await validateSessionToken(token)).toBeNull();
    });

    it("opens a company the person belongs to, and refuses any other", async () => {
      const { user } = await companyWithSalesExecutive();
      const other = await makeCompany("Fabric Apparel");
      const stranger = await makeCompany("Someone Else");
      await addToCompany(user.id, other.company.id, other.roles.ACCOUNTS);
      const token = await signInBrowser("sales@extras.test");

      expect(await redirectOf(selectCompanyAction(other.company.id))).toBe("/");
      expect((await validateSessionToken(token))?.session.activeCompanyId).toBe(other.company.id);

      const refused = await selectCompanyAction(stranger.company.id);
      expect(refused?.code).toBe("FORBIDDEN");
      expect((await validateSessionToken(token))?.session.activeCompanyId).toBe(other.company.id);
    });
  });

  describe("the dashboard for each role", () => {
    const ROLES = [
      "SUPER_ADMIN",
      "ACCOUNTS",
      "SALES_EXECUTIVE",
      "PRODUCTION_MANAGER",
      "WAREHOUSE_TEAM",
      "EMPLOYEE",
    ] as const;

    it("shows each section exactly when the backend gives its figures", async () => {
      const { company, roles } = await makeCompany("Extras");
      for (const systemRole of ROLES) {
        const email = `${systemRole.toLowerCase()}@extras.test`;
        const user = await makeUser(email);
        await addToCompany(user.id, company.id, roles[systemRole]);
        await signInBrowser(email);

        const ctx = await requireCompanyPage();
        const cards = await getMetricCardsAction();
        const insights = await getDashboardInsightsAction({});
        // The screen shows the key figures and the Insights exactly when these succeed.
        expect(cards.ok, `${systemRole} key figures`).toBe(canSeeFinancials(ctx));
        expect(insights.ok, `${systemRole} insights`).toBe(canSeeStock(ctx));
        if (!cards.ok) expect(cards.error.code).toBe("FORBIDDEN");
        if (!insights.ok) {
          expect(insights.error.code).toBe("FORBIDDEN");
          continue;
        }
        // Money columns: shown only to those the backend sends the money to.
        const { topSellers, deadAndSlow } = insights.data;
        expect(topSellers.totals.net === null, `${systemRole} sales values`).toBe(
          !canSeeSalesAmounts(ctx),
        );
        expect(deadAndSlow.dead.value === null, `${systemRole} stock values`).toBe(
          !canSeeFinancials(ctx),
        );
        // Ranking by sales value is offered only where the backend allows it.
        const bySales = await getDashboardInsightsAction({ sortBy: "REVENUE" });
        expect(bySales.ok, `${systemRole} rank by sales`).toBe(canSeeSalesAmounts(ctx));
      }
    });

    it("gives sales staff the sales values but not costs or margins", async () => {
      const { user } = await companyWithSalesExecutive();
      await signInBrowser("sales@extras.test");
      const ctx = await requireCompanyPage();
      expect(ctx.user.id).toBe(user.id);
      expect([canSeeFinancials(ctx), canSeeStock(ctx), canSeeSalesAmounts(ctx)]).toEqual([
        false,
        true,
        true,
      ]);
    });
  });
});
