import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_ORPHAN_GRACE_MS,
  listLocalMediaBlobs,
  reportOrphanMedia,
  selectOrphanMediaBlobs,
  summarizeOrphanMediaReport,
  type DiskMediaBlob,
} from "./orphan-report";

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function key(hashChar: string, ext = "mp3"): string {
  const hash = hashChar.repeat(64);
  return `${hash.slice(0, 2)}/${hash}.${ext}`;
}

function blob(storageKey: string, byteCount: number, ageMs: number): DiskMediaBlob {
  return { storageKey, byteCount, mtimeMs: NOW - ageMs };
}

describe("selectOrphanMediaBlobs", () => {
  it("powiązane bloby nigdy nie są kandydatami, niezależnie od wieku", () => {
    const referenced = key("a");
    const report = selectOrphanMediaBlobs({
      diskBlobs: [blob(referenced, 100, 365 * DAY_MS), blob(key("b"), 50, 30 * DAY_MS)],
      referencedStorageKeys: [referenced],
      nowMs: NOW,
      minAgeMs: 7 * DAY_MS,
    });
    expect(report.orphanStorageKeys).toEqual([key("b")]);
    expect(report.eligibleStorageKeys).toEqual([key("b")]);
    expect(report.referencedOnDiskCount).toBe(1);
    expect(report.referencedOnDiskBytes).toBe(100);
  });

  it("młode sieroty są raportowane osobno i nie trafiają do kandydatów po karencji", () => {
    const young = key("c");
    const boundary = key("d");
    const report = selectOrphanMediaBlobs({
      diskBlobs: [blob(young, 10, 6 * DAY_MS), blob(boundary, 20, 7 * DAY_MS)],
      referencedStorageKeys: [],
      nowMs: NOW,
      minAgeMs: 7 * DAY_MS,
    });
    expect(report.orphanCount).toBe(2);
    expect(report.orphanBytes).toBe(30);
    expect(report.eligibleStorageKeys).toEqual([boundary]);
    expect(report.youngOrphanCount).toBe(1);
    expect(report.youngOrphanBytes).toBe(10);
  });

  it("duplikaty referencji i referencje bez pliku liczy raz, jako brakujące", () => {
    const present = key("e");
    const missing = key("f");
    const report = selectOrphanMediaBlobs({
      diskBlobs: [blob(present, 7, DAY_MS)],
      referencedStorageKeys: [present, present, missing, missing],
      nowMs: NOW,
      minAgeMs: 0,
    });
    expect(report.referencedKeyCount).toBe(2);
    expect(report.missingReferencedCount).toBe(1);
    expect(report.orphanCount).toBe(0);
  });

  it("podsumowanie zawiera wyłącznie liczby — bez kluczy i ścieżek", () => {
    const report = selectOrphanMediaBlobs({
      diskBlobs: [blob(key("b"), 50, 30 * DAY_MS)],
      referencedStorageKeys: [],
      nowMs: NOW,
      minAgeMs: DEFAULT_ORPHAN_GRACE_MS,
    });
    const summary = summarizeOrphanMediaReport(report);
    expect(Object.values(summary).every((value) => typeof value === "number")).toBe(true);
    expect(JSON.stringify(summary)).not.toContain(key("b"));
    expect(summary.orphanCount).toBe(1);
    expect(summary.orphanBytes).toBe(50);
  });
});

describe("listLocalMediaBlobs + reportOrphanMedia (katalog tymczasowy)", () => {
  let root = "";

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("enumeruje wyłącznie pliki o kształcie klucza, resztę liczy jako pominiętą i niczego nie usuwa", async () => {
    root = await mkdtemp(join(tmpdir(), "knowli-orphans-"));
    const referencedKey = key("a", "png");
    const orphanKey = key("b");
    const youngKey = key("c", "webp");
    for (const storageKey of [referencedKey, orphanKey, youngKey]) {
      const path = join(root, storageKey);
      await mkdir(join(root, storageKey.slice(0, 2)), { recursive: true });
      await writeFile(path, Buffer.from(`bytes-${storageKey.slice(3, 4)}`));
    }
    const old = new Date(NOW - 30 * DAY_MS);
    const young = new Date(NOW - DAY_MS);
    await utimes(join(root, referencedKey), old, old);
    await utimes(join(root, orphanKey), old, old);
    await utimes(join(root, youngKey), young, young);
    // Plik tymczasowy trwającego/porzuconego zapisu i obcy plik w katalogu głównym.
    await writeFile(join(root, orphanKey.slice(0, 2), `.${orphanKey.slice(3)}.abc.tmp`), "partial");
    await writeFile(join(root, "README.txt"), "not a blob");

    const listing = await listLocalMediaBlobs(root);
    expect(listing.blobs.map((entry) => entry.storageKey).sort()).toEqual(
      [referencedKey, orphanKey, youngKey].sort(),
    );
    expect(listing.ignoredCount).toBe(2);

    const before = await readdir(join(root, orphanKey.slice(0, 2)));
    const report = await reportOrphanMedia({
      rootDir: root,
      referencedStorageKeys: [referencedKey],
      nowMs: NOW,
      minAgeMs: 7 * DAY_MS,
    });
    expect(report.eligibleStorageKeys).toEqual([orphanKey]);
    expect(report.youngOrphanCount).toBe(1);
    expect(report.orphanCount).toBe(2);
    expect(report.ignoredCount).toBe(2);

    // Dry-run: po raporcie wszystkie pliki — także kandydaci — są nietknięte.
    expect(await readdir(join(root, orphanKey.slice(0, 2)))).toEqual(before);
    expect((await readFile(join(root, orphanKey))).byteLength).toBeGreaterThan(0);
    expect((await readFile(join(root, youngKey))).byteLength).toBeGreaterThan(0);
  });
});
