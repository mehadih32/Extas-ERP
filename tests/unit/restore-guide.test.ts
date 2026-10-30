import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DETAILS_TEXT,
  DRILL_PART,
  drillCommandLines,
  GUIDE_ERRORS,
  GUIDE_INTRO,
  GUIDE_NEEDS,
  GUIDE_PARTS,
  GUIDE_QUESTIONS,
  GUIDE_RULES,
  GUIDE_STEP_IDS,
  GUIDE_TITLE,
  GUIDE_WORDS,
  NO_GITHUB_PART,
  noGithubCommandLines,
  OTHER_MESSAGES,
  quotedLabels,
  REPLACE_RULE,
  type Text,
} from "@/modules/backups/restore-guide";
import { PICTURES, SCREENSHOT_SLOTS } from "@/modules/backups/restore-guide-pictures";

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
    ...[NO_GITHUB_PART, DRILL_PART].flatMap((p) => [
      p.title,
      p.intro,
      ...p.steps,
      p.commandMissing,
    ]),
    REPLACE_RULE,
  ];
  return texts.map((t) => t[lang]);
}

const STEPS = GUIDE_PARTS.flatMap((p) => p.steps);
const step = (id: string) => STEPS.find((s) => s.id === id)!;

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

describe("the owner's items for the guide (v6.4.1)", () => {
  const OVERWRITE = "Type the web address of the ERP on this server";

  it("never tells the owner to type the web address at the overwrite question (item 8, v6.4.2 item 5)", () => {
    // The rule: always just Enter. A try that stopped on the new server made for this
    // restore goes on by itself when pasted again there (bootstrap.sh's mark), without
    // the question; if it asks there anyway, a new VM is the way to start again.
    expect(REPLACE_RULE.en).toMatch(/^At this question always just press Enter: nothing changes\./);
    expect(REPLACE_RULE.en).toContain("Never type the web address here.");
    expect(REPLACE_RULE.en).toMatch(/stopped part way on the new server you made in part A/);
    expect(REPLACE_RULE.en).toMatch(
      /goes on by itself from where it stopped and does not ask this/,
    );
    expect(REPLACE_RULE.en).toMatch(/make another new VM as in part A/);
    expect(REPLACE_RULE.bn).toContain("কখনো ওয়েব ঠিকানা টাইপ করবেন না");
    for (const text of [REPLACE_RULE.en, ...allText("en")]) {
      expect(text).not.toMatch(/type exactly the address on the “Web address” line/);
      expect(text).not.toMatch(/Type the web address here only when/);
    }
    // The command does as the rule says: its own restore that stopped on a new server goes on.
    expect(BOOTSTRAP).toContain('[ -f "$i_data/backups/$UNFINISHED" ]');
    // Wherever the guide speaks of that question, it gives the rule, in both languages.
    const texts: Text[] = [
      ...STEPS.flatMap((st) => [st.text, ...(st.tip ? [st.tip] : [])]),
      ...GUIDE_QUESTIONS.map((q) => q.answer),
      ...GUIDE_ERRORS.map((e) => e.todo),
    ];
    const speaking = texts.filter((t) => t.en.includes(OVERWRITE));
    expect(speaking.length).toBeGreaterThanOrEqual(2);
    for (const text of speaking) {
      expect(text.en).toContain(REPLACE_RULE.en);
      expect(text.bn).toContain(REPLACE_RULE.bn);
    }
    const question = GUIDE_QUESTIONS.find((q) => q.prompt.startsWith(OVERWRITE))!;
    expect(question.answer.en).toContain(REPLACE_RULE.en);
    expect(GUIDE_ERRORS.find((e) => e.code === "R04")!.todo.en).toContain(REPLACE_RULE.en);
    // Never the old advice to type it with no condition.
    for (const text of allText("en")) {
      expect(text).not.toMatch(/may then ask “Type the web address[^”]*”: type your web address/);
    }
  });

  it("names the Ubuntu versions the restore command accepts, and no other (item 11)", () => {
    const oldest = Number(BOOTSTRAP.match(/\[ "\$\{major:-0\}" -ge (\d+) \]/)?.[1]);
    expect(oldest).toBeGreaterThanOrEqual(20);
    const pictures = read("src/modules/backups/restore-guide-pictures.ts");
    const named = [...allText("en"), ...allText("bn"), pictures, ...Object.values(SCREENSHOT_SLOTS)]
      .flatMap((text) => [...text.matchAll(/(?:Ubuntu|ubuntu)[ -](?:Server )?(\d\d)[._](?:04)/g)])
      .map((m) => Number(m[1]));
    expect(named.length).toBeGreaterThan(3);
    for (const version of named) expect(version).toBeGreaterThanOrEqual(oldest);
    // The oldest the command accepts is named as such where the image is chosen and in R02.
    expect(step("A6").tip!.en).toContain(`Ubuntu Server ${oldest}.04 LTS`);
    expect(GUIDE_ERRORS.find((e) => e.code === "R02")!.meaning.en).toContain(
      `older than ${oldest}.04`,
    );
    // The image the command asks for (R02) is the one step A6 chooses.
    const chosen = quotedLabels(step("A6").text.en)[1]!;
    const asked = BOOTSTRAP.match(
      /fail R02 "[^"]*Make the VM with (Ubuntu Server [\d.]+ LTS)/,
    )?.[1];
    expect(asked).toBeTruthy();
    expect(chosen.startsWith(asked!)).toBe(true);
  });

  it("uses Google's own words for an app it has not checked (item 11)", () => {
    const d5 = step("D5");
    expect(quotedLabels(d5.text.en)).toEqual(
      expect.arrayContaining([
        "Google hasn't verified this app",
        "Advanced",
        "Go to Extas ERP (unsafe)",
      ]),
    );
    expect(d5.text.en.indexOf("“Advanced”")).toBeLessThan(
      d5.text.en.indexOf("“Go to Extas ERP (unsafe)”"),
    );
    expect(OTHER_MESSAGES.map((m) => m.shown)).toContain("Google hasn't verified this app");
    for (const text of allText("en")) {
      expect(text).not.toMatch(/hasn't verified this app” shows, tap “Continue”/);
    }
    // The drawing shows the same words.
    const pictures = read("src/modules/backups/restore-guide-pictures.ts");
    for (const words of [
      "Google hasn't verified this app",
      '"Advanced"',
      "Go to Extas ERP (unsafe)",
    ]) {
      expect(pictures).toContain(words);
    }
  });

  it("has no step that needs a technical helper (item 11)", () => {
    for (const st of STEPS) {
      for (const text of [st.text, ...(st.tip ? [st.tip] : [])]) {
        expect(text.en, st.id).not.toMatch(/whoever looks after|helper|developer|technician/i);
      }
    }
    // F5 asks nothing: new versions install by themselves (self-update.sh), with no keys.
    const f5 = step("F5");
    expect(f5.text.en).toMatch(/Nothing to do here/);
    expect(f5.text.en).not.toMatch(/setup-auto-deploy|Secrets and variables/);
    expect(read("deploy/lib.sh")).toContain("/etc/cron.d/extras-erp-self-update");
    expect(read(".github/workflows/deploy.yml")).toContain("vars.DEPLOY_OVER_SSH == 'true'");
    // The older SSH way still needs a server signed in to with a key, which is how part A makes it.
    expect(read("deploy/setup-auto-deploy.sh")).toMatch(/still accepts passwords over SSH/);
    expect(quotedLabels(step("A8").text.en)).toEqual(
      expect.arrayContaining(["SSH public key", "Generate new key pair"]),
    );
    expect(allText("en").join("\n")).not.toMatch(/“Authentication type”, choose “Password”/);
  });

  it("explains WinSCP step by step, and only where GitHub cannot be reached (item 11)", () => {
    const where = [
      ...STEPS.flatMap((st) => [st.text.en, st.tip?.en ?? ""]),
      ...GUIDE_ERRORS.flatMap((e) => [e.meaning.en, e.todo.en]),
      ...OTHER_MESSAGES.map((m) => m.todo.en),
    ];
    for (const text of where) expect(text).not.toMatch(/WinSCP/);
    expect(NO_GITHUB_PART.intro.en).toMatch(/WinSCP, a free program/);
    const steps = NO_GITHUB_PART.steps.map((t) => t.en).join("\n");
    for (const words of [
      "winscp.net",
      "“Login”",
      "“Private key file”",
      "Drag restore.sh and restore-tool.py",
    ]) {
      expect(steps).toContain(words);
    }
    // R06 and the 404 send the owner to that part by its title.
    const notFound = OTHER_MESSAGES.find((m) => m.shown.startsWith("curl: (22)"))!;
    for (const text of [GUIDE_ERRORS.find((e) => e.code === "R06")!.todo, notFound.todo]) {
      expect(text.en).toContain(`“${NO_GITHUB_PART.title.en}”`);
      expect(text.bn).toContain(`“${NO_GITHUB_PART.title.bn}”`);
    }
    // Its command is the one command without the line that downloads from GitHub.
    const lines = [
      "c=abc &&",
      "curl -fsSL https://x/bootstrap.sh -o restore.sh &&",
      'echo "x restore.sh" | sha256sum -c &&',
      "sudo bash restore.sh $c",
    ];
    expect(noGithubCommandLines(lines)).toEqual([lines[0], lines[2], lines[3]]);
    expect(noGithubCommandLines(null)).toBeNull();
  });

  it("has a short owner's drill that never touches the real web address (item 12)", () => {
    const en = [DRILL_PART.intro, ...DRILL_PART.steps].map((t) => t.en).join("\n");
    expect(en).toMatch(/never touches the DNS of your real web address/);
    expect(en).toMatch(
      /sends no emails or bot messages, makes no Google Drive backups and runs no jobs/,
    );
    expect(en).toContain("--drill");
    expect(en).toMatch(/Never the real ERP's or the demo site's address/);
    expect(en).toMatch(/A drill copy never takes updates/);
    expect(en).toMatch(/open only the extas-drill resource group/);
    // The drill command is the one command with --drill at its end.
    expect(drillCommandLines(["c=abc &&", "sudo bash restore.sh $c"])).toEqual([
      "c=abc &&",
      "sudo bash restore.sh $c --drill",
    ]);
    expect(drillCommandLines(null)).toBeNull();
    // What the drill steps quote from the restore command and the ERP is really there.
    const app = [
      read("src/components/settings/backups-screen.tsx"),
      read("src/modules/backups/standby.ts"),
    ].join("\n");
    const quoted = DRILL_PART.steps.flatMap((t) => quotedLabels(t.en));
    for (const label of ["Record a drill", "Record", "Last new-server drill"]) {
      expect(quoted).toContain(label);
      expect(app).toContain(label);
    }
    expect(quoted).toContain("Restore drill copy (test mode)");
    expect(app).toContain("Restore drill copy (test mode)");
    expect(BOOTSTRAP).toContain("Test web address for this drill");
    expect(BOOTSTRAP).toContain("Restore drill finished in");
    for (const t of DRILL_PART.steps) {
      expect(quotedLabels(t.bn).sort()).toEqual(quotedLabels(t.en).sort());
    }
  });

  it("has a screenshot slot for every picture, and only known screenshots in its folder (item 11)", () => {
    for (const picture of PICTURES) {
      expect(SCREENSHOT_SLOTS[picture], picture).toBeTruthy();
      expect(quotedLabels(SCREENSHOT_SLOTS[picture]).length, picture).toBeGreaterThan(0);
    }
    const folder = path.join(process.cwd(), "public", "restore-guide");
    if (existsSync(folder)) {
      for (const file of readdirSync(folder)) {
        expect(
          PICTURES.map((p) => `${p}.png`),
          file,
        ).toContain(file);
      }
    }
  });
});

