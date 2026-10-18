import { readFileSync } from "node:fs";
import path from "node:path";

import { drawText, fitText, pdfText, type TextStyle, textWidth } from "@/lib/pdf";
import { GUIDE_QUESTIONS, type GuidePicture } from "@/modules/backups/restore-guide";

/*
 * The restore guide's pictures (G6), one for most steps: what the screen shows
 * (Azure, PuTTY, Google on the phone, the ERP), with what to click ringed in red.
 *
 * Real screenshots come first: a PNG named <picture>.png in public/restore-guide
 * (for example public/restore-guide/azure-admin.png) is printed instead of the
 * drawing, under the words "Screenshot". SCREENSHOT_SLOTS says what each one
 * must show, with the screen's exact words. Without the file, the drawing is
 * printed, labelled as a drawing. Every drawing is on a 600 x 250 canvas scaled
 * to the page. Text the restore command prints is taken from the same words
 * the scripts use (GUIDE_QUESTIONS), so it matches.
 */

export const PICTURE = { width: 600, height: 250 };

const INK = "#1F2933";
const MUTED = "#6B7280";
const LINE = "#B8C2CC";
const BLUE = "#0F6CBD";
const MARK = "#D92D20";
const GREEN = "#107C10";
const TERM_BG = "#0C0C0C";
const TERM_INK = "#CCCCCC";
const TERM_HI = "#FFE066";
/** Text Courier draws as it is: printable ASCII. */
const PLAIN = /^[\x20-\x7e]*$/;

type Shape = { fill?: string; stroke?: string; r?: number; lw?: number; opacity?: number };
type Words = {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  color?: string;
  /** Cut to this width (with "…"), and align within it. */
  w?: number;
  align?: "left" | "center" | "right";
};

/** Drawing on the 600 x 250 canvas, placed at (x0, y0) on the page and scaled by k. */
class Scene {
  readonly marks: Array<[number, number, number, number, number]> = [];

  constructor(
    readonly doc: PDFKit.PDFDocument,
    readonly x0: number,
    readonly y0: number,
    readonly k: number,
  ) {}

  private X = (x: number) => this.x0 + x * this.k;
  private Y = (y: number) => this.y0 + y * this.k;
  private S = (v: number) => v * this.k;

  private shape(path: () => void, o: Shape) {
    const d = this.doc;
    d.save();
    path();
    d.lineWidth(this.S(o.lw ?? 0.8));
    if (o.opacity !== undefined) d.fillOpacity(o.opacity);
    if (o.fill && o.stroke) d.fillAndStroke(o.fill, o.stroke);
    else if (o.fill) d.fill(o.fill);
    else d.stroke(o.stroke ?? LINE);
    d.restore();
  }

  rect(x: number, y: number, w: number, h: number, o: Shape = {}) {
    this.shape(() => {
      if (o.r) this.doc.roundedRect(this.X(x), this.Y(y), this.S(w), this.S(h), this.S(o.r));
      else this.doc.rect(this.X(x), this.Y(y), this.S(w), this.S(h));
    }, o);
  }

  circle(cx: number, cy: number, r: number, o: Shape = {}) {
    this.shape(() => this.doc.circle(this.X(cx), this.Y(cy), this.S(r)), o);
  }

