import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});
