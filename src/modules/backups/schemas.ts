import { z } from "zod";

export const BACKUP_FILES = ["database", "media", "manifest"] as const;
export type BackupFileKind = (typeof BACKUP_FILES)[number];

export const backupConfigSchema = z
  .object({
    /** 5-part cron in `timezone`, e.g. "0 2 * * *" (every day at 02:00). */
    cronSchedule: z.string().trim().min(9).max(100),
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
    /** Days to keep backups on the server and on Drive (the newest one always stays). */
    retentionDays: z.number().int().min(1).max(3650),
    isEnabled: z.boolean(),
  })
  .partial();

export const listBackupRunsSchema = z.object({
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
});

export const googleCallbackSchema = z.object({
  state: z.string().min(1).max(2000),
  code: z.string().min(1).max(2000).optional(),
  /** Set by Google when the owner cancels or denies access. */
  error: z.string().max(200).optional(),
});

export const backupFileSchema = z.object({ file: z.enum(BACKUP_FILES) });
