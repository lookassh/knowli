// Liczy wady per źródło: łączy werdykty (verdicts.csv) z key.json ślepego arkusza.
// Użycie: node tests/probes/blind/score.cjs <key.json> <verdicts.csv> [<verdicts.csv> ...] [<key.json> <verdicts.csv> ...]
//   — każdy key.json zaczyna grupę (temat); następne pliki CSV należą do niej. Jeden sędzia na wywołanie.
//   Gdy klucz ma typy ćwiczeń (arkusz etapu 2), dochodzi raport klas W1–W9: wady / mianownik, odsetek i przedział
//   Wilsona 95% per wariant (źródło `<wariant>-rN`), temat i typ, z licznikami per przebieg (min–max).
// Zgodność dwóch sędziów: node tests/probes/blind/score.cjs --agree <key.json> <verdicts A.csv> <verdicts B.csv>
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

const CLOSED = ["lesson_choice", "lesson_listen_choice", "lesson_short_answer", "lesson_notice", "lesson_order"];
const TEXT = ["lesson_gap", "lesson_error_fix", "lesson_transform", "lesson_open_answer"];
/** Mianowniki klas rubryki etapu 2 (`rubric-stage2.md`, spec etapu 2 §7). */
const CLASS_APPLIES = {
  W1: (row) => CLOSED.includes(row.type),
  W2: (row) => TEXT.includes(row.type),
  W3: (row) => ["lesson_choice", "lesson_short_answer", "lesson_notice"].includes(row.type),
  W4: (row) => TEXT.includes(row.type),
  W5: () => true,
  W6: () => true,
  W7: (row) => row.hasExplanation === true,
  W8: (row) => row.type === "lesson_listen_choice",
  W9: () => true,
};
const CLASSES = Object.keys(CLASS_APPLIES);

const criteriaOf = (verdict) => verdict.criterion.split("|").map((c) => c.trim()).filter(Boolean);

/**
 * Raport etapu 2. `groups`: `{ key, verdicts }[]` (jeden temat na grupę). Rzuca przy powtórzonym `rowId`,
 * werdykcie bez wiersza klucza, `defect` bez klasy albo klasie spoza mianownika; wiersze bez werdyktu raportuje.
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
      const defect = verdict.verdict.trim() === "defect";
      const classes = defect ? criteriaOf(verdict) : [];
      if (defect && classes.length === 0) throw new Error(`defect bez klasy: ${verdict.rowId}`);
      for (const name of classes) {
        if (!CLASS_APPLIES[name]) throw new Error(`nieznana klasa ${name} w ${verdict.rowId}`);
        if (!CLASS_APPLIES[name](row)) throw new Error(`klasa ${name} nie dotyczy typu ${row.type} (${verdict.rowId})`);
      }
      judged.set(verdict.rowId, { classes, level: verdict.level?.trim() ?? "" });
    }
  }
  const missing = [...keyRows.keys()].filter((rowId) => !judged.has(rowId));
  const variantOf = (model) => model.replace(/-r\d+$/u, "");
  const cells = {};
  const add = (scope, name, row, defect) => {
    const cell = ((cells[scope] ??= {})[name] ??= { defects: 0, n: 0, runs: {} });
    cell.n += 1;
    if (defect) cell.defects += 1;
    const run = (cell.runs[row.model] ??= { defects: 0, n: 0 });
    run.n += 1;
    if (defect) run.defects += 1;
  };
  let levels = 0;
  for (const [rowId, verdict] of judged) {
    const row = keyRows.get(rowId);
    if (verdict.level !== "") levels += 1;
    const variant = variantOf(row.model);
    for (const name of CLASSES) {
      if (!CLASS_APPLIES[name](row)) continue;
      const defect = verdict.classes.includes(name);
      add(`${variant}`, name, row, defect);
      add(`${variant} @${topics.get(rowId)}`, name, row, defect);
      add(`${variant} #${row.type}`, name, row, defect);
    }
  }
  const report = {};
  for (const [scope, byClass] of Object.entries(cells)) {
    report[scope] = Object.fromEntries(
      Object.entries(byClass).map(([name, cell]) => {
        const perRun = Object.values(cell.runs).map((run) => run.defects);
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
    const result = agreement(JSON.parse(read(keyArg, "key.json")), parseCsv(read(aArg, "verdicts A")), parseCsv(read(bArg, "verdicts B")));
    for (const [name, cell] of Object.entries(result)) console.log(`${name} zgodność ${(100 * cell.agree).toFixed(1)}% (n=${cell.n}) różne: ${cell.differing.join(",") || "-"}`);
    return;
  }
  const groups = [];
  for (const arg of argv) {
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
  if (missing.length > 0) console.log(`wiersze bez werdyktu (${missing.length}): ${missing.join(",")}`);
  console.log(`uwagi poziomu (level): ${levels}`);
  const pct = (value) => `${(100 * value).toFixed(1)}%`;
  for (const [scope, byClass] of Object.entries(report).sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const cellsText = Object.entries(byClass).map(([name, cell]) => `${name} ${cell.defects}/${cell.n} ${pct(cell.rate)} [${pct(cell.wilson.low)}–${pct(cell.wilson.high)}] przebieg ${cell.perRun.min}–${cell.perRun.max}`);
    console.log(`${scope}: ${cellsText.join(" | ")}`);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { wilson, scoreStage2, agreement, parseCsv, CLASS_APPLIES };
