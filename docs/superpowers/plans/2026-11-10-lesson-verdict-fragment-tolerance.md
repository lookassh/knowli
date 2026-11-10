# Ocena wiedzy mimo wadliwych fragmentów i zachowany tekst po nieudanej ocenie — plan (story 3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development albo superpowers:executing-plans. Kroki mają pola wyboru (`- [ ]`).

**Cel:** wadliwy fragment w werdykcie modelu nie zamienia oceny wiedzy w „Nie udało się ocenić” (CAP-3), a po nieudanej ocenie tekst dziecka zostaje w polu (CAP-4).

**Spec:** `_bmad-output/specs/spec-dyktowana-odpowiedz-sciezka-dziecka/` — story 3 w `stories.yaml`, wiersze AC-11–16 i AC-33 w `acceptance-scenarios.md`, ograniczenia CAP-3 w `SPEC.md`, miejsca w kodzie w `brownfield.md`.

**Moduły i granice:** reguła walidacji zostaje czystą funkcją domeny (`packages/server/src/domain/lessons/evaluate.ts`). Przypadek użycia `lesson-attempts.ts` nie zmienia się: transakcja fazy 2 zapisuje do cache to, co zwróci walidator. Kid UI dostaje jeden opcjonalny prop widoku; bez zmiany DTO, API, MCP i `SKILL.md`. Bez zmiany promptu, więc bez nowej wersji promptu i bez migracji.

## Decyzje

1. Pomijane są fragmenty wszystkich trzech list (`incorrectStatements`, `redundantFragments`, `offTopicFragments`): niedosłowne, puste, powtórzone i nachodzące na zachowany już fragment innej kategorii. Kolejność rozstrzygania: błędne stwierdzenia, potem zbędne, potem nie na temat; w obrębie listy — kolejność modelu.
2. Luka w wiedzy (`hasGap`) liczy się z surowej listy modelu, przed pominięciem (AC-13). Reguły wiedzy — identyfikatory, partycja, `correct` bez luk, `partial`/`incorrect` z luką, pomylone pojęcia — zostają odrzucające bez zmian.
3. Schemat Zod: listy zbędnych i nie na temat tracą limit 4 i wymóg niepustego tekstu; po odsianiu zostają najwyżej 4 pierwsze poprawne (AC-12). Limit 4 błędnych stwierdzeń w schemacie zostaje (poza AC).
4. Nachodzenie liczone jak dotąd: pierwsze wystąpienie bez rozróżniania wielkości liter, zgodnie z `buildAnswerSegments`. Nachodzenie w obrębie jednej kategorii nadal dozwolone.
5. CAP-4 tylko w `LessonSentenceView` (odpowiedź otwarta, poprawa zdania, przekształcenie, rachunek). `useRetryReset` i pozostałe widoki bez zmian (AC-16). Sygnał: prop `keepDraftOnRetry` ustawiany przez `LearnScreen`, gdy pokazany feedback jest techniczny (`lessonFeedbackView(dto)?.technical`); widok zatrzaskuje go w refie, dopóki dok jest widoczny, bo dok i feedback znikają w tym samym renderze.

## Zadanie 1: walidator pomija wadliwe fragmenty (AC-11, AC-12, AC-13, AC-14)

**Pliki:** `packages/server/src/domain/lessons/evaluate.ts`, `packages/server/src/domain/lessons/evaluate.test.ts`

- [ ] **Krok 1 — testy (czerwone).** W `describe("werdykt szkolny dwuwymiarowy (Etap 2)")` i bloku v3 zmień asercje, które dziś oczekują `null` dla wadliwego fragmentu, i dopisz:

