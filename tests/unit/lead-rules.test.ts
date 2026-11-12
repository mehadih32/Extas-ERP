import { describe, expect, it } from "vitest";

import {
  cleanCompanyName,
  companyDomain,
  keysOf,
  leadCheck,
  leadNumber,
  matchDuplicates,
  suppressionHash,
  suppressionValue,
  websiteDomain,
} from "@/modules/leads/rules";

/*
 * Leads phase 1: the plain rules behind the duplicate warning, "Do not
 * contact" and the lead check card (no database).
 */

describe("Lead duplicates", () => {
  it("reads websites and company emails the same way, and ignores free mail", () => {
    expect(websiteDomain("https://WWW.Nordic-Wear.com/about")).toBe("nordic-wear.com");
    expect(companyDomain("anna@nordic-wear.com")).toBe("nordic-wear.com");
    expect(companyDomain("anna@gmail.com")).toBeNull();
    expect(cleanCompanyName("Nordic Wear GmbH")).toBe(cleanCompanyName("nordic wear"));
  });

  it("calls the same email or website a strong match, a similar name a weak one", () => {
    const lead = keysOf({
      name: "Nordic Wear",
      website: "nordic-wear.com",
      emails: ["Anna@Nordic-Wear.com"],
    });
    const same = keysOf({
      name: "Something else",
      website: null,
      emails: ["anna@nordic-wear.com"],
    });
    const similar = keysOf({ name: "Nordic Wear Ltd", website: null });
    const other = keysOf({ name: "Dhaka Polo House", website: null });
    const found = matchDuplicates(lead, [
      { ...same, id: "a", label: "LD-0001", kind: "LEAD" },
      { ...similar, id: "b", label: "Nordic Wear Ltd", kind: "BUYER" },
      { ...other, id: "c", label: "LD-0002", kind: "LEAD" },
    ]);
    expect(found.map((m) => [m.id, m.strong])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });
});

describe("Do not contact", () => {
  it("keeps only a per-company code of the email, never the email itself", () => {
    const value = suppressionValue("EMAIL", " Anna@Nordic-Wear.com ")!;
    expect(value).toBe("anna@nordic-wear.com");
    const one = suppressionHash("company-1", value);
    expect(one).not.toContain("anna");
    expect(suppressionHash("company-2", value)).not.toBe(one);
  });
});

describe("Lead check card", () => {
  const rules = {
    productFocus: ["Polo", "T-shirt"],
    minPieces: 1000,
    priceMin: 300,
    priceMax: 900,
    targetCountries: ["Germany"],
    riskyCountries: ["Nowhereland"],
  };
  const base = {
    products: ["Polo"],
    piecesPerStyle: 1500,
    targetPrice: 450,
    country: "Germany",
    paymentTerms: "TT" as const,
    contacts: [
      { isDecisionMaker: true, email: "a@b.com", phone: null, whatsapp: null, erased: false },
    ],
  };

  it("shows five checks, all green for a lead that fits", () => {
    const card = leadCheck(base, rules, "BDT");
    expect(card.map((c) => c.key)).toEqual(["products", "quantity", "price", "risk", "decider"]);
    expect(card.every((c) => c.colour === "green")).toBe(true);
    expect(card.every((c) => c.reason.length > 0)).toBe(true);
  });

  it("turns red for the wrong product, far too few pieces, a low price or a risky country", () => {
    const card = leadCheck(
      {
        ...base,
        products: ["Denim jacket"],
        piecesPerStyle: 200,
        targetPrice: 100,
        country: "Nowhereland",
      },
      rules,
      "BDT",
    );
    const colour = Object.fromEntries(card.map((c) => [c.key, c.colour]));
    expect(colour).toMatchObject({ products: "red", quantity: "red", price: "red", risk: "red" });
  });

  it("is yellow, not red, while something is simply not known yet", () => {
    const card = leadCheck(
      { ...base, products: [], piecesPerStyle: null, targetPrice: null, contacts: [] },
      rules,
      "BDT",
    );
    const colour = Object.fromEntries(card.map((c) => [c.key, c.colour]));
    expect(colour).toMatchObject({ products: "yellow", quantity: "yellow", price: "yellow" });
  });

  it("numbers leads LD-0001", () => {
    expect(leadNumber(1)).toBe("LD-0001");
  });
});
