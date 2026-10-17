import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

/*
 * The app's screens as the Help Center sees them: every page, the files that
 * draw it, the words on it people press or pick (buttons, tabs, menu items,
 * options, field labels), and a fingerprint that changes when any of those
 * files change (so a guide's pictures can be known to be old).
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

/** Every layout of the signed-in app (the frame of a section: its tabs), with its route. */
export function layouts(root: string): Array<{ route: string; file: string }> {
  const base = path.join(root, "src", "app", "(app)");
  if (!existsSync(base)) return [];
  return walk(base, (f) => f.endsWith(`${path.sep}layout.tsx`)).map((file) => {
    const parts = path
      .relative(base, file)
      .split(path.sep)
      .slice(0, -1)
      .filter((p) => !/^\(.*\)$/.test(p));
    return { route: `/${parts.join("/")}`, file };
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

/**
 * The page file and every screen file it uses, and the layouts above it (or,
 * with `layouts: false`, only what the page itself draws).
 */
export function screenFiles(
  root: string,
  pageFile: string,
  { layouts = true }: { layouts?: boolean } = {},
): string[] {
  const seen = new Set<string>();
  const queue = [pageFile];
  // The layouts above the page draw part of it too.
  let dir = path.dirname(pageFile);
  const appDir = path.join(root, "src", "app");
  while (layouts && dir.startsWith(appDir) && dir !== appDir) {
    const layout = path.join(dir, "layout.tsx");
    if (existsSync(layout) && layout !== pageFile) queue.push(layout);
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

// ---------------------------------------------------- the words on a screen

/** The elements whose text is a button, a tab or a menu item people press. */
const PRESSABLE = new Set([
  "Button",
  "button",
  "TabsTrigger",
  "DropdownMenuItem",
  "SubmitButton",
  "PendingButton",
  "ConfirmButton",
]);

/** The elements whose text names a choice or a field: an option of a list, a field's label. */
const NAMING = new Set(["option", "label", "Label"]);

/** Elements whose words are their own, never part of a label around them. */
const OWN_WORDS = new Set(["select", "NativeSelect", "textarea"]);

/** A button, tab or menu item ("press"), a field's label ("name"), or a choice in a list ("option"). */
export type WordKind = "press" | "name" | "option";
type Kind = WordKind;

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

/**
 * Strings a JSX expression may show: "a", cond ? "a" : "b", a ?? "b", ok && "a",
 * `a`; not the words a condition compares with (period !== "LIFETIME" && …).
 */
function stringsIn(expr: ts.Expression | undefined, out: string[]) {
  if (!expr) return;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) out.push(expr.text);
  else if (ts.isConditionalExpression(expr)) {
    stringsIn(expr.whenTrue, out);
    stringsIn(expr.whenFalse, out);
  } else if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken)
      stringsIn(expr.left, out);
    if (
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.AmpersandAmpersandToken
    )
      stringsIn(expr.right, out);
  } else if (ts.isParenthesizedExpression(expr)) stringsIn(expr.expression, out);
}

/** Text shown only at some widths (`sm:hidden`, `hidden sm:inline`): "Arrange" on a phone, "Arrange sections" wider. */
function showsAtSomeWidths(el: ts.JsxElement): boolean {
  return el.openingElement.attributes.properties.some(
    (a) =>
      ts.isJsxAttribute(a) &&
      a.name.getText() === "className" &&
      a.initializer !== undefined &&
      ts.isStringLiteral(a.initializer) &&
      /(^|\s)([a-z0-9]+:)?hidden(\s|$)/.test(a.initializer.text),
  );
}

/**
 * The words written on an element: its own text, without icons and without
 * passing states ("Saving…"), and the expressions it shows in place of words
 * ({label}), for when nothing is written.
 */
function written(
  el: ts.JsxElement,
  firstLine = false,
): { labels: string[]; shown: ts.Expression[] } {
  const plain: string[] = [];
  const alternatives: string[] = [];
  const shown: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) plain.push(decode(node.text));
    else if (ts.isJsxExpression(node)) {
      if (!node.expression) return;
      const found: string[] = [];
      stringsIn(node.expression, found);
      if (found.length === 1 && ts.isStringLiteral(node.expression)) plain.push(found[0]!);
      else if (found.length > 0) alternatives.push(...found);
      else {
        // A name or a number the screen fills in ("Load the {category} items").
        plain.push(FILLED);
        shown.push(node.expression);
      }
    } else if (ts.isJsxElement(node)) {
      const tag = tagName(node.openingElement);
      // A list or a button inside a label is read on its own.
      if (PRESSABLE.has(tag) || NAMING.has(tag) || OWN_WORDS.has(tag)) return;
      // A field's label is its first line; a line under it is a hint.
      if (firstLine && plain.join("").replaceAll(FILLED, "").trim()) return;
      // A label for one width is its own label, not part of the other one.
      if (showsAtSomeWidths(node)) alternatives.push(...written(node).labels);
      else node.children.forEach(visit);
    }
  };
  el.children.forEach(visit);
  const main = plain
    .join("")
    .replace(/\s+/g, " ")
    // "Run the tests ({picked.length})" is the button "Run the tests": the count is not a word.
    .replace(new RegExp(`\\(\\s*${FILLED}?\\s*\\)`, "g"), "")
    // "{icon} Save" is "Save"; "Fill in {code}'s colours" is "Fill in …'s colours";
    // "{n} backups" goes on with a small letter, so it is "… backups".
    .replace(new RegExp(`^[\\s${FILLED}]+(?![\\s${FILLED}]*[a-z])|[\\s${FILLED}]+$`, "g"), "")
    .replaceAll(FILLED, "…")
    .replace(/\s+/g, " ")
    .trim();
  const labels = [main, ...alternatives.map((a) => a.replace(/\s+/g, " ").trim())];
  return { labels: labels.filter(Boolean), shown };
}

/** Stands for what the screen fills in, until it is shown as "…". */
const FILLED = "\u0001";

