import type { LessonObjectiveAgentInput, LessonPacketInput, LessonPoolInput } from "../ports/ai";
import { stageOf } from "../domain/lessons/stages";
import { englishChapterSubject } from "../domain/lessons/subjects/english-chapter/module";
import { schoolSubject } from "../domain/lessons/subjects/school/module";
import type { LessonExerciseType } from "../domain/lessons/types";

/**
 * Deterministyczny generator ćwiczeń lekcji dla fake'ów (testy, E2E, `UMIEM_FAKE_PROVIDERS=1`):
 * czyste funkcje bez sieci i stanu. `fakeObjectiveExercises` buduje zgłoszenie jednego zagadnienia
 * dla fake'a agenta puli (etap 3 PR 2 #237, spec §5.2) tak, żeby przeszło prawdziwe przyjmowanie.
 * Nie jest adapterem żadnej usługi.
 */

/**
 * Materiał lekcji z tym znacznikiem wydłuża pierwszy krok każdego zagadnienia fake agenta do co najmniej
 * FAKE_SLOW_DELAY_MS, przerywalnie, niezależnie od skonfigurowanego opóźnienia kroku
 * (`UMIEM_FAKE_LESSON_DELAY_MS`): E2E generuje lekcje bez sztucznego opóźnienia, a test restartu
 * trwającej generacji nadal ją widzi.
 */
export const FAKE_SLOW_MARKER = "[fake-slow]";
export const FAKE_SLOW_DELAY_MS = 3_000;

/** Stałe zdanie bez odpowiedzi ćwiczenia: spełnia reguły treści wyjaśnienia (jedno zdanie, zwykły tekst, ≤ 120). */
export const FAKE_EXPLANATION = "Ta reguła mówi, jak zbudować poprawne zdanie.";

type FakeStage = "guided" | "productive" | "independent";
type StageCounts = Record<FakeStage, number>;
const STAGES: readonly FakeStage[] = ["guided", "productive", "independent"];

/** Deterministyczne słowo z materiału (pierwszy token) dla danego indeksu. */
function materialWord(material: string, index: number): string {
  const words = material
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const base = words.length > 0 ? words[index % words.length]! : "word";
  // Unikalność odpowiedzi w puli: dołączamy sufiks indeksu (po normalizacji
  // nadal jeden token, bo cyfry są częścią tokenu).
  return index === 0 ? base.toLowerCase() : `${base.toLowerCase()}${index}`;
}

/** Typy ćwiczeń fake'a według etapu: budowany jest pierwszy typ dozwolony przez cel. */
const FAKE_STAGE_TYPES: Record<FakeStage, readonly string[]> = {
  guided: ["lesson_choice", "lesson_short_answer", "lesson_order"],
  productive: ["lesson_gap", "lesson_error_fix", "lesson_transform"],
  independent: ["lesson_open_answer"],
};

/** Zdanie do porównania z `avoidSentences`: małe litery, bez spacji na brzegach i bez końcowej kropki. */
function avoidKey(sentence: string): string {
  return sentence.toLowerCase().trim().replace(/\.$/u, "");
}

/** Przy fladze `exerciseExplanations` każde ćwiczenie dostaje przewidywalne wyjaśnienie (infrastruktura testowa). */
function withFakeExplanations(exercises: Record<string, unknown>[], input: LessonPoolInput): Record<string, unknown>[] {
  if (input.exerciseExplanations !== true) return exercises;
  return exercises.map((exercise) => ({ ...exercise, explanationPl: FAKE_EXPLANATION }));
}

/** Typ wyboru ze słuchu: dodatek poza podziałem etapów. */
const LISTEN_CHOICE_TYPE = "lesson_listen_choice";

/** Słowa dystraktorów fake'a: brzmią inaczej niż jakikolwiek token materiału testów. */
const FAKE_LISTEN_DISTRACTORS: readonly string[] = ["orange", "window"];

/**
 * Ćwiczenie wyboru ze słuchu: zdanie z jedną luką, dwie słyszalnie różne opcje, odpowiedź = tekst poprawnej
 * opcji. Bez polecenia, podpowiedzi i piktogramu (jak po `stripListenChoiceExtras`); zdanie z lukiem
 * wypełnioną poprawną opcją nie może równać się odpowiedzi ćwiczenia tekstowego puli.
 */
function fakeListenChoice(objectiveId: string, stem: string, answer: string, other: string): Record<string, unknown> {
  return {
    exerciseType: LISTEN_CHOICE_TYPE,
    objectiveId,
    stem,
    answer,
    acceptedAnswers: [],
    focus: [answer],
    options: [
      { id: "a", text: answer },
      { id: "b", text: other },
    ],
    correctOption: "a",
  };
}

