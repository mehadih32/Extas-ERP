import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inTerminal } from "../fixtures/terminal";

/*
 * A6: before anything changes, the one restore command looks for an Extas ERP
 * already on the server: a running one (Docker's extras-erp project), its
 * program folder (deploy/compose.yml) and its data (deploy.sh's mark, or a
 * database folder), in any of the usual folders. `bootstrap.sh --find` only
 * reports what it finds: program folder|data folder|web address|running|has
 * data. The restore then stops unless the owner types the web address of an ERP
 * that runs or has data; one that stopped half-way is simply finished. Run here
 * on made-up folders, with a stand-in for docker.
 */

const exec = promisify(execFile);
const BOOTSTRAP = path.join(process.cwd(), "deploy", "bootstrap.sh");

describe("finding an Extas ERP already on the server (A6)", () => {
  let root: string;
  let bin: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "extas-find-"));
    bin = path.join(root, "bin");
    await mkdir(bin);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function put(file: string, text = "") {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }

  /** A stand-in for docker: `docker ps` lists the given compose working folders. */
  async function docker(running: string[]) {
    const lines = running.map((dir) => `echo '${path.join(root, dir)}'`).join("\n");
    await writeFile(path.join(bin, "docker"), `#!/bin/sh\n[ "$1" = ps ] || exit 1\n${lines}\n`);
    await chmod(path.join(bin, "docker"), 0o755);
  }

  async function find(roots: string[]) {
    const { stdout } = await exec("bash", [BOOTSTRAP, "--find"], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        EXTAS_SEARCH_ROOTS: roots.map((r) => path.join(root, r)).join(" "),
      },
    });
    return stdout.trim().split("\n").filter(Boolean);
  }

  it("finds the program folder, its data and whether it runs, anywhere it is kept", async () => {
    await put("opt/extras-erp/deploy/compose.yml", "name: extras-erp\nservices: {}\n");
    await put(
      "opt/extras-erp/deploy/.env",
      `APP_DOMAIN=erp.example.com\nDATA_DIR=${path.join(root, "data/erp")}\n`,
    );
    await put("data/erp/postgres/PG_VERSION", "16\n");
    await put("data/erp/demo/postgres/PG_VERSION", "16\n");
    await put("data/erp/.extas-erp-data", "APP_DOMAIN=erp.example.com\n");
    // Data with no program folder (an earlier ERP), found by deploy.sh's mark.
    await put("mnt/disk/old-erp/.extas-erp-data", "APP_DOMAIN=old.example.com\n");
    // Another project's compose file is not an ERP.
    await put("home/u/shop/deploy/compose.yml", "name: shop\n");
    await docker(["opt/extras-erp/deploy"]);

    expect(await find(["opt", "data", "mnt", "home"])).toEqual([
      `${path.join(root, "opt/extras-erp")}|${path.join(root, "data/erp")}|erp.example.com|yes|yes`,
      `|${path.join(root, "mnt/disk/old-erp")}|old.example.com||yes`,
    ]);
  });

  it("finds a database folder without a mark, and nothing on a new server", async () => {
    await docker([]);
    expect(await find(["opt", "srv"])).toEqual([]);
    await put("srv/extras-erp/postgres/PG_VERSION", "16\n");
    expect(await find(["opt", "srv"])).toEqual([`|${path.join(root, "srv/extras-erp")}|||yes`]);
  });

  it("tells a restore that stopped half-way (no data, not running) from an ERP with data", async () => {
    await docker([]);
    // The code put in place, then the connection dropped: nothing to lose there.
    await put("srv/apps/erp/deploy/compose.yml", "name: extras-erp\n");
    expect(await find(["srv"])).toEqual([`${path.join(root, "srv/apps/erp")}||||`]);
    // Settings written, data folder not made yet: still nothing to lose.
    await put(
      "srv/apps/erp/deploy/.env",
      `APP_DOMAIN=erp.example.com\nDATA_DIR=${path.join(root, "srv/erp-data")}\n`,
    );
    expect(await find(["srv"])).toEqual([
      `${path.join(root, "srv/apps/erp")}|${path.join(root, "srv/erp-data")}|erp.example.com||`,
    ]);
    // Once the database is there, replacing it needs the web address typed.
    await put("srv/erp-data/postgres/PG_VERSION", "16\n");
    expect(await find(["srv"])).toEqual([
      `${path.join(root, "srv/apps/erp")}|${path.join(root, "srv/erp-data")}|erp.example.com||yes`,
    ]);
  });
  /** `bootstrap.sh --choose`: the A6 decision, with the address typed from an answers file. */
  async function choose(roots: string[], typed: string) {
    const answers = path.join(root, "answers.env");
    await writeFile(answers, `replace=${typed}\n`);
    return exec("bash", [BOOTSTRAP, "--choose"], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        EXTAS_SEARCH_ROOTS: roots.map((r) => path.join(root, r)).join(" "),
        RESTORE_ANSWERS: answers,
      },
    }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({
        code: Number(error.code ?? 1),
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      }),
    );
  }

  it("stops unless the web address of the ERP here is typed, and never restores over data without its program (G6)", async () => {
    await docker(["opt/extras-erp/deploy"]);
    const settings = `APP_DOMAIN=erp.example.com\nDATA_DIR=${path.join(root, "data/erp")}\nENCRYPTION_KEY=this-servers-own-key-0123456789\n`;
    await put("opt/extras-erp/deploy/compose.yml", "name: extras-erp\nservices: {}\n");
    await put("opt/extras-erp/deploy/.env", settings);
    await put("data/erp/postgres/PG_VERSION", "16\n");

    // Another address, or Enter: R04, nothing changed.
    for (const typed of ["demo.example.com", ""]) {
      const wrong = await choose(["opt", "data"], typed);
      expect(wrong.code).toBe(2);
      expect(wrong.stderr).toContain("Error R04");
      expect(wrong.stdout).not.toContain("CHOSEN");
    }

    // The right one (as typed in a browser): the restore goes on over this ERP.
    const right = await choose(["opt", "data"], "HTTPS://Erp.Example.com/");
    expect(right.code).toBe(0);
    expect(right.stdout).toContain(
      `CHOSEN ${path.join(root, "opt/extras-erp")}|${path.join(root, "data/erp")}`,
    );
    // ... and keeps this server's own ENCRYPTION_KEY: the backup's goes beside it.
    const work = path.join(root, "work");
    await mkdir(work);
    await writeFile(
      path.join(work, "server.json"),
      JSON.stringify({ encryptionKey: "the-backups-key-0123456789" }),
    );
    await writeFile(path.join(work, "settings.env"), "ENCRYPTION_KEY=the-backups-key-0123456789\n");
    const env = path.join(root, "opt/extras-erp/deploy/.env");
    await exec("python3", [
      "-I",
      path.join(process.cwd(), "deploy", "restore-tool.py"),
      "env",
      "--work",
      work,
      "--env",
      env,
    ]);
    const kept = await readFile(env, "utf8");
    expect(kept).toContain("ENCRYPTION_KEY=this-servers-own-key-0123456789\n");
    expect(kept).toContain("ENCRYPTION_OLD_KEYS=the-backups-key-0123456789\n");

    // Data with no program folder and settings: R29, even with its address typed.
    await put("mnt/disk/old-erp/.extas-erp-data", "APP_DOMAIN=old.example.com\n");
    const orphan = await choose(["mnt"], "old.example.com");
    expect(orphan.code).toBe(2);
    expect(orphan.stderr).toContain("Error R29");
    expect(orphan.stdout).not.toContain("CHOSEN");
  });

  it("never takes a key pressed earlier as the answer: an Enter typed before the question is dropped", async () => {
    await docker(["opt/extras-erp/deploy"]);
    await put("opt/extras-erp/deploy/compose.yml", "name: extras-erp\nservices: {}\n");
    await put(
      "opt/extras-erp/deploy/.env",
      `APP_DOMAIN=erp.example.com\nDATA_DIR=${path.join(root, "data/erp")}\n`,
    );
    await put("data/erp/postgres/PG_VERSION", "16\n");
    const run = await inTerminal(["bash", BOOTSTRAP, "--choose"], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        EXTAS_SEARCH_ROOTS: ["opt", "data"].map((r) => path.join(root, r)).join(" "),
        RESTORE_ANSWERS: "",
      },
      // Pressed while the restore was working: it must not answer "press Enter to stop".
      early: "\r",
      replies: [["Type the web address of the ERP on this server", "erp.example.com"]],
    });
    expect(run.screen).not.toContain("Error R04");
    expect(run.screen).toContain(`CHOSEN ${path.join(root, "opt/extras-erp")}`);
    expect(run.code).toBe(0);
  });

  it("goes on by itself on a new server, or over a restore that stopped half-way", async () => {
    await docker([]);
    const fresh = await choose(["opt", "srv"], "");
    expect(fresh).toMatchObject({ code: 0 });
    expect(fresh.stdout).toContain("CHOSEN /opt/extras-erp|/srv/extras-erp");
    await put("srv/apps/erp/deploy/compose.yml", "name: extras-erp\n");
    expect((await choose(["srv"], "")).code).toBe(0);
  });
});

