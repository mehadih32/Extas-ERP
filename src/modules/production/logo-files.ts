/*
 * Embroidery machine files for logos (the blueprint's Logo File Tool and X24
 * rules). Reads Tajima DST and Melco EXP files to check them (stitches, size,
 * colours, longest stitch, jumps) and, as the last resort after the buyer's
 * file and the factory's puncher, writes a draft DST and EXP from the buyer's
 * vector (SVG): filled shapes as rows of stitches, lines as running stitch.
 * A draft file always goes to a sew-out at the factory before the owner's
 * tick. No Wilcom EMB, and never a logo from a photo. Units: 0.1 mm. Pure.
 */

export const MACHINE_FORMATS = ["DST", "EXP", "PES", "JEF", "U01", "TAP", "DSB", "DSZ"] as const;
export type MachineFormat = (typeof MACHINE_FORMATS)[number];

/** Formats this tool reads to check; the others are kept as they are. */
export const READABLE_FORMATS: readonly MachineFormat[] = ["DST", "EXP"];

/** The longest stitch a Tajima allows (Barudan allows 12.7 mm). */
export const LONGEST_STITCH_MM = 12.1;

export type StitchKind = "STITCH" | "JUMP" | "COLOR" | "END";
export type Stitch = { x: number; y: number; kind: StitchKind };

export type Design = {
  /** Absolute positions in 0.1 mm, y up. */
  stitches: Stitch[];
};

/** What a machine file holds. */
export type DesignFacts = {
  stitches: number;
  jumps: number;
  colours: number;
  widthMm: number;
  heightMm: number;
  longestStitchMm: number;
  longestJumpMm: number;
};

// ---------------------------------------------------------------- DST

const bit = (n: number) => 1 << n;
const has = (byte: number, n: number) => (byte & bit(n)) !== 0;

/** The balanced-ternary digits of a DST move: weight, byte, bit for +, bit for −. */
const X_DIGITS = [
  [81, 2, 2, 3],
  [27, 1, 2, 3],
  [9, 0, 2, 3],
  [3, 1, 0, 1],
  [1, 0, 0, 1],
] as const;
const Y_DIGITS = [
  [81, 2, 5, 4],
  [27, 1, 5, 4],
  [9, 0, 5, 4],
  [3, 1, 7, 6],
  [1, 0, 7, 6],
] as const;

function encodeDst(dx: number, dy: number, kind: StitchKind): number[] {
  if (kind === "END") return [0, 0, 0xf3];
  const bytes = [0, 0, 0x03];
  if (kind === "JUMP") bytes[2]! |= bit(7);
  if (kind === "COLOR") bytes[2]! |= bit(7) | bit(6);
  for (const [digits, move] of [
    [X_DIGITS, dx],
    [Y_DIGITS, dy],
  ] as const) {
    let rest = move;
    for (const [weight, byte, plus, minus] of digits) {
      const half = (weight - 1) / 2;
      if (rest > half) {
        bytes[byte]! |= bit(plus);
        rest -= weight;
      } else if (rest < -half) {
        bytes[byte]! |= bit(minus);
        rest += weight;
      }
    }
  }
  return bytes;
}

function decodeDst(b0: number, b1: number, b2: number) {
  let x = 0;
  let y = 0;
  if (has(b2, 2)) x += 81;
  if (has(b2, 3)) x -= 81;
  if (has(b1, 2)) x += 27;
  if (has(b1, 3)) x -= 27;
  if (has(b0, 2)) x += 9;
  if (has(b0, 3)) x -= 9;
  if (has(b1, 0)) x += 3;
  if (has(b1, 1)) x -= 3;
  if (has(b0, 0)) x += 1;
  if (has(b0, 1)) x -= 1;
  if (has(b2, 5)) y += 81;
  if (has(b2, 4)) y -= 81;
  if (has(b1, 5)) y += 27;
  if (has(b1, 4)) y -= 27;
  if (has(b0, 5)) y += 9;
  if (has(b0, 4)) y -= 9;
  if (has(b1, 7)) y += 3;
  if (has(b1, 6)) y -= 3;
  if (has(b0, 7)) y += 1;
  if (has(b0, 6)) y -= 1;
  return { x, y };
}

