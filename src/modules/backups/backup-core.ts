import path from "node:path";

import type { BackupConfig } from "@prisma/client";

import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { pushToBot } from "@/modules/ai/bot/push";
import { recordAudit } from "@/modules/audit/audit.service";
import { backupKey, keyId as nameKey, parseRecoveryKey } from "@/modules/backups/crypt";
import { ROOT_LABEL } from "@/modules/backups/drive-fetch";
import * as drive from "@/modules/backups/google-drive";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * What every part of the backups shares: where the files go, the settings row,
 * the Google client and connection, the recovery key, and the owner's alert.
 */

export type Actor = { userId: string };

/** The folder in the owner's Drive that holds every backup, and its label. */
export const DRIVE_FOLDER_NAME = "Extas ERP Backups";
export { ROOT_LABEL };

/**
 * Read at call time so tests (and a changed .env) can point it elsewhere. A folder
 * on the server, not part of the app: the build is told not to bundle it.
 */
export function backupRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.BACKUP_DIR || "./storage/backups");
}

/** The update safety copies (deploy.sh), read-only to the app; null when not mounted. */
export function safetyCopyRoot(): string | null {
  const dir = process.env.SAFETY_COPY_DIR?.trim();
  return dir ? path.resolve(/*turbopackIgnore: true*/ dir) : null;
}

export async function audit(
  actor: Actor | null,
  meta: RequestMeta | undefined,
  input: {
    action: "CREATE" | "UPDATE" | "EXPORT";
    entityType: string;
    entityId?: string;
    summary: string;
  },
) {
  await recordAudit({ ...input, companyId: null, userId: actor?.userId ?? null, meta });
}

/** The single platform-wide backup settings row (created with the defaults). */
export async function getBackupConfig(): Promise<BackupConfig> {
  const existing = await prisma.backupConfig.findFirst({ orderBy: { updatedAt: "asc" } });
  if (existing) return existing;
  return prisma.backupConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}

/** The Google client the owner set on the Backups screen, else the one in the server's settings. */
export function googleClient(config: BackupConfig): drive.GoogleClient | null {
  if (config.googleClientId && config.googleClientSecretRef) {
    try {
      return {
        clientId: config.googleClientId,
        clientSecret: decryptSecret(config.googleClientSecretRef),
      };
    } catch {
      return null;
    }
  }
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** A Drive access token for the connected account, or null when Drive is not connected. */
export async function driveToken(config: BackupConfig): Promise<string | null> {
  const client = googleClient(config);
  if (!client || !config.credentialsRef) return null;
  return drive.accessToken(client, decryptSecret(config.credentialsRef));
}

/** The backup folder in Drive: the one on record, else the labelled one, else a new one. */
export async function driveRoot(config: BackupConfig, token: string): Promise<string> {
  if (config.googleDriveFolderId && (await drive.folderExists(token, config.googleDriveFolderId))) {
    return config.googleDriveFolderId;
  }
  const found = (await drive.findFolders(token, ROOT_LABEL.key, ROOT_LABEL.value))[0];
  const id =
    found?.id ??
    (
      await drive.createFolder(token, DRIVE_FOLDER_NAME, undefined, {
        [ROOT_LABEL.key]: ROOT_LABEL.value,
      })
    ).id;
  await prisma.backupConfig.update({ where: { id: config.id }, data: { googleDriveFolderId: id } });
  return id;
}

/** The key that locks backups now, and its name; null before the owner makes a recovery key. */
export function currentKey(config: BackupConfig): { key: Buffer; id: string } | null {
  if (!config.recoveryKeyRef) return null;
  const key = backupKey(parseRecoveryKey(decryptSecret(config.recoveryKeyRef)));
  return { key, id: nameKey(key) };
}

/**
 * Tells the platform owner at once: a message in the ERP's inbox, in every
 * company they belong to, and on the bot (an alarm: sent even while the AI is off).
 */
export async function alertOwner(subject: string, text: string, runId?: string) {
  try {
    const owners = await prisma.user.findMany({
      where: { isSuperAdmin: true, status: "ACTIVE" },
      select: { id: true, memberships: { select: { companyId: true } } },
    });
    const companies = new Set<string>();
    for (const owner of owners) {
      for (const { companyId } of owner.memberships) {
        companies.add(companyId);
        await sendInApp(prisma, companyId, [{ userId: owner.id }], {
          subject,
          body: text,
          entityType: runId ? "BackupRun" : null,
          entityId: runId ?? null,
        });
      }
    }
    for (const companyId of companies) {
      await pushToBot(companyId, { kind: "text", text: `${subject}: ${text}` }, { alarm: true });
    }
  } catch (error) {
    console.error(
      "[backups] could not alert the owner",
      error instanceof Error ? error.message : error,
    );
  }
}

/** A short, safe reason for a failed step (never a password). */
export function reasonFor(error: unknown): string {
  const e = error as NodeJS.ErrnoException & { stderr?: string; path?: string };
  if (e?.code === "ENOENT" && (e.path === pgDumpBinary() || /pg_dump/.test(String(e.message)))) {
    return "pg_dump was not found on the server: install the PostgreSQL client tools or set PG_DUMP_PATH.";
  }
  const detail = (
    e?.stderr?.trim() || (error instanceof Error ? error.message : String(error))
  ).replace(/postgres(ql)?:\/\/[^\s]+/g, "postgresql://***");
  return detail.slice(0, 1000);
}

export const pgDumpBinary = () => process.env.PG_DUMP_PATH || "pg_dump";
/** pg_restore and psql sit next to pg_dump. */
export const pgTool = (name: "pg_restore" | "psql") => {
  const dump = process.env.PG_DUMP_PATH;
  return dump ? path.join(path.dirname(dump), name) : name;
};

/**
 * libpq settings from DATABASE_URL. They go to pg_dump as environment variables,
 * so the password never appears in the server's process list.
 */
export function pgEnvironment(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  const env: Record<string, string> = {
    PGHOST: url.searchParams.get("host") ?? (url.hostname.replace(/^\[|\]$/g, "") || "localhost"),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}
