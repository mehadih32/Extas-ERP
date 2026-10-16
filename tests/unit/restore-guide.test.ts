import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DETAILS_TEXT,
  GUIDE_ERRORS,
  GUIDE_INTRO,
  GUIDE_NEEDS,
  GUIDE_PARTS,
  GUIDE_QUESTIONS,
  GUIDE_RULES,
  GUIDE_STEP_IDS,
  GUIDE_TITLE,
  GUIDE_WORDS,
  OTHER_MESSAGES,
  quotedLabels,
  type Text,
} from "@/modules/backups/restore-guide";
import { PICTURES } from "@/modules/backups/restore-guide-pictures";

/*
 * The restore guide (G6) against the restore command itself: every question
 * the command asks and every error or note it can print is in the guide, with
 * what to do, and the guide lists nothing the command no longer prints. And
 * the one command (G8, A8): the bootstrap script is public, holds no secret,
 * needs no GitHub sign-in and checks the restore tool it downloads.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const BOOTSTRAP = read("deploy/bootstrap.sh");
const TOOL = read("deploy/restore-tool.py");
const LIB = read("deploy/lib.sh");
const SCRIPTS = [BOOTSTRAP, TOOL, LIB].join("\n");
const BENGALI = /[ঀ-৿]/;
const BENGALI_DIGIT = /[০-৯]/;
/** A shell script without its comment lines. */
const CODE_ONLY = (script: string) =>
  script
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

/** The text of every guide entry in one language, for the checks over all of it. */
function allText(lang: keyof Text): string[] {
  const texts: Text[] = [
    GUIDE_TITLE,
    GUIDE_INTRO,
    ...GUIDE_NEEDS,
    ...GUIDE_RULES,
    ...Object.values(GUIDE_WORDS),
    ...Object.values(DETAILS_TEXT),
    ...GUIDE_PARTS.flatMap((p) => [
      p.title,
      p.intro,
      ...p.steps.flatMap((s) => [s.title, s.text, ...(s.tip ? [s.tip] : [])]),
    ]),
    ...GUIDE_QUESTIONS.map((q) => q.answer),
    ...GUIDE_ERRORS.flatMap((e) => [e.meaning, e.todo]),
    ...OTHER_MESSAGES.flatMap((m) => [m.where, m.todo]),
  ];
  return texts.map((t) => t[lang]);
}

