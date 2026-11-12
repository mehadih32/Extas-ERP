import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Buyers & suppliers > Campaigns (Release 5): one message to many buyers, with
 * {name} filled in for each, picked by hand from dormant buyers, a country or
 * a search; each buyer's message opens in WhatsApp or email for a person to
 * send, with "Sent" (ticked on open, can be taken off) and "Replied" ticks.
 * The ERP itself sends nothing, and only roles with "sales.campaigns.manage"
 * get in.
 */
const signedIn = vi.hoisted(() => ({ ctx: null as unknown }));
const sent = vi.hoisted(() => ({ fetches: 0 }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/auth/context", async (original) => {
  const real = await original<typeof import("@/modules/auth/context")>();
  const { AppError } = await import("@/lib/errors");
  return {
    ...real,
    requirePermission: async (...keys: string[]) => {
      const ctx = signedIn.ctx as import("@/modules/auth/context").CompanyContext;
      if (keys.some((k) => !ctx.permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx;
    },
  };
});

import { prisma } from "@/lib/prisma";
import * as dormant from "@/modules/parties/dormant.service";
import * as parties from "@/modules/parties/party.service";
import {
  campaignBuyersAction,
  createCampaignAction,
  getCampaignAction,
  listCampaignsAction,
  updateCampaignRecipientAction,
} from "@/server/actions/parties.actions";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const admin = await makeUser("admin@extras.test");
  await addToCompany(admin.id, company.id, roles.SUPER_ADMIN);
  const ctx = await contextFor(admin.id, company.id);
  signedIn.ctx = ctx;
  const buyer = async (
    name: string,
    monthsIdle: number,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; name: string }> => {
    const { party } = await parties.createParty(ctx, { kind: "BUYER", name, ...extra });
    await prisma.party.update({
      where: { id: party.id },
      data: {
        lastTransactionAt: dormant.monthsAgo(monthsIdle),
        createdAt: dormant.monthsAgo(30),
      },
    });
    return party;
  };
  const hans = await buyer("Hans Mode", 9, {
    country: "Germany",
    whatsapp: "+49 151 1234567",
    email: "hans@mode.test",
    contactPerson: "Hans",
  });
  const berlin = await buyer("Berlin Kids", 8, { country: "Germany", phone: "+49 160 7654321" });
  const dubai = await buyer("Dubai Basics", 1, {
    country: "United Arab Emirates",
    whatsapp: "+971 50 1112233",
  });
  const silent = await buyer("No Contact Ltd", 10, { country: "Germany" });
  return { company, roles, ctx, hans, berlin, dubai, silent };
}

function ok<T>(result: { ok: true; data: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

run("Campaigns screen (manual send)", () => {
  beforeEach(async () => {
    await resetDb();
    sent.fetches = 0;
  });

  it("lists the buyers to pick from with dormant, country and who can be reached", async () => {
    const env = await setup();
    const picker = ok(await campaignBuyersAction());
    expect(picker.dormantMonths).toBe(6);
    expect(picker.countries).toEqual(["Germany", "United Arab Emirates"]);
    const by = Object.fromEntries(picker.buyers.map((b) => [b.name, b]));
    expect(by["Hans Mode"]).toMatchObject({ dormant: true, whatsapp: true, email: true });
    expect(by["Berlin Kids"]).toMatchObject({ dormant: true, whatsapp: true, email: false });
    expect(by["Dubai Basics"]).toMatchObject({ dormant: false, country: "United Arab Emirates" });
    expect(by["No Contact Ltd"]).toMatchObject({ whatsapp: false, email: false });
    // The walk-in account and suppliers are never offered.
    expect(picker.buyers.map((b) => b.id).sort()).toEqual(
      [env.hans.id, env.berlin.id, env.dubai.id, env.silent.id].sort(),
    );
  });

  it("fills {name} for each hand-picked buyer and opens, never sends, the message", async () => {
    const env = await setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      sent.fetches += 1;
      return new Response("{}");
    });
    try {
      const made = ok(
        await createCampaignAction({
          name: "Winter catalogue",
          channel: "WHATSAPP",
          message: "Dear {name}, our winter styles are ready.",
          inactivityMonths: 6,
          partyIds: [env.hans.id, env.dubai.id],
        }),
      );
      expect(made.recipientCount).toBe(2);
      const detail = ok(await getCampaignAction(made.campaign.id));
      const hans = detail.recipients.find((r) => r.party.id === env.hans.id)!;
      expect(hans.message).toBe("Dear Hans Mode, our winter styles are ready.");
      expect(hans.link).toBe(`https://wa.me/491511234567?text=${encodeURIComponent(hans.message)}`);
      expect(detail.recipients.every((r) => r.status === "PENDING")).toBe(true);
      // Nothing left the ERP: no message, no bot push, no email.
      expect(sent.fetches).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await prisma.backgroundJob.count()).toBe(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("an email campaign fills the address, subject and body", async () => {
    const env = await setup();
    const made = ok(
      await createCampaignAction({
        name: "Spring offer",
        channel: "EMAIL",
        message: "Hello {name}",
        inactivityMonths: 6,
        partyIds: [env.hans.id],
      }),
    );
    const [r] = ok(await getCampaignAction(made.campaign.id)).recipients;
    expect(r!.link).toBe(
      `mailto:hans@mode.test?subject=${encodeURIComponent("Spring offer")}&body=${encodeURIComponent("Hello Hans Mode")}`,
    );
  });

  it("refuses a buyer who cannot be reached on the chosen channel", async () => {
    const env = await setup();
    const result = await createCampaignAction({
      name: "Email nobody",
      channel: "EMAIL",
      message: "Hi {name}",
      inactivityMonths: 6,
      partyIds: [env.berlin.id, env.silent.id],
    });
    expect(result.ok).toBe(false);
  });

  it("ticks Sent and Replied, takes Sent back off, and counts them", async () => {
    const env = await setup();
    const made = ok(
      await createCampaignAction({
        name: "Germany",
        channel: "WHATSAPP",
        message: "Hi {name}",
        inactivityMonths: 6,
        partyIds: [env.hans.id, env.berlin.id],
      }),
    );
    const id = made.campaign.id;
    const [a, b] = ok(await getCampaignAction(id)).recipients;

    // Opening the message ticks Sent; Replied is ticked by hand.
    ok(await updateCampaignRecipientAction(id, a!.id, { status: "SENT" }));
    ok(await updateCampaignRecipientAction(id, a!.id, { status: "SENT", responded: true }));
    ok(await updateCampaignRecipientAction(id, b!.id, { status: "SENT" }));
    let [row] = ok(await listCampaignsAction());
    expect(row).toMatchObject({ status: "SENDING", recipients: 2, responded: 1 });
    expect(row!.delivery.SENT).toBe(2);

    // Opened but never sent: the tick comes off and the sent time goes with it.
    ok(await updateCampaignRecipientAction(id, b!.id, { status: "PENDING" }));
    const back = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: b!.id } });
    expect(back).toMatchObject({ status: "PENDING", sentAt: null });
    ok(await updateCampaignRecipientAction(id, a!.id, { status: "SENT", responded: false }));
    [row] = ok(await listCampaignsAction());
    expect(row!.delivery).toMatchObject({ SENT: 1, PENDING: 1 });
    expect(row!.responded).toBe(0);
  });

  it("is only for roles with the campaigns permission", async () => {
    const env = await setup();
    const clerk = await makeUser("accounts@extras.test");
    await addToCompany(clerk.id, env.company.id, env.roles.ACCOUNTS);
    signedIn.ctx = await contextFor(clerk.id, env.company.id);
    for (const result of [
      await listCampaignsAction(),
      await campaignBuyersAction(),
      await createCampaignAction({
        name: "X",
        channel: "WHATSAPP",
        message: "Hi {name}",
        inactivityMonths: 6,
        partyIds: [env.hans.id],
      }),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    }

    // A Sales Executive holds it.
    const sales = await makeUser("sales@extras.test");
    await addToCompany(sales.id, env.company.id, env.roles.SALES_EXECUTIVE);
    signedIn.ctx = await contextFor(sales.id, env.company.id);
    expect((await campaignBuyersAction()).ok).toBe(true);
  });

  it("keeps each company's campaigns and buyers apart", async () => {
    const env = await setup();
    const made = ok(
      await createCampaignAction({
        name: "Ours",
        channel: "WHATSAPP",
        message: "Hi {name}",
        inactivityMonths: 6,
        partyIds: [env.hans.id],
      }),
    );
    const [r] = ok(await getCampaignAction(made.campaign.id)).recipients;

    const other = await makeCompany("Other Co");
    const boss = await makeUser("boss@other.test");
    await addToCompany(boss.id, other.company.id, other.roles.SUPER_ADMIN);
    signedIn.ctx = await contextFor(boss.id, other.company.id);
    expect(ok(await campaignBuyersAction()).buyers).toHaveLength(0);
    expect(ok(await listCampaignsAction())).toHaveLength(0);
    const peek = await getCampaignAction(made.campaign.id);
    expect(peek.ok).toBe(false);
    const tick = await updateCampaignRecipientAction(made.campaign.id, r!.id, { status: "SENT" });
    expect(tick.ok).toBe(false);
    const steal = await createCampaignAction({
      name: "Theirs",
      channel: "WHATSAPP",
      message: "Hi {name}",
      inactivityMonths: 6,
      partyIds: [env.hans.id],
    });
    expect(steal.ok).toBe(false);
  });
});