/** Pola v3 dla fake puli przedmiotu szkolnego (uziemienie = początek materiału). */
function schoolFieldsForFake(type: string, answer: string, material: string): Record<string, unknown> {
  const quote = material.trim().slice(0, 120);
  const base: Record<string, unknown> = { sourceRefs: [{ quote }] };
  if (type === "lesson_open_answer") {
    return {
      ...base,
      questionType: "fact",
      requiredElements: [{ id: "e1", text: `Podaje: ${answer}`.slice(0, 120) }],
      supplementaryElements: [],
      commonErrors: [],
      expectedForm: "short",
    };
  }
  return base;
}

/** Jedno poprawne ćwiczenie danego typu (lub najbliższe poprawnemu). */
function fakeExercise(
  type: string,
  objectiveId: string,
  answer: string,
  input: LessonPoolInput,
  sequence: number,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    exerciseType: type,
    objectiveId,
    instructionPl: "Uzupełnij.",
    answer,
    acceptedAnswers: [],
    focus: [answer],
    ...(input.subjectId === schoolSubject.id ? schoolFieldsForFake(type, answer, input.material) : {}),
  };
  switch (type) {
    case "lesson_choice":
    case "lesson_short_answer":
      return {
        ...base,
        focus: [],
        // Rozdział wymaga jednej luki w zdaniu wyboru (`chapter.stem_single_gap`).
        stem: input.subjectId === englishChapterSubject.id ? `___ here (${sequence + 1}).` : `Wybierz poprawną odpowiedź (${sequence + 1}).`,
        options: [
          { id: "a", text: answer },
          { id: "b", text: `${answer}x` },
        ],
        correctOption: "a",
      };
    case "lesson_order":
      return {
        ...base,
        focus: [],
        answer: `${answer} one two`,
        items: [
          { id: "i1", text: answer },
          { id: "i2", text: "one" },
          { id: "i3", text: "two" },
        ],
      };
    case "lesson_gap":
      // bez `hint`: odpowiedź fake'a nie jest formą żadnego czasownika.
      return { ...base, stem: `___ here (${answer}).` };
    case "lesson_error_fix":
      return { ...base, statement: `${answer}x wrong.` };
    case "lesson_transform":
      return {
        ...base,
        transformId: input.transforms[0]?.id ?? "unknown_transform",
        statement: `Przekształć zdanie (${sequence + 1}).`,
      };
    // Przypisania (rozdział, szkoła): klucz i-tego pola to i-ta opcja po sortowaniu, dystraktory sortują się na końcu
    // („z…”), a element grupy k (w kolejności widoku) należy do grupy k mod n — konwencję czyta `fakeClosedAnswer`.
    case "lesson_match": {
      const lefts = [answer, `pair${sequence}b`, `pair${sequence}c`];
      return {
        ...base,
        focus: [],
        answer: lefts.join(", "),
        pairs: lefts.map((left, index) => ({ left, right: `${"abc"[index]}${sequence}` })),
        extraRight: [`z${sequence}`],
      };
    }
    case "lesson_group": {
      const items = [answer, `item${sequence}b`, `item${sequence}c`, `item${sequence}d`].sort((a, b) => a.localeCompare(b, "en"));
      return {
        ...base,
        focus: [],
        answer: "Grupa A / Grupa B",
        groups: [{ id: "g1", label: "Grupa A" }, { id: "g2", label: "Grupa B" }],
        groupItems: items.map((text, index) => ({ text, groupId: index % 2 === 0 ? "g1" : "g2" })),
      };
    }
    case "lesson_cloze":
      return {
        ...base,
        focus: [],
        answer: `a${sequence}, b${sequence}`,
        clozeText: `First ___ and then ___ (${sequence + 1}).`,
        gapAnswers: [`a${sequence}`, `b${sequence}`],
        extraWords: [`z${sequence}`],
      };
    case "lesson_notice":
      return {
        exerciseType: type,
        objectiveId,
        instructionPl: "Wskaż słowo.",
        answer,
        acceptedAnswers: [],
        focus: [],
        noticeSegments: [[answer, "one"], ["two", "three"]],
        correctOption: answer,
      };
    case "lesson_open_answer":
    default:
      return { ...base, prompt: `Przetłumacz zdanie (${sequence + 1}).` };
  }
}

// ---------------------------------------------------------------------------------------------
// Zgłoszenie jednego zagadnienia dla fake'a agenta puli.

/** Zamówienie kroku: liczby etapów, wymagane typy (po jednym ćwiczeniu z grupy) i dodatek słuchowy. */
interface StepRequest {
  readonly stages: StageCounts;
  /** Wybrany typ każdej grupy wymaganej (pierwszy dozwolony i obsługiwany), bez powtórzeń. */
  readonly required: readonly string[];
  readonly listen: number;
}

