import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  drillCommandLines,
  keyedCommandLines,
  noGithubCommandLines,
} from "@/modules/backups/restore-guide";

/*
 * The owner's decision (2026-10-30): the one command in the guide in Google
 * Drive carries the Google client and the recovery key, so nothing is typed in
 * PuTTY. They go in on the command's input (bootstrap.sh --keys), never as its
 * words. Here the real bootstrap.sh reads them (--read-keys, its test mode),
 * from the command as a PDF viewer copies it: line by line, or all on one line.
 */

const exec = promisify(execFile);
const BOOTSTRAP = path.join(process.cwd(), "deploy", "bootstrap.sh");
const BASE = [
  "c=0123456789abcdef0123456789abcdef01234567 &&",
  "curl -fsSL https://raw.githubusercontent.com/mehadih32/Extas-ERP/$c/deploy/bootstrap.sh -o restore.sh &&",
  'echo "abc restore.sh" | sha256sum -c &&',
  "sudo bash restore.sh $c",
];
const KEYS = {
  clientId: "1234-abc.apps.googleusercontent.com",
  clientSecret: "GOCSPX-secret_value-1234",
  recoveryKey: "আমার key = blue river 42",
};

describe("the one command with the keys inside", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "extas-keys-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** The command's end, run with bash as pasted, the script swapped for --read-keys. */
  async function paste(lines: string[], joiner: string) {
    const start = lines.findIndex((line) => line.startsWith("sudo bash restore.sh"));
    const tail = lines
      .slice(start)
      .join(joiner)
      .replace("sudo bash restore.sh $c --keys", `bash ${BOOTSTRAP} --read-keys ${dir}`);
    return exec("bash", ["-c", tail]);
  }

  it("keeps the command's own lines, out of the history, and seals the keys at its end", () => {
    const lines = keyedCommandLines(BASE, KEYS)!;
    expect(lines[0]).toBe(`unset HISTFILE && ${BASE[0]}`);
    expect(lines.slice(1, 3)).toEqual(BASE.slice(1, 3));
    expect(lines[3]).toBe("sudo bash restore.sh $c --keys <<< '");
    expect(lines.at(-1)!.endsWith("'")).toBe(true);
    // Nothing secret is readable in it.
    const text = lines.join("\n");
    for (const secret of [KEYS.clientId, KEYS.clientSecret, KEYS.recoveryKey])
      expect(text).not.toContain(secret);
    for (const line of lines.slice(4)) expect(line.length).toBeLessThanOrEqual(65);
    expect(keyedCommandLines(null, KEYS)).toBeNull();
  });

  for (const [how, joiner] of [
    ["line by line", "\n"],
    ["on one line", " "],
  ] as const) {
    it(`gives the restore its answers when copied ${how}`, async () => {
      const { stdout } = await paste(keyedCommandLines(BASE, KEYS)!, joiner);
      expect(stdout.trim()).toBe(`KEYS ${dir}/answers`);
      const answers = await readFile(path.join(dir, "answers"), "utf8");
      expect(answers).toBe(
        [
          `google_client_id=${KEYS.clientId}`,
          `google_client_secret=${KEYS.clientSecret}`,
          `recovery_key=${KEYS.recoveryKey}`,
          "pick=",
          "",
        ].join("\n"),
      );
      // Readable by its owner only, as the restore tool demands.
      expect((await stat(path.join(dir, "answers"))).mode & 0o077).toBe(0);
    });
  }

  it("leaves the key out when the owner does not keep it in Drive", async () => {
    await paste(keyedCommandLines(BASE, { ...KEYS, recoveryKey: null })!, "\n");
    const answers = await readFile(path.join(dir, "answers"), "utf8");
    expect(answers).not.toContain("recovery_key=");
    expect(answers).toContain("google_client_secret=");
  });

  it("stops with R32 and keeps nothing when part of the keys was not copied", async () => {
    const lines = keyedCommandLines(BASE, KEYS)!;
    const cut = [...lines.slice(0, 5), "'"];
    const failed = await paste(cut, "\n").then(
      () => null,
      (error: { code: number; stderr: string }) => error,
    );
    expect(failed?.code).toBe(2);
    expect(failed?.stderr).toContain("Error R32");
    await expect(stat(path.join(dir, "answers"))).rejects.toThrow();
  });

  it("works for the drill and without GitHub too", () => {
    const lines = keyedCommandLines(BASE, KEYS)!;
    expect(drillCommandLines(lines)!.at(-1)).toMatch(/' --drill$/);
    expect(noGithubCommandLines(lines)!.some((line) => line.startsWith("curl "))).toBe(false);
    expect(noGithubCommandLines(lines)!.length).toBe(lines.length - 1);
  });

  it("parses as one bash command, with --domain added at its end", async () => {
    const text = `${keyedCommandLines(BASE, KEYS)!.join("\n")} --domain erp.newcompany.com`;
    await expect(exec("bash", ["-n", "-c", text])).resolves.toBeDefined();
  });
});
