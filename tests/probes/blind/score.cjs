// Liczy wady per źródło: łączy werdykty (verdicts.csv) z key.json ślepego arkusza.
// Użycie: node tests/probes/blind/score.cjs <key.json> <verdicts.csv> [<verdicts.csv> ...] [<key.json> <verdicts.csv> ...]
//   — każdy key.json zaczyna grupę (temat); następne pliki CSV należą do niej. Jeden sędzia na wywołanie.
//   Gdy klucz ma typy ćwiczeń (arkusz etapu 2), dochodzi raport klas W1–W9: wady / mianownik, odsetek i przedział
//   Wilsona 95% per wariant (źródło `<wariant>-rN`), temat i typ, z licznikami per przebieg (min–max; przebieg = temat + źródło).
// Zgodność dwóch sędziów: node tests/probes/blind/score.cjs --agree <key.json> <A1.csv[,A2.csv…]> <B1.csv[,B2.csv…]>
const fs = require("fs");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])));
}

/** Przedział Wilsona 95% dla `defects` wad na `n` (n = 0 → [0, 1]). */
function wilson(defects, n) {
  if (n === 0) return { low: 0, high: 1 };
  const z = 1.96;
  const p = defects / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (centre - margin) / denominator), high: Math.min(1, (centre + margin) / denominator) };
}

// Etap 5 (`rubric-stage5.md`): także ćwiczenia z przypisaniem rozdziału (match, group, cloze).
const CLOSED = ["lesson_choice", "lesson_listen_choice", "lesson_short_answer", "lesson_notice", "lesson_order", "lesson_match", "lesson_group", "lesson_cloze"];
const TEXT = ["lesson_gap", "lesson_error_fix", "lesson_transform", "lesson_open_answer"];
/** Mianowniki klas rubryk etapu 2 i 5 (`rubric-stage2.md`, `rubric-stage5.md`; spec etapu 2 §7, etapu 5 §7.4). */
const CLASS_APPLIES = {
  W1: (row) => CLOSED.includes(row.type),
  W2: (row) => TEXT.includes(row.type),
  W3: (row) => ["lesson_choice", "lesson_short_answer", "lesson_notice", "lesson_match", "lesson_group", "lesson_cloze"].includes(row.type),
  W4: (row) => TEXT.includes(row.type),
  W5: () => true,
  W6: () => true,
  W7: (row) => row.hasExplanation === true,
  W8: (row) => row.type === "lesson_listen_choice",
  W9: () => true,
};
const CLASSES = Object.keys(CLASS_APPLIES);

const criteriaOf = (verdict) => verdict.criterion.split("|").map((c) => c.trim()).filter(Boolean);
const LEVELS = ["", "too_hard", "too_easy"];

/** Kształt werdyktu (etap 2): `ok` bez klasy, `defect` z klasą, `level` z listy; inaczej opis błędu. */
function verdictProblem(verdict) {
  const value = verdict.verdict.trim();
  if (value !== "ok" && value !== "defect") return `werdykt „${value}” spoza ok/defect`;
  if (value === "ok" && criteriaOf(verdict).length > 0) return "ok z klasą";
  if (value === "defect" && criteriaOf(verdict).length === 0) return "defect bez klasy";
  if (!LEVELS.includes(verdict.level?.trim() ?? "")) return `nieznany level „${verdict.level}”`;
  return undefined;
}

/**
 * Raport etapu 2. `groups`: `{ key, verdicts }[]` (jeden temat na grupę). Rzuca przy powtórzonym `rowId`,
 * werdykcie bez wiersza klucza, złym kształcie werdyktu (`verdictProblem`) albo klasie spoza mianownika; wiersze bez werdyktu raportuje.
 */