/** Typy, które generator potrafi zbudować poprawnie dla gramatyki i szkoły. */
const STAGED_TYPES: ReadonlySet<string> = new Set([...STAGES.flatMap((stage) => FAKE_STAGE_TYPES[stage]), "lesson_notice", LISTEN_CHOICE_TYPE]);
function stageOfType(type: string): FakeStage | undefined {
  const stage = stageOf(type as LessonExerciseType);
  return stage === "intro" || type === LISTEN_CHOICE_TYPE ? undefined : stage;
}

function stepRequest(
  input: LessonObjectiveAgentInput,
  counts: Partial<StageCounts> | undefined,
  requiredTypes: readonly (readonly string[])[] | undefined,
  allowed: ReadonlySet<string>,
  supported: ReadonlySet<string>,
): StepRequest {
  const stages: StageCounts =
    counts === undefined
      ? { ...input.pool.stageCounts }
      : { guided: counts.guided ?? 0, productive: counts.productive ?? 0, independent: counts.independent ?? 0 };
  const groups = requiredTypes ?? (counts === undefined ? input.targets.requiredTypes : []);
  const required = [
    ...new Set(groups.flatMap((group) => group.find((type) => allowed.has(type) && supported.has(type)) ?? [])),
  ];
  const listen = counts === undefined ? input.targets.listenAllowance : 0;
  return { stages, required, listen: required.includes(LISTEN_CHOICE_TYPE) ? Math.max(1, listen) : listen };
}

/**
 * Typy kolejnych ćwiczeń etapu: najpierw wymagane typy tego etapu (liczą się do jego liczby, ale
 * zawsze po jednym), potem pierwszy dozwolony typ etapu do zamówionej liczby.
 */
function stageTypes(stage: FakeStage, request: StepRequest, allowed: ReadonlySet<string>): string[] {
  const required = request.required.filter((type) => stageOfType(type) === stage);
  const filler = FAKE_STAGE_TYPES[stage].find((type) => allowed.has(type));
  const rest = filler === undefined ? 0 : Math.max(0, request.stages[stage] - required.length);
  return [...required, ...Array.from({ length: rest }, () => filler!)];
}

/** Gramatyka i szkoła: odpowiedzi ze słów materiału z sufiksem numeru, numeracja od `offset`. */
function stagedObjectiveExercises(input: LessonObjectiveAgentInput, offset: number, request: StepRequest, allowed: ReadonlySet<string>) {
  const pool = input.pool;
  const objectiveId = input.objective.id;
  const exercises: Record<string, unknown>[] = [];
  let seq = offset;
  const nextAnswer = () => materialWord(pool.material, seq++);
  for (const stage of STAGES) {
    for (const type of stageTypes(stage, request, allowed)) exercises.push(fakeExercise(type, objectiveId, nextAnswer(), pool, offset + exercises.length));
  }
  if (allowed.has(LISTEN_CHOICE_TYPE)) {
    for (let i = 0; i < request.listen; i++) {
      const answer = nextAnswer();
      const number = offset + exercises.length + 1;
      exercises.push(fakeListenChoice(objectiveId, `Listen and choose: ___ (${number}).`, answer, FAKE_LISTEN_DISTRACTORS.find((word) => word !== answer)!));
    }
  }
  // Gwarancja ≥ 1 ćwiczenia: cel bez typów etapów dostaje pierwszy dozwolony typ.
  if (exercises.length === 0) {
    const type = pool.objectives.find((objective) => objective.id === objectiveId)?.exerciseTypes[0] ?? "lesson_open_answer";
    exercises.push(fakeExercise(type, objectiveId, nextAnswer(), pool, offset));
  }
  // Przykładowy ton lektora (etap B): tylko gdy generator ma go zwracać.
  if (pool.voiceTones === true) exercises[0] = { ...exercises[0]!, voiceTone: "curious" };
  return { exercises, examples: [`Example for ${objectiveId}.`] };
}

/**
 * Zgłoszenie jednego kroku podagenta zagadnienia `input.objective` (rekordy gotowe; materializacja
 * narzędzi przepuszcza je bez zmian). Numeracja i dobór odpowiedzi od `offset`
 * (pętla fake'a agenta: `index · 1000`, przy „+N” `index · 1000 + 500 + existingCount · 2`, kolejne
 * kroki +100), więc zagadnienia lekcji i kroki nie powtarzają odpowiedzi.
 *
 * Bez `counts`: liczby etapów z `pool.stageCounts`, każdy typ z `targets.requiredTypes` i dodatek
 * słuchowy `targets.listenAllowance`. Z `counts`: tylko zamówione etapy i wymagane typy z
 * `requiredTypes` (po jednym ćwiczeniu z grupy). Przykłady kart pominięte przy `examplesFromPlan`.
 */
