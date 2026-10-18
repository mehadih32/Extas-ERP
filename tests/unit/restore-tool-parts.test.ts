import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type FakeGoogle, startFakeGoogle } from "../../scripts/fake-google";
import { inTerminal } from "../fixtures/terminal";

/*
 * Parts of deploy/restore-tool.py on their own, in Python, without a database: the
 * questions (a key pressed earlier never answers one), which backup Enter picks,
 * the disk space a restore needs, Drive's lists read to the end, and the
 * comparison after the restore (records not counted, links among the files).
 * tests/integration/restore-tool.test.ts runs the whole tool on real backups.
 */

const TOOL = path.join(process.cwd(), "deploy", "restore-tool.py");
type Ran = { code: number; stdout: string; stderr: string };

/** Runs Python with the restore tool loaded as `tool`; the script's own lines follow. */
function python(script: string, env: Record<string, string> = {}): Promise<Ran> {
  const program = `import importlib.util, json, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("restore_tool", sys.argv[1])
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)
${script}`;
  return new Promise((resolve) =>
    execFile(
      "python3",
      ["-I", "-c", program, TOOL],
      { env: { ...process.env, ...env }, timeout: 60_000 },
      (error, stdout, stderr) =>
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : -1) : 0,
          stdout,
          stderr,
        }),
    ),
  );
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "extas-restore-parts-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** An answers file, as the restore drill gives (readable by its owner only). */
async function answersFile(lines: Record<string, string>) {
  const file = path.join(dir, "answers");
  await writeFile(
    file,
    Object.entries(lines)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(""),
  );
  await chmod(file, 0o600);
  return file;
}

describe("the questions (a key pressed earlier never answers one)", () => {
  for (const hidden of [false, true]) {
    it(`drops an Enter typed before the question (${hidden ? "hidden" : "shown"} answer)`, async () => {
      const prompt = hidden
        ? "Recovery key (it stays hidden as you type): "
        : "Which backup? Press Enter for the newest, or type its number: ";
      const run = await inTerminal(
        [
          "python3",
          "-I",
          "-c",
          `import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("restore_tool", sys.argv[1])
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)
print("ANSWER=[" + tool.ask("x", ${JSON.stringify(prompt)}, hidden=${hidden ? "True" : "False"}) + "]")`,
          TOOL,
        ],
        {
          env: { RESTORE_ANSWERS: "" },
          early: "\r\r",
          replies: [[prompt.trim().slice(0, 12), "typed after the question"]],
        },
      );
      expect(run.screen).toContain("ANSWER=[typed after the question]");
      expect(run.code).toBe(0);
    });
  }
});