```ts
it("pomija wadliwy fragment zamiast unieważniać ocenę wiedzy (AC-11, AC-12)", () => {
  const ok = { knowledge: "correct", precision: "verbose", matchedElementIds: ["e1", "e2"], missingElementIds: [], incorrectStatements: [], note: "" };
  const v = validateSchoolVerdict({ ...ok, redundantFragments: ["nie ma tego w odpowiedzi", "opowiada o pogodzie"] }, CTX);
  expect(v?.knowledge).toBe("correct");
  expect(v?.redundantFragments).toEqual(["opowiada o pogodzie"]);
  // pięć fragmentów: zostają cztery pierwsze poprawne, powtórzenie i pusty odpadają
  const many = validateSchoolVerdict({ ...ok, redundantFragments: ["Roślina", "Roślina", "", "wytwarza", "cukry", "uparcie", "opowiada"] }, CTX);
  expect(many?.redundantFragments).toEqual(["Roślina", "wytwarza", "cukry", "uparcie"]);
  // zbędny nachodzący na nie na temat: zostaje wcześniejsza kategoria
  const overlap = validateSchoolVerdict({ ...ok, redundantFragments: ["uparcie opowiada"], offTopicFragments: ["opowiada o pogodzie"] }, CTX);
  expect(overlap?.redundantFragments).toEqual(["uparcie opowiada"]);
  expect(overlap?.offTopicFragments).toEqual([]);
});

it("reguły wiedzy zostają odrzucające, a niedosłowne błędne stwierdzenie nadal jest luką (AC-13)", () => {
  const base = { precision: "concise", matchedElementIds: ["e1", "e2"], missingElementIds: [], redundantFragments: [], note: "" };
  expect(validateSchoolVerdict({ ...base, knowledge: "correct", incorrectStatements: ["tego nie ma"] }, CTX)).toBeNull();
  const partial = validateSchoolVerdict({ ...base, knowledge: "partial", incorrectStatements: ["tego nie ma"] }, CTX);
  expect(partial?.knowledge).toBe("partial");
  expect(partial?.incorrectStatements).toEqual([]);
  expect(gradeFromSchoolVerdict(partial!).errorCategory).toBe("wrong_fact");
});

it("poprawna rozwlekła odpowiedź bez ocalałych fragmentów nie dostaje skracania (AC-14)", () => {
  const v = validateSchoolVerdict({
    knowledge: "correct", precision: "verbose", matchedElementIds: ["e1", "e2"], missingElementIds: [],
    incorrectStatements: [], redundantFragments: ["zmyślony fragment"], note: "",
  }, CTX)!;
  expect(shouldOfferShorten({
    trainingSession: true, followUp: false, graderCallsLeft: 5, remainingWithThisTask: 9,
    details: { knowledge: v.knowledge, precision: v.precision, redundantFragments: v.redundantFragments, offTopicFragments: v.offTopicFragments },
  })).toBe(false);
});
```

Istniejące asercje do odwrócenia (z `toBeNull()` na zachowaną ocenę z pominiętym fragmentem): fragment spoza odpowiedzi (linia ~442), ten sam tekst w dwóch kategoriach i fragment nie na temat pokrywający błędne stwierdzenie lub spoza odpowiedzi (~542–544, ~563), nachodzenie częściowe (~571–575). Każda ma sprawdzić, która lista zachowała fragment.

- [ ] **Krok 2.** `corepack pnpm vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/evaluate.test.ts` — nowe testy czerwone.

- [ ] **Krok 3 — implementacja.** W schemacie: `redundantFragments: z.array(z.string())`, `offTopicFragments: z.array(z.string()).default([])`. W `validateSchoolVerdict` zastąp pętlę dosłowności, sprawdzenie duplikatów i `categoriesOverlap` (funkcję usuń) jednym odsiewem:

```ts
const MAX_SCHOOL_FRAGMENTS = 4;

// Wadliwy fragment (niedosłowny, pusty, powtórzony, nachodzący na inną kategorię) jest
// pomijany, a nie unieważnia oceny wiedzy; lukę policzono wyżej z surowej listy modelu.
const answerNfc = ctx.childAnswer.normalize("NFC");
const haystack = answerNfc.toLowerCase();
const seen = new Set<string>();
const spans: { category: number; start: number; end: number }[] = [];
const keepValid = (fragments: readonly string[], category: number): string[] => {
  const kept: string[] = [];
  for (const fragment of fragments) {
    const text = fragment.normalize("NFC");
    if (kept.length === MAX_SCHOOL_FRAGMENTS || text.trim() === "" || seen.has(text) || !answerNfc.includes(text)) continue;
    // Zakres jak w buildAnswerSegments: pierwsze wystąpienie bez rozróżniania wielkości liter.
    const start = haystack.indexOf(text.toLowerCase());
    const end = start + text.length;
    if (spans.some((s) => s.category !== category && s.start < end && start < s.end)) continue;
    seen.add(text);
    spans.push({ category, start, end });
    kept.push(fragment);
  }
  return kept;
};
const incorrectStatements = keepValid(v.incorrectStatements, 0);
const redundantFragments = keepValid(v.redundantFragments, 1);
const offTopicFragments = keepValid(v.offTopicFragments, 2);
```

