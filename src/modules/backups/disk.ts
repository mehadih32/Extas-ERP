import { statfs } from "node:fs/promises";

/*
 * Room on the server's disk before a backup or the restore drill (R-BAK G7).
 * Each needs at least twice the size of the backup it makes or downloads, plus
 * a margin, free where the backups are kept; otherwise it is skipped (never
 * started and left half-written on a full disk) and the owner is told once.
 */

/** Kept free on top of twice the backup's size. */
export const DISK_MARGIN_BYTES = 1024 ** 3;

/** What the disk measures go through (tests stand in for it). */
export const disk = {
  /** Free bytes where `dir` is, or null when it cannot be measured. */
  async freeBytes(dir: string): Promise<number | null> {
    try {
      const s = await statfs(dir);
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  },
};

/** A job skipped because the disk is nearly full. */
export class NoRoomError extends Error {}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/**
 * Throws NoRoomError when `dir`'s disk has less than twice `backupBytes` plus
 * the margin free. A disk that cannot be measured never stops a backup.
 */
export async function needRoom(dir: string, backupBytes: number, what: string) {
  const free = await disk.freeBytes(dir);
  const need = 2 * Math.max(0, backupBytes) + DISK_MARGIN_BYTES;
  if (free === null || free >= need) return;
  throw new NoRoomError(
    `Skipped: the server has ${gb(free)} free, and a ${what} needs at least ${gb(need)} (twice the backup's ${gb(backupBytes)}, and ${gb(DISK_MARGIN_BYTES)} to spare). Make room on the server, for example by keeping fewer backups on it, and it runs at its next time.`,
  );
}