describe("the guide and the restore command's own words (v6.4.1 restore)", () => {
  const step = (id: string) => GUIDE_PARTS.flatMap((p) => p.steps).find((s) => s.id === id)!;
  const error = (code: string) => GUIDE_ERRORS.find((e) => e.code === code)!;
  const quoted = (text: string) => [...text.matchAll(/“([^”]+)”/g)].map((m) => m[1]!);

  it("explains the backup list as the command marks it (D6)", () => {
    const d6 = [step("D6").text, step("D6").tip!];
    for (const label of [
      "(newest checked: Enter picks it)",
      "(NOT checked in Drive: it may be incomplete)",
      "(made by a copy on standby)",
      "None of these backups passed its check in Google Drive",
    ]) {
      expect(TOOL, label).toContain(label);
      for (const lang of ["en", "bn"] as const) {
        expect(d6.map((t) => t[lang]).join(" "), `${lang}: ${label}`).toContain(`“${label}`);
      }
    }
  });

  it("asks for the web address only after the backup is back, and says so (D8, E1)", () => {
    const code = CODE_ONLY(BOOTSTRAP);
    expect(code.indexOf('step "Restoring the database and the files"')).toBeGreaterThan(0);
    expect(code.indexOf('step "Pointing the web address at this server"')).toBeGreaterThan(
      code.indexOf('step "Restoring the database and the files"'),
    );
    expect(step("D8").text.en).toMatch(/after the backup is back/);
    expect(step("E1").text.en).toMatch(/“To point \.\.\. to this server”/);
    // On standby its backups and alarms run; the old wording is gone everywhere.
    const all = [...allText("en")].join("\n");
    expect(all).not.toMatch(/makes no backups and sends no reminders|it makes no backups/);
    expect(error("W10").meaning.en).toMatch(/backups and alarms run/);
  });

  it("says that pasting the same command again goes on where it stopped (E1)", () => {
    const tip = step("E1").tip!;
    expect(TOOL).toContain("already downloaded in the earlier try");
    expect(tip.en).toContain("already downloaded in the earlier try");
    expect(tip.bn).toContain("already downloaded in the earlier try");
    expect(tip.en).toMatch(/paste the same command again/);
    // v6.4.2: the Google sign-in never stays on the server, so a new code is asked.
    expect(tip.en).not.toContain("no new code needed");
    expect(tip.en).toMatch(/Google asks for a new code/);
    expect(tip.en).toMatch(/as soon as the VM starts again/);
  });

  it("says W05 for the screens before W13 points to it, and setup-auto-deploy only once live (v6.4.1 review 2)", () => {
    const code = CODE_ONLY(BOOTSTRAP);
    const screens = code.indexOf(
      'warn W05 "the check after the restore found $screen_problems problem(s)',
    );
    expect(screens).toBeGreaterThan(0);
    expect(screens).toBeLessThan(code.indexOf("warn W13 "));
    expect(error("W13").todo.en).toMatch(/lines just above \(like R20 or W05\)/);
    // On standby, GitHub's updates come after go-live.sh; the script refuses before.
    expect(code).toMatch(
      /if \[ -z "\$drill" \] && \[ "\$standby" = 1 \]; then\n\s*note "New versions from GitHub install by themselves once this ERP is live \(go-live\.sh, step F6\)/,
    );
    expect(code).toMatch(
      /elif \[ -z "\$drill" \]; then\n\s*note "New versions from GitHub install by themselves \(step F5\)/,
    );
    const autoDeploy = read("deploy/setup-auto-deploy.sh");
    expect(autoDeploy).toMatch(
      /\[ ! -f "\$DATA_DIR\/backups\/\.standby" \] \|\|\n\s*die "this ERP is on standby after a restore/,
    );
    expect(step("F5").tip!.en).toMatch(/do F6 first \(go-live\.sh\)/);
  });

  it("explains every new message with what to do (R05, R19, R22, W02, W10, W11)", () => {
    expect(SCRIPTS).toContain("did not finish in 30 minutes. Restart the VM in Azure");
    expect(error("R05").todo.en).toMatch(/30 minutes.*Restart/);
    expect(SCRIPTS).toContain("it goes on with the backup already downloaded");
    expect(error("R19").todo.en).toMatch(/goes on with the backup already downloaded/);
    expect(error("R19").meaning.en).toMatch(/as it was before the restore/);
    expect(error("R22").todo.en).toMatch(/64 GB/);
    expect(error("W02").meaning.en).toMatch(/the lines above say why/);
    expect(error("W10").todo.en).toMatch(/does not point to this server yet/);
    expect(error("W11").shown).toBe("the records were NOT checked");
    expect(error("W11").todo.en).toMatch(/main screens/);
    // Each message the command prints at the end is in the guide, as printed.
    for (const shown of [
      "Finished in ..., but NOT everything is right",
      "THIS ERP IS ON STANDBY",
      "stopped: ... does not point to this server yet",
      // An earlier restore cut off half-way, settled at the start of this one (v6.4.1 review 3).
      "A restore was cut off before it finished",
      // Its ERP did not start, said loudly (v6.4.1 review 4).
      "PROBLEM: the ERP is NOT running",
    ]) {
      const message = OTHER_MESSAGES.find((m) => m.shown === shown);
      expect(message, shown).toBeDefined();
      for (const part of shown.split("...")) expect(SCRIPTS, shown).toContain(part.trim());
    }
    // Words in curly quotes there are the command's own.
    for (const text of [error("W11").todo.en, step("D6").tip!.en]) {
      for (const words of quoted(text))
        expect(SCRIPTS + GUIDE_STEP_IDS.join(" "), words).toContain(words.split("...")[0]!.trim());
    }
  });
});
