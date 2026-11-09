import { exerciseExposureText } from "../exposure-key";
import { findExposureLeaks, type ExposureLeak } from "../exposure-leaks";
import { withoutOrphanKeywords } from "../keyword-families";
import { MAX_TEXT_LENGTH, validatePoolIssues } from "../pool-validation";
import { clip, issueFrom, type LessonRuleIssue, type RuleId } from "../rules/catalog";
import { LESSON_RULES } from "../rules/lesson-rules";
import type { AgentObjective, LessonExerciseDraft, SubjectModule } from "../types";
import {
  allExamples,
  orderedEntries,
  poolOf,
  takeIds,
  withExamples,
  withPool,
  type AgentPoolEntry,
  type LessonAgentState,
  type OrderedLessonEntry,
} from "./state";

/**
 * Reguły lekcji i ujawnienia dla kandydata na CAŁEJ lekcji (`fixed` + pule wszystkich zagadnień),
 * przykłady kart i usuwanie ćwiczeń — wspólne dla walidacji puli przebiegu bazowego i kontroli
 * końcowej workera. Odrzucenie ma nazwany kod i zgłoszenia z id reguł (spec katalogu reguł §4.1).
 * Czyste funkcje nad jawnym stanem.
 */

/** Fabryka zgłoszeń reguł lekcji: ujawnienia. */
const lessonIssue = issueFrom(LESSON_RULES);

/** Limit zagadnienia (§3.5): docelowa liczba ćwiczeń na ścieżce etapów (`exercises: n of m` w statusie). */
export interface ObjectiveAgentLimits {
  readonly targetCount: number;
}

/** Kontekst kontroli (§3.2). */
export interface AgentCheckContext {
  readonly subject: SubjectModule;
  readonly material: string;
  readonly limits: ReadonlyMap<string, ObjectiveAgentLimits>;
}

/**
 * Odrzucenie ćwiczenia: stały kod (logi, histogram `rejectedReasons`) i zgłoszenia złamanych reguł
 * (mogą zawierać treść ćwiczenia — nigdy do logów). `ruleIds` — id reguł zgłoszeń bez powtórzeń,
 * w kolejności zgłoszeń (logi bez treści).
 */
export interface Rejection {
  readonly kind: "shape" | "rule" | "lesson" | "leak" | "blind" | "limit";
  readonly code: string;
  readonly issues: readonly LessonRuleIssue[];
  readonly ruleIds: readonly RuleId[];
}

/** Odrzucenie ze zgłoszeń. */
export function rejectionOf(kind: Rejection["kind"], code: string, issues: readonly LessonRuleIssue[]): Rejection {
  return { kind, code, issues, ruleIds: [...new Set(issues.map((issue) => issue.rule))] };
}

/** Odrzucenia reguł lekcji i ujawnienia — po referencji szkicu (wadliwe `fixed` nie blokuje kandydatów). */
export interface LessonSnapshot {
  readonly entries: readonly OrderedLessonEntry[];
  readonly poolRejected: ReadonlyMap<LessonExerciseDraft, readonly LessonRuleIssue[]>;
  readonly extraRejected: ReadonlyMap<LessonExerciseDraft, readonly LessonRuleIssue[]>;
  readonly leaked: ReadonlyMap<LessonExerciseDraft, ExposureLeak>;
}

type LessonRules = Omit<LessonSnapshot, "leaked">;

function lessonRules(state: LessonAgentState, ctx: AgentCheckContext): LessonRules {
  const entries = orderedEntries(state);
  const lesson = entries.map((entry) => entry.draft);
  const pool = validatePoolIssues(lesson, ctx.subject, state.topic, { existingExercises: [], agent: true });
  const poolRejected = new Map(pool.rejected.map((item) => [item.exercise, item.issues] as const));
  const extraRejected = new Map<LessonExerciseDraft, readonly LessonRuleIssue[]>();
  for (const [index, issues] of ctx.subject.validatePoolExtra?.(lesson, { material: ctx.material }) ?? []) {
    const draft = lesson[index];
    if (draft !== undefined && issues.length > 0) extraRejected.set(draft, issues);
  }
  return { entries, poolRejected, extraRejected };
}

/**
 * Tryb porównań ujawnień w przyjmowaniu: `generation` (równoważność odpowiedzi po normalizatorze
 * przedmiotu, także warianty ofiary) — „Where is the box?”
 * ujawnia przykład „Where's the box?”, a wariant tłumaczenia równy zdaniu innego ćwiczenia też jest
 * ujawnieniem. Ostrzejszy od `coverage` (równość `target_key`), więc pula przyjęta tak jest czysta także
 * w pokryciu i w ostrzeżeniach szkicu. Ten sam tryb w migawce, bezpieczniku i kontroli końcowej.
 */
const ADMISSION_LEAK_MODE = "generation";

