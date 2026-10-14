import { describe, expect, it } from "vitest";

import {
  buildInput,
  buildPaperwork,
  customLine,
  type Draft,
  itemsFor,
  lineQuantity,
  liveCollarTotals,
  readNumber,
  startDraft,
  stepOf,
  stepsFor,
  untouchedItems,
} from "@/components/production/booking-draft";
import {
  collarTotals,
  cuffsFor,
  diaText,
  fabricFor,
  matrixQuantity,
  roundUpQuantity,
  setsFor,
  specsText,
  weightText,
} from "@/modules/production/booking-math";
import {
  CATEGORY_PRESETS,
  DEFAULT_COLLAR_SIZES,
  GARMENT_CATEGORIES,
  sizeGroupOf,
} from "@/modules/production/booking-presets";
import { createBookingSchema } from "@/modules/production/booking-schemas";
import type { BookingForm } from "@/modules/production/booking.service";
import {
  splitTerm,
  standardTerms,
  standardTermsText,
  termLines,
} from "@/modules/production/booking-terms";

describe("Booking sums", () => {
  it("rounds a booked quantity up, never down, to what can be ordered", () => {
    expect(roundUpQuantity(12.0000000001, "KG")).toBe(12);
    expect(roundUpQuantity(12.0001, "KG")).toBe(12.001);
    expect(roundUpQuantity(10.2, "PCS")).toBe(11);
    expect(roundUpQuantity(0, "KG")).toBe(0);
    expect(roundUpQuantity(Number.NaN, "KG")).toBe(0);
  });

  it("works out fabric from pieces, consumption per dozen and process loss", () => {
    // 1,200 pieces = 100 dozen × 2.75 kg = 275 kg, + 10% = 302.5 kg.
    expect(fabricFor(1200, 2.75, 10, "KG")).toBe(302.5);
    // 1,000 pieces = 83.333 dozen × 16 yd = 1,333.333 yd, + 5% = 1,400.0000 yd → 1,400 yd.
    expect(fabricFor(1000, 16, 5, "YARD")).toBe(1400);
    expect(fabricFor(1000, 0, 5, "YARD")).toBe(0);
  });

  it("books collar sets over the pieces with the extra, rounded up", () => {
    expect(setsFor(500, 3)).toBe(515);
    expect(setsFor(333, 3)).toBe(343); // 342.99 → 343
    expect(setsFor(0, 3)).toBe(0);
    expect(setsFor(100, 0)).toBe(100);
    expect(cuffsFor(515, "PCS")).toBe(1030);
    expect(cuffsFor(515, "SET")).toBe(515);
  });

  it("totals the matrix by colour and size group", () => {
    const t = collarTotals({
      extraPercent: 3,
      sizes: [{ label: "S-M" }, { label: "L-XL" }, { label: "2XL" }],
      colours: [{ pieces: [500, 400, 100] }, { pieces: [200, 0, 50] }],
    });
    expect(t.sets).toEqual([
      [515, 412, 103],
      [206, 0, 52],
    ]);
    expect(t.bySize).toEqual([721, 412, 155]);
    expect(t.byColour).toEqual([1030, 258]);
    expect(t.totalPieces).toBe(1250);
    expect(t.totalSets).toBe(1288);
    expect(matrixQuantity("COLLAR", "PCS", 1288)).toBe(1288);
    expect(matrixQuantity("CUFF", "PCS", 1288)).toBe(2576);
    expect(matrixQuantity("TRIM", "PCS", 1288)).toBeNull();
    expect(matrixQuantity("COLLAR", "PCS", null)).toBeNull();
  });

  it("writes the specification the way the trade reads it", () => {
    expect(
      specsText(
        {
          role: "FABRIC",
          fabricType: "Pique",
          composition: "100% cotton",
          colour: "Navy",
          weight: 220,
          weightUnit: "GSM",
          dia: 36,
          diaType: "OPEN",
        },
        "KNITWEAR",
      ),
    ).toBe('Pique · 100% cotton · 220 GSM · DIA 36" open');
    expect(
      specsText(
        {
          role: "FABRIC",
          width: 58,
          construction: "40x40 / 133x72",
          weight: 6.5,
          weightUnit: "OZ",
        },
        "WOVEN",
      ),
    ).toBe('58" wide · 40x40 / 133x72 · 6.5 oz/yd²');
    expect(specsText({ role: "FABRIC", yarnCount: "2/28 Nm", gauge: 12 }, "SWEATER")).toBe(
      "Count 2/28 Nm · 12 GG",
    );
    expect(specsText({ role: "TRIM", size: "18L, 4 holes", colour: "White" }, "KNITWEAR")).toBe(
      "18L, 4 holes",
    );
    expect(weightText({ weight: null })).toBeNull();
    expect(diaText({ diaType: "TUBE" })).toBe("Tube");
  });
});

