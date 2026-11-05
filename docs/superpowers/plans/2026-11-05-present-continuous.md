# Present Continuous w lekcjach gramatyki — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Wersja 1 (przed przeglądem trzech krytyków).

**Goal:** Trzeci temat katalogu `english_grammar` — `present_continuous@1` z sześcioma celami, deterministyczną walidacją jednoznaczności czasu i promptami — plus jedna zmiana silnika: zdanie po odpowiedzi luki bez nawiasu z czasownikiem.

**Architecture:** Reguły tematu żyją w przedmiocie `english_grammar` (dane katalogu, walidator, prompty) i w `subjects/english/` (tabela form -ing). Czyste funkcje bez zależności od infrastruktury; walidator przedmiotu wołany przez istniejący `validateLessonExercise`/agenta. Bez migracji, bez zmian kontraktów, Kid UI, panelu, polityki agenta, MCP i `SKILL.md`; jedyna zmiana poza przedmiotem: `feedbackSentenceText` (§6.7 specu).

**Tech Stack:** TypeScript strict, Vitest (unit; integracja na Postgresie w kontenerze), sonda Vitest na OpenRouter.

**Spec:** `docs/superpowers/specs/2026-11-05-present-continuous-design.md` (wersja 2, zaakceptowana). Implementer czyta sekcję specu wskazaną w zadaniu — plan nie powtarza list ani tekstów kart.

## Global Constraints

