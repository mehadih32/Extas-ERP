import { describe, expect, it } from "vitest";

import { type HealthCheck, fixesFor, worstOf } from "@/modules/ai/health/checks";
import { plainReport } from "@/modules/ai/health/health.service";
import {
  EMPTY_FIELDS,
  intakeChecks,
  isProblem,
  judgeDates,
  judgeMatch,
  judgeSizes,
  judgeTotals,
  missingFields,
  nextQuestion,
  type OrderFields,
  stepsFor,
  taDates,
} from "@/modules/ai/orders/order-run";

/*
 * Order automation and Server Health (part 10 of v6.2), the parts with no
 * database: what a new order still needs, Mehedi's one question, the intake
 * checks, the T&A back from the ship date, the steps after Approve, the
 * problem words in staff updates, and the Server Health report and fixes.
 */

const order = (over: Partial<OrderFields> = {}): OrderFields => ({
  ...EMPTY_FIELDS,
  buyer: "Nordic Wear AB",
  po: "NW-7781",
  lines: [
    { style: "PL-01", colour: "Navy", size: "M", quantity: 400 },
    { style: "PL-01", colour: "Navy", size: "L", quantity: 400 },
    { style: "PL-01", colour: "White", size: "M", quantity: 200 },
  ],
  quantity: 1000,
  shipDate: "2027-03-20",
  price: 6.4,
  currency: "USD",
  fabric: "Pique 220 GSM",
  logo: "Chest embroidery",
  packing: "Polybag, 24 a carton",
  ...over,
});

describe("a new order's form", () => {
  it("lists what is missing in the order Mehedi asks, one question at a time", () => {
    expect(missingFields(EMPTY_FIELDS)).toEqual([
      "buyer",
      "po",
      "lines",
      "quantity",
      "shipDate",
      "price",
      "fabric",
      "logo",
      "packing",
    ]);
    expect(nextQuestion(missingFields(EMPTY_FIELDS))).toBe(
      "Which buyer is this order for? (then 8 more)",
    );
    expect(missingFields(order({ shipDate: null, logo: "  " }))).toEqual(["shipDate", "logo"]);
    expect(nextQuestion(["logo"])).toBe("Which logo or print goes on it?");
    expect(nextQuestion([])).toBeNull();
    expect(missingFields(order())).toEqual([]);
  });

  it("checks the totals, the size spread and the mismatches", () => {
    expect(judgeTotals(order())).toMatchObject({ signal: "green" });
    expect(judgeTotals(order({ quantity: 1200 }))).toEqual({
      key: "totals",
      label: "Totals",
      signal: "red",
      reason: "The lines add up to 1,000 pieces but the PO says 1,200.",
    });
    expect(judgeTotals(order({ quantity: null })).signal).toBe("yellow");

    expect(judgeSizes(order().lines).signal).toBe("green");
    expect(
      judgeSizes([
        { style: "PL-01", colour: "Navy", size: "M", quantity: 700 },
        { style: "PL-01", colour: "Navy", size: "L", quantity: 300 },
      ]),
    ).toMatchObject({
      signal: "yellow",
      reason: expect.stringMatching(/size M is 70% of the colour/),
    });
    expect(judgeSizes([{ style: "PL-01", colour: "Navy", size: "XL", quantity: 0 }]).signal).toBe(
      "red",
    );

    expect(judgeMatch(order(), { buyerFound: true, styles: ["pl-01"] }).signal).toBe("green");
    const twice = order({
      lines: [
        { style: "PL-01", colour: "Navy", size: "M", quantity: 1 },
        { style: "PL-01", colour: "navy", size: "M", quantity: 2 },
        { style: "PL-09", colour: "Navy", size: "M", quantity: 2 },
      ],
    });
    expect(judgeMatch(twice, { buyerFound: false, styles: ["PL-01"] }).reason).toBe(
      "Nordic Wear AB is not a buyer in the ERP yet; PL-01 navy M is listed twice; new style PL-09 (a tech pack is needed).",
    );
    expect(
      intakeChecks(order(), {
        today: "2026-10-15",
        rules: [],
        buyerFound: true,
        styles: ["PL-01"],
      }).map((c) => c.key),
    ).toEqual(["totals", "sizes", "dates", "rules", "match"]);
  });

  it("plans the T&A back from the ship date and says when it is too tight", () => {
    expect(taDates("2027-03-20")).toEqual([
      { key: "techPack", label: "Tech pack approved", by: "2027-01-15" },
      { key: "booking", label: "Fabric booked", by: "2027-01-17" },
      { key: "cutting", label: "Fabric in house, cutting starts", by: "2027-02-16" },
      { key: "packed", label: "Sewn, finished and packed", by: "2027-03-13" },
      { key: "ship", label: "Ship", by: "2027-03-20" },
    ]);
    expect(judgeDates(order(), "2026-10-15").signal).toBe("green");
    expect(judgeDates(order(), "2027-01-08").signal).toBe("green");
    expect(judgeDates(order(), "2027-01-10").signal).toBe("yellow");
    expect(judgeDates(order(), "2027-01-20")).toMatchObject({
      signal: "red",
      reason:
        "The tech pack should have been approved by 2027-01-15 for this ship date: 5 days short.",
    });
    expect(judgeDates(order(), "2027-04-01").reason).toBe("The ship date has passed.");
    expect(judgeDates(order({ shipDate: null }), "2026-10-15").signal).toBe("yellow");
  });
});