/** Whether these bytes start like a Tajima DST (its 512-byte header begins "LA:"). */
export function looksLikeDst(bytes: Uint8Array): boolean {
  return bytes.length >= 515 && String.fromCharCode(...bytes.subarray(0, 3)) === "LA:";
}

export function readDst(bytes: Uint8Array): Design {
  if (!looksLikeDst(bytes)) throw new Error("This is not a DST file.");
  const stitches: Stitch[] = [];
  let x = 0;
  let y = 0;
  for (let i = 512; i + 2 < bytes.length; i += 3) {
    const [b0, b1, b2] = [bytes[i]!, bytes[i + 1]!, bytes[i + 2]!];
    if ((b2 & 0xf3) === 0xf3) {
      stitches.push({ x, y, kind: "END" });
      break;
    }
    const d = decodeDst(b0, b1, b2);
    x += d.x;
    y += d.y;
    const kind: StitchKind =
      (b2 & 0xc3) === 0xc3 ? "COLOR" : (b2 & 0x83) === 0x83 ? "JUMP" : "STITCH";
    stitches.push({ x, y, kind });
  }
  return { stitches };
}

/** Splits moves longer than the format allows into steps it can hold. */
function* steps(dx: number, dy: number, max: number) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / max));
  let doneX = 0;
  let doneY = 0;
  for (let i = 1; i <= n; i++) {
    const tx = Math.round((dx * i) / n);
    const ty = Math.round((dy * i) / n);
    yield { dx: tx - doneX, dy: ty - doneY, last: i === n };
    doneX = tx;
    doneY = ty;
  }
}

function pad(text: string, width: number, align: "left" | "right" = "left") {
  return align === "left" ? text.padEnd(width).slice(0, width) : text.padStart(width).slice(-width);
}

export function writeDst(design: Design, label: string): Uint8Array {
  const records: number[] = [];
  let x = 0;
  let y = 0;
  for (const s of design.stitches) {
    if (s.kind === "END") break;
    const dx = Math.round(s.x) - x;
    const dy = Math.round(s.y) - y;
    for (const step of steps(dx, dy, 121)) {
      const kind = step.last ? s.kind : "JUMP";
      // A long stitch is reached by jumps, then the last step sews.
      records.push(
        ...encodeDst(step.dx, step.dy, s.kind === "STITCH" && !step.last ? "JUMP" : kind),
      );
    }
    x = Math.round(s.x);
    y = Math.round(s.y);
  }
  records.push(...encodeDst(0, 0, "END"));
  const box = bounds(design.stitches);
  const colours = design.stitches.filter((s) => s.kind === "COLOR").length;
  const header =
    `LA:${pad(label.replace(/[^\x20-\x7e]/g, ""), 16)}\r` +
    `ST:${pad(String(records.length / 3), 7, "right")}\r` +
    `CO:${pad(String(colours), 3, "right")}\r` +
    `+X:${pad(String(Math.max(0, box.maxX)), 5, "right")}\r` +
    `-X:${pad(String(Math.max(0, -box.minX)), 5, "right")}\r` +
    `+Y:${pad(String(Math.max(0, box.maxY)), 5, "right")}\r` +
    `-Y:${pad(String(Math.max(0, -box.minY)), 5, "right")}\r` +
    `AX:+${pad(String(Math.abs(x)), 5, "right")}\r` +
    `AY:+${pad(String(Math.abs(y)), 5, "right")}\r` +
    `MX:+${pad("0", 5, "right")}\r` +
    `MY:+${pad("0", 5, "right")}\r` +
    `PD:******\r`;
  const head = new Uint8Array(512).fill(0x20);
  for (let i = 0; i < header.length; i++) head[i] = header.charCodeAt(i);
  head[header.length] = 0x1a;
  const out = new Uint8Array(512 + records.length);
  out.set(head, 0);
  out.set(records, 512);
  return out;
}

// ---------------------------------------------------------------- EXP

const signed = (b: number) => (b > 127 ? b - 256 : b);