Zwracany obiekt używa tych trzech list. Zaktualizuj komentarz JSDoc funkcji (fragmenty wadliwe są pomijane; odrzucają tylko reguły wiedzy).

- [ ] **Krok 4.** Ten sam test — zielony. Commit.

## Zadanie 2: werdykt z pominiętym fragmentem na prawdziwej ścieżce prób (AC-11, AC-33)

**Plik:** `tests/integration/lesson-grader-school.test.ts`

- [ ] **Krok 1.** Dopisz test: fake grader (`onAnswer`) zwraca dla odpowiedzi częściowej werdykt `partial` z jednym niedosłownym fragmentem zbędnym. Asercje: feedback `lesson_hint` (nie `not_assessed`); wiersz `lesson_verdicts` istnieje i ma pustą listę `redundant_fragments`; po dojściu do tego samego zadania otwartego w kolejnej sesji ta sama odpowiedź nie zwiększa `grader.callCount`. Jeśli plan sesji nie wyda tego samego zadania ponownie, drugą połowę zastąp bezpośrednim sprawdzeniem wiersza cache i odnotuj to w raporcie.
- [ ] **Krok 2.** `pnpm test:integration tests/integration/lesson-grader-school.test.ts` — zielony. Commit.

## Zadanie 3: tekst zostaje po „Nie udało się ocenić” (AC-15, AC-16)

**Pliki:** `packages/kid-ui/src/exercises/types.ts`, `packages/kid-ui/src/exercises/lesson/LessonSentenceView.tsx`, `packages/kid-ui/src/screens/LearnScreen.tsx`, `packages/kid-ui/src/exercises/lesson/dictation-views.test.tsx`. Najpierw przeczytaj `docs/agents/kid-ui.md` (bez zmiany layoutu, więc bez testu geometrii).

- [ ] **Krok 1 — testy (czerwone)** w `dictation-views.test.tsx`:

```tsx
it("po nieudanej ocenie ponowienie zostawia tekst i sposób wprowadzenia (AC-15)", () => {
  const { props, rerender } = renderSentence({ dictation: heard(1, "Roślina wytwarza cukry") });
  rerender({ dictation: heard(1, "Roślina wytwarza cukry"), dock: <span>dock</span>, keepDraftOnRetry: true });
  rerender({ dictation: heard(1, "Roślina wytwarza cukry") });
  expect(field().value).toBe("Roślina wytwarza cukry");
  fireEvent.click(check());
  expect(props.handlers.onSubmitText).toHaveBeenCalledWith("Roślina wytwarza cukry", "speech");
  rerender({ dictation: heard(2, "Nowa odpowiedź") });
  expect(field().value).toBe("Nowa odpowiedź");
});

it("zwykłe ponowienie czyści pole jak dotąd (AC-16)", () => {
  const { rerender } = renderSentence({ dictation: heard(1, "Roślina wytwarza cukry") });
  rerender({ dictation: heard(1, "Roślina wytwarza cukry"), dock: <span>dock</span> });
  rerender({ dictation: heard(1, "Roślina wytwarza cukry") });
  expect(field().value).toBe("");
});
```

- [ ] **Krok 2.** `corepack pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/exercises/lesson/dictation-views.test.tsx` — pierwszy test czerwony.

- [ ] **Krok 3 — implementacja.**
  - `types.ts`: `/** Feedback techniczny („Nie udało się ocenić”): ponowienie nie czyści szkicu odpowiedzi. */ keepDraftOnRetry?: boolean;`
  - `LessonSentenceView.tsx`:

```tsx
// Dok i feedback znikają w tym samym renderze, więc powód ponowienia zatrzaskujemy, póki dok jest widoczny.
const keepDraft = useRef(false);
if (dock !== undefined) keepDraft.current = keepDraftOnRetry === true;
useRetryReset(dock, () => { if (keepDraft.current) return; setText(""); dictationField.reset(); }, focusField);
```

  - `LearnScreen.tsx`: przy `<ExerciseView … dock={…}>` dodaj `keepDraftOnRetry={hasFeedback && feedback !== null && lessonFeedbackView(feedback.dto)?.technical === true}` (nazwy zmiennych dopasuj do otoczenia).

