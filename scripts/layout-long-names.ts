/**
 * Long, real-looking names for the layout checks (v6.4.1 C1: "no ... on phones
 * anywhere, tables included, tested with long real names"). The demo data's names
 * are short ("Gazipur Knit Composite"), so a screen that cuts a long name would pass
 * with them. This gives the check's copy of the demo data the names a buying house
 * really has: the company, every buyer and supplier, styles and their codes, colours,
 * materials, stores, staff, projects, batches and bookings.
 *
 * It only changes names and codes people read, never an amount, a quantity or a date,
 * and only on a database made for checks (scripts/layout-session.ts, isCheckDatabase):
 * GitHub's throwaway copy of the demo data, or a copy whose name starts with
 * extras_layout or extras_erp_ui. Never the live ERP's, never the demo site's own.
 *   npx tsx scripts/layout-long-names.ts
 * .github/workflows/layout-checks.yml runs it after the demo data loads.
 */
import { prisma } from "@/lib/prisma";

import { isCheckDatabase } from "./layout-session";

/** The names, as long as the real ones get. */
export const LONG_NAMES = {
  companies: [
    "Extas Apparel Sourcing & Buying House Limited",
    "Fabric Apparel Knit Composite & Garments Export Sourcing Ltd.",
  ],
  buyers: [
    "Bangladesh Apparel Sourcing & Merchandising International Ltd.",
    "Nordic Outdoor Clothing Retail Group Aktiebolag (Stockholm Office)",
    "Hamburg Textil Handelsgesellschaft mbH & Co. KG Einkaufsbüro",
    "United Fashion Retailers of North America Incorporated",
    "Al-Madina Readymade Garments Trading Company W.L.L.",
    "Chattogram Export Processing Zone Apparel Buyers Consortium",
  ],
  suppliers: [
    "Narayanganj Knit Composite Dyeing & Finishing Mills Ltd.",
    "Gazipur Sweater & Knitwear Composite Industries Private Limited",
    "Ashulia Yarn Dyeing, Knitting & Fabric Processing Mills Ltd.",
    "Savar Accessories, Labels, Trims & Packaging Solutions Limited",
    "Tongi Embroidery, Screen Print & Garment Washing House",
    "Dhaka EPZ Zipper, Button & Elastic Manufacturing Co. Ltd.",
  ],
  contact: "Mr. Syed Mohammad Shahriar Kabir Chowdhury",
  styles: [
    "Men's Short Sleeve Pique Polo with Contrast Tipped Collar & Cuff",
    "Ladies Long Sleeve Organic Cotton Slub Jersey Crew Neck Tee",
    "Boys Full Zip Brushed Back Fleece Hoodie with Kangaroo Pocket",
    "Men's Heavyweight 280 GSM French Terry Crew Neck Sweatshirt",
    "Girls Sleeveless Viscose Elastane Rib Knit Tank Top with Lace Trim",
  ],
  /** Added to every style's and material's code, so each code stays its own. */
  styleCode: "-SS27-PIQUE-240GSM-EU",
  materialCode: "-SS27-OPEN-WIDTH-180GSM",
  colours: [
    "Midnight Navy Blue Heather Melange",
    "Bright Optic White (Pantone 11-0601 TCX)",
    "Forest Green Garment-Dyed Marl",
    "Charcoal Grey Anthra Melange 30%",
    "Dusty Rose Pink Enzyme Washed",
    "Royal Blue with Sunflower Yellow Tipping",
  ],
  materials: [
    "100% Combed Cotton Single Jersey 180 GSM Open Width Fabric",
    "Polyester Cotton 60/40 Pique Knit 220 GSM Tubular Fabric",
    "Flat Knit Collar & Cuff Set with Double Contrast Tipping",
    "Woven Main Label with Size, Care & Country of Origin",
  ],
  people: [
    "Mohammad Abdur Rahman Chowdhury Talukder",
    "Mst. Nusrat Jahan Binte Kamal Uddin Ahmed",
    "Sheikh Mohammad Ariful Islam Bhuiyan",
  ],
  designation: "Senior Merchandiser (Knitwear, Europe & North America)",
  department: "Merchandising, Sourcing & Product Development",
  store: " – Narayanganj Central Finished Goods & Fabric Store",
  programme: " – Spring/Summer 2027 Programme, Europe & North America Delivery",
  bookingTitle: "Spring/Summer 2027 knit fabric for five brands, Europe delivery",
  styleRef: "EXT-SS27-POLO-PK240-NAVY-MELANGE-REV2",
  walkIn: "Mr. Abul Kalam Azad Bhuiyan (Walk-in Customer, Banani Showroom)",
} as const;

/** The n-th name of a list; past its end, the same names again with "Unit 2", "Unit 3"... */
export function nth(list: readonly string[], n: number): string {
  const round = Math.floor(n / list.length);
  const name = list[n % list.length]!;
  return round === 0 ? name : `${name} Unit ${round + 1}`;
}