describe("the steps after Approve", () => {
  it("marks each step done, late against its T&A day, or not yet", () => {
    const steps = stepsFor({
      today: "2027-01-18",
      shipDate: "2027-03-20",
      done: { costing: true, order: true, production: true },
      hrefs: { costing: "/production/costing/c1" },
    });
    expect(steps.map((s) => [s.key, s.state, s.by])).toEqual([
      ["costing", "done", null],
      ["order", "done", null],
      ["production", "done", null],
      ["techPack", "late", "2027-01-15"],
      ["booking", "late", "2027-01-17"],
      ["factory", "waiting", "2027-02-16"],
      ["making", "waiting", "2027-03-13"],
      ["shipped", "waiting", "2027-03-20"],
      ["cm", "waiting", null],
    ]);
    expect(steps[0]!.href).toBe("/production/costing/c1");
    expect(steps[4]!.would).toMatch(/for you to check and send/);
  });

  it("hears a problem in English or Bengali", () => {
    expect(isProblem("Fabric arrived today")).toBe(false);
    expect(isProblem("cutting started")).toBe(false);
    expect(isProblem("Problem: 200 pcs damaged in wash")).toBe(true);
    expect(isProblem("Trims are delayed by two days")).toBe(true);
    expect(isProblem("ফেব্রিক এসেছে")).toBe(false);
    expect(isProblem("বোতাম কম এসেছে")).toBe(true);
    expect(isProblem("মেশিন নষ্ট, সেলাই বন্ধ")).toBe(true);
  });
});

describe("Server Health", () => {
  const check = (key: HealthCheck["key"], level: HealthCheck["level"]): HealthCheck => ({
    key,
    label: key,
    level,
    detail: `${key} detail`,
    bn: `${key} বাংলা`,
  });

  it("takes the worst level, never SKIPPED, and offers only the safe fixes that suit", () => {
    expect(worstOf([check("memory", "OK"), check("certificate", "SKIPPED")])).toBe("OK");
    expect(worstOf([check("memory", "WARN"), check("disk", "OK")])).toBe("WARN");
    expect(worstOf([check("memory", "WARN"), check("backups", "ERROR")])).toBe("ERROR");
    expect(fixesFor([check("jobs", "OK"), check("errors", "WARN")])).toEqual(["jobs"]);
    expect(
      fixesFor([check("disk", "ERROR"), check("database", "WARN"), check("memory", "ERROR")]),
    ).toEqual(["clean", "analyze"]);
    expect(fixesFor([check("backups", "ERROR"), check("certificate", "WARN")])).toEqual([]);
  });

  it("writes its own report in Bengali, naming the buttons in English", () => {
    const fine = plainReport([check("memory", "OK"), check("disk", "OK")], "2026-10-17");
    expect(fine).toBe("সার্ভার চেক, 2026-10-17: সব ঠিক আছে।\n\n• memory বাংলা\n• disk বাংলা");
    const bad = plainReport(
      [check("memory", "OK"), check("disk", "WARN"), check("backups", "ERROR")],
      "2026-10-17",
    );
    expect(bad).toContain("জরুরি সমস্যা আছে");
    expect(bad).toContain("• disk: disk বাংলা");
    expect(bad).toContain("“Run the nightly clean-up now”");
    expect(bad).toContain("merge করা Pull Request");
    expect(bad).not.toMatch(/[০-৯]/);
  });
});
