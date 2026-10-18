import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DETAILS_TEXT,
  DRILL_PART,
  GUIDE_ERRORS,
  GUIDE_STEP_IDS,
  GUIDE_WORDS,
  NO_GITHUB_PART,
} from "@/modules/backups/restore-guide";
import { pngSize } from "@/modules/backups/restore-guide-pictures";
import {
  type GuideDetails,
  printsExactly,
  restoreGuidePdf,
} from "@/modules/backups/restore-guide-pdf";

/*
 * The restore guide PDF (G6): the one command in full, "Your restore details"
 * only in the owner's own copies (the recovery key only when asked for), every
 * step and every error code, and nothing cut.
 */

/** A PDF literal string's bytes: "(...)" with its backslash escapes. */
function literalBytes(body: string): Buffer {
  const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== "\\") {
      bytes.push(ch.charCodeAt(0));
      continue;
    }
    const next = body[++i]!;
    const octal = body.slice(i).match(/^[0-7]{1,3}/)?.[0];
    if (octal) {
      bytes.push(parseInt(octal, 8));
      i += octal.length - 1;
    } else bytes.push(escapes[next] ?? next.charCodeAt(0));
  }
  return Buffer.from(bytes);
}

/** The text a PDF draws: Latin text as written, Bengali from its ActualText. */
function pdfStrings(pdf: Buffer): string {
  const out: string[] = [];
  const raw = pdf.toString("latin1");
  // Each stream by its /Length: its last byte may be a \r, which a search for
  // "\r\nendstream" would take away.
  for (const m of raw.matchAll(/\/Length (\d+)[^>]*>>\s*stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    let content: string;
    try {
      content = inflateSync(Buffer.from(raw.slice(start, start + Number(m[1])), "latin1")).toString(
        "latin1",
      );
    } catch {
      continue;
    }
    // Glyphs inside a marked span with ActualText are the span's text: only that is kept.
    let inSpan = false;
    const tokens = /\[([^\]]*)\]\s*TJ|\/ActualText\s*\(((?:\\[\s\S]|[^\\)])*)\)|\bEMC\b/g;
    for (const t of content.matchAll(tokens)) {
      if (t[0] === "EMC") {
        inSpan = false;
        continue;
      }
      if (t[2] !== undefined) {
        const bytes = Buffer.from(literalBytes(t[2]).subarray(2));
        out.push(bytes.swap16().toString("utf16le"));
        inSpan = true;
        continue;
      }
      if (inSpan) continue;
      const pieces = [...t[1]!.matchAll(/<([0-9A-Fa-f]*)>/g)].map((h) =>
        Buffer.from(h[1]!, "hex").toString("latin1"),
      );
      out.push(pieces.join(""));
    }
  }
  return out.join("\n");
}

/** Text drawn word by word (a paragraph) without its spaces and line breaks, to search in. */
const squash = (text: string) => text.replace(/\s+/g, "");

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SHA = "ab".repeat(32);
const LINES = [
  `c=${COMMIT} &&`,
  "curl -fsSL https://raw.githubusercontent.com/mehadih32/Extas-ERP/$c/deploy/bootstrap.sh -o restore.sh &&",
  `echo "${SHA} restore.sh" | sha256sum -c &&`,
  "sudo bash restore.sh $c",
];
const CLIENT_ID = "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";
const SECRET = "GOCSPX-made-up-in-a-test";

const base = (personal: GuideDetails["personal"]): GuideDetails => ({
  commandLines: LINES,
  commit: COMMIT,
  bootstrapSha256: SHA,
  version: "6.4.0",
  builtAt: new Date("2026-10-16T08:00:00Z"),
  personal,
});
const personal = (recoveryKey: string | null, keyKept = Boolean(recoveryKey)) => ({
  domain: "erp.extasbd.com",
  clientId: CLIENT_ID,
  clientSecret: SECRET,
  recoveryKey,
  keyKept,
});

