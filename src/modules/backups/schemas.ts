import { z } from "zod";

import { scheduleSchema } from "@/modules/backups/schedule";

export const BACKUP_FILES = ["database", "media", "manifest"] as const;
export type BackupFileKind = (typeof BACKUP_FILES)[number];

const cron = z.string().trim().min(9).max(100);
const time = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 02:00");

export const backupConfigSchema = z
  .object({
    /** The schedule (G1): every N hours, every N days, chosen weekdays or chosen dates. */
    schedule: scheduleSchema,
    /** v6.3: a 5-part cron; read as the closest schedule. */
    cronSchedule: cron,
    /** v6.3: the daily time ("02:00"); every day at that time. */
    dailyTime: time,
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "Unknown timezone (use a name like Asia/Dhaka)"),
    /** Backups kept on the server (G2). */
    serverKeep: z.number().int().min(3, "Keep at least 3").max(7, "Keep at most 7"),
    /** Days each backup stays in Google Drive; null: for ever. */
    driveKeepDays: z
      .number()
      .int()
      .min(7, "Keep them at least 7 days")
      .max(3650, "At most 3650 days (10 years)")
      .nullable(),
    isEnabled: z.boolean(),
    /** The monthly restore drill into a temporary database. */
    drillEnabled: z.boolean(),
    drillDay: z.number().int().min(1).max(28, "Pick a day from 1 to 28"),
    drillTime: time,
  })
  .partial();

export const listBackupRunsSchema = z.object({
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
  kind: z.enum(["BACKUP", "SAFETY_COPY", "TEST_RESTORE", "RESTORE"]).optional(),
});

/** The owner's Google Cloud client ("TVs and Limited Input devices"). */
export const googleClientSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(
      /^[\w-]+\.apps\.googleusercontent\.com$/,
      "A client ID ends in .apps.googleusercontent.com",
    ),
  clientSecret: z.string().trim().min(10, "Paste the client secret").max(200),
});

const pin = z.string().trim().max(20).optional();
const recoveryKey = z.string().max(400);

/** Setting or changing the owner's own recovery key (G4), with the PIN. */
export const setRecoveryKeySchema = z.object({
  pin,
  key: recoveryKey,
  /** The same key typed again. */
  confirm: recoveryKey,
  /** Changing a key: the current one, to open the private key. */
  currentKey: recoveryKey.optional(),
  /** The current key is lost: make a new key pair (older backups need the old key). */
  forgotCurrent: z.boolean().optional(),
  keepInDrive: z.boolean().optional(),
});

/** "Keep my recovery key in Google Drive" (G5); turning it on needs the key typed once. */
export const keepKeyInDriveSchema = z.object({
  pin,
  keep: z.boolean(),
  key: recoveryKey.optional(),
});

/** Cloudflare: the domain (zone) and an API token that can edit its DNS only (G9). */
export const cloudflareSchema = z.object({
  pin,
  zone: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/, "Type the domain, like extasbd.com"),
  token: z
    .string()
    .trim()
    .regex(/^[\w-]{30,200}$/, "Paste the whole token (letters, digits, - and _)"),
});

/** "Run drill now": the recovery key may be typed for this one drill (never kept). */
export const drillNowSchema = z.object({ key: recoveryKey.optional() });

/** Restore from the Backups screen: the backup, the PIN, and RESTORE typed out. */
export const restoreRequestSchema = z.object({
  folderId: z.string().trim().min(1).max(200),
  pin,
  confirm: z.string().trim(),
  /** The recovery key, when it is not kept in Google Drive (or for a v6.3 backup, its key card). */
  key: recoveryKey.optional(),
});

export const backupFileSchema = z.object({ file: z.enum(BACKUP_FILES) });
