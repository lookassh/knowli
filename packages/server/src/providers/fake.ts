import { createHash } from "node:crypto";
import type { GenerationDeps, SpeechDeps } from "../config";
import type {
  AnswerGraderProvider,
  AudioInput,
  GraderInput,
  ImageProvider,
  LessonPoolInput,
  LlmGeneratedItem,
  LlmGenerateDeckInput,
  LlmProvider,
  PronunciationProvider,
  PronunciationResult,
  SttProvider,
  TtsProvider,
  TtsSynthesizeInput,
} from "../ports/ai";
import type { MediaStore } from "../ports/media";
import { letterGroups } from "../domain/pronunciation-fragments";

/**
 * Deterministyczni providerzy bez sieci: te same dane wejściowe dają te same
 * bajty, więc content-addressed store naturalnie deduplikuje wyniki. Służą
 * testom integracyjnym/E2E i trybowi UMIEM_FAKE_PROVIDERS=1 (środowisko bez
 * kluczy API); nie są adapterem żadnego serwisu produkcyjnego.
 */

/** Deterministyczne bajty: ten sam seed → te same bajty. */
export function deterministicBytes(seed: string): Uint8Array {
  const digest = createHash("sha256").update(seed).digest();
  return Uint8Array.from(Buffer.concat([digest, digest]));
}

/**
 * Domyślny zestaw fake LLM: siedem dni tygodnia pl→en z celową literówką
 * „thirsday" do poprawienia przez rodzica oraz wariantami odpowiedzi.
 */
export const DEFAULT_FAKE_DECK_ITEMS: Array<Record<string, unknown>> = [
  {
    source: "poniedziałek",
    target: "monday",
    acceptedAnswers: ["Monday"],
    example: "I go to school on monday.",
    visualType: "image",
  },
  { source: "wtorek", target: "tuesday", acceptedAnswers: [], visualType: "image" },
  { source: "środa", target: "wednesday", acceptedAnswers: [], visualType: "image" },
  { source: "czwartek", target: "thirsday", acceptedAnswers: [], visualType: "image" },
  {
    source: "piątek",
    target: "friday",
    acceptedAnswers: ["Friday", "Fri."],
    example: "Friday is my favourite day.",
    visualType: "image",
  },
  { source: "sobota", target: "saturday", acceptedAnswers: [], visualType: "none" },
  { source: "niedziela", target: "sunday", acceptedAnswers: ["Sunday"], visualType: "none" },
];