const ENTITIES: Record<string, string> = {
  apos: "'",
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  nbsp: " ",
};
const decode = (text: string) =>
  text.replace(/&(apos|quot|amp|lt|gt|nbsp);/g, (_, e: string) => ENTITIES[e]!);

const SMALL = new Set([
  "the",
  "your",
  "out",
  "a",
  "an",
  "up",
  "in",
  "it",
  "to",
  "down",
  "off",
  "and",
  "now",
]);

/** "Saving", "Making the PDF", "Copied": what a button says while or after it works, not a button of its own. */
export function isPassingState(label: string) {
  const words = label.split(" ");
  if (label === "Copied" || label === "Saved") return true;
  return /ing$/.test(words[0]!) && (words.length === 1 || SMALL.has(words[1]!.toLowerCase()));
}

/**
 * Words that name a button, field or choice of their own: not a part added to a
 * name the app fills in ("… (default)", "(archived)", ", round …"), not a
 * sentence that describes a choice ("Settled project by project.").
 */
const counts = (label: string) =>
  /[A-Za-z]{2}/.test(label) &&
  !/…$|\.\.\.$/.test(label) &&
  !/^[…(,·]/.test(label) &&
  !/\.$/.test(label) &&
  label.length <= 60;

// ------------------------------------- following a word kept in a variable
//
// A button often shows a variable: {label}, {tab.label}, {LABELS[kind]}. The
// reader follows it, as far as the code says it plainly, to the words it
// holds: a const (in the file or imported from another), an item of the list
// the buttons are made from (TABS.map((t) => <Button>{t.label}</Button>)), a
// value of a table of words, what a small function returns, and, for a
// component that shows what it is given (<PrintButton label="Print" />,
// <SectionTabs tabs={SALES_TABS} />, <Field label="Buyer" />), the words each
// screen gives it. What it cannot follow is "open": filled in as the app runs.

/** A file of the app, read once. */
type Src = { root: string; file: string; rel: string; sf: ts.SourceFile };
const SOURCES = new Map<string, Src>();

function source(root: string, file: string): Src {
  let src = SOURCES.get(file);
  if (!src) {
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      kind,
    );
    src = { root, file, rel: path.relative(root, file).split(path.sep).join("/"), sf };
    SOURCES.set(file, src);
  }
  return src;
}

/** "[]": an item of a list, in the path to what a component was given. */
const ITEM = "[]";

/** What an expression may be, as far as the code says it plainly. */
type Val =
  | { k: "text"; text: string }
  | { k: "obj"; node: ts.ObjectLiteralExpression; src: Src }
  /** A list; `at` holds each place of a list written out ([value, "Words"]). */
  | { k: "list"; items: Val[]; at?: Val[][] }
  /** One of Object.entries(): its key and its value. */
  | { k: "pair"; key: Val[]; value: Val[] }
  | { k: "fn"; node: ts.SignatureDeclaration; src: Src }
  /** What the component `of` ("file#Name") was given: its prop path[0], then deeper. */
  | { k: "prop"; of: string; path: string[]; fallback?: Val[] }
  /** A part of a table picked by what a component was given (SELECTS[view.list]), then deeper. */
  | { k: "pick"; table: Val[]; key: Prop; path: string[] }
  /** Values that hold only where a condition on what a component was given holds. */
  | { k: "when"; guards: Guard[]; vals: Val[] }
  | { k: "jsx" }
  /** Filled in as the app runs (a name, a number, a record). */
  | { k: "open" };
type Prop = Extract<Val, { k: "prop" }>;
type Pick = Extract<Val, { k: "pick" }>;
/** Words that come from what a component is given: known only where it is used. */
type When = Extract<Val, { k: "when" }>;
type Later = Prop | Pick | When;
const isLater = (v: Val): v is Later => v.k === "prop" || v.k === "pick" || v.k === "when";

/** The props a value waits for. */
function propsIn(v: Later): Prop[] {
  if (v.k === "prop") return [v];
  if (v.k === "pick") return [v.key];
  return [...v.guards.map((g) => g.prop), ...v.vals.filter(isLater).flatMap(propsIn)];
}

/** The same operation on the values a condition guards. */
const guarded = (v: When, op: (vals: Val[]) => Val[]): Val => ({ ...v, vals: op(v.vals) });

const OPEN: Val = { k: "open" };

/** Parentheses, `as`, `satisfies` and `!` change nothing shown. */
function bare(expr: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isNonNullExpression(expr) ||
    ts.isTypeAssertionExpression(expr)
  )
    expr = expr.expression;
  return expr;
}

function nameText(name: ts.PropertyName | ts.ModuleExportName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  if (ts.isComputedPropertyName(name)) {
    const key = bare(name.expression);
    if (ts.isStringLiteral(key) || ts.isNumericLiteral(key)) return key.text;
  }
  return null;
}

/** The property `name` of each value. */
function field(vals: Val[], name: string): Val[] {
  return vals.flatMap((v): Val[] => {
    if (v.k === "obj") {
      const out: Val[] = [];
      for (const p of v.node.properties) {
        if (ts.isSpreadAssignment(p)) out.push(...field(evaluate(p.expression, v.src), name));
        else if (p.name && nameText(p.name) === name) {
          if (ts.isPropertyAssignment(p)) out.push(...evaluate(p.initializer, v.src));
          else if (ts.isShorthandPropertyAssignment(p)) out.push(...evaluate(p.name, v.src));
          else out.push(OPEN);
        }
      }
      return out;
    }
    if (v.k === "pair") return name === "0" ? v.key : name === "1" ? v.value : [OPEN];
    if (v.k === "list")
      return /^\d+$/.test(name) ? (v.at ? (v.at[Number(name)] ?? []) : v.items) : [OPEN];
    if (v.k === "when") return [guarded(v, (vals) => field(vals, name))];
    if (isLater(v)) return [{ ...v, path: [...v.path, name] }];
    return [OPEN];
  });
}

