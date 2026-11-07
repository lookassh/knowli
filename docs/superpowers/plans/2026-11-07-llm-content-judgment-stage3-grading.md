# Etap 3: ocena odpowiedzi dziecka w lekcjach — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dopasowanie, klucz cache i warianty bez rozwijania skrótów, prompt `grader-v2` z `usesTargetForm` i wynikiem „bez ćwiczonej formy”, rozsypanka przez model oceniający, jedna stała typów zależnych od gradera i jedna wartość limitu, generowanie tylko z graderem — z odbiorem na próbkach.

**Architecture:** czyste funkcje w `domain/lessons/evaluate.ts` (dopasowanie, walidacja i mapowanie werdyktu), powłoka w `modules/learning/lessons/lesson-attempts.ts` (fazy 1/2, cache, stan zadania, feedback), adapter gradera za portem `AnswerGraderProvider`. Granice transakcji bez zmian.

**Tech Stack:** TypeScript strict, Drizzle (ręczny SQL migracji), Zod, Vitest (unit, integration na PostgreSQL), Playwright (E2E bez zmian).

**Spec:** `docs/superpowers/specs/2026-11-07-llm-content-judgment-stage3-grading-design.md` (wersja 2) i spec zbiorczy `docs/superpowers/specs/2026-11-07-llm-content-judgment-design.md` (wersja 4). Czytaj oba przed zadaniem.

## Global Constraints

- Nie dodawaj kodu rozumiejącego język ani nowych kontroli; każda zmiana z tego planu albo usuwa rozwijanie skrótów z oceny, albo realizuje §5–§9 specu etapu.
- `englishNormalizer`, `contractions.ts`, `SubjectModule.normalizer` — bez zmian zachowania.
- Granice obszarów: `learning` → `materials` tylko przez barrel; domena bez importów infrastruktury (`module-boundaries.architecture.test.ts`).
- Prywatność: grader nigdy nie dostaje imienia, wieku ani identyfikatorów dziecka; Kid DTO, MCP, `learning-overview`, `SKILL.md` bez zmian.
- Wersje promptu: lekcje `grader-v2` (fake `fake-grader-v2`), szkoła `school-grader-v3` bez zmian.
- Domyślny limit wywołań gradera na sesję: `150`, w jednym miejscu (`config-defaults.ts`).
- Teksty UI po polsku w `packages/contracts/src/messages.ts`; kod i identyfikatory po angielsku.
- Instalacja zależności tylko gdy brak `node_modules`; nigdy `npm install`.
- `LessonVerdictDto` bez pola `usesTargetForm` (odstępstwo §6 specu etapu) — chyba że właściciel zdecyduje inaczej; wtedy jedno pole `usesTargetForm: boolean | null` w `packages/contracts/src/lessons.ts` i w dwóch mapowaniach w `lesson-supervision.ts`.

## Review Focus

- Ponowione `clientAttemptId` próby rozsypanki, która przeszła do modelu: idempotentna powtórka zwraca tę samą próbę (hash żądania z `itemIds`), bez drugiego wywołania.
- Próba rozsypanki w `processing` przeterminowana (leniwa finalizacja): kończy się `not_assessed`, zadanie zostaje `issued` jak dla tekstu.
- Kartkówka z rozsypanką w innej kolejności: zadanie `answered`, brak feedbacku w trakcie, raport liczy nieocenione albo błąd zgodnie z werdyktem.
- Odpowiedź „bez ćwiczonej formy” z cache po decyzji rodzica `overridden_correct`: sukces celu, nie „bez ćwiczonej formy”.
- Częściowa konfiguracja `UMIEM_GRADER_*` w procesie web: `lessonAgentPublicFromEnv` nie rzuca.

Test dla każdej linii jest w zadaniu, które posiada kod (Zadania 4, 5, 6, 8).

---

### Zadanie 1: Domena — neutralne dopasowanie, literówka przy dosłownym focus, `usesTargetForm`

**Files:**
- Modify: `packages/server/src/domain/lessons/evaluate.ts`
- Test: `packages/server/src/domain/lessons/evaluate.test.ts`