describe("the restore guide PDF", () => {
  it("prints the whole command, every step and every error, with page numbers", async () => {
    const pdf = await restoreGuidePdf("en", base(null));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = pdfStrings(pdf);
    for (const line of LINES) expect(text).toContain(line);
    expect(text).toContain(SHA);
    for (const id of GUIDE_STEP_IDS) expect(text, id).toMatch(new RegExp(`^${id}$`, "m"));
    for (const error of GUIDE_ERRORS) {
      expect(text, error.code).toContain(
        `${error.code.startsWith("R") ? "Error" : "Note"} ${error.code}:`,
      );
    }
    const pages = Number(text.match(/Page 1 \/ (\d+)/)?.[1]);
    expect(pages).toBeGreaterThan(20);
    expect(pages).toBeLessThan(60);
    for (let n = 1; n <= pages; n++) expect(text).toContain(`Page ${n} / ${pages}`);
  });

  it("keeps the copy without details free of secrets", async () => {
    const text = pdfStrings(await restoreGuidePdf("en", base(null)));
    expect(squash(text)).toContain(squash("This copy has no details."));
    expect(text).not.toContain("GOCSPX");
    expect(text).not.toMatch(/[\w-]{10,}\.apps\.googleusercontent\.com/);
  });

  it("fills in the owner's details, and the key only when it is given", async () => {
    const withKey = pdfStrings(
      await restoreGuidePdf("en", base(personal("Padma river at dawn, 1971!"))),
    );
    expect(withKey).toContain(CLIENT_ID);
    expect(withKey).toContain(SECRET);
    expect(withKey).toContain("erp.extasbd.com");
    expect(withKey).toContain("Padma river at dawn, 1971!");
    expect(squash(withKey)).toContain(
      squash("keep 2-Step Verification on for that Google account"),
    );

    const kept = pdfStrings(await restoreGuidePdf("en", base(personal(null, true))));
    expect(kept).toContain(CLIENT_ID);
    expect(squash(kept)).toContain(
      squash("Kept in Google Drive: the restore fills it in by itself"),
    );
    expect(kept).not.toContain("Padma river");

    const typed = pdfStrings(await restoreGuidePdf("en", base(personal(null, false))));
    expect(squash(typed)).toContain(squash("type it when the restore asks"));
  });

  it("never cuts a long value: it breaks over lines instead", async () => {
    const long = `${"9".repeat(90)}-x.apps.googleusercontent.com`;
    const text = pdfStrings(
      await restoreGuidePdf("en", base({ ...personal(null), clientId: long })),
    );
    expect(text.replace(/\n/g, "")).toContain(long);
    expect(text).not.toMatch(/9…|…\.apps/);
  });

  it("says when the key has letters or spaces the PDF cannot show exactly", async () => {
    expect(printsExactly("Padma river at dawn, 1971!")).toBe(true);
    expect(printsExactly("আমার নদী পদ্মা")).toBe(true);
    expect(printsExactly("two  spaces")).toBe(false);
    expect(printsExactly("emoji 🙂 key")).toBe(false);
    const text = pdfStrings(await restoreGuidePdf("en", base(personal("two  spaces here"))));
    expect(squash(text)).toContain(
      squash("Your key has letters or spaces this PDF cannot show exactly"),
    );
  });

  it("writes the Bengali copy in Bengali, with the same command", async () => {
    const text = pdfStrings(await restoreGuidePdf("bn", base(personal(null, true))));
    expect(squash(text)).toContain(squash(DETAILS_TEXT.title.bn));
    expect(squash(text)).toContain(squash("ছবি (আঁকা নমুনা)"));
    for (const line of LINES) expect(text).toContain(line);
    expect(text).toContain(CLIENT_ID);
  });

  it("says where the command will be while the server has no version yet", async () => {
    const text = pdfStrings(
      await restoreGuidePdf("en", {
        ...base(null),
        commandLines: null,
        commit: null,
        bootstrapSha256: null,
      }),
    );
    expect(squash(text)).toContain(
      squash("The command appears here once the server has been updated."),
    );
  });
});