describe("the restore guide's words", () => {
  it("has every step in Bengali and English, one id each, a picture for most", () => {
    expect(new Set(GUIDE_STEP_IDS).size).toBe(GUIDE_STEP_IDS.length);
    for (const part of GUIDE_PARTS) {
      for (const step of part.steps) {
        expect(step.id.startsWith(part.id), step.id).toBe(true);
        expect(step.title.bn, step.id).toMatch(BENGALI);
        expect(step.text.bn, step.id).toMatch(BENGALI);
        expect(step.text.en, step.id).not.toMatch(BENGALI);
        if (step.picture) expect(PICTURES, step.id).toContain(step.picture);
      }
    }
    const withPicture = GUIDE_PARTS.flatMap((p) => p.steps).filter((s) => s.picture).length;
    expect(withPicture / GUIDE_STEP_IDS.length).toBeGreaterThan(0.8);
    // Every picture is shown somewhere; the command and the details have a step.
    const used = new Set(GUIDE_PARTS.flatMap((p) => p.steps.map((s) => s.picture)));
    for (const picture of PICTURES) expect(used.has(picture), picture).toBe(true);
    expect(GUIDE_PARTS.flatMap((p) => p.steps).filter((s) => s.command)).toHaveLength(1);
    expect(GUIDE_PARTS.flatMap((p) => p.steps).filter((s) => s.details)).toHaveLength(1);
  });

  it("writes Bengali with Western digits, and English without Bengali", () => {
    for (const text of allText("bn")) expect(text).not.toMatch(BENGALI_DIGIT);
    for (const text of allText("en")) expect(text).not.toMatch(BENGALI);
  });

  it("quotes the same screen words in both languages", () => {
    for (const part of GUIDE_PARTS) {
      for (const step of part.steps) {
        expect(quotedLabels(step.text.bn).sort(), step.id).toEqual(
          quotedLabels(step.text.en).sort(),
        );
      }
    }
  });

  it("names only steps that exist", () => {
    const ids = new Set(GUIDE_STEP_IDS);
    const named = [...allText("en"), ...allText("bn"), SCRIPTS].flatMap((text) =>
      [...text.matchAll(/\b(?:step |at |from |in |as in |\()?([A-F]\d{1,2})\b/g)].map((m) => m[1]!),
    );
    for (const id of named) expect(ids.has(id), id).toBe(true);
    for (const m of SCRIPTS.matchAll(/step ([A-F]\d{1,2}) in the guide/g)) {
      expect(ids.has(m[1]!), m[1]).toBe(true);
    }
  });
});

describe("the guide and the restore command", () => {
  const printed = new Set([
    ...[...SCRIPTS.matchAll(/\b(?:fail|warn)\s*\(?\s*"?([RW]\d\d)\b/g)].map((m) => m[1]!),
    ...[...SCRIPTS.matchAll(/(?:Error|Note) ([RW]\d\d):/g)].map((m) => m[1]!),
  ]);

  it("explains every error and note the command can print, and no other", () => {
    const listed = GUIDE_ERRORS.map((e) => e.code);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...printed].sort()).toEqual([...listed].sort());
    for (const error of GUIDE_ERRORS) {
      expect(error.meaning.bn, error.code).toMatch(BENGALI);
      expect(error.todo.bn, error.code).toMatch(BENGALI);
    }
  });

  it("shows each error as the command prints it", () => {
    for (const error of GUIDE_ERRORS) {
      for (const part of error.shown.split(/ \/ |\.\.\./)) {
        const words = part.trim();
        if (words) expect(SCRIPTS, `${error.code}: ${words}`).toContain(words);
      }
    }
  });

  it("explains every question the command asks, as printed", () => {
    // Python: ask("name", "prompt" or f"prompt"; bash: answer name 'prompt' or "prompt".
    const asked = [
      ...[...TOOL.matchAll(/\bask\("\w+", f?"((?:[^"\\]|\\.)*)"/g)].map((m) =>
        m[1]!.replaceAll('\\"', '"'),
      ),
      ...[...CODE_ONLY(BOOTSTRAP).matchAll(/\banswer \w+ (?:'([^']*)'|"([^"]*)")/g)].map(
        (m) => m[1] ?? m[2]!,
      ),
    ];
    expect(asked.length).toBeGreaterThanOrEqual(GUIDE_QUESTIONS.length);
    // "..." in the guide stands for what the command fills in ({...} or $name).
    const shape = (prompt: string) =>
      new RegExp(
        `^${prompt
          .split("...")
          .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".+")}$`,
      );
    for (const prompt of asked) {
      const filled = prompt.replace(/\{[^}]*\}|\$\w+/g, "X");
      expect(
        GUIDE_QUESTIONS.some((q) => shape(q.prompt).test(filled)),
        prompt,
      ).toBe(true);
    }
    for (const question of GUIDE_QUESTIONS) {
      expect(
        asked.some((prompt) =>
          shape(question.prompt).test(prompt.replace(/\{[^}]*\}|\$\w+/g, "X")),
        ),
        question.prompt,
      ).toBe(true);
      expect(question.answer.bn).toMatch(BENGALI);
    }
  });

  it("asks every secret as hidden input, and none on a command line", () => {
    for (const name of [
      "google_client_id",
      "google_client_secret",
      "recovery_key",
      "old_key_card",
    ]) {
      expect(TOOL, name).toMatch(new RegExp(`ask\\("${name}", [^\\n]*hidden=True\\)`));
    }
    // The bootstrap passes the tool only folders and files, never a secret.
    for (const m of BOOTSTRAP.matchAll(/\btool (fetch|env|dns|compare|fact)\b([^\n|)]*)/g)) {
      const args = m[2]!.replace(/"\$[A-Za-z_]+[^"]*"/g, "").replace(/--\w+/g, "");
      expect(args.replace(/[)"\\]/g, "").trim(), m[0]).toMatch(/^(\w+)?$/);
    }
    expect(SCRIPTS).not.toMatch(/read -r?s?p? .*(secret|key|token)/i);
  });

  it("needs no GitHub sign-in and keeps no GitHub token", () => {
    for (const text of [BOOTSTRAP, TOOL]) {
      expect(text).not.toMatch(
        /GITHUB_TOKEN|x-access-token|credential\.helper.*store|Authorization: Bearer \$/,
      );
    }
    // The tool comes from the same public commit and is checked before it runs.
    expect(BOOTSTRAP).toContain('"$RAW_BASE/$REPO/$ref/deploy/restore-tool.py"');
    const pinned = BOOTSTRAP.match(/^RESTORE_TOOL_SHA256=([0-9a-f]{64})$/m)?.[1];
    expect(pinned).toBe(createHash("sha256").update(read("deploy/restore-tool.py")).digest("hex"));
  });

  it("never replaces this server's ENCRYPTION_KEY, and asks before replacing an ERP", () => {
    expect(TOOL).toMatch(
      /if not current and backup_key:\n\s+lines = set_env\(lines, "ENCRYPTION_KEY"/,
    );
    expect(BOOTSTRAP).toContain(
      "Type the web address of the ERP on this server to replace its data, or press Enter to stop: ",
    );
  });
});
