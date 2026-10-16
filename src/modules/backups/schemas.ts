import { z } from "zod";

export const BACKUP_FILES = ["database", "media", "manifest"] as const;
export type BackupFileKind = (typeof BACKUP_FILES)[number];

const cron = z.string().trim().min(9).max(100);

export const backupConfigSchema = z
  .object({
    /** 5-part cron in `timezone`, e.g. "0 2 * * *" (every day at 02:00). */
    cronSchedule: cron,
    /** The daily time on the Backups screen ("02:00"); it sets cronSchedule. */
    dailyTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 02:00"),
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
    /** Include uploaded files (logos, packing lists, bill scans). */
    includeMedia: z.boolean(),
    /** Days to keep backups on the server while Drive is not connected (the newest one always stays). */
    retentionDays: z.number().int().min(1).max(3650),
    /** How many backups to keep in Google Drive (the newest one always stays). */
    keepCount: z.number().int().min(1, "Keep at least 1").max(365, "Keep at most 365"),
    isEnabled: z.boolean(),
    /** The weekly test restore into a temporary database. */
    testRestoreEnabled: z.boolean(),
    testRestoreSchedule: cron,
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

export const recoveryKeyMakeSchema = z.object({
  /** Needed only to replace a key that already exists. */
  pin: z.string().trim().max(20).optional(),
});

export const recoveryKeyConfirmSchema = z.object({
  lastGroup: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z]{4}$/, "Type the last group of 4 letters and digits"),
});

/** Restore from the Backups screen: the backup, the PIN, and RESTORE typed out. */
export const restoreRequestSchema = z.object({
  folderId: z.string().trim().min(1).max(200),
  pin: z.string().trim().max(20).optional(),
  confirm: z.string().trim(),
});

export const backupFileSchema = z.object({ file: z.enum(BACKUP_FILES) });