/** The items of each list. */
function items(vals: Val[]): Val[] {
  return vals.flatMap((v): Val[] =>
    v.k === "list"
      ? v.items
      : v.k === "when"
        ? [guarded(v, items)]
        : isLater(v)
          ? [{ ...v, path: [...v.path, ITEM] }]
          : [OPEN],
  );
}

/** Every value of a table of words (Object.values, LABELS[kind]), or every item of a list. */
function values(vals: Val[]): Val[] {
  return vals.flatMap((v): Val[] => {
    if (v.k !== "obj") return items([v]);
    return v.node.properties.flatMap((p) =>
      ts.isSpreadAssignment(p)
        ? values(evaluate(p.expression, v.src))
        : ts.isPropertyAssignment(p)
          ? evaluate(p.initializer, v.src)
          : ts.isShorthandPropertyAssignment(p)
            ? evaluate(p.name, v.src)
            : [OPEN],
    );
  });
}

/** The keys of a table (Object.keys). */
function keys(vals: Val[]): Val[] {
  return vals.flatMap((v): Val[] =>
    v.k === "when"
      ? [guarded(v, keys)]
      : v.k === "obj"
        ? v.node.properties.flatMap((p) => {
            const name = p.name ? nameText(p.name) : null;
            return name === null ? [OPEN] : [{ k: "text", text: name }];
          })
        : [OPEN],
  );
}

/** Follows a path ("tabs", "[]", "label") into values. */
function follow(vals: Val[], steps: string[]): Val[] {
  return steps.reduce((acc, step) => (step === ITEM ? items(acc) : field(acc, step)), vals);
}

const MEMO = new Map<ts.Node, Val[]>();
const BUSY = new Set<ts.Node>();

/** Values that hold where guards hold (none: always). */
const when = (guards: Guard[], vals: Val[]): Val[] =>
  guards.length && vals.some((v) => v.k !== "jsx" && v.k !== "open")
    ? [{ k: "when", guards, vals }]
    : vals;

/** What an expression may be. */
function evaluate(node: ts.Expression, src: Src): Val[] {
  const known = MEMO.get(node);
  if (known) return known;
  // A value made from itself (a loop in the code): filled in as it runs.
  if (BUSY.has(node)) return [OPEN];
  BUSY.add(node);
  let out: Val[];
  try {
    out = evaluateNow(bare(node), src).slice(0, 120);
  } finally {
    BUSY.delete(node);
  }
  MEMO.set(node, out);
  return out;
}

function evaluateNow(e: ts.Expression, src: Src): Val[] {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))
    return [{ k: "text", text: e.text }];
  if (ts.isTemplateExpression(e))
    return [
      { k: "text", text: e.head.text + e.templateSpans.map((s) => `…${s.literal.text}`).join("") },
    ];
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e))
    return [{ k: "jsx" }];
  if (ts.isConditionalExpression(e))
    return [
      ...when(conditionOf(e.condition, src, true), evaluate(e.whenTrue, src)),
      ...when(conditionOf(e.condition, src, false), evaluate(e.whenFalse, src)),
    ];
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
      const left = evaluate(e.left, src);
      // `LABELS[kind] ?? kind`: when the table has the words, the key behind it is not shown.
      const right = bare(e.right);
      if (left.some((v) => v.k === "text" && v.text) && !ts.isStringLiteralLike(right)) return left;
      return [...left, ...evaluate(e.right, src)];
    }
    if (op === ts.SyntaxKind.AmpersandAmpersandToken)
      return when(conditionOf(e.left, src, true), evaluate(e.right, src));
    if (op === ts.SyntaxKind.CommaToken) return evaluate(e.right, src);
    if (op === ts.SyntaxKind.PlusToken) {
      const left = evaluate(e.left, src);
      const right = evaluate(e.right, src);
      if (![...left, ...right].some((v) => v.k === "text")) return [OPEN];
      const texts = (vs: Val[]) => vs.map((v) => (v.k === "text" ? v.text : "…"));
      return texts(left)
        .flatMap((a) => texts(right).map((b): Val => ({ k: "text", text: a + b })))
        .slice(0, 24);
    }
    return [OPEN];
  }
  if (ts.isIdentifier(e)) {
    if (e.text === "undefined") return [];
    const found = declaration(e.text, e, src);
    return found ? valueOf(found) : [OPEN];
  }
  if (ts.isPropertyAccessExpression(e))
    return e.name.text === "length" ? [OPEN] : field(evaluate(e.expression, src), e.name.text);
  if (ts.isElementAccessExpression(e)) {
    const key = bare(e.argumentExpression);
    const base = evaluate(e.expression, src);
    if (
      ts.isStringLiteral(key) ||
      ts.isNumericLiteral(key) ||
      ts.isNoSubstitutionTemplateLiteral(key)
    )
      return field(base, key.text);
    // LABELS[p] for each known p; SELECTS[view.list] where the component is used.
    const keyVals = evaluate(key, src);
    if (keyVals.length && keyVals.every((v) => v.k === "text"))
      return keyVals.flatMap((v) => (v.k === "text" ? field(base, v.text) : []));
    if (keyVals.length && keyVals.every((v) => v.k === "prop") && base.every((v) => v.k === "obj"))
      return keyVals.map((v): Val => ({ k: "pick", table: base, key: v as Prop, path: [] }));
    return values(base);
  }
  if (ts.isCallExpression(e)) return call(e, src);
  if (ts.isObjectLiteralExpression(e)) return [{ k: "obj", node: e, src }];
  if (ts.isArrayLiteralExpression(e)) {
    const spread = e.elements.some((el) => ts.isSpreadElement(el));
    const at = e.elements.map((el) =>
      ts.isSpreadElement(el)
        ? items(evaluate(el.expression, src))
        : ts.isOmittedExpression(el)
          ? []
          : evaluate(el, src),
    );
    return [{ k: "list", items: at.flat(), ...(spread ? {} : { at }) }];
  }
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return [{ k: "fn", node: e, src }];
  return [OPEN];
}