/** Adds `suffix` to a name once (running the script twice changes nothing more). */
const once = (name: string, suffix: string) => (name.endsWith(suffix) ? name : `${name}${suffix}`);

/** Gives every company in the database its long names. Returns how many of each it changed. */
export async function lengthenNames() {
  const counts: Record<string, number> = {};
  const done = (what: string, n: number) => (counts[what] = (counts[what] ?? 0) + n);

  const companies = await prisma.company.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  for (const [i, c] of companies.entries()) {
    const name = nth(LONG_NAMES.companies, i);
    await prisma.company.update({ where: { id: c.id }, data: { name, legalName: name } });
    done("companies", 1);
  }

  for (const { id: companyId } of companies) {
    // Buyers and suppliers (never the walk-in customer or another party the system keeps).
    const parties = await prisma.party.findMany({
      where: { companyId, systemRole: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, kind: true },
    });
    let buyers = 0;
    let suppliers = 0;
    for (const p of parties) {
      const name =
        p.kind === "SUPPLIER"
          ? nth(LONG_NAMES.suppliers, suppliers++)
          : nth(LONG_NAMES.buyers, buyers++);
      await prisma.party.update({
        where: { id: p.id },
        data: { name, contactPerson: LONG_NAMES.contact },
      });
    }
    done("parties", parties.length);

    const styles = await prisma.style.findMany({
      where: { companyId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, code: true },
    });
    for (const [i, s] of styles.entries()) {
      await prisma.style.update({
        where: { id: s.id },
        data: { name: nth(LONG_NAMES.styles, i), code: once(s.code, LONG_NAMES.styleCode) },
      });
    }
    done("styles", styles.length);

    // Colour names are one of a kind in a company: "Unit 2" keeps them apart.
    const colours = await prisma.color.findMany({
      where: { companyId },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    for (const [i, c] of colours.entries()) {
      await prisma.color.update({
        where: { id: c.id },
        data: { name: nth(LONG_NAMES.colours, i) },
      });
    }
    done("colours", colours.length);

    const materials = await prisma.rawMaterial.findMany({
      where: { companyId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, code: true },
    });
    for (const [i, m] of materials.entries()) {
      await prisma.rawMaterial.update({
        where: { id: m.id },
        data: { name: nth(LONG_NAMES.materials, i), code: once(m.code, LONG_NAMES.materialCode) },
      });
    }
    done("materials", materials.length);

    const stores = await prisma.warehouse.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });
    for (const w of stores) {
      await prisma.warehouse.update({
        where: { id: w.id },
        data: { name: once(w.name, LONG_NAMES.store) },
      });
    }
    done("stores", stores.length);

    const staff = await prisma.employee.findMany({
      where: { companyId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    for (const [i, e] of staff.entries()) {
      await prisma.employee.update({
        where: { id: e.id },
        data: {
          name: nth(LONG_NAMES.people, i),
          designation: LONG_NAMES.designation,
          department: LONG_NAMES.department,
        },
      });
    }
    done("staff", staff.length);

    for (const model of ["productionProject", "productionBatch"] as const) {
      const rows =
        model === "productionProject"
          ? await prisma.productionProject.findMany({
              where: { companyId },
              select: { id: true, name: true },
            })
          : await prisma.productionBatch.findMany({
              where: { companyId },
              select: { id: true, name: true },
            });
      for (const r of rows) {
        const data = { name: once(r.name, LONG_NAMES.programme) };
        if (model === "productionProject") {
          await prisma.productionProject.update({ where: { id: r.id }, data });
        } else {
          await prisma.productionBatch.update({ where: { id: r.id }, data });
        }
      }
      done(model === "productionProject" ? "projects" : "batches", rows.length);
    }

    const bookings = await prisma.booking.updateMany({
      where: { companyId },
      data: { title: LONG_NAMES.bookingTitle, styleRef: LONG_NAMES.styleRef },
    });
    done("bookings", bookings.count);

    const walkIns = await prisma.salesOrder.updateMany({
      where: { companyId, customerName: { not: null } },
      data: { customerName: LONG_NAMES.walkIn },
    });
    done("walk-in orders", walkIns.count);
  }

  // The people who sign in (never the AI's own service account).
  const users = await prisma.user.findMany({
    where: { NOT: { email: { endsWith: "@ai.invalid" } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  for (const [i, u] of users.entries()) {
    await prisma.user.update({ where: { id: u.id }, data: { name: nth(LONG_NAMES.people, i) } });
  }
  done("users", users.length);

  return counts;
}

async function main() {
  const [db] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (!isCheckDatabase(db?.name)) {
    throw new Error(
      `Not a database made for checks (${db?.name ?? "unknown"}): no names changed. Use a copy of the demo data named extras_layout_<something>.`,
    );
  }
  const counts = await lengthenNames();
  console.log(
    `Long names are in for the layout checks: ${Object.entries(counts)
      .map(([what, n]) => `${n} ${what}`)
      .join(", ")}.`,
  );
}

if (process.argv[1]?.endsWith("layout-long-names.ts")) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