describe("Booking presets", () => {
  it("loads each garment family's unit, fields and trims", () => {
    expect(CATEGORY_PRESETS.KNITWEAR.fabricUnit).toBe("KG");
    expect(CATEGORY_PRESETS.KNITWEAR.fabricFields).toEqual(
      expect.arrayContaining(["weight", "dia"]),
    );
    expect(CATEGORY_PRESETS.KNITWEAR.trims.map((t) => t.name)).toEqual([
      "Collar",
      "Cuff",
      "Twill tape",
      "Button",
    ]);
    expect(CATEGORY_PRESETS.WOVEN.fabricUnits).toEqual(["YARD", "METER"]);
    expect(CATEGORY_PRESETS.WOVEN.fabricFields).toEqual(
      expect.arrayContaining(["width", "construction", "weight"]),
    );
    expect(CATEGORY_PRESETS.WOVEN.trims.map((t) => t.name)).toEqual([
      "Pocketing",
      "Interlining",
      "Collar bone",
      "Button",
    ]);
    expect(CATEGORY_PRESETS.OUTERWEAR.fabricUnit).toBe("YARD");
    expect(CATEGORY_PRESETS.OUTERWEAR.trims.map((t) => t.name)).toEqual([
      "Lining",
      "Padding",
      "Zipper",
    ]);
    expect(CATEGORY_PRESETS.SWEATER.fabricUnits).toEqual(["LB", "KG"]);
    expect(CATEGORY_PRESETS.SWEATER.fabricFields).toEqual(
      expect.arrayContaining(["yarnCount", "gauge"]),
    );
    // Only knitwear books collars and cuffs by matrix.
    expect(GARMENT_CATEGORIES.filter((c) => CATEGORY_PRESETS[c].collarMatrix)).toEqual([
      "KNITWEAR",
    ]);
    expect(
      DEFAULT_COLLAR_SIZES.map((s) => `${s.label} ${s.collarLength}x${s.collarWidth}`),
    ).toEqual(["S-M 42x9", "L-XL 44x9", "2XL 46x9"]);
  });

  it("puts garment sizes in their collar size group", () => {
    const groups = ["S-M", "L-XL", "2XL"];
    expect(sizeGroupOf("M", groups)).toBe(0);
    expect(sizeGroupOf("xl", groups)).toBe(1);
    expect(sizeGroupOf("XXL", groups)).toBe(2);
    expect(sizeGroupOf("3XL", groups)).toBe(-1);
  });
});

describe("Booking terms", () => {
  it("are strict, numbered conditions in English or Bengali", () => {
    const en = standardTerms("SUPPLIER_PO", "KNITWEAR", "EN");
    const bn = standardTerms("SUPPLIER_PO", "KNITWEAR", "BN");
    expect(en.length).toBe(bn.length);
    expect(en.length).toBeGreaterThanOrEqual(12);
    const text = en.join(" ");
    for (const word of ["GSM", "DIA", "4-point", "hairy", "Shade", "Shrinkage"]) {
      expect(text).toContain(word);
    }
    expect(bn.join(" ")).toMatch(/[ঀ-৿]/);
    // Western digits in the Bengali terms, as everywhere in the app.
    expect(bn.join(" ")).not.toMatch(/[০-৯]/);
    expect(standardTerms("SUPPLIER_PO", "KNITWEAR", "EN", { collar: true }).length).toBe(
      en.length + 1,
    );
  });

  it("have their own wording for ready stock bought on the market", () => {
    const market = standardTermsText("MARKET_PURCHASE", "WOVEN", "EN");
    expect(market).not.toBe(standardTermsText("SUPPLIER_PO", "WOVEN", "EN"));
    expect(market).toMatch(/shop/i);
    expect(standardTermsText("SUPPLIER_PO", "SWEATER", "EN")).toMatch(/count/i);
  });

  it("split into a bold heading and the text", () => {
    expect(splitTerm("Shade: Match the lab dip.")).toEqual({
      heading: "Shade",
      text: "Match the lab dip.",
    });
    expect(splitTerm("No heading here")).toEqual({ heading: null, text: "No heading here" });
    expect(termLines("a\n\n b \r\nc")).toEqual(["a", "b", "c"]);
  });
});