function scoreStage2(groups) {
  const keyRows = new Map();
  const topics = new Map();
  for (const group of groups) {
    for (const row of group.key.rows) {
      if (keyRows.has(row.rowId)) throw new Error(`powtórzony rowId ${row.rowId}`);
      keyRows.set(row.rowId, row);
      topics.set(row.rowId, group.key.prefix || "-");
    }
  }
  const judged = new Map();
  for (const group of groups) {
    for (const verdict of group.verdicts) {
      const row = keyRows.get(verdict.rowId);
      if (row === undefined) throw new Error(`werdykt bez wiersza klucza: ${verdict.rowId}`);
      if (judged.has(verdict.rowId)) throw new Error(`dwa werdykty wiersza ${verdict.rowId}`);
      const problem = verdictProblem(verdict);
      if (problem !== undefined) throw new Error(`${problem}: ${verdict.rowId}`);
      const defect = verdict.verdict.trim() === "defect";
      const classes = defect ? criteriaOf(verdict) : [];
      for (const name of classes) {
        if (!CLASS_APPLIES[name]) throw new Error(`nieznana klasa ${name} w ${verdict.rowId}`);
        if (!CLASS_APPLIES[name](row)) throw new Error(`klasa ${name} nie dotyczy typu ${row.type} (${verdict.rowId})`);
      }
      judged.set(verdict.rowId, { classes, level: verdict.level?.trim() ?? "" });
    }
  }
  const missing = [...keyRows.keys()].filter((rowId) => !judged.has(rowId));
  const variantOf = (model) => model.replace(/-r\d+$/u, "");
  // Przebieg = temat + katalog źródła (ten sam `baseline-r1` w trzech tematach to trzy przebiegi).
  const runOf = (rowId) => `${topics.get(rowId)}/${keyRows.get(rowId).model}`;
  const runsOfVariant = {};
  for (const [rowId, row] of keyRows) (runsOfVariant[variantOf(row.model)] ??= new Set()).add(runOf(rowId));
  const cells = {};
  const add = (scope, variant, name, rowId, defect) => {
    const cell = ((cells[scope] ??= {})[name] ??= { defects: 0, n: 0, runs: {}, variant });
    cell.n += 1;
    if (defect) cell.defects += 1;
    cell.runs[runOf(rowId)] = (cell.runs[runOf(rowId)] ?? 0) + (defect ? 1 : 0);
  };
  const levels = {};
  for (const [rowId, verdict] of judged) {
    const row = keyRows.get(rowId);
    const variant = variantOf(row.model);
    if (verdict.level !== "") {
      const key = `${variant} @${topics.get(rowId)} ${verdict.level}`;
      levels[key] = (levels[key] ?? 0) + 1;
    }
    for (const name of CLASSES) {
      if (!CLASS_APPLIES[name](row)) continue;
      const defect = verdict.classes.includes(name);
      add(`${variant}`, variant, name, rowId, defect);
      add(`${variant} @${topics.get(rowId)}`, variant, name, rowId, defect);
      add(`${variant} #${row.type}`, variant, name, rowId, defect);
    }
  }
  const report = {};
  for (const [scope, byClass] of Object.entries(cells)) {
    report[scope] = Object.fromEntries(
      Object.entries(byClass).map(([name, cell]) => {
        // Przebiegi wariantu bez wierszy w komórce liczą się jako 0 wad (min nie pomija pustych przebiegów zakresu).
        const scopeRuns = scope.includes(" @") ? [...runsOfVariant[cell.variant]].filter((run) => run.startsWith(`${scope.split(" @")[1]}/`)) : [...runsOfVariant[cell.variant]];
        const perRun = scopeRuns.map((run) => cell.runs[run] ?? 0);
        return [name, { defects: cell.defects, n: cell.n, rate: cell.n === 0 ? 0 : cell.defects / cell.n, wilson: wilson(cell.defects, cell.n), perRun: { min: Math.min(...perRun), max: Math.max(...perRun) } }];
      }),
    );
  }
  return { report, missing, levels };
}

/** Zgodność dwóch sędziów per klasa: odsetek wierszy (z mianownika klasy), na których obaj zgodnie wskazali albo nie wskazali klasy. */
function agreement(key, verdictsA, verdictsB) {
  const a = new Map(verdictsA.map((row) => [row.rowId, row]));
  const b = new Map(verdictsB.map((row) => [row.rowId, row]));
  const result = {};
  for (const name of CLASSES) {
    let same = 0;
    let n = 0;
    const differing = [];
    for (const row of key.rows) {
      if (!CLASS_APPLIES[name](row) || !a.has(row.rowId) || !b.has(row.rowId)) continue;
      const inA = a.get(row.rowId).verdict.trim() === "defect" && criteriaOf(a.get(row.rowId)).includes(name);
      const inB = b.get(row.rowId).verdict.trim() === "defect" && criteriaOf(b.get(row.rowId)).includes(name);
      n += 1;
      if (inA === inB) same += 1;
      else differing.push(row.rowId);
    }
    result[name] = { agree: n === 0 ? 1 : same / n, n, differing };
  }
  return result;
}