  poly(points: Array<[number, number]>, o: Shape = {}) {
    this.shape(
      () => this.doc.polygon(...points.map(([x, y]): [number, number] => [this.X(x), this.Y(y)])),
      o,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, color = LINE, lw = 0.8) {
    const d = this.doc;
    d.save();
    d.moveTo(this.X(x1), this.Y(y1))
      .lineTo(this.X(x2), this.Y(y2))
      .lineWidth(this.S(lw))
      .stroke(color);
    d.restore();
  }

  private style(o: Words): TextStyle {
    const font = o.mono
      ? o.bold
        ? "Courier-Bold"
        : "Courier"
      : o.bold
        ? "Helvetica-Bold"
        : o.italic
          ? "Helvetica-Oblique"
          : "Helvetica";
    return { font, size: this.S(o.size ?? 8) };
  }

  /** The width of a text on the canvas. */
  width(text: string, o: Words = {}) {
    if (o.mono && PLAIN.test(text)) return text.length * 0.6 * (o.size ?? 8);
    return textWidth(this.doc, text, this.style(o)) / this.k;
  }

  /** One line of text with its top at y; returns its width on the canvas. */
  text(text: string, x: number, y: number, o: Words = {}) {
    const style = this.style(o);
    if (o.mono && PLAIN.test(text)) {
      // A terminal's text keeps every space (drawText would merge them).
      const shown =
        o.w !== undefined ? text.slice(0, Math.floor(o.w / (0.6 * (o.size ?? 8)))) : text;
      this.doc
        .font(style.font)
        .fontSize(style.size)
        .fillColor(o.color ?? INK);
      this.doc.text(shown, this.X(x), this.Y(y), { lineBreak: false });
      return shown.length * 0.6 * (o.size ?? 8);
    }
    const shown = o.w !== undefined ? fitText(this.doc, text, this.S(o.w), style) : pdfText(text);
    const width = textWidth(this.doc, shown, style);
    let left = this.X(x);
    if (o.w !== undefined && o.align === "center") left += (this.S(o.w) - width) / 2;
    if (o.w !== undefined && o.align === "right") left += this.S(o.w) - width;
    this.doc.fillColor(o.color ?? INK);
    drawText(this.doc, shown, left, this.Y(y), style);
    return width / this.k;
  }

  /** What to click: ringed in red once the picture is drawn, `pad` around it. */
  mark(x: number, y: number, w: number, h: number, pad = 3) {
    this.marks.push([x, y, w, h, pad]);
  }

  drawMarks() {
    for (const [x, y, w, h, pad] of this.marks) {
      this.rect(x - pad, y - pad, w + 2 * pad, h + 2 * pad, { stroke: MARK, lw: 2.2, r: 3 });
    }
  }
}

// --- Parts that come back ----------------------------------------------------------

function button(
  s: Scene,
  x: number,
  y: number,
  label: string,
  o: { primary?: boolean; mark?: boolean; size?: number; h?: number; w?: number } = {},
) {
  const size = o.size ?? 7.5;
  const h = o.h ?? 16;
  const w = o.w ?? s.width(label, { size, bold: o.primary }) + 16;
  s.rect(
    x,
    y,
    w,
    h,
    o.primary ? { fill: BLUE, r: 2 } : { fill: "#FFFFFF", stroke: "#8A96A3", r: 2 },
  );
  s.text(label, x, y + (h - size) / 2, {
    size,
    bold: o.primary,
    color: o.primary ? "#FFFFFF" : INK,
    w,
    align: "center",
  });
  if (o.mark) s.mark(x, y, w, h);
  return w;
}

function check(s: Scene, x: number, y: number, label: string, on: boolean, size = 7.5) {
  s.rect(
    x,
    y + 0.5,
    8,
    8,
    on ? { fill: BLUE, r: 1 } : { fill: "#FFFFFF", stroke: "#6B7280", r: 1 },
  );
  if (on) {
    s.line(x + 1.8, y + 4.6, x + 3.5, y + 6.4, "#FFFFFF", 1.2);
    s.line(x + 3.5, y + 6.4, x + 6.4, y + 2.4, "#FFFFFF", 1.2);
  }
  s.text(label, x + 12, y + 0.5, { size });
}

function radio(s: Scene, x: number, y: number, label: string, on: boolean, size = 7.5) {
  s.circle(x + 4, y + 4.5, 4, { fill: "#FFFFFF", stroke: on ? BLUE : "#6B7280" });
  if (on) s.circle(x + 4, y + 4.5, 2.2, { fill: BLUE });
  return s.text(label, x + 12, y + 0.5, { size }) + 12;
}

function dropdownArrow(s: Scene, x: number, y: number) {
  s.poly(
    [
      [x, y],
      [x + 6, y],
      [x + 3, y + 3.5],
    ],
    { fill: "#4B5563" },
  );
}

/** An input box with its value; a drop-down has a small arrow. */
function input(
  s: Scene,
  x: number,
  y: number,
  w: number,
  value: string,
  o: { dropdown?: boolean; mark?: boolean; mono?: boolean; muted?: boolean } = {},
) {
  s.rect(x, y, w, 15, { fill: "#FFFFFF", stroke: "#8A96A3", r: 2 });
  s.text(value, x + 5, y + 4, {
    size: 7.5,
    mono: o.mono,
    color: o.muted ? MUTED : INK,
    w: w - (o.dropdown ? 18 : 10),
  });
  if (o.dropdown) dropdownArrow(s, x + w - 12, y + 6);
  if (o.mark) s.mark(x, y, w, 15);
}

/** Azure's form row: the label on the left, the box on the right. */
function row(
  s: Scene,
  y: number,
  label: string,
  value: string,
  o: { dropdown?: boolean; mark?: boolean; link?: string; markLink?: boolean } = {},
) {
  s.text(label, 28, y + 4, { size: 7.5, w: 165 });
  input(s, 200, y, 290, value, o);
  if (o.link) {
    const w = s.text(o.link, 200, y + 18, { size: 7, color: BLUE });
    if (o.markLink) s.mark(200, y + 17, w, 9);
  }
}

function section(s: Scene, y: number, title: string) {
  s.text(title, 20, y, { size: 9, bold: true });
}

/** The Azure portal: its dark top bar, the breadcrumbs and the page title. */
function azure(s: Scene, title: string, crumbs = "Home >") {
  s.rect(0, 0, 600, 250, { fill: "#FFFFFF", stroke: LINE });
  s.rect(0, 0, 600, 20, { fill: "#1B1A19" });
  s.text("Microsoft Azure", 10, 6, { size: 8, bold: true, color: "#FFFFFF" });
  s.rect(170, 4, 260, 12, { fill: "#FFFFFF", r: 2 });
  s.text("Search resources, services, and docs (G+/)", 178, 6.5, { size: 6, color: MUTED });
  s.circle(580, 10, 5, { fill: "#8764B8" });
  s.text(crumbs, 20, 26, { size: 6.5, color: BLUE });
  s.text(title, 20, 36, { size: 11, bold: true });
}

const VM_TABS = [
  "Basics",
  "Disks",
  "Networking",
  "Management",
  "Monitoring",
  "Advanced",
  "Tags",
  "Review + create",
];

/** Azure's "Create a virtual machine" page with one tab open. */
function createVm(s: Scene, tab: string) {
  azure(s, "Create a virtual machine", "Home > Virtual machines >");
  let x = 20;
  for (const name of VM_TABS) {
    const w = s.text(name, x, 54, {
      size: 7,
      color: name === tab ? INK : BLUE,
      bold: name === tab,
    });
    if (name === tab) s.line(x, 64, x + w, 64, BLUE, 1.6);
    x += w + 14;
  }
  s.line(20, 66, 580, 66, "#E1E5EA");
  s.rect(0, 226, 600, 24, { fill: "#FFFFFF" });
  s.line(0, 226, 600, 226, "#E1E5EA");
}

function azureFooter(s: Scene, next: string, o: { markNext?: boolean; create?: boolean } = {}) {
  const w = button(s, 20, 231, o.create ? "Create" : "Review + create", {
    primary: true,
    mark: o.create,
  });
  const p = button(s, 28 + w, 231, "< Previous");
  button(s, 36 + w + p, 231, next, { mark: o.markNext });
}

/** A browser window at an address. */
function browser(s: Scene, address: string) {
  s.rect(0, 0, 600, 250, { fill: "#FFFFFF", stroke: LINE, r: 5 });
  s.rect(0, 0, 600, 24, { fill: "#E9ECEF", r: 5 });
  s.rect(0, 16, 600, 8, { fill: "#E9ECEF" });
  s.text("<   >   C", 10, 8, { size: 7, color: MUTED });
  s.rect(60, 5, 470, 14, { fill: "#FFFFFF", r: 7 });
  s.text(address, 72, 8.5, { size: 7, w: 450 });
}

type Line = string | { text: string; hi?: boolean };

/** A PuTTY window: its title bar and lines of text, the ones to look at in yellow and ringed. */
function terminal(
  s: Scene,
  lines: Line[],
  o: { x?: number; y?: number; w?: number; h?: number; title?: string; size?: number } = {},
) {
  const x = o.x ?? 0;
  const y = o.y ?? 0;
  const w = o.w ?? 600;
  const h = o.h ?? 250;
  const size = o.size ?? 7;
  s.rect(x, y, w, h, { fill: TERM_BG, stroke: "#5A5A5A" });
  s.rect(x, y, w, 14, { fill: "#F3F3F3" });
  s.text(o.title ?? "erpadmin@extas-erp: ~", x + 18, y + 3.5, { size: 6.5, w: w - 70 });
  s.rect(x + 5, y + 3, 8, 8, { fill: "#2D7D46", r: 1 });
  s.text("-    o    x", x + w - 44, y + 3, { size: 6.5, color: "#444444" });
  const perLine = Math.floor((w - 12) / (size * 0.6));
  let ty = y + 19;
  const step = size * 1.42;
  // Lines to look at, one after another, are ringed together.
  let run: { top: number; chars: number } | null = null;
  const ring = () => {
    if (run)
      s.mark(x + 5, run.top - 2, Math.min(w - 10, run.chars * size * 0.6 + 2), ty - run.top - 1, 1);
    run = null;
  };
  for (const item of lines) {
    const line = typeof item === "string" ? { text: item } : item;
    const pieces = line.text.length ? [] : [""];
    for (let i = 0; i < line.text.length; i += perLine)
      pieces.push(line.text.slice(i, i + perLine));
    if (!line.hi) ring();
    else if (!run) run = { top: ty, chars: 0 };
    for (const piece of pieces) {
      if (ty + step > y + h - 3) break;
      s.text(piece, x + 6, ty, { mono: true, size, color: line.hi ? TERM_HI : TERM_INK });
      ty += step;
      if (run) run.chars = Math.max(run.chars, piece.length);
    }
  }
  ring();
}

/** A phone with its browser at an address; returns the screen's left, top and width. */
function phone(s: Scene, address: string, x = 330) {
  s.rect(x, 2, 150, 246, { fill: "#1F2933", r: 18 });
  s.rect(x + 7, 16, 136, 222, { fill: "#FFFFFF", r: 5 });
  s.rect(x + 50, 7, 50, 4, { fill: "#4B5563", r: 2 });
  s.rect(x + 12, 21, 126, 13, { fill: "#F1F3F4", r: 6 });
  s.text(address, x + 18, 24.5, { size: 6.3, w: 114 });
  return { left: x + 14, top: 42, width: 122 };
}

function googleWord(s: Scene, x: number, y: number, size = 10) {
  const colors = ["#4285F4", "#EA4335", "#FBBC05", "#4285F4", "#34A853", "#EA4335"];
  let cx = x;
  [..."Google"].forEach((ch, i) => {
    cx += s.text(ch, cx, y, { size, bold: true, color: colors[i] });
  });
}

/** Lines of text that wrap within a width (a picture's paragraph). */
function para(
  s: Scene,
  text: string,
  x: number,
  y: number,
  w: number,
  o: Words & { lineGap?: number } = {},
) {
  const size = o.size ?? 7;
  const words = text.split(" ");
  let line = "";
  let ty = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && s.width(next, o) > w) {
      s.text(line, x, ty, o);
      ty += size * (o.lineGap ?? 1.4);
      line = word;
    } else line = next;
  }
  if (line) {
    s.text(line, x, ty, o);
    ty += size * (o.lineGap ?? 1.4);
  }
  return ty;
}

// --- Examples shown in the pictures (made up, and recognisably so) ------------------

const EXAMPLE_IP = "20.193.10.25";
const EXAMPLE_COMMIT = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const EXAMPLE_SHA = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";
const PROMPT = "erpadmin@extas-erp:~$ ";
const question = (start: string) => GUIDE_QUESTIONS.find((q) => q.prompt.startsWith(start))!.prompt;

