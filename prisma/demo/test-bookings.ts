import { addDays, localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as parties from "@/modules/parties/party.service";
import * as bookings from "@/modules/production/booking.service";

/*
 * The four test bookings Mehadi asked for on the demo site (2026-10-14): a polo
 * and a T-shirt booked from the knit mill, a woven shirt from a woven mill, and
 * a woven shirt bought as ready stock at Islampur and put into stock at once.
 * The same bookings were typed through the booking wizard in the browser test.
 */

/** Each test booking's title, which also says it is there already. */
export const TEST_BOOKINGS = [
  "Test 1: Polo shirt, 500 kg pique",
  "Test 2: T-shirt, 300 kg single jersey",
  "Test 3: Woven shirt, 2,000 yards oxford",
  "Test 4: Woven shirt, 1,500 yards ready stock",
] as const;

async function supplier(ctx: CompanyContext, name: string, city: string, fabric: boolean) {
  const found = await prisma.party.findFirst({
    where: { companyId: ctx.company.id, kind: "SUPPLIER", name },
    select: { id: true },
  });
  if (found) return found.id;
  const { party } = await parties.createParty(ctx, {
    kind: "SUPPLIER",
    name,
    city,
    ...(fabric ? { supplierCategories: ["FABRIC" as const] } : {}),
  });
  return party.id;
}

/** What the four bookings take (createBooking's input). */
export function testBookingInputs(
  ids: { knitMill: string; wovenMill: string; seller: string },
  today: string,
) {
  const tipping = (garmentColour: string, collarColour: string, tippingColour: string) => ({
    garmentColour,
    collarColour,
    tippingColour,
    pieces: [500, 400, 100],
  });
  return [
    {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: ids.knitMill,
      expectedDate: addDays(today, 21),
      supplierRef: "NTM/POLO/1014",
      title: TEST_BOOKINGS[0],
      styleRef: "Classic Polo, Brand A",
      garmentPieces: 2000,
      paymentTerms: "30 days after delivery",
      deliveryPlace: "Extas central store, Gazipur",
      collar: {
        style: "TIPPING",
        extraPercent: 3,
        sizes: [
          { label: "S-M", collarLength: 42, collarWidth: 9, cuffLength: 38, cuffWidth: 3.5 },
          { label: "L-XL", collarLength: 44, collarWidth: 9, cuffLength: 38, cuffWidth: 3.5 },
          { label: "2XL", collarLength: 46, collarWidth: 9, cuffLength: 38, cuffWidth: 3.5 },
        ],
        colours: [tipping("Navy", "Navy", "White"), tipping("White", "White", "Navy")],
      },
      lines: [
        {
          name: "Pique Cotton 220 GSM",
          kind: "FABRIC",
          unit: "KG",
          quantity: 500,
          unitPrice: 640,
          specs: {
            fabricType: "Pique",
            composition: "100% combed cotton",
            colour: "Navy and white",
            weight: 220,
            weightUnit: "GSM",
            dia: 36,
            diaType: "OPEN",
            finish: "Enzyme, silicone",
          },
        },
        {
          name: "Collar",
          kind: "TRIM",
          unit: "PCS",
          unitPrice: 22,
          specs: { role: "COLLAR", size: "Flat knit, tipping" },
        },
        {
          name: "Cuff",
          kind: "TRIM",
          unit: "PCS",
          unitPrice: 9,
          specs: { role: "CUFF", size: "Flat knit, tipping" },
        },
        {
          name: "Twill tape",
          kind: "TRIM",
          unit: "METER",
          quantity: 2200,
          unitPrice: 4,
          specs: { size: "1 cm, neck" },
        },
        {
          name: "Button",
          kind: "ACCESSORY",
          unit: "PCS",
          quantity: 6200,
          unitPrice: 1.5,
          specs: { size: "18L, 4 holes" },
        },
      ],
    },
    {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: ids.knitMill,
      expectedDate: addDays(today, 18),
      supplierRef: "NTM/TEE/1014",
      title: TEST_BOOKINGS[1],
      styleRef: "Basic Tee, Brand B",
      garmentPieces: 1500,
      paymentTerms: "30 days after delivery",
      lines: [
        {
          name: "Single Jersey 160 GSM",
          kind: "FABRIC",
          unit: "KG",
          quantity: 300,
          unitPrice: 560,
          specs: {
            fabricType: "Single jersey",
            composition: "100% cotton",
            colour: "Black",
            weight: 160,
            weightUnit: "GSM",
            dia: 30,
            diaType: "TUBE",
            finish: "Enzyme, silicone",
          },
        },
        {
          name: "Twill tape",
          kind: "TRIM",
          unit: "METER",
          quantity: 1600,
          unitPrice: 4,
          specs: { size: "1 cm, back neck" },
        },
      ],
    },
    {
      source: "SUPPLIER_PO",
      category: "WOVEN",
      supplierId: ids.wovenMill,
      expectedDate: addDays(today, 30),
      supplierRef: "NWM/SHIRT/1014",
      title: TEST_BOOKINGS[2],
      styleRef: "Oxford shirt, Brand C",
      garmentPieces: 1200,
      paymentTerms: "LC at sight",
      lines: [
        {
          name: "Cotton oxford shirting",
          kind: "FABRIC",
          unit: "YARD",
          quantity: 2000,
          unitPrice: 210,
          specs: {
            fabricType: "Oxford",
            composition: "100% cotton",
            colour: "Sky blue",
            width: 58,
            construction: "40x40 / 133x72",
            weight: 120,
            weightUnit: "GSM",
            finish: "Peach",
          },
        },
        {
          name: "Pocketing",
          kind: "TRIM",
          unit: "YARD",
          quantity: 150,
          unitPrice: 70,
          specs: { size: 'TC 45x45, 58"' },
        },
        {
          name: "Interlining",
          kind: "TRIM",
          unit: "YARD",
          quantity: 220,
          unitPrice: 95,
          specs: { size: "Fusible, 40 GSM" },
        },
        {
          name: "Collar bone",
          kind: "ACCESSORY",
          unit: "PCS",
          quantity: 2400,
          unitPrice: 1.2,
          specs: { size: "Plastic, 2.5 inches" },
        },
        {
          name: "Button",
          kind: "ACCESSORY",
          unit: "PCS",
          quantity: 12000,
          unitPrice: 0.8,
          specs: { size: "14L, 4 holes, white" },
        },
      ],
    },
    {
      source: "MARKET_PURCHASE",
      category: "WOVEN",
      supplierId: ids.seller,
      title: TEST_BOOKINGS[3],
      styleRef: "Poplin shirt, Eid drop",
      garmentPieces: 900,
      paymentTerms: "Cash on delivery",
      termsLanguage: "BN",
      receiveNow: true,
      lines: [
        {
          name: "Cotton poplin shirting",
          kind: "FABRIC",
          unit: "YARD",
          quantity: 1500,
          unitPrice: 175,
          specs: {
            fabricType: "Poplin",
            composition: "100% cotton",
            colour: "White",
            width: 58,
            construction: "50x50 / 144x80",
            weight: 110,
            weightUnit: "GSM",
          },
        },
        { name: "Pocketing", kind: "TRIM", unit: "YARD", quantity: 100, unitPrice: 65 },
        { name: "Interlining", kind: "TRIM", unit: "YARD", quantity: 160, unitPrice: 90 },
        { name: "Collar bone", kind: "ACCESSORY", unit: "PCS", quantity: 1800, unitPrice: 1.1 },
        {
          name: "Button",
          kind: "ACCESSORY",
          unit: "PCS",
          quantity: 9000,
          unitPrice: 0.7,
          specs: { size: "14L, 4 holes, white" },
        },
      ],
    },
  ];
}

/**
 * Makes the four test bookings in the company, once, as `ctx` (its Super
 * Admin), and says each one's booking number (the same as its PO number). When
 * they are there already it only reads their numbers.
 */
export async function loadTestBookings(ctx: CompanyContext) {
  const titled = () =>
    prisma.booking.findMany({
      where: { companyId: ctx.company.id, title: { in: [...TEST_BOOKINGS] } },
      select: { title: true, order: { select: { number: true } } },
    });
  const there = await titled();
  /** A market purchase whose goods could not go into stock as it was saved. */
  const problems: string[] = [];
  if (there.length === 0) {
    const ids = {
      knitMill: await supplier(ctx, "Noman Textile Mills", "Narayanganj", true),
      wovenMill: await supplier(ctx, "Narayanganj Woven Mills", "Narayanganj", true),
      seller: await supplier(ctx, "Islampur Cloth Store", "Dhaka", false),
    };
    const today = localDay(new Date(), ctx.company.timezone);
    for (const input of testBookingInputs(ids, today)) {
      const made = await bookings.createBooking(ctx, input);
      if (made.intoStock && "problem" in made.intoStock) {
        problems.push(`${made.number}: ${made.intoStock.problem}`);
      }
    }
  }
  const numbers = new Map(
    (there.length > 0 ? there : await titled()).map((b) => [b.title, b.order.number]),
  );
  return {
    added: there.length === 0,
    problems,
    bookings: TEST_BOOKINGS.map((title) => ({ title, number: numbers.get(title) ?? null })),
  };
}