export function readExp(bytes: Uint8Array): Design {
  const stitches: Stitch[] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  while (i + 1 < bytes.length) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1]!;
    i += 2;
    if (b0 !== 0x80) {
      x += signed(b0);
      y += signed(b1);
      stitches.push({ x, y, kind: "STITCH" });
      continue;
    }
    if (i + 1 >= bytes.length) break;
    const c0 = bytes[i]!;
    const c1 = bytes[i + 1]!;
    i += 2;
    if (b1 === 0x01) {
      x += signed(c0);
      y += signed(c1);
      stitches.push({ x, y, kind: "COLOR" });
    } else if (b1 === 0x04 || b1 === 0x02) {
      x += signed(c0);
      y += signed(c1);
      stitches.push({ x, y, kind: b1 === 0x04 ? "JUMP" : "STITCH" });
    }
    // 0x80 0x80 is a trim: nothing moves.
  }
  stitches.push({ x, y, kind: "END" });
  return { stitches };
}

export function writeExp(design: Design): Uint8Array {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (const s of design.stitches) {
    if (s.kind === "END") break;
    const dx = Math.round(s.x) - x;
    const dy = Math.round(s.y) - y;
    if (s.kind === "COLOR") {
      out.push(0x80, 0x01, 0, 0);
    }
    for (const step of steps(dx, dy, 127)) {
      if (s.kind === "STITCH" && step.last) out.push(step.dx & 0xff, step.dy & 0xff);
      else if (step.dx !== 0 || step.dy !== 0) out.push(0x80, 0x04, step.dx & 0xff, step.dy & 0xff);
    }
    x = Math.round(s.x);
    y = Math.round(s.y);
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- checks

function bounds(stitches: readonly Stitch[]) {
  const sewn = stitches.filter((s) => s.kind === "STITCH");
  const all = sewn.length > 0 ? sewn : stitches;
  if (all.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return {
    minX: Math.min(...all.map((s) => s.x)),
    maxX: Math.max(...all.map((s) => s.x)),
    minY: Math.min(...all.map((s) => s.y)),
    maxY: Math.max(...all.map((s) => s.y)),
  };
}

/** Stitches, jumps, colours, size and the longest stitch and jump. */
export function designFacts(design: Design): DesignFacts {
  let longestStitch = 0;
  let longestJump = 0;
  let jumpRun = 0;
  let prev: Stitch | null = null;
  for (const s of design.stitches) {
    if (prev) {
      const d = Math.hypot(s.x - prev.x, s.y - prev.y);
      if (s.kind === "STITCH") {
        if (prev.kind !== "JUMP") longestStitch = Math.max(longestStitch, d);
        jumpRun = 0;
      } else if (s.kind === "JUMP") {
        jumpRun += d;
        longestJump = Math.max(longestJump, jumpRun);
      }
    }
    prev = s;
  }
  const box = bounds(design.stitches);
  const colourChanges = design.stitches.filter((s) => s.kind === "COLOR").length;
  return {
    stitches: design.stitches.filter((s) => s.kind === "STITCH").length,
    jumps: design.stitches.filter((s) => s.kind === "JUMP").length,
    colours: colourChanges + 1,
    widthMm: Math.round(box.maxX - box.minX) / 10,
    heightMm: Math.round(box.maxY - box.minY) / 10,
    longestStitchMm: Math.round(longestStitch) / 10,
    longestJumpMm: Math.round(longestJump) / 10,
  };
}

export type FileVerdict = "PASS" | "WARN" | "FAIL";

export type FileCheck = DesignFacts & {
  verdict: FileVerdict;
  notes: string[];
};

/** Public stitch counts of well-known logos: a file far off them is worth a second look. */
export const REFERENCE_STITCHES: Readonly<Record<string, number>> = {
  "RL small pony": 982,
  "RL Big Pony": 10_800,
  "Lacoste croc": 2_367,
};

/**
 * A machine file against the logo's spec: the size within ±1 mm or ±2%, no
 * stitch longer than the machine allows, the thread colours, and the stitch
 * count against an approved file or a public reference.
 */
export function checkDesign(
  design: Design,
  spec: {
    widthMm?: number | null;
    heightMm?: number | null;
    colours?: number | null;
    approvedStitches?: number | null;
    reference?: string | null;
  } = {},
): FileCheck {
  const facts = designFacts(design);
  const notes: string[] = [];
  let verdict: FileVerdict = "PASS";
  const fail = (note: string) => {
    verdict = "FAIL";
    notes.push(note);
  };
  const warn = (note: string) => {
    if (verdict === "PASS") verdict = "WARN";
    notes.push(note);
  };
  if (facts.stitches === 0) fail("The file has no stitches.");
  const within = (got: number, want: number) => Math.abs(got - want) <= Math.max(1, want * 0.02);
  if (spec.widthMm && !within(facts.widthMm, spec.widthMm)) {
    fail(`Width ${facts.widthMm} mm, the spec says ${spec.widthMm} mm (±1 mm or 2%).`);
  }
  if (spec.heightMm && !within(facts.heightMm, spec.heightMm)) {
    fail(`Height ${facts.heightMm} mm, the spec says ${spec.heightMm} mm (±1 mm or 2%).`);
  }
  if (facts.longestStitchMm > LONGEST_STITCH_MM) {
    fail(
      `A stitch is ${facts.longestStitchMm} mm long; a Tajima takes ${LONGEST_STITCH_MM} mm at most.`,
    );
  }
  if (spec.colours && facts.colours !== spec.colours) {
    warn(`${facts.colours} thread colours in the file, ${spec.colours} in the spec.`);
  }
  if (spec.approvedStitches && facts.stitches !== spec.approvedStitches) {
    fail(`${facts.stitches} stitches, the approved file has ${spec.approvedStitches}.`);
  }
  const ref = spec.reference ? REFERENCE_STITCHES[spec.reference] : undefined;
  if (ref && Math.abs(facts.stitches - ref) > ref * 0.1) {
    warn(
      `${facts.stitches} stitches, more than 10% off the ${spec.reference} reference of ${ref}.`,
    );
  }
  if (facts.longestJumpMm > 30) {
    warn(`A jump of ${facts.longestJumpMm} mm: the factory should trim it.`);
  }
  return { ...facts, verdict, notes };
}

// ---------------------------------------------------------------- SVG to stitches

type Point = { x: number; y: number };
type Shape = { colour: string; fill: boolean; rings: Point[][] };

export class VectorError extends Error {}

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const nums = (text: string) => (text.match(NUM) ?? []).map(Number);

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});

function parseTransform(text: string | undefined): Matrix {
  let m: Matrix = IDENTITY;
  if (!text) return m;
  for (const [, op, args] of text.matchAll(/(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g)) {
    const v = nums(args!);
    let n: Matrix = IDENTITY;
    if (op === "matrix" && v.length >= 6) n = v.slice(0, 6) as Matrix;
    if (op === "translate") n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    if (op === "scale") n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    if (op === "rotate") {
      const a = ((v[0] ?? 0) * Math.PI) / 180;
      const r: Matrix = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
      const cx = v[1] ?? 0;
      const cy = v[2] ?? 0;
      n = multiply(multiply([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -cx, -cy]);
    }
    m = multiply(m, n);
  }
  return m;
}

function attrsOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [, name, , value1, value2] of tag.matchAll(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g,
  )) {
    attrs[name!] = value1 ?? value2 ?? "";
  }
  const style = attrs.style;
  if (style) {
    for (const part of style.split(";")) {
      const [k, v] = part.split(":").map((s) => s.trim());
      if (k && v) attrs[k] = v;
    }
  }
  return attrs;
}

/** Bézier and arc points, flattened to short lines. */
function cubic(p0: Point, p1: Point, p2: Point, p3: Point, n = 16): Point[] {
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

function arc(
  p0: Point,
  rx0: number,
  ry0: number,
  angle: number,
  large: boolean,
  sweep: boolean,
  p: Point,
): Point[] {
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if (rx === 0 || ry === 0) return [p];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0.x - p.x) / 2;
  const dy = (p0.y - p.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (coef * rx * y1) / ry;
  const cy1 = (-coef * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0.y + p.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 12)));
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push({ x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy });
  }
  return out;
}

