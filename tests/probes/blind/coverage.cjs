// Pokrycie materiału rozdziału i ujawnienia ze zrzutów puli (spec etapu 5 §7.5 pkt 1 i 6), offline dla obu ramion.
// Użycie: node tests/probes/blind/coverage.cjs <forms.txt> <dump.json> [<dump.json>…]
// forms.txt: jedna pozycja materiału na linię, alternatywy po „|” (np. „boots|boot”). Pozycja jest pokryta, gdy któraś
// alternatywa występuje (bez wielkości liter, na granicach słów) w kartach albo w polach ćwiczeń szkicu.
// Ujawnienia: `exposureLeaks` zrzutu (raport szkicu w trybie pokrycia) — każde > 0 to błąd ścieżki zapisu.
const fs = require("fs");

/** Pozycje formularza: lista alternatyw, puste linie pominięte. */
function parseForms(text) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => line.split("|").map((form) => form.trim()).filter((form) => form !== ""));
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Czy forma stoi w tekście jako całe słowo (litery i cyfry po bokach przerywają dopasowanie). */
function mentions(haystack, form) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(form.toLowerCase())}($|[^\\p{L}\\p{N}])`, "u").test(haystack);
}

/** Wszystkie napisy obiektu (rekurencyjnie), złączone; apostrofy ujednolicone. */
function strings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Pola ćwiczenia poza pomiarem: identyfikatory (slug zagadnienia) i polskie teksty dla dziecka (spec §7.5 pkt 6). */
const SKIPPED_FIELDS = new Set(["id", "revisionId", "objectiveId", "instructionPl", "prompt", "explanationPl", "hint"]);

/** Angielskie pola ćwiczenia (bez identyfikatorów i polskich tekstów). */
function englishFields(exercise) {
  return Object.entries(exercise ?? {}).filter(([field]) => !SKIPPED_FIELDS.has(field)).flatMap(([, value]) => strings(value));
}

/** Braki pokrycia jednego zrzutu: pozycje bez żadnej alternatywy w kartach i angielskich polach ćwiczeń. */
function coverageOf(forms, dump) {
  const cards = (dump.objectives ?? []).flatMap((objective) => [objective.card ?? "", ...strings(objective.cards ?? [])]);
  const haystack = [...cards, ...(dump.exercises ?? []).flatMap(englishFields)].join("\n").toLowerCase().replace(/[’‘]/gu, "'");
  const missing = forms.filter((alternatives) => !alternatives.some((form) => mentions(haystack, form.replace(/[’‘]/gu, "'"))));
  return { total: forms.length, missing: missing.map((alternatives) => alternatives[0]), leaks: (dump.exposureLeaks ?? []).length };
}

if (require.main === module) {
  const [, , formsPath, ...dumps] = process.argv;
  if (formsPath === undefined || dumps.length === 0) throw new Error("użycie: coverage.cjs <forms.txt> <dump.json>…");
  const forms = parseForms(fs.readFileSync(formsPath, "utf8"));
  let leaks = 0;
  for (const dumpPath of dumps) {
    const result = coverageOf(forms, JSON.parse(fs.readFileSync(dumpPath, "utf8")));
    leaks += result.leaks;
    console.log(`${dumpPath}: braki ${result.missing.length}/${result.total}${result.missing.length > 0 ? ` (${result.missing.join(", ")})` : ""}; ujawnienia ${result.leaks}`);
  }
  if (leaks > 0) process.exitCode = 1;
}

module.exports = { parseForms, mentions, coverageOf };