**Interfaces:**
- Produces:
  - `matchLessonAnswer(answer: string, key: LessonAnswerKey): MatchResult` (bez parametru `normalizer`; wewnątrz `normalizeTokens` z `./normalize`)
  - `closestApprovedVariant(answer: string, key: LessonAnswerKey): string` (bez `normalizer`)
  - `GraderVerdict.usesTargetForm: boolean`
  - `ObjectiveGrade.verdict` z nową wartością `"model_off_target"`
  - `gradeFromVerdict(verdict: GraderVerdict | null): ObjectiveGrade` — tabela §5 specu etapu
  - `validateVerdict(raw, ctx)` wymaga `usesTargetForm: boolean`

- [ ] **Step 1: Testy (najpierw czerwone)** w `evaluate.test.ts` — dopisz/zmień; usuń przekazywanie `englishNormalizer` do obu funkcji:
  - `matchLessonAnswer("Yes, she's.", key({answer:"Yes, she is.", focus:["is"]}))` → `{kind:"no_match"}`; to samo dla „Yes, I'm.”/„Yes, I am.”, „Yes, they're.”/„Yes, they are.”, „He has running.”/klucz „He's running.” (focus `["running"]`);
  - „She isn't at home.” przy `acceptedAnswers: ["She isn't at home."]` → `exact`;
  - klucz „She doesn't like tea.”, focus `["doesn't","like"]`: „She doesn't like tee.” → `minor_typo` z `typoToken: "tee"`; „She doesn't likes tea.” → `no_match`;
  - stara rewizja: klucz „She doesn't like tea.”, focus `["does","not"]`: „She don't like tea.” → `no_match`; „She doesn't like tee.” → `no_match` (focus niedosłowny = bez tolerancji);
  - `validateVerdict({verdict:"correct",errorCategory:null,fragments:[],note:""}, ctx)` → `null` (brak pola); z `usesTargetForm: true` → werdykt z tym polem;
  - `gradeFromVerdict` — po jednym przypadku na każdy wiersz tabeli §5 (np. `correct`+`false` → `{outcome:"unevaluated", verdict:"model_off_target"}`, `almost`+`other`+`false` → `model_off_target`, `almost`+kategoria celu+`false` → `model_incorrect`).
- [ ] **Step 2:** `pnpm vitest run packages/server/src/domain/lessons/evaluate.test.ts` → FAIL.
- [ ] **Step 3: Implementacja.** Tolerancja literówki per wariant: tokeny `normalizeTokens(focus.join(" "))` muszą być ciągłą podsekwencją tokenów wariantu (pusty focus → bez tolerancji); zbiór chronionych tokenów to te tokeny. W `gradeFromVerdict` gałąź `usesTargetForm === false` przed zaliczeniem `correct` i `almost` bez kategorii celu. Zaktualizuj komentarz nagłówka pliku (neutralna normalizacja zamiast „dowolnego `AnswerNormalizer`”).
- [ ] **Step 4:** ten sam test → PASS; `pnpm typecheck` pokaże wywołujących z `normalizer` — popraw tylko wywołania (`lesson-attempts.ts`), logikę powłoki zmienia Zadanie 4.
- [ ] **Step 5: Commit** `Ocena lekcji: dopasowanie bez rozwijania skrótów i usesTargetForm w domenie (#360)`.

### Zadanie 2: Warianty i focus na neutralnej normalizacji

**Files:**
- Modify: `packages/server/src/domain/lessons/pool-validation.ts` (`validateAcceptedAnswers`, `withoutRedundantAcceptedVariants`, wywołanie `validateFocus`)
- Modify: `packages/server/src/modules/materials/lessons/lesson-api.ts:636,950`, `lesson-pool-acceptance.ts:45`, `lesson-supervision.ts:586`
- Modify: `packages/server/src/domain/lessons/subjects/english-grammar/agent-policy.ts:33`, `english-chapter/agent-policy.ts:49`
- Test: `pool-validation.test.ts`, migawki promptu agenta (aktualizacja przez `-u` tylko po przejrzeniu różnicy)