function lessonLeaks(state: LessonAgentState, entries: readonly OrderedLessonEntry[], ctx: AgentCheckContext): Map<LessonExerciseDraft, ExposureLeak> {
  const leaks = findExposureLeaks({
    exercises: entries.map((entry) => entry.draft),
    examples: allExamples(state),
    objectiveOrder: state.objectives.map((objective) => objective.id),
    subject: ctx.subject,
    mode: ADMISSION_LEAK_MODE,
    // Rodzina pytań otwartych (ta sama odpowiedź wzorcowa) nie ujawnia rozwiązania samej sobie — jak w szkicu.
    familyRepeatsAllowed: true,
  });
  return new Map(leaks.map((leak) => [entries[leak.index]!.draft, leak] as const));
}

export function snapshotOf(state: LessonAgentState, ctx: AgentCheckContext): LessonSnapshot {
  const rules = lessonRules(state, ctx);
  return { ...rules, leaked: lessonLeaks(state, rules.entries, ctx) };
}

function objectiveOf(state: LessonAgentState, objectiveId: string): AgentObjective {
  const objective = state.objectives.find((item) => item.id === objectiveId);
  if (objective === undefined) throw new Error(`unknown objective ${objectiveId}`);
  return objective;
}

function entryLabel(entry: OrderedLessonEntry | undefined): string {
  return entry?.id ? `exercise ${entry.id}` : "an existing exercise";
}

function leakVictimIssue(leak: ExposureLeak, after: readonly OrderedLessonEntry[], ctx: AgentCheckContext): LessonRuleIssue {
  const pl = "answer: odpowiedź ćwiczenia samodzielnego jest już widoczna wcześniej w lekcji";
  if (leak.source.kind === "card_example") {
    return lessonIssue("lesson.leak", { pl, found: `the child already sees this answer in the card example ${clip(leak.source.text)}` });
  }
  const source = after[leak.source.index];
  const text = source ? exerciseExposureText(ctx.subject, source.draft) : "";
  const where = leak.kind === "soft" ? "an earlier independent exercise" : entryLabel(source);
  return lessonIssue("lesson.leak", { pl, found: `the child already sees this answer in ${where} ${clip(text)}` });
}

function leakSourceIssue(victim: OrderedLessonEntry, ctx: AgentCheckContext): LessonRuleIssue {
  return lessonIssue("lesson.leak_source", {
    pl: "answer: ćwiczenie ujawniłoby odpowiedź ćwiczenia samodzielnego w lekcji",
    found: `it would reveal the answer of ${entryLabel(victim)} ${clip(exerciseExposureText(ctx.subject, victim.draft))}`,
  });
}

function newlyRejected(
  after: ReadonlyMap<LessonExerciseDraft, readonly LessonRuleIssue[]>,
  before: ReadonlyMap<LessonExerciseDraft, readonly LessonRuleIssue[]>,
  candidate: LessonExerciseDraft,
): [LessonExerciseDraft, readonly LessonRuleIssue[]][] {
  return [...after].filter(([draft]) => draft !== candidate && !before.has(draft));
}

/** Zgłoszenia ofiar kandydata (ćwiczeń, które lekcja odrzuciłaby po jego dodaniu). */
function victimIssues(victims: readonly [LessonExerciseDraft, readonly LessonRuleIssue[]][]): LessonRuleIssue[] {
  return victims.flatMap(([, issues]) => issues);
}

export type StepOutcome =
  | { readonly ok: true; readonly id: string; readonly state: LessonAgentState; readonly snapshot: LessonSnapshot }
  | { readonly ok: false; readonly rejection: Rejection };

/**
 * Reguły lekcji i ujawnienia dla kandydata na bieżącym stanie: kandydat odpada, gdy sam łamie regułę
 * albo czyni nową ofiarą inne ćwiczenie (także `fixed`). `before` to migawka bieżącego stanu; przy
 * sukcesie zwracana migawka staje się `before` następnego kandydata (każda liczona raz).
 */
