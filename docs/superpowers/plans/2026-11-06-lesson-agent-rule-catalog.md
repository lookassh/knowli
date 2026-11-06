# Katalog reguł walidacji lekcji z opisami w prompcie agenta — plan implementacji (#237, PR 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Wersja 1, 2026-11-06.

**Goal:** Każda deterministyczna reguła, która odrzuca albo oczyszcza ćwiczenie agenta puli, ma wpis w katalogu z opisem dla modelu. Prompt agenta składa się z tych opisów, odrzucenie podaje id reguły i konkretną wartość, a trzy poluzowania (podpowiedź, cytaty, warianty) działają zgodnie ze spec.

**Architecture:**
- Katalogi reguł to czyste dane w domenie: rdzeń i lekcja w `domain/lessons/rules/`, przedmiot w `domain/lessons/subjects/<przedmiot>/rules.ts`, podpięty polem `SubjectModule.rules`.
- Walidatory zgłaszają `LessonRuleIssue` przez fabrykę katalogu. Publiczne funkcje dla rodzica zostają cienkimi opakowaniami zwracającymi dzisiejsze polskie napisy (`pl`).
- Przyjmowanie agenta formatuje zgłoszenia do `RuleReason`, a narzędzia składają wynik z mapą opisów reguł.
- Domenowa `lessonRuleBook` daje karty typów i reguły, które adapter renderuje zamiast ręcznych fragmentów promptu.
- Kolejność zadań trzyma każdy commit w stanie kompilującym się i zielonym.

