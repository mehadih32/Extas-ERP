import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * v6.4 (G1): deploy/bug-guard.sh --after-restore, which the restore command
 * (bootstrap.sh) runs once the restored ERP is up. Its waiting and printing
 * (run_bug_guard in deploy/lib.sh) run for real in bash, with a stand-in for
 * the ERP that answers the request the way src/modules/bug-guard/after-restore.ts does.
 */

type Run = { code: number; stdout: string; stderr: string };

function withLib(script: string) {
  return new Promise<Run>((resolve) => {
    const child = execFile(
      "bash",
      ["-c", `source "${path.join(process.cwd(), "deploy", "lib.sh")}"\n${script}`],
      { timeout: 60_000 },
      (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
    child.stdin!.end("");
  });
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "extas-bug-guard-script-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The ERP's answer: takes the request and writes a result for it (python, as JSON). */
const erpAnswers = (companies: unknown[], ok: boolean, requestedAt = "") => `
APP_UID=$(id -u)
BUG_GUARD_POLL=0.2
(
  until [ -f "${dir}/bug-guard-request.json" ]; do sleep 0.1; done
  python3 - "${dir}" '${JSON.stringify(companies)}' '${ok ? "true" : "false"}' '${requestedAt}' <<'PY'
import json, os, sys
d = sys.argv[1]
asked = json.load(open(os.path.join(d, "bug-guard-request.json")))
os.remove(os.path.join(d, "bug-guard-request.json"))
json.dump({"requestedAt": sys.argv[4] or asked["requestedAt"], "finishedAt": "x",
           "ok": sys.argv[3] == "true", "companies": json.loads(sys.argv[2])},
          open(os.path.join(d, "bug-guard-result.json"), "w"))
PY
) &
`;

const clean = { status: "DONE", urgent: 0, important: 0, later: 2, failedChecks: 0 };

describe("Bug Guard after a restore (G1)", () => {
  it("asks the ERP, waits for its answer and prints what it found", async () => {
    const done = await withLib(
      `${erpAnswers([{ name: "Extas", ...clean }], true)}\ncode=0; run_bug_guard "${dir}" 20 || code=$?; echo "exit $code"`,
    );
    expect(done.stdout).toContain("exit 0");
    expect(done.stdout).toContain("Bug Guard ran on 1 company: nothing urgent or important");
    expect(done.stdout).toContain("Extas: 0 urgent, 0 important, 2 can wait");
    expect(existsSync(path.join(dir, "bug-guard-request.json"))).toBe(false);
  });

  it("exits 1 when something urgent or important was found", async () => {
    const done = await withLib(
      `${erpAnswers(
        [
          { name: "Extas", ...clean, urgent: 1, important: 2 },
          { name: "Extras Kids", ...clean },
        ],
        true,
      )}\ncode=0; run_bug_guard "${dir}" 20 || code=$?; echo "exit $code"`,
    );
    expect(done.stdout).toContain("exit 1");
    expect(done.stdout).toContain("Extas: 1 urgent, 2 important, 2 can wait");
    expect(done.stdout).toContain("in the ERP's inbox and on Telegram");
  });

  it("exits 2 when a company could not be checked, or the ERP does not answer", async () => {
    const partly = await withLib(
      `${erpAnswers(
        [{ name: "Extas", ...clean, status: "NOT_RUN", note: "Bug Guard is checking already" }],
        false,
      )}\ncode=0; run_bug_guard "${dir}" 20 || code=$?; echo "exit $code"`,
    );
    expect(partly.stdout).toContain("exit 2");
    expect(partly.stdout).toContain("Extas: not checked (Bug Guard is checking already)");

    // An answer to another request is not this one's.
    const stale = await withLib(
      `${erpAnswers([{ name: "Extas", ...clean }], true, "2020-01-01T00:00:00Z")}
code=0; run_bug_guard "${dir}" 2 || code=$?; echo "exit $code"`,
    );
    expect(stale.stdout).toContain("exit 2");

    const silent = await withLib(
      `APP_UID=$(id -u)\nBUG_GUARD_POLL=0.2\ncode=0; run_bug_guard "${dir}" 1 || code=$?; echo "exit $code"`,
    );
    expect(silent.stdout).toContain("exit 2");
    expect(silent.stdout).toContain("Bug Guard did not answer");
    // The request is taken back, so it does not run later by surprise.
    expect(existsSync(path.join(dir, "bug-guard-request.json"))).toBe(false);
  });

  it("is what the restore command runs, and what the restore log says", () => {
    const script = readFileSync(path.join("deploy", "bug-guard.sh"), "utf8");
    expect(script).toMatch(/run_bug_guard "\$DATA_DIR\/backups"/);
    const bootstrap = readFileSync(path.join("deploy", "bootstrap.sh"), "utf8");
    expect(bootstrap).toMatch(/"\$DIR\/deploy\/bug-guard\.sh" --after-restore \|\| bug_guard=\$\?/);
    expect(bootstrap).toMatch(/checks_note="Bug Guard ran \(nothing urgent or important\)"/);
    // The ERP's clock takes the request (clock.ts).
    const clock = readFileSync(path.join("src", "modules", "bug-guard", "clock.ts"), "utf8");
    expect(clock).toMatch(/bugGuardAfterRestore\(\)/);
  });
});

describe("Bug Guard once after each update (D5)", () => {
  const request = () => path.join(dir, "bug-guard-after-deploy.json");

  it("leaves a request the ERP takes, and waits only until it is taken", async () => {
    const taken = await withLib(`APP_UID=$(id -u)
BUG_GUARD_POLL=0.1
(
  until [ -f "${dir}/bug-guard-after-deploy.json" ]; do sleep 0.05; done
  cp "${dir}/bug-guard-after-deploy.json" "${dir}/seen.json"
  rm -f "${dir}/bug-guard-after-deploy.json"
) &
code=0; ask_check_after_deploy "${dir}" 20 || code=$?; echo "exit $code"`);
    expect(taken.stdout).toContain("exit 0");
    expect(existsSync(request())).toBe(false);
    const seen = JSON.parse(readFileSync(path.join(dir, "seen.json"), "utf8")) as {
      requestedAt: string;
    };
    expect(Number.isNaN(Date.parse(seen.requestedAt))).toBe(false);
  });

  it("says when the ERP did not take it in time, and leaves it for the ERP's clock", async () => {
    const late = await withLib(
      `APP_UID=$(id -u)\nBUG_GUARD_POLL=0.2\ncode=0; ask_check_after_deploy "${dir}" 1 || code=$?; echo "exit $code"`,
    );
    expect(late.stdout).toContain("exit 1");
    expect(existsSync(request())).toBe(true);
  });

  it("runs at the end of every update, and never fails it", () => {
    const deploy = readFileSync(path.join("deploy", "deploy.sh"), "utf8");
    // Only once the new version passed its own check (check_update) and is open again.
    const asked = deploy.indexOf('ask_check_after_deploy "$DATA_DIR/backups"');
    expect(asked).toBeGreaterThan(deploy.indexOf("check_update || go_back"));
    expect(asked).toBeGreaterThan(deploy.indexOf("compose up -d caddy"));
    // Inside an "if": whatever happens, deploy.sh goes on and the update counts as done.
    expect(deploy).toMatch(/if ask_check_after_deploy "\$DATA_DIR\/backups" [^;\n]+; then/);
    expect(deploy.slice(asked)).not.toMatch(/\bdie\b|go_back/);
    // The ERP's clock takes the request (clock.ts), the same way as after a restore.
    const clock = readFileSync(path.join("src", "modules", "bug-guard", "clock.ts"), "utf8");
    expect(clock).toMatch(/bugGuardAfterDeploy\(\)/);
    const erp = readFileSync(path.join("src", "modules", "bug-guard", "after-deploy.ts"), "utf8");
    expect(erp).toMatch(/AFTER_DEPLOY_REQUEST = "bug-guard-after-deploy\.json"/);
  });
});