export function fakeObjectiveExercises(
  input: LessonObjectiveAgentInput,
  offset: number,
  counts?: Partial<Record<FakeStage, number>>,
  requiredTypes?: readonly (readonly string[])[],
): { exercises: unknown[]; examples?: string[] } {
  const pool = input.pool;
  const allowed = new Set(pool.objectives.find((objective) => objective.id === input.objective.id)?.exerciseTypes ?? []);
  const request = stepRequest(input, counts, requiredTypes, allowed, STAGED_TYPES);
  const generated = stagedObjectiveExercises(input, offset, request, allowed);
  const exercises = withFakeExplanations(generated.exercises, pool);
  return input.objective.examplesFromPlan ? { exercises } : { exercises, examples: generated.examples };
}

/** Tekst występuje jako osobne słowo (tokeny liter i cyfr) w którymś ze zdań. */
function avoidedToken(text: string, sentences: readonly string[]): boolean {
  const word = text.toLowerCase();
  return sentences.some((sentence) => sentence.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(word));
}

/**
 * Paczka przebiegu bazowego dla fake'a (etap 4 #358): `input.count` ćwiczeń typu paczki z odpowiedziami
 * `materialWord` od `offset` (wołający przydziela każdej paczce osobne pasmo numeracji), z pominięciem
 * odpowiedzi obecnych w `avoidSentences` (szkic przy „+N” po restarcie procesu); pierwsza paczka celu
 * zwraca przykład karty.
 */
export function fakePacketExercises(input: LessonPacketInput, offset: number): { exercises: Record<string, unknown>[]; examples?: string[] } {
  const pool = input.pool;
  const objectiveId = input.objective.id;
  const avoid = pool.avoidSentences ?? [];
  let seq = offset;
  const nextAnswer = (): string => {
    let answer = materialWord(pool.material, seq++);
    for (let guard = 0; guard < 1000 && avoidedToken(answer, avoid); guard++) answer = materialWord(pool.material, seq++);
    return answer;
  };
  const type = input.type as LessonExerciseType;
  const exercises = Array.from({ length: input.count }, (_unused, index) => {
    const answer = nextAnswer();
    return type === LISTEN_CHOICE_TYPE
      ? fakeListenChoice(objectiveId, `Listen and choose: ___ (${offset + index + 1}).`, answer, FAKE_LISTEN_DISTRACTORS.find((word) => word !== answer)!)
      : fakeExercise(type, objectiveId, answer, pool, offset + index);
  });
  return { exercises: withFakeExplanations(exercises, pool), ...(input.withExamples ? { examples: [`Example for ${objectiveId}.`] } : {}) };
}

/** Pozycja pola w liście widoku `prefix` (lewe strony par, elementy grup). */
function indexIn(lines: readonly string[], prefix: string, field: string): number {
  return lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).split(" | ").indexOf(field) ?? -1;
}

/** Klucz pola przypisania według konwencji `fakeExercise` (luka i para — i-ta opcja, grupa — k mod liczba grup). */
function fieldAnswer(lines: readonly string[], field: string, options: readonly string[]): string | null {
  const gap = /^gap (\d+)$/u.exec(field);
  if (gap !== null) return options[Number(gap[1]) - 1] ?? null;
  const pair = indexIn(lines, "Left (in this order): ", field);
  if (pair >= 0) return options[pair] ?? null;
  const item = indexIn(lines, "Items (in this order): ", field);
  return item >= 0 ? (options[item % options.length] ?? null) : null;
}

/**
 * Klucz ćwiczenia fake'a odczytany z widoku kontroli zamkniętych (model nie zna klucza, ale konwencję
 * fake'a tak): słuchanie — opcja ze zdania nagrania; notice — pierwsze słowo pierwszego zdania;
 * wybór — opcja będąca przedrostkiem drugiej (dystraktor `<odpowiedź>x`), inaczej pierwsza.
 */
export function fakeClosedAnswer(view: string): string | null {
  const lines = view.split("\n");
  const options = lines.find((line) => line.startsWith("Options: "))?.slice("Options: ".length).split(" | ") ?? [];
  const field = lines.find((line) => line.startsWith("Field: "))?.slice("Field: ".length).split(" (judge")[0];
  if (field !== undefined) return fieldAnswer(lines, field, options);
  const transcript = lines.find((line) => line.startsWith("Recording (transcript): "));
  if (transcript !== undefined) return options.find((option) => avoidedToken(option.toLowerCase(), [transcript])) ?? null;
  const sentence = lines.find((line) => line.startsWith("Sentence 1: "));
  if (sentence !== undefined) return sentence.slice("Sentence 1: ".length).split(" ")[0] ?? null;
  return options.find((option) => options.some((other) => other !== option && other.startsWith(option))) ?? options[0] ?? null;
}