export function lessonRulesStep(
  state: LessonAgentState,
  objectiveId: string,
  draft: LessonExerciseDraft,
  before: LessonSnapshot,
  ctx: AgentCheckContext,
): StepOutcome {
  const pool = poolOf(state, objectiveId);
  // Kandydat jako własny obiekt (ochronnie): porównania zbiorów po referencji odróżniają go od
  // reszty lekcji, nawet gdy wołający przekaże ten sam obiekt drugi raz.
  const candidate: LessonExerciseDraft = { ...draft };
  const taken = takeIds(state, 1);
  const id = taken.ids[0]!;
  const entry: AgentPoolEntry = { id, draft: candidate };
  const next = withPool(taken.state, objectiveId, [...pool, entry]);

  // Reguły lekcji: kandydat odrzucony albo nowe odrzucenie innego ćwiczenia.
  const rules = lessonRules(next, ctx);
  const ownPoolIssues = rules.poolRejected.get(candidate);
  if (ownPoolIssues !== undefined) return reject("lesson", "lesson_pool", ownPoolIssues);
  const ownExtraIssues = rules.extraRejected.get(candidate);
  if (ownExtraIssues !== undefined) return reject("lesson", "lesson_extra", ownExtraIssues);
  const extraVictims = newlyRejected(rules.extraRejected, before.extraRejected, candidate);
  if (extraVictims.length > 0) return reject("lesson", "lesson_extra", victimIssues(extraVictims));
  const poolVictims = newlyRejected(rules.poolRejected, before.poolRejected, candidate);
  if (poolVictims.length > 0) return reject("lesson", "lesson_pool", victimIssues(poolVictims));

  // Ujawnienia (tryb generation): kandydat ofiarą albo nowa ofiara (także `fixed`).
  const leaked = lessonLeaks(next, rules.entries, ctx);
  const ownLeak = leaked.get(candidate);
  if (ownLeak !== undefined) return reject("leak", "leak_victim", [leakVictimIssue(ownLeak, rules.entries, ctx)]);
  const leakVictims = rules.entries.filter((item) => leaked.has(item.draft) && !before.leaked.has(item.draft));
  if (leakVictims.length > 0) return reject("leak", "leak_source", leakVictims.map((victim) => leakSourceIssue(victim, ctx)));

  return { ok: true, id, state: next, snapshot: { ...rules, leaked } };
}

function reject(kind: Rejection["kind"], code: string, issues: readonly LessonRuleIssue[]): { ok: false; rejection: Rejection } {
  return { ok: false, rejection: rejectionOf(kind, code, issues) };
}

/** Najwyżej tyle przykładów kart na zagadnienie. */
export const MAX_CARD_EXAMPLES = 3;

/**
 * Przykłady kart zagadnienia od modelu (§3.4): linie przycięte, niepuste,
 * najwyżej `MAX_TEXT_LENGTH` znaków (jak `executeLessonGeneration`), bez
 * powtórzeń (identyczna linia po przycięciu liczy się raz). Linia odpada, gdy ujawnia (twardo) rozwiązanie ćwiczenia lekcji — `fixed` albo
 * puli — dotąd nieujawnionego. Przyjęte (najwyżej 3) zastępują wcześniejsze
 * przykłady zagadnienia; gdy nie przeszła żadna, stan się nie zmienia.
 */
export function submitExamples(
  state: LessonAgentState,
  objectiveId: string,
  lines: unknown,
  ctx: AgentCheckContext,
): { state: LessonAgentState; accepted: number } {
  if (!Array.isArray(lines)) return { state, accepted: 0 };
  objectiveOf(state, objectiveId);
  const kept: string[] = [];
  const entries = orderedEntries(state);
  const exercises = entries.map((entry) => entry.draft);
  const leakedBefore = lessonLeaks(state, entries, ctx);
  for (const line of lines as unknown[]) {
    if (typeof line !== "string") continue;
    const text = line.trim();
    // Pusta, za długa albo powtórzona linia nie zajmuje kolejnego z trzech miejsc.
    if (text.length === 0 || text.length > MAX_TEXT_LENGTH || kept.includes(text)) continue;
    // Ofiary samej linii: z jedynym przykładem źródłem twardym jest właśnie ona.
    const leaks = findExposureLeaks({
      exercises,
      examples: { [objectiveId]: [text] },
      objectiveOrder: state.objectives.map((objective) => objective.id),
      subject: ctx.subject,
      mode: ADMISSION_LEAK_MODE,
    }).some((leak) => leak.source.kind === "card_example" && !leakedBefore.has(entries[leak.index]!.draft));
    if (leaks || kept.length >= MAX_CARD_EXAMPLES) continue;
    kept.push(text);
  }
  if (kept.length === 0) return { state, accepted: 0 };
  return { state: withExamples(state, objectiveId, kept), accepted: kept.length };
}

/**
 * Usuwa ćwiczenie z puli tego zagadnienia razem z osieroconymi słowami
 * kluczowymi jego rodziny. Nieznany identyfikator, wpis innego zagadnienia
 * albo ćwiczenie `fixed` → `removed: []` i stan bez zmian.
 */
export function removeExercise(
  state: LessonAgentState,
  objectiveId: string,
  id: string,
): { state: LessonAgentState; removed: string[] } {
  const pool = poolOf(state, objectiveId);
  if (!pool.some((entry) => entry.id === id)) return { state, removed: [] };
  const remaining = pool.filter((entry) => entry.id !== id);
  const kept = new Set(withoutOrphanKeywords(state.fixed, remaining.map((entry) => entry.draft)).kept);
  const survivors = remaining.filter((entry) => kept.has(entry.draft));
  const removed = pool.filter((entry) => !survivors.includes(entry)).map((entry) => entry.id);
  return { state: withPool(state, objectiveId, survivors), removed };
}
