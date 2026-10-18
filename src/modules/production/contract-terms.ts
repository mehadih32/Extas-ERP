import type { ContractKind } from "@prisma/client";

/*
 * The clauses of a batch contract, drafted in plain words from the batch's
 * facts: what is bought or made, quality, delivery, weighing or counting with
 * Short/Extra, faults and deductions, price and payment, and disputes. People
 * read and change them before printing; AI may reword them (contract.service.ts)
 * but these rules are always the starting point and the fallback.
 */

export type Clause = { title: string; text: string };

export const CONTRACT_TITLES: Record<ContractKind, string> = {
  FABRIC: "Fabric supply agreement",
  ACCESSORIES: "Accessories supply agreement",
  FACTORY_CM: "Making (CM) agreement",
};

/** Most clauses a contract keeps, and the longest a clause may be. */
export const MAX_CLAUSES = 30;
export const MAX_CLAUSE_TITLE = 80;
export const MAX_CLAUSE_TEXT = 2000;

export type ContractFacts = {
  kind: ContractKind;
  company: string;
  party: string;
  batch: { code: string; name: string };
  /** The last day goods are expected (supply) or all pieces are due (factory), "12 Nov 2026". */
  dueOn: string | null;
  /** Supply: some lines are priced at receive. */
  pricesLater: boolean;
  /** Supply: what is bought, "Pique (kg)". */
  materials: string[];
  /** Factory: the styles made, "EX-PL-001 Classic Polo (720 pcs)". */
  styles: string[];
  /** Factory: whether every style has its CM (per piece or per dozen). */
  cmAgreed: boolean;
};

const DISPUTES: Clause = {
  title: "Disagreements",
  text:
    "Both sides first try to settle any disagreement by talking in good faith. " +
    "If that fails within 15 days, it goes to arbitration in Dhaka under the laws of Bangladesh.",
};

const byDay = (f: ContractFacts, fallback: string) => (f.dueOn ? `by ${f.dueOn}` : fallback);

function fabricClauses(f: ContractFacts): Clause[] {
  return [
    {
      title: "What is bought",
      text:
        `${f.party} supplies the fabric in the table above for ${f.company}'s master batch ` +
        `${f.batch.code} "${f.batch.name}"${f.materials.length ? ` (${f.materials.join(", ")})` : ""}. ` +
        "Colours and quantities are as on the purchase orders named in the table.",
    },
    {
      title: "Quality",
      text:
        "The fabric matches the approved swatch and lab dip in shade, GSM, width and hand feel. " +
        "Shrinkage after washing stays within 5% in length and width. Every roll of a colour " +
        "matches the others in shade, with no shade bands inside a roll.",
    },
    {
      title: "Delivery",
      text:
        `Delivered to ${f.company}'s store ${byDay(f, "on the days on the purchase orders")}, ` +
        "with a challan giving each roll's colour and weight. Part deliveries need written agreement.",
    },
    {
      title: "Weighing and Short/Extra",
      text:
        "Every delivery is weighed when it arrives and the actual weight counts, not the challan. " +
        "A short of more than 2% against the challan is written in the supplier's fault log and " +
        "taken off the bill at the agreed price. Extra above 3% is not paid for unless agreed in writing.",
    },
    {
      title: "Fabric faults",
      text:
        "Holes, stains, shade bands or a wrong GSM found at receive or at cutting are written in a " +
        "Fabric Fault Note with photos. The supplier replaces that fabric within 7 days, or its " +
        "value is deducted from the bill.",
    },
    {
      title: "Price and payment",
      text:
        (f.pricesLater
          ? "Lines marked 'At receive' have no price yet: the price is agreed and written on the bill when the goods arrive. "
          : "Prices are as in the table above. ") +
        "Each bill is paid project by project after the Final Match of its delivery, within 30 days, " +
        "less any deductions. What is still owed stays as Supplier Due on the supplier's ledger.",
    },
    DISPUTES,
  ];
}