**Tech Stack:** TypeScript strict, Zod 4, Vitest (unit; integracja na Postgresie w kontenerze), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-06-lesson-agent-rule-catalog-design.md` (wersja 2). Tło: audyt ścieżek odrzuceń z `file:line` w `C:\Users\looka\AppData\Local\Temp\claude\C--Users-looka-IdeaProjects-knowli--claude-worktrees-lesson-new-exercise-type-4e7d8f\072948fd-dbf4-49ca-8897-ff5ee18c371d\scratchpad\agent-rules-audit.md` (numery linii ze stanu `783f7220`, przybliżone).

## Global Constraints

- Gałąź `feature/lesson-agent-rule-catalog-237` (od `783f7220`, gałęzi PR 2). Nie wypychać, nie scalać, nie otwierać PR bez polecenia właściciela.
- Nigdy `npm install`; `node_modules` już jest. Bez nowych zależności, bez migracji bazy.
- Żadnych płatnych wywołań modeli: nie uruchamiać `pnpm probe:*` (sondy wczytują `.env` z kluczem). Płatny przebieg jest poza planem, po osobnej zgodzie.
- Kod, identyfikatory, id reguł, opisy reguł i `found`: po angielsku. Komentarze w kodzie i komunikaty `pl`: po polsku, w stylu otoczenia. Dokumentacja po polsku.
- Komunikaty `pl` istniejących sprawdzeń zostają znak w znak (panel rodzica i testy z nich korzystają).
- Id reguły: literał `obszar.nazwa`, tylko `[a-z0-9_.]`, bez składania dynamicznego.
- Liczby w opisach reguł wyłącznie ze stałych, którymi posługuje się sprawdzenie (kontrakt albo walidator), nigdy literałem w tekście.
- `found` wycina teksty z ćwiczenia do 120 znaków z `…` i zamienia znaki nowej linii na spacje (pomocnik `clip` z Task 1).
- Prywatność: logi `console.*` i dziennik `[lesson-agent]` dostają tylko kody, id reguł, typy ćwiczeń i liczniki. Nigdy `found`, `pl`, treści ćwiczeń ani materiału. Bez danych dziecka gdziekolwiek.
- Granice: `domain/` bez importów `modules/`, `providers/`, Drizzle i env. Silnik (`domain/lessons/rules`, `agent/`, `pool-validation.ts`) nie zna id przedmiotów (`domain/lessons/architecture.test.ts`). Po zmianie w `modules/` uruchom `module-boundaries.architecture.test.ts`.
- Weryfikacja zadania: `pnpm typecheck` i testy jednostkowe dotkniętych katalogów, np. `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons`. Testy integracyjne tylko tam, gdzie zadanie je wskazuje. Pełne bramki w Task 12.
- Commity po polsku, z `(#237)` w tytule i stopką `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nigdy gołe `git stash`.

## Review Focus

1. Rekord agenta z `null` albo obcym typem w zagnieżdżonych polach (`requiredElements: null`, `sourceRefs: [null]`, `pairs: [["a","b"]]`, `calculation: "x"`) → zgłoszenie `shape.*` z polem, bez wyjątku (Task 8, test „malformed nested values”).
2. Materiał z `\r\n`, twardymi spacjami i cytatem przez koniec wiersza → dopasowanie po normalizacji i zapisany fragment materiału z dokładnymi granicami (Task 5, test „snaps across line breaks”).
3. Paczka, w której pytanie otwarte odpada, a jego słowa kluczowe idą w tym samym wywołaniu → reguła `school.keywords_family_rejected`, a nie ogólny brak rodziny (Task 5 i Task 7, test „keywords cascade”).
4. `found` z długim tekstem, nową linią albo cudzysłowem w środku → jedna linia, ≤ 120 znaków treści, bez rozbicia formatu powodu (Task 1, test `clip`; Task 7, test formatu).
5. Szkic zapisany przed zmianą z kodami `hint_reveals_answer` i `variant_rejected` w `rejectedReasons` → panel dalej pokazuje ich polskie etykiety (Task 7, test etykiet).

---

### Task 1: Fundament katalogu reguł i pole `SubjectModule.rules`

**Files:**
- Create: `packages/server/src/domain/lessons/rules/catalog.ts`, `packages/server/src/domain/lessons/rules/catalog.test.ts`, `packages/server/src/domain/lessons/rules/rule-cases.ts`, `packages/server/src/domain/lessons/rules/rule-cases.test.ts`, `packages/server/src/domain/lessons/rules/core-rules.ts` (pusty katalog), `packages/server/src/domain/lessons/rules/lesson-rules.ts` (pusty katalog), `packages/server/src/domain/lessons/subjects/{school,english-grammar,english-chapter}/rules.ts` (puste katalogi)
- Modify: `packages/server/src/domain/lessons/types.ts` (`SubjectModule.rules`), `packages/server/src/domain/lessons/catalog-validation.ts` (`validateSubject`), moduły przedmiotów `subjects/*/module.ts`, `packages/server/src/domain/lessons/testing/agent-test-subject.ts`, `testing/history-like-subject.ts` i pozostałe fikstury z ręcznie budowanym `SubjectModule` (znajdź: `git grep -nE "agentPolicy:" -- packages/server/src tests`)
- Modify: `packages/contracts/src/lessons.ts`: eksport stałych zamiast literałów w `LessonExerciseInputSchema`: `MAX_REQUIRED_ELEMENTS = 6`, `MIN_REQUIRED_ELEMENTS = 1`, `MAX_SUPPLEMENTARY_ELEMENTS = 4`, `MAX_COMMON_ERRORS = 4`, `MAX_FAMILY_ID_LENGTH = 64`, `MAX_SOURCE_REFS = 3`, `MIN_SOURCE_REFS = 1`, `MAX_ELEMENT_ID_LENGTH = 40`, `MAX_GROUP_ID_LENGTH = 40`; schemat bez zmian zachowania

**Interfaces:**
- Produces (w `rules/catalog.ts`):
  - `type RuleKind = "reject" | "sanitize" | "internal"`
  - `interface RuleTextContext { readonly answerMaxLength: number; readonly groundingRequired: boolean; readonly flags: ReadonlySet<string> }`
  - `interface LessonRule { readonly field: string; readonly kind: RuleKind; readonly types?: readonly LessonExerciseType[]; readonly when?: (ctx: RuleBookContext) => boolean; readonly description: string | ((ctx: RuleTextContext) => string); readonly internalReason?: string }`
  - `type RuleCatalog = Readonly<Record<string, LessonRule>>`
  - `type RuleId = string & { readonly __lessonRule: unique symbol }`
  - `interface LessonRuleIssue { readonly rule: RuleId; readonly field: string; readonly pl: string; readonly found?: string }`
  - `function defineRules<const C extends RuleCatalog>(catalog: C): C` — sprawdza wzorzec id `^[a-z0-9_]+(\.[a-z0-9_]+)+$` i rzuca przy złym
  - `function issueFrom<C extends RuleCatalog>(catalog: C): (id: keyof C & string, details: { field?: string; pl: string; found?: string }) => LessonRuleIssue` — domyślne `field` z wpisu
  - `function clip(text: string, max = 120): string` — nowe linie i tabulatory na spację, zwinięte spacje, przycięcie z `…`, w cudzysłowie `"…"`
  - `function messagesOf(issues: readonly LessonRuleIssue[]): string[]` (zwraca `pl`)
  - `function ruleOf(subject: Pick<SubjectModule, "rules">, id: RuleId): (LessonRule & { readonly id: RuleId }) | undefined` (rdzeń ∪ lekcja ∪ przedmiot)
  - `function describeRule(rule: LessonRule, ctx: RuleTextContext, note?: string): string`
  - `const ALL_ENGINE_CATALOGS: readonly RuleCatalog[]` (rdzeń, lekcja)
  - `RuleBookContext` (tylko typ, wypełniany w Task 9): `{ readonly exerciseTypes: readonly LessonExerciseType[]; readonly text: RuleTextContext; readonly policy: SubjectAgentPolicy; readonly listenChoice: boolean; readonly voiceTones: boolean; readonly exerciseExplanations: boolean }`
- Produces (w `rules/rule-cases.ts`): `interface RuleCase { readonly rule: string; readonly violation: () => readonly LessonRuleIssue[]; readonly boundary?: () => readonly LessonRuleIssue[] }` oraz `const RULE_CASES: RuleCase[]` (rejestr, do którego kolejne zadania dopisują przypadki przez osobne pliki `*.rule-cases.ts` importowane w `rule-cases.ts`)
- Produces: `SubjectModule.rules: RuleCatalog` (wymagane)

- [ ] **Step 1: Testy fundamentu (`catalog.test.ts`).**
  - `defineRules` rzuca dla `"Bad-Id"`, `"single"` i `"a..b"`;
  - `issueFrom(cat)("x.y", { pl: "p" })` daje `field` z wpisu;
  - `clip("a\nb", 120) === '"a b"'`;
  - `clip("x".repeat(200)).length === 123` (cudzysłowy + 120 + `…`);
  - `messagesOf` zwraca `pl`;
  - `ruleOf` znajduje id z katalogu przedmiotu i zwraca `undefined` dla nieznanego;
  - `describeRule` z funkcją opisu używa `ctx.answerMaxLength`, a z `note` dokleja ją po spacji.
- [ ] **Step 2: Test rejestru (`registry.test.ts` / `catalog-validation.test.ts`).** Moduł bez `rules` jest odrzucony z komunikatem zawierającym `rules`. Moduł, którego id reguły koliduje z rdzeniem albo z innym przedmiotem rejestru, też jest odrzucony.
- [ ] **Step 3: Test kompletności (`rule-cases.test.ts`).** Pada, gdy reguła `reject`/`sanitize` dowolnego katalogu (`ALL_ENGINE_CATALOGS` i `rules` przedmiotów z rejestru) nie ma przypadku w `RULE_CASES`. Dla każdego przypadku `violation()` zawiera zgłoszenie z `rule === id`, a `boundary()` (gdy jest) nie zawiera zgłoszenia tej reguły. Pada też, gdy reguła `internal` nie ma `internalReason`. Na pustych katalogach test przechodzi.
- [ ] **Step 4: Uruchom testy.** Oczekiwany wynik: FAIL (brak modułów).
- [ ] **Step 5: Implementacja.** Dodaj pliki, pole `rules` i kontrolę w `validateSubject` (obecność i kolizje id). Daj puste katalogi przedmiotom i fiksturom. Wyeksportuj stałe kontraktu i użyj ich w schemacie.
- [ ] **Step 6: Uruchom.** `pnpm typecheck` oraz `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons packages/contracts`. Oczekiwany wynik: PASS.
- [ ] **Step 7: Commit** „Katalog reguł lekcji: typy, fabryka zgłoszeń i pole rules przedmiotu (#237)”.

### Task 2: Rdzeń — kontrakt, pola wspólne i typy tekstowe w `pool-validation.ts`

**Files:**
- Modify: `packages/server/src/domain/lessons/rules/core-rules.ts`, `packages/server/src/domain/lessons/pool-validation.ts` (`validateLessonExercise` i pomocnicze do `validateGap`/`validateErrorFix`/`validateTransform`/`validateAcceptedAnswers`/`validateOptions`/`validateOrder`/`validateFocus`/`validateVisualSubject`/`validateTextFieldLengths`/`validateNoTextAnswers`, `explanationTextErrors` w `exercise-explanation.ts`)
- Create: `packages/server/src/domain/lessons/rules/core.rule-cases.ts`, `packages/server/src/domain/lessons/pool-validation.issues.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `validateLessonExerciseIssues(ex, subject, topic): LessonRuleIssue[]`;
  - `validateLessonExercise` = `messagesOf(validateLessonExerciseIssues(...))`, sygnatura i napisy bez zmian;
  - reguły rdzenia (minimum): `field.empty`, `field.max_length`, `field.count`, `field.invalid`, `exercise.card_not_allowed`, `exercise.unknown_objective`, `exercise.type_unsupported`, `exercise.type_not_allowed`, `exercise.v3_field_not_allowed`, `answer.max_length`, `voice_tone.not_allowed`, `explanation.*` (`kind: "sanitize"`), `fields.type_specific` (pola innego typu), `listen.*`, `focus.empty`, `focus.not_contiguous`, `choice.stem_required`, `short_answer.prompt_required`, `open.prompt_required`, `options.count`, `options.duplicate`, `options.correct_unknown`, `order.items_count`, `order.items_join`, `gap.marker_count`, `gap.answer_tokens`, `gap.focus`, `error_fix.statement_required`, `error_fix.same_as_answer`, `transform.statement_required`, `transform.unknown`, `variants.count`, `variants.empty`, `variants.duplicate`, `notice.*`, `visual.*`, `computed.no_variants` (`internal`).

  Implementator może podzielić grupy na więcej id, ale musi zachować prefiksy.

- [ ] **Step 1: Testy (`pool-validation.issues.test.ts`).**
  - **Tabela Zod (spec §4.2) na prawdziwym `safeParse`:**
    - `hint: ""` → `field.empty`, `field: "hint"`, `found` zawiera `empty`;
    - `prompt` 134 znaków → `field.max_length`, `found` zawiera `134` i `120`;
    - `commonErrors` z 6 elementami → `field.count`, `found` zawiera `6` i `4`;
    - `questionType: "explanation"` → `field.invalid`, `found` zawiera `"explanation"`;
    - obcy klucz → `field.invalid`.
  - **Analiza po zdjęciu pustych napisów:** szkic z `hint: ""` i błędnym `focus` daje oba zgłoszenia. Szkic z `prompt` za długim i błędnym `focus` daje tylko zgłoszenie kontraktu.
  - **Pole źródłowe zamiast `answer`:** `lesson_match` z `pairs: []` daje zgłoszenie na `pairs`, bez zgłoszenia ścieżki `answer`. Typ liczony bez zgłoszenia pola źródłowego dostaje ścieżkę pola źródłowego.
  - **Wartości w `found`:**
    - `focus.not_contiguous`: tokeny odpowiedzi;
    - `order.items_join`: złożony tekst i odpowiedź;
    - `options.correct_unknown`: dozwolone id;
    - `gap.answer_tokens`: liczba słów i limit.
  - **Bez zmian:** istniejące `pool-validation.test.ts` przechodzą bez edycji (napisy `pl` bez zmian).
- [ ] **Step 2: Przypadki reguł** w `core.rule-cases.ts`: naruszenie każdej reguły tego zadania. Reguły liczbowe dostają przypadek graniczny, np. `options.count` z `MAX_OPTIONS` opcjami.
- [ ] **Step 3: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 4: Implementacja.**
  - Każde `errors.push("…")` zastąp zgłoszeniem z dzisiejszym tekstem jako `pl` i `found` z wartościami.
  - Opisy reguł po angielsku buduj ze stałych kontraktu i walidatora.
  - Mapowanie Zod: `issue.origin` (`string`/`array`), wartość odczytaj ze szkicu pod `issue.path`. Polskie `pl` kontraktu bez zmian (dzisiejsze trzy warianty).
  - Analizę po zdjęciu pustych napisów zrób na kopii bez opcjonalnych pól tekstowych z samym `field.empty` (`instructionPl`, `stem`, `statement`, `prompt`, `hint`, `transformId`, `correctOption`, `familyId`, `explanationPl`).
- [ ] **Step 5: Uruchom.** `pnpm typecheck` oraz testy `packages/server/src/domain/lessons`. Oczekiwany wynik: PASS.
- [ ] **Step 6: Commit** „Reguły rdzenia lekcji: kontrakt, pola wspólne i typy tekstowe ze zgłoszeniami (#237)”.

### Task 3: Rdzeń — pary, grupy, luki z bankiem, słowa kluczowe, rachunki i reguły puli

**Files:**
- Modify: `pool-validation.ts` (`validateMatch`, `validateGroup`, `validateCloze`, `validateKeywords`, `validateListenChoice`, `validatePool`, `findDuplicateAnswers`), `packages/server/src/domain/lessons/calculation.ts`, `rules/core-rules.ts`, `rules/lesson-rules.ts`
- Create: `rules/lesson.rule-cases.ts`, dopisy do `core.rule-cases.ts`, testy w `pool-validation.issues.test.ts` i `calculation.test.ts`

**Interfaces:**
- Consumes: Task 1–2.
- Produces:
  - `validatePoolIssues(drafts, subject, topic, opts): { valid; rejected: { exercise; issues: LessonRuleIssue[] }[] }` (kształt zwrotu jak `validatePool`, z `issues` zamiast `errors`), a `validatePool` jako opakowanie z `errors = messagesOf(issues)`;
  - `calculationIssues(spec: unknown): LessonRuleIssue[]` (czysta; Zod `CalculationSpecSchema` → `calculation.*`, tolerancja: `calculation.tolerance` z `found` „tolerance 0.5 is more than 1% of the result 5 (max 0.05)”);
  - `computeCalculationAnswer` bez zmian (dalej rzuca);
  - reguły: `match.*`, `group.*`, `cloze.*`, `keywords.*`, `calculation.*` (m.in. `calculation.tolerance`, `calculation.family_slug`, `calculation.params`, `calculation.unknown_key`), `lesson.duplicate_stimulus`, `lesson.duplicate_answer` (`lesson-rules.ts`).
- [ ] **Step 1: Testy.**
  - `groupItems[3].groupId "g4"` → `found` zawiera `g1, g2`;
  - `clozeText` z pojedynczym `_` poza luką → `cloze.underscore_outside_gap`;
  - `calculationIssues` dla tolerancji 1% wyniku przechodzi, a dla 1% + ε daje `calculation.tolerance`;
  - `templateFamilyId: "scale_distance-1"` → `calculation.family_slug`;
  - `tolerance: null` → `field.invalid` albo `calculation.tolerance` z „null”;
  - powtórzony bodziec w puli → `lesson.duplicate_stimulus`, `found` z id/fragmentem drugiego ćwiczenia;
  - istniejące testy `validatePool` i `calculation.test.ts` przechodzą bez zmian.
- [ ] **Step 2: Przypadki reguł.**
- [ ] **Step 3: FAIL → implementacja → PASS** (`pnpm typecheck` i testy `domain/lessons`).
- [ ] **Step 4: Commit** „Reguły rdzenia: pary, grupy, luki, słowa kluczowe, rachunki i reguły puli (#237)”.

### Task 4: Haki przedmiotów zwracają zgłoszenia (trzy przedmioty naraz)

**Files:**
- Modify: `domain/lessons/types.ts`:
  - `validateExercise` → `LessonRuleIssue[]`;
  - `validatePoolExtra` → `ReadonlyMap<number, readonly LessonRuleIssue[]>`;
  - `refineGeneratedPool.rejected[].issues` zamiast `reason`;
  - `AgentGateFinding` → `{ readonly code: string; readonly issue: LessonRuleIssue }`.
- Modify: walidatory, moduły i polityki trzech przedmiotów (`subjects/*/validators.ts`, `module.ts`, `agent-policy.ts`), ich `rules.ts`.
- Modify (wołający): `pool-validation.ts`, `modules/materials/lessons/lesson-drafts.ts` (`splitByPoolExtra` → `pl`), `lesson-api.ts`, `domain/lessons/agent/admission.ts` i `status.ts` (na razie mapują na `pl`, Task 7 zmienia na format agenta), fikstury `testing/*`.
- Modify (testy): `subjects/*/validators.test.ts`, `module.test.ts`, `agent-policy.test.ts`, `tests/integration/lesson-shape.test.ts`, `tests/probes/agent-generation.probe.test.ts` — przez `messagesOf`, z oczekiwanymi tekstami bez zmian.
- Create: `subjects/{school,english-grammar,english-chapter}/<przedmiot>.rule-cases.ts`

**Interfaces:**
- Consumes: Task 1–3.
- Produces: katalogi przedmiotów z regułami ich dzisiejszych sprawdzeń. Szkoła: `school.*`, m.in. `school.quote_required`, `school.quote_too_short`, `school.quote_in_material`, `school.open_required_fields`, `school.family_prompt_repeated`, `school.family_answer_differs`, `school.family_elements_differ`, `school.keywords_family_missing`, `school.keyword_not_in_answer`, `school.calculation_family_mismatch`, `school.v3_field_type`. Gramatyka: `grammar.*`. Rozdział: `chapter.*`, w tym `chapter.card_word_missing`, `chapter.frame_missing`, `chapter.word_outside_material`, `chapter.function_words_only`.

  Każde dzisiejsze sprawdzenie zostaje bez zmiany zachowania (poluzowania są w Task 5–6).

- [ ] **Step 1: Testy.**
  - Istniejące testy przedmiotów po przejściu na `messagesOf` przechodzą z niezmienionymi napisami (diff testów: tylko owinięcie wyniku).
  - Nowe testy `found`:
    - rodzina: osobne reguły dla odpowiedzi i elementów, obie wartości;
    - cytat spoza materiału: indeks i tekst.
  - Ustalenia bramek rozdziału mają `code` jak dziś (`card_word_missing`, `frame_missing`).
- [ ] **Step 2: Przypadki reguł** wszystkich reguł przedmiotów.
- [ ] **Step 3: FAIL → implementacja → PASS.** Komendy: `pnpm typecheck`, testy `packages/server/src/domain/lessons` i `packages/server/src/modules/materials`, oraz `pnpm test:integration tests/integration/lesson-shape.test.ts`.
- [ ] **Step 4: Commit** „Haki przedmiotów lekcji zwracają zgłoszenia reguł (#237)”.

### Task 5: Szkoła — poluzowania podpowiedzi i cytatów, komunikaty rodzin i kaskada słów kluczowych

**Files:**
- Modify:
  - `subjects/school/hint-gate.ts`, `hint-gate.test.ts`;
  - `subjects/school/agent-policy.ts`, `agent-policy.test.ts`, `rules.ts`, `validators.ts`;
  - `domain/lessons/types.ts`: `SubjectAgentPolicy.sanitize(draft, ctx: { material: string }) → { draft; removed: readonly string[]; notes?: readonly LessonRuleIssue[] }`.
- Create: `subjects/school/quote-normalize.ts`, `quote-normalize.test.ts`, domenowy pomocnik `familyBase` w `domain/lessons/keyword-families.ts` (albo nowym pliku obok).
- Modify: `modules/materials/lessons/lesson-drafts.ts` (sufiks rodziny przez wspólny format `familyBase`), `domain/lessons/agent/admission.ts` (`sanitizeCandidate` przekazuje `{ material: ctx.material }` do `sanitize` i przenosi `notes` do wyniku; pełne użycie not w Task 7), `domain/lessons/types.ts` (`validatePoolExtra` ctx: `{ material: string; rejectedFamilies?: ReadonlySet<string> }`).

**Interfaces:**
- Consumes: Task 4.
- Produces:
  - `hintRevealing(hint: string, draft: LessonExerciseDraft, normalizer: AnswerNormalizer): { target: "answer" | "acceptedAnswer" | "requiredElement"; text: string; words: string[] } | null` — algorytm ze spec §5.1, z listą słów pomocniczych `HINT_STOP_WORDS` (dokładnie lista ze spec §5.1 pkt 2);
  - `hintRevealsAnswer` usunięte albo jako opakowanie `!== null`;
  - `normalizeQuote(text: string): { text: string; map: number[] }` (`map[i]` = pozycja w oryginale), według spec §5.2;
  - `snapQuote(quote: string, material: string): string | null` (dokładny fragment materiału albo `null`);
  - `familyBase(slug: string, scope: string | null): string` (zdejmuje sufiks runu `-r<6 hex>`, tylko gdy scope jest znany);
  - reguły `hint.reveals_words` (`sanitize`), `school.keywords_family_rejected` (`reject`).
- [ ] **Step 1: Testy bramki** (spec §6, podpowiedź). Słowo elementu spoza pytania → dopasowanie z `words`. Bez dopasowania:
  - słowo wspólne z pytaniem;
  - same słowa pomocnicze;
  - element złożony wyłącznie ze słów pytania.

  Liczby: „1410” w pytaniu i odpowiedzi → bez zdrady; „1410” tylko w odpowiedzi i w podpowiedzi → zdrada. Trzy przykłady z audytu (`agent-rules-audit.md` §2.1, wiersz `hint_reveals_answer`) z oczekiwanym wynikiem po zmianie. Każde słowo `HINT_STOP_WORDS` ma ≥ 4 litery albo test uzasadnia jego obecność.
- [ ] **Step 2: Testy sanityzacji szkoły.**
  - Pytanie otwarte z podpowiedzią zdradzającą: brak `hint`, `removed` zawiera `hint`, a `notes` ma zgłoszenie `hint.reveals_words` z `found` z dopasowanymi słowami i celem.
  - Typ inny niż pytanie otwarte: dzisiejsze usunięcie bez noty.
  - `exerciseGate` szkoły nie zwraca już ustaleń.
  - `validateLessonExercise` (edytor rodzica) przyjmuje taką podpowiedź.
- [ ] **Step 3: Testy cytatów.** Przechodzą i `snapQuote` zwraca tekst materiału:
  - wielkość liter, „ ” zamiast `"`, – zamiast `-`, `…`;
  - U+00AD i U+200B;
  - wiodący znacznik listy;
  - cytat przez `\r\n` i podwójną spację.

  Odpadają: inne słowo, brakujące słowo, inna liczba, dwa fragmenty zszyte `...`. Granica długości minimalnej na cytacie po normalizacji. `found` reguły `school.quote_in_material` zawiera najdłuższy pasujący początek. Porównanie treści pytań rodziny bez zmian (istniejący test).
- [ ] **Step 4: Test kaskady.** `validatePoolExtra` z pytaniem otwartym rodziny `f` odrzuconym w tej samej paczce zgłasza dla słów kluczowych `school.keywords_family_rejected`. Słowa kluczowe bez żadnego pytania z `familyId` zgłaszają `school.keywords_family_missing`.

  Rozróżnienie robi `admission` (Task 7), który wie o odrzuceniu w paczce. Tu walidator dostaje w `ctx` opcjonalne `rejectedFamilies: ReadonlySet<string>`.
- [ ] **Step 5: Zapis cytatu.** Sanityzacja polityki szkoły (`sanitize` z `ctx.material`) zastępuje `quote` cytatów bez `parentAdded` wynikiem `snapQuote`, gdy różni się od oryginału. Bez noty.
- [ ] **Step 6: Przypadki reguł** nowych reguł.
- [ ] **Step 7: FAIL → implementacja → PASS** (`pnpm typecheck`, testy `domain/lessons`).
- [ ] **Step 8: Commit** „Szkoła: podpowiedź usuwana z notą, cytaty po normalizacji, jasne komunikaty rodzin (#237)”.

### Task 6: `ruleNotes` zamiast `rejectionTexts` i reguły kontroli modelami

**Files:**
- Modify: `domain/lessons/types.ts` (`SubjectAgentPolicy.ruleNotes?: Partial<Record<string, string>>`, usuń `rejectionTexts`; `promptNotes` zostaje do Task 9, który przenosi jego treść do opisów reguł i usuwa pole), trzy `agent-policy.ts`, `rules/lesson-rules.ts`, `domain/lessons/agent/admission.ts` (szablony ujawnień, sędziego i oceny otwartej z opisów reguł)

**Interfaces:**
- Consumes: Task 1, 4, 5.
- Produces reguły lekcji:
  - `lesson.leak` (ofiara) i `lesson.leak_source`, `lesson.limit_full`, `lesson.limit_listen`;
  - `check.blind_solve` (opis ze spec §3: co widzi rozwiązujący, jak działa porównanie);
  - `check.variants` (`sanitize`);
  - `check.hint_judge` (opis odróżniony od `hint.reveals_words`);
  - `check.open_answer` (zawiera dzisiejszą treść `openMissing`/`openWrong`, w tym zasadę „any two”).

  Dopiski przedmiotów w `ruleNotes`:
  - dzisiejsze `leakVictim`/`leakSource` rozdziału i gramatyki;
  - dopisek `check.blind_solve` rozdziału i gramatyki o polskim zdaniu źródłowym i szykach;
  - szkolne teksty sędziego i oceny.
- [ ] **Step 1: Testy.**
  - `describeRule(lesson.leak, ctx, schoolPolicy.ruleNotes["lesson.leak"])` zawiera dzisiejszy tekst `leakVictim` szkoły.
  - Test architektury przedmiotów potwierdza brak `rejectionTexts`.
  - Rejestr odrzuca politykę z kluczem `ruleNotes` spoza id rdzenia i lekcji.
- [ ] **Step 2: Przypadki reguł** (reguły kontroli modelami mają przypadki na `checkerSteps` z fikcyjnymi wynikami `CandidateChecks`).
- [ ] **Step 3: FAIL → implementacja → PASS.** Istniejące testy przyjmowania mogą zmienić oczekiwany tekst wyłącznie tam, gdzie dziś cytują `rejectionTexts`. Tekst merytoryczny się nie zmienia.
- [ ] **Step 4: Commit** „Polityki agenta: dopiski reguł zamiast szablonów odrzuceń (#237)”.

### Task 7: Przyjmowanie agenta — format powodów, zbieranie błędów, warianty

**Files:**
- Modify:
  - `domain/lessons/agent/admission.ts` (`Rejection`, `PrecheckEntry`, `AdmitEntry`, `deterministicSteps`, `checkerSteps`, `admitBatch`, `sanitizeCandidate`);
  - `domain/lessons/agent/solver.ts` (`blindMatches` bez zmian, użycie na oczyszczonym szkicu; komunikat z kluczem i różnicą pozycji);
  - testy `admission*.test.ts`, `status.ts`.
- Create: `domain/lessons/rules/rule-reason.ts`, `rule-reason.test.ts`.
- Modify: `packages/contracts/src/messages.ts` tylko jeśli brak etykiet (`hint_reveals_answer`, `variant_rejected` zostają).

**Interfaces:**
- Consumes: Task 1–6.
- Produces:
  - `type RuleReason = string & { readonly __ruleReason: unique symbol }`;
  - `formatRuleReason(issue: LessonRuleIssue): RuleReason` → `[<rule>] <field>: <found>` albo `[<rule>] <field>`;
  - `Rejection = { kind; code; reasons: readonly RuleReason[]; issues: readonly LessonRuleIssue[]; ruleIds: readonly RuleId[] }`;
  - `AdmitEntry` (przyjęte) dostaje `notes: readonly LessonRuleIssue[]` (sanityzacja, usunięte warianty) i `removedVariants: readonly string[]`;
  - `PrecheckEntry` (`pass`) dostaje `notes`.
- [ ] **Step 1: Testy.**
  - **Format powodu i kod:**
    - `formatRuleReason` z `found` zawierającym nową linię daje jedną linię;
    - ćwiczenie z błędem reguły i ustaleniem bramki → jedno odrzucenie z powodami obu, kod bramki;
    - tylko reguły → `rule_exercise`;
    - błąd kontraktu → tylko zgłoszenia kontraktu;
    - kolejność powodów deterministyczna;
    - powody ofiar (`lesson_pool`, `lesson_extra`) w formacie `[id]` z prefiksem „adding this exercise would make the lesson reject …”.
  - **Kaskada słów kluczowych** (Review Focus 3): paczka z odrzuconym pytaniem otwartym rodziny `f` i jego słowami kluczowymi → słowa kluczowe dostają `school.keywords_family_rejected` (przez `rejectedFamilies` z Task 5).
  - **Warianty** (spec §5.3, wszystkie przypadki ze spec §6):
    - stan po przyjęciu bez wariantu;
    - usunięta część wariantów i wszystkie warianty;
    - rozwiązujący odpowiedział usuniętym wariantem → `blind_mismatch` z powodem o usuniętym wariancie;
    - odrzucenie podpowiedzi albo oceny wygrywa, stan bez zmian;
    - usunięty wariant znosi ujawnienie;
    - nota `check.variants`.
  - **Pilnowanie list przedmiotów:** test sprawdza, że żaden przedmiot nie ma typu jednocześnie w `variantCheckTypes` i `openAnswerCheckTypes`.
  - **Ślepe rozwiązanie:** komunikat zawiera klucz. Przy parach i grupach różnice pozycji, przy innej liczbie odpowiedzi obie liczby.
  - **Przepisane testy** (`admission*.test.ts`): `toEqual` na `Rejection` uzupełnione o `issues` i `ruleIds`.
- [ ] **Step 2: FAIL → implementacja → PASS** (`pnpm typecheck`, testy `domain/lessons`).
- [ ] **Step 3: Commit** „Przyjmowanie agenta: powody z id reguł, wszystkie błędy naraz, usuwanie wariantów (#237)”.

### Task 8: Narzędzia agenta — kształt rekordu, materializacja, wynik dla modelu

**Files:**
- Modify:
  - `modules/materials/lessons/lesson-pool-agent-tools.ts` (`parseRecord`, `admittedResult`, `logRejection`, `ObjectiveToolsStats`, `submit`);
  - `lesson-drafts.ts` (`rawExerciseShapeSchema` ze zgłoszeniami dla każdego pola listowego filtrowanego dziś przez `v3FieldsOf`; `isWellShapedRawExercise` jako opakowanie logiczne; `toExerciseDraft` bez zmian);
  - `ports/ai.ts` (`LessonAgentToolOutcome`);
  - `providers/openai/lesson-pool-agent.ts` (adapter przestaje materializować; `materializeRawExercises` usunięte albo przeniesione);
  - `providers/lesson-calculations.ts`, `lesson-keywords.ts`, `lesson-assignments.ts` (cienkie opakowania nad nową materializacją dla fake'a i testu integracyjnego);
  - `modules/materials/lessons/lesson-pool-agent.ts` (logi: `code`, `ruleIds`, `exerciseType`; liczniki).
- Create: `modules/materials/lessons/lesson-raw-materialize.ts` (+ test).
- Modify (testy): `lesson-pool-agent-tools.test.ts` (dziś `detail: errors.join("; ")`, `variant_rejected`), `lesson-agent-outcome.test.ts:614-636` (skan kodów: usuń `variant_rejected` i `hint_reveals_answer` z `known`, test etykiet zapisanych kodów — Review Focus 5), `tests/integration/lesson-agent-generation.test.ts` i `lesson-generation.test.ts` (kod `shape_malformed` zostaje, zmienia się tekst).

**Interfaces:**
- Consumes: Task 1–7.
- Produces:
  - `materializeRawExercise(raw: unknown): { ok: true; record: unknown } | { ok: false; exerciseType: string; issues: LessonRuleIssue[] }` (idempotentna: rekord już zmaterializowany przechodzi bez zmian);
  - `LessonAgentToolOutcome.results[]` dostaje `exerciseType: string | null` i `stimulus: string` (≤ 40 znaków przez `clip`), a odrzucenie `errors: RuleReason[]` (najwyżej 6, dalej `+N more`);
  - nowe pole wyniku `rules: Readonly<Record<string, string>>` (opis z dopiskiem przedmiotu, raz na id użyte w wyniku, także w notach);
  - nota przyjęcia jako lista `notes: string[]` w formacie `formatRuleReason` (plus `"unchecked"`);
  - `ObjectiveToolsStats` dostaje `hintsRemoved` i `variantsRemoved`;
  - `RejectionLogEntry` dostaje `ruleIds`.
- [ ] **Step 1: Testy.**
  - **Kształt rekordu** (Review Focus 1):
    - `requiredElements: null` → zgłoszenie `field.*` albo `shape.*` z polem, bez wyjątku;
    - `sourceRefs: [null]` i `sourceRefs: ["quote"]` → `shape.source_refs` z „got a string”;
    - `pairs: [["a","b"]]`;
    - `calculation: "x"`;
    - `options: ["Warszawa"]` → `options[0]: expected {id, text}, got a string`.
  - **Materializacja:** `tolerance` ponad 1% → `calculation.tolerance` z liczbami. Materializacja idempotentna: fake pula i rekordy z testu integracyjnego przechodzą dwa razy bez zmian.
  - **Wynik narzędzia:**
    - `exerciseType` i `stimulus`;
    - mapa `rules` z opisem każdej użytej reguły dokładnie raz;
    - siódmy powód zastąpiony `+N more`;
    - nota `hint.reveals_words` przy przyjęciu.
  - **Liczniki:** `hintsRemoved` i `variantsRemoved`.
  - **Prywatność** (spy na `console.*`): odrzucenie z cytatem nie wypisuje `found`, `pl` ani treści, tylko `code`, `ruleIds` i `exerciseType`.
  - **Przepisane testy** z listy wyżej.
- [ ] **Step 2: FAIL → implementacja → PASS.** Komendy: `pnpm typecheck`, testy `packages/server/src/modules/materials` i `providers`, `module-boundaries.architecture.test.ts`, oraz `pnpm test:integration tests/integration/lesson-agent-generation.test.ts tests/integration/lesson-generation.test.ts`.
- [ ] **Step 3: Commit** „Narzędzia agenta: konkretne błędy kształtu, materializacja w narzędziach, wynik z opisami reguł (#237)”.

### Task 9: Prompt z katalogu — karty typów, księga reguł, schemat narzędzia

**Files:**
- Create:
  - `domain/lessons/rules/type-cards.ts` (+ `type-cards.test.ts`);
  - `domain/lessons/rules/rule-book.ts` (+ test);
  - `providers/openai/__snapshots__/` (migawki promptu);
  - tabela migracji `docs/superpowers/plans/2026-11-06-lesson-agent-rule-catalog-prompt-map.md`.
- Modify:
  - `modules/materials/lessons/lesson-pool-agent-input.ts` (`ruleBook` w `LessonPoolInput`);
  - `ports/ai.ts`;
  - `providers/openai/llm.ts` (`lessonSystemPrompt`);
  - `providers/openai/lesson-pool-agent.ts` (`objectiveInstructions`);
  - `providers/openai/lesson-pool-schema.ts` (limity ze stałych, `tolerance` niewymagana);
  - `subjects/*/prompts.ts` (`fieldRules`/`typeRules` bez reguł egzekwowanych);
  - testy `llm.test.ts`, `lesson-pool-agent.test.ts`, `subjects/*/module.test.ts`;
  - `SubjectAgentPolicy.promptNotes` usunięte (treść w opisach reguł), razem z `LessonObjectiveAgentInput.promptNotes` w `ports/ai.ts` i jego składaniem w `lesson-pool-agent-input.ts`.

**Interfaces:**
- Consumes: Task 1–8.
- Produces:
  - `TYPE_CARDS: Readonly<Record<LessonExerciseType, { summary: string; example?: (subjectId: string) => Record<string, unknown> | undefined }>>`. `example` daje rekord dla przedmiotu albo `undefined`, gdy przedmiot nie ma typu. Wyjątek: przykład wybierany po cechach przedmiotu (`groundingRequired`, `answerLocale`), nie po id, żeby silnik nie znał id przedmiotów.
  - `lessonRuleBook(subject: SubjectModule, ctx: RuleBookContext): { general: RuleLine[]; types: { type: LessonExerciseType; summary: string; example?: string; subjectRule?: string; rules: RuleLine[] }[]; lesson: RuleLine[]; checks: RuleLine[] }`, gdzie `RuleLine = { id: string; text: string }`.
  - Renderer `renderRuleBook(book): string` w `llm.ts` w formacie spec §3.
- [ ] **Step 1: Zrzut promptu przed zmianą.** Test pomocniczy (niecommitowany) zapisuje złożony `objectiveInstructions` dla trzech przedmiotów na fiksturach testów do scratchpada sesji (ścieżka spoza repo podana przez kontroler).
- [ ] **Step 2: Tabela migracji.** Każde zdanie dzisiejszych fragmentów z spec §3 („Co zastępuje”, „Usuwane bez odpowiednika”) i każda asercja treści promptu w testach → id reguły, karta typu, wskazówka zostająca albo „usunięte: <powód>”. Plik `…-prompt-map.md`.
- [ ] **Step 3: Testy.**
  - Każdy przykład karty przechodzi materializację, kształt, kontrakt, rdzeń i przedmiot dla każdego przedmiotu, który ma typ.
  - Test promptu ze spec §2.4 pkt 5, z macierzą: trzy przedmioty × każdy typ przedmiotu, z przydziałem `lesson_listen_choice` i bez, z tonem i bez.
  - Renderer: kolejność sekcji, determinizm, brak pustych nagłówków.
  - Brak zdań potoku (spec §3).
  - Migawki `toMatchFileSnapshot` per przedmiot.
  - Budżet długości: prompt per przedmiot ≤ zmierzona długość po zmianie × 1,1 (wpisz liczby w teście z komentarzem o pomiarze i porównaniem ze stanem przed zmianą z kroku 1).
  - Schemat narzędzia: `minLength: 1` napisów, limity list równe stałym kontraktu, `tolerance` poza `required`.
- [ ] **Step 4: Przepisz asercje promptu według tabeli migracji** (asercje o regułach przechodzą na obecność opisu reguły w prompcie).
- [ ] **Step 5: FAIL → implementacja → PASS** (`pnpm typecheck`, testy `providers`, `domain/lessons`, `modules/materials`).
- [ ] **Step 6: Zrzut po zmianie** do scratchpada (kontroler porównuje z krokiem 1 w przeglądzie zadania).
- [ ] **Step 7: Commit** „Prompt agenta z katalogu reguł: karty typów, księga reguł i limity schematu (#237)”.

### Task 10: Gwarancje — test AST, opisy ze stałych, kompletność

**Files:**
- Create: `packages/server/src/domain/lessons/rules/rules.architecture.test.ts`.
- Modify: `rules/catalog.test.ts` (unikalność i niezawieranie się opisów, liczby ze stałych).

**Interfaces:** Consumes Task 1–9.

- [ ] **Step 1: Test AST** (`ts.createSourceFile` z pakietu `typescript` 5.9, jak w istniejących `*.architecture.test.ts`).
  - **Zakres:** funkcje walidatorów i przyjmowania z plików `pool-validation.ts`, `calculation.ts`, `subjects/*/{validators,agent-policy,hint-gate,quote-normalize}.ts`, `agent/admission.ts`, `rawExerciseShapeSchema` i jego pomocnicze w `lesson-drafts.ts`, `parseRecord` w `lesson-pool-agent-tools.ts`, `lesson-raw-materialize.ts`.
  - **Zakaz:** `push(`/`return [`/właściwość `reason:` z literałem napisu, szablonem albo spreadem wywołania spoza fabryki zgłoszeń.
  - **Wyjątki z uzasadnieniem w teście:** `submitExamples`, odmowy narzędzi (`REFUSAL_TEXT`, „exercises must be an array”, „there is no exercise”), `planGate`, `objectiveGaps`, `computeCalculationAnswer` (`throw`).
  - **Test czułości:** fikcyjne źródło z `errors.push("x")`, ``errors.push(`x`)``, `errors.push(...f())` jest wykrywane.
- [ ] **Step 2: Testy katalogu.**
  - Opisy różnych reguł nie są równe ani nie zawierają jeden drugiego.
  - Każda liczba w opisie (wyrażenie `\d+`) występuje wśród wartości stałych eksportowanych z `@learning/contracts` albo z jawnej listy stałych walidatorów.
  - Reguły `internal` mają wyłącznie id z listy w teście.
- [ ] **Step 3: Uruchom.** `pnpm typecheck` i testy `domain/lessons`. Oczekiwany wynik: PASS. Czułość potwierdzona tymczasowym wstawieniem `errors.push("x")` do `pool-validation.ts`: test pada. Wstawka nie trafia do commitu.
- [ ] **Step 4: Commit** „Testy gwarancji katalogu reguł: AST, opisy ze stałych (#237)”.

### Task 11: Sonda — miary przebiegu kontrolnego

**Files:**
- Modify: `tests/probes/chapter-generation.probe.test.ts`, `tests/probes/probe-submissions.ts` (+ test), `tests/probes/agent-generation.probe.test.ts` (typy).

**Interfaces:** Consumes Task 7–8 (`notes`, `rules`, `exerciseType`).

- [ ] **Step 1: Testy jednostkowe `probe-submissions.test.ts`.** Na fikcyjnych zgłoszeniach liczona jest funkcja `submissionMetrics(log)`:
  - `{ submitted, accepted, acceptedFirstCall, rejectedByRule: Record<string, number>, acceptedWithNotes: Record<string, number>, submitCalls, openAnswers, openAnswersWithHint }`.
  - `acceptedFirstCall` to przyjęte w wywołaniu `call === 1`.
  - `openAnswersWithHint` liczy przyjęte `lesson_open_answer` z niepustym `hint` po sanityzacji. Wymaga `accepted` z wersją ćwiczenia — rejestrator zapisuje treść przyjętą z wyniku puli, gdy jest dostępna; inaczej liczy tylko brak noty `hint.reveals_words`.
- [ ] **Step 2: Implementacja.** Wynik sondy zapisuje `submissionMetrics` w pliku wyników i jedną linię na konsoli wyłącznie z liczbami.
- [ ] **Step 3: Uruchom** testy jednostkowe `tests/probes` (bez `pnpm probe:*`). Oczekiwany wynik: PASS.
- [ ] **Step 4: Commit** „Sonda: miary odrzuceń per reguła, przyjęć z notami i podpowiedzi (#237)”.

### Task 12: Dokumentacja i pełne bramki

**Files:**
- Modify: `docs/architecture.md` §19.17 (katalog reguł, karty typów, format wyniku narzędzia, poluzowania; przebieg kontrolny jako „do wykonania”), `AGENTS.md` (punkt z spec §9 w „Reguły biznesowe i adaptery”).

- [ ] **Step 1: Dokumentacja** według spec §9.
- [ ] **Step 2: Pełne bramki.**
  - `pnpm check`;
  - `pnpm test:integration`;
  - `pnpm test:e2e:shards`.

  Oczekiwany wynik: wszystko zielone; nowe liczby testów wpisz do `AGENTS.md` tylko tam, gdzie AGENTS.md je podaje. `net::ERR_NO_BUFFER_SPACE` → powtórz spec osobno i odnotuj.
- [ ] **Step 3: Commit** „Dokumentacja katalogu reguł agenta lekcji (#237)”.