/** A path's `d` as rings of points (each subpath one ring). */
export function pathRings(d: string): { rings: Point[][]; closed: boolean[] } {
  const rings: Point[][] = [];
  const closed: boolean[] = [];
  let ring: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let lastCtrl: Point | null = null;
  let lastCmd = "";
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0;
  const next = () => Number(tokens[i++]);
  const finish = (isClosed: boolean) => {
    if (ring.length > 1) {
      rings.push(ring);
      closed.push(isClosed);
    }
    ring = [];
  };
  let cmd = "";
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i]!)) cmd = tokens[i++]!;
    else if (cmd === "") throw new VectorError("The SVG path could not be read.");
    const rel = cmd === cmd.toLowerCase();
    const base = rel ? cur : { x: 0, y: 0 };
    const pt = (x: number, y: number): Point => ({ x: base.x + x, y: base.y + y });
    switch (cmd.toUpperCase()) {
      case "M": {
        finish(false);
        cur = pt(next(), next());
        start = cur;
        ring = [cur];
        cmd = rel ? "l" : "L";
        lastCtrl = null;
        break;
      }
      case "L":
        cur = pt(next(), next());
        ring.push(cur);
        lastCtrl = null;
        break;
      case "H":
        cur = { x: (rel ? cur.x : 0) + next(), y: cur.y };
        ring.push(cur);
        lastCtrl = null;
        break;
      case "V":
        cur = { x: cur.x, y: (rel ? cur.y : 0) + next() };
        ring.push(cur);
        lastCtrl = null;
        break;
      case "C": {
        const c1 = pt(next(), next());
        const c2 = pt(next(), next());
        const end = pt(next(), next());
        ring.push(...cubic(cur, c1, c2, end));
        lastCtrl = c2;
        cur = end;
        break;
      }
      case "S": {
        const c1 =
          lastCtrl && /[CS]/i.test(lastCmd)
            ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y }
            : cur;
        const c2 = pt(next(), next());
        const end = pt(next(), next());
        ring.push(...cubic(cur, c1, c2, end));
        lastCtrl = c2;
        cur = end;
        break;
      }
      case "Q": {
        const c = pt(next(), next());
        const end = pt(next(), next());
        const c1 = { x: cur.x + (2 / 3) * (c.x - cur.x), y: cur.y + (2 / 3) * (c.y - cur.y) };
        const c2 = { x: end.x + (2 / 3) * (c.x - end.x), y: end.y + (2 / 3) * (c.y - end.y) };
        ring.push(...cubic(cur, c1, c2, end));
        lastCtrl = c;
        cur = end;
        break;
      }
      case "T": {
        const c: Point =
          lastCtrl && /[QT]/i.test(lastCmd)
            ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y }
            : cur;
        const end = pt(next(), next());
        const c1 = { x: cur.x + (2 / 3) * (c.x - cur.x), y: cur.y + (2 / 3) * (c.y - cur.y) };
        const c2 = { x: end.x + (2 / 3) * (c.x - end.x), y: end.y + (2 / 3) * (c.y - end.y) };
        ring.push(...cubic(cur, c1, c2, end));
        lastCtrl = c;
        cur = end;
        break;
      }
      case "A": {
        const rx = next();
        const ry = next();
        const rot = next();
        const large = next() !== 0;
        const sweep = next() !== 0;
        const end = pt(next(), next());
        ring.push(...arc(cur, rx, ry, rot, large, sweep, end));
        cur = end;
        lastCtrl = null;
        break;
      }
      case "Z":
        cur = start;
        finish(true);
        ring = [cur];
        lastCtrl = null;
        break;
      default:
        throw new VectorError("The SVG path could not be read.");
    }
    lastCmd = cmd;
    if (Number.isNaN(cur.x) || Number.isNaN(cur.y)) {
      throw new VectorError("The SVG path could not be read.");
    }
  }
  finish(false);
  return { rings, closed };
}

