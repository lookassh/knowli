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
    const text = line.trim();
    if (text === "include:") {
      inInclude = true;
      continue;
    }
    if (!inInclude) continue;
    const first = text.startsWith("- ") ? keyValue(text.slice(2)) : null;
    if (first) {
      items.push({ [first[0]]: first[1] });
      continue;
    }
    const field = keyValue(text);
    // Klucz pozycji jest wcięty głębiej niż `include:`; `steps:` joba kończy listę.
    if (field && items.length > 0 && line.length - line.trimStart().length > 8) {
      items[items.length - 1]![field[0]] = field[1];
      continue;
    }
    if (text !== "" && !text.startsWith("#")) break;
  }
  return items;
}

/** Para `klucz: wartość` z linii matrixa (wartość bez komentarza i cudzysłowów) albo null. */
function keyValue(text: string): [string, string] | null {
  const colon = text.indexOf(":");
  const key = text.slice(0, colon);
  if (colon <= 0 || !/^[a-z]+$/.test(key)) return null;
  const value = text.slice(colon + 1).split("#")[0]!.trim();
  const quoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
  return [key, quoted ? value.slice(1, -1) : value];
}

/** Tekst sekcji wskazanego joba — do sprawdzeń kroków i warunków bramek. */
export function readCiJobText(job: string): string {
  return readCiJobLines(job).join("\n");
}

/** Nazwa wyświetlana joba (`name:` na poziomie joba) — pod nią GitHub raportuje check. */
export function readCiJobName(job: string): string | null {
  // Klucze joba mają wcięcie 4 spacji; głębsze `name:` należą do kroków i matrixa.
  const line = readCiJobLines(job).find((candidate) => candidate.startsWith("    name:"));
  return line === undefined ? null : line.slice("    name:".length).trim();
}
