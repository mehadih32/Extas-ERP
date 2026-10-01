import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { MAX_FAILED_LOGINS, changePassword, login, logout } from "@/modules/auth/auth.service";
import { validateSessionToken } from "@/modules/auth/session.service";
import { switchCompany } from "@/modules/companies/company.service";

import { PASSWORD, addToCompany, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

run("login and sessions", () => {
  beforeEach(resetDb);

  it("signs in, opens the user's company and creates a valid session", async () => {
    const { company, roles } = await makeCompany("Extras");
    const user = await makeUser("sales@extras.test");
    await addToCompany(user.id, company.id, roles.SALES_EXECUTIVE);

    const result = await login({ email: "  SALES@extras.test ", password: PASSWORD });
    expect(result.activeCompanyId).toBe(company.id);

    const session = await validateSessionToken(result.token);
    expect(session?.user.id).toBe(user.id);
    expect(session?.session.activeCompanyId).toBe(company.id);
    expect(await prisma.auditLog.count({ where: { action: "LOGIN", userId: user.id } })).toBe(1);
  });

  it("rejects wrong passwords and unknown emails with the same message", async () => {
    await makeUser("a@extras.test");
    const wrong = login({ email: "a@extras.test", password: "nope12345" });
    await expect(wrong).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const unknown = login({ email: "ghost@extras.test", password: "nope12345" });
    await expect(unknown).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Incorrect email or password.",
    });
  });

  it("locks the account after repeated failures, even for the right password", async () => {
    await makeUser("b@extras.test");
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await login({ email: "b@extras.test", password: "wrong-pass1" }).catch(() => undefined);
    }
    await expect(login({ email: "b@extras.test", password: PASSWORD })).rejects.toMatchObject({
      code: "ACCOUNT_LOCKED",
    });
  });

  it("blocks suspended users", async () => {
    const user = await makeUser("c@extras.test");
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    await expect(login({ email: "c@extras.test", password: PASSWORD })).rejects.toMatchObject({
      code: "ACCOUNT_DISABLED",
    });
  });

  it("logs out by deleting the session", async () => {
    await makeUser("d@extras.test");
    const { token } = await login({ email: "d@extras.test", password: PASSWORD });
    const current = (await validateSessionToken(token))!;
    await logout(current.session);
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("changes the password and signs out other devices", async () => {
    const user = await makeUser("e@extras.test");
    const first = await login({ email: "e@extras.test", password: PASSWORD });
    const second = await login({ email: "e@extras.test", password: PASSWORD });
    const current = (await validateSessionToken(second.token))!;

    const { otherSessionsRevoked } = await changePassword(
      { userId: user.id, sessionId: current.session.id, companyId: null },
      { currentPassword: PASSWORD, newPassword: "NewPass2026", signOutOtherDevices: true },
    );
    expect(otherSessionsRevoked).toBe(1);
    expect(await validateSessionToken(first.token)).toBeNull();
    expect(await validateSessionToken(second.token)).not.toBeNull();
    await expect(login({ email: "e@extras.test", password: PASSWORD })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await expect(login({ email: "e@extras.test", password: "NewPass2026" })).resolves.toBeTruthy();
  });

  it("expired sessions are rejected", async () => {
    await makeUser("f@extras.test");
    const { token } = await login({ email: "f@extras.test", password: PASSWORD });
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(token)).toBeNull();
  });
});

run("company switching", () => {
  beforeEach(resetDb);

  it("switches only to companies the user belongs to", async () => {
    const extras = await makeCompany("Extras");
    const fabric = await makeCompany("Fabric Apparel");
    const other = await makeCompany("Other Brand");
    const user = await makeUser("pm@extras.test");
    await addToCompany(user.id, extras.company.id, extras.roles.PRODUCTION_MANAGER);
    await addToCompany(user.id, fabric.company.id, fabric.roles.SALES_EXECUTIVE);

    const { token } = await login({ email: "pm@extras.test", password: PASSWORD });
    const current = (await validateSessionToken(token))!;

    const switched = await switchCompany(current, fabric.company.id);
    expect(switched.role?.systemRole).toBe("SALES_EXECUTIVE");
    expect(switched.permissions).toContain("sales.order.create");
    expect(switched.permissions).not.toContain("production.manage");
    expect((await validateSessionToken(token))!.session.activeCompanyId).toBe(fabric.company.id);

    await expect(switchCompany(current, other.company.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("reopens the last used company on the next login", async () => {
    const extras = await makeCompany("Extras");
    const fabric = await makeCompany("Fabric Apparel");
    const user = await makeUser("g@extras.test");
    await addToCompany(user.id, extras.company.id, extras.roles.EMPLOYEE);
    await addToCompany(user.id, fabric.company.id, fabric.roles.EMPLOYEE);

    const first = await login({ email: "g@extras.test", password: PASSWORD });
    await switchCompany((await validateSessionToken(first.token))!, fabric.company.id);
    const second = await login({ email: "g@extras.test", password: PASSWORD });
    expect(second.activeCompanyId).toBe(fabric.company.id);
  });

  it("lets the platform owner open any active company", async () => {
    const extras = await makeCompany("Extras");
    const owner = await makeUser("owner@extras.test", { isSuperAdmin: true });
    const { token, activeCompanyId } = await login({
      email: "owner@extras.test",
      password: PASSWORD,
    });
    expect(activeCompanyId).toBe(extras.company.id);
    const switched = await switchCompany((await validateSessionToken(token))!, extras.company.id);
    expect(switched.permissions).toContain("sales.force_override");
    expect(owner.isSuperAdmin).toBe(true);
  });
});