/** React hooks whose value the reader follows. */
const HOOKS = new Set(["useState", "useOptimistic", "useMemo", "useDeferredValue"]);

/** List methods that keep the list's items. */
const KEEPS = new Set(["filter", "slice", "sort", "toSorted", "reverse", "toReversed", "flat"]);
/** List methods that give one of the items. */
const PICKS = new Set(["find", "findLast", "at"]);

function call(e: ts.CallExpression, src: Src): Val[] {
  const callee = bare(e.expression);
  const arg = (i: number) => (e.arguments[i] ? evaluate(e.arguments[i]!, src) : []);
  if (ts.isPropertyAccessExpression(callee)) {
    const method = callee.name.text;
    const target = bare(callee.expression);
    if (ts.isIdentifier(target) && target.text === "Object") {
      if (method === "entries")
        return [{ k: "list", items: [{ k: "pair", key: keys(arg(0)), value: values(arg(0)) }] }];
      if (method === "keys") return [{ k: "list", items: keys(arg(0)) }];
      if (method === "values") return [{ k: "list", items: values(arg(0)) }];
      if (method === "freeze") return arg(0);
      return [OPEN];
    }
    if (method === "map" || method === "flatMap") {
      const made = arg(0).flatMap((fn) => (fn.k === "fn" ? returnsOf(fn) : [OPEN]));
      return [
        {
          k: "list",
          items:
            method === "flatMap" ? made.flatMap((v) => (v.k === "list" ? v.items : [v])) : made,
        },
      ];
    }
    if (KEEPS.has(method)) return evaluate(target, src);
    if (method === "concat")
      return [
        {
          k: "list",
          items: [
            ...items(evaluate(target, src)),
            ...e.arguments.flatMap((a) => {
              const v = evaluate(a, src);
              return v.some((x) => x.k === "list") ? items(v) : v;
            }),
          ],
        },
      ];
    if (PICKS.has(method)) return items(evaluate(target, src));
    return [OPEN];
  }
  // React's state: what it starts from (an optimistic copy of a prop stays that prop).
  if (ts.isIdentifier(callee) && HOOKS.has(callee.text)) {
    if (callee.text === "useMemo") return arg(0).flatMap(returnsOf);
    if (callee.text === "useDeferredValue") return arg(0);
    const first = arg(0).flatMap((v) => (v.k === "fn" ? returnsOf(v) : [v]));
    const now = callee.text === "useOptimistic" ? first : [...first, OPEN];
    return [{ k: "list", items: [...now, OPEN], at: [now, [OPEN]] }];
  }
  // One of the app's own functions: what it returns.
  const fns = evaluate(callee, src).filter((v) => v.k === "fn");
  return fns.length ? fns.flatMap(returnsOf) : [OPEN];
}

/** What a function returns. */
function returnsOf(fn: Val): Val[] {
  if (fn.k !== "fn") return [OPEN];
  const body = (fn.node as ts.FunctionLikeDeclaration).body;
  if (!body) return [OPEN];
  if (!ts.isBlock(body)) return evaluate(body, fn.src);
  const out: Val[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isReturnStatement(node)) {
      if (node.expression) out.push(...evaluate(node.expression, fn.src));
    } else if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit);
  };
  body.statements.forEach(visit);
  return out.length ? out : [OPEN];
}

/** Where a name is declared, and how to read it. */
type Decl =
  | {
      k: "value";
      init: ts.Expression;
      path: string[];
      fallback?: ts.Expression;
      name: string | null;
      src: Src;
    }
  | {
      k: "param";
      fn: ts.SignatureDeclaration;
      index: number;
      path: string[];
      fallback?: ts.Expression;
      src: Src;
    }
  | { k: "function"; node: ts.FunctionDeclaration; src: Src }
  | { k: "each"; list: ts.Expression; path: string[]; src: Src };

/** Where `name` sits in a binding (`label`, `{ label }`, `[, label]`, `{ a: { label = "x" } }`). */
function bindingOf(
  binding: ts.BindingName,
  name: string,
): { path: string[]; fallback?: ts.Expression } | null {
  if (ts.isIdentifier(binding)) return binding.text === name ? { path: [] } : null;
  for (const [i, el] of binding.elements.entries()) {
    if (ts.isOmittedExpression(el)) continue;
    if (el.dotDotDotToken) {
      if (ts.isIdentifier(el.name) && el.name.text === name) return { path: [] };
      continue;
    }
    const step = ts.isArrayBindingPattern(binding)
      ? String(i)
      : el.propertyName
        ? nameText(el.propertyName)
        : ts.isIdentifier(el.name)
          ? el.name.text
          : null;
    const inner = bindingOf(el.name, name);
    if (inner && step !== null)
      return {
        path: [step, ...inner.path],
        fallback: inner.path.length === 0 ? el.initializer : inner.fallback,
      };
  }
  return null;
}

/** The declaration of `name` among statements: undefined when none, null when it cannot be read. */
function inStatements(
  statements: readonly ts.Statement[],
  name: string,
  src: Src,
): Decl | null | undefined {
  for (const st of statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const b = bindingOf(d.name, name);
        if (!b) continue;
        if (!d.initializer) return null;
        const own = ts.isIdentifier(d.name) ? d.name.text : null;
        return { k: "value", init: d.initializer, ...b, name: own, src };
      }
    }
    if (ts.isFunctionDeclaration(st) && st.name?.text === name)
      return { k: "function", node: st, src };
    if (
      ts.isImportDeclaration(st) &&
      st.importClause &&
      !st.importClause.isTypeOnly &&
      ts.isStringLiteral(st.moduleSpecifier)
    ) {
      const clause = st.importClause;
      const spec = st.moduleSpecifier.text;
      if (clause.name?.text === name) return imported(src, spec, "default");
      const named = clause.namedBindings;
      if (named && ts.isNamedImports(named))
        for (const el of named.elements)
          if (el.name.text === name) return imported(src, spec, (el.propertyName ?? el.name).text);
      if (named && ts.isNamespaceImport(named) && named.name.text === name) return null;
    }
  }
  return undefined;
}