- Worktree `C:\Users\looka\IdeaProjects\knowli-worktrees\present-continuous`, gałąź `feature/present-continuous` od `origin/main` 3b4c1ec0. Nie wypychać do `main`, nie scalać PR. Push i PR dopiero w Task 15.
- Nigdy `npm install`; `node_modules` już jest. Bez nowych zależności.
- Żadnych płatnych wywołań modeli poza Task 14, i tam wyłącznie po wyraźnym „tak” właściciela na konkretną wiadomość z szacunkiem kosztu; każde ponowienie wymaga nowej zgody. Limit rejestru sondy: 2 USD.
- Bez zmian w plikach z planu PR 2 etapu 3 (#237, `git show 84bbb0eb`) poza dokumentacją: `types.ts`, `providers/fake*.ts`, `config.ts`, kompozycje, `lesson-drafts.ts`, `lesson-api.ts`, `agent-policy.ts`, `agent/*.ts`, `pool-validation.ts`.
- Kod po angielsku, komentarze i dokumentacja po polsku, gęstość komentarzy jak w otaczającym kodzie. Komunikaty walidatora PC po polsku, poprzedzone jednym z prefiksów: `pc-marker:`, `pc-ing:`, `pc-be:`, `pc-state:`, `pc-error-fix:`, `pc-notice:`, `pc-shape:` (pozostałe reguły kształtu).
- Prywatność: żadnych nowych przepływów danych do modeli; testy na fikcyjnych danych.
- Testy jednostkowe: `pnpm exec vitest run --config vitest.unit.config.ts <ścieżki>`. Po każdym zadaniu `pnpm typecheck` przechodzi.
- Commity po polsku, zakończone `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ścieżki skrótowe: `G = packages/server/src/domain/lessons/subjects/english-grammar`, `E = packages/server/src/domain/lessons/subjects/english`, `L = packages/server/src/domain/lessons`.

## Review Focus

1. **Odpowiedź dziecka ze skrótem lub inną pisownią** („He's running”, „he is running”, „isn't”, „is not”, bez kropki, wielkie litery) przy kluczu z pełnym „is” — oczekiwane zaliczenie. Test w Task 7, Step 1 (`evaluate`).
2. **Zdanie po odpowiedzi i nagranie TTS** luki z nawiasem — oczekiwane „He is playing football now.” bez „(play)”, także w barierze historyjki. Test w Task 9.
3. **Istniejące tematy PS i to_be po zawężeniu promptu i wydzieleniu `be-agreement.ts`** — oczekiwane identyczne zachowanie walidatora i tylko zamierzony diff promptu. Testy w Task 3 (istniejące testy bez zmian) i Task 10 (migawka `fieldRules`).
4. **Polskie imię i liczba mnoga jako podmiot** („Łucja ___ (read) now.”, „The children ___ (play) now.”, „Tom and Ola ___ (run)…”) — oczekiwane poprawne `is`/`are`, bez fałszywych odrzuceń. Test w Task 6, Step 1.
5. **„Wskaż słowo” z „morning”/„sing” obok jednej formy -ing** — oczekiwane przyjęcie ćwiczenia (to nie formy -ing). Test w Task 7, Step 1.

---

### Task 1: Tabela form -ing i czasowniki stanu

**Files:**
- Create: `E/ing-forms.ts`, `E/ing-forms.test.ts`

**Interfaces:**
- Produces:
  - `export type IngRule = "plain" | "drop_e" | "double" | "ie_to_y" | "other";`
  - `export function ingFormOf(base: string): string | undefined`
  - `export function ingRuleOf(base: string): IngRule | undefined`
  - `export function baseOfIngForm(form: string): string | undefined`
  - `export function isIngFormInTable(token: string): boolean`
  - `export function ingVerbsByRule(rules: readonly IngRule[]): readonly string[]` (formy podstawowe w kolejności tabeli; do promptu)
  - `export function stateVerbIn(text: string, mode: "any_form" | "ing_form"): string | undefined` — zwraca pierwszy czasownik stanu (forma podstawowa) użyty w tekście z uwzględnieniem wyjątków ze specu §5.3; `undefined`, gdy brak.
  - `export const STATE_VERBS: ReadonlySet<string>` (lista §5.3)

- [ ] **Step 1: Testy (czerwone)** w `ing-forms.test.ts`:
  ```ts
  it("klasy reguł pisowni", () => {
    expect([ingFormOf("play"), ingRuleOf("play")]).toEqual(["playing", "plain"]);
    expect([ingFormOf("write"), ingRuleOf("write")]).toEqual(["writing", "drop_e"]);
    expect([ingFormOf("swim"), ingRuleOf("swim")]).toEqual(["swimming", "double"]);
    expect([ingFormOf("lie"), ingRuleOf("lie")]).toEqual(["lying", "ie_to_y"]);
    expect([ingFormOf("travel"), ingRuleOf("travel")]).toEqual(["travelling", "other"]);
    expect([ingFormOf("fix"), ingFormOf("jump")]).toEqual(["fixing", "jumping"]);
  });
  it("czasownik spoza tabeli i czasowniki stanu → undefined", () => {
    expect(ingFormOf("photosynthesise")).toBeUndefined();
    for (const verb of STATE_VERBS) expect(ingFormOf(verb), verb).toBeUndefined();
  });
  it("odwrotność i rozpoznanie formy -ing", () => {
    expect(baseOfIngForm("running")).toBe("run");
    expect(isIngFormInTable("swimming")).toBe(true);
    for (const word of ["morning", "sing", "thing", "evening"]) expect(isIngFormInTable(word), word).toBe(false);
  });
  it("tabela ma co najmniej 70 czasowników, każda klasa poza other ≥ 5", () => { /* liczności przez ingVerbsByRule */ });
  it("stateVerbIn: formy i wyjątki", () => {
    expect(stateVerbIn("She likes apples every day.", "any_form")).toBe("like");
    expect(stateVerbIn("I am liking it.", "ing_form")).toBe("like");
    expect(stateVerbIn("She is having lunch now.", "any_form")).toBeUndefined();
    expect(stateVerbIn("She has breakfast every day.", "any_form")).toBeUndefined();
    expect(stateVerbIn("He is looking at the stars.", "any_form")).toBeUndefined();
    expect(stateVerbIn("Look! Tom is running.", "any_form")).toBeUndefined();
    expect(stateVerbIn("She has a dog.", "any_form")).toBe("have");
    expect(stateVerbIn("I know it now.", "any_form")).toBe("know");
    expect(stateVerbIn("He is being silly.", "ing_form")).toBe("be");
  });
  ```
- [ ] **Step 2: Uruchom** `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/subjects/english/ing-forms.test.ts` — FAIL (brak modułu).
- [ ] **Step 3: Zaimplementuj** `ing-forms.ts`: tabela `Record<string, { form; rule }>` ok. 80 czasowników czynności A1–A2 (pisownia brytyjska; `other` tylko dla wyjątków typu travel, begin, visit), formy PS czasowników stanu przez `formsOf`/`stemsOf` z `E/inflection.ts` plus nieregularne (has, is…), tokenizacja `normalizeTokens` z `L/normalize.ts`; wyjątki: „have/has/having” + breakfast | lunch | dinner | a bath | a shower | fun | a party, „look/looks/looking” + at | for, pierwszy token „look” z „!” albo „,” w surowym tekście.
- [ ] **Step 4: Uruchom** testy z Step 2 — PASS; `pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** „Gramatyka: tabela form -ing i czasowniki stanu dla Present Continuous”.

### Task 2: Wskaźniki czasu

**Files:**
- Create: `G/time-markers.ts`, `G/time-markers.test.ts`

**Interfaces:**
- Produces:
  - `export type MarkerGroup = "now" | "usually";`
  - `export interface MarkerScan { readonly groups: ReadonlySet<MarkerGroup>; readonly forbidden: readonly string[] }`
  - `export function scanTimeMarkers(text: string, lang: "en" | "pl"): MarkerScan`
  - `export const TIME_MARKER_LISTS: { readonly nowEn: readonly string[]; readonly usuallyEn: readonly string[]; readonly nowPl: readonly string[]; readonly usuallyPl: readonly string[]; readonly forbidden: readonly string[] }` — teksty do promptu (Task 10), te same, z których budowane są wzorce dopasowania.

- [ ] **Step 1: Testy (czerwone)** — listy ze specu §5.1; przypadki:
  ```ts
  const groups = (text: string, lang: "en" | "pl") => [...scanTimeMarkers(text, lang).groups].sort();
  it("angielskie grupy", () => {
    expect(groups("She is reading now.", "en")).toEqual(["now"]);
    expect(groups("Look! Dad is cooking.", "en")).toEqual(["now"]);
    expect(groups("Listen, the baby is crying.", "en")).toEqual(["now"]);
    expect(groups("They listen to music every day.", "en")).toEqual(["usually"]);
    expect(groups("I look at the board.", "en")).toEqual([]);
    expect(groups("We play football every summer.", "en")).toEqual(["usually"]);
    expect(groups("She swims three times a week.", "en")).toEqual(["usually"]);
    expect(groups("He plays tennis on Saturdays.", "en")).toEqual(["usually"]);
    expect(groups("Shh! Grandpa is sleeping.", "en")).toEqual(["now"]);
  });
  it("polskie scenki", () => {
    expect(groups("Cicho! Dziadek śpi.", "pl")).toEqual(["now"]);
    expect(groups("Ola cicho czyta wieczorami.", "pl")).toEqual([]);
    expect(groups("Gdzie jest tata?", "pl")).toEqual(["now"]);
    expect(groups("Ola zazwyczaj czyta po obiedzie.", "pl")).toEqual(["usually"]);
    expect(groups("Każdego dnia Tom jeździ na rowerze.", "pl")).toEqual(["usually"]);
    expect(groups("Teraz czy zwykle?", "pl")).toEqual(["now", "usually"]);
  });
  it("wskaźniki zakazane", () => {
    expect(scanTimeMarkers("I'm playing tennis tomorrow.", "en").forbidden).toEqual(["tomorrow"]);
    expect(scanTimeMarkers("He is swimming this afternoon.", "en").forbidden).toEqual(["this afternoon"]);
    expect(scanTimeMarkers("She plays on Saturday.", "en").forbidden).toEqual(["on saturday"]);
    expect(scanTimeMarkers("She plays on Saturdays.", "en").forbidden).toEqual([]);
    expect(scanTimeMarkers("Jutro gramy.", "pl").forbidden).toEqual(["jutro"]);
  });
  ```
- [ ] **Step 2: Uruchom** testy — FAIL.
- [ ] **Step 3: Zaimplementuj**: dopasowanie wielowyrazowych fraz po tokenach `normalizeTokens`; wykrzyknienia (Look!, Listen!, Shh!, Be quiet!, Cicho!, Ciii!, Patrz!, Popatrz!, Spójrz!, Zobacz!, Posłuchaj!, Słuchaj!) tylko jako początek surowego tekstu z „!” albo „,” po nich; „Gdzie jest/są” jako dwa pierwsze tokeny; „every”/„każdego”/„co” + rzeczownik czasu z zamkniętej listy; „N times a week/day” (N: once, twice, two…ten, cyfry).
- [ ] **Step 4: Uruchom** testy — PASS.
- [ ] **Step 5: Commit** „Gramatyka: wskaźniki czasu teraz/zwykle dla Present Continuous”.

### Task 3: Wydzielenie `be-agreement.ts` (czyste przeniesienie)

**Files:**
- Create: `G/be-agreement.ts`
- Modify: `G/validators.ts` (usuwa przeniesione definicje, importuje je)

**Interfaces:**
- Produces (eksporty z `be-agreement.ts`, bez zmiany ciał): `BE_FORM_BY_SUBJECT`, `BE_FORMS`, `BE_CONTRACTED_TOKENS`, `BE_AFFIRMATIVE_CONTRACTIONS`, `looksPlural`, `beSubjectTokensBefore`, `type BeNearPronoun`, `beAnswerPronounAllowed`, `bePronounNearGap`, `expectedBeFormNearGap`, `beStemContext`, `parseBeGapAnswer`, `checkBePolarity` oraz stałe, od których zależą (`BE_DEMONSTRATIVE_FORM`, `BE_IRREGULAR_PLURALS`, `BE_S_ENDING_NAMES`, `BE_UNCOUNTABLE_S_NOUNS`, `BE_DETERMINERS`, `BE_WH_WORDS`, `BE_NON_SUBJECT_BEFORE`, `BE_AFTER_SKIP`, `BE_ADVERBS`).

- [ ] **Step 1: Uruchom przed zmianą** `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/subjects/english-grammar` — PASS; zapisz liczbę testów.
- [ ] **Step 2: Przenieś** definicje (wycinek `validators.ts` ok. l. 144–357) do `be-agreement.ts` bez zmiany treści; `validators.ts` importuje je. Bez nowych testów — to czyste przeniesienie.
- [ ] **Step 3: Uruchom** to samo polecenie — PASS, ta sama liczba testów; `pnpm typecheck` — PASS.
- [ ] **Step 4: Commit** „Gramatyka: zgodność formy to be wydzielona do be-agreement (bez zmiany zachowania)”.

### Task 4: Biegunowość z mapy celów i podmiot zdania

**Files:**
- Modify: `G/be-agreement.ts`, `G/validators.ts` (wywołania `checkBePolarity` w ścieżce `to_be`)
- Create: `G/be-agreement.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `export type BePolarity = "affirmative" | "negative" | "any";`
  - `checkBePolarity(polarity: BePolarity, effectiveNegative: boolean, marker: string | undefined, field: string, errors: string[]): void` — zamiast `objective: string`; ścieżka `to_be` liczy `polarity` ze stałej `TO_BE_POLARITY = { affirmative_forms: "affirmative", contractions: "affirmative", negative_forms: "negative" }` (inne cele → `"any"`).
  - `export function beFormForSubject(subjectTokens: readonly string[]): "am" | "is" | "are" | undefined` — forma be dla podmiotu zdania (tokeny przed formą be albo przed luką): zaimki, „X and Y” → are, imię na -s z `BE_S_ENDING_NAMES` → is, liczba mnoga przez `looksPlural` i `BE_IRREGULAR_PLURALS` (rozszerzone o `mice`), inaczej → is; `undefined` dla pustej listy.

- [ ] **Step 1: Testy (czerwone)** w `be-agreement.test.ts`:
  ```ts
  it("beFormForSubject", () => {
    expect(beFormForSubject(["i"])).toBe("am");
    expect(beFormForSubject(["she"])).toBe("is");
    expect(beFormForSubject(["łucja"])).toBe("is");
    expect(beFormForSubject(["james"])).toBe("is");
    expect(beFormForSubject(["the", "dogs"])).toBe("are");
    expect(beFormForSubject(["the", "children"])).toBe("are");
    expect(beFormForSubject(["the", "mice"])).toBe("are");
    expect(beFormForSubject(["tom", "and", "ola"])).toBe("are");
    expect(beFormForSubject([])).toBeUndefined();
  });
  it("checkBePolarity: twierdzenie z przeczeniem i przeczenie bez not", () => {
    const errors: string[] = [];
    checkBePolarity("affirmative", true, undefined, "answer", errors);
    checkBePolarity("negative", false, undefined, "answer", errors);
    checkBePolarity("any", true, "yes", "answer", errors);
    expect(errors).toHaveLength(3);
  });
  ```
- [ ] **Step 2: Uruchom** — FAIL.
- [ ] **Step 3: Zaimplementuj** sygnatury z Interfaces.
- [ ] **Step 4: Uruchom** `be-agreement.test.ts` i cały katalog `english-grammar` — PASS (testy `to_be` bez zmian).
- [ ] **Step 5: Commit** „Gramatyka: biegunowość formy to be z mapy celów i forma dla podmiotu zdania”.

### Task 5: Katalog tematu i rejestracja

**Files:**
- Create: `G/topics/present-continuous.ts`
- Modify: `G/module.ts` (`topics: [presentSimpleV1, toBeV1, presentContinuousV1]`, komentarz modułu), `G/module.test.ts`

**Interfaces:**
- Produces: `export const presentContinuousV1: LessonTopic` — `id: "present_continuous"`, `version: 1`, `titlePl: "Present Continuous"`; cele w kolejności i z typami ze specu §3.1; karty ze specu §3.2 (szkic — można wygładzić, zachowując kontrprzykłady pisowni, „write → writing (jedno t!)”, „tie → tying”, parę jedzie/jeździ i kartę z `{{examples}}` w każdym celu); `extraErrorCategories` i przypisanie kategorii z §3.3 z podpowiedziami; przekształcenia `to_negative`, `to_question`, `to_affirmative` z tekstami jak w PS.
- `descriptionEn` celów 2 i 6 zawiera dosłownie zdania ze specu §7.3 (sprawdzany element = wybór czasu; `almost` z `errorCategory: null` dla błędu formy; `incorrect` z `continuous_for_habit`/`simple_for_now`/`be_plus_simple`); cel 2 dodatkowo: „The end-of-lesson story may mix present simple and present continuous.”

- [ ] **Step 1: Testy (czerwone)** w `module.test.ts`:
  - `TOPIC_CASES` dostaje wpis `present_continuous` z identyfikatorami `affirmative`, `now_or_usually`, `negative`, `questions`, `ing_spelling`, `now_or_usually_more` (prefiks `english_grammar.present_continuous.`) — pętla spójności obejmuje temat;
  - „rejestr udostępnia temat present_continuous@1” (wzorem testu `to_be@1`);
  - test „wersje tematów bez zmian” rozszerzony o `present_continuous: 1`, PS i to_be nadal 1;
  - `lesson_listen_choice` mają cele `affirmative`, `negative`, `questions`; nie mają `now_or_usually`, `ing_spelling`, `now_or_usually_more`;
  - cele 2 i 6 nie mają kategorii `missing_ending`, `wrong_auxiliary`, `extra_ending`; `descriptionEn` celów 2 i 6 zawiera `errorCategory: null`;
  - `validateSubject(englishGrammarSubject)` nadal `[]`.
- [ ] **Step 2: Uruchom** `module.test.ts` — FAIL.
- [ ] **Step 3: Zaimplementuj** katalog i rejestrację.
- [ ] **Step 4: Uruchom** cały katalog `english-grammar` i `packages/server/src/domain/lessons/catalog-validation.test.ts` — PASS.
- [ ] **Step 5: Commit** „Gramatyka: temat Present Continuous w katalogu (sześć celów)”.

### Task 6: Walidator PC — luka (cele 1, 3, 4, 5) i reguły wspólne

**Files:**
- Create: `G/present-continuous-validation.ts`, `G/present-continuous-validation.test.ts`
- Modify: `G/validators.ts` (gałąź `if (topic.id === "present_continuous") { errors.push(...validatePresentContinuousExercise(ex)); return errors; }` przed gałęziami `to_be` i ogólną luką, po `validateVisualPronoun`/`listenChoiceSibilantErrors`/regule promptu tłumaczenia)

**Interfaces:**
- Consumes: Task 1 (`ingFormOf`, `ingRuleOf`, `baseOfIngForm`, `isIngFormInTable`, `stateVerbIn`), Task 2 (`scanTimeMarkers`), Task 4 (`beFormForSubject`, `checkBePolarity`, `bePronounNearGap`, `expectedBeFormNearGap`).
- Produces:
  - `export function validatePresentContinuousExercise(ex: LessonExerciseDraft): string[]` (cel z ostatniego segmentu `ex.objectiveId`);
  - `export const PC_ALLOWED_ING_RULES: Readonly<Record<string, readonly IngRule[]>>` — klucz: cel; wartości ze specu §4;
  - `export function stripGapVerb(stem: string): { stem: string; verb?: string; negative: boolean }` — usuwa „(verb)” / „(not verb)” tuż po luce (wzorzec `/_{2,}\s*\(([^)]*)\)/`), zwraca czasownik i flagę „not”. Silnik ma własną kopię wzorca (Task 9), bo `domain/lessons` nie importuje przedmiotów.

Zakres tego zadania (spec §6.2, §5.1 zakazane, §5.3 forma -ing, `hint` pusty): oba kształty luki, forma be z podmiotem (podmiot = tokeny przed luką po `stripGapVerb`; dla luki na formę be na początku pytania — `bePronounNearGap`), biegunowość z mapy `{ affirmative: "affirmative", negative: "negative", questions: "any", ing_spelling: "affirmative" }`, nawias z „not” wymagany w celu 3 i zakazany w 1, 4, 5, forma -ing z tabeli i klasy z `PC_ALLOWED_ING_RULES`, ≤ 3 słowa (już pilnuje `pool-validation`; tu bez duplikacji), odpowiedź zaczynająca się apostrofem odrzucona, czasownik stanu w formie -ing odrzucony, wskaźniki zakazane we wszystkich polach skanowanych (§5.2) dla każdego typu.

- [ ] **Step 1: Testy (czerwone)** w `present-continuous-validation.test.ts` — helper `pcGap(objective, stem, answer, extra?)` jak `contextualGap` w `validators.test.ts`; testy przez `validateEnglishGrammarExercise(ex, presentContinuousV1)`:
  - poprawne: „He ___ (play) football now.” → „is playing”; „They ___ (play) now.” → „are playing”; „Łucja ___ (read) now.” → „is reading”; „The children ___ (play) now.” → „are playing”; „Tom and Ola ___ (jump) now.” → „are jumping”; „James ___ (read) now.” → „is reading”; „She ___ (not watch) TV now.” (cel 3) → „isn't watching” i „is not watching”; „___ she reading a book?” (cel 4) → „Is”; „Yes, she ___.” (bodziec z pytaniem, cel 4) → „is”; „He ___ (swim) now.” (cel 5) → „is swimming”;
  - odrzucone (z prefiksem): „He ___ (play) now.” → „are playing” (`pc-be:`); → „is play” (`pc-ing:`); `hint: "play"` (`pc-shape:`); „He ___ now.” → „is playing” bez nawiasu (`pc-shape:`); cel 1 „He ___ (swim) now.” → „is swimming” (klasa `double` w celu 1, `pc-ing:`); cel 5 „He ___ (play) now.” w luce (klasa `plain` w produktywnym celu 5, `pc-ing:`); cel 3 bez „not” w nawiasie (`pc-shape:`); cel 1 z „(not play)” (`pc-shape:`); odpowiedź „'m playing” (`pc-shape:`); „He ___ (play) tennis tomorrow.” (`pc-marker:`); „She ___ (like) it now.” → „is liking” (`pc-state:`); czasownik spoza tabeli „(photosynthesise)” (`pc-ing:`).
- [ ] **Step 2: Uruchom** — FAIL.
- [ ] **Step 3: Zaimplementuj** zakres z opisu zadania.
- [ ] **Step 4: Uruchom** plik testów i cały katalog `english-grammar` — PASS.
- [ ] **Step 5: Commit** „Gramatyka: walidacja luk Present Continuous”.

### Task 7: Walidator PC — całe zdania, error_fix, „wskaż słowo”, słuchanie

**Files:**
- Modify: `G/present-continuous-validation.ts`, `G/present-continuous-validation.test.ts`, `packages/server/src/domain/lessons/evaluate.test.ts`

**Interfaces:**
- Consumes: Task 6.
- Produces: `export function errorFixRegion(statement: string, answer: string): { readonly wrong: readonly string[]; readonly right: readonly string[] } | null` — po normalizacji z rozwinięciem skrótów (`englishNormalizer`) jeden spójny obszar różnicy tokenów (wspólny prefiks i sufiks); `null`, gdy brak różnicy. Dwa obszary rozdzielone wspólnym tokenem = jeden obszar obejmujący oba (prefiks/sufiks) — reguła „jeden obszar” sprawdza, że obszar ma ≤ 3 tokeny po obu stronach.

Zakres (spec §6.3, §6.5, §6.6, §5.3, §5.4): zgodność be z podmiotem w `answer`/`acceptedAnswers`/opcji poprawnej (`beFormForSubject`), po formie be forma -ing z tabeli i dozwolonej klasy, brak am/is/are + forma bez -ing w odpowiedzi poprawnej, zakaz he's/she's/it's/what's/that's/there's/where's w kluczach, pytajnik tylko „What + be + podmiot + doing?”, `error_fix` z klasyfikacją obszaru dla celu (1/3/4: brak be albo brak -ing albo forma bez -ing po be; 5: forma błędna spoza tabeli, poprawna w tabeli), tłumaczenia celów 1, 3, 4, 5 z wskaźnikiem „teraz” w `prompt` (`scanTimeMarkers(prompt, "pl").groups` zawiera tylko `now`), `lesson_notice` w celu 1 z dokładnie jednym tokenem `isIngFormInTable` równym `correctOption`, `lesson_listen_choice` z opcjami z par §6.6 (is/are, isn't/aren't, Is/Are).

- [ ] **Step 1: Testy (czerwone)**:
  - poprawne: `lesson_choice` cel 1 „Look! Mum ___ .” z opcjami „is cooking”/„are cooking”; `lesson_order` cel 4 „What is he doing?”; `lesson_short_answer` cel 4 „Yes, she is.”; `lesson_error_fix` cel 1 „He playing football now.” → „He is playing football now.”; cel 5 „He is swiming now.” → „He is swimming now.”; `lesson_open_answer` cel 1 prompt „Tata teraz gotuje.” → „Dad is cooking now.”; `lesson_notice` cel 1 z segmentami `[["Tom","is","playing","now."],["Good","morning!"]]`, `correctOption: "playing"` (Review Focus 5); `lesson_listen_choice` cel 3 „She ___ sleeping now.” z opcjami „isn't”/„aren't”;
  - odrzucone: klucz „He's running now.” (`pc-shape:`); klucz „What's he doing?” (`pc-shape:`); „Where is he going?” (`pc-shape:`); klucz „She is plays now.” (`pc-ing:`); klucz „They is playing now.” (`pc-be:`); `error_fix` „He is playing football now.” → „She is playing tennis now.” (obszar nie jest elementem celu, `pc-error-fix:`); tłumaczenie „Tata gotuje.” bez wskaźnika (`pc-marker:`); notice z dwiema formami -ing (`pc-notice:`); listen_choice z opcjami „He's”/„He” (`pc-shape:`); `lesson_choice` z kluczem „I am liking it.” (`pc-state:`).
  - `evaluate.test.ts` (Review Focus 1): przez `matchLessonAnswer` (`evaluate.ts:134`) z normalizatorem `englishNormalizer`: klucz „He is running now.” zalicza „He's running now.”, „he is running now”, „HE IS RUNNING NOW”; klucz „She isn't sleeping.” zalicza „She is not sleeping.”; klucz „Mum is cooking now.” nie zalicza deterministycznie „Mum's cooking now.” (komentarz: trafia do modelu oceniającego, spec §6.3).
- [ ] **Step 2: Uruchom** — FAIL (nowe reguły); testy `evaluate` mogą przejść od razu — to testy przypinające zachowanie, nie wymagają zmian w `evaluate.ts`.
- [ ] **Step 3: Zaimplementuj** zakres zadania.
- [ ] **Step 4: Uruchom** pliki testów i katalog `english-grammar` — PASS.
- [ ] **Step 5: Commit** „Gramatyka: walidacja zdań, poprawiania błędu i wskazania formy w Present Continuous”.

### Task 8: Walidator PC — cele porównania (2 i 6)

**Files:**
- Modify: `G/present-continuous-validation.ts`, `G/present-continuous-validation.test.ts`, `G/validators.ts` (eksport `presentSimpleForms` i `isAcceptablePresentSimpleAnswer` do użytku w pliku PC — tylko `export`, bez zmiany ciał)

**Interfaces:**
- Consumes: Tasks 2, 4, 6, 7; `presentSimpleForms(infinitive: string): Set<string>` z `validators.ts`.
- Produces: `export function presentSimpleFormFor(base: string, subjectTokens: readonly string[], negative: boolean): readonly string[]` — dopuszczalne formy PS dla osoby (3. os. l.p. → forma z -s / „doesn't X” / „does not X”; inne → forma podstawowa / „don't X” / „do not X”).

Zakres (spec §5.2, §5.3, §5.5, §6.2 cel 6): skanowane pola i pominięte pola z §5.2; co najmniej jeden wskaźnik i jedna grupa (z `scanTimeMarkers` na polach EN i PL); czas odpowiedzi zgodny z grupą (`now` → be + -ing; `usually` → forma z `presentSimpleFormFor`); czasowniki stanu w dowolnej formie odrzucone (`stateVerbIn(..., "any_form")`); wyjątek §5.5: `lesson_choice` z opcjami dokładnie „now” i „usually” (po normalizacji) — bodziec bez wskaźników, zdanie jednoznacznie PS albo PC, klucz zgodny; cel 6: luka tylko w przeczeniach (nawias z „not” wymagany), luka w pytaniu odrzucona; klasy -ing z `PC_ALLOWED_ING_RULES`.

- [ ] **Step 1: Testy (czerwone)**:
  - poprawne: cel 2 luka „Ola ___ (read) a comic every evening.” → „reads”; „Look! Ola ___ (read) a comic.” → „is reading”; `lesson_choice` z `instructionPl: "Cicho! Dziadek śpi."`, stem „Grandpa ___ in the armchair.”, opcje „sleeps”/„is sleeping” → „is sleeping”; wybór „now/usually” stem „Ola is reading a book.” → „now”, stem „Ola reads books.” → „usually”; cel 6 „She ___ (not watch) TV every morning.” → „doesn't watch”; „She ___ (not watch) TV now.” → „isn't watching”; cel 6 `lesson_choice` z opcjami „Do you play football on Saturdays?”/„Are you playing football on Saturdays?” → pierwsza; „She is having lunch now.” w celu 2 — przyjęte;
  - odrzucone: „Ola ___ (read) a comic.” bez wskaźnika (`pc-marker:`); „Look! Ola ___ (read) a comic every evening.” mieszane grupy (`pc-marker:`); „Look! Ola ___ (read).” → „reads” (`pc-marker:`); „He ___ (play) every day.” → „play” (niezgodność z osobą, `pc-be:`; niezgodność z grupą wskaźnika zawsze `pc-marker:`); wybór „now/usually” ze stemem „Ola is reading now.” (`pc-marker:`); klucz „usually” do stemu w PC (`pc-marker:`); cel 6 luka „___ you (play) tennis every Saturday?” (`pc-shape:`); „She likes apples every day.” w celu 2 (`pc-state:`); polecenie „Teraz czy zwykle? Ola ___.” (mieszane grupy, `pc-marker:`); cel 2 „Look! He ___ (swim).” → „is swimming” (klasa `double` w celu 2, `pc-ing:`). Przyjęte: cel 2 „He ___ (swim) every day.” → „swims” (forma PS nie zależy od klasy -ing).
- [ ] **Step 2: Uruchom** — FAIL.
- [ ] **Step 3: Zaimplementuj** zakres.
- [ ] **Step 4: Uruchom** pliki testów i katalog `english-grammar` — PASS.
- [ ] **Step 5: Commit** „Gramatyka: walidacja wyboru czasu teraz/zwykle w Present Continuous”.

### Task 9: Zdanie po odpowiedzi bez nawiasu przy luce

**Files:**
- Modify: `L/feedback-sentence-text.ts`, `L/feedback-sentence-text.test.ts`
- Test: `L/story.test.ts` (`solvedSentencesOf`, `storyCollisions` — `story.ts:51, 103`)

**Interfaces:**
- Produces: w `feedback-sentence-text.ts` prywatna funkcja `withoutGapVerb(stem: string): string` (`/(_{2,})\s*\([^)]*\)/` → `$1`), wołana tylko w gałęzi `lesson_gap` przed `fillGap`. Silnik nie importuje przedmiotu — `stripGapVerb` z Task 6 zostaje w przedmiocie (dwie definicje tego samego wzorca: celowo, kierunek zależności `domain/lessons` ← `subjects`; komentarz w obu miejscach odsyła do drugiego).

- [ ] **Step 1: Testy (czerwone)** w `feedback-sentence-text.test.ts`:
  ```ts
  it("luka z czasownikiem w nawiasie: zdanie bez nawiasu", () => {
    expect(feedbackSentenceText({ exerciseType: "lesson_gap", stem: "He ___ (play) football now.", answer: "is playing" })).toBe("He is playing football now.");
    expect(feedbackSentenceText({ exerciseType: "lesson_gap", stem: "She ___ (not watch) TV now.", answer: "isn't watching" })).toBe("She isn't watching TV now.");
  });
  it("nawias dalej w zdaniu i wybór bez zmian", () => {
    expect(feedbackSentenceText({ exerciseType: "lesson_gap", stem: "Put ___ here (word).", answer: "it" })).toBe("Put it here (word).");
    expect(feedbackSentenceText({ exerciseType: "lesson_choice", stem: "Ola ___ (read).", options: [{ id: "a", text: "is reading" }], correctOption: "a" })).toBe("Ola is reading (read).");
  });
  ```
  oraz w `story.test.ts` test bariery historyjki: `storyCollisions` dla luki „He ___ (play) football now.” / „is playing” wykrywa zdanie historyjki „He is playing football now.” jako kolizję (Review Focus 2). Pola `FeedbackSentenceSource` uzupełnij zgodnie z typem.
- [ ] **Step 2: Uruchom** `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/feedback-sentence-text.test.ts packages/server/src/domain/lessons/story.test.ts` — FAIL.
- [ ] **Step 3: Zaimplementuj** `withoutGapVerb`.
- [ ] **Step 4: Uruchom** testy z Step 2 i `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons` — PASS.
- [ ] **Step 5: Commit** „Lekcje: zdanie po odpowiedzi luki bez czasownika w nawiasie”.

### Task 10: Prompty

**Files:**
- Modify: `G/prompts.ts`, `G/module.test.ts`
- Create: `G/__snapshots__/module.test.ts.snap` (migawka Vitest `toMatchSnapshot`; repo używa migawek w `providers/tts-style-profile.test.ts`)
- Test: `packages/server/src/domain/lessons/agent/solver.test.ts`, test promptu historyjki w pliku, który dziś sprawdza opisy celów w prompcie historyjki (`git grep -ln "storyRules\|lessonStoryPrompt" packages/server/src -- "*.test.ts"`)

**Interfaces:**
- Consumes: `TIME_MARKER_LISTS` (Task 2), `ingVerbsByRule` (Task 1).
- Produces: `englishGrammarPrompts.fieldRules` z blokiem `.present_continuous.` (spec §7.2) i zawężonymi regułami PS (§7.1); funkcja pomocnicza `presentContinuousFieldRules(): string` w `prompts.ts` (szablon z list).

- [ ] **Step 1: Migawka przed zmianą.** Dodaj test `it("fieldRules — migawka", () => expect(englishGrammarPrompts.fieldRules).toMatchSnapshot())`, uruchom (zapisuje migawkę obecnego tekstu) i zacommituj osobno „Testy: migawka reguł promptu gramatyki”. Dzięki temu diff migawki w commicie z Step 6 pokazuje dokładnie zmianę promptu.
- [ ] **Step 2: Testy (czerwone)** w `module.test.ts`:
  - zdania o luce PS i operatorze zaczynają się od „For objectives whose id contains '.present_simple.'” (regex na fragment z „present simple form of that base verb”);
  - blok PC zawiera: „'.present_continuous.'”, „hint null”, „Look!”, „every day”, „tomorrow”, „play”, „swim”, „What + am/is/are”;
  - przykłady z bloku PC (wypisane w teście jako szkice: luka cel 1, wybór cel 2 ze scenką, wybór „now/usually”) przechodzą `validateLessonExercise` przedmiotu (wzorem istniejącego testu kontraktu prompt↔walidator);
  - `solver.test.ts`: `solverView` dla wyboru celu 2 z `instructionPl: "Cicho! Dziadek śpi."` i stemem z nawiasem zawiera oba teksty;
  - prompt historyjki z celem `now_or_usually` zawiera „may mix present simple and present continuous”.
- [ ] **Step 3: Uruchom** — FAIL.
- [ ] **Step 4: Zaimplementuj** zmiany promptu; zaktualizuj migawkę (`-u` albo ręcznie) i przejrzyj diff: bloki PS i `to_be` różnią się tylko zawężeniem (Review Focus 3).
- [ ] **Step 5: Uruchom** katalog `english-grammar`, `agent/solver.test.ts`, test promptu historyjki, `packages/server/src/providers/openai/llm.test.ts` — PASS.
- [ ] **Step 6: Commit** „Gramatyka: prompty Present Continuous i zawężenie reguł Present Simple”.

### Task 11: Dokumentacja

**Files:**
- Modify: `docs/SPEC.md` (oba miejsca z listą tematów w części o lekcjach, ok. l. 779 i 784; rekomendacja wyboru celów ze specu §3.1), `docs/folder-structure.md` (nowe pliki: `english/ing-forms.ts`, `english-grammar/time-markers.ts`, `be-agreement.ts`, `present-continuous-validation.ts`, `topics/present-continuous.ts`), `.kiro/specs/grammar-module/requirements.md` i `design.md` (tylko jeśli wymieniają tematy — `git grep -n "to be\|to_be" .kiro/specs/grammar-module`).

- [ ] **Step 1: Edytuj** dokumenty; teksty po polsku, bez obietnic v2 poza odnośnikiem do #280.
- [ ] **Step 2: Sprawdź** `git grep -n "Present Simple oraz czasownik" docs` — brak starego brzmienia listy tematów.
- [ ] **Step 3: Commit** „Dokumentacja: temat Present Continuous”.

### Task 12: Kontrola po części domenowej

- [ ] **Step 1: Uruchom** `pnpm check` — PASS (typecheck, unit, build).
- [ ] **Step 2: Uruchom** `pnpm test:integration tests/integration/lesson-generation.test.ts tests/integration/lesson-agent-generation.test.ts tests/integration/lesson-sentence-audio.test.ts tests/integration/lesson-story.test.ts` — PASS (regresja: PS/to_be, zdanie po odpowiedzi, historyjka).
- [ ] **Step 3: Sprawdź stan PR 2 etapu 3:** `git fetch origin main && git log --oneline origin/main | grep -m1 "etap 3.*PR 2\|jedynym generatorem"`. Scalony → Task 13A; nie → Task 13B.

### Task 13A: Test integracyjny na ścieżce agenta (po PR 2)

**Files:**
- Create: `tests/integration/lesson-present-continuous.test.ts`
- Modify: `tests/integration-buckets.ts` (nowy plik do najlżejszego kosza; pilnuje `integration-buckets.test.ts`)

- [ ] **Step 1: Rebase** `git rebase origin/main`; rozwiąż konflikty w dokumentacji; `pnpm check` — PASS.
- [ ] **Step 2: Test (czerwony):** lekcja `present_continuous` z celami `affirmative` i `now_or_usually`; fake-agent ze skryptowanymi krokami (API z `providers/fake-lesson-agent.ts` po PR 2) z ręcznie napisanymi ćwiczeniami spełniającymi minima publikacji obu celów i walidator PC; przebieg: generowanie → szkic (wszystkie ćwiczenia przyjęte, zero odrzuceń) → publikacja → sesja dziecka; asercje: karty celu 1 przed ćwiczeniami, ćwiczenie celu 2 wydane w sesji, zdanie po odpowiedzi luki (`feedbackSentenceText` w DTO feedbacku albo rekord nagrania) to „… is playing football now.” bez „(play)”.
- [ ] **Step 3: Uruchom** `pnpm test:integration tests/integration/lesson-present-continuous.test.ts` — przy brakach w fixture'ach FAIL z komunikatem walidatora; popraw fixture'y, nie walidator, chyba że komunikat wskazuje błąd reguły.
- [ ] **Step 4: Uruchom** ponownie — PASS; `pnpm exec vitest run --config vitest.unit.config.ts tests/integration-buckets.test.ts` — PASS.
- [ ] **Step 5: Commit** „Testy: lekcja Present Continuous od generowania do sesji dziecka”.

### Task 13B: Test integracyjny na obecnej ścieżce (PR 2 nie scalony)

Jak Task 13A bez Step 1, z różnicą: fake-agent ze skryptem z obecnego `fake-lesson-agent.ts`, a w teście `UMIEM_LESSON_AGENT_SUBJECTS=english_grammar` (albo odpowiednik fabryki testowej, jak w `tests/integration/lesson-agent-generation.test.ts`). Po scaleniu PR 2: rebase, dostosuj test do API po PR 2, `pnpm check` i ten plik — PASS, osobny commit „Testy: lekcja Present Continuous na agencie po etapie 3”.

### Task 14: Sonda na prawdziwym modelu (bramka zgody)

**Files:**
- Create: `tests/probes/fixtures/present-continuous-objectives.json` (zrzut zagadnień w kształcie `ObjectivesDump`: `subjectId: "english_grammar"`, `topicId: "present_continuous"`, `topicTitle`, `material` — fikcyjny fragment słownictwa podręcznika A1 z czasownikami czynności, `objectives` sześciu celów z kartami), `tests/probes/present-continuous-stats.ts`, `tests/probes/present-continuous-stats.test.ts`
- Modify: `tests/probes/agent-generation.probe.test.ts` (po przebiegu, gdy `topic.id === "present_continuous"`, drukuje wynik `pcPoolStats`)

**Interfaces:**
- Produces: `export function pcPoolStats(pool: readonly LessonExerciseDraft[], rejections: readonly string[]): { readonly sceneShare: number; readonly comparisonCount: number; readonly rejectionsByPrefix: Readonly<Record<string, number>> }` — `sceneShare` = udział ćwiczeń celów 2 i 6 (bez kart), których `instructionPl`/`prompt` ma grupę z `scanTimeMarkers(..., "pl")`; `rejectionsByPrefix` liczy komunikaty po prefiksach z Global Constraints (inne → `other`). Źródło `rejections`: pole wyniku agenta z komunikatami odrzuceń (sprawdź `LessonPoolAgentResult`; jeśli są tylko kody, licz po kodach i zaznacz to w raporcie).

- [ ] **Step 1: Test (czerwony)** `present-continuous-stats.test.ts`: pula z 2 ćwiczeniami celu 2 (jedno ze scenką „Cicho!…”, jedno z „every day”) i kartą → `sceneShare === 0.5`, `comparisonCount === 2`; odrzucenia `["pc-marker: …", "pc-ing: …", "x"]` → `{ "pc-marker:": 1, "pc-ing:": 1, other: 1 }`.
- [ ] **Step 2: Uruchom** `pnpm exec vitest run --config vitest.unit.config.ts tests/probes/present-continuous-stats.test.ts` — FAIL; zaimplementuj; PASS. Fixture JSON przechodzi `readObjectivesDump` (test w tym samym pliku: wczytaj i sprawdź kształt).
- [ ] **Step 3: Commit** „Sonda: statystyki puli Present Continuous i zrzut zagadnień”.
- [ ] **Step 4: Bramka zgody.** Napisz właścicielowi jedną wiadomość: polecenie (poniżej), model generatora i checkera, limit 2 USD, szacunek kosztu z `probe-costs` (budżet runu × 2 przebiegi), kryteria akceptacji ze specu §11.3. Czekaj na wyraźne „tak”.
- [ ] **Step 5: Przebieg PC** (po zgodzie), zrzuty poza repo (scratchpad):
  ```bash
  cp tests/probes/fixtures/present-continuous-objectives.json "$SCRATCH/pc-objectives.json"
  UMIEM_PROBE_AGENT_SUBJECT=grammar UMIEM_PROBE_AGENT_OBJECTIVES_DUMP="$SCRATCH/pc-objectives.json" UMIEM_PROBE_AGENT_DUMP="$SCRATCH/pc-pool.json" UMIEM_PROBE_COSTS="$SCRATCH/costs.json" UMIEM_PROBE_COSTS_INIT=1 UMIEM_PROBE_COSTS_CAP_USD=2 pnpm probe:agent
  ```
  oraz przebieg regresyjny PS z tym samym rejestrem (`UMIEM_PROBE_COSTS_INIT` pominięte) na zrzucie zagadnień PS z wcześniejszej sondy (właściciel wskazuje plik; brak pliku → zrzut PS zbudowany z katalogu i materiału fixture, porównanie tylko z wynikiem tego przebiegu sprzed zmiany promptu jest wtedy niemożliwe — zgłoś to właścicielowi zamiast liczyć różnicę).
- [ ] **Step 6: Ocena** wg specu §11.3: minima publikacji, odrzucenia celów 2 i 6 ≤ 40%, `sceneShare` ≥ 0,3, ślepa ocena próbki (`tests/probes/blind`: `gen-blind-sheet.cjs`, rubryka) — zero dwuznacznych; regresja PS ≤ +10 pp. Raport dla właściciela.
- [ ] **Step 7: Strojenie (opcjonalne, najwyżej 2 rundy, każda za nową zgodą):** zmiana tylko w `G/prompts.ts` (i migawce), testy Task 10 — PASS, commit „Gramatyka: strojenie promptu Present Continuous po sondzie”, ponowny przebieg.

### Task 15: Weryfikacja całości, przegląd i PR

- [ ] **Step 1: Uruchom** `pnpm check` — PASS; `pnpm test:integration:shards` — PASS; `pnpm test:e2e:shards` — PASS (683 testy jak w AGENTS.md albo aktualna liczba z `origin/main`).
- [ ] **Step 2: Przegląd trzema niezależnymi krytykami** całej gałęzi (`git diff origin/main...HEAD`): (a) poprawność walidatora i zgodność ze specem, (b) dydaktyka kart, podpowiedzi i promptu, (c) regresje i testy. Poprawki → commity, ponowny `pnpm check`.
- [ ] **Step 3: Push** `git push -u origin feature/present-continuous`; PR po polsku z sekcjami: zmiany, reguły i ich miejsce, wynik sondy, API → MCP → skill (bez zmian — lekcje poza MCP i `learning-overview`), wykonane sprawdzenia, rekomendacja wyboru celów, #279, #280. Zakończenie: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 4:** Scalenie wyłącznie przez właściciela, po zaakceptowanej sondzie.
