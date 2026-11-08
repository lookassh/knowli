import { isNotNull } from "drizzle-orm";
import type { Executor } from "../../db/client";
import { mediaAssets } from "../../db/schema";
import { reportOrphanMedia, type OrphanMediaReport } from "../../providers/media/orphan-report";

export type { OrphanMediaReport } from "../../providers/media/orphan-report";
export { summarizeOrphanMediaReport, DEFAULT_ORPHAN_GRACE_MS } from "../../providers/media/orphan-report";

/**
 * Raport dry-run osieroconych blobów (#386): klucze osiągalne z bazy to
 * każdy niepusty `media_assets.storage_key` (dowolny stan — zachowawczo,
 * żeby powiązany blob nigdy nie został kandydatem). Sam raport niczego
 * nie usuwa; kasowanie wymaga osobnej decyzji po okresie karencji.
 */
export async function reportOrphanMediaBlobs(
  db: Executor,
  input: { rootDir: string; nowMs: number; minAgeMs?: number },
): Promise<OrphanMediaReport> {
  const rows = await db
    .select({ storageKey: mediaAssets.storageKey })
    .from(mediaAssets)
    .where(isNotNull(mediaAssets.storageKey));
  return reportOrphanMedia({
    rootDir: input.rootDir,
    referencedStorageKeys: rows.flatMap((row) => (row.storageKey ? [row.storageKey] : [])),
    nowMs: input.nowMs,
    ...(input.minAgeMs === undefined ? {} : { minAgeMs: input.minAgeMs }),
  });
}
