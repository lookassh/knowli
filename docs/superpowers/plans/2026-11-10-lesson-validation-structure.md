# Walidacja strukturalna ćwiczeń lekcji (pakiet A) — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zamknąć sześć luk strukturalnych walidacji ćwiczeń lekcji znalezionych w przeglądzie modułu generowania (powtórzone id opcji, limit długości odpowiedzi liczonej przez kod, puste elementy list, zdegenerowane przeliczenie jednostek, kolizja tożsamości par, reguły rachunku bez `limit`).

**Architecture:** Wszystko w `packages/server/src/domain/lessons` (czysta domena, bez bazy i transakcji): nowe wpisy katalogu rdzenia `rules/core-rules.ts`, sprawdzenia w `pool-validation.ts` zgłaszane fabryką `coreIssue` (`issueFrom(CORE_RULES)`) z literałem id, przypadki w `rules/core.rule-cases.ts`. Bez nowych modułów, zależności ani abstrakcji; `packages/contracts` bez zmian (uzasadnienie w zadaniu 4).

**Tech Stack:** TypeScript strict, Zod 4, Vitest.

**Spec:** ustalenia przeglądu przekazane w zleceniu pakietu A (sześć punktów poniżej); osobnego specu nie ma. Konwencje: `docs/agents/lessons.md`, `docs/architecture.md` §19.17.

## Global Constraints

