/*
 * The colour check for lab dips (the blueprint's X06 rules). The buyer's
 * Pantone or TCX code, or their physical swatch, is the master; the dye mill
 * sends 4 to 6 options per round with its measured report (ΔE CMC 2:1, DL, DC,
 * DH and the metamerism index). Each option passes or fails against the
 * buyer's limit, the closest is picked and the passing ones are the ones to
 * send to the buyer. A photo can only ever give an approximate code. Pure: no
 * database.
 */

export type Lab = { L: number; a: number; b: number };

const rad = (deg: number) => (deg * Math.PI) / 180;

/** ΔE*ab (CIE 1976) between a standard and a batch. */
export function deltaE76(std: Lab, bat: Lab): number {
  return Math.hypot(bat.L - std.L, bat.a - std.a, bat.b - std.b);
}

/**
 * ΔE CMC(l:c) between a standard and a batch, with DL, DC and DH (batch minus
 * standard). The textile default is 2:1, which gives lightness twice the room.
 */
export function deltaCmc(std: Lab, bat: Lab, l = 2, c = 1) {
  const C1 = Math.hypot(std.a, std.b);
  const C2 = Math.hypot(bat.a, bat.b);
  const dL = bat.L - std.L;
  const dC = C2 - C1;
  const da = bat.a - std.a;
  const db = bat.b - std.b;
  const dH2 = Math.max(0, da * da + db * db - dC * dC);
  const SL = std.L < 16 ? 0.511 : (0.040975 * std.L) / (1 + 0.01765 * std.L);
  const SC = (0.0638 * C1) / (1 + 0.0131 * C1) + 0.638;
  let H1 = (Math.atan2(std.b, std.a) * 180) / Math.PI;
  if (H1 < 0) H1 += 360;
  const T =
    H1 >= 164 && H1 <= 345
      ? 0.56 + Math.abs(0.2 * Math.cos(rad(H1 + 168)))
      : 0.36 + Math.abs(0.4 * Math.cos(rad(H1 + 35)));
  const C14 = C1 ** 4;
  const F = Math.sqrt(C14 / (C14 + 1900));
  const SH = SC * (F * T + 1 - F);
  const dE = Math.sqrt((dL / (l * SL)) ** 2 + (dC / (c * SC)) ** 2 + dH2 / (SH * SH));
  return { dE, dL, dC, dH: Math.sqrt(dH2) };
}

/** The common textile limit when the buyer gives none. */
export const DEFAULT_LIMIT = 1.0;

export type LabDipVerdict = "PASS" | "FAIL";

export type OptionCheck = {
  verdict: LabDipVerdict;
  /** Why, in a line ("ΔE 0.78 within 1.00", "MI 1.3: change the recipe"). */
  why: string;
  /** A warning that does not fail it (a doubtful metamerism index). */
  warning: string | null;
};

const two = (n: number) => n.toFixed(2);

/** One option against the buyer's limit; a metamerism index above 1 fails even when ΔE passes. */
export function checkOption(
  option: { deltaE: number; mi?: number | null },
  limit: number = DEFAULT_LIMIT,
): OptionCheck {
  const mi = option.mi ?? null;
  if (option.deltaE > limit) {
    return {
      verdict: "FAIL",
      why: `ΔE ${two(option.deltaE)} is above the limit of ${two(limit)}`,
      warning: null,
    };
  }
  if (mi !== null && mi > 1) {
    return {
      verdict: "FAIL",
      why: `ΔE ${two(option.deltaE)} passes, but the metamerism index is ${two(mi)}: change the recipe`,
      warning: null,
    };
  }
  return {
    verdict: "PASS",
    why: `ΔE ${two(option.deltaE)} is within the limit of ${two(limit)}`,
    warning:
      mi !== null && mi >= 0.5
        ? `Metamerism index ${two(mi)} is doubtful: check under the second light`
        : null,
  };
}

/** Colours that are never approved by numbers: heather, white, neon, French terry. */
export function visualOnly(name: string): boolean {
  return /\b(heather|white|neon|french terry|optic)\b/i.test(name);
}

export type RoundAdvice = {
  /** The option nearest the standard in the latest round. */
  closest: string | null;
  /** The passing options, best first (at most three), to send to the buyer. */
  send: string[];
  /** What to do next, in a line. */
  next: string;
};

/** What the rounds so far say: the closest option, which to send, and what next. */
export function adviseRounds(
  options: ReadonlyArray<{ round: number; letter: string; deltaE: number; mi?: number | null }>,
  limit: number = DEFAULT_LIMIT,
  colourName = "",
): RoundAdvice {
  if (visualOnly(colourName)) {
    return {
      closest: null,
      send: [],
      next: "This colour is approved by eye only (heather, white, neon or French terry).",
    };
  }
  if (options.length === 0) {
    return {
      closest: null,
      send: [],
      next: "Ask the dye mill for lab dips with a measured report (ΔE CMC 2:1).",
    };
  }
  const latest = Math.max(...options.map((o) => o.round));
  const current = options.filter((o) => o.round === latest).sort((a, b) => a.deltaE - b.deltaE);
  const passing = current.filter((o) => checkOption(o, limit).verdict === "PASS");
  const closest = current[0]!.letter;
  if (passing.length > 0) {
    return {
      closest,
      send: passing.slice(0, 3).map((o) => o.letter),
      next: `Send ${passing
        .slice(0, 3)
        .map((o) => o.letter)
        .join(", ")} to the buyer for approval. No bulk dyeing before the buyer approves.`,
    };
  }
  const rounds = new Set(options.map((o) => o.round)).size;
  return {
    closest,
    send: [],
    next:
      rounds >= 2
        ? "No match after 2 rounds: ask the mill for its best can do (BCD) and tell the buyer."
        : `No option passes. Ask the mill for round ${latest + 1}, closer to ${closest}.`,
  };
}
