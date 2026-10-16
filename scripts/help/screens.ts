import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

/*
 * The app's screens as the Help Center sees them: every page, the files that
 * draw it, the buttons and tabs on it, and a fingerprint that changes when any
 * of those files change (so a guide's pictures can be known to be old).
 */

const APP_GROUPS = ["(app)", "(auth)", "(gate)"];

function walk(dir: string, match: (file: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, match);
    return match(full) ? [full] : [];
  });
}

/** Every page of the app, with its route. */
export function pages(root: string): Array<{ route: string; file: string }> {
  return APP_GROUPS.flatMap((group) => {
    const base = path.join(root, "src", "app", group);
    if (!existsSync(base)) return [];
    return walk(base, (f) => f.endsWith(`${path.sep}page.tsx`)).map((file) => {
      const parts = path
        .relative(base, file)
        .split(path.sep)
        .slice(0, -1)
        .filter((p) => !/^\(.*\)$/.test(p));
      return { route: `/${parts.join("/")}`, file };
    });
  });
}

const EXTS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

function resolve(root: string, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  return null;
}

/** Files that draw screens: the app's pages and layouts and the components, not the shared ui kit. */
const isScreenFile = (root: string, file: string) => {
  const rel = path.relative(root, file).split(path.sep).join("/");
  return (
    (rel.startsWith("src/app/") || rel.startsWith("src/components/")) &&
    !rel.startsWith("src/components/ui/")
  );
};

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']/g))
    specs.push(m[1]!);
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]!);
  return specs;
}

/** The page file and every screen file it uses, and the layouts above it. */
export function screenFiles(root: string, pageFile: string): string[] {
  const seen = new Set<string>();
  const queue = [pageFile];
  // The layouts above the page draw part of it too.
  let dir = path.dirname(pageFile);
  const appDir = path.join(root, "src", "app");
  while (dir.startsWith(appDir) && dir !== appDir) {
    const layout = path.join(dir, "layout.tsx");
    if (existsSync(layout)) queue.push(layout);
    dir = path.dirname(dir);
  }
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const target = resolve(root, file, spec);
      if (target && isScreenFile(root, target) && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen].map((f) => path.relative(root, f).split(path.sep).join("/")).sort();
}

/** The elements whose text is a button or a tab people press. */
const PRESSABLE = new Set([
  "Button",
  "button",
  "TabsTrigger",
  "DropdownMenuItem",
  "SubmitButton",
  "PendingButton",
  "ConfirmButton",
]);

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

/** Strings a JSX expression may show: "a", cond ? "a" : "b", a ?? "b", `a`. */
function stringsIn(expr: ts.Expression | undefined, out: string[]) {
  if (!expr) return;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) out.push(expr.text);
  else if (ts.isConditionalExpression(expr)) {
    stringsIn(expr.whenTrue, out);
    stringsIn(expr.whenFalse, out);
  } else if (ts.isBinaryExpression(expr)) {
    stringsIn(expr.left, out);
    stringsIn(expr.right, out);
  } else if (ts.isParenthesizedExpression(expr)) stringsIn(expr.expression, out);
}

/** The words of a button: its own text, without icons and without passing states ("Saving…"). */
function textOf(el: ts.JsxElement): string[] {
  const plain: string[] = [];
  const alternatives: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) plain.push(node.text);
    else if (ts.isJsxExpression(node)) {
      const found: string[] = [];
      stringsIn(node.expression, found);
      if (found.length === 1 && ts.isStringLiteral(node.expression!)) plain.push(found[0]!);
      else alternatives.push(...found);
    } else if (ts.isJsxElement(node)) node.children.forEach(visit);
  };
  el.children.forEach(visit);
  const main = plain.join(" ").replace(/\s+/g, " ").trim();
  return [main, ...alternatives.map((a) => a.replace(/\s+/g, " ").trim())];
}

const SMALL = new Set(["the", "your", "out", "a", "an", "up", "in", "it", "to"]);

/** "Saving", "Making the PDF", "Copied": what a button says while or after it works, not a button of its own. */
export function isPassingState(label: string) {
  const words = label.split(" ");
  if (label === "Copied" || label === "Saved") return true;
  return /ing$/.test(words[0]!) && (words.length === 1 || SMALL.has(words[1]!.toLowerCase()));
}

const counts = (label: string) =>
  /[A-Za-z]{2}/.test(label) && !/…$|\.\.\.$/.test(label) && label.length <= 60;

/** The buttons and tabs a set of screen files shows, by their words. */
export function pressables(root: string, files: string[]): string[] {
  const labels = new Set<string>();
  for (const rel of files) {
    if (!rel.endsWith(".tsx")) continue;
    const text = readFileSync(path.join(root, rel), "utf8");
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && PRESSABLE.has(tagName(node.openingElement))) {
        for (const label of textOf(node)) if (counts(label)) labels.add(label);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...labels].sort();
}

/** Changes whenever a file that draws the screen changes. */
export function fingerprint(root: string, files: string[]): string {
  const hash = createHash("sha256");
  for (const rel of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(path.join(root, rel)));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

// ------------------------------------------------------------- the pictures

/** The frame around every signed-in page (menu, top bar): drawn in every picture, explained in Getting started. */
export const shellFiles = (root: string) =>
  new Set(screenFiles(root, path.join(root, "src", "app", "(app)", "layout.tsx")));

/** The English labels a text quotes (“Issue the invoice”), in order. */
export const quotedLabels = (text: string) =>
  [...text.matchAll(/“([^”]+)”/g)].map((m) => m[1]!).filter((l) => /[A-Za-z]/.test(l));

type Guide = {
  routes: string[];
  steps: Array<{ text: string }>;
  shot?: { route?: string; open?: string };
};

/** The page a guide's picture is taken on ("/" for a guide about the whole app). */
export const shotRoute = (guide: Guide) => guide.shot?.route ?? guide.routes[0] ?? "/";

/** Changes when what the picture marks changes: the page, the button pressed first, the steps' labels. */
export function guideHash(guide: Guide): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        route: shotRoute(guide),
        open: guide.shot?.open ?? null,
        marks: guide.steps.map((step) => quotedLabels(step.text)),
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * The page pattern an address belongs to: "/parties/buyers" is the page
 * "/parties/[list]"; a pattern stays itself. Null when no page draws it.
 */
export function patternOf(root: string, route: string): string | null {
  const all = pages(root).map((p) => p.route);
  if (all.includes(route)) return route;
  const parts = route.split("/").filter(Boolean);
  const fits = all.filter((pattern) => {
    const want = pattern.split("/").filter(Boolean);
    return (
      want.length === parts.length &&
      want.every((w, i) => w === parts[i] || (/^\[.*\]$/.test(w) && !parts[i]!.startsWith("[")))
    );
  });
  // The most fixed parts wins ("/parties/dues" over "/parties/[list]").
  fits.sort((a, b) => a.split("[").length - b.split("[").length);
  return fits[0] ?? null;
}

/** The page file of an address or pattern, or null. */
export function pageFileOf(root: string, route: string): string | null {
  const pattern = patternOf(root, route);
  return pages(root).find((p) => p.route === pattern)?.file ?? null;
}

/** Changes when a file that draws the page (not the frame around it) changes. */
export function screenFingerprint(root: string, route: string, shell = shellFiles(root)): string {
  const file = pageFileOf(root, route);
  if (!file) return "no-page";
  return fingerprint(
    root,
    screenFiles(root, file).filter((f) => !shell.has(f)),
  );
}
