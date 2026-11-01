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

/**
 * Pozycje listy `include` matrixa wskazanego joba jako słowniki klucz → wartość
 * (bez cudzysłowów), w kolejności z pliku. Pozycja zaczyna się od `- klucz:`,
 * kolejne klucze są wcięte jak pierwszy klucz pozycji.
 */
export function readCiJobMatrixItems(job: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  let inInclude = false;
  for (const line of readCiJobLines(job)) {
    if (/^\s+include:\s*$/.test(line)) {
      inInclude = true;
      continue;
    }
    if (!inInclude) continue;
    const first = /^(\s+)-\s+([a-z]+):\s*"?([^"#]*?)"?\s*$/.exec(line);
    if (first) {
      items.push({ [first[2]!]: first[3]! });
      continue;
    }
    const field = /^\s+([a-z]+):\s*"?([^"#]*?)"?\s*$/.exec(line);
    // Klucz pozycji jest wcięty głębiej niż `include:`; `steps:` joba kończy listę.
    if (field && items.length > 0 && line.search(/\S/) > 8) {
      items[items.length - 1]![field[1]!] = field[2]!;
      continue;
    }
    if (!/^\s*(#.*)?$/.test(line)) break;
  }
  return items;
}

/** Tekst sekcji wskazanego joba — do sprawdzeń kroków i warunków bramek. */
export function readCiJobText(job: string): string {
  return readCiJobLines(job).join("\n");
}

/** Nazwa wyświetlana joba (`name:` na poziomie joba) — pod nią GitHub raportuje check. */
export function readCiJobName(job: string): string | null {
  for (const line of readCiJobLines(job)) {
    const match = /^ {4}name:\s*(.+?)\s*$/.exec(line);
    if (match) return match[1]!;
  }
  return null;
}
