import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BackupConfig } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import {
  type Actor,
  audit,
  driveRoot,
  driveToken,
  getBackupConfig,
  GUIDE_FILES,
  googleClient,
  guideRoot,
  hostRoot,
  hostVersion,
} from "@/modules/backups/backup-core";
import { restoreCommandLines } from "@/modules/backups/backup.service";
import { putRootFile } from "@/modules/backups/drive-root";
import { guideContentVersion, type GuideLang } from "@/modules/backups/restore-guide";
import { type GuideDetails, restoreGuidePdf } from "@/modules/backups/restore-guide-pdf";

/*
 * Where the restore guide (G6, G7) is kept, and when it is made again.
 *
 *   On the server (BACKUP_DIR/.guide): the copy WITHOUT details (no Google
 *     client, no key). It goes into every backup, so each backup carries the
 *     guide and the command for its own version.
 *   In the Drive backup folder: "Extas ERP restore guide (Bangla).pdf" and
 *     "(English).pdf" WITH "Your restore details": the web address and the
 *     Google client the new server signs in with, and the recovery key while
 *     the owner keeps it in Drive. Each new one replaces the old one.
 *   From the Backups screen ("Download the restore guide"): WITH the web
 *     address and the Google client but never the key (the server does not
 *     have it); every download is in the audit log.
 *
 * The clock (scheduler.ts) makes them again every month and as soon as
 * anything in them changes: the guide's words, the command (a new version),
 * the web address, the Google client, the recovery key or where it is kept.
 */

const LANGS: GuideLang[] = ["bn", "en"];
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
/** After a failure, the Drive copies are tried again an hour later. */
const RETRY_MS = 60 * 60 * 1000;
let driveRetryAt = 0;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function appDomain(): string | null {
  try {
    return process.env.APP_URL ? new URL(process.env.APP_URL).hostname : null;
  } catch {
    return null;
  }
}

/** What the copy without details is made from. */
async function baseDetails(now = new Date()): Promise<GuideDetails> {
  const host = await hostVersion();
  return {
    commandLines: restoreCommandLines(host),
    commit: host.commit,
    bootstrapSha256: host.bootstrapSha256,
    version: host.version,
    builtAt: now,
    personal: null,
  };
}

/**
 * "Your restore details" for the owner's own copies. `recoveryKey` is printed
 * (the Drive copy, while the owner keeps it there); `keyKept` says the restore
 * reads the key from Drive by itself.
 */
function personalDetails(
  config: BackupConfig,
  recoveryKey: string | null,
  keyKept = Boolean(recoveryKey),
): NonNullable<GuideDetails["personal"]> {
  const client = googleClient(config);
  return {
    domain: appDomain(),
    clientId: client?.clientId ?? null,
    clientSecret: client?.clientSecret ?? null,
    recoveryKey,
    keyKept,
  };
}

/** A fingerprint of what the copy without details is made from. */
function fingerprint(details: GuideDetails): string {
  return sha(JSON.stringify([guideContentVersion(), details.commandLines, details.version])).slice(
    0,
    32,
  );
}

/** Both languages as PDFs. */
export async function buildGuides(details: GuideDetails): Promise<Record<GuideLang, Buffer>> {
  const [bn, en] = await Promise.all(LANGS.map((lang) => restoreGuidePdf(lang, details)));
  return { bn: bn!, en: en! };
}

// --- On the server: the copy without details -----------------------------------------

const STAMP = "guide.json";

/**
 * Makes the server's copies (no details) when they are missing, a month old or
 * out of date; returns true when it made them.
 */
export async function ensureLocalGuides(now = new Date()): Promise<boolean> {
  const details = await baseDetails(now);
  const hash = fingerprint(details);
  const root = guideRoot();
  const stamp = await readFile(path.join(root, STAMP), "utf8")
    .then((text) => JSON.parse(text) as { hash?: string; builtAt?: string })
    .catch(() => null);
  const present = await Promise.all(
    GUIDE_FILES.map((name) =>
      stat(path.join(root, name)).then(
        (s) => s.size > 0,
        () => false,
      ),
    ),
  );
  const fresh =
    stamp?.hash === hash &&
    typeof stamp.builtAt === "string" &&
    now.getTime() - new Date(stamp.builtAt).getTime() < MONTH_MS &&
    present.every(Boolean);
  if (fresh) return false;
  const pdfs = await buildGuides(details);
  await mkdir(root, { recursive: true });
  for (const [i, lang] of LANGS.entries()) {
    const file = path.join(root, GUIDE_FILES[i]!);
    await writeFile(`${file}.new`, pdfs[lang], { mode: 0o644 });
    await rename(`${file}.new`, file);
  }
  await writeFile(path.join(root, STAMP), JSON.stringify({ hash, builtAt: now.toISOString() }));
  return true;
}

// --- In the Drive backup folder: the copy with details -------------------------------

/**
 * The recovery key kept in Drive, when the owner keeps it there: only the
 * current pair's, and only when it opens the current keys file, so the guide
 * never prints an old key (G3).
 */
async function keptKey(config: BackupConfig, token: string, rootId: string) {
  const { keptRecoveryKey } = await import("@/modules/backups/recovery-key.service");
  return keptRecoveryKey(config, token, rootId);
}

/**
 * A fingerprint of what the Drive copies are made from, read from the settings
 * alone (so the clock asks Google nothing while it is unchanged): the guide,
 * the command, the web address, the Google client (its secret as a hash), and
 * the key pair and whether the key is kept in Drive (a new key in Drive is
 * published straight away by recovery-key.service.ts).
 */