/** What getBookingForm hands a new booking with nothing chosen yet. */
const blankForm = (over: Partial<BookingForm["values"]> = {}): BookingForm => ({
  today: "2026-10-13",
  booking: null,
  batch: null,
  batchMaterials: [],
  values: {
    source: "SUPPLIER_PO",
    category: "KNITWEAR",
    supplier: null,
    expectedDate: "",
    supplierRef: "",
    title: "",
    styleRef: "",
    garmentPieces: null,
    deliveryPlace: "",
    paymentTerms: "",
    termsLanguage: "EN",
    terms: "",
    notes: "",
    collar: null,
    lines: [],
    ...over,
  },
});

/** A knitwear booking filled in the way a buyer would. */
function filledDraft(): Draft {
  const draft = startDraft(blankForm());
  draft.supplier = { id: "sup1", code: "SUP-001", name: "Narayanganj Fabrics" };
  const [fabric, collar, cuff, tape, button] = draft.lines;
  Object.assign(fabric!.specs, { fabricType: "Pique", composition: "100% cotton", weight: "220" });
  fabric!.calc = { on: true, pieces: "1200", perDozen: "2.75", loss: "10" };
  fabric!.unitPrice = "520";
  tape!.quantity = "300";
  button!.quantity = "3600";
  draft.collar.colours[0] = {
    ...draft.collar.colours[0]!,
    garmentColour: "Navy",
    pieces: ["500", "400", "100"],
  };
  expect([collar!.role, cuff!.role]).toEqual(["COLLAR", "CUFF"]);
  return draft;
}