**Interfaces:**
- Produces: `withoutRedundantAcceptedVariants(ex: LessonExerciseDraft): LessonExerciseDraft` (bez `normalizer`; porównanie `answersEquivalent(…, baseNormalizer)`).

- [ ] **Step 1: Testy:** klucz „She is not at home.”, wariant „She isn't at home.” → `withoutRedundantAcceptedVariants` zostawia wariant, walidacja puli bez `variants.duplicate`; wariant „she is not at home” (różni się wielkością liter i kropką) → nadal porzucany/odrzucany; ćwiczenie z kluczem „She doesn't like tea.” i focus `["does","not"]` → issue reguły focus z `validateFocus`.
- [ ] **Step 2:** `pnpm vitest run packages/server/src/domain/lessons/pool-validation.test.ts` → FAIL.
- [ ] **Step 3:** `validateAcceptedAnswers` i `withoutRedundantAcceptedVariants` porównują przez `baseNormalizer`; `validateFocus(ex, baseNormalizer, issues)` w `validateExercise`; w `acceptVerdictAsVariant` `answersEquivalent(v, normalized, baseNormalizer)`. `CONTRACTIONS_NOTE` = `"Write contracted and full forms as separate accepted answers: doesn't and does not are different variants."` (oba pliki).
- [ ] **Step 4:** `pnpm vitest run packages/server/src/domain/lessons` → PASS (migawki promptu zaktualizowane po przejrzeniu: zmienia się tylko dopisek).
- [ ] **Step 5: Commit** `Warianty i focus lekcji na neutralnej normalizacji (#360)`.

### Zadanie 3: Grader `grader-v2`, `blocks`, `promptVersions`, rola gramatyki, fake

**Files:**
- Modify: `packages/server/src/ports/ai.ts` (`GraderInput.blocks?: readonly string[]`, `AnswerGraderProvider.promptVersions: readonly string[]`)
- Modify: `packages/server/src/providers/openai-compatible/grader.ts`
- Modify: `packages/server/src/modules/materials/lessons/lesson-grader-input.ts` (`lessonGraderInput` przyjmuje opcjonalne `blocks`; `childAnswer` slice `school || blocks ? 600 : 200`)
- Modify: `packages/server/src/domain/lessons/subjects/english-grammar/prompts.ts` (`gradingRole`, pierwsze zdanie)
- Modify: `packages/server/src/providers/fake.ts` (`FakeAnswerGrader`, fake aktywności sesji jeśli implementuje port)
- Test: `providers/openai-compatible/grader.test.ts`, `lesson-grader-input.parity.test.ts`, testy promptów przedmiotu

**Interfaces:**
- Produces: `lessonGraderInput({..., blocks?: readonly string[]})`; adapter `promptVersion: "grader-v2"`, `promptVersions: ["grader-v2", "school-grader-v3"]`; fake `promptVersion` domyślnie `"fake-grader-v2"`, `promptVersions: [this.promptVersion, "fake-school-grader-v3"]`.

- [ ] **Step 1: Testy:** prompt systemowy lekcji zawiera dosłownie zdania 1–2 z §5 specu etapu i `"usesTargetForm": boolean` w kształcie JSON; linia rozsypanki (§7, dosłownie) tylko gdy `blocks` jest podane, a dane użytkownika zawierają `blocks`; prompt szkolny bez zmian (wersja `school-grader-v3`); `lessonGraderInput` z `blocks` obcina `childAnswer` do 600, bez `blocks` do 200; fake: domyślny i kluczowy werdykt mają `usesTargetForm: true`.
- [ ] **Step 2:** `pnpm vitest run packages/server/src/providers packages/server/src/modules/materials/lessons/lesson-grader-input.parity.test.ts` → FAIL.
- [ ] **Step 3:** Zmiany wg §5 i §7 specu etapu; `gradingRole` gramatyki: pierwsze zdanie = `"You grade whether the answer correctly does what the instruction asks; usesTargetForm says separately whether it uses the given grammar rule."`, reszta bez zmian.
- [ ] **Step 4:** ten sam zestaw → PASS; `pnpm typecheck` (inne implementacje portu dostają `promptVersions`).
- [ ] **Step 5: Commit** `Grader lekcji grader-v2: usesTargetForm, rozsypanka i bieżące wersje promptu (#360)`.