function accessoriesClauses(f: ContractFacts): Clause[] {
  return [
    {
      title: "What is bought",
      text:
        `${f.party} supplies the accessories and trims in the table above for ${f.company}'s ` +
        `master batch ${f.batch.code} "${f.batch.name}"${f.materials.length ? ` (${f.materials.join(", ")})` : ""}.`,
    },
    {
      title: "Approved samples",
      text:
        "Every item matches the approved sample, artwork or picture on the purchase order in size, " +
        "colour, print and finish. Nothing goes into bulk before the sample is approved in writing.",
    },
    {
      title: "Delivery",
      text:
        `Delivered ${byDay(f, "on the days on the purchase orders")}, packed by item and colour with a challan. ` +
        "Items ordered by colour and size (collars, cuffs, size labels) are bundled by colour and " +
        "size as on the order's matrix.",
    },
    {
      title: "Counting and Short/Extra",
      text:
        "Every delivery is counted when it arrives. A short of more than 1% is written in the " +
        "supplier's fault log and taken off the bill, and the supplier sends the rest within 5 days. " +
        "Up to 2% extra is accepted and paid at the order price.",
    },
    {
      title: "Faults",
      text:
        "Items with a wrong print, colour or size, or with broken parts, go back for replacement " +
        "at the supplier's cost within 5 days.",
    },
    {
      title: "Price and payment",
      text:
        (f.pricesLater
          ? "Lines marked 'At receive' have no price yet: the price is agreed and written on the bill when the goods arrive. "
          : "Prices are as in the table above. ") +
        "Accessories run on one continuous ledger: each bill adds to the Supplier Due and payments " +
        "settle the oldest bills first.",
    },
    DISPUTES,
  ];
}

function factoryClauses(f: ContractFacts): Clause[] {
  return [
    {
      title: "What is made",
      text:
        `${f.party} cuts, sews, finishes and packs the styles in the table above for ${f.company}'s ` +
        `master batch ${f.batch.code} "${f.batch.name}", for the CM (making charge) per piece or per dozen shown. ` +
        `${f.company} supplies the fabric and accessories.` +
        (f.cmAgreed ? "" : " A style without a CM is agreed in writing before cutting."),
    },
    {
      title: "Materials",
      text:
        "The factory signs for every fabric and accessory issue. Fabric is used at the consumption " +
        "on each style's tech pack; what is left over goes back to the store at the end. Fabric or " +
        "accessories lost or wasted beyond the tech pack's allowance are charged to the factory.",
    },
    {
      title: "Cutting and dates",
      text:
        "Cutting starts within 7 days of the fabric issue, and the cutting report (style, colour, " +
        "size and pieces) is shared on the day of cutting. Embroidery or print pieces spoiled outside " +
        `are replaced from cutting at once. All pieces are delivered ${byDay(f, "by the day agreed for each style")}.`,
    },
    {
      title: "Quality and grading",
      text:
        "Each delivery is checked and graded: A (first quality), B (small faults, still sold) and " +
        "C (needs mending). Rejects (cannot be sold) are counted apart from Missing pieces (cut " +
        "but not delivered). Only A and B pieces go into stock.",
    },
    {
      title: "Deductions",
      text:
        "Missing pieces are deducted at their full cost per piece. Fabric faults caused by the " +
        "factory are deducted at the fabric price. C-grade pieces may be paid without CM when " +
        "agreed. Late delivery costs 1% of the CM for each week late, up to 5%.",
    },
    {
      title: "Payment",
      text:
        "Any advance CM is paid against this batch and taken off the final payment. The final CM " +
        "is paid within 15 days of the Final Match of the last delivery: Total CM less deductions " +
        "less advance is the final payable.",
    },
    DISPUTES,
  ];
}

/** The rule-drafted clauses for a contract's facts. */
export function ruleClauses(facts: ContractFacts): Clause[] {
  if (facts.kind === "FABRIC") return fabricClauses(facts);
  if (facts.kind === "ACCESSORIES") return accessoriesClauses(facts);
  return factoryClauses(facts);
}

/**
 * Reads clauses written by AI (a JSON array of { title, text }), or null when
 * they are not usable: not JSON, too few or too many, or a clause empty or too long.
 */
export function parseClauses(text: string): Clause[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length < 4 || value.length > 12) return null;
  const clauses: Clause[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { title, text: body } = item as Record<string, unknown>;
    if (typeof title !== "string" || typeof body !== "string") return null;
    const t = title.trim();
    const b = body.trim();
    if (!t || !b || t.length > MAX_CLAUSE_TITLE || b.length > MAX_CLAUSE_TEXT) return null;
    clauses.push({ title: t, text: b });
  }
  return clauses;
}

/** Stored clauses as plain values (a hand-edited row may be missing a part). */
export function readClauses(value: unknown): Clause[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { title, text } = item as Record<string, unknown>;
    return typeof title === "string" && typeof text === "string" ? [{ title, text }] : [];
  });
}