const COMMAND = [
  `c=${EXAMPLE_COMMIT} &&`,
  "curl -fsSL https://raw.githubusercontent.com/mehadih32/Extas-ERP/$c/deploy/bootstrap.sh -o restore.sh &&",
  `echo "${EXAMPLE_SHA} restore.sh" | sha256sum -c &&`,
  "sudo bash restore.sh $c",
];
const PASTED: Line[] = [PROMPT + COMMAND[0], ...COMMAND.slice(1).map((l) => `> ${l}`)];

const PUTTY_TREE_SESSION = [
  "Session",
  "  Logging",
  "Terminal",
  "  Keyboard",
  "  Bell",
  "Window",
  "  Appearance",
  "  Selection",
  "Connection",
  "  Data",
  "  Proxy",
  "  SSH",
  "  Serial",
];

const PUTTY_TREE_AUTH = [
  "Session",
  "Terminal",
  "Window",
  "Connection",
  "  Data",
  "  Proxy",
  "  SSH",
  "    Kex",
  "    Host keys",
  "    Auth",
  "      Credentials",
  "      GSSAPI",
  "    TTY",
  "    X11",
];

/** PuTTY's settings window with its "Category" list, one entry chosen. */
function puttyFrame(s: Scene, tree: string[], chosen: number) {
  s.rect(70, 0, 460, 250, { fill: "#F0F0F0", stroke: "#888888" });
  s.rect(70, 0, 460, 16, { fill: "#FFFFFF" });
  s.rect(76, 4, 8, 8, { fill: "#2D7D46", r: 1 });
  s.text("PuTTY Configuration", 90, 4.5, { size: 7.5 });
  s.text("Category:", 80, 22, { size: 7 });
  s.rect(80, 32, 140, 186, { fill: "#FFFFFF", stroke: "#AAAAAA" });
  const gap = tree.length > 13 ? 12.5 : 13;
  tree.forEach((name, i) => {
    const indent = name.length - name.trimStart().length;
    const x = 88 + indent * 3;
    if (i === chosen) {
      s.rect(x - 4, 35 + i * gap, s.width(name.trim(), { size: 7 }) + 8, 11, { fill: "#CCE4F7" });
      if (i > 0) s.mark(x - 4, 35 + i * gap, s.width(name.trim(), { size: 7 }) + 8, 11, 1);
    }
    s.text(name.trim(), x, 37 + i * gap, { size: 7 });
  });
  if (chosen > 0) {
    button(s, 80, 226, "About", { h: 15 });
    button(s, 404, 226, "Open", { h: 15, w: 52 });
    button(s, 464, 226, "Cancel", { h: 15, w: 56 });
  }
}

/** PuTTYgen ("PuTTY Key Generator"), before or after the key is loaded. */
function puttygen(s: Scene, o: { load?: boolean; loaded?: boolean }) {
  s.rect(0, 0, 600, 250, { fill: "#C9DDF2" });
  s.rect(6, 6, 310, 238, { fill: "#F0F0F0", stroke: "#888888" });
  s.rect(6, 6, 310, 15, { fill: "#FFFFFF" });
  s.text("PuTTY Key Generator", 14, 10, { size: 7.5 });
  s.text("File    Key    Conversions    Help", 14, 25, { size: 7 });
  s.rect(14, 38, 294, 100, { stroke: "#BBBBBB" });
  s.text("Key", 20, 34, { size: 7 });
  if (o.loaded) {
    s.text("Public key for pasting into OpenSSH authorized_keys file:", 20, 44, { size: 6.6 });
    s.rect(20, 54, 282, 34, { fill: "#FFFFFF", stroke: "#AAAAAA" });
    s.text("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDb...", 24, 58, { size: 6.3, mono: true });
    s.text("Key fingerprint:  ssh-rsa 3072 SHA256:k2V...", 20, 96, { size: 6.6 });
    s.text("Key comment:", 20, 112, { size: 6.6 });
    input(s, 90, 108, 210, "imported-openssh-key");
  } else {
    s.text("No key.", 20, 50, { size: 7 });
  }
  s.rect(14, 150, 294, 86, { stroke: "#BBBBBB" });
  s.text("Actions", 20, 146, { size: 7 });
  s.text("Generate a public/private key pair", 20, 162, { size: 6.8 });
  button(s, 236, 158, "Generate", { w: 64, h: 14 });
  s.text("Load an existing private key file", 20, 184, { size: 6.8 });
  button(s, 236, 180, "Load", { w: 64, h: 14, mark: o.load });
  s.text("Save the generated key", 20, 210, { size: 6.8 });
  button(s, 150, 206, "Save public key", { w: 78, h: 14 });
  button(s, 236, 206, "Save private key", { w: 64, h: 14, size: 6, mark: o.loaded });
}

// --- The pictures ---------------------------------------------------------------------

