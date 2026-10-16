import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { DETAILS_TEXT, GUIDE_ERRORS, GUIDE_STEP_IDS } from "@/modules/backups/restore-guide";
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
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
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