describe("the restore tool without GitHub (G17)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "extas-tool-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** restore.sh as the owner saved it, with or without restore-tool.py beside it. */
  async function saved(tool: string | null) {
    await writeFile(path.join(root, "restore.sh"), await readFile(BOOTSTRAP));
    if (tool !== null) await writeFile(path.join(root, "restore-tool.py"), tool);
    else await rm(path.join(root, "restore-tool.py"), { force: true });
    const out = path.join(root, "work");
    await mkdir(out, { recursive: true });
    return exec("bash", [path.join(root, "restore.sh"), "--tool", out], {
      // GitHub cannot be reached.
      env: { ...process.env, EXTAS_RAW_BASE: "http://127.0.0.1:9" },
    }).then(
      ({ stdout }) => ({ code: 0, stdout, stderr: "", out }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({
        code: Number(error.code ?? 1),
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        out,
      }),
    );
  }

  it("uses the copy beside restore.sh (from the Drive folder) when it is the right one", async () => {
    const real = await readFile(path.join(process.cwd(), "deploy", "restore-tool.py"), "utf8");
    const used = await saved(real);
    expect(used.code).toBe(0);
    expect(used.stdout).toContain("the restore tool beside this script");
    expect(await readFile(path.join(used.out, "restore-tool.py"), "utf8")).toBe(real);
  });

  it("never uses a changed copy, and says R06 when GitHub cannot be reached either", async () => {
    const changed = await saved("print('not the tool')\n");
    expect(changed.code).toBe(2);
    expect(changed.stderr).toContain("Error R06");
    const none = await saved(null);
    expect(none.stderr).toContain("Error R06");
  });
});