/** The declaration a name refers to, from where it is used. */
function declaration(name: string, from: ts.Node, src: Src): Decl | null {
  for (let node = from.parent; node; node = node.parent) {
    if (ts.isFunctionLike(node)) {
      for (const [index, p] of node.parameters.entries()) {
        const b = bindingOf(p.name, name);
        if (b)
          return {
            k: "param",
            fn: node,
            index,
            path: b.path,
            fallback: b.path.length === 0 ? p.initializer : b.fallback,
            src,
          };
      }
    }
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      for (const d of node.initializer.declarations) {
        const b = bindingOf(d.name, name);
        if (b) return { k: "each", list: node.expression, path: b.path, src };
      }
    }
    if (
      ts.isBlock(node) ||
      ts.isSourceFile(node) ||
      ts.isModuleBlock(node) ||
      ts.isCaseClause(node) ||
      ts.isDefaultClause(node)
    ) {
      const found = inStatements(node.statements, name, src);
      if (found !== undefined) return found;
    }
  }
  return null;
}

/** Only the app's own code is followed (src/), never a package. */
function imported(src: Src, spec: string, name: string): Decl | null {
  const target = resolve(src.root, src.file, spec);
  if (!target || !target.startsWith(path.join(src.root, "src") + path.sep)) return null;
  return exported(source(src.root, target), name, 0);
}

function exported(src: Src, name: string, hops: number): Decl | null {
  if (hops > 5) return null;
  const has = (st: ts.Statement, kind: ts.SyntaxKind) =>
    ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === kind);
  for (const st of src.sf.statements) {
    if (name === "default") {
      if (ts.isFunctionDeclaration(st) && has(st, ts.SyntaxKind.DefaultKeyword))
        return { k: "function", node: st, src };
      if (ts.isExportAssignment(st) && !st.isExportEquals)
        return { k: "value", init: st.expression, path: [], name: null, src };
      continue;
    }
    if (
      (ts.isVariableStatement(st) || ts.isFunctionDeclaration(st)) &&
      has(st, ts.SyntaxKind.ExportKeyword)
    ) {
      const found = inStatements([st], name, src);
      if (found !== undefined) return found;
    }
    if (ts.isExportDeclaration(st) && !st.isTypeOnly) {
      const spec =
        st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
          ? st.moduleSpecifier.text
          : null;
      const from = (local: string) => {
        if (!spec) return inStatements(src.sf.statements, local, src) ?? null;
        const target = resolve(src.root, src.file, spec);
        return target ? exported(source(src.root, target), local, hops + 1) : null;
      };
      if (!st.exportClause) {
        const found = from(name);
        if (found) return found;
      } else if (ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements)
          if (el.name.text === name) return from((el.propertyName ?? el.name).text);
      }
    }
  }
  return null;
}

/** List methods whose function is given each item first. */
const EACH = new Set(["map", "flatMap", "forEach", "filter", "find", "findLast", "some", "every"]);

/** A list made empty and filled with push() (`const menu = []; if (can) menu.push({ label: "…" })`). */
function pushed(d: Extract<Decl, { k: "value" }>): Val[] {
  if (!d.name || d.path.length || !ts.isArrayLiteralExpression(bare(d.init))) return [];
  const statement = d.init.parent?.parent?.parent;
  const scope = statement?.parent;
  if (!scope) return [];
  const added: Val[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "push" &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === d.name
    )
      for (const a of node.arguments) added.push(...evaluate(a, d.src));
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return added.length ? [{ k: "list", items: added }] : [];
}

function valueOf(d: Decl): Val[] {
  if (d.k === "function") return [{ k: "fn", node: d.node, src: d.src }];
  if (d.k === "each") return follow(items(evaluate(d.list, d.src)), d.path);
  const fallback = d.fallback ? evaluate(d.fallback, d.src) : [];
  if (d.k === "value")
    return [...follow([...evaluate(d.init, d.src), ...pushed(d)], d.path), ...fallback];
  // A parameter: an item of the list a function goes through, or what a component was given.
  let up: ts.Node = d.fn.parent;
  while (ts.isParenthesizedExpression(up)) up = up.parent;
  if (ts.isCallExpression(up) && ts.isPropertyAccessExpression(bare(up.expression))) {
    const access = bare(up.expression) as ts.PropertyAccessExpression;
    if (EACH.has(access.name.text) && d.index === 0)
      return [...follow(items(evaluate(access.expression, d.src)), d.path), ...fallback];
    return [OPEN, ...fallback];
  }
  const component = componentName(d.fn, d.src);
  if (component && d.index === 0 && d.path.length > 0)
    // A default ({ label = "Reason" }) holds only where the component is not given that prop.
    return [
      {
        k: "prop",
        of: `${d.src.rel}#${component}`,
        path: d.path,
        ...(fallback.length ? { fallback } : {}),
      },
    ];
  return [OPEN, ...fallback];
}

/**
 * The name of the component a function is (`function PrintButton`, `const
 * Row = memo(() => …)`), or null. A page or a layout is given its props by
 * Next.js (the address), so what it shows from them is filled in as it runs.
 */
