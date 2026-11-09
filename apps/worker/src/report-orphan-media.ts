import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase, reportOrphanMediaBlobs, summarizeOrphanMediaReport } from "@learning/server";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Argumenty raportu dry-run sierot mediów (#386). Nie ma trybu kasowania:
 * każda nieznana opcja (w tym `--delete`/`--apply`) jest błędem użycia.
 */
export function parseOrphanReportArgs(args: readonly string[]): { minAgeMs?: number } {
  let minAgeMs: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--min-age-days") {
      const raw = args[index + 1];
      const days = raw === undefined ? Number.NaN : Number(raw);
      if (minAgeMs !== undefined || !Number.isFinite(days) || days < 0) throw new Error("Invalid arguments");
      minAgeMs = days * DAY_MS;
      index += 1;
    } else {
      throw new Error("Invalid arguments");
    }
  }
  return minAgeMs === undefined ? {} : { minAgeMs };
}

async function main(): Promise<void> {
  const options = parseOrphanReportArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  const { db, pool } = createDatabase(databaseUrl);
  try {
    const report = await reportOrphanMediaBlobs(db, {
      rootDir: process.env.MEDIA_ROOT ?? "./data/media",
      nowMs: Date.now(),
      ...options,
    });
    // wyłącznie liczby: bez kluczy, ścieżek i treści mediów.
    process.stdout.write(`${JSON.stringify(summarizeOrphanMediaReport(report), null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    if (error instanceof Error && error.message === "DATABASE_URL is not configured") {
      process.stderr.write("DATABASE_URL is not configured\n");
    } else if (error instanceof Error && error.message === "Invalid arguments") {
      process.stderr.write("Usage: media:orphan-report [--min-age-days <dni>]\n");
    } else {
      process.stderr.write("Orphan media report failed. Check the database and MEDIA_ROOT.\n");
    }
    process.exitCode = 1;
  });
}
