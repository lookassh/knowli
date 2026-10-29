/**
 * Ewaluacja gradera szkolnego (Etap 2) na złotym zestawie
 * `.kiro/specs/school-subjects/grader-golden-set.json`.
 *
 * Uruchomienie:
 *   corepack pnpm eval:school-grader            # prawdziwy model z .env (UMIEM_GRADER_*)
 *   corepack pnpm eval:school-grader -- --fake  # heurystyka fake (tylko sanity pipeline'u)
 *
 * Bramka (prawdziwy model): przypadki kategorii twardych (słowa kluczowe przy
 * błędnej zależności, istotny błąd rzeczowy) muszą dać wiedzę `incorrect`,
 * zgodność wymiaru wiedzy ≥ 90%, zgodność brakujących elementów ≥ 90%
 * (dla przypadków z oczekiwaną listą) i zero werdyktów odrzuconych przez
 * walidator. Precyzja i forma są raportowane, nie bramkują.
 * Zestaw zawiera wyłącznie fikcyjne odpowiedzi — brak danych dzieci.
 */
import { readFileSync } from "node:fs";
import { graderFromEnv } from "../packages/server/src/config";
import {
  countSentences,
  validateSchoolVerdict,
  type SchoolVerdict,
} from "../packages/server/src/domain/lessons/evaluate";
import { schoolSubject } from "../packages/server/src/domain/lessons/subjects/school/module";
import type { AnswerGraderProvider, GraderInput } from "../packages/server/src/ports/ai";
import { FakeAnswerGrader } from "../packages/server/src/providers/fake";

interface GoldenQuestion {
  prompt: string;
  questionType: string;
  expectedForm: string;
  modelAnswer: string;
  requiredElements: { id: string; text: string }[];
  supplementaryElements: string[];
  topicTitle?: string;
  sourceQuotes?: string[];
  commonErrors?: string[];
}
interface GoldenCase {
  id: string;
  question: string;
  category: string;
  childAnswer: string;
  expected: {
    knowledge: string;
    precision: string;
    missingElementIds?: string[];
    formOk?: boolean;
  };
}
interface GoldenSet {
  gate: { hardCategoriesMustPass: string[]; knowledgeAccuracyMin: number };
  questions: Record<string, GoldenQuestion>;
  cases: GoldenCase[];
}