function componentName(fn: ts.Node, src: Src): string | null {
  if (/(^|\/)(page|layout)\.tsx$/.test(src.rel) && ts.isFunctionDeclaration(fn)) {
    const mods = ts.getModifiers(fn) ?? [];
    if (mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return null;
  }
  if (ts.isFunctionDeclaration(fn))
    return fn.name && /^[A-Z]/.test(fn.name.text) ? fn.name.text : null;
  let up = fn.parent;
  while (up && (ts.isCallExpression(up) || ts.isParenthesizedExpression(up))) up = up.parent;
  if (up && ts.isVariableDeclaration(up) && ts.isIdentifier(up.name) && /^[A-Z]/.test(up.name.text))
    return up.name.text;
  return null;
}

/** The component a JSX tag draws ("file#Name"), when it is the app's own. */
function componentKey(tag: ts.JsxTagNameExpression, src: Src): string | null {
  if (!ts.isIdentifier(tag) || !/^[A-Z]/.test(tag.text)) return null;
  const d = declaration(tag.text, tag, src);
  if (d?.k === "function" && d.node.name) return `${d.src.rel}#${d.node.name.text}`;
  if (d?.k === "value" && d.name && d.path.length === 0) return `${d.src.rel}#${d.name}`;
  return null;
}

// -------------------------------------------------- reading a whole screen

/**
 * A condition an element is drawn under, on what its component was given:
 * `view.list === "payments" && <…>` holds where a screen gives list "payments".
 */
type Guard = { prop: Prop; is: boolean; texts: string[] };

/** What one element on a screen says. */
type Said = {
  kind: Kind;
  file: string;
  labels: string[];
  /** Words its component is given where it is used (a prop, a part of a table picked by one). */
  later: Later[];
  /** Drawn only where these hold. */
  guards: Guard[];
  /** The code of a button whose words could not be followed. */
  unread: string | null;
  /** It has words of its own (counted where it is drawn), so it is never unread. */
  named?: boolean;
  /** The statement at the top of its file that draws it (a component, a helper). */
  top: ts.Statement | null;
};

/** The words among values, and what comes from a component's props. */
function wordsOf(vals: Val[]): { texts: string[]; later: Later[] } {
  return {
    texts: vals.flatMap((v) =>
      v.k === "text"
        ? [
            v.text
              .replace(/\s+/g, " ")
              .replace(/…+/g, "…")
              // "Everything left (${count})" is the button "Everything left".
              .replace(/\s*\(\s*…?\s*\)/g, "")
              .trim(),
          ]
        : [],
    ),
    later: vals.filter(isLater),
  };
}

function attribute(el: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === name,
  );
}

function attributeVals(a: ts.JsxAttribute, src: Src): Val[] {
  const init = a.initializer;
  if (!init) return [];
  if (ts.isStringLiteral(init)) return [{ k: "text", text: init.text }];
  if (ts.isJsxExpression(init) && init.expression) return evaluate(init.expression, src);
  return [OPEN];
}

/** The conditions on its component's props an element is drawn under. */
function guardsOf(node: ts.Node, src: Src): Guard[] {
  const out: Guard[] = [];
  let child = node;
  for (let n = node.parent; n && !ts.isSourceFile(n); child = n, n = n.parent) {
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      n.right === child
    )
      out.push(...conditionOf(n.left, src, true));
    if (ts.isConditionalExpression(n) && n.whenTrue === child)
      out.push(...conditionOf(n.condition, src, true));
    if (ts.isConditionalExpression(n) && n.whenFalse === child)
      out.push(...conditionOf(n.condition, src, false));
    if (ts.isFunctionLike(n) && componentName(n, src)) break;
  }
  return out;
}

/** `view.list === "payments"` (or its opposite) as a guard; [] when it is not about a prop. */
function conditionOf(expr: ts.Expression, src: Src, holds: boolean): Guard[] {
  const e = bare(expr);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken)
    return conditionOf(e.operand, src, !holds);
  if (!ts.isBinaryExpression(e)) return [];
  const op = e.operatorToken.kind;
  if (op === ts.SyntaxKind.AmpersandAmpersandToken)
    return holds ? [...conditionOf(e.left, src, true), ...conditionOf(e.right, src, true)] : [];
  if (op === ts.SyntaxKind.BarBarToken) {
    if (!holds) return [...conditionOf(e.left, src, false), ...conditionOf(e.right, src, false)];
    // a === "x" || a === "y": one guard on the same prop.
    const [l, r] = [conditionOf(e.left, src, true), conditionOf(e.right, src, true)];
    if (l.length === 1 && r.length === 1 && l[0]!.is && r[0]!.is) {
      if (JSON.stringify(l[0]!.prop) === JSON.stringify(r[0]!.prop))
        return [{ ...l[0]!, texts: [...l[0]!.texts, ...r[0]!.texts] }];
    }
    return [];
  }
  const equal =
    op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
  const differ =
    op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    op === ts.SyntaxKind.ExclamationEqualsToken;
  if (!equal && !differ) return [];
  const [left, right] = [evaluate(e.left, src), evaluate(e.right, src)];
  const guard = (side: Val[], other: Val[]): Guard[] =>
    side.length === 1 && side[0]!.k === "prop" && other.length && other.every((v) => v.k === "text")
      ? [
          {
            prop: side[0]!,
            is: equal === holds,
            texts: other.map((v) => (v.k === "text" ? v.text : "")),
          },
        ]
      : [];
  return [...guard(left, right), ...guard(right, left)];
}

/** What an element with text says: its written words, else what it shows, else its aria-label. */
function sayOf(el: ts.JsxElement, src: Src, kind: Kind): Said {
  const said = (labels: string[], later: Later[], unread: string | null = null): Said => ({
    kind,
    file: src.rel,
    labels,
    later,
    guards: guardsOf(el, src),
    unread,
    top: topOf(el),
  });
  const { labels, shown } = written(el, kind === "name");
  if (labels.length) return said(labels, []);
  const fromShown = wordsOf(shown.flatMap((e) => evaluate(e, src)));
  if (fromShown.texts.length || fromShown.later.length)
    return said(fromShown.texts, fromShown.later);
  // An icon button names itself for screen readers (on itself, or on the link it wraps).
  const aria = ariaLabelOf(el);
  if (aria) {
    const fromAria = wordsOf(attributeVals(aria, src));
    if (fromAria.texts.length || fromAria.later.length) return said(fromAria.texts, fromAria.later);
  }
  const drawn = el.children.find((c) => ts.isJsxSelfClosingElement(c));
  const code =
    shown.map((e) => `{${e.getText()}}`).join(" ") ||
    (aria ? aria.getText() : drawn ? drawn.getText() : "(no words)");
  return said([], [], code.replace(/\s+/g, " "));
}