describe("which backup Enter picks", () => {
  const backup = (name: string, extra: Record<string, unknown> = {}) => ({
    id: `id-${name}`,
    root: "root",
    name,
    createdAt: `2026-10-${name}T02:00:00Z`,
    bytes: 1000,
    checked: true,
    standby: false,
    format: 3,
    ...extra,
  });
  const pick = async (found: unknown[], answer: string) =>
    python(
      `found = json.loads(sys.argv[2])
try:
    print("PICKED=" + tool.pick_backup(found)["name"])
except tool.Stop as stop:
    print(f"STOP {stop.code}: {stop.message}")`.replace(
        "sys.argv[2]",
        JSON.stringify(JSON.stringify(found)),
      ),
      { RESTORE_ANSWERS: await answersFile({ pick: answer }) },
    );

  it("is the newest backup that passed its check, never an unchecked one or one made on standby", async () => {
    const found = [
      backup("17", { checked: false }),
      backup("16", { standby: true }),
      backup("15"),
      backup("14"),
    ];
    const enter = await pick(found, "");
    expect(enter.stdout).toContain("PICKED=15");
    expect(enter.stdout).toMatch(/ 1\) .+\(NOT checked in Drive: it may be incomplete\)\n/);
    expect(enter.stdout).toMatch(/ 2\) .+\(made by a copy on standby\)\n/);
    expect(enter.stdout).toMatch(
      / 3\) .+\(newest checked: Enter picks it; the ones above are not checked\)\n/,
    );
    expect(enter.stdout).toContain(
      "Enter picks number 3: the newest backup that passed its check.",
    );
    expect((await pick(found, "newest")).stdout).toContain("PICKED=15");
    // Shown, and picked when its number is typed.
    expect((await pick(found, "1")).stdout).toContain("PICKED=17");
    expect((await pick(found, "2")).stdout).toContain("PICKED=16");
    // The newest is checked: it is number 1, as before.
    const plain = await pick([backup("15"), backup("14")], "");
    expect(plain.stdout).toContain("PICKED=15");
    expect(plain.stdout).toMatch(/ 1\) .+\(newest checked: Enter picks it\)\n/);
  });

  it("picks nothing by itself when no backup passed its check", async () => {
    const found = [backup("17", { checked: false }), backup("16", { checked: false })];
    const enter = await pick(found, "");
    expect(enter.stdout).toContain(
      "None of these backups passed its check in Google Drive, so none is picked by itself.",
    );
    expect(enter.stdout).toContain("STOP R10: no backup was picked.");
    expect((await pick(found, "2")).stdout).toContain("PICKED=16");
  });

  it("shows the newest checked one even when twenty newer ones are not checked", async () => {
    const found = [
      ...Array.from({ length: 22 }, (_, i) => backup(String(40 - i), { checked: false })),
      backup("10"),
    ];
    const enter = await pick(found, "");
    expect(enter.stdout).toContain("PICKED=10");
    expect(enter.stdout).toContain(
      "Enter picks number 21: the newest backup that passed its check.",
    );
  });
});