const useFake = process.argv.includes("--fake");
// .env jest potrzebny tylko ramieniu real; --fake działa w czystym worktree.
if (!useFake) {
  // Missing .env is fine when UMIEM_GRADER_* come from the environment (e.g. CI);
  // graderFromEnv below then decides whether the configuration is complete.
  let envText = "";
  try {
    envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const line of envText.split(/\r?\n/)) {
    const m = /^(?:export\s+)?([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
}
const golden = JSON.parse(
  readFileSync(new URL("../.kiro/specs/school-subjects/grader-golden-set.json", import.meta.url), "utf8"),
) as GoldenSet;

let provider: AnswerGraderProvider;
if (useFake) {
  provider = new FakeAnswerGrader();
  console.log("arm=fake (heurystyka — wynik NIE jest bramką jakości)");
} else {
  const deps = graderFromEnv(process.env);
  if (!deps) {
    console.error("Brak konfiguracji gradera (UMIEM_GRADER_BASE_URL/API_KEY/MODEL w .env). Użyj --fake do sanity checku.");
    process.exit(2);
  }
  provider = deps.provider;
  console.log(`arm=real model=${provider.model} promptVersion=${provider.promptVersionForInput?.({ school: {} } as GraderInput) ?? provider.promptVersion}`);
}

function inputFor(question: GoldenQuestion, childAnswer: string): GraderInput {
  return {
    subjectTitle: "Przedmiot szkolny",
    topicTitle: question.topicTitle ?? "Zagadnienie",
    roleProfile: {
      gradingRole: schoolSubject.prompts.gradingRole,
      almostDefinition: schoolSubject.prompts.almostDefinition,
    },
    instruction: "Odpowiedz własnymi słowami.",
    stimulus: question.prompt,
    objective: { description: question.topicTitle ?? question.prompt, errorCategories: [] },
    acceptedAnswers: [question.modelAnswer],
    childAnswer: childAnswer.slice(0, 600),
    school: {
      question: question.prompt,
      modelAnswer: question.modelAnswer,
      requiredElements: question.requiredElements,
      supplementaryElements: question.supplementaryElements,
      commonErrors: question.commonErrors ?? [],
      expectedForm: question.expectedForm,
      sourceQuotes: question.sourceQuotes ?? [],
    },
  };
}

const hardCases = golden.cases.filter((c) => golden.gate.hardCategoriesMustPass.includes(c.category));
if (hardCases.length === 0) {
  console.error("Błąd konfiguracji bramki: żadna kategoria z gate.hardCategoriesMustPass nie występuje w przypadkach.");
  process.exit(2);
}

let knowledgeOk = 0;
let precisionOk = 0;
let missingOk = 0;
let missingChecked = 0;
let formOkCount = 0;
let formChecked = 0;
let invalid = 0;
const failures: string[] = [];

for (const testCase of golden.cases) {
  const question = golden.questions[testCase.question]!;
  const input = inputFor(question, testCase.childAnswer);
  let verdict: SchoolVerdict | null = null;
  let providerError: string | null = null;
  try {
    const raw = await provider.grade(input, AbortSignal.timeout(60_000));
    verdict = validateSchoolVerdict(raw, {
      requiredElementIds: question.requiredElements.map((el) => el.id),
      childAnswer: testCase.childAnswer,
      formOk: question.expectedForm === "one_sentence" ? countSentences(testCase.childAnswer) <= 1 : null,
    });
  } catch (error) {
    // Transport/provider failure (401, 429, timeout, network) — not a validator rejection.
    providerError = error instanceof Error ? error.message : String(error);
  }
  const hard = golden.gate.hardCategoriesMustPass.includes(testCase.category);
  if (verdict === null) {
    invalid += 1;
    const reason = providerError === null ? "werdykt odrzucony przez walidator" : `błąd dostawcy: ${providerError}`;
    failures.push(`${testCase.id} (${testCase.category})${hard ? " [TWARDA]" : ""}: ${reason} (oczekiwano wiedzy ${testCase.expected.knowledge})`);
    continue;
  }
  const knowledgeMatch = verdict.knowledge === testCase.expected.knowledge;
  const precisionMatch = verdict.precision === testCase.expected.precision;
  if (knowledgeMatch) knowledgeOk += 1;
  if (precisionMatch) precisionOk += 1;
  if (!knowledgeMatch) {
    failures.push(
      `${testCase.id} (${testCase.category})${hard ? " [TWARDA]" : ""}: wiedza ${verdict.knowledge} ≠ ${testCase.expected.knowledge}`,
    );
  }
  if (testCase.expected.missingElementIds !== undefined) {
    missingChecked += 1;
    const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    if (sameSet([...verdict.missingElementIds], testCase.expected.missingElementIds)) {
      missingOk += 1;
    } else {
      failures.push(
        `${testCase.id} (${testCase.category}): brakujące elementy [${verdict.missingElementIds.join(",")}] ≠ [${testCase.expected.missingElementIds.join(",")}]`,
      );
    }
  }
  if (testCase.expected.formOk !== undefined) {
    formChecked += 1;
    const actualFormOk = question.expectedForm === "one_sentence" ? countSentences(testCase.childAnswer) <= 1 : null;
    if (actualFormOk === testCase.expected.formOk) formOkCount += 1;
  }
}

const total = golden.cases.length;
const accuracy = knowledgeOk / total;
const missingAccuracy = missingChecked > 0 ? missingOk / missingChecked : 1;
console.log(
  `przypadki=${total} wiedzaZgodna=${knowledgeOk} (${(accuracy * 100).toFixed(0)}%) precyzjaZgodna=${precisionOk} ` +
  `brakujaceElementyZgodne=${missingOk}/${missingChecked} formaZgodna=${formOkCount}/${formChecked} odrzucone=${invalid}`,
);
for (const failure of failures) console.log(` - ${failure}`);

if (useFake) {
  console.log("fake: raport informacyjny, bez bramki");
  process.exit(0);
}
const hardFailed = failures.some((f) => f.includes("[TWARDA]"));
const gateOk = !hardFailed && accuracy >= golden.gate.knowledgeAccuracyMin && missingAccuracy >= golden.gate.knowledgeAccuracyMin && invalid === 0;
console.log(gateOk ? "BRAMKA: OK" : "BRAMKA: NIE SPEŁNIONA");
process.exit(gateOk ? 0 : 1);