/** The aria-label of an element, or of the first element inside it (`<Button asChild><a aria-label>`). */
function ariaLabelOf(el: ts.JsxElement): ts.JsxAttribute | undefined {
  const own = attribute(el.openingElement, "aria-label");
  if (own) return own;
  for (const child of el.children) {
    const opening = ts.isJsxElement(child)
      ? child.openingElement
      : ts.isJsxSelfClosingElement(child)
        ? child
        : null;
    const inner = opening && attribute(opening, "aria-label");
    if (inner) return inner;
  }
  return undefined;
}

/** The component (its key) a said depends on, when it waits for where that component is used. */
function waitsFor(said: Said): string | null {
  const first = said.later.flatMap(propsIn)[0] ?? said.guards[0]?.prop;
  return first ? first.of : null;
}

/**
 * What a said inside component `key` says where a screen uses it (`site`): its
 * props and picks filled in with what the screen gives, its guards checked.
 * Null when a guard rules it out there.
 */
function atSite(
  said: Said,
  key: string,
  site: ts.JsxOpeningLikeElement,
  node: ts.Node,
  src: Src,
): Said | null {
  const given = (path: string[]): Val[] => {
    const [name, ...rest] = path;
    if (!name) return [OPEN];
    if (name === "children") {
      if (!ts.isJsxElement(node) || rest.length) return [OPEN];
      const inner = sayOf(node, src, said.kind);
      return [...inner.labels.map((text): Val => ({ k: "text", text })), ...inner.later];
    }
    const a = attribute(site, name);
    return a ? follow(attributeVals(a, src), rest) : [];
  };
  /** What a prop is here: what this screen gives it, else its default. */
  const here = (p: Prop): Val[] => {
    const now = given(p.path);
    return now.length ? now : (p.fallback ?? []);
  };
  /** Guards checked here: null when one fails, else the guards still waiting on an outer prop. */
  const check = (list: Guard[]): Guard[] | null => {
    const kept: Guard[] = [];
    for (const g of list) {
      const now = g.prop.of === key ? here(g.prop) : [g.prop];
      if (now.length && now.every((v) => v.k === "text")) {
        const hit = now.some((v) => v.k === "text" && g.texts.includes(v.text));
        if (hit !== g.is) return null;
      } else if (now.length === 1 && now[0]!.k === "prop") kept.push({ ...g, prop: now[0]! });
    }
    return kept;
  };
  const fill = (vals: Val[]): Val[] =>
    vals.flatMap((v): Val[] => {
      if (v.k === "prop" && v.of === key) return here(v);
      if (v.k === "pick" && v.key.of === key) {
        const keyVals = here(v.key);
        const picked =
          keyVals.length && keyVals.every((k) => k.k === "text")
            ? keyVals.flatMap((k) => (k.k === "text" ? field(v.table, k.text) : []))
            : values(v.table);
        return follow(picked, v.path);
      }
      if (v.k === "when") {
        const kept = check(v.guards);
        return kept ? when(kept, fill(v.vals)) : [];
      }
      return [v];
    });
  const guards = check(said.guards);
  if (!guards) return null;
  const { texts, later } = wordsOf(fill(said.later));
  const labels = [...said.labels, ...texts];
  // The props it shows from, as this screen gives them; none given: it shows nothing here.
  const names = [
    ...new Set(
      said.later
        .flatMap(propsIn)
        .filter((v) => v.of === key)
        .map((v) => v.path[0] ?? ""),
    ),
  ];
  const shownHere = names.filter((n) =>
    n === "children" ? ts.isJsxElement(node) : !!attribute(site, n),
  );
  if (!labels.length && !later.length && names.length && !shownHere.length) return null;
  const unread =
    said.kind === "press" && !said.named && !labels.length && !later.length
      ? `<${tagName(site)} ${shownHere
          .map((n) => (n === "children" ? "{children}" : attribute(site, n)!.getText()))
          .join(" ")
          .replace(/\s+/g, " ")}>`
      : null;
  return {
    kind: said.kind,
    file: src.rel,
    labels,
    later,
    guards: [...guards, ...guardsOf(node, src)],
    unread,
    named: said.named,
    top: topOf(node),
  };
}

/**
 * What the elements of one file say, given what the components it uses say
 * where they are used (`waiting`, by component).
 */
