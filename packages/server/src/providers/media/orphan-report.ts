import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { isMediaStorageKey } from "./local";

/**
 * Raport dry-run osieroconych blobów lokalnego wolumenu (#386): zestawia
 * pliki o kształcie `storageKey` z dysku z kluczami osiągalnymi z bazy
 * i liczy sieroty. Niczego nie usuwa ani nie modyfikuje — kasowanie to
 * osobna decyzja po okresie karencji, na podstawie kolejnych raportów.
 */

// Katalog odłamu klucza: dwa pierwsze znaki hasha (jak w `createLocalMediaStore`).
const SHARD_DIR_PATTERN = /^[0-9a-f]{2}$/;

// Domyślny okres karencji raportu: sierota młodsza niż to może jeszcze
// należeć do finalizującej się generacji (zapis blobu wyprzedza transakcję
// z `storage_key`), więc trafia do osobnej, młodej puli — nie do kandydatów.
export const DEFAULT_ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Blob znaleziony na dysku: wyłącznie metadane pliku, bez treści. */
export interface DiskMediaBlob {
  storageKey: string;
  byteCount: number;
  mtimeMs: number;
}

export interface OrphanMediaReport {
  diskBlobCount: number;
  diskBlobBytes: number;
  /** Wpisy dysku spoza kształtu klucza (pliki tymczasowe, obce pliki). */
  ignoredCount: number;
  ignoredBytes: number;
  /** Unikalne klucze osiągalne z bazy. */
  referencedKeyCount: number;
  referencedOnDiskCount: number;
  referencedOnDiskBytes: number;
  /** Klucze z bazy bez pliku na dysku (tylko liczba). */
  missingReferencedCount: number;
  orphanCount: number;
  orphanBytes: number;
  /** Sieroty po okresie karencji — kandydaci do osobnej decyzji o kasowaniu. */
  eligibleOrphanCount: number;
  eligibleOrphanBytes: number;
  /** Sieroty młodsze niż karencja — raportowane, nigdy kandydaci. */
  youngOrphanCount: number;
  youngOrphanBytes: number;
  // Klucze służą testom i przyszłej, osobnej decyzji o kasowaniu.
  // Podsumowanie dla operatora (`summarizeOrphanMediaReport`) ich nie zawiera.
  orphanStorageKeys: string[];
  eligibleStorageKeys: string[];
}

/** Czysty wybór kandydatów: bez dysku, bazy i zegara (czas podaje wywołujący). */
export function selectOrphanMediaBlobs(input: {
  diskBlobs: readonly DiskMediaBlob[];
  referencedStorageKeys: Iterable<string>;
  nowMs: number;
  minAgeMs: number;
  ignoredCount?: number;
  ignoredBytes?: number;
}): OrphanMediaReport {
  const referenced = new Set(input.referencedStorageKeys);
  const onDisk = new Set(input.diskBlobs.map((blob) => blob.storageKey));

  let diskBlobBytes = 0;
  let referencedOnDiskCount = 0;
  let referencedOnDiskBytes = 0;
  let eligibleOrphanBytes = 0;
  let youngOrphanCount = 0;
  let youngOrphanBytes = 0;
  const orphanStorageKeys: string[] = [];
  const eligibleStorageKeys: string[] = [];

  for (const blob of input.diskBlobs) {
    diskBlobBytes += blob.byteCount;
    if (referenced.has(blob.storageKey)) {
      referencedOnDiskCount += 1;
      referencedOnDiskBytes += blob.byteCount;
      continue;
    }
    orphanStorageKeys.push(blob.storageKey);
    if (input.nowMs - blob.mtimeMs >= input.minAgeMs) {
      eligibleStorageKeys.push(blob.storageKey);
      eligibleOrphanBytes += blob.byteCount;
    } else {
      youngOrphanCount += 1;
      youngOrphanBytes += blob.byteCount;
    }
  }
  orphanStorageKeys.sort((a, b) => a.localeCompare(b));
  eligibleStorageKeys.sort((a, b) => a.localeCompare(b));

  let missingReferencedCount = 0;
  for (const storageKey of referenced) {
    if (!onDisk.has(storageKey)) missingReferencedCount += 1;
  }

  return {
    diskBlobCount: input.diskBlobs.length,
    diskBlobBytes,
    ignoredCount: input.ignoredCount ?? 0,
    ignoredBytes: input.ignoredBytes ?? 0,
    referencedKeyCount: referenced.size,
    referencedOnDiskCount,
    referencedOnDiskBytes,
    missingReferencedCount,
    orphanCount: orphanStorageKeys.length,
    orphanBytes: eligibleOrphanBytes + youngOrphanBytes,
    eligibleOrphanCount: eligibleStorageKeys.length,
    eligibleOrphanBytes,
    youngOrphanCount,
    youngOrphanBytes,
    orphanStorageKeys,
    eligibleStorageKeys,
  };
}

/** Widok operatora: wyłącznie liczby — bez kluczy, ścieżek i treści mediów. */
export function summarizeOrphanMediaReport(report: OrphanMediaReport): Record<string, number> {
  const { orphanStorageKeys: _keys, eligibleStorageKeys: _eligible, ...numbers } = report;
  return numbers;
}

export interface LocalMediaListing {
  blobs: DiskMediaBlob[];
  ignoredCount: number;
  ignoredBytes: number;
}

/**
 * Enumeruje lokalny wolumen (dwa poziomy: katalog odłamu, plik blobu).
 * Tylko odczyt metadanych; brak katalogu głównego jest błędem wywoławczego
 * (zły `MEDIA_ROOT` ma być widoczny, nie raportowany jako zero sierot).
 */
export async function listLocalMediaBlobs(rootDir: string): Promise<LocalMediaListing> {
  const blobs: DiskMediaBlob[] = [];
  let ignoredCount = 0;
  let ignoredBytes = 0;
  const ignore = async (path: string): Promise<void> => {
    ignoredCount += 1;
    const info = await stat(path).catch(() => null);
    if (info?.isFile()) ignoredBytes += info.size;
  };

  for (const entry of await readdir(rootDir, { withFileTypes: true })) {
    const entryPath = join(rootDir, entry.name);
    if (!entry.isDirectory() || !SHARD_DIR_PATTERN.test(entry.name)) {
      await ignore(entryPath);
      continue;
    }
    for (const file of await readdir(entryPath, { withFileTypes: true })) {
      const filePath = join(entryPath, file.name);
      const storageKey = `${entry.name}/${file.name}`;
      if (!file.isFile() || !isMediaStorageKey(storageKey)) {
        await ignore(filePath);
        continue;
      }
      const info = await stat(filePath);
      blobs.push({ storageKey, byteCount: info.size, mtimeMs: info.mtimeMs });
    }
  }
  blobs.sort((a, b) => a.storageKey.localeCompare(b.storageKey));
  return { blobs, ignoredCount, ignoredBytes };
}

/** Pełny przebieg dry-run dla lokalnego wolumenu i podanych kluczy z bazy. */
export async function reportOrphanMedia(input: {
  rootDir: string;
  referencedStorageKeys: Iterable<string>;
  nowMs: number;
  minAgeMs?: number;
}): Promise<OrphanMediaReport> {
  const listing = await listLocalMediaBlobs(input.rootDir);
  return selectOrphanMediaBlobs({
    diskBlobs: listing.blobs,
    referencedStorageKeys: input.referencedStorageKeys,
    nowMs: input.nowMs,
    minAgeMs: input.minAgeMs ?? DEFAULT_ORPHAN_GRACE_MS,
    ignoredCount: listing.ignoredCount,
    ignoredBytes: listing.ignoredBytes,
  });
}