### Zadanie 4: Powłoka oceny — klucz cache, migracja, wynik „bez ćwiczonej formy”

**Files:**
- Create: `packages/server/drizzle/0040_lesson_verdicts_uses_target_form.sql` (+ wpis w `packages/server/drizzle/meta/_journal.json` jak dla 0039)
- Modify: `packages/server/src/db/schema.ts` (`lessonVerdicts.usesTargetForm: boolean("uses_target_form")`, nullable)
- Modify: `packages/server/src/modules/learning/lessons/lesson-attempts.ts`
- Modify: `packages/contracts/src/messages.ts` (`kid.lessonPracticedForm: "To też dobrze! W tej lekcji ćwiczymy tak: {text}"`), komentarze `lesson_precision_hint` w `packages/contracts/src/kid.ts` i `packages/kid-ui/src/screens/lesson-feedback-view.ts`
- Test: `tests/integration/lesson-grader.test.ts` (rozszerz), `tests/integration/helpers.ts` lub `tests/fixtures/` (helper wydania wskazanego ćwiczenia, jeśli potrzebny)

**Interfaces:**
- Consumes: Zadania 1 i 3.
- Produces: `normalizedAnswerKey(text: string): string` = `normalizeTokens(text).join(" ") || text.trim().toLowerCase()`; `nextLessonTaskState(modality, grade: ObjectiveGrade, mockTest?)`; `verdictFromCacheRow` zwraca `usesTargetForm` (`overridden_correct` → `true`; wiersz z `null` → `true`).
- Helper testów (jeśli zbudowany tu, używany w Zadaniach 5 i 9): `issueLessonExercise(pool, args: { sessionId; revisionId }) : Promise<string /* taskId */>` — wstawia `session_tasks` z wyniku `materializeExercise` dla rewizji, z zapisem zdarzenia wydania jak w selektorze; poza ścieżką oceny.

- [ ] **Step 1: Testy integracyjne** (fake grader programowany przez `onAnswer`):
  - „bez ćwiczonej formy”: werdykt `{verdict:"correct", usesTargetForm:false}` → próba `completed`, zadanie `answered`, ocena `unassessed` z `details.verdict = "model_off_target"`, brak wiersza `child_objective_progress`, feedback `{kind:"lesson_precision_hint", hintPl:"To też dobrze! W tej lekcji ćwiczymy tak: <klucz>"}`, ekspozycja `target_key` zapisana; wiersz cache z `uses_target_form = false`;
  - ta sama odpowiedź w nowym zadaniu → wynik z cache, `grader.callCount` bez zmiany;
  - para „Yes, she is.”/„Yes, she's.” przy kluczu „Yes, Anna is.” w obu kolejnościach (dwie rewizje) → dwa wiersze cache na rewizję, dwa wywołania;
  - stara rewizja (focus `["does","not"]`) i „She don't like tea.” → wywołanie gradera;
  - decyzja rodzica `overridden_correct` na wierszu z `uses_target_form = false` → kolejna identyczna odpowiedź zalicza cel;
  - Review Focus: ta ostatnia linia jest testem dla „decyzja rodzica nad bez ćwiczonej formy”.
