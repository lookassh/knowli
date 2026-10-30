import { randomUUID } from "node:crypto";
import { messages, type CalculationSpec, type SpeechInputDto, type TaskPrompt } from "@learning/contracts";
import type { Services } from "../../../config";
import { DEFAULT_DICTATION_POLICY } from "../../../domain/lessons/dictation";
import { AppError } from "../../../errors";
import { computeTargetKey } from "../../../domain/target-key";
import { renderCalculationPrompt } from "../../../domain/lessons/calculation";
import { renderCard } from "../../../domain/lessons/card";
import { answersEquivalent } from "../../../domain/lessons/pool-validation";
import type { LearningObjective, LessonExerciseType, LessonTopic, LessonVisualSubject, SubjectModule } from "../../../domain/lessons/types";
import type { LessonTaskPlan } from "../../../domain/lessons/scheduler";

/**
 * Materializacja zadań lekcji — część CZYSTA (poza `randomUUID` i zdeterminowanym
 * tasowaniem) wyciągnięta z `lesson-sessions.ts`, by `lesson-mock-tests.ts`
 * składał prompty i klucze dokładnie tak samo jak trening (brief zadania 17:
 * reużyj przez ekstrakcję, nie kopię). Zachowanie treningu jest niezmienione —
 * `lesson-sessions.ts` reeksportuje te same funkcje.
 */

/** Payload rewizji ćwiczenia lekcji (`item_revisions.payload`, payload_version 2). */
export interface LessonExercisePayload {
  exerciseType: LessonExerciseType;
  objectiveId: string;
  instructionPl?: string;
  stem?: string;
  statement?: string;
  prompt?: string;
  hint?: string;
  transformId?: string;
  noticeSegments?: string[][];
  visualSubject?: LessonVisualSubject;
  calculation?: CalculationSpec;
  answer: string;
  acceptedAnswers: string[];
  focus: string[];
  options?: { id: string; text: string }[];
  correctOption?: string;
  items?: { id: string; text: string }[];
  // Pola v3 (kryteria serwera; materializacja ich nie renderuje dziecku).
  questionType?: string;
  requiredElements?: { id: string; text: string }[];
  supplementaryElements?: string[];
  commonErrors?: string[];
  expectedForm?: string;
  familyId?: string;
  sourceRefs?: { quote: string; parentAdded?: boolean }[];
  keywordOptions?: { id: string; text: string }[];
  keyOptionIds?: string[];
  pairs?: { left: string; right: string }[];
  extraRight?: string[];
  groups?: { id: string; label: string }[];
  groupItems?: { text: string; groupId: string }[];
  answerLocale: string;
  promptLocale: string;
}

export interface LoadedExercise {
  revisionId: string;
  itemId: string;
  position: number;
  payload: LessonExercisePayload;
  targetKey: string;
  audioAssetId: string | null;
  /** Gotowe nagranie „Posłuchaj pytania” (design szkoły §11); brak = bez przycisku. */
  questionAudioAssetId?: string | null;
}

export interface MaterializedLessonTask {
  exerciseType: LessonExerciseType;
  prompt: TaskPrompt;
  answerKey: Record<string, unknown>;
  exposures: string[];
  context: Record<string, unknown>;
  itemRevisionId: string;
}

/** Tasowanie zdeterminowane ziarnem (id zadania): mulberry32 na haszu id. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Tasowanie, które nigdy nie pokazuje układu rozwiązanego (design szkoły §10.4):
 * gdy `seededShuffle` zwróci układ, dla którego `isSolved` jest prawdą,
 * wynik przesuwamy cyklicznie o jedną pozycję — deterministycznie, bez nowej
 * losowości. Przy n ≥ 2 różnych elementach przesunięcie układu rozwiązanego
 * nie jest już rozwiązane dla reguł porównujących pozycje.
 */
export function shuffleUnsolved<T>(items: readonly T[], seed: string, isSolved: (arranged: readonly T[]) => boolean): T[] {
  const shuffled = seededShuffle(items, seed);
  if (shuffled.length < 2 || !isSolved(shuffled)) return shuffled;
  return [...shuffled.slice(1), shuffled[0]!];
}

/** Polecenie przekształcenia z tematu, gdy payload go nie niesie. */
function transformInstruction(topic: LessonTopic, payload: LessonExercisePayload): string | undefined {
  if (payload.exerciseType !== "lesson_transform" || !payload.transformId) return undefined;
  return topic.transforms.find((t) => t.id === payload.transformId)?.instructionPl;
}