describe("a backup's files in Drive by name (v6.4.1 review)", () => {
  it("takes the newest of two files with the same name (Drive lists newest first)", async () => {
    const ran = await python(`
files = tool.by_name([
    {"name": "manifest.json", "id": "new"},
    {"name": "database.dump.locked", "id": "db"},
    {"name": "manifest.json", "id": "old"},
])
print(json.dumps({k: v["id"] for k, v in files.items()}))`);
    expect(ran.stderr).toBe("");
    expect(JSON.parse(ran.stdout)).toEqual({
      "manifest.json": "new",
      "database.dump.locked": "db",
    });
    const source = await readFile(TOOL, "utf8");
    expect(source).toContain("files = by_name(google.search(");
    expect(source).not.toMatch(/\{f\["name"\]: f for f in /);
  });
});

describe("the disk space a restore needs", () => {
  it("counts the download, the opened files, the files unpacked, the database and the programs", async () => {
    const MB = 1024 * 1024;
    const entries = [
      {
        name: "database.dump.locked",
        bytes: 300 * MB,
        plain: { name: "database.dump", bytes: 300 * MB },
      },
      {
        name: "media.tar.gz.locked",
        bytes: 900 * MB,
        plain: { name: "media.tar.gz", bytes: 900 * MB },
      },
      { name: "backup-keys.json", bytes: 1000 },
    ];
    const ran = await python(
      `entries = json.loads(sys.argv[2])
need, parts = tool.room_needed(entries, {"uploadBytes": 1024 ** 3}, {"media.tar.gz.locked": 900 * 1024 * 1024})
print(need)
print(parts)`.replace("sys.argv[2]", JSON.stringify(JSON.stringify(entries))),
    );
    const [need, parts] = ran.stdout.trim().split("\n");
    // 300 MB still to download (the files were downloaded in an earlier try), 1.2 GB
    // opened, 1 GB unpacked, 5 x 300 MB of database, 8 GB of programs.
    expect(Number(need)).toBe(300 * MB + 1000 + 1200 * MB + 1024 * MB + 1500 * MB + 8 * 1024 * MB);
    expect(parts).toBe(
      "the download 300.0 MB, the opened backup 1.2 GB, the uploaded files unpacked 1.0 GB, the database 1.5 GB, the ERP's programs 8.0 GB",
    );
  });
});

describe("Google Drive's lists, read to the end", () => {
  let google: FakeGoogle;
  beforeEach(async () => {
    google = await startFakeGoogle({ pageSize: 2 }, 0);
  });
  afterEach(async () => {
    await google.close();
  });

  it("reads every page, newest first", async () => {
    for (let i = 1; i <= 5; i++) {
      google.files.set(`f${i}`, {
        id: `f${i}`,
        name: `2026-10-0${i}_020000`,
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"],
        appProperties: { extas: "backup" },
        createdTime: `2026-10-0${i}T02:00:00.000Z`,
        trashed: false,
        data: null,
      });
    }
    const ran = await python(
      `google = tool.Google("client.apps.googleusercontent.com", "secret-123456")
google.sign_in()
print(json.dumps([f["name"] for f in google.search("'root' in parents and trashed = false")]))`,
      { GOOGLE_OAUTH_BASE: google.url, GOOGLE_DRIVE_BASE: google.url },
    );
    expect(ran.stderr).toBe("");
    const names = JSON.parse(ran.stdout.trim().split("\n").pop()!) as string[];
    expect(names).toEqual([5, 4, 3, 2, 1].map((i) => `2026-10-0${i}_020000`));
    expect(google.requests.filter((r) => r === "GET /drive/v3/files")).toHaveLength(3);
  });
});

describe("the comparison after the restore", () => {
  async function compare(counts: unknown, uploads: string) {
    const manifest = {
      tables: { User: 3, Company: 1 },
      uploads: [{ path: "c1/logo.png", sha256: createHash("sha256").update("logo").digest("hex") }],
    };
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    const args = ["--work", dir, "--manifest", path.join(dir, "manifest.json")];
    if (counts !== undefined) {
      await writeFile(
        path.join(dir, "counts.json"),
        typeof counts === "string" ? counts : JSON.stringify(counts),
      );
      args.push("--counts", path.join(dir, "counts.json"));
    }
    args.push("--uploads", uploads, "--result", path.join(dir, "compare.json"));
    return new Promise<Ran & { result: Record<string, unknown> }>((resolve) =>
      execFile(
        "python3",
        ["-I", TOOL, "compare", ...args],
        (error, stdout, stderr) =>
          void readFile(path.join(dir, "compare.json"), "utf8").then((text) =>
            resolve({
              code: error ? Number(error.code ?? 1) : 0,
              stdout,
              stderr,
              result: JSON.parse(text) as Record<string, unknown>,
            }),
          ),
      ),
    );
  }

  it("says the records were NOT checked when they could not be counted, never that all are back", async () => {
    const uploads = path.join(dir, "uploads");
    await mkdir(path.join(uploads, "c1"), { recursive: true });
    await writeFile(path.join(uploads, "c1", "logo.png"), "logo");
    for (const counts of [undefined, "", "not json", "[1, 2]"]) {
      const done = await compare(counts, uploads);
      expect(done.code, String(counts)).toBe(6);
      expect(done.stdout).toContain("Note W11: the records were NOT checked");
      expect(done.stdout).not.toContain("records and");
      expect(done.result).toMatchObject({
        ok: false,
        recordsNotChecked: true,
        compared: { records: false, files: true },
      });
    }
  });

  it("says which uploaded files came back as links, instead of skipping them without a word", async () => {
    const uploads = path.join(dir, "uploads");
    await mkdir(path.join(uploads, "c1"), { recursive: true });
    await writeFile(path.join(dir, "elsewhere.png"), "logo");
    await symlink(path.join(dir, "elsewhere.png"), path.join(uploads, "c1", "logo.png"));
    await mkdir(path.join(dir, "outside"));
    await symlink(path.join(dir, "outside"), path.join(uploads, "c1", "folder-link"));
    const done = await compare({ User: 3, Company: 1 }, uploads);
    expect(done.stdout).toContain(
      "2 link(s) among the uploaded files were not checked (a link is not a file the backup holds):",
    );
    expect(done.stdout).toContain("c1/folder-link");
    expect(done.stderr).toContain("Error R20:");
    expect(done.result).toMatchObject({
      ok: false,
      problems: ["File c1/logo.png came back as a link, not the file itself."],
      links: ["c1/folder-link", "c1/logo.png"].sort(),
    });
  });
});