const DRAW: Record<GuidePicture, (s: Scene) => void> = {
  "azure-signin": (s) => {
    browser(s, "https://login.microsoftonline.com");
    s.rect(190, 45, 220, 170, { fill: "#FFFFFF", stroke: "#D0D5DB" });
    const squares = ["#F25022", "#7FBA00", "#00A4EF", "#FFB900"];
    squares.forEach((c, i) =>
      s.rect(210 + (i % 2) * 6, 62 + Math.floor(i / 2) * 6, 5, 5, { fill: c }),
    );
    s.text("Microsoft", 226, 63, { size: 8, bold: true, color: "#5E5E5E" });
    s.text("Sign in", 210, 84, { size: 13, bold: true });
    s.text("Email, phone, or Skype", 210, 112, { size: 8, color: MUTED });
    s.line(210, 124, 390, 124, "#666666", 0.8);
    s.text("No account? Create one!", 210, 134, { size: 7, color: BLUE });
    s.text("Can't access your account?", 210, 148, { size: 7, color: BLUE });
    button(s, 330, 180, "Next", { primary: true, mark: true, w: 60 });
  },
  "azure-create": (s) => {
    azure(s, "Microsoft Azure", "Home");
    s.text("Azure services", 20, 60, { size: 9, bold: true });
    const tiles = [
      "Create a resource",
      "Virtual machines",
      "Resource groups",
      "Subscriptions",
      "Cost Management",
      "More services",
    ];
    tiles.forEach((name, i) => {
      const x = 24 + i * 92;
      if (i === 0) {
        s.text("+", x + 26, 76, { size: 20, color: BLUE });
      } else {
        s.rect(x + 22, 80, 22, 18, {
          fill: ["#0078D4", "#5C2D91", "#FFB900", "#107C10", "#8A8886"][i - 1],
          r: 3,
        });
      }
      s.text(name, x - 6, 106, { size: 6.8, w: 80, align: "center", color: BLUE });
      if (i === 0) s.mark(x - 6, 74, 80, 42);
    });
    s.text("Resources", 20, 140, { size: 9, bold: true });
    s.text("Recent      Favorite", 20, 156, { size: 7, color: MUTED });
    s.line(20, 168, 580, 168, "#E1E5EA");
    s.text("No resources have been viewed recently", 200, 196, { size: 7.5, color: MUTED });
  },
  "azure-vm-tile": (s) => {
    azure(s, "Create a resource");
    [
      "Get Started",
      "Recently created",
      "Categories",
      "AI + Machine Learning",
      "Compute",
      "Networking",
      "Storage",
    ].forEach((name, i) =>
      s.text(name, 20, 60 + i * 15, { size: 7, bold: i === 2, color: i === 2 ? INK : BLUE }),
    );
    s.line(140, 56, 140, 220, "#E1E5EA");
    s.text("Popular Azure services", 156, 58, { size: 9, bold: true });
    const tiles: Array<[string, string]> = [
      ["Virtual machine", "#0078D4"],
      ["Storage account", "#3C9F3C"],
      ["Web App", "#0072C6"],
      ["SQL Database", "#BA141A"],
      ["Function App", "#F2C811"],
      ["Kubernetes Service", "#326CE5"],
    ];
    tiles.forEach(([name, color], i) => {
      const x = 156 + (i % 2) * 210;
      const y = 78 + Math.floor(i / 2) * 48;
      s.rect(x, y, 24, 24, { fill: color, r: 3 });
      s.text(name, x + 32, y + 1, { size: 8, bold: true });
      const w = s.text("Create", x + 32, y + 14, { size: 7, color: BLUE });
      s.text("|  Learn more", x + 36 + w, y + 14, { size: 7, color: BLUE });
      if (i === 0) s.mark(x + 32, y + 13, w, 9);
    });
  },
  "azure-group": (s) => {
    createVm(s, "Basics");
    section(s, 76, "Project details");
    row(s, 92, "Subscription *", "Azure subscription 1", { dropdown: true });
    row(s, 114, "Resource group *", "", { dropdown: true, link: "Create new", markLink: true });
    s.rect(330, 132, 200, 74, { fill: "#FFFFFF", stroke: "#8A96A3" });
    para(s, "A resource group is a container that holds related resources.", 340, 138, 180, {
      size: 6.5,
      color: MUTED,
    });
    s.text("Name *", 340, 158, { size: 7 });
    input(s, 340, 168, 180, "extas-erp", { mark: true });
    button(s, 340, 188, "OK", { primary: true, mark: true, h: 13, w: 34 });
    button(s, 380, 188, "Cancel", { h: 13 });
    section(s, 150, "Instance details");
    row(s, 166, "Virtual machine name *", "");
  },
  "azure-name-region": (s) => {
    createVm(s, "Basics");
    section(s, 76, "Project details");
    row(s, 90, "Resource group *", "(New) extas-erp", { dropdown: true });
    section(s, 116, "Instance details");
    row(s, 132, "Virtual machine name *", "extas-erp", { mark: true });
    row(s, 156, "Region *", "(Asia Pacific) Central India", { dropdown: true, mark: true });
    row(s, 180, "Availability options", "No infrastructure redundancy required", {
      dropdown: true,
    });
    azureFooter(s, "Next : Disks >");
  },
  "azure-image": (s) => {
    createVm(s, "Basics");
    section(s, 76, "Instance details");
    row(s, 92, "Security type", "Trusted launch virtual machines", { dropdown: true });
    row(s, 116, "Image *", "Ubuntu Server 24.04 LTS - x64 Gen2", { dropdown: true, mark: true });
    s.text("See all images  |  Configure VM generation", 200, 134, { size: 7, color: BLUE });
    s.text("VM architecture", 28, 152, { size: 7.5 });
    const w = radio(s, 200, 151, "Arm64", false);
    radio(s, 206 + w, 151, "x64", true);
    azureFooter(s, "Next : Disks >");
  },
  "azure-size": (s) => {
    createVm(s, "Basics");
    section(s, 76, "Instance details");
    row(s, 92, "Image *", "Ubuntu Server 24.04 LTS - x64 Gen2", { dropdown: true });
    row(s, 120, "Size *", "Standard_B2s - 2 vcpus, 4 GiB memory", {
      dropdown: true,
      mark: true,
      link: "See all sizes",
      markLink: true,
    });
    azureFooter(s, "Next : Disks >");
  },
  "azure-admin": (s) => {
    createVm(s, "Basics");
    section(s, 76, "Administrator account");
    s.text("Authentication type", 28, 94, { size: 7.5 });
    const w = radio(s, 200, 93, "SSH public key", true);
    radio(s, 212 + w, 93, "Password", false);
    s.mark(200, 92, w, 11);
    row(s, 112, "Username *", "erpadmin", { mark: true });
    row(s, 136, "SSH public key source", "Generate new key pair", { dropdown: true });
    s.text("SSH Key Type", 28, 164, { size: 7.5 });
    const r = radio(s, 200, 163, "RSA SSH Format", true);
    radio(s, 212 + r, 163, "Ed25519 SSH Format", false);
    row(s, 182, "Key pair name *", "extas-erp-key", { mark: true });
    azureFooter(s, "Next : Disks >");
  },
  "azure-ports": (s) => {
    createVm(s, "Basics");
    section(s, 76, "Inbound port rules");
    s.text("Public inbound ports *", 28, 94, { size: 7.5 });
    const w = radio(s, 200, 93, "None", false);
    radio(s, 212 + w, 93, "Allow selected ports", true);
    row(s, 112, "Select inbound ports *", "HTTP (80), HTTPS (443), SSH (22)", { dropdown: true });
    s.rect(200, 128, 290, 62, { fill: "#FFFFFF", stroke: "#8A96A3" });
    check(s, 208, 134, "HTTP (80)", true);
    check(s, 208, 148, "HTTPS (443)", true);
    check(s, 208, 162, "SSH (22)", true);
    check(s, 208, 176, "RDP (3389)", false);
    s.mark(205, 131, 80, 43);
    azureFooter(s, "Next : Disks >");
  },
  "azure-disk": (s) => {
    createVm(s, "Disks");
    section(s, 76, "OS disk");
    row(s, 92, "OS disk size", "64 GiB (E6)", { dropdown: true, mark: true });
    row(s, 116, "OS disk type *", "Standard SSD (locally-redundant storage)", {
      dropdown: true,
      mark: true,
    });
    s.text("Delete with VM", 28, 144, { size: 7.5 });
    check(s, 200, 143, "", true);
    azureFooter(s, "Next : Networking >");
  },
  "azure-review": (s) => {
    createVm(s, "Review + create");
    s.rect(20, 74, 560, 18, { fill: "#DFF6DD" });
    s.circle(32, 83, 5, { fill: GREEN });
    s.text("Validation passed", 42, 79, { size: 8, bold: true });
    section(s, 102, "Price");
    s.text("1 X Standard B2s by Microsoft", 28, 118, { size: 7.5 });
    azureFooter(s, "Next >", { create: true });
    // The window Azure opens after "Create": the key, once.
    s.rect(0, 20, 600, 230, { fill: "#000000", opacity: 0.35 });
    s.rect(130, 60, 340, 150, { fill: "#FFFFFF", stroke: "#8A96A3" });
    s.text("Generate new key pair", 144, 72, { size: 10, bold: true });
    para(
      s,
      "An SSH key pair contains both a public key and a private key. Azure doesn't store the private key. After the SSH key resource is created, you won't be able to download the private key again.",
      144,
      94,
      312,
      { size: 7.2 },
    );
    button(s, 144, 160, "Download private key and create resource", { primary: true, mark: true });
    button(s, 144, 184, "Return to create virtual machine");
  },
  "azure-done": (s) => {
    azure(s, "CreateVm-canonical.ubuntu-24_04-lts | Overview", "Home >");
    s.circle(50, 90, 14, { fill: GREEN });
    s.line(43, 90, 48, 96, "#FFFFFF", 2.4);
    s.line(48, 96, 58, 84, "#FFFFFF", 2.4);
    s.text("Your deployment is complete", 74, 82, { size: 12, bold: true });
    [
      ["Deployment name", "CreateVm-canonical.ubuntu-24_04-lts"],
      ["Subscription", "Azure subscription 1"],
      ["Resource group", "extas-erp"],
    ].forEach(([k, v], i) => {
      s.text(k!, 74, 108 + i * 13, { size: 7, color: MUTED });
      s.text(v!, 180, 108 + i * 13, { size: 7, color: i === 2 ? BLUE : INK });
    });
    s.text("Next steps", 74, 156, { size: 8.5, bold: true });
    button(s, 74, 174, "Go to resource", { primary: true, mark: true });
  },
  "azure-ip": (s) => {
    azure(s, "extas-erp", "Home > Virtual machines >");
    s.text("Virtual machine", 20, 50, { size: 7, color: MUTED });
    s.text("Connect     Start     Restart     Stop     Capture     Delete", 20, 66, {
      size: 7,
      color: BLUE,
    });
    s.line(20, 78, 580, 78, "#E1E5EA");
    s.text("Essentials", 20, 86, { size: 8.5, bold: true });
    const left = [
      ["Resource group", "extas-erp"],
      ["Status", "Running"],
      ["Location", "Central India"],
      ["Subscription", "Azure subscription 1"],
    ];
    const right = [
      ["Operating system", "Linux (ubuntu 24.04)"],
      ["Size", "Standard B2s (2 vcpus, 4 GiB memory)"],
      ["Public IP address", EXAMPLE_IP],
      ["Virtual network/subnet", "extas-erp-vnet/default"],
    ];
    left.forEach(([k, v], i) => {
      s.text(k!, 20, 104 + i * 22, { size: 7, color: MUTED });
      s.text(v!, 20, 113 + i * 22, { size: 7.5 });
    });
    right.forEach(([k, v], i) => {
      s.text(k!, 300, 104 + i * 22, { size: 7, color: MUTED });
      const w = s.text(v!, 300, 113 + i * 22, { size: 7.5, color: i === 2 ? BLUE : INK });
      if (i === 2) {
        s.rect(306 + w, 112 + i * 22, 6, 7, { stroke: "#4B5563" });
        s.rect(308 + w, 114 + i * 22, 6, 7, { fill: "#FFFFFF", stroke: "#4B5563" });
        s.mark(300, 112 + i * 22, w + 16, 10);
      }
    });
  },
  "putty-download": (s) => {
    browser(s, "https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html");
    s.text("Download PuTTY: latest release (0.83)", 30, 40, { size: 12, bold: true });
    s.text("This page contains download links for the latest released version of PuTTY.", 30, 62, {
      size: 7.5,
    });
    s.text("Package files", 30, 86, { size: 9.5, bold: true });
    s.text("MSI (‘Windows Installer’)", 30, 106, { size: 8 });
    const rows: Array<[string, string]> = [
      ["64-bit x86:", "putty-64bit-0.83-installer.msi"],
      ["64-bit Arm:", "putty-arm64-0.83-installer.msi"],
      ["32-bit x86:", "putty-0.83-installer.msi"],
    ];
    rows.forEach(([k, v], i) => {
      s.text(k, 46, 124 + i * 16, { size: 8, bold: i === 0 });
      const w = s.text(v, 120, 124 + i * 16, { size: 8, color: BLUE });
      s.text("(signature)", 128 + w, 124 + i * 16, { size: 7, color: BLUE });
      if (i === 0) s.mark(44, 122, 76 + w, 11);
    });
  },
  "puttygen-load": (s) => {
    puttygen(s, { load: true });
    // The file window "Load" opens.
    s.rect(318, 20, 276, 210, { fill: "#FFFFFF", stroke: "#888888" });
    s.text("Load private key:", 326, 25, { size: 7.5 });
    s.text("Downloads", 326, 42, { size: 8, bold: true });
    s.line(326, 54, 586, 54, "#E1E5EA");
    s.text("Name", 330, 60, { size: 7, color: MUTED });
    s.rect(328, 72, 256, 13, { fill: "#CCE4F7" });
    s.text("extas-erp-key.pem", 334, 75, { size: 7.5 });
    s.mark(328, 72, 256, 13);
    s.text("File name:", 326, 178, { size: 7 });
    input(s, 372, 174, 110, "extas-erp-key.pem");
    input(s, 488, 174, 98, "All Files (*.*)", { dropdown: true, mark: true });
    button(s, 452, 202, "Open", { w: 60, h: 15, mark: true });
    button(s, 520, 202, "Cancel", { w: 60, h: 15 });
  },
  "puttygen-save": (s) => {
    puttygen(s, { loaded: true });
    s.rect(330, 120, 260, 92, { fill: "#FFFFFF", stroke: "#777777" });
    s.text("PuTTYgen Warning", 338, 126, { size: 7.5 });
    para(
      s,
      "Are you sure you want to save this key without a passphrase to protect it?",
      372,
      146,
      206,
      { size: 7.5 },
    );
    s.poly(
      [
        [342, 164],
        [360, 164],
        [351, 148],
      ],
      { fill: "#FFC83D" },
    );
    button(s, 450, 188, "Yes", { w: 60, h: 15, mark: true });
    button(s, 518, 188, "No", { w: 60, h: 15 });
  },
  "putty-key-file": (s) => {
    puttyFrame(s, PUTTY_TREE_AUTH, 9);
    s.text("Options controlling SSH authentication", 232, 22, { size: 7.5, bold: true });
    s.rect(232, 34, 288, 68, { stroke: "#BBBBBB" });
    s.text("Credentials to authenticate with", 240, 40, { size: 7 });
    s.text("Public-key authentication", 240, 54, { size: 7 });
    s.text("Private key file for authentication:", 240, 68, { size: 7 });
    input(s, 240, 80, 196, "C:\\Users\\you\\Downloads\\extas-erp-key.ppk", { mark: true });
    button(s, 448, 80, "Browse...", { w: 64, h: 15, mark: true });
    s.rect(232, 110, 288, 40, { stroke: "#BBBBBB" });
    s.text("Certificate to use with the private key (optional):", 240, 116, { size: 7 });
    input(s, 240, 128, 196, "");
    button(s, 448, 128, "Browse...", { w: 64, h: 15 });
  },
  "putty-config": (s) => {
    puttyFrame(s, PUTTY_TREE_SESSION, 0);
    s.text("Basic options for your PuTTY session", 232, 22, { size: 7.5, bold: true });
    s.rect(232, 34, 288, 76, { stroke: "#BBBBBB" });
    s.text("Specify the destination you want to connect to", 240, 40, { size: 7 });
    s.text("Host Name (or IP address)", 240, 56, { size: 7 });
    s.text("Port", 448, 56, { size: 7 });
    input(s, 240, 66, 196, EXAMPLE_IP, { mark: true });
    input(s, 448, 66, 60, "22");
    s.text("Connection type:", 240, 90, { size: 7 });
    let x = 312;
    for (const [name, on] of [
      ["SSH", true],
      ["Serial", false],
      ["Other:", false],
    ] as const) {
      const w = radio(s, x, 89, name, on, 7);
      x += w + 10;
    }
    s.rect(232, 118, 288, 92, { stroke: "#BBBBBB" });
    s.text("Load, save or delete a stored session", 240, 124, { size: 7 });
    s.text("Saved Sessions", 240, 138, { size: 7 });
    input(s, 240, 148, 196, "extas-erp", { mark: true });
    s.rect(240, 166, 196, 36, { fill: "#FFFFFF", stroke: "#8A96A3" });
    s.text("Default Settings", 244, 170, { size: 7 });
    button(s, 448, 148, "Load", { w: 60, h: 14 });
    button(s, 448, 166, "Save", { w: 60, h: 14, mark: true });
    button(s, 448, 184, "Delete", { w: 60, h: 14 });
    button(s, 80, 226, "About", { h: 15 });
    button(s, 404, 226, "Open", { h: 15, w: 52, mark: true });
    button(s, 464, 226, "Cancel", { h: 15, w: 56 });
  },
  "putty-alert": (s) => {
    terminal(s, [], { title: `${EXAMPLE_IP} - PuTTY` });
    s.rect(90, 30, 420, 196, { fill: "#FFFFFF", stroke: "#777777" });
    s.text("PuTTY Security Alert", 100, 36, { size: 8 });
    s.poly(
      [
        [116, 82],
        [134, 82],
        [125, 66],
      ],
      { fill: "#FFC83D" },
    );
    s.text("!", 123, 71, { size: 9, bold: true });
    para(
      s,
      `The host key is not cached for this server: ${EXAMPLE_IP} (port 22). You have no guarantee that the server is the computer you think it is. The server's ssh-ed25519 key fingerprint is: ssh-ed25519 255 SHA256:Xq3Fh8kT2pWm9vLrB4nYcJ6dQe1sZaUo7HgK0iMtVxE`,
      148,
      62,
      345,
      { size: 7.5 },
    );
    para(
      s,
      'If you trust this host, press "Accept" to add the key to PuTTY\'s cache and carry on connecting.',
      148,
      122,
      345,
      { size: 7.5 },
    );
    button(s, 240, 196, "Accept", { primary: true, mark: true, w: 60 });
    button(s, 308, 196, "Connect Once", { w: 72 });
    button(s, 388, 196, "Cancel", { w: 52 });
    button(s, 448, 196, "Help", { w: 46 });
  },
  "putty-login": (s) => {
    terminal(
      s,
      [
        { text: "login as: erpadmin", hi: true },
        'Authenticating with public key "imported-openssh-key"',
        "Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0-1015-azure x86_64)",
        "",
        " * Documentation:  https://help.ubuntu.com",
        " * Management:     https://landscape.canonical.com",
        "",
        "  System information as of Thu Oct 16 10:02:11 UTC 2026",
        "",
        { text: PROMPT, hi: true },
      ],
      { size: 8 },
    );
  },
  "pdf-copy": (s) => {
    s.rect(0, 0, 600, 250, { fill: "#E6E6E6", stroke: LINE });
    s.rect(0, 0, 600, 20, { fill: "#323639" });
    s.text("Extas ERP restore guide (English).pdf", 12, 6, { size: 7, color: "#FFFFFF" });
    s.rect(40, 26, 520, 224, { fill: "#FFFFFF" });
    s.text("The one command", 60, 40, { size: 10, bold: true, color: "#1F4E79" });
    s.rect(60, 58, 480, 66, { fill: "#F4F6F8", stroke: "#C9D3DD" });
    COMMAND.forEach((line, i) => {
      const w = s.width(line, { mono: true, size: 6.4 });
      s.rect(68, 64 + i * 14, w, 10, { fill: "#B3D4FC" });
      s.text(line, 68, 65.5 + i * 14, { mono: true, size: 6.4 });
    });
    s.mark(66, 62, 470, 58);
    // The mouse pointer at the end of the last line.
    const end = 68 + s.width(COMMAND[3]!, { mono: true, size: 6.4 });
    s.poly(
      [
        [end, 106],
        [end, 120],
        [end + 4, 116],
        [end + 7, 122],
        [end + 9, 121],
        [end + 6, 115],
        [end + 11, 115],
      ],
      { fill: "#FFFFFF", stroke: "#000000" },
    );
    s.text("then", 330, 160, { size: 9, color: MUTED });
    for (const [x, key] of [
      [362, "Ctrl"],
      [410, "C"],
    ] as const) {
      s.rect(x, 152, key === "Ctrl" ? 40 : 26, 26, {
        fill: "#FFFFFF",
        stroke: "#4B5563",
        r: 4,
        lw: 1.2,
      });
      s.text(key, x, 160, { size: 9, bold: true, w: key === "Ctrl" ? 40 : 26, align: "center" });
    }
    s.text("+", 403, 158, { size: 10, bold: true });
  },
  "putty-paste": (s) => {
    terminal(
      s,
      PASTED.map((line) => ({ text: typeof line === "string" ? line : line.text, hi: true })),
      {
        w: 470,
        size: 6.2,
      },
    );
    // A mouse with its right button pressed.
    s.rect(500, 70, 70, 110, { fill: "#FFFFFF", stroke: "#4B5563", r: 34, lw: 1.4 });
    s.line(535, 70, 535, 118, "#4B5563", 1.2);
    s.line(500, 118, 570, 118, "#4B5563", 1.2);
    s.poly(
      [
        [536, 71],
        [556, 76],
        [569, 100],
        [569, 117],
        [536, 117],
      ],
      { fill: MARK },
    );
    s.text("Enter", 506, 206, { size: 9, bold: true, w: 58, align: "center" });
    s.rect(506, 198, 58, 24, { stroke: "#4B5563", r: 4, lw: 1.2 });
  },
  "putty-start": (s) => {
    terminal(
      s,
      [
        ...PASTED,
        { text: "restore.sh: OK", hi: true },
        "",
        {
          text: "==> Extas ERP: bringing the ERP back from a Google Drive backup (16 October 2026 10:05)",
          hi: true,
        },
        "",
        { text: "==> Step 1: Checking this server", hi: true },
        "    Ubuntu 24.04, 3916 MB memory, 58 GB free disk: fine.",
        "",
        "==> Step 2: Looking for an Extas ERP already on this server",
        "    None: this is a new server.",
      ],
      { size: 6.4 },
    );
  },
  "putty-client": (s) => {
    terminal(
      s,
      [
        "==> Step 3: Installing the restore tools",
        "    Done.",
        "",
        "==> Step 4: Signing in to Google and downloading the backup",
        "",
        '==> Google client (from "Your restore details" in the restore guide)',
        "    Paste each one with a right-click and press Enter. Nothing shows while you paste: that is normal.",
        { text: question("Google client ID"), hi: true },
        "    Got the client ID (72 characters, ending in ...4.apps.googleusercontent.com).",
        { text: question("Google client secret"), hi: true },
        "    Got the client secret (35 characters).",
      ],
      { size: 6.6 },
    );
  },
  "phone-code": (s) => {
    terminal(
      s,
      [
        "==> Sign in to Google on your phone",
        "    1. On your phone, open:",
        "       https://www.google.com/device",
        { text: "    2. Type this code:  ABCD-EFGH", hi: true },
        "    3. Choose the Google account that",
        "       keeps the backups, then tap",
        "       Continue and Allow.",
        "    Waiting for your phone...",
      ],
      { w: 300, size: 7 },
    );
    const p = phone(s, "google.com/device", 400);
    googleWord(s, p.left + 40, p.top + 6);
    s.text("Connect a device", p.left, p.top + 30, {
      size: 8.5,
      bold: true,
      w: p.width,
      align: "center",
    });
    para(s, "Enter the code displayed on your device", p.left + 6, p.top + 50, p.width - 12, {
      size: 6.8,
    });
    s.rect(p.left + 6, p.top + 76, p.width - 12, 18, { stroke: BLUE, r: 3 });
    s.text("ABCD-EFGH", p.left + 12, p.top + 81, { size: 8, mono: true });
    s.mark(p.left + 6, p.top + 76, p.width - 12, 18);
    button(s, p.left + p.width - 46, p.top + 110, "Next", { primary: true, mark: true, w: 40 });
  },
  "phone-account": (s) => {
    const p = phone(s, "accounts.google.com", 225);
    googleWord(s, p.left + 40, p.top + 6);
    s.text("Choose an account", p.left, p.top + 28, {
      size: 9,
      bold: true,
      w: p.width,
      align: "center",
    });
    s.text("to continue to Extas ERP", p.left, p.top + 42, {
      size: 6.8,
      w: p.width,
      align: "center",
    });
    s.line(p.left, p.top + 60, p.left + p.width, p.top + 60, "#E1E5EA");
    s.circle(p.left + 12, p.top + 76, 8, { fill: "#8764B8" });
    s.text("Your name", p.left + 26, p.top + 69, { size: 7.5, bold: true });
    s.text("you@gmail.com", p.left + 26, p.top + 79, { size: 6.8, color: MUTED });
    s.mark(p.left, p.top + 63, p.width, 26);
    s.line(p.left, p.top + 92, p.left + p.width, p.top + 92, "#E1E5EA");
    s.text("Use another account", p.left + 26, p.top + 100, { size: 7.2 });
  },
  "phone-allow": (s) => {
    // First: Google's warning for an app it has not checked (your own app).
    const a = phone(s, "accounts.google.com", 110);
    googleWord(s, a.left + 40, a.top + 4);
    let y = para(s, "Google hasn't verified this app", a.left, a.top + 22, a.width, {
      size: 8.2,
      bold: true,
    });
    y = para(
      s,
      "The app is requesting access to sensitive info in your Google Account. Until the developer verifies this app with Google, you shouldn't use it.",
      a.left,
      y + 4,
      a.width,
      { size: 6.3 },
    );
    const adv = s.text("Advanced", a.left, y + 6, { size: 7, color: BLUE });
    s.mark(a.left, y + 5, adv, 9);
    button(s, a.left + a.width - 74, y + 2, "BACK TO SAFETY", {
      primary: true,
      h: 14,
      w: 74,
      size: 6,
    });
    y = para(
      s,
      "Continue only if you understand the risks and trust the developer.",
      a.left,
      y + 26,
      a.width,
      {
        size: 6.3,
      },
    );
    const go = s.text("Go to Extas ERP (unsafe)", a.left, y + 4, { size: 7, color: BLUE });
    s.mark(a.left, y + 3, go, 9);
    // Then: what the app may do, and Allow.
    const p = phone(s, "accounts.google.com", 340);
    googleWord(s, p.left + 40, p.top + 4);
    y = para(s, "Extas ERP wants access to your Google Account", p.left, p.top + 22, p.width, {
      size: 8.2,
      bold: true,
    });
    s.text("you@gmail.com", p.left, y + 2, { size: 6.8, color: MUTED });
    y = para(s, "This will allow Extas ERP to:", p.left, y + 18, p.width, { size: 6.8 });
    y = para(
      s,
      "See, edit, create, and delete only the specific Google Drive files you use with this app",
      p.left + 6,
      y + 4,
      p.width - 6,
      { size: 6.5 },
    );
    button(s, p.left + 10, y + 16, "Cancel", { h: 15 });
    button(s, p.left + p.width - 44, y + 16, "Allow", { primary: true, mark: true, h: 15, w: 44 });
  },
  "putty-pick": (s) => {
    terminal(
      s,
      [
        "==> Signed in to Google. Looking for the backups",
        "",
        "==> Backups in Google Drive, newest first",
        {
          text: "     1) Thursday 16 October 2026, 14:00 (Bangladesh time)   812.4 MB   (newest)",
          hi: true,
        },
        "     2) Thursday 16 October 2026, 02:00 (Bangladesh time)   811.9 MB",
        "     3) Wednesday 15 October 2026, 14:00 (Bangladesh time)   809.2 MB",
        "     4) Wednesday 15 October 2026, 02:00 (Bangladesh time)   808.7 MB",
        { text: question("Which backup?"), hi: true },
      ],
      { size: 7 },
    );
  },
  "putty-key": (s) => {
    terminal(
      s,
      [
        "==> Downloading the backup of Thursday 16 October 2026, 14:00 (Bangladesh time)",
        "    database.dump.locked (402.1 MB)",
        "    media.tar.gz.locked (398.7 MB)",
        "    code.bundle.locked (5.6 MB)",
        "    Every file matches its checksum.",
        "",
        {
          text: "==> Your recovery key is kept in Google Drive: it is filled in by itself",
          hi: true,
        },
        "",
        "==> Opening the backup",
        "",
        "==> The backup is open: 48,213 records and 1,260 files in it",
      ],
      { size: 7 },
    );
  },
  "putty-dns": (s) => {
    terminal(
      s,
      [
        "==> Step 7: Pointing the web address at this server",
        "",
        "==> Your web address in Cloudflare",
        `    erp.extasbd.com  ->  ${EXAMPLE_IP} (this server)`,
        `    demo.extasbd.com  ->  ${EXAMPLE_IP} (this server)`,
        {
          text: `To point erp.extasbd.com and demo.extasbd.com to this server (${EXAMPLE_IP}), type erp.extasbd.com; or press Enter to leave it as it is: erp.extasbd.com`,
          hi: true,
        },
        "    erp.extasbd.com now points to this server (it pointed to 4.213.40.11).",
        "    demo.extasbd.com now points to this server (it pointed to 4.213.40.11).",
      ],
      { size: 7 },
    );
  },
  "putty-wait": (s) => {
    terminal(
      s,
      [
        {
          text: "==> Step 8: Preparing the server (system updates, Docker, firewall: about 5 minutes)",
          hi: true,
        },
        "    ...",
        {
          text: "==> Step 9: Installing the ERP (building it takes about 10 to 20 minutes)",
          hi: true,
        },
        " => [app builder 6/9] RUN npm run build",
        "    ...",
      ],
      { size: 7 },
    );
  },
  "putty-done": (s) => {
    terminal(
      s,
      [
        "==> Step 14: Checking HTTPS",
        "",
        "==> Finished in 34 min 10 s",
        "    Backup: 2026-10-16_1400",
        { text: "    All 48,213 records and 1,260 files are back.", hi: true },
        {
          text: "    The ERP is running at https://erp.extasbd.com : sign in as before.",
          hi: true,
        },
        "    The demo site is running too.",
        "    Checks: full check; 0 problem(s) found.",
        "    The full log of this restore: sudo less /var/log/extas-erp-restore.log",
        PROMPT,
      ],
      { size: 7 },
    );
  },
  "browser-erp": (s) => {
    browser(s, "https://erp.extasbd.com/sign-in");
    s.rect(200, 40, 200, 190, { fill: "#FFFFFF", stroke: "#D0D5DB", r: 6 });
    s.text("Extas ERP", 200, 54, {
      size: 8,
      bold: true,
      color: "#0B3D2E",
      w: 200,
      align: "center",
    });
    s.text("Sign in", 200, 70, { size: 15, bold: true, color: "#0B3D2E", w: 200, align: "center" });
    s.text("Email", 218, 104, { size: 7.5, bold: true });
    input(s, 218, 114, 164, "you@extasbd.com");
    s.text("Password", 218, 140, { size: 7.5, bold: true });
    input(s, 218, 150, 164, "••••••••••");
    button(s, 218, 180, "Sign in", { primary: true, mark: true, w: 164, h: 18 });
  },
  "erp-backups": (s) => {
    browser(s, "https://erp.extasbd.com/settings/backups");
    s.rect(0, 24, 110, 226, { fill: "#0B3D2E" });
    s.text("Extas ERP", 12, 34, { size: 8.5, bold: true, color: "#FFFFFF" });
    ["Home", "Sales", "Production", "Accounts", "Reports", "Settings"].forEach((name, i) =>
      s.text(name, 16, 56 + i * 16, {
        size: 7.5,
        color: i === 5 ? "#FFFFFF" : "#B9D3C8",
        bold: i === 5,
      }),
    );
    s.text("Backups", 126, 36, { size: 12, bold: true });
    s.rect(126, 58, 456, 64, { fill: "#E8F5EC", stroke: "#86C49A", r: 4 });
    s.text("Last backup 2 minutes ago, safe in Google Drive", 138, 68, {
      size: 10.5,
      bold: true,
      color: "#14532D",
      w: 436,
    });
    s.text("If the server is lost now, you lose at most 12 hours of work.", 138, 88, {
      size: 7.5,
      w: 436,
    });
    const w = button(s, 138, 100, "Back up now", { primary: true, mark: true, h: 15 });
    button(s, 146 + w, 100, "Download the restore guide", { h: 15 });
    s.text("When to back up", 126, 136, { size: 9, bold: true });
    s.text("Every day at 02:00 and 14:00", 126, 152, { size: 7.5, color: MUTED });
  },
  "cloudflare-dns": (s) => {
    browser(s, "https://dash.cloudflare.com");
    s.rect(0, 24, 120, 226, { fill: "#F7F7F7" });
    s.text("extasbd.com", 12, 34, { size: 8, bold: true });
    ["Overview", "Analytics & Logs", "DNS", "    Records", "SSL/TLS", "Security"].forEach(
      (name, i) => {
        s.text(name, 14, 54 + i * 15, {
          size: 7.2,
          bold: i === 2 || i === 3,
          color: i === 3 ? BLUE : INK,
        });
        if (i === 3) s.mark(12, 52 + i * 15, 70, 11);
      },
    );
    s.text("DNS management for extasbd.com", 134, 36, { size: 10, bold: true });
    const cols = [134, 178, 250, 350, 450, 520];
    ["Type", "Name", "Content", "Proxy status", "TTL", ""].forEach((h, i) =>
      s.text(h, cols[i]!, 64, { size: 7, bold: true, color: MUTED }),
    );
    s.line(134, 76, 580, 76, "#E1E5EA");
    [
      ["A", "erp", EXAMPLE_IP, "Proxied", "Auto"],
      ["A", "demo", EXAMPLE_IP, "Proxied", "Auto"],
    ].forEach((cells, r) => {
      const y = 84 + r * 22;
      cells.forEach((c, i) => s.text(c, cols[i]!, y, { size: 7.5 }));
      const w = s.text("Edit", cols[5]!, y, { size: 7.5, color: BLUE });
      if (r === 0) s.mark(cols[5]!, y - 1, w, 10);
      s.line(134, y + 14, 580, y + 14, "#E1E5EA");
    });
    s.rect(134, 136, 446, 86, { fill: "#FFFFFF", stroke: "#C9D3DD" });
    s.text("IPv4 address (required)", 146, 146, { size: 7, bold: true });
    input(s, 146, 158, 200, EXAMPLE_IP, { mark: true });
    button(s, 146, 192, "Save", { primary: true, mark: true, w: 50 });
    button(s, 204, 192, "Cancel", { w: 50 });
  },
};

