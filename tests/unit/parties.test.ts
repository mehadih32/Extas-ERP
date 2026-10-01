import { describe, expect, it } from "vitest";

import { queryBoolean } from "@/lib/query-params";
import { fillTemplate, whatsappDigits, whatsappLink } from "@/modules/parties/contact";
import { monthsAgo } from "@/modules/parties/dormant.service";
import {
  createCampaignSchema,
  createPartySchema,
  dormantQuerySchema,
  listPartiesSchema,
} from "@/modules/parties/schemas";

describe("whatsapp helpers", () => {
  it("adds the Bangladesh country code to local mobile numbers", () => {
    expect(whatsappDigits("01711-223344")).toBe("8801711223344");
    expect(whatsappDigits("+880 1711 223344")).toBe("8801711223344");
    expect(whatsappDigits("00880 1711223344")).toBe("8801711223344");
  });

  it("rejects missing or too-short numbers", () => {
    expect(whatsappDigits(null)).toBeNull();
    expect(whatsappDigits("")).toBeNull();
    expect(whatsappDigits("12345")).toBeNull();
  });

  it("builds a wa.me link with an encoded message", () => {
    expect(whatsappLink("01711223344", "New stock & offers?")).toBe(
      "https://wa.me/8801711223344?text=New%20stock%20%26%20offers%3F",
    );
    expect(whatsappLink(undefined, "hi")).toBeNull();
  });
});

describe("message templates", () => {
  it("fills known placeholders and leaves unknown ones untouched", () => {
    expect(
      fillTemplate("Hi {ContactPerson} of {BuyerName}, {CompanyName} misses you. {Other}", {
        ContactPerson: "Rahim",
        BuyerName: "Rahim Traders",
        CompanyName: "Extras",
      }),
    ).toBe("Hi Rahim of Rahim Traders, Extras misses you. {Other}");
  });
});

describe("monthsAgo", () => {
  it("goes back whole calendar months", () => {
    const now = new Date(2026, 9, 15, 12); // 15 Oct 2026
    expect(monthsAgo(6, now)).toEqual(new Date(2026, 3, 15, 12));
    expect(monthsAgo(12, now)).toEqual(new Date(2025, 9, 15, 12));
  });
});

describe("party schemas", () => {
  it("refuses a buyer type on a supplier", () => {
    const result = createPartySchema.safeParse({
      kind: "SUPPLIER",
      name: "Dhaka Fabrics",
      buyerType: "WHOLESALE",
    });
    expect(result.success).toBe(false);
  });

  it("uppercases codes and turns an empty email into null", () => {
    const parsed = createPartySchema.parse({
      kind: "BUYER",
      name: "Rahim Traders",
      code: "buy-0099",
      email: "",
    });
    expect(parsed.code).toBe("BUY-0099");
    expect(parsed.email).toBeNull();
  });

  it('reads "false" in a query string as false', () => {
    expect(queryBoolean.parse("false")).toBe(false);
    expect(queryBoolean.parse("true")).toBe(true);
    expect(listPartiesSchema.parse({ verified: "false" }).verified).toBe(false);
    expect(listPartiesSchema.safeParse({ verified: "maybe" }).success).toBe(false);
  });

  it("accepts buyer types as a comma list", () => {
    expect(
      dormantQuerySchema.parse({ months: "12", buyerTypes: "WHOLESALE,B2B_CORPORATE" }),
    ).toEqual({ months: 12, buyerTypes: ["WHOLESALE", "B2B_CORPORATE"] });
    expect(dormantQuerySchema.safeParse({ buyerTypes: "WHOLESALE,VIP" }).success).toBe(false);
  });

  it("only allows WhatsApp, email or SMS campaigns", () => {
    const base = { name: "Winter", inactivityMonths: 6, message: "Hello {BuyerName}" };
    expect(createCampaignSchema.safeParse({ ...base, channel: "WHATSAPP" }).success).toBe(true);
    expect(createCampaignSchema.safeParse({ ...base, channel: "IN_APP" }).success).toBe(false);
  });
});