const ellipse = (cx: number, cy: number, rx: number, ry: number): Point[] =>
  Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * 2 * Math.PI;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });

/** The filled shapes and lines of an SVG, in drawing order. */
export function readSvg(svg: string): { shapes: Shape[]; viewBox: number[] | null } {
  if (!/<svg[\s>]/i.test(svg)) throw new VectorError("This is not an SVG file.");
  if (/<text[\s>]/i.test(svg)) {
    throw new VectorError("The SVG has live text. Convert the text to outlines first.");
  }
  if (/<image[\s>]/i.test(svg)) {
    throw new VectorError("The SVG holds a picture, not a vector. A vector logo is needed.");
  }
  const clean = svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(defs|clipPath|mask|style)[\s\S]*?<\/\1>/gi, "");
  const rootTag = clean.match(/<svg[^>]*>/i)?.[0] ?? "";
  const viewBox = attrsOf(rootTag).viewBox ? nums(attrsOf(rootTag).viewBox!) : null;
  const shapes: Shape[] = [];
  const stack: Array<{ m: Matrix; fill: string | undefined; stroke: string | undefined }> = [
    { m: IDENTITY, fill: undefined, stroke: undefined },
  ];
  for (const [tag, close, name] of clean.matchAll(/<(\/?)([a-zA-Z]+)\b[^>]*>/g)) {
    const top = stack[stack.length - 1]!;
    if (name === "g" || name === "svg") {
      if (close) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const a = attrsOf(tag!);
      const entry = {
        m: name === "g" ? multiply(top.m, parseTransform(a.transform)) : top.m,
        fill: a.fill ?? top.fill,
        stroke: a.stroke ?? top.stroke,
      };
      if (!tag!.endsWith("/>")) stack.push(entry);
      continue;
    }
    if (close) continue;
    const a = attrsOf(tag!);
    const m = multiply(top.m, parseTransform(a.transform));
    const fill = a.fill ?? top.fill ?? "#000000";
    const stroke = a.stroke ?? top.stroke;
    let rings: Point[][] = [];
    let closedShape = true;
    switch (name) {
      case "path": {
        const read = pathRings(a.d ?? "");
        rings = read.rings;
        closedShape = read.closed.some(Boolean) || fill !== "none";
        break;
      }
      case "rect": {
        const x = Number(a.x ?? 0);
        const y = Number(a.y ?? 0);
        const w = Number(a.width ?? 0);
        const h = Number(a.height ?? 0);
        rings = [
          [
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h },
          ],
        ];
        break;
      }
      case "circle":
        rings = [ellipse(Number(a.cx ?? 0), Number(a.cy ?? 0), Number(a.r ?? 0), Number(a.r ?? 0))];
        break;
      case "ellipse":
        rings = [
          ellipse(Number(a.cx ?? 0), Number(a.cy ?? 0), Number(a.rx ?? 0), Number(a.ry ?? 0)),
        ];
        break;
      case "polygon":
      case "polyline": {
        const v = nums(a.points ?? "");
        const ring: Point[] = [];
        for (let i = 0; i + 1 < v.length; i += 2) ring.push({ x: v[i]!, y: v[i + 1]! });
        rings = [ring];
        closedShape = name === "polygon";
        break;
      }
      case "line":
        rings = [
          [
            { x: Number(a.x1 ?? 0), y: Number(a.y1 ?? 0) },
            { x: Number(a.x2 ?? 0), y: Number(a.y2 ?? 0) },
          ],
        ];
        closedShape = false;
        break;
      default:
        continue;
    }
    rings = rings.filter((r) => r.length > 1).map((r) => r.map((p) => apply(m, p)));
    if (rings.length === 0) continue;
    if (fill !== "none" && closedShape)
      shapes.push({ colour: fill.toLowerCase(), fill: true, rings });
    else if (stroke && stroke !== "none")
      shapes.push({ colour: stroke.toLowerCase(), fill: false, rings });
  }
  if (shapes.length === 0) throw new VectorError("The SVG has no shapes to stitch.");
  return { shapes, viewBox };
}