/** Składa kartę (prezentacja): treść karty tematu z przykładami lekcji. */
export function materializeCard(
  plan: Extract<LessonTaskPlan, { kind: "card" }>,
  cardIndex: number,
  objective: LearningObjective,
  subject: SubjectModule,
  examples: readonly string[],
  firstExerciseRevisionId: string,
): MaterializedLessonTask {
  const rendered = renderCard(objective.cards[cardIndex]!, [...examples]);
  return {
    exerciseType: "lesson_card",
    prompt: { kind: "lesson_card", card: rendered },
    answerKey: { exerciseType: "lesson_card", objectiveId: objective.id, subjectId: subject.id, cardPurpose: plan.cardPurpose },
    // Karta ujawnia przykłady → ekspozycje kluczy przykładów (znormalizowane w answerLocale).
    exposures: examples.map((example) => computeTargetKey(example, subject.answerLocale)),
    context: { objectiveId: objective.id, cardPurpose: plan.cardPurpose, cardIndex },
    itemRevisionId: firstExerciseRevisionId,
  };
}

/** Wejście materializacji ćwiczenia: plan albo surowy opis trybu kartkówki. */
export interface MaterializeExerciseInput {
  independentCheck: boolean;
  reason: string;
  /**
   * `lesson_keywords`: odpowiedź otwarta zaplanowana zaraz po wyborze pojęć —
   * jej pytanie trafia do promptu, a jej `targetKey` do ekspozycji (lista pojęć
   * wspiera tę odpowiedź, więc nie jest ona samodzielna).
   */
  pairedOpenAnswer?: { prompt: string; targetKey: string };
}

/**
 * Składa publiczny prompt (bez odpowiedzi, wariantów, focus, celu, kategorii),
 * prywatny `answer_key` i listę ekspozycji dla ćwiczenia. Czysta poza
 * `randomUUID` (nieznaczące id opcji/klocków/segmentów) i tasowaniem.
 * Ziarno tasowania nie może dać się wyliczyć z publicznego `taskId` — inaczej
 * klient odwróciłby tasowanie i odczytał kolejność z payloadu (kolejność
 * „Ułóż”, pary, grupy, pozycję poprawnej opcji); domyślnie zawiera losowy
 * składnik, a testy mogą podać własne `shuffleSeed`. Prompt zapisuje się przy
 * wydaniu, więc nie musi być odtwarzalny. `mockTest` wycina podpowiedź luki
 * (bez ujawnienia odpowiedzi w kartkówce).
 */