function legacy(key, verdicts) {
  const sourceOf = new Map(key.rows.map((row) => [row.rowId, row.model]));
  const stats = {};
  const missing = [];
  for (const row of verdicts) {
    const source = sourceOf.get(row.rowId);
    if (!source) { missing.push(row.rowId); continue; }
    const entry = (stats[source] ??= { rows: 0, defects: 0, k5: 0, nonK5: 0, criteria: {} });
    entry.rows += 1;
    if (row.verdict.trim() === "defect") {
      entry.defects += 1;
      const criteria = criteriaOf(row);
      for (const criterion of criteria) entry.criteria[criterion] = (entry.criteria[criterion] ?? 0) + 1;
      if (criteria.includes("K5")) entry.k5 += 1;
      if (criteria.some((c) => c !== "K5")) entry.nonK5 += 1;
    }
  }
  console.log(`ocenione wiersze: ${verdicts.length} z ${key.rows.length}${missing.length ? `; bez klucza: ${missing.join(",")}` : ""}`);
  for (const [source, entry] of Object.entries(stats)) {
    const pct = (n) => ((100 * n) / entry.rows).toFixed(1);
    console.log(`${source.padEnd(46)} ${String(entry.rows).padStart(3)} ćw. | wady ${entry.defects} | poza K5 ${entry.nonK5} (${pct(entry.nonK5)}%) | K5 ${entry.k5} | ${JSON.stringify(entry.criteria)}`);
  }
}

function main(argv) {
  const { probePath } = require("./paths.cjs");
  const read = (arg, name) => fs.readFileSync(probePath(arg, name), "utf8");
  if (argv[0] === "--agree") {
    const [, keyArg, aArg, bArg] = argv;
    const many = (list, name) => list.split(",").flatMap((file) => parseCsv(read(file, name)));
    const result = agreement(JSON.parse(read(keyArg, "key.json")), many(aArg, "verdicts A"), many(bArg, "verdicts B"));
    for (const [name, cell] of Object.entries(result)) console.log(`${name} zgodność ${(100 * cell.agree).toFixed(1)}% (n=${cell.n}) różne: ${cell.differing.join(",") || "-"}`);
    return;
  }
  const groups = [];
  for (const arg of argv.filter((value) => value !== "--allow-missing")) {
    if (arg.endsWith(".json")) groups.push({ key: JSON.parse(read(arg, "key.json")), verdicts: [] });
    else if (groups.length === 0) throw new Error("pierwszy argument to key.json");
    else groups.at(-1).verdicts.push(...parseCsv(read(arg, "verdicts.csv")));
  }
  if (groups.length === 0) throw new Error("brak key.json");
  if (!groups.every((group) => group.key.rows.every((row) => typeof row.type === "string"))) {
    for (const group of groups) legacy(group.key, group.verdicts);
    return;
  }
  const { report, missing, levels } = scoreStage2(groups);
  // Wiersze bez werdyktu wypadłyby z mianowników: bramka liczy się tylko z kompletnej oceny.
  if (missing.length > 0 && !argv.includes("--allow-missing")) throw new Error(`wiersze bez werdyktu (${missing.length}): ${missing.join(",")}`);
  console.log(`uwagi poziomu (level): ${JSON.stringify(levels)}`);
  const pct = (value) => `${(100 * value).toFixed(1)}%`;
  for (const [scope, byClass] of Object.entries(report).sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const cellsText = Object.entries(byClass).map(([name, cell]) => `${name} ${cell.defects}/${cell.n} ${pct(cell.rate)} [${pct(cell.wilson.low)}–${pct(cell.wilson.high)}] przebieg ${cell.perRun.min}–${cell.perRun.max}`);
    console.log(`${scope}: ${cellsText.join(" | ")}`);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { wilson, scoreStage2, agreement, parseCsv, CLASS_APPLIES, verdictProblem };