- [ ] **Krok 4.** Test widoku oraz `useRetryReset.test.tsx` i `lesson-views.test.tsx` zielone. Commit.

## Zadanie 4: dokumentacja i sprawdzenie całości

- [ ] `docs/architecture.md` §19: zdanie o walidacji werdyktu szkolnego — wadliwe fragmenty są pomijane, odrzucają reguły wiedzy. `stories.yaml`: story 3 oznaczone jako zrealizowane datą.
- [ ] `pnpm check`; `pnpm eval:school-grader --fake`; integracja z zadania 2. E2E: `tests/e2e/lesson-kid.spec.ts` na buildzie (ścieżka odpowiedzi otwartej), pełne `pnpm test:e2e:shards` przed PR.
- [ ] Trzech krytyków gałęzi, `/ponytail:ponytail-review`, PR.

## Wiersz AC → test

| AC | Test |
| --- | --- |
| AC-11 | `evaluate.test.ts` „pomija wadliwy fragment…”, integracja z zadania 2 |
| AC-12 | `evaluate.test.ts` „pomija wadliwy fragment…” (pięć fragmentów, nachodzenie) |
| AC-13 | `evaluate.test.ts` „reguły wiedzy zostają odrzucające…” oraz istniejące testy partycji i identyfikatorów |
| AC-14 | `evaluate.test.ts` „…nie dostaje skracania” |
| AC-33 | integracja z zadania 2 |
| AC-15 | `dictation-views.test.tsx` „po nieudanej ocenie…” |
| AC-16 | `dictation-views.test.tsx` „zwykłe ponowienie…”, istniejące `useRetryReset.test.tsx` |

## Poza zakresem

Zmiana promptu i wersji promptu; krok skracania przy samym `formOk === false` (story 4); zachowanie tekstu w innych widokach niż `LessonSentenceView`; limit 4 błędnych stwierdzeń.

## Poprawki po przeglądzie trzech krytyków (2026-11-10) — mają pierwszeństwo przed treścią wyżej

1. Werdykt `incorrect`, w którym po odsianiu nie zostaje żadna widoczna luka (brak brakujących elementów, brak zachowanych błędnych stwierdzeń, brak pomylonych pojęć), nadal zwraca `null`: inaczej dziecko dostałoby podpowiedź „uzupełnij odpowiedź”, choć niczego nie brakuje. `partial` w tej sytuacji zostaje oceną (`wrong_fact`), zgodnie z AC-13.
2. Długość zakresu liczona z tekstu po `toLowerCase()` (jak w usuwanym `categoriesOverlap`).
3. `incorrectStatements` zachowuje w schemacie limit 4 i wymóg niepustego tekstu; odsiew dotyczy u nich tylko niedosłowności, powtórzeń i nachodzenia.
4. Asercji z linii ~563 (`confusedConcepts`) nie odwracamy — to reguła wiedzy.
5. AC-14: w `evaluate.test.ts` tylko puste listy po odsianiu; brak kroku skracania dowodzi integracja (feedback `great`, zero zadań `followUpOf`). Przypadek z naruszoną formą jednego zdania (`formOk === false`) nadal daje krok skracania bez zaznaczeń — zamyka go story 4 (CAP-5).
6. AC-33: bez furtki; test integracyjny wysyła tę samą odpowiedź drugi raz (kolejna sesja po przesunięciu zegara) i sprawdza niezmieniony `grader.callCount`.
7. CAP-4: zatrzask trafia do `useRetryReset` jako opcjonalny czwarty argument `keep`; używają go `LessonSentenceView` i `LessonShortenView`. `LearnScreen` ustawia prop także dla pustego DTO (przekroczony czas oczekiwania pokazuje ten sam komunikat). Test AC-15 ma też wariant klawiatury.
8. Poza zakresem, jawnie: błąd sieci lub serwera przy wysyłce odmontowuje zadanie i szkic nadal ginie.
9. Dokumentacja: `docs/architecture.md` linie ~937 i ~942. Liczba „odrzucone przez walidację” w sondzie spadnie, więc nie porównuje się jej z `speech-baseline.md`.