export function materializeExercise(
  plan: MaterializeExerciseInput,
  taskId: string,
  exercise: LoadedExercise,
  topic: LessonTopic,
  subject: SubjectModule,
  options: { mockTest?: boolean; speechInput?: SpeechInputDto; shuffleSeed?: string } = {},
): MaterializedLessonTask {
  const payload = exercise.payload;
  const shuffleSeed = options.shuffleSeed ?? `${taskId}:${randomUUID()}`;
  const objective = topic.objectives.find((o) => o.id === payload.objectiveId);
  const instructionPl = payload.instructionPl ?? transformInstruction(topic, payload) ?? objective?.titlePl ?? "";
  const mockTest = options.mockTest ?? false;

  // Audio odpowiedzi kanonicznej dołączane WYŁĄCZNIE do typów tekstowych i tylko
  // w treningu: odsłuch zdania wzorcowego przed odpowiedzią jest dozwolonym
  // wsparciem (wym. 4.6), ale w kartkówce zdradzałby odpowiedź. `audioAssetId`
  // jest już wykluczone z promptów typów zamkniętych przez schemat kontraktu.
  const audio = subject.ttsForAnswers && !mockTest && exercise.audioAssetId ? { audioAssetId: exercise.audioAssetId } : {};
  // Nagranie pytania powtarza widoczną treść, więc zostaje też w kartkówce (design szkoły §11.3).
  const questionAudio = subject.ttsForPrompts && exercise.questionAudioAssetId ? { questionAudioAssetId: exercise.questionAudioAssetId } : {};

  const baseKey: Record<string, unknown> = {
    exerciseType: payload.exerciseType,
    objectiveId: payload.objectiveId,
    subjectId: subject.id,
    targetKey: exercise.targetKey,
    answer: payload.answer,
    acceptedAnswers: payload.acceptedAnswers,
    focus: payload.focus,
    independentCheck: plan.independentCheck,
    reason: plan.reason,
    // Migawka celu: ścieżka oceny nie musi szukać celu w katalogu (tematy dynamiczne).
    ...(objective ? { objectiveSnapshot: { objectiveTitlePl: objective.titlePl, topicId: topic.id, topicVersion: topic.version, descriptionEn: objective.descriptionEn, errorCategories: [...objective.errorCategories], hints: { ...objective.hints }, topicTitlePl: topic.titlePl, extraErrorCategories: topic.extraErrorCategories.map((c) => ({ ...c })) } } : {}),
  };
  // Kryteria v3 w kluczu prywatnym: ocena szkolna (Etap 2) ich potrzebuje, a prompt dziecka ich nie zawiera.
  if (payload.requiredElements && payload.requiredElements.length > 0) {
    baseKey.schoolCriteria = {
      requiredElements: payload.requiredElements.map((el) => ({ ...el })),
      supplementaryElements: [...(payload.supplementaryElements ?? [])],
      commonErrors: [...(payload.commonErrors ?? [])],
      ...(payload.expectedForm ? { expectedForm: payload.expectedForm } : {}),
      sourceQuotes: (payload.sourceRefs ?? []).map((ref) => ref.quote),
    };
  }
  const taskContext: Record<string, unknown> = { reason: plan.reason, objectiveId: payload.objectiveId, independentCheck: plan.independentCheck };
  const common = { exerciseType: payload.exerciseType, itemRevisionId: exercise.revisionId, context: taskContext } as const;

  switch (payload.exerciseType) {
    case "lesson_notice": {
      const segments = (payload.noticeSegments ?? []).map((sentence) => sentence.map((text) => ({ id: randomUUID(), text })));
      const flat = segments.flat();
      // `correctOption` to TEKST słowa; zrównany z segmentem normalizatorem
      // przedmiotu — spójnie z `validateNotice` (dowolny wariant, np. inna
      // wielkość liter). Materializacja nie zna angielskiego: normalizator
      // pochodzi z `SubjectModule`.
      const correct =
        payload.correctOption === undefined
          ? undefined
          : flat.find((s) => answersEquivalent(s.text, payload.correctOption!, subject.normalizer));
      const prompt: TaskPrompt = {
        kind: "lesson_notice",
        instructionPl,
        segments,
      };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, ...(correct ? { correctOptionId: correct.id } : {}), segmentValues: Object.fromEntries(flat.map((s) => [s.id, s.text])) },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_choice": {
      // `correctOption` to ID opcji ŹRÓDŁOWEJ (kontrakt pool-validation:
      // `options.some(o => o.id === correctOption)`). Nadajemy nowe UUID, więc
      // poprawność wyznaczamy po ID źródłowym PRZED podmianą, nie po tekście.
      const options = seededShuffle((payload.options ?? []).map((o) => ({ id: randomUUID(), text: o.text, correct: o.id === payload.correctOption })), shuffleSeed);
      const correct = options.find((o) => o.correct);
      const prompt: TaskPrompt = {
        kind: "lesson_choice",
        ...(payload.visualSubject ? { visualSubject: payload.visualSubject } : {}),
        instructionPl,
        stem: payload.stem ?? "",
        options: options.map((o) => ({ id: o.id, text: o.text })),
        ...questionAudio,
      };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, ...(correct ? { correctOptionId: correct.id } : {}), optionValues: Object.fromEntries(options.map((o) => [o.id, o.text])) },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_short_answer": {
      // Jak w lesson_choice: `correctOption` = ID opcji źródłowej, nie tekst.
      const options = seededShuffle((payload.options ?? []).map((o) => ({ id: randomUUID(), text: o.text, correct: o.id === payload.correctOption })), shuffleSeed);
      const correct = options.find((o) => o.correct);
      const prompt: TaskPrompt = {
        kind: "lesson_short_answer",
        question: payload.prompt ?? payload.stem ?? instructionPl,
        options: options.map((o) => ({ id: o.id, text: o.text })),
      };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, ...(correct ? { correctOptionId: correct.id } : {}), optionValues: Object.fromEntries(options.map((o) => [o.id, o.text])) },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_order": {
      const canonical = (payload.items ?? []).map((item) => ({ id: randomUUID(), text: item.text }));
      // bloki nigdy nie startują w kolejności kanonicznej (już ułożone)
      // porównanie po tekście: zamiana dwóch identycznych klocków też wygląda na ułożone zdanie
      const shuffled = shuffleUnsolved(canonical, shuffleSeed, (arranged) => arranged.every((item, i) => item.text === canonical[i]!.text));
      const prompt: TaskPrompt = { kind: "lesson_order", instructionPl, items: shuffled.map((item) => ({ id: item.id, text: item.text })), ...questionAudio };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, itemIds: canonical.map((item) => item.id), itemValues: Object.fromEntries(canonical.map((item) => [item.id, item.text])) },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_gap": {
      // Kartkówka: żadnej podpowiedzi (ujawniałaby odpowiedź); trening zachowuje hint.
      const prompt: TaskPrompt = { kind: "lesson_gap", instructionPl, stemWithGap: payload.stem ?? "", ...(!mockTest && payload.hint ? { hint: payload.hint } : {}), ...audio, ...questionAudio };
      return { ...common, prompt, answerKey: baseKey, exposures: [] };
    }
    case "lesson_error_fix": {
      const prompt: TaskPrompt = { kind: "lesson_error_fix", instructionPl, statement: payload.statement ?? "", ...audio };
      return { ...common, prompt, answerKey: baseKey, exposures: [] };
    }
    case "lesson_transform": {
      const prompt: TaskPrompt = { kind: "lesson_transform", instructionPl, statement: payload.statement ?? "", ...audio };
      return { ...common, prompt, answerKey: baseKey, exposures: [] };
    }
    case "lesson_calculation": {
      try {
        if (!payload.calculation) throw new Error("missing calculation");
        // Bez własnego polecenia rachunek dostaje wspólne polecenie, nie tytuł zagadnienia.
        const prompt: TaskPrompt = {
          kind: "lesson_calculation",
          instructionPl: payload.instructionPl ?? messages.kid.lessonCalculationInstruction,
          prompt: renderCalculationPrompt(payload.calculation),
        };
        return { ...common, prompt, answerKey: { ...baseKey, calculation: payload.calculation }, exposures: [] };
      } catch {
        throw new AppError("internal", { message: "invalid private calculation payload" });
      }
    }
    case "lesson_keywords": {
      const keyIds = new Set(payload.keyOptionIds ?? []);
      const options = seededShuffle((payload.keywordOptions ?? []).map((o) => ({ id: randomUUID(), text: o.text, key: keyIds.has(o.id) })), shuffleSeed);
      const correctOptionIds = options.filter((o) => o.key).map((o) => o.id);
      // Dziecko wybiera od 2 do liczby pojęć kluczowych (2–3): wybór ponad nią
      // zawsze zawierałby dystraktor.
      const maxSelected = Math.max(2, correctOptionIds.length);
      const prompt: TaskPrompt = {
        kind: "lesson_keywords",
        instructionPl: payload.instructionPl ?? messages.kid.lessonKeywordsInstruction,
        prompt: plan.pairedOpenAnswer?.prompt || objective?.titlePl || instructionPl,
        options: options.map((o) => ({ id: o.id, text: o.text })),
        minSelected: 2,
        maxSelected,
        ...questionAudio,
      };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, correctOptionIds, minSelected: 2, maxSelected, optionValues: Object.fromEntries(options.map((o) => [o.id, o.text])) },
        exposures: [exercise.targetKey, ...(plan.pairedOpenAnswer ? [plan.pairedOpenAnswer.targetKey] : [])],
      };
    }
    case "lesson_match": {
      // Design szkoły §10.1/10.4: UUID w każdym zadaniu, kolumny tasowane
      // niezależnie, prawa nigdy nie stoi w całości naprzeciw swoich par.
      const pairs = (payload.pairs ?? []).map((pair) => ({ left: { id: randomUUID(), text: pair.left }, right: { id: randomUUID(), text: pair.right } }));
      const extras = (payload.extraRight ?? []).map((text) => ({ id: randomUUID(), text }));
      const partnerOf = new Map(pairs.map((pair) => [pair.left.id, pair.right.id] as const));
      const left = seededShuffle(pairs.map((pair) => pair.left), shuffleSeed);
      const right = shuffleUnsolved([...pairs.map((pair) => pair.right), ...extras], `${shuffleSeed}:right`,
        (arranged) => left.every((item, i) => arranged[i]?.id === partnerOf.get(item.id)));
      const prompt: TaskPrompt = { kind: "lesson_match", instructionPl: payload.instructionPl ?? messages.kid.lessonMatchInstruction, left, right, ...questionAudio };
      return {
        ...common,
        prompt,
        answerKey: {
          ...baseKey,
          assignments: pairs.map((pair) => ({ itemId: pair.left.id, targetId: pair.right.id })),
          targetIds: right.map((item) => item.id),
          targetOnce: true,
          itemIds: left.map((item) => item.id),
          itemValues: Object.fromEntries([...left, ...right].map((item) => [item.id, item.text])),
        },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_group": {
      // Design szkoły §10.2/10.4: grupy w kolejności materiału, elementy tasowane
      // tak, by nie startowały ułożone grupami.
      const groups = (payload.groups ?? []).map((group) => ({ id: randomUUID(), text: group.label, sourceId: group.id }));
      const groupIdOf = new Map(groups.map((group) => [group.sourceId, group.id] as const));
      const canonical = (payload.groupItems ?? []).map((item) => ({ id: randomUUID(), text: item.text, groupId: groupIdOf.get(item.groupId) ?? "" }));
      const rank = new Map<string, number>(groups.map((group, index) => [group.id, index] as const));
      const items = shuffleUnsolved(canonical, shuffleSeed,
        (arranged) => arranged.every((item, i) => i === 0 || (rank.get(arranged[i - 1]!.groupId) ?? 0) <= (rank.get(item.groupId) ?? 0)));
      const prompt: TaskPrompt = {
        kind: "lesson_group",
        instructionPl: payload.instructionPl ?? messages.kid.lessonGroupInstruction,
        groups: groups.map((group) => ({ id: group.id, text: group.text })),
        items: items.map((item) => ({ id: item.id, text: item.text })),
        ...questionAudio,
      };
      return {
        ...common,
        prompt,
        answerKey: {
          ...baseKey,
          assignments: canonical.map((item) => ({ itemId: item.id, targetId: item.groupId })),
          targetIds: groups.map((group) => group.id),
          itemIds: items.map((item) => item.id),
          itemValues: Object.fromEntries([...groups, ...items].map((item) => [item.id, item.text])),
        },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_open_answer": {
      // Język pytania podajemy tylko, gdy przedmiot ma jeden język (szkoła); w gramatyce
      // pytanie bywa angielskie albo jest polskim źródłem tłumaczenia — nie zgadujemy.
      const locale = subject.promptLocale === subject.answerLocale ? subject.promptLocale : null;
      const promptLocale: { promptLocale?: "pl-PL" | "en-GB" } =
        locale === "pl-PL" || locale === "en-GB" ? { promptLocale: locale } : {};
      // Dyktowanie: tylko gdy wywołujący (trening) je zaoferował — kartkówka nie przekazuje.
      const speech = !mockTest && options.speechInput ? { speechInput: options.speechInput } : {};
      const prompt: TaskPrompt = { kind: "lesson_open_answer", instructionPl, prompt: payload.prompt ?? "", ...audio, ...questionAudio, ...promptLocale, ...speech };
      return { ...common, prompt, answerKey: baseKey, exposures: [] };
    }
    default:
      throw new AppError("internal", { message: `cannot materialize lesson type ${payload.exerciseType}` });
  }
}

/**
 * `speechInput` promptu: tylko trening z włączonym mikrofonem, skonfigurowane
 * STT lekcji i przedmiot deklarujący mowę dla tego typu ćwiczenia. Kartkówka
 * zostaje pisemna (design §5.9 pkt 4).
 */
export function speechInputFor(
  services: Pick<Services, "lessonSpeech">,
  session: { mode: string; microphoneEnabled: boolean },
  subject: Pick<SubjectModule, "spokenAnswers">,
  exerciseType: string,
): { speechInput: SpeechInputDto } | Record<string, never> {
  if (!services.lessonSpeech || session.mode !== "training" || !session.microphoneEnabled) return {};
  if (!subject.spokenAnswers?.exerciseTypes.some((type) => type === exerciseType)) return {};
  return { speechInput: { maxSeconds: DEFAULT_DICTATION_POLICY.maxSeconds } };
}