- [ ] **Step 2:** `pnpm test:integration tests/integration/lesson-grader.test.ts` → FAIL.
- [ ] **Step 3: Implementacja.** Usuń `normalizerFor`; `normalizedAnswerKey` jw.; faza 2 zapisuje `usesTargetForm` werdyktu; `resultFromVerdict` dla `model_off_target` zwraca `{kind:"lesson_precision_hint", hintPl: format(lessonPracticedForm, {text: correctText})}`, `exposures: [key.targetKey]`; obie wywołujące `nextLessonTaskState` przekazują `result.grade`. Migracja: `ALTER TABLE "learning_app"."lesson_verdicts" ADD COLUMN "uses_target_form" boolean;` z komentarzem po polsku jak w 0039.
- [ ] **Step 4:** ten sam test → PASS; `tests/integration/lesson-attempts.test.ts`, `lesson-mock-tests.test.ts`, `lesson-parent-supervision.test.ts`, `lesson-sentence-audio.test.ts`, `lesson-error-explanation.test.ts`, `progress-rebuild.test.ts`, `apps/web/src/orpc/parent-router.test.ts`: zaprogramowane surowe werdykty dostają `usesTargetForm: true` → PASS.
- [ ] **Step 5: Commit** `Ocena lekcji: klucz cache bez rozwijania skrótów i wynik bez ćwiczonej formy (#360)`.

### Zadanie 5: Rozsypanka przez model oceniający

**Files:**
- Modify: `packages/server/src/modules/learning/lessons/lesson-attempts.ts` (`startLessonAttempt`, `gradeLessonAnswer`, `submitLessonAttempt`, `reserveProcessingAttempt`, `finalizeGradedAttempt`, `buildGraderInput`, `allowedCategoriesFor`, `resultFromVerdict`)
- Modify: `packages/server/src/modules/materials/lessons/lesson-supervision.ts` (`acceptVerdictAsVariant`: `lesson_order` → `AppError("validation")`)
- Modify: `tests/integration/lesson-attempts.test.ts:198-209`, `tests/integration/helpers.ts` (`finishLessonTask(correct:false)` — zamiast odwrócenia kolejności `dont_remember` albo zaprogramowany błąd)
- Test: `tests/integration/lesson-grader.test.ts` (sekcja rozsypanki)

**Interfaces:**
- Consumes: Zadania 3 i 4 (`lessonGraderInput` z `blocks`, `nextLessonTaskState(…, grade)`).
- Produces: `evaluateSequence` bez zmian; nowy predykat w domenie albo w powłoce `isBlockPermutation(itemIds, key): boolean` (część dzisiejszej logiki `evaluateSequence` — wydziel, nie kopiuj).

- [ ] **Step 1: Testy integracyjne:**
  - klucz → `closed_correct`, `grader.callCount === 0`;
  - inna permutacja z werdyktem `correct` → `model_correct`, feedback `great`, zadanie `answered`; grader dostał `blocks` w kolejności dziecka, `acceptedAnswers` = `[correctTextFor(key)]` (bez `acceptedAnswers` rewizji), w dozwolonych kategoriach jest `wrong_order`;
  - werdykt `{verdict:"incorrect", errorCategory:"wrong_order", usesTargetForm:false}` → `model_incorrect`, feedback `incorrect` z `correctText` = klucz ułożony z klocków;
  - werdykt `correct` z `usesTargetForm:false` → `model_correct` (flaga ignorowana dla rozsypanki);
  - nie-permutacja (obcy id albo duplikat) → `AppError` `validation`, brak próby;
  - bez gradera i po limicie → `not_assessed`, zadanie `issued`;
  - Review Focus: powtórka tego samego `clientAttemptId` po ścieżce modelu → ta sama próba, jedno wywołanie; przeterminowana próba `processing` rozsypanki → `not_assessed`, zadanie `issued`; kartkówka z inną kolejnością → zadanie `answered`, brak feedbacku;
  - `acceptVerdictAsVariant` na werdykcie rozsypanki → `validation`.
- [ ] **Step 2:** `pnpm test:integration tests/integration/lesson-grader.test.ts` → FAIL.
- [ ] **Step 3: Implementacja** wg §7 specu etapu. `needsModel = (modality === "text" && type !== "lesson_calculation" || modality === "sequence") && verdict === "unavailable"`. Odpowiedź tekstowa dla sekwencji = `itemIds.map(id => itemValues[id]).join(" ")`. W `resultFromVerdict` dla `lesson_order`: `correctText = correctTextFor(key)` i werdykt z `usesTargetForm: true`.
- [ ] **Step 4:** test → PASS; `pnpm test:integration tests/integration/lesson-attempts.test.ts tests/integration/lesson-mock-tests.test.ts` → PASS.
- [ ] **Step 5: Commit** `Rozsypanka lekcji: inna kolejność oceniana przez model (#360)`.

