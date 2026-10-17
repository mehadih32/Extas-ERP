import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as parties from "@/modules/parties/party.service";
import { createTechPack } from "@/modules/production/tech-pack-register.service";
import { makeChart, setInstructions } from "@/modules/production/tech-pack-spec.service";

/*
 * The v6.4 sample on the demo site: a tech pack started from a buyer's brief
 * before any order (Tech Pack as its own module), not linked to a production
 * project, with a measurement chart made from the brief's two points and the
 * owner's packing instruction. The Tech Pack list and the page then show a
 * standalone tech pack waiting to be linked when the order comes. Once: when
 * the sample is there already it does nothing.
 */

export const V64_SAMPLE_TECH_PACK = "Sample: Nordic Wear pique polo SS27";

const BRIEF = [
  "Men's pique polo for SS27, about 2,400 pieces in 3 colours (navy, white, bottle green).",
  "Fabric: 100% cotton pique 220 GSM, enzyme wash.",
  "Flat-knit collar and cuffs with one tipping, 2-button placket, side vents, S to 2XL.",
  "Chest logo embroidered, 27 mm wide. Single polybag, 12 pieces a carton.",
].join("\n");

export async function loadV64TechPack(ctx: CompanyContext) {
  const there = await prisma.techPack.findFirst({
    where: { companyId: ctx.company.id, title: V64_SAMPLE_TECH_PACK },
    select: { id: true },
  });
  if (there) return null;
  const buyer = await prisma.party.findFirst({
    where: { companyId: ctx.company.id, kind: "BUYER", name: "Nordic Wear AB" },
    select: { id: true },
  });
  const buyerId =
    buyer?.id ??
    (await parties.createParty(ctx, { kind: "BUYER", name: "Nordic Wear AB" })).party.id;
  const made = await createTechPack(
    ctx,
    { title: V64_SAMPLE_TECH_PACK, buyerId, season: "SS27", brief: BRIEF },
    [],
  );
  await makeChart(ctx, made.id, {
    garmentKind: "POLO",
    unit: "INCH",
    sizes: "S, M, L, XL, 2XL",
    baseSize: "M",
    chest: 42,
    chestBasis: "AUTO",
    length: 29,
  });
  await setInstructions(ctx, made.id, {
    Packing: "Single polybag per piece, 12 pieces a carton, mixed sizes as the buyer's ratio.",
  });
  return made;
}
