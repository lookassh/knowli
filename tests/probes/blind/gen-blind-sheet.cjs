// Ślepy arkusz porównania generatorów: ćwiczenia wszystkich źródeł jednej lekcji, wymieszane.
// Użycie: node tests/probes/blind/gen-blind-sheet.cjs <katalog lekcji POZA repozytorium: podkatalog per źródło z dump.json> <seed> [prefiks wierszy] [katalog sędziego]
// Wynik: <katalog>\blind\sheet.csv i <katalog>\blind\key.json (rowId → źródło, indeks, typ, wyjaśnienie; istniejący klucz nie jest
// nadpisywany) oraz katalog sędziego (domyślnie <katalog>\judge; dla ślepoty podaj neutralną ścieżkę POZA drzewem tematu) —
// jedyny katalog dla sędziego: sheet.csv, material.txt (gdy zrzut ma materiał), rubric-stage2.md.
// Zrzuty jednego arkusza muszą mieć te same modele, wysiłek, wejście, pulę i grader, a nazwa katalogu `<wariant>-rN` — pole `variant`.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { probePath } = require("./paths.cjs");

const [, , lessonDirArg, seed = "gen-compare", prefix = "", judgeDirArg] = process.argv;
const lessonDir = probePath(lessonDirArg, "katalog lekcji");
const judgeDir = judgeDirArg === undefined ? path.join(lessonDir, "judge") : probePath(judgeDirArg, "katalog sędziego");
if (fs.existsSync(path.join(lessonDir, "blind", "key.json"))) throw new Error(`${path.join(lessonDir, "blind", "key.json")} już istnieje — klucz ocenionego arkusza nie jest nadpisywany`);
// `readdirSync` nie gwarantuje kolejności — sortujemy, żeby ten sam seed dawał ten sam arkusz na każdym systemie.
const candidates = fs
  .readdirSync(lessonDir)
  .filter((name) => fs.existsSync(path.join(lessonDir, name, "dump.json")))
  .sort((a, b) => a.localeCompare(b, "en"));
const models = [];
let material;

function rng(seedText) {
  let state = crypto.createHash("sha256").update(seedText).digest().readUInt32LE(0) || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
}

const rows = [];
const SAME_FIELDS = ["modelId", "solverId", "effort", "poolSize", "graderAvailable"];
let reference;
for (const model of candidates) {
  const dump = JSON.parse(fs.readFileSync(path.join(lessonDir, model, "dump.json"), "utf8"));
  // Zrzut nieudanej próby (`{ ...header, errors }`) nie ma ćwiczeń — pomijamy źródło, reszta arkusza powstaje.
  if (!Array.isArray(dump.exercises)) {
    console.log(`pominięte źródło bez ćwiczeń: ${model}`);
    continue;
  }
  models.push(model);
  // Uczciwość porównania: te same modele i wejście we wszystkich źródłach arkusza, wariant zgodny z katalogiem.
  if (dump.variant !== undefined && model.replace(/-r\d+$/u, "") !== dump.variant) throw new Error(`${model}: katalog nie pasuje do wariantu ${dump.variant}`);
  const config = JSON.stringify([...SAME_FIELDS.map((field) => dump[field]), dump.input?.sha256]);
  if (reference === undefined) reference = { model, config };
  else if (config !== reference.config) throw new Error(`${model}: inna konfiguracja niż ${reference.model} (${SAME_FIELDS.join(", ")}, input)`);
  if (material === undefined && typeof dump.material === "string") material = dump.material;
  const objectives = new Map((dump.objectives ?? []).map((objective) => [String(objective.id).split(".").at(-1), objective]));
  dump.exercises.forEach((exercise, index) => {
    const slug = String(exercise.objectiveId ?? "").split(".").at(-1);
    const objective = objectives.get(slug);
    const context = objective
      ? { title: objective.title, descriptionEn: objective.descriptionEn ?? null, kind: objective.kind ?? null, card: objective.card, examples: objective.examples ?? [] }
      : null;
    rows.push({ model, index, subject: dump.subjectId, exercise, context });
  });
}

const random = rng(seed);
for (let i = rows.length - 1; i > 0; i -= 1) {
  const j = Math.floor(random() * (i + 1));
  [rows[i], rows[j]] = [rows[j], rows[i]];
}

const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;

/**
 * Treść ćwiczenia bez metadanych zdradzających źródło: bez `id` (`ex<N>` agenta, UUID potoku), `revisionId` i pól
 * `*Audio`, temat w `objectiveId` obcięty do członu zagadnienia, klucze w porządku alfabetycznym (ten sam szkic
 * w innej kolejności pól daje tę samą komórkę).
 */
function blindContent(exercise) {
  const content = {};
  for (const field of Object.keys(exercise ?? {}).sort()) {
    if (field === "id" || field === "revisionId" || field.endsWith("Audio")) continue;
    const value = exercise[field];
    content[field] = field === "objectiveId" ? String(value ?? "").split(".").at(-1) : value;
  }
  return content;
}
const header = ["rowId", "subject", "objective", "exercise", "verdict", "criterion", "level", "adjudicatorNote"];
const lines = [header.join(",")];
const key = { seed, prefix, models, rows: [] };
rows.forEach((row, position) => {
  const rowId = `${prefix ? `${prefix}-` : ""}r${String(position + 1).padStart(3, "0")}`;
  lines.push([rowId, row.subject, quote(JSON.stringify(row.context)), quote(JSON.stringify(blindContent(row.exercise))), "", "", "", ""].join(","));
  const hasExplanation = typeof row.exercise?.explanationPl === "string" && row.exercise.explanationPl.trim() !== "";
  key.rows.push({ rowId, model: row.model, index: row.index, type: row.exercise?.exerciseType ?? "unknown", hasExplanation });
});

const outDir = path.join(lessonDir, "blind");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "sheet.csv"), `${lines.join("\n")}\n`);
fs.writeFileSync(path.join(outDir, "key.json"), JSON.stringify(key, null, 1));
fs.mkdirSync(judgeDir, { recursive: true });
fs.writeFileSync(path.join(judgeDir, "sheet.csv"), `${lines.join("\n")}\n`);
fs.copyFileSync(path.join(__dirname, "rubric-stage2.md"), path.join(judgeDir, "rubric-stage2.md"));
if (material !== undefined) fs.writeFileSync(path.join(judgeDir, "material.txt"), `${material}\n`);
console.log(`models=${models.length} rows=${rows.length} → ${outDir}, sędzia: ${judgeDir}`);