function driveFingerprint(config: BackupConfig, details: GuideDetails) {
  const client = googleClient(config);
  return sha(
    JSON.stringify([
      fingerprint(details),
      appDomain(),
      client?.clientId ?? null,
      client ? sha(client.clientSecret) : null,
      config.keepKeyInDrive,
      config.keyPairId,
      config.keySetAt?.toISOString() ?? null,
      config.googleDriveFolderId,
    ]),
  ).slice(0, 32);
}

/**
 * Puts both guides with "Your restore details" in the Drive backup folder,
 * replacing the ERP's earlier ones. `recoveryKey`: the key to print while the
 * owner keeps it in Drive (else it is left out). Records what they were made
 * from, so the clock does not make them again until something changes.
 */
export async function publishGuide(
  config: BackupConfig,
  options: { token: string; rootId: string; recoveryKey: string | null },
  now = new Date(),
): Promise<boolean> {
  const details: GuideDetails = {
    ...(await baseDetails(now)),
    personal: personalDetails(config, config.keepKeyInDrive ? options.recoveryKey : null),
  };
  const pdfs = await buildGuides(details);
  const hash = driveFingerprint(config, details);
  await putRootFile(options.token, options.rootId, "guideBn", pdfs.bn, { guide: hash });
  await putRootFile(options.token, options.rootId, "guideEn", pdfs.en, { guide: hash });
  await publishRestoreScripts(options.token, options.rootId, details.bootstrapSha256);
  await prisma.backupConfig.update({
    where: { id: config.id },
    data: { guideHash: hash, guideBuiltAt: now },
  });
  return true;
}

/**
 * restore.sh and restore-tool.py of the running version beside the guide (G17),
 * from the server's own copies (deploy.sh: record_host_files), so a restore
 * needs nothing from GitHub. Only the restore.sh whose SHA-256 the guide's
 * command checks; the tool is checked by restore.sh itself.
 */
async function publishRestoreScripts(token: string, rootId: string, sha256: string | null) {
  const [script, tool] = await Promise.all(
    ["restore.sh", "restore-tool.py"].map((name) =>
      readFile(path.join(hostRoot(), name)).catch(() => null),
    ),
  );
  if (!script || !tool || !sha256 || createHash("sha256").update(script).digest("hex") !== sha256)
    return false;
  await putRootFile(token, rootId, "restoreScript", script, { sha256 });
  await putRootFile(token, rootId, "restoreTool", tool);
  return true;
}

export type GuideTick = "made" | "fresh" | "skipped";

/**
 * The clock's part (scheduler.ts): the server's copies, then the Drive copies
 * when Drive is connected and they are a month old or out of date. Only one
 * process puts them in Drive: it claims the work by the recorded hash first.
 */
export async function guideTick(now = new Date()): Promise<GuideTick> {
  const local = await ensureLocalGuides(now);
  const quiet: GuideTick = local ? "made" : "skipped";
  const config = await getBackupConfig();
  if (!config.credentialsRef || now.getTime() < driveRetryAt) return quiet;
  const hash = driveFingerprint(config, await baseDetails(now));
  const young =
    config.guideBuiltAt !== null && now.getTime() - config.guideBuiltAt.getTime() < MONTH_MS;
  if (config.guideHash === hash && young) return local ? "made" : "fresh";
  try {
    const token = await driveToken(config);
    if (!token) return quiet;
    const rootId = await driveRoot(config, token);
    const recoveryKey = await keptKey(config, token, rootId);
    // Claim it: another process that read the same row finds it taken.
    const claimed = await prisma.backupConfig.updateMany({
      where: { id: config.id, guideHash: config.guideHash, guideBuiltAt: config.guideBuiltAt },
      data: { guideHash: hash, guideBuiltAt: now },
    });
    if (claimed.count === 0) return quiet;
    try {
      await publishGuide(
        { ...config, googleDriveFolderId: rootId },
        { token, rootId, recoveryKey },
        now,
      );
    } catch (error) {
      // Give the claim back, so it is tried again (an hour later).
      await prisma.backupConfig.updateMany({
        where: { id: config.id, guideHash: hash },
        data: { guideHash: config.guideHash, guideBuiltAt: config.guideBuiltAt },
      });
      throw error;
    }
    return "made";
  } catch (error) {
    driveRetryAt = now.getTime() + RETRY_MS;
    console.error("[backups] the restore guide could not be put in Google Drive", error);
    return quiet;
  }
}

/** For the tests: forget the hour's wait after a failure. */
export function resetGuideRetry() {
  driveRetryAt = 0;
}

// --- From the Backups screen ----------------------------------------------------------

/**
 * The guide with "Your restore details" (the web address and the Google client,
 * never the key), for the owner to keep on their computer. Audited.
 */
export async function downloadGuide(actor: Actor, lang: GuideLang, meta?: RequestMeta) {
  const config = await getBackupConfig();
  const details: GuideDetails = {
    ...(await baseDetails()),
    personal: personalDetails(
      config,
      null,
      config.keepKeyInDrive && Boolean(config.keyPairId && config.keyInDriveAt),
    ),
  };
  const data = await restoreGuidePdf(lang, details);
  const name = lang === "bn" ? "Bangla" : "English";
  await audit(actor, meta, {
    action: "EXPORT",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Downloaded the restore guide (${name}), with the restore details`,
  });
  return { data, fileName: `Extas ERP restore guide (${name}).pdf` };
}