export const DEFAULT_FAKE_PICTURE_DECK_ITEMS: Array<Record<string, unknown>> = [
  { source: "czerwony", target: "red", acceptedAnswers: [], visualType: "color", visualData: { color: "#ff0000" } },
  { source: "niebieski", target: "blue", acceptedAnswers: [], visualType: "color", visualData: { color: "#0000ff" } },
  { source: "jeden", target: "one", acceptedAnswers: [], visualType: "number", visualData: { count: 1 } },
  { source: "dwa", target: "two", acceptedAnswers: [], visualType: "number", visualData: { count: 2 } },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type LlmBehavior =
  | { items: Array<Record<string, unknown>> }
  | { error: string; retryable: boolean };

/**
 * Zachowanie fake'a dla generacji puli lekcji: albo surowe ćwiczenia + przykłady
 * do zwrócenia, albo błąd (retryable jak dla decków), albo deterministyczna pula
 * domyślna generowana z wejścia. `invalid: true` zmusza fake do wygenerowania
 * ćwiczeń odrzucanych przez walidację (dowód odrzuceń pojedynczych).
 */
export type LlmLessonBehavior =
  | { exercises: unknown[]; examples?: Record<string, string[]> }
  | { error: string; retryable: boolean }
  | { invalid: true };

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

/**
 * Deterministyczna pula ćwiczeń dla jednego wejścia `generateLessonPool`.
 * Działa dla DOWOLNEGO przedmiotu: wybiera typy ćwiczeń z celu i etapu, buduje
 * poprawne ćwiczenia (focus = odpowiedź, luka z jednym znacznikiem, opcje
 * unikalne) z unikalnymi odpowiedziami także wobec `existingAnswers`.
 */
function fakeLessonExercises(input: LessonPoolInput): {
  exercises: Record<string, unknown>[];
  examples: Record<string, string[]>;
} {
  const exercises: Record<string, unknown>[] = [];
  const examples: Record<string, string[]> = {};
  // Odpowiedzi już w puli, znormalizowane naiwnie (lowercase) — fake trzyma je,
  // by nie wygenerować duplikatu przy dogenerowaniu.
  const used = new Set<string>((input.existingAnswers ?? []).map((a) => a.toLowerCase()));
  // Przy dogenerowaniu kontynuuj indeks bodźców wcześniejszych partii, aby
  // testowy provider nie wysyłał tej samej luki tylko z nowym ID.
  let seq = input.existingExercises?.length ?? 0;

  const nextAnswer = (material: string): string => {
    let answer = materialWord(material, seq++);
    while (used.has(answer.toLowerCase())) {
      answer = materialWord(material, seq++);
    }
    used.add(answer.toLowerCase());
    return answer;
  };

  const stageTypes: Record<"guided" | "productive" | "independent", readonly string[]> = {
    guided: ["lesson_choice", "lesson_short_answer", "lesson_order"],
    productive: ["lesson_gap", "lesson_error_fix", "lesson_transform"],
    independent: ["lesson_open_answer"],
  };

  for (const objective of input.objectives) {
    examples[objective.id] = [`Example for ${objective.id}.`];
    const allowed = new Set(objective.exerciseTypes);
    for (const stage of ["guided", "productive", "independent"] as const) {
      const count = input.stageCounts[stage];
      // Preferuj najprostszy do poprawnego zbudowania typ danego etapu:
      // choice (guided), gap bez hintu (productive), open_answer (independent).
      const type = stageTypes[stage].find((t) => allowed.has(t));
      if (type === undefined) {
        continue;
      }
      for (let i = 0; i < count; i++) {
        const answer = nextAnswer(input.material);
        exercises.push(fakeExercise(type, objective.id, answer, input, (input.existingExercises?.length ?? 0) + exercises.length));
      }
    }
  }

  // Gwarancja ≥ 1 ćwiczenia: jeśli etapy nic nie dały (nietypowy cel), dołóż
  // jedno open_answer, jeśli dozwolone, inaczej pierwszy dozwolony typ.
  if (exercises.length === 0 && input.objectives.length > 0) {
    const objective = input.objectives[0]!;
    const type = objective.exerciseTypes[0] ?? "lesson_open_answer";
    exercises.push(fakeExercise(type, objective.id, nextAnswer(input.material), input, input.existingExercises?.length ?? 0));
  }

  return { exercises, examples };
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
  };
  switch (type) {
    case "lesson_choice":
    case "lesson_short_answer":
      return {
        ...base,
        focus: [],
        stem: `Wybierz poprawną odpowiedź (${sequence + 1}).`,
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
      // bez `hint`: unikamy reguły przedmiotu wiążącej odpowiedź z czasownikiem.
      return { ...base, stem: `___ here (${answer}).` };
    case "lesson_error_fix":
      return { ...base, statement: `${answer}x wrong.` };
    case "lesson_transform":
      return {
        ...base,
        transformId: input.transforms[0]?.id ?? "unknown_transform",
        statement: `Przekształć zdanie (${sequence + 1}).`,
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

/** Celowo niepoprawne ćwiczenie (puste pola) — do dowodu odrzuceń walidacji. */
function fakeInvalidExercise(objectiveId: string): Record<string, unknown> {
  return {
    exerciseType: "lesson_gap",
    objectiveId,
    answer: "a b c d e", // > 3 tokeny → odrzucone
    acceptedAnswers: [],
    focus: [],
    stem: "no gap marker here",
  };
}

export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake-llm";
  readonly model = "fake-llm-1";
  readonly requests: LlmGenerateDeckInput[] = [];
  readonly lessonRequests: LessonPoolInput[] = [];
  #behaviors: LlmBehavior[] = [];
  #lessonBehaviors: LlmLessonBehavior[] = [];
  readonly #delayMs: number;

  constructor(options: { delayMs?: number } = {}) {
    this.#delayMs = options.delayMs ?? 0;
  }

  /** Zastępuje plan zachowań: kolejne wywołania zjadają elementy z kolejki, ostatni się powtarza. */
  queue(...behaviors: LlmBehavior[]): void {
    this.#behaviors = behaviors;
  }

  /** Plan zachowań generacji puli lekcji (jedna partia per cel = jedno wywołanie). */
  queueLesson(...behaviors: LlmLessonBehavior[]): void {
    this.#lessonBehaviors = behaviors;
  }

  async generateDeck(input: LlmGenerateDeckInput): Promise<{ items: LlmGeneratedItem[] }> {
    this.requests.push(input);
    if (this.#delayMs > 0) {
      await sleep(this.#delayMs);
    }
    const behavior =
      this.#behaviors.length > 1 ? this.#behaviors.shift()! : this.#behaviors[0] ?? null;
    if (!behavior) {
      const defaults = input.vocabularyFormat === "picture" ? DEFAULT_FAKE_PICTURE_DECK_ITEMS : DEFAULT_FAKE_DECK_ITEMS;
      return { items: defaults as unknown as LlmGeneratedItem[] };
    }
    if ("error" in behavior) {
      const error = new Error(behavior.error) as Error & { retryable?: boolean };
      error.retryable = behavior.retryable;
      throw error;
    }
    return { items: behavior.items as unknown as LlmGeneratedItem[] };
  }

  async generateLessonPool(
    input: LessonPoolInput,
  ): Promise<{ exercises: unknown[]; examples: Record<string, string[]> }> {
    this.lessonRequests.push(input);
    if (this.#delayMs > 0) {
      await sleep(this.#delayMs);
    }
    const behavior =
      this.#lessonBehaviors.length > 1
        ? this.#lessonBehaviors.shift()!
        : this.#lessonBehaviors[0] ?? null;
    if (!behavior) {
      return fakeLessonExercises(input);
    }
    if ("error" in behavior) {
      const error = new Error(behavior.error) as Error & { retryable?: boolean };
      error.retryable = behavior.retryable;
      throw error;
    }
    if ("invalid" in behavior) {
      // Mieszanka: połowa poprawnych, połowa odrzucanych — dowód odrzuceń pojedynczych.
      const good = fakeLessonExercises(input);
      const bad = input.objectives.map((o) => fakeInvalidExercise(o.id));
      return { exercises: [...good.exercises, ...bad], examples: good.examples };
    }
    return { exercises: behavior.exercises, examples: behavior.examples ?? {} };
  }
}

export class FakeTtsProvider implements TtsProvider {
  readonly name = "fake-tts";
  readonly model = "fake-tts-1";
  readonly voice = "fake-voice";
  readonly requests: TtsSynthesizeInput[] = [];
  failuresLeft = 0;
  readonly #delayMs: number;

  constructor(options: { delayMs?: number } = {}) {
    this.#delayMs = options.delayMs ?? 0;
  }

  async synthesize(input: TtsSynthesizeInput): Promise<{ bytes: Uint8Array; mimeType: string }> {
    this.requests.push(input);
    if (this.#delayMs > 0) {
      await sleep(this.#delayMs);
    }
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error("tts unavailable");
    }
    return {
      bytes: deterministicBytes(`tts|${input.text}|${input.locale}|${input.voice}|${input.format}`),
      mimeType: "audio/mpeg",
    };
  }

  callsFor(text: string): number {
    return this.requests.filter((r) => r.text === text).length;
  }
}

export class FakeImageProvider implements ImageProvider {
  readonly name = "fake-image";
  readonly model = "fake-image-1";
  failuresLeft = 0;
  readonly requests: Array<{
    prompt: string;
    model: string;
    size: string;
    quality: string;
    format: string;
  }> = [];
  readonly #delayMs: number;
  readonly #output?: { bytes: Uint8Array; mimeType: string };

  constructor(options: { delayMs?: number; output?: { bytes: Uint8Array; mimeType: string } } = {}) {
    this.#delayMs = options.delayMs ?? 0;
    this.#output = options.output;
  }

  async generate(input: {
    prompt: string;
    model: string;
    size: string;
    quality: string;
    format: string;
  }): Promise<{ bytes: Uint8Array; mimeType: string }> {
    this.requests.push(input);
    if (this.#delayMs > 0) {
      await sleep(this.#delayMs);
    }
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error("image unavailable");
    }
    if (this.#output) return this.#output;
    const mimeType = "image/png";
    return {
      bytes: Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64")),
      mimeType,
    };
  }
}

/** Fake'owe ustawienia medialne — muszą zgadzać się z fingerprintami fake'ów. */
export const fakeMediaSettings = {
  tts: { provider: "fake-tts", model: "fake-tts-1", voice: "fake-voice", format: "mp3" },
  image: { provider: "fake-image", model: "fake-image-1", size: "512x512", quality: "low", format: "webp" },
} as const;

/**
 * Fake STT zwraca stałą wiarygodną transkrypcję „monday” (pierwsze słowo
 * fake'owego zestawu) — audio nie niesie treści, więc dopasowanie do klucza
 * zadziała dla tego słowa, a dla pozostałych domknie zadanie dopiero druga
 * rozbieżność (SPEC §15.3). Wystarcza do przejścia pełnego cyklu mowy w E2E.
 */
export class FakeSttProvider implements SttProvider {
  readonly name = "fake-stt";
  async transcribe(): Promise<{ status: "ok"; text: string; confidence: number }> {
    return { status: "ok", text: "monday", confidence: 0.9 };
  }
}

/** Fake oceny wymowy: wysoki wynik i fonemy zgrane z grupami liter. */
export class FakePronunciationProvider implements PronunciationProvider {
  readonly name = "fake-pron";
  async assess(_audio: AudioInput, expectedText: string): Promise<PronunciationResult> {
    const word = expectedText.trim().toLowerCase();
    return {
      status: "ok",
      overallScore: 95,
      recognizedText: expectedText,
      words: [
        {
          text: word,
          accuracyScore: 95,
          errorType: null,
          phonemes: letterGroups(word).map((group) => ({ phoneme: group, accuracyScore: 96 })),
        },
      ],
    };
  }
}

/** Zależności ścieżki mowy na fake'ach — tryb bez kluczy (E2E, lokalny smoke). */
export function fakeSpeechDeps(): SpeechDeps {
  return {
    stt: new FakeSttProvider(),
    pronunciation: new FakePronunciationProvider(),
  };
}

/** Komplet zależności generacji na fake'ach dla wskazanego magazynu mediów. */
export function fakeGenerationDeps(
  mediaStore: MediaStore,
  options: { delayMs?: number } = {},
): GenerationDeps {
  return {
    llm: new FakeLlmProvider(options),
    tts: new FakeTtsProvider(options),
    image: new FakeImageProvider(options),
    mediaStore,
  };
}

/**
 * Zachowanie fake gradera dla jednej odpowiedzi (po znormalizowanej treści albo
 * domyślne). `raw` to surowy obiekt zwracany przez provider (jak prawdziwy
 * adapter — walidacja w domenie), więc test może podać też kształt niepoprawny
 * (invalid JSON / kategoria spoza listy). `delayMs` symuluje opóźnienie modelu;
 * `error` symuluje awarię HTTP/sieci (moduł zamieni na `unevaluated`).
 */
export type FakeGraderBehavior =
  | { raw: unknown; delayMs?: number }
  | { error: string; delayMs?: number };

/**
 * Deterministyczny fake modelu oceniającego dla integracji/E2E: liczy wywołania
 * i mapuje znormalizowaną (naiwnie: lowercase + trim) odpowiedź dziecka na
 * zaprogramowany surowy werdykt. Bez zachowania → werdykt `correct`. Tryb
 * E2E może włączyć prosty routing po słowach kluczowych w odpowiedzi.
 */
export class FakeAnswerGrader implements AnswerGraderProvider {
  readonly name = "fake-grader";
  readonly model = "fake-grader-1";
  readonly promptVersion: string;
  readonly requests: GraderInput[] = [];
  #byAnswer = new Map<string, FakeGraderBehavior>();
  #default: FakeGraderBehavior | null = null;
  #keywordRouting = false;

  constructor(options: { promptVersion?: string; keywordRouting?: boolean } = {}) {
    this.promptVersion = options.promptVersion ?? "fake-grader-v1";
    this.#keywordRouting = options.keywordRouting ?? false;
  }

  /** Programuje werdykt dla konkretnej (surowej) odpowiedzi dziecka. */
  onAnswer(childAnswer: string, behavior: FakeGraderBehavior): this {
    this.#byAnswer.set(childAnswer.trim().toLowerCase(), behavior);
    return this;
  }

  /** Werdykt domyślny, gdy brak dopasowania po odpowiedzi. */
  onDefault(behavior: FakeGraderBehavior): this {
    this.#default = behavior;
    return this;
  }

  get callCount(): number {
    return this.requests.length;
  }

  async grade(input: GraderInput, signal: AbortSignal): Promise<unknown> {
    this.requests.push(input);
    const key = input.childAnswer.trim().toLowerCase();
    const behavior = this.#byAnswer.get(key) ?? this.#default ?? this.#keywordVerdict(input);
    if (behavior.delayMs && behavior.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, behavior.delayMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    if ("error" in behavior) {
      throw new Error(behavior.error);
    }
    return behavior.raw;
  }

  /**
   * Routing po słowach kluczowych (E2E bez konfiguracji per odpowiedź): odpowiedź
   * zawierająca „almost” → almost z pierwszym tokenem jako fragment; „wrong” →
   * incorrect z pierwszą kategorią celu; inaczej correct.
   */
  #keywordVerdict(input: GraderInput): FakeGraderBehavior {
    if (!this.#keywordRouting) {
      return { raw: { verdict: "correct", errorCategory: null, fragments: [], note: "ok" } };
    }
    const answer = input.childAnswer;
    const firstToken = answer.trim().split(/\s+/)[0] ?? answer;
    if (/almost/i.test(answer)) {
      return { raw: { verdict: "almost", errorCategory: null, fragments: [firstToken], note: "almost" } };
    }
    if (/wrong/i.test(answer)) {
      const category = input.objective.errorCategories[0]?.code ?? "other";
      return { raw: { verdict: "incorrect", errorCategory: category, fragments: [firstToken], note: "wrong" } };
    }
    return { raw: { verdict: "correct", errorCategory: null, fragments: [], note: "ok" } };
  }
}

/** Zależności gradera na fake'u — do integracji i trybu UMIEM_FAKE_PROVIDERS. */
export function fakeGraderDeps(
  options: { provider?: FakeAnswerGrader; maxCallsPerSession?: number; timeoutMs?: number } = {},
): { provider: FakeAnswerGrader; maxCallsPerSession: number; timeoutMs: number } {
  return {
    provider: options.provider ?? new FakeAnswerGrader(),
    maxCallsPerSession: options.maxCallsPerSession ?? 20,
    timeoutMs: options.timeoutMs ?? 8000,
  };
}