/** Stitch settings in 0.1 mm: fill rows 0.4 mm apart, stitches up to 3 mm, running stitch 2.5 mm. */
const ROW = 4;
const FILL_STITCH = 30;
const RUN_STITCH = 25;
const CONNECT = 20;

function runLine(from: Point, to: Point, length: number): Point[] {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  const n = Math.max(1, Math.ceil(d / length));
  return Array.from({ length: n }, (_, i) => ({
    x: from.x + ((to.x - from.x) * (i + 1)) / n,
    y: from.y + ((to.y - from.y) * (i + 1)) / n,
  }));
}

/** Rows of stitches across a shape (even-odd), alternating direction. */
function fillRings(rings: Point[][]): Point[][] {
  const ys = rings.flat().map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const runs: Point[][] = [];
  let flip = false;
  for (let y = minY + ROW / 2; y < maxY; y += ROW) {
    const xs: number[] = [];
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
      }
    }
    xs.sort((p, q) => p - q);
    const row: Point[][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = { x: xs[i]!, y };
      const to = { x: xs[i + 1]!, y };
      if (to.x - from.x < 1) continue;
      row.push(
        flip ? [to, ...runLine(to, from, FILL_STITCH)] : [from, ...runLine(from, to, FILL_STITCH)],
      );
    }
    if (flip) row.reverse();
    runs.push(...row);
    flip = !flip;
  }
  return runs;
}