function sayingsOf(src: Src, waiting: Map<string, Said[]>): Said[] {
  const out: Said[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (opening) {
      const tag = tagName(opening);
      // <option value="">Choose</option>: the line for nothing picked yet (or, in a filter, for all).
      const prompt =
        tag === "option" &&
        (() => {
          const value = attribute(opening, "value")?.initializer;
          return Boolean(value && ts.isStringLiteral(value) && value.text === "");
        })();
      if (ts.isJsxElement(node) && (PRESSABLE.has(tag) || NAMING.has(tag)) && !prompt)
        out.push(
          sayOf(node, src, PRESSABLE.has(tag) ? "press" : tag === "option" ? "option" : "name"),
        );
      // A component that shows what it is given: the words this screen gives it.
      const key = componentKey(opening.tagName, src);
      for (const said of key ? (waiting.get(key) ?? []) : []) {
        const here = atSite(said, key!, opening, node, src);
        if (here) out.push(here);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src.sf);
  return out;
}

/** Every screen file of the app (pages, layouts, components; not the ui kit). */
function allScreenFiles(root: string): string[] {
  return ["app", "components"].flatMap((dir) => {
    const base = path.join(root, "src", dir);
    if (!existsSync(base)) return [];
    return walk(base, (f) => f.endsWith(".tsx") && isScreenFile(root, f));
  });
}

/** The app read once: what each file's elements say, where they are drawn whatever the props. */
const READ = new Map<string, Map<string, Said[]>>();

function readApp(root: string): Map<string, Said[]> {
  const known = READ.get(root);
  if (known) return known;
  const files = allScreenFiles(root).map((f) => source(root, f));
  // What a component says from what it is given waits for where it is used,
  // round after round until nothing new turns up (a PrintButton may be given
  // its words by a ReportActions that is given them).
  let waiting = new Map<string, Said[]>();
  let count = -1;
  let byFile = new Map<string, Said[]>();
  for (let round = 0; round < 10; round++) {
    const all = files.map((src) => [src.rel, sayingsOf(src, waiting)] as const);
    const next = new Map<string, Said[]>();
    byFile = new Map();
    for (const [rel, saids] of all) {
      const here: Said[] = [];
      for (const said of saids) {
        const key = waitsFor(said);
        if (!key) {
          here.push(said);
          continue;
        }
        next.set(key, [
          ...(next.get(key) ?? []),
          {
            ...said,
            labels: said.guards.length ? said.labels : [],
            named: said.named || said.labels.length > 0,
          },
        ]);
        // Words of its own (a default), drawn whatever it is given, count here.
        if (!said.guards.length && said.labels.length) here.push({ ...said, later: [] });
      }
      byFile.set(rel, here);
    }
    const total = [...next.values()].reduce((n, list) => n + list.length, 0);
    waiting = next;
    if (total === count) break;
    count = total;
  }
  READ.set(root, byFile);
  return byFile;
}

/** The statement at the top of a file that holds a node. */
function topOf(node: ts.Node): ts.Statement | null {
  let n = node;
  while (n.parent && !ts.isSourceFile(n.parent)) n = n.parent;
  return n.parent ? (n as ts.Statement) : null;
}

/** Whether an identifier refers to something (not a name being declared, a property or a type). */
function isReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isExpressionWithTypeArguments(p))
    return false;
  if (
    (ts.isVariableDeclaration(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isTypeAliasDeclaration(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isEnumMember(p)) &&
    p.name === id
  )
    return false;
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return false;
  if (ts.isJsxAttribute(p) || ts.isImportSpecifier(p) || ts.isImportClause(p)) return false;
  if (ts.isExportSpecifier(p) || ts.isNamespaceImport(p) || ts.isLabeledStatement(p)) return false;
  return true;
}

const USES = new Map<ts.Statement, Array<{ st: ts.Statement; src: Src }>>();

/** The app's top-level declarations a statement uses (components, helpers, constants), here or imported. */
function usesOf(st: ts.Statement, src: Src): Array<{ st: ts.Statement; src: Src }> {
  const known = USES.get(st);
  if (known) return known;
  const out = new Map<ts.Statement, Src>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && isReference(node)) {
      const d = declaration(node.text, node, src);
      const at = d?.k === "value" ? topOf(d.init) : d?.k === "function" ? topOf(d.node) : null;
      if (d && at && at !== st) out.set(at, d.src);
    }
    if (!ts.isTypeNode(node)) ts.forEachChild(node, visit);
  };
  visit(st);
  const list = [...out].map(([use, from]) => ({ st: use, src: from }));
  USES.set(st, list);
  return list;
}

/** What a page or a layout exports for Next.js to draw. */
function entriesOf(src: Src): ts.Statement[] {
  return src.sf.statements.filter(
    (st) =>
      ts.isExportAssignment(st) ||
      (ts.isFunctionDeclaration(st) &&
        (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)),
  );
}

/**
 * The statements a set of screen files draws: from each page's and layout's
 * export, what it uses, and what that uses, within the files. A component a
 * file holds but the page never draws (an import for a small helper) is not on
 * the page. Null when the files hold no page or layout: all of them count.
 */
function reached(root: string, files: string[]): Set<ts.Statement> | null {
  const within = new Set(files);
  const entries = files
    .filter((rel) => /(^|\/)(page|layout)\.tsx$/.test(rel))
    .flatMap((rel) => {
      const src = source(root, path.join(root, rel));
      return entriesOf(src).map((st) => ({ st, src }));
    });
  if (!entries.length) return null;
  const seen = new Set<ts.Statement>();
  const queue = [...entries];
  while (queue.length) {
    const { st, src } = queue.pop()!;
    if (seen.has(st)) continue;
    seen.add(st);
    for (const use of usesOf(st, src)) if (within.has(use.src.rel)) queue.push(use);
  }
  return seen;
}

/** What a set of screen files says, element by element, on what its pages draw. */
function sayings(root: string, files: string[]): Said[] {
  const app = readApp(root);
  const drawn = reached(root, files);
  return files.flatMap((rel) =>
    (app.get(rel) ?? []).filter((said) => !drawn || (said.top && drawn.has(said.top))),
  );
}

/** The words a set of screen files shows, and what each is: a button, a field's label or a choice. */
export function screenWords(
  root: string,
  files: string[],
): Array<{ label: string; kind: WordKind }> {
  const words = new Map<string, WordKind>();
  for (const said of sayings(root, files))
    for (const label of said.labels) {
      if (!counts(label)) continue;
      // The same words on a button and as a choice are the button's.
      const had = words.get(label);
      if (!had || said.kind === "press" || (had === "option" && said.kind === "name"))
        words.set(label, said.kind);
    }
  return [...words]
    .map(([label, kind]) => ({ label, kind }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** The words a set of screen files shows on its buttons, tabs, menu items, options and field labels. */
export function pressables(root: string, files: string[]): string[] {
  return screenWords(root, files).map((w) => w.label);
}

/**
 * The buttons, tabs and menu items whose words the reader cannot follow to the
 * text in the code (names and numbers the app fills in as it runs): each needs
 * a reason (tests/unit/help-unread.ts).
 */
export function unreadLabels(root: string, files: string[]): Array<{ file: string; code: string }> {
  const seen = new Map<string, { file: string; code: string }>();
  for (const said of sayings(root, files))
    if (said.kind === "press" && said.unread)
      seen.set(`${said.file}: ${said.unread}`, { file: said.file, code: said.unread });
  return [...seen.values()].sort((a, b) =>
    `${a.file} ${a.code}`.localeCompare(`${b.file} ${b.code}`),
  );
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
