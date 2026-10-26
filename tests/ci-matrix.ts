import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Numery koszy (`bucket: "N"`) zadeklarowane w matrixie wskazanego joba CI.
 *
 * Kilka jobów w ci.yml używa klucza `bucket` (e2e, integration), więc
 * skanujemy wyłącznie sekcję danego joba: od nagłówka `  <job>:` do
 * kolejnego nagłówka joba na tym samym wcięciu. Strażnicy koszy
 * (spec-projects.test.ts, integration-buckets.test.ts) porównują wynik
 * z listą koszy zdefiniowaną w kodzie.
 */
export function readCiJobBuckets(job: string): number[] {
  const ci = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  const lines = ci.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start === -1) {
    throw new Error(`Brak joba ${job} w .github/workflows/ci.yml`);
  }
  const buckets: number[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^  [a-z][a-z0-9-]*:$/.test(line)) break;
    // Dopuszczalny też zapis `- bucket: "N"` (bucket jako pierwszy klucz
    // pozycji `include`, bez poprzedzającego `name:`).
    const match = /^\s+(?:-\s*)?bucket:\s*"(\d+)"\s*$/.exec(line);
    if (match) buckets.push(Number(match[1]));
  }
  return buckets.sort((a, b) => a - b);
}