- Nowa reguła = wpis katalogu z angielskim opisem, liczby tylko ze stałych, przypadek naruszenia w `core.rule-cases.ts` (z `limit` także `boundary`), zgłoszenie tylko `coreIssue("<literał id>", …)`.
- Żadnych reguł rozumiejących język naturalny; nie zmieniać istniejących heurystyk (`confusableTexts`, `wordsOfText`, `cloze.bank_word_empty`, `normalize.ts`).
- Nie ruszać: promptów, `packages/server/src/providers/` (poza świadomą aktualizacją migawek promptu, jeśli się zmienią), `lesson-baseline-pool.ts`, `modules/materials/generation.ts`, `apps/web`.
- Komunikaty `pl` istniejących reguł bez zmian.
- Weryfikacja: `corepack pnpm vitest run <ścieżka>` per zadanie, na końcu `pnpm check`. Bez E2E i bez płatnych wywołań.
- Commity kończyć linią `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Weryfikacja ustaleń w kodzie (stan `origin/main` b0f97190)

| # | Ustalenie | Stan |
| --- | --- | --- |
| 1 | `validateOptions` nie sprawdza unikalności `options[].id`; `lesson-materialize.ts` oznacza `correct` każdą opcję o id z `correctOption` i bierze pierwszą po tasowaniu | potwierdzone; dotyczy `lesson_choice`, `lesson_short_answer` z opcjami i `lesson_listen_choice` (wszystkie przez `validateOptions`). `keywordOptions` i `groups` mają już reguły unikalności; `items` rozsypanki dostają przy materializacji nowe UUID, więc powtórzone id źródłowe nie wpływa na klucz — bez nowej reguły; `pairs` i `noticeSegments` nie mają id |
| 2 | Limit 120 znaków `answer` dla przedmiotów bez v3 obejmuje odpowiedź liczoną przez kod | potwierdzone (`pool-validation.ts:542-548`); liczona odpowiedź może mieć do 208 znaków w parach, 124 w keywords, 126 w cloze — wszystkie mieszczą się w limicie kontraktu 300 |
| 3 | Elementy z samych białych znaków przechodzą (kontrakt ma `min(1)` bez `trim`) | potwierdzone dla `options`, `items`, `pairs`, `extraRight`, `groups[].label`, `groupItems`, `keywordOptions`; `noticeSegments` ma `notice.segment_empty`, bank cloze ma `cloze.bank_word_empty` |
| 4 | `unit_conversion` z `fromUnit === unit` przechodzi | potwierdzone. **Odstępstwo od proponowanej poprawki:** `CalculationSpecSchema.parse` jest wołany przy renderowaniu i ocenie zadania w sesji (`validatedCalculation` w `calculation.ts`), więc `refine` w kontrakcie wywróciłby sesję na już opublikowanym (niezmiennym) ćwiczeniu tego kształtu. Sprawdzenie trafia do walidacji zapisu (`validateByType`), która obejmuje generowanie, edycję rodzica i MCP authoring; kontrakt, JSON Schema i skill bez zmian |
| 5 | Tożsamość par skleja strony znakiem `=` | potwierdzone. `lessonExerciseStimulus` zasila zapisywane `skill_versions.criteria.assignments` i `criteria_hash`, ale zapisany hash nie jest nigdzie porównywany ze świeżo liczonym: `lesson-api.ts:584` liczy oba hashe od nowa z payloadów, a pozostałe miejsca tylko zapisują. Zmiana formatu jest więc bezpieczna (stare wiersze zostają w starym formacie jako historia) |
| 6 | `calculation.params` i `calculation.family_slug` mają granice liczbowe bez `limit` | potwierdzone |

## Review Focus

- Zapisany szkic z powtórzonym id opcji albo pustym elementem: po zmianie rodzic nie zapisze/opublikuje go bez poprawki (zamierzone), ale odczyt szkicu i trwająca sesja nie mogą się wywrócić — walidacja działa tylko na ścieżkach zapisu.
- Opublikowane `unit_conversion` z tą samą jednostką dalej renderuje się i ocenia (test w zadaniu 4 woła `renderCalculationPrompt` na takim spec).
- Element z symbolu (`>`, `+`, `?`, `…`) nadal przechodzi — reguła pustego elementu to wyłącznie `trim() === ""` (test w zadaniu 3).
- `lesson_match` przedmiotu bez v3 z odpowiedzią liczoną > 120 znaków przechodzi, a ręcznie pisana odpowiedź > 120 znaków (np. `lesson_open_answer`) dalej nie (test w zadaniu 2).
- Pary różniące się tylko położeniem `=` mają różną tożsamość; kolejność par nadal bez znaczenia (test w zadaniu 5).

---

### Task 1: reguła `options.ids_unique`

**Files:**
- Modify: `packages/server/src/domain/lessons/rules/core-rules.ts` (po `options.duplicate`)
- Modify: `packages/server/src/domain/lessons/pool-validation.ts` (`validateOptions`)
- Modify: `packages/server/src/domain/lessons/rules/core.rule-cases.ts` (sekcja opcji)

- [ ] **Step 1: przypadek (czerwony).** W `core.rule-cases.ts` dopisz:

```ts
{
  rule: "options.ids_unique",
  violation: check(choice({ options: [{ id: "a", text: "plays" }, { id: "a", text: "play" }, { id: "b", text: "played" }] })),
},
```

- [ ] **Step 2:** `corepack pnpm vitest run packages/server/src/domain/lessons/rules/rule-cases.test.ts` → FAIL („przypadek reguły spoza katalogów”).
- [ ] **Step 3: wpis katalogu** — `"options.ids_unique": { field: "options", kind: "reject", promptBrief: true, types: CHOICE_TYPES, description: "The ids of options are unique." }` (jak `keywords.option_ids_unique`; `promptBrief`, bo to rzadko łamana spójność identyfikatorów). FAIL zmienia się na „violation() nie zgłasza reguły”.
- [ ] **Step 4: sprawdzenie** w `validateOptions` zaraz po liczności, wzorem `validateKeywords`: `firstRepeated(options.map((o) => o.id))` → `coreIssue("options.ids_unique", { field: \`options[${index}].id\`, pl: "options: identyfikatory opcji muszą być unikalne", found: \`id ${clip(value)} repeats in options\` })`.
- [ ] **Step 5:** `corepack pnpm vitest run packages/server/src/domain/lessons` → PASS (w tym testy katalogu, AST i `CORE_CASE_BASELINES`).
- [ ] **Step 6:** commit `Lekcje: reguła options.ids_unique`.

### Task 2: bez limitu 120 znaków dla odpowiedzi liczonej przez kod

**Files:**
- Modify: `packages/server/src/domain/lessons/pool-validation.ts:542-548`
- Test: `packages/server/src/domain/lessons/pool-validation.issues.test.ts` (albo plik, w którym są już testy `answer.max_length` — wybierz istniejący `describe` reguł odpowiedzi)

- [ ] **Step 1: test (czerwony).** Przedmiot bez v3 (wzorzec przedmiotu testowego z tego pliku), `lesson_match` z 4 parami o lewych stronach po 30 znaków (`matchAnswer` = 126 znaków): oczekuj braku zgłoszenia `answer.max_length`. Drugi `expect` w tym samym teście: `lesson_open_answer` z `answer` o 121 znakach dalej zgłasza `answer.max_length`.
- [ ] **Step 2:** uruchom plik → FAIL (`answer.max_length` dla match).
- [ ] **Step 3:** warunek `if (answerLength > MAX_TEXT_LENGTH && COMPUTED_ANSWER_SOURCES[ex.exerciseType] === undefined)`; komentarz jednym zdaniem (długość liczonej odpowiedzi wynika z pól źródłowych z własnymi limitami). Sprawdzenie `acceptedAnswers` bez zmian.
- [ ] **Step 4:** plik + `rules/rule-cases.test.ts` → PASS.
- [ ] **Step 5:** commit.

### Task 3: reguła `field.blank` (element listy z samych białych znaków)

**Files:**
- Modify: `rules/core-rules.ts` (po `field.empty`), `pool-validation.ts`, `rules/core.rule-cases.ts`

- [ ] **Step 1: przypadki (czerwone)** — po jednym na pole, żeby każda gałąź miała dowód:

```ts
{ rule: "field.blank", violation: check(choice({ options: [{ id: "a", text: "plays" }, { id: "b", text: " " }] })) },
{ rule: "field.blank", violation: check(order(["She", " ", "plays", "tennis"], "She plays tennis")) },
{ rule: "field.blank", violation: check(match([...RIVERS.slice(0, 2), { left: "Kraków", right: " " }])) },
{ rule: "field.blank", violation: check(match([...RIVERS.slice(0, 2), { left: "\t", right: "miasto" }])) },
{ rule: "field.blank", violation: check(match(RIVERS, [" "])) },
{ rule: "field.blank", violation: check(group([ANIMAL_GROUPS[0]!, { id: "g2", label: " " }], ANIMALS)) },
{ rule: "field.blank", violation: check(group(ANIMAL_GROUPS, [...ANIMALS.slice(0, 3), { text: " ", groupId: "g2" }])) },
{ rule: "field.blank", violation: check(keywords([...TERMS.slice(0, 3), { id: "k4", text: " " }], ["k1", "k2"])) },
```

  Do `pool-validation.issues.test.ts` test „symbol nie jest pustym elementem”: opcje `[">", "<"]` i `["?", "…"]` w `lesson_choice` nie zgłaszają `field.blank`.
- [ ] **Step 2:** uruchom `rules/rule-cases.test.ts` → FAIL.
- [ ] **Step 3: wpis** `"field.blank": { field: "exercise", kind: "reject", promptBrief: true, description: "No option text, order item, pair side, extraRight entry, group label, group item or keyword term is only whitespace." }`.
- [ ] **Step 4: sprawdzenie** — jedna funkcja `validateBlankElements(ex: LessonExerciseDraft, issues: LessonRuleIssue[]): void` w `pool-validation.ts`, wołana w `validateLessonExerciseIssues` tuż przed `validateByType`. Zbiera pary `[field, text]` z pól: `options[i]`, `items[i]`, `pairs[i].left`, `pairs[i].right`, `extraRight[i]`, `groups[i].label`, `groupItems[i]`, `keywordOptions[i]`; dla `text.trim() === ""` zgłasza `coreIssue("field.blank", { field, pl: \`${field}: element nie może składać się z samych białych znaków\`, found: "blank text" })`. Bez sprawdzania liter/cyfr; `noticeSegments`, `gapAnswers`, `extraWords` pomija (mają własne reguły).
- [ ] **Step 5:** `corepack pnpm vitest run packages/server/src/domain/lessons` → PASS.
- [ ] **Step 6:** commit.

### Task 4: reguła `calculation.same_unit`

**Files:**
- Modify: `rules/core-rules.ts` (sekcja rachunku), `pool-validation.ts` (`validateByType`), `rules/core.rule-cases.ts`
- Test: `packages/server/src/domain/lessons/calculation.test.ts`

- [ ] **Step 1: przypadek (czerwony).**

```ts
{
  rule: "calculation.same_unit",
  violation: check({
    ...open(), exerciseType: "lesson_calculation",
    calculation: { kind: "unit_conversion", params: { value: 5, fromUnit: "m" }, unit: "m", templateFamilyId: "unit-m" },
  }, richSubject),
},
```

  W `calculation.test.ts` test zgodności wstecz: `renderCalculationPrompt` tego spec zwraca `"Przelicz 5 m na m."` (opublikowane ćwiczenie dalej działa; kontrakt go nie odrzuca).
- [ ] **Step 2:** FAIL w `rule-cases.test.ts`.
- [ ] **Step 3: wpis** `"calculation.same_unit": { field: "calculation.params.fromUnit", kind: "reject", types: ["lesson_calculation"], priority: "calculation_shape", description: "In unit_conversion, params.fromUnit differs from unit." }` (w prompcie — model musi ją znać, żeby jej nie łamać).
- [ ] **Step 4: sprawdzenie** — nowa gałąź `case "lesson_calculation":` w `validateByType`: gdy `ex.calculation?.kind === "unit_conversion"` i `params.fromUnit === unit` → `coreIssue("calculation.same_unit", { pl: "calculation.params.fromUnit: jednostka wejściowa musi różnić się od jednostki wyniku", found: \`fromUnit and unit are both ${clip(unit)}\` })`. `height_difference` 100/100 zostaje.
- [ ] **Step 5:** `corepack pnpm vitest run packages/server/src/domain/lessons packages/server/src/providers/openai/lesson-pool-prompt.test.ts`. Jeśli migawka promptu się różni: przeczytaj diff, upewnij się, że jedyna zmiana to nowa linia reguły, zaktualizuj `-u` i dołącz do commita.
- [ ] **Step 6:** commit.

### Task 5: tożsamość par bez kolizji separatora

**Files:**
- Modify: `packages/server/src/domain/lessons/exercise-identity.ts:104`
- Test: `packages/server/src/domain/lessons/exercise-identity.test.ts`

- [ ] **Step 1: test (czerwony).** `lessonExerciseIdentity` dla par `[{left:"a=b", right:"c"}]` i `[{left:"a", right:"b=c"}]` jest różna; dla tych samych par w odwrotnej kolejności — równa. Popraw istniejącą asercję zapisanego bodźca na `JSON.stringify([JSON.stringify(["don’t!", "nie."])])`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** w `baseStimulus` para jako `JSON.stringify([normalizeStimulus(pair.left), normalizeStimulus(pair.right)])` (sortowanie napisów bez zmian).
- [ ] **Step 4:** `corepack pnpm vitest run packages/server/src/domain/lessons packages/server/src/modules/materials/lessons` → PASS (testy jednostkowe; integracyjnych z zapisanym formatem poszukaj `grep -rn '"=' tests/integration packages/server/src --include=*.test.ts` po `assignments`).
- [ ] **Step 5:** commit.

### Task 6: `limit` dla `calculation.params` i `calculation.family_slug`

**Files:**
- Modify: `rules/core-rules.ts`, `rules/core.rule-cases.ts`

- [ ] **Step 1:** dodaj `limit: "MAX_TEMPLATE_FAMILY_ID_LENGTH"` i `limit: "MAX_CALCULATION_PARAMETER"` (pole przyjmuje jedną nazwę; pozostałe dwie stałe opisu `calculation.params` pokrywają osobne przypadki). Uruchom `rules/rule-cases.test.ts` → FAIL („reguła z limitem … bez przypadku granicznego”).
- [ ] **Step 2: przypadki** (wszystkie przez `calculationIssues`, stałe z `@learning/contracts`):
  - `family_slug`: istniejący (podkreślenie) dostaje `boundary` z `scale`; nowy: `"a".repeat(MAX_TEMPLATE_FAMILY_ID_LENGTH + 1)` / `"a".repeat(MAX_TEMPLATE_FAMILY_ID_LENGTH)`.
  - `params`: istniejący (`mapDistanceCm: -1`) dostaje `boundary` z `mapDistanceCm: 0`; nowe: `mapDistanceCm: MAX_CALCULATION_PARAMETER + 1` / `MAX_CALCULATION_PARAMETER`; `scaleDenominator: MAX_SCALE_DENOMINATOR + 1` / `MAX_SCALE_DENOMINATOR` (z `mapDistanceCm: 1`); `mapDistanceCm: 1 / 10 ** (MAX_CALCULATION_DECIMALS + 1)` / `1 / 10 ** MAX_CALCULATION_DECIMALS`.
- [ ] **Step 3:** `rules/rule-cases.test.ts` i `rules/catalog.test.ts` → PASS.
- [ ] **Step 4:** commit.

### Task 7: dokumentacja i weryfikacja całości

- [ ] W `docs/architecture.md` §19.17 dopisz jedno zdanie przy katalogu reguł: nowe reguły rdzenia `options.ids_unique`, `field.blank`, `calculation.same_unit`; limit odpowiedzi nie dotyczy odpowiedzi liczonej; tożsamość par jako para JSON; `calculation.same_unit` celowo poza kontraktem (opublikowane ćwiczenia).
- [ ] `corepack pnpm vitest run packages/server/src/modules --testNamePattern architecture` nie jest potrzebne (brak zmian w `modules/`); uruchom `pnpm check`.
- [ ] `pnpm test:integration` tylko jeśli grep z zadania 5 znajdzie test integracyjny z formatem `assignments`.
- [ ] Commit, potem przegląd trzech krytyków, `ponytail:ponytail-review`, PR.

## Poza zakresem / do decyzji właściciela

- Elementy czysto interpunkcyjne (`…`, `?`, `!`, `—`) i znaki niewidoczne spoza `trim()` (np. U+200B) — wymagają decyzji o normalizacji symboli (osobny pakiet).
- Przeniesienie `fromUnit !== unit` do kontraktu po sprawdzeniu, że produkcja nie ma takich opublikowanych ćwiczeń.
- Unikalność `items[].id` rozsypanki (dziś bez skutku w sesji).

## Poprawki po przeglądzie trzech krytyków planu (obowiązują przed treścią zadań)

- **Zadanie 2:** zamiast osobnego testu na przedmiocie gramatyki (nie wspiera par, więc nie dowodzi przyjęcia ćwiczenia) — wpis `match (długa odpowiedź liczona)` w `CORE_CASE_BASELINES` (4 pary, lewe strony po 30 znaków; test `issues.test.ts` wymaga pustej listy zgłoszeń). Dalsze odrzucanie ręcznej odpowiedzi > 120 znaków pilnuje istniejący przypadek `answer.max_length`.
- **Zadanie 3:** jeden przypadek reguły w `core.rule-cases.ts` (opcja), a wszystkie gałęzie w `it.each` w `pool-validation.issues.test.ts` z asercją dokładnego `field` (`options[1]`, `items[1]`, `pairs[2].right`, `pairs[2].left`, `extraRight[0]`, `groups[1].label`, `groupItems[3]`, `keywordOptions[3]`). Listy v3 (`requiredElements`, `supplementaryElements`, `commonErrors`), `focus` i `acceptedAnswers` — poza zakresem (sekcja niżej).
- **Zadanie 4:** reguła zostaje w prompcie z `priority: "calculation_shape"` (przebieg bazowy nie ma rund naprawy, więc reguła poza promptem tylko marnowałaby ćwiczenia); zaktualizuj `rules/rule-book.test.ts:201` (cztery id w kolejności alfabetycznej). Test zgodności wstecz jest testem charakteryzującym (zielony przed i po): `renderCalculationPrompt`, `computeCalculationAnswer` i `evaluateCalculationAnswer("5 m")` na spec m→m.
- **Zadanie 5:** para jako krotka `[left, right]` (jak `lesson_group`), bez zagnieżdżonego `JSON.stringify` — bodziec trafia też do `found` (`exerciseLabel`). Kod jest w `exercise-identity.ts:100`. Zaktualizuj komentarz przy `dedupStimulus`. Test integracyjny nie jest potrzebny (`tests/integration/lesson-generation.test.ts:714` liczy tożsamość od nowa).
- **Zadanie 1:** dodatkowy przypadek dla `lesson_listen_choice` (osobna ścieżka `validateListenChoice` → `validateOptions`).
- **Do zgłoszenia, nie do zmiany (`apps/web` poza zakresem):** `LessonEditor.tsx:841-844` przy przełączeniu rodzaju na `unit_conversion` ustawia `fromUnit: "m"` i zostawia `unit`; dla `unit: "m"` powstaje m→m, które zapis teraz odrzuci komunikatem walidacji.