/**
 * What each real screenshot (public/restore-guide/<picture>.png) shows, with
 * the screen's own words. Take it on a real screen at that step; ring what to
 * click in red if you can. Examples on it (the IP address, names) may differ.
 */
export const SCREENSHOT_SLOTS: Record<GuidePicture, string> = {
  "azure-signin": "Microsoft's “Sign in” page from portal.azure.com: the email box and “Next”.",
  "azure-create": "The Azure portal's home page with “Create a resource” near the top.",
  "azure-vm-tile": "“Create a resource” with the “Virtual machine” tile and its “Create” link.",
  "azure-group":
    "“Create a virtual machine”, tab “Basics”: “Resource group” with “Create new” and the name extas-erp typed.",
  "azure-name-region":
    "Tab “Basics”: “Virtual machine name” extas-erp and “Region” “(Asia Pacific) Central India”.",
  "azure-image": "Tab “Basics”: “Image” set to “Ubuntu Server 24.04 LTS - x64 Gen2”.",
  "azure-size":
    "Tab “Basics”: “Size” showing “Standard_B2s - 2 vcpus, 4 GiB memory”, with “See all sizes” under it.",
  "azure-admin":
    "Tab “Basics”, “Administrator account”: “SSH public key”, “Username” erpadmin, “SSH public key source” “Generate new key pair”, “Key pair name” extas-erp-key.",
  "azure-ports":
    "Tab “Basics”, “Inbound port rules”: “Allow selected ports”, with “HTTP (80)”, “HTTPS (443)” and “SSH (22)” ticked.",
  "azure-disk": "Tab “Disks”: “OS disk size” “64 GiB” and “OS disk type” “Standard SSD”.",
  "azure-review":
    "The “Generate new key pair” window (after “Create” on “Review + create”) with “Download private key and create resource”.",
  "azure-done": "“Your deployment is complete” with the “Go to resource” button.",
  "azure-ip": "The VM's “Overview” with the copy sign next to “Public IP address”.",
  "putty-download": "PuTTY's download page with the .msi file on the “64-bit x86” line.",
  "puttygen-load":
    "PuTTYgen's “Load private key:” window: “All Files (*.*)” chosen, extas-erp-key.pem picked, “Open”.",
  "puttygen-save":
    "PuTTYgen with the key loaded and its question “Are you sure you want to save this key without a passphrase to protect it?” (“Yes”).",
  "putty-key-file":
    "“PuTTY Configuration” at “Connection” > “SSH” > “Auth” > “Credentials”, extas-erp-key.ppk in “Private key file for authentication” and “Browse...”.",
  "putty-config":
    "“PuTTY Configuration” at “Session”: the IP in “Host Name (or IP address)”, “Port” 22, extas-erp in “Saved Sessions”, “Save” and “Open”.",
  "putty-alert": "“PuTTY Security Alert” with the “Accept” button.",
  "putty-login":
    "PuTTY after “login as:” erpadmin: “Authenticating with public key” and then the erpadmin@extas-erp:~$ prompt.",
  "pdf-copy": "This guide's box “The one command” selected with the mouse in a PDF reader.",
  "putty-paste":
    "PuTTY with the four lines of the command pasted (the last one “sudo bash restore.sh $c”).",
  "putty-start": "PuTTY showing “restore.sh: OK”, then “==> Step 1: Checking this server”.",
  "putty-client": "PuTTY asking “Google client ID” and then “Google client secret”.",
  "phone-code":
    "PuTTY showing the code, and the phone at google.com/device: “Enter the code displayed on your device” and “Next”.",
  "phone-account": "The phone's “Choose an account” page.",
  "phone-allow":
    "Two phone screenshots side by side: “Google hasn't verified this app” after tapping “Advanced”, with “Go to Extas ERP (unsafe)”; then the page with “Allow”.",
  "putty-pick": "PuTTY listing the backups, newest first, and asking “Which backup?”.",
  "putty-key":
    "PuTTY saying “Your recovery key is kept in Google Drive” (or asking “Recovery key”).",
  "putty-dns": "PuTTY asking “To point ... to this server”.",
  "putty-wait": "PuTTY during the restore, with “==> Step ...” lines.",
  "putty-done":
    "PuTTY at the end: “Finished in ...” and “All ... records and ... files are back.”.",
  "browser-erp": "The ERP's sign-in page at your web address, with “Sign in”.",
  "erp-backups":
    "Settings > Backups with “Back up now” and the big line saying “safe in Google Drive”.",
  "cloudflare-dns":
    "Cloudflare, “DNS” > “Records”: the erp line's “Edit”, “IPv4 address” and “Save”.",
};