### Zadanie 6: Panel decyzji — tylko bieżące wersje

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-supervision.ts` (`listLessonVerdicts`)
- Test: `tests/integration/lesson-parent-supervision.test.ts`

- [ ] **Step 1: Test:** wiersz `prompt_version = 'fake-grader-v1'` i wiersz `fake-grader-v2` tej samej rewizji → lista zawiera tylko drugi; bez gradera w `services` → pusta lista.
- [ ] **Step 2:** FAIL. **Step 3:** filtr `inArray(lessonVerdicts.promptVersion, services.grader?.provider.promptVersions ?? [])` (pusta lista → zwróć `[]` bez zapytania). **Step 4:** PASS.
- [ ] **Step 5: Commit** `Panel werdyktów: tylko bieżące wersje promptu (#360)`.

### Zadanie 7: Dostępność generowania i limit

**Files:**
- Modify: `packages/server/src/config.ts` (`lessonAgentPublicFromEnv`, `DEFAULT_GRADER_MAX_CALLS_PER_SESSION`), `config-defaults.ts` (`"150"`), `providers/fake.ts` (`fakeGraderDeps` domyślny limit), `domain/lessons/scheduler.ts` (eksport `GRADER_DEPENDENT_TYPES`), `modules/learning/lessons/lesson-sessions.ts:80,733`, `lesson-shorten.ts:39`
- Modify: `packages/contracts/src/messages.ts:1143` (`lesson_agent_unavailable`: „Generowanie lekcji wymaga klucza OpenRouter i modelu oceniającego w konfiguracji serwera. Po uzupełnieniu konfiguracji ponów generowanie.”)
- Test: `config.test.ts` / `config-defaults.test.ts`, `scheduler.test.ts`, test `lesson-sessions` jeśli pokrywa rezerwację

- [ ] **Step 1: Testy:** `lessonAgentPublicFromEnv({OPENROUTER_API_KEY:"sk-or-…"} bez gradera…)` — przypadek z kluczem agenta przy wyłączonym graderze → `undefined`; częściowa konfiguracja gradera → `undefined` bez wyjątku; tryb fake bez zmian; `CONFIG_DEFAULTS.UMIEM_GRADER_MAX_CALLS_PER_SESSION === "150"` i równość ze stałą; `fakeGraderDeps().maxCallsPerSession === 150`.
- [ ] **Step 2:** FAIL. **Step 3:** `if (!openCheckService) return undefined;` po wyliczeniu etykiety, pole `openCheckService` bezwarunkowe; `DEFAULT_GRADER_MAX_CALLS_PER_SESSION = Number(CONFIG_DEFAULTS.UMIEM_GRADER_MAX_CALLS_PER_SESSION)` jeśli import nie tworzy cyklu, inaczej literał `150` pilnowany istniejącym testem; `GRADER_CALLS_PER_SESSION_FALLBACK` usunięty (`services.grader ? … : 0`); `lesson-sessions.ts` i `lesson-shorten.ts` używają `GRADER_DEPENDENT_TYPES.has(...)`.
- [ ] **Step 4:** `pnpm vitest run packages/server/src/config packages/server/src/domain/lessons/scheduler.test.ts` → PASS.
- [ ] **Step 5: Commit** `Generowanie lekcji wymaga gradera; jedna stała typów i limit 150 (#360)`.

### Zadanie 8: Dokumentacja

**Files:** `docs/architecture.md` (§19 i miejsce z limitem 20), `docs/provider-config.md:236`, `.env.example:121`, `AGENTS.md` (punkt o modelu oceniającym lekcji: rozsypanka, ≤600 znaków dla ułożonych klocków; warunek dostępności generowania).

- [ ] **Step 1:** Opisz zmiany §2–§9 specu etapu w §19 architektury (krótko, odwołanie do specu etapu); liczby 20 → 150.
- [ ] **Step 2:** `pnpm vitest run tests/` dla testów dokumentacji, jeśli istnieją (np. testy spójności AGENTS/limitów) → PASS.
- [ ] **Step 3: Commit** `Dokumentacja etapu 3 oceny odpowiedzi (#360)`.

### Zadanie 9: Sonda próbek (§12 specu etapu)

**Files:**
- Create: `tests/probes/fixtures/grading-samples.ts` (36 próbek z tabeli §12: przedmiot, typ, payload ćwiczenia, odpowiedź, klasa, oczekiwanie `pass | fail | off_target`, flaga `noModel`, para `A | B`, `oldRevision`)
- Create: `tests/probes/grading.probe.test.ts`
- Modify: `package.json` (`"probe:grading": "vitest run --config vitest.probe.config.ts tests/probes/grading.probe.test.ts"`), `vitest.probe.config.ts` (`enabled` także przy `UMIEM_PROBE_GRADING === "1"`)

**Interfaces:**
- Consumes: helper `issueLessonExercise` (Zadanie 4), `graderFromEnv(withConfigDefaults(process.env))`, `probe-costs.ts` (rejestr kosztów), `loadDotEnv`.

- [ ] **Step 1:** Fixture = tabela §12 bez zmian etykiet (jedno źródło); test jednostkowy fixture w `tests/probes/grading-samples.test.ts`: 36 próbek, każda klasa z §12.3 obecna, pary A i B kompletne.
- [ ] **Step 2:** Sonda: pomija się bez `UMIEM_PROBE_GRADING=1` albo bez gradera; sprawdza rejestr kosztów (limit 0,20 USD) przed pierwszym wywołaniem; dla każdej próbki zakłada lekcję z rewizją (stare rewizje z payloadem w dawnym kształcie), wydaje zadanie, wysyła odpowiedź `submitAttempt` dwa razy (drugi raz w nowym zadaniu tej samej rewizji), pary w obu kolejnościach na osobnych rewizjach; drukuje tabelę `# | klasa | oczekiwanie | wynik (verdict, outcome, feedback.kind) | z cache | próg`; asercje progów 1–5 z §12.
- [ ] **Step 3:** Bez zgody właściciela: tylko `pnpm vitest run tests/probes/grading-samples.test.ts` → PASS. Z zgodą: `UMIEM_PROBE_GRADING=1 UMIEM_PROBE_COSTS=<plik poza repo> pnpm probe:grading`; wynik (tabela, koszt) do opisu PR. Przekroczony próg → zmiana promptu `grader-v2` (nowy commit), powtórka (≤ 3 przebiegi).
- [ ] **Step 4: Commit** `Sonda próbek oceny odpowiedzi etapu 3 (#360)`.

### Zadanie 10: Weryfikacja, przegląd i PR

- [ ] **Step 1:** `pnpm check` → PASS; `pnpm test:integration` → PASS; `pnpm test:e2e:shards` (w tle) → PASS (przy `net::ERR_NO_BUFFER_SPACE` powtórz dany spec i odnotuj w PR).
- [ ] **Step 2:** Liczby linii poza testami na ścieżkach §10 specu zbiorczego (bazowo: agent 1582, subjects 9312, materials agent 3245, provider 802, `evaluate.ts` 736, `modules/learning/lessons/` 4679) — po zmianach, z bilansem.
- [ ] **Step 3:** Przegląd całej gałęzi przez trzech niezależnych krytyków (prostota, poprawność danych, sprawiedliwość oceny); trafne uwagi napraw.
- [ ] **Step 4:** Skill `ponytail:ponytail-review` na gałęzi; trafne uwagi napraw.
- [ ] **Step 5:** Push i PR do `main` (bez scalania): opis po polsku — zakres, gdzie reguły, zależności, gwarancje zweryfikowane, wynik sondy, liczby linii, wpływ API → MCP → skill (brak: `learning-overview` nie obejmuje lekcji; `LessonVerdictDto` bez zmian albo z polem wg decyzji), co znaleźli krytycy i `ponytail-review` i co z tym zrobiono; `Closes #360`; wzmianka, że #288 do zamknięcia po etapie 3.
