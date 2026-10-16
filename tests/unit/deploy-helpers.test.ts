import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * Small pieces of deploy/lib.sh, run for real in bash with stand-in folders
 * (never the server's own paths): what a restore or an update decides.
 */

type Run = { code: number; stdout: string; stderr: string };

/** Runs a few lines of bash after loading deploy/lib.sh. */
function withLib(script: string, options: { env?: NodeJS.ProcessEnv; input?: string } = {}) {
  return new Promise<Run>((resolve) => {
    const child = execFile(
      "bash",
      ["-c", `source "${path.join(process.cwd(), "deploy", "lib.sh")}"\n${script}`],
      { env: { ...process.env, ...options.env }, timeout: 60_000 },
      (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
    child.stdin!.end(options.input ?? "");
  });
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "extas-deploy-helpers-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("counting the problems the check after a restore found (G10)", () => {
  const output = [
    "",
    "==> Opened 151 of 152 screens without an error",
    "==> Problem: Screen /production/bookings answered 500",
    "==> Booking (landscape) printed",
    "==> Invoice: nothing to print yet",
    "==> Problem: Payslip did not answer (timeout)",
    "==> Bot PINs: 3 hidden, every one typed after the bot asked for the PIN",
    "==> The check found 2 problem(s): /production/bookings, Payslip",
  ].join("\n");

  it("counts only the lines marked as a problem, never the notes around them", async () => {
    const done = await withLib("check_problems", { input: output });
    expect(done).toMatchObject({ code: 0, stdout: "2\n" });
    const none = await withLib("check_problems", {
      input: "==> Opened 5 of 5 screens without an error\n==> Bot PINs: not counted (x)\n",
    });
    expect(none.stdout).toBe("0\n");
  });

  it("is what restore.sh counts, and check-update.ts marks every failure that way", () => {
    const restore = readFileSync(path.join("deploy", "restore.sh"), "utf8");
    expect(restore).toMatch(/count="\$\(check_problems <<<"\$check_output"\)"/);
    expect(restore).not.toMatch(/grep -v -e '\^Opened '/);
    // The Backups screen lists the problems themselves, without the mark.
    expect(restore).toMatch(
      /problems="\$\(sed -n 's\/\^==> Problem: \/\/p' <<<"\$check_output"\)"/,
    );
    const check = readFileSync(path.join("scripts", "check-update.ts"), "utf8");
    expect(check).toMatch(/const problem = \(text: string\) => say\(`Problem: \$\{text\}`\)/);
    const pushes = check.match(/failed\.push\([^)]*\);\s*\n\s*(\w+)\(/g) ?? [];
    expect(pushes.length).toBeGreaterThanOrEqual(4);
    for (const push of pushes) expect(push).toMatch(/problem\($/);
    expect(check).toMatch(/problem\(`The check could not run/);
  });
});