/** The tallest a screenshot is printed (a phone's is tall and narrow). */
const SCREENSHOT_MAX_HEIGHT = 330;

/** Where the real screenshots are: public/restore-guide (RESTORE_GUIDE_SCREENSHOTS in tests). */
export function screenshotDir(): string {
  return (
    process.env.RESTORE_GUIDE_SCREENSHOTS || path.join(process.cwd(), "public", "restore-guide")
  );
}

/** A PNG's width and height (its IHDR), or null when it is not a PNG. */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature) return null;
  if (bytes.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

type Screenshot = { bytes: Buffer; width: number; height: number };

/** The real screenshot for a picture, when public/restore-guide has one. */
export function screenshotOf(picture: GuidePicture): Screenshot | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(screenshotDir(), `${picture}.png`));
  } catch {
    return null;
  }
  const size = pngSize(bytes);
  if (!size) {
    console.error(`[restore guide] ${picture}.png is not a PNG; the drawing is printed instead`);
    return null;
  }
  return { bytes, ...size };
}

/** The size a picture takes `width` wide: the screenshot's own shape, or the drawing's. */
export function pictureBox(picture: GuidePicture, width: number) {
  const shot = screenshotOf(picture);
  if (!shot) return { width, height: (PICTURE.height * width) / PICTURE.width, shot: null };
  const scale = Math.min(width / shot.width, SCREENSHOT_MAX_HEIGHT / shot.height);
  return { width: shot.width * scale, height: shot.height * scale, shot };
}

