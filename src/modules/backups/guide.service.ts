import type { BackupConfig } from "@prisma/client";

/*
 * The restore guide (G6, G7): built in stage 2. Until then nothing is
 * published, and the backups carry no guide.
 */

export async function publishGuide(
  _config: BackupConfig,
  _options: { token: string; rootId: string; recoveryKey: string | null },
): Promise<boolean> {
  void _config;
  void _options;
  return false;
}
