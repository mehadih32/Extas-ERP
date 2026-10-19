import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/*
 * The Android app's workflow (.github/workflows/android.yml, v6.4.2): the
 * app-signing secrets reach only a run on the main branch, never a pull request
 * run. They are kept in the "android-signing" environment, which the owner lets
 * only main use (deploy/README.md, "The Android app"), so a pull request that
 * changes the workflow itself still cannot read them.
 */

const workflow = readFileSync(path.join(".github", "workflows", "android.yml"), "utf8");

/** The text of one job, from its name line to the next job (or the end). */
function job(name: string): string {
  const jobs = workflow.slice(workflow.indexOf("\njobs:\n"));
  const start = jobs.indexOf(`\n  ${name}:\n`);
  expect(start, `job ${name}`).toBeGreaterThan(-1);
  const rest = jobs.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("the Android app's signing secrets (v6.4.2)", () => {
  it("never go to a job that runs for pull requests", () => {
    expect(workflow).toMatch(/\non:\n {2}pull_request:/);
    const build = job("build");
    expect(build).not.toMatch(/\$\{\{[^}]*secrets\./);
    expect(build).not.toMatch(/^\s+if:/m);
    // Outside the jobs too: no secret in the workflow's own env.
    expect(workflow.slice(0, workflow.indexOf("\njobs:\n"))).not.toMatch(/\$\{\{[^}]*secrets\./);
  });

  it("go only to the release job, on the main branch, from the android-signing environment", () => {
    const release = job("release");
    expect(release).toMatch(
      /\n {4}if: github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'\n/,
    );
    expect(release).toMatch(/\n {4}environment: android-signing\n/);
    expect(release).toMatch(/\n {4}needs: build\n/);
    const names = [...workflow.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/g)].map((m) => m[1]);
    expect(new Set(names)).toEqual(
      new Set([
        "ANDROID_KEYSTORE_BASE64",
        "ANDROID_KEYSTORE_PASSWORD",
        "ANDROID_KEY_ALIAS",
        "ANDROID_KEY_PASSWORD",
      ]),
    );
    expect(release.match(/\$\{\{ secrets\./g)).toHaveLength(names.length);
    // The key file is never kept: written for the build and deleted after it.
    expect(release).toMatch(/base64 -d > "\$RUNNER_TEMP\/extas-erp\.jks"/);
    expect(release).toMatch(/rm -f "\$RUNNER_TEMP\/extas-erp\.jks"/);
  });

  it("are set up in the environment as the owner's steps say", () => {
    const readme = readFileSync(path.join("deploy", "README.md"), "utf8");
    const part = readme.slice(readme.indexOf("## The Android app"));
    expect(part).toMatch(/android-signing/);
    expect(part).toMatch(/Deployment branches and\s+tags/);
    expect(part).toMatch(/delete the four repository\s+secrets/i);
  });
});