/**
 * Prints one step's picture `width` wide at (x, y): the real screenshot when
 * there is one (centred), else the drawing. Returns its height and which it was.
 */
export function placePicture(
  doc: PDFKit.PDFDocument,
  picture: GuidePicture,
  x: number,
  y: number,
  width: number,
): { height: number; screenshot: boolean } {
  const box = pictureBox(picture, width);
  if (!box.shot) return { height: drawPicture(doc, picture, x, y, width), screenshot: false };
  const left = x + (width - box.width) / 2;
  doc.image(box.shot.bytes, left, y, { width: box.width, height: box.height });
  doc.save();
  doc.rect(left, y, box.width, box.height).lineWidth(0.6).stroke("#9AA5B1");
  doc.restore();
  return { height: box.height, screenshot: true };
}

/** Draws one picture `width` wide at (x, y); returns its height. */
export function drawPicture(
  doc: PDFKit.PDFDocument,
  picture: GuidePicture,
  x: number,
  y: number,
  width: number,
): number {
  const k = width / PICTURE.width;
  const height = PICTURE.height * k;
  doc.save();
  doc.rect(x, y, width, height).clip();
  const scene = new Scene(doc, x, y, k);
  DRAW[picture](scene);
  scene.drawMarks();
  doc.restore();
  doc.save();
  doc.rect(x, y, width, height).lineWidth(0.6).stroke("#9AA5B1");
  doc.restore();
  return height;
}

/** Every picture there is (the tests draw them all). */
export const PICTURES = Object.keys(DRAW) as GuidePicture[];