/**
 * A draft machine design from an SVG, scaled to the logo's width in mm:
 * one thread colour per SVG colour, in drawing order.
 */
export function svgToDesign(svg: string, widthMm: number): Design {
  const { shapes } = readSvg(svg);
  const pts = shapes.flatMap((s) => s.rings.flat());
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  if (!(maxX > minX)) throw new VectorError("The SVG has no width to stitch.");
  const scale = (widthMm * 10) / (maxX - minX);
  // SVG y runs down, machine y up; centred on the logo.
  const toMachine = (p: Point): Point => ({
    x: (p.x - (minX + maxX) / 2) * scale,
    y: -(p.y - (minY + maxY) / 2) * scale,
  });
  const colours = [...new Set(shapes.map((s) => s.colour))];
  const stitches: Stitch[] = [];
  let at: Point | null = null;
  const moveTo = (p: Point) => {
    if (!at || Math.hypot(p.x - at.x, p.y - at.y) > CONNECT) {
      stitches.push({ ...p, kind: "JUMP" });
    } else {
      stitches.push({ ...p, kind: "STITCH" });
    }
    at = p;
  };
  colours.forEach((colour, ci) => {
    if (ci > 0) stitches.push({ ...(at ?? { x: 0, y: 0 }), kind: "COLOR" });
    for (const shape of shapes.filter((s) => s.colour === colour)) {
      const rings = shape.rings.map((r) => r.map(toMachine));
      const runs = shape.fill
        ? fillRings(rings)
        : rings.map((r) => [r[0]!, ...r.slice(1).flatMap((p, i) => runLine(r[i]!, p, RUN_STITCH))]);
      for (const run of runs) {
        moveTo(run[0]!);
        for (const p of run.slice(1)) {
          stitches.push({ ...p, kind: "STITCH" });
          at = p;
        }
      }
    }
  });
  stitches.push({ ...(at ?? { x: 0, y: 0 }), kind: "END" });
  return {
    stitches: stitches.map((s) => ({ ...s, x: Math.round(s.x), y: Math.round(s.y) })),
  };
}

/** A machine file name of at most 8 characters, like LA01PQ02. */
export function machineFileName(name: string, fabric: string | null, n: number): string {
  const letters = name
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 4)
    .padEnd(2, "X");
  const fab = (fabric ?? "")
    .replace(/[^a-z]/gi, "")
    .toUpperCase()
    .slice(0, 2);
  return `${letters}${fab}${String(n).padStart(2, "0")}`.slice(0, 8);
}

/** The rules a machine file follows (X24), printed in the digitizing brief. */
export const LOGO_FILE_RULES = [
  "One master file; the fabric versions differ only in underlay, density and backing.",
  `No stitch longer than ${LONGEST_STITCH_MM} mm (Tajima); trim every jump longer than 30 mm.`,
  "Size within ±1 mm or 2% of the spec; resize a machine file by no more than ±10%.",
  "Small text: satin spacing 0.4 mm on a 4 mm column; 60 wt thread with needle 65 for letters of 4 to 5 mm; no underlay on tiny letters.",
  "File name of at most 8 characters, e.g. LA01PQ02.DST. No Wilcom EMB.",
] as const;

/** A stored check in a line: "PASS: 982 stitches, 23.4 × 23.4 mm, 3 colours, longest stitch 7 mm." */
export function checkText(value: unknown): string {
  const c = value as Partial<FileCheck> | null;
  if (!c || typeof c !== "object" || !c.verdict) return "Not checked.";
  const facts = `${c.stitches ?? 0} stitches, ${c.widthMm ?? 0} × ${c.heightMm ?? 0} mm, ${c.colours ?? 0} colour(s), longest stitch ${c.longestStitchMm ?? 0} mm`;
  return [`${c.verdict}: ${facts}.`, ...(c.notes ?? [])].join(" ");
}