/** A small real PNG (one colour), as a screenshot stand-in. */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits
  header[9] = 2; // RGB
  const rows = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const images = (pdf: Buffer) => pdf.toString("latin1").match(/\/Subtype \/Image/g)?.length ?? 0;

describe("the restore guide PDF (v6.4.1)", () => {
  let folder: string | null = null;
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (folder) await rm(folder, { recursive: true, force: true });
    folder = null;
  });

  it("prints a real screenshot where public/restore-guide has one, else the drawing", async () => {
    folder = await mkdtemp(path.join(os.tmpdir(), "extas-guide-shots-"));
    vi.stubEnv("RESTORE_GUIDE_SCREENSHOTS", folder);
    const drawn = await restoreGuidePdf("en", base(null));
    expect(images(drawn)).toBe(0);

    // A landscape screenshot (Azure) and a tall one (the phone), and a file that is no PNG.
    await writeFile(path.join(folder, "azure-admin.png"), png(160, 90));
    await writeFile(path.join(folder, "phone-account.png"), png(54, 120));
    await writeFile(path.join(folder, "putty-login.png"), "not a picture");
    expect(pngSize(png(160, 90))).toEqual({ width: 160, height: 90 });
    expect(pngSize(Buffer.from("not a picture"))).toBeNull();
    const pdf = await restoreGuidePdf("en", base(null));
    expect(images(pdf)).toBe(2);
    const text = squash(pdfStrings(pdf));
    const shot = squash(GUIDE_WORDS.screenshot.en);
    const drawing = squash(GUIDE_WORDS.picture.en);
    expect(text.split(shot).length - 1).toBe(2);
    expect(text.split(drawing).length - 1).toBe(
      squash(pdfStrings(drawn)).split(drawing).length - 3,
    );
    // Every step is still there.
    const all = pdfStrings(pdf);
    for (const id of GUIDE_STEP_IDS) expect(all, id).toMatch(new RegExp(`^${id}$`, "m"));
  });

  it("prints the drill and the no-GitHub parts, each with its own command", async () => {
    for (const lang of ["en", "bn"] as const) {
      const text = pdfStrings(await restoreGuidePdf(lang, base(null)));
      for (const words of [DRILL_PART.title, NO_GITHUB_PART.title, GUIDE_WORDS.drillCommand]) {
        expect(squash(text), words.en).toContain(squash(words[lang]));
      }
      expect(text).toContain("sudo bash restore.sh $c --drill");
      // Curly quotes come out of the PDF as WinAnsi bytes; compare without them.
      const noQuotes = (t: string) => squash(t).replace(/[“”\x93\x94]/g, "");
      for (const step of [...DRILL_PART.steps, ...NO_GITHUB_PART.steps]) {
        expect(noQuotes(text)).toContain(noQuotes(step[lang]).slice(0, 40));
      }
    }
    // The command without GitHub: the same lines without the download; the
    // drill's: the same lines, ending with --drill.
    const text = pdfStrings(await restoreGuidePdf("en", base(null)));
    const box = (title: string) => {
      const start = text.indexOf(`\n${title}\n`);
      expect(start, title).toBeGreaterThan(0);
      return text.slice(start, start + 600);
    };
    const noGithub = box(GUIDE_WORDS.noGithubCommand.en);
    for (const line of [LINES[0]!, LINES[2]!]) expect(noGithub).toContain(line);
    expect(noGithub).not.toContain("curl ");
    const drill = box(GUIDE_WORDS.drillCommand.en);
    for (const line of LINES.slice(0, 3)) expect(drill).toContain(line);
    expect(drill).toContain(`${LINES[3]} --drill`);
  });
});
