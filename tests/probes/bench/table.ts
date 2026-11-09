import type { BenchRecord } from "./record";
import { SUITE, fixturePath, sha256Of } from "./suite";

const pct = (value: number) => `${(100 * value).toFixed(1).replace(".", ",")}%`;
const usd = (value: number) => value.toFixed(2).replace(".", ",");
const span = (range: { min: number; max: number } | null, format: (value: number) => string) =>
  range === null ? "?" : format(range.min) === format(range.max) ? format(range.min) : `${format(range.min)}–${format(range.max)}`;
const ratio = (values: number[], total: number) => `${values.reduce((sum, value) => sum + value, 0)}/${values.length * total}`;

/** sha256 bieżącego materiału zadań generowania zestawu (znacznik `*`, gdy rekord liczono na innym). */
function currentMaterials(): Map<string, string> {
  const map = new Map<string, string>();
  for (const task of SUITE) if (task.kind === "generation") map.set(task.id, sha256Of(fixturePath(task.material)));
  return map;
}

/** Tabela `tests/probes/results/README.md`: sekcja na sędziego (wyniki różnych sędziów są nieporównywalne), wiersz = zadanie, kolumna = rekord. */
export function renderTable(records: BenchRecord[], materials: Map<string, string> = currentMaterials()): string {
  const sorted = [...records].sort((a, b) => a.judge.localeCompare(b.judge, "en") || a.label.localeCompare(b.label, "en"));
  const lines = [
    "# Wyniki benchmarka modeli lekcji",
    "",
    "> Generowane przez `pnpm bench table` z plików `*.json` w tym katalogu — nie edytuj ręcznie. Instrukcja: [`../README.md`](../README.md).",
    "",
    "Komórka: publikowalne lekcje / przebiegi · odsetek wierszy z wadą (dowolna klasa W1–W9 rubryki) z przedziałem Wilsona 95% · koszt lekcji z rejestru.",
    "Przy 60–150 wierszach na zadanie różnice kilku punktów procentowych mieszczą się w przedziałach — porównuj przedziały, nie same odsetki.",
    "Koszt 0 przy dostawcy z kluczem właściciela (BYOK) nie oznacza darmowego biegu: tokeny są w rekordzie.",
  ];
  let marked = false;
  for (const judge of [...new Set(sorted.map((record) => record.judge))]) {
    const group = sorted.filter((record) => record.judge === judge);
    const tasks = [...new Set(group.flatMap((record) => Object.keys(record.generation)))].sort((a, b) => a.localeCompare(b, "en"));
    lines.push("", `## Sędzia \`${judge}\``, "", `| zadanie | ${group.map((record) => record.label).join(" | ")} |`, `|---|${group.map(() => "---").join("|")}|`);
    for (const task of tasks) {
      const cells = group.map((record) => {
        const entry = record.generation[task];
        if (entry === undefined) return "—";
        const other = entry.materialSha256 !== null && materials.has(task) && materials.get(task) !== entry.materialSha256;
        if (other) marked = true;
        const defect = entry.anyDefect;
        return `pub ${entry.publishable}/${entry.runs} · wady ${pct(defect.rate)} [${pct(defect.low)}–${pct(defect.high)}] n=${defect.n} · ${span(entry.costUsd, usd)} USD${other ? " *" : ""}`;
      });
      lines.push(`| ${task} | ${cells.join(" | ")} |`);
    }
    lines.push("", "Rekordy:", "");
    for (const record of group) {
      const models = Object.entries(record.models).map(([name, value]) => `${name} \`${value}\``).join(", ");
      const routing = Object.entries(record.routing).map(([name, value]) => `${name}=${value}`).join(", ");
      lines.push(`- **${record.label}** (${record.date}) — commit \`${record.commit}\`${record.dirty ? ` + niezacommitowane zmiany (diff ${record.diffSha256?.slice(0, 12)})` : ""}; ${models}${routing ? `; routing: ${routing}` : ""}${record.judgeVersion ? `; sędzia ${record.judgeVersion}` : ""}.${record.note ? ` ${record.note}` : ""}`);
    }
  }
  if (marked) lines.push("", "\\* Materiał zadania inny niż bieżący plik w `tests/probes/fixtures` (sha256) — wynik nieporównywalny z nowymi biegami.");
  const gold = new Map<string, string>();
  for (const record of sorted) {
    for (const [task, entry] of Object.entries(record.gold)) {
      gold.set(`${record.label}\u0000${task}`, `| ${task} | ${record.label} | \`${entry.model}\` | ${entry.reps} | ${ratio(entry.correctRejected, entry.correctTotal)} | ${ratio(entry.wrongKeyDetected, entry.wrongKeyTotal)} | ${ratio(entry.secondCorrectDetected, entry.secondCorrectTotal)} (${entry.secondCorrectDetected.join(", ")}) |`);
    }
  }
  if (gold.size > 0) {
    lines.push(
      "",
      "## Kontrola zadań zamkniętych (ćwiczenia wzorcowe)",
      "",
      "Suma po powtórzeniach. Cel z `closed-check-gold.probe.test.ts`: zły klucz zawsze wykryty, druga poprawna odpowiedź ≥ 80%, poprawne odrzucone ≤ 10%.",
      "",
      "| zadanie | rekord | model kontroli | powtórzenia | poprawne odrzucone | zły klucz wykryty | druga poprawna wykryta (per powtórzenie) |",
      "|---|---|---|---|---|---|---|",
      ...[...gold.entries()].sort(([a], [b]) => a.localeCompare(b, "en")).map(([, row]) => row),
    );
  }
  return `${lines.join("\n")}\n`;
}