describe("The booking wizard's working copy", () => {
  it("starts a new knitwear booking with its fabric, trims, matrix and terms", () => {
    const draft = startDraft(blankForm());
    expect(draft.lines.map((l) => [l.role, l.name, l.unit])).toEqual([
      ["FABRIC", "Body fabric", "KG"],
      ["COLLAR", "Collar", "PCS"],
      ["CUFF", "Cuff", "PCS"],
      ["TRIM", "Twill tape", "METER"],
      ["TRIM", "Button", "PCS"],
    ]);
    expect(draft.collar.on).toBe(true);
    expect(draft.collar.sizes.map((s) => s.label)).toEqual(["S-M", "L-XL", "2XL"]);
    expect(draft.terms).toEqual(standardTerms("SUPPLIER_PO", "KNITWEAR", "EN", { collar: true }));
    expect(stepsFor(draft)).toEqual(["setup", "fabric", "trims", "collar", "terms"]);
    expect(untouchedItems(draft)).toBe(true);
  });

  it("swaps the items for another family's and leaves out the collar step", () => {
    const woven = { ...startDraft(blankForm()), category: "WOVEN" as const };
    woven.lines = itemsFor("WOVEN", "");
    woven.collar = { ...woven.collar, on: false };
    expect(woven.lines.map((l) => [l.name, l.unit])).toEqual([
      ["Main fabric", "YARD"],
      ["Pocketing", "YARD"],
      ["Interlining", "YARD"],
      ["Collar bone", "PCS"],
      ["Button", "PCS"],
    ]);
    expect(stepsFor(woven)).toEqual(["setup", "fabric", "trims", "terms"]);
  });

  it("works quantities out live: the calculator and the matrix", () => {
    const draft = filledDraft();
    expect(liveCollarTotals(draft.collar).totalSets).toBe(1030);
    expect(lineQuantity(draft.lines[0]!, draft.collar)).toEqual({
      source: "calculator",
      value: 302.5,
    });
    expect(lineQuantity(draft.lines[1]!, draft.collar)).toEqual({ source: "matrix", value: 1030 });
    expect(lineQuantity(draft.lines[2]!, draft.collar)).toEqual({ source: "matrix", value: 2060 });
    expect(lineQuantity(draft.lines[3]!, draft.collar)).toEqual({ source: "typed", value: 300 });
  });

  it("builds exactly what the server takes", () => {
    const { input, problems } = buildInput(filledDraft(), "2026-10-13");
    expect(problems).toEqual({});
    const parsed = createBookingSchema.parse(input);
    expect(parsed.lines[0]).toMatchObject({
      name: "Body fabric",
      kind: "FABRIC",
      unit: "KG",
      unitPrice: 520,
      specs: {
        role: "FABRIC",
        fabricType: "Pique",
        weight: 220,
        weightUnit: "GSM",
        diaType: "OPEN",
        pieces: 1200,
        perDozen: 2.75,
        lossPercent: 10,
      },
    });
    // The matrix and the calculator set their own quantities; the rest are typed.
    expect(parsed.lines.map((l) => l.quantity ?? null)).toEqual([null, null, null, 300, 3600]);
    expect(parsed.lines.map((l) => l.unitPrice ?? null)).toEqual([520, null, null, null, null]);
    expect(parsed.collar).toMatchObject({
      style: "SOLID",
      extraPercent: 3,
      colours: [{ garmentColour: "Navy", collarColour: null, pieces: [500, 400, 100] }],
    });
    expect(parsed.terms?.split("\n").length).toBe(
      standardTerms("SUPPLIER_PO", "KNITWEAR", "EN", { collar: true }).length,
    );
  });

  it("asks for every price when a market purchase goes into stock as it is saved", () => {
    const draft = filledDraft();
    draft.expectedDate = "2026-10-20";
    draft.receiveNow = true;
    // A supplier PO waits for its goods, whatever the box said.
    expect(buildInput(draft, "2026-10-13").input).toMatchObject({
      receiveNow: false,
      expectedDate: "2026-10-20",
    });
    expect(buildInput(draft, "2026-10-13").problems).toEqual({});
    draft.source = "MARKET_PURCHASE";
    const { input, problems } = buildInput(draft, "2026-10-13");
    expect(input).toMatchObject({ receiveNow: true, expectedDate: null });
    expect(problems).toEqual({
      "lines.1.unitPrice": "Enter the price paid: the goods go into stock now.",
      "lines.2.unitPrice": "Enter the price paid: the goods go into stock now.",
      "lines.3.unitPrice": "Enter the price paid: the goods go into stock now.",
      "lines.4.unitPrice": "Enter the price paid: the goods go into stock now.",
    });
    expect(stepOf("lines.1.unitPrice", draft)).toBe("trims");
  });

  it("finds every problem on its step before the server is asked", () => {
    const draft = startDraft(blankForm());
    draft.lines[3]!.quantity = "1.5.5";
    draft.collar.colours[0]!.pieces = ["", "x", ""];
    draft.collar.sizes[1]!.label = "s-m";
    draft.expectedDate = "2026-10-01";
    const { problems } = buildInput(draft, "2026-10-13");
    expect(problems).toMatchObject({
      supplierId: "Choose the supplier.",
      expectedDate: "Choose today or a later day.",
      "lines.0.quantity": "Enter the quantity, or remove the item.",
      "lines.3.quantity": expect.stringContaining("Enter a number"),
      "lines.4.quantity": "Enter the quantity, or remove the item.",
      "collar.colours.0.garmentColour": "Name the garment colour.",
      "collar.colours.0.pieces.1": expect.stringContaining("whole number"),
      "collar.sizes.1.label": "This size group is given twice.",
    });
    expect(stepOf("supplierId", draft)).toBe("setup");
    expect(stepOf("lines.0.quantity", draft)).toBe("fabric");
    expect(stepOf("lines.3.quantity", draft)).toBe("trims");
    expect(stepOf("collar.colours.0.pieces.1", draft)).toBe("collar");
    expect(stepOf("terms", draft)).toBe("terms");
  });

  it("needs a collar or cuff item while the matrix is on", () => {
    const draft = filledDraft();
    draft.lines = draft.lines.filter((l) => l.role !== "COLLAR" && l.role !== "CUFF");
    expect(buildInput(draft, "2026-10-13").problems.collar).toMatch(/Collar or Cuff/);
    draft.collar.on = false;
    expect(buildInput(draft, "2026-10-13").problems).toEqual({});
  });

  it("names a custom item and checks its unit", () => {
    const draft = filledDraft();
    const custom = customLine();
    draft.lines.push({ ...custom, quantity: "2.5" });
    const { problems } = buildInput(draft, "2026-10-13");
    expect(problems["lines.5.name"]).toMatch(/Name the item/);
    expect(problems["lines.5.quantity"]).toMatch(/counted whole/);
  });

  it("reads numbers strictly", () => {
    expect(readNumber("1,200", { decimals: 0 })).toBe(1200);
    expect(readNumber("2.755", { decimals: 2 })).toMatch(/up to 2 decimals/);
    expect(readNumber("0", { allowZero: true })).toBe(0);
    expect(readNumber("0")).toBe("Enter more than zero.");
    expect(readNumber("", { label: "the pieces" })).toBe("Enter the pieces.");
  });

  it("keeps the paperwork on or after the booking date", () => {
    const draft = startDraft(blankForm());
    draft.expectedDate = "2026-10-01";
    expect(buildPaperwork(draft, "2026-10-05").problems.expectedDate).toMatch(/booking date/);
    draft.expectedDate = "2026-10-05";
    expect(buildPaperwork(draft, "2026-10-05").problems).toEqual({});
  });
});
