import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Linie sekcji wskazanego joba w ci.yml: od nagłówka `  <job>:` do kolejnego
 * nagłówka joba na tym samym wcięciu. Kilka jobów używa tych samych kluczy
 * matrixa (`bucket` w e2e i integration), więc odczyty dotyczą tylko jednej sekcji.
 */
function readCiJobLines(job: string): string[] {
  const ci = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  const lines = ci.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start === -1) {
    throw new Error(`Brak joba ${job} w .github/workflows/ci.yml`);
  }
  const end = lines.findIndex((line, index) => index > start && /^  [a-z][a-z0-9-]*:$/.test(line));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

/**
 * Numery koszy (`bucket: "N"`) zadeklarowane w matrixie wskazanego joba CI.
 * Strażnicy koszy (spec-projects.test.ts, integration-buckets.test.ts)
 * porównują wynik z listą koszy zdefiniowaną w kodzie.
 */
export function readCiJobBuckets(job: string): number[] {
  const buckets: number[] = [];
  for (const line of readCiJobLines(job)) {
    // Dopuszczalny też zapis `- bucket: "N"` (bucket jako pierwszy klucz
    // pozycji `include`, bez poprzedzającego `name:`).
    const match = /^\s+(?:-\s*)?bucket:\s*"(\d+)"\s*$/.exec(line);
    if (match) buckets.push(Number(match[1]));
  }
  return buckets.sort((a, b) => a - b);
}

/** Shardy Playwrighta (`shard: "k/N"`) zadeklarowane w matrixie wskazanego joba CI, w kolejności z pliku. */
export function readCiJobShards(job: string): string[] {
  return readCiJobLines(job)
    .map((line) => /^\s+(?:-\s*)?shard:\s*"(\d+\/\d+)"\s*$/.exec(line)?.[1])
    .filter((shard): shard is string => shard !== undefined);
}

/** Nazwa wyświetlana joba (`name:` na poziomie joba) — pod nią GitHub raportuje check. */
export function readCiJobName(job: string): string | null {
  for (const line of readCiJobLines(job)) {
    const match = /^ {4}name:\s*(.+?)\s*$/.exec(line);
    if (match) return match[1]!;
  }
  return null;
}
