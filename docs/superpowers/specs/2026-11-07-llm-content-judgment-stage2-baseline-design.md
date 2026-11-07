# Etap 2: przebieg bazowy generowania i sonda gramatyki — design

Wersja 3, 2026-11-07, po przeglądzie trzech krytyków (prostota, poprawność kodu i danych, rzetelność pomiaru) i review Muse. Issue #359, epik #358. Spec zbiorczy: `2026-11-07-llm-content-judgment-design.md` (v4, §4, §5, §8, §10, §11, §12, §17). Stan kodu: `main` 894a9c2c — warunek płatnych biegów spełniony: scalone PR #365 (#328) i #366 (#360). Migracja `0040` jest w `main`; ten etap nie dodaje migracji.

## 1. Cel i granice

Napisać raz, w kodzie aplikacji, przebieg bazowy z §4–§5 specu zbiorczego dla typów gramatyki i zmierzyć go sondą wobec dzisiejszego agenta. Wynik sondy to **bramka po etapie 2**: właściciel decyduje, czy etap 4 przenosi gramatykę na przebieg bazowy.

W zakresie: kontrola zadań zamkniętych (domena), przebieg bazowy (moduł `materials/lessons`, bez workera), dwie metody adaptera AI SDK, sonda trzech wariantów, ćwiczenia wzorcowe, nowa rubryka ślepej oceny, automatyczny sędzia, raport w PR, poprawki specu zbiorczego (§11).

Poza zakresem: podłączenie do workera, panel, usuwanie heurystyk (etap 4), typy match/group/cloze/keywords, rozdział i szkoła (etap 5), ocena odpowiedzi (etap 3), warstwy z §8 specu zbiorczego bez przekroczonego progu. Bez rundy naprawy. **Brak migracji** (PR #366 dodaje `0040`; ten etap nie dodaje żadnej).

## 2. Kontrola zadań zamkniętych (domena)

Nowy plik `packages/server/src/domain/lessons/closed-check.ts` z testami; czyste funkcje, bez modelu.

**Kontrakt z typu ćwiczenia:**

| Typ | Kontrakt |
|---|---|
| `lesson_choice`, `lesson_listen_choice`, `lesson_short_answer`, `lesson_notice` | wybór |
| `lesson_order` | rozsypanka |
| gap, error_fix, transform, open_answer | brak (bez kontroli generowania) |

**Wejście modelu** (`closedCheckItem(draft, topic)`): widok dziecka `solverView` (`domain/lessons/agent/solver.ts`; opcje posortowane, bez klucza, podpowiedzi i wyjaśnienia), ale bez tytułu celu, który `solverView` wstawia przy braku `instructionPl` (§5 specu zbiorczego: bez opisu celu) — `closedCheckItem` podaje `solverView` kopię tematu z pustymi `titlePl` celów, a puste wiersze widok już pomija. Dodatki:

- `lesson_listen_choice`: `Recording (transcript): <zdanie>` z `feedbackSentenceText` (zdanie nagrania = luka wypełniona kluczem, jak w produkcji). Walidacja struktury wymaga, żeby to zdanie istniało (`validateListenChoice`); gdyby mimo to było `null`, ćwiczenie odpada jako `check_unknown`;
- `lesson_order`: `Arranged answer: <answer>`.

**Pytanie i schemat wyniku (Zod, w domenie):**

- wybór: „podaj teksty WSZYSTKICH opcji poprawnych dla tego polecenia”; w słuchaniu poprawna opcja to ta, która daje poprawne zdanie zgodne z nagraniem. Wynik `{ "answers": string[] | null }`: lista pusta = żadna, `null` = nie wiem;
- rozsypanka: „czy ułożona odpowiedź jest poprawną odpowiedzią na polecenie”. Wynik `{ "verdict": "yes" | "no" | "unknown" }`.

Zły kształt albo brak wyniku dla pozycji = nie wiem.

**Porównanie kodem** (`closedCheckPasses(draft, result, normalizer)`; `normalizer` = normalizator przedmiotu):

- wybór: każdy tekst modelu jest przypisany do opcji (w `lesson_notice` — segmentu), której tekst jest mu równoważny (`answersEquivalent` z normalizatorem przedmiotu — ta sama równoważność, którą struktura odrzuca opcje-duplikaty, a materializacja Kid wybiera segment `lesson_notice`, `lesson-materialize.ts:255`; zgodne z wyjątkiem §10 specu zbiorczego dla duplikatów między opcjami). Przechodzi tylko wtedy, gdy przypisane opcje to dokładnie opcja klucza (tekst bez opcji psuje równość). W `lesson_notice` dodatkowo słowo klucza musi być równoważne dokładnie jednemu segmentowi ćwiczenia (Kid ocenia po pierwszym pasującym segmencie, więc drugie wystąpienie dałoby „źle”; reguła struktury z §4 pkt 2 specu zbiorczego);
- rozsypanka: przechodzi tylko `yes`.

Każdy inny wynik usuwa ćwiczenie. Kody do statystyk: `check_wrong_set` (także „żadna”), `check_unknown` (także brak wyniku), `check_order_no`.

## 3. Przebieg bazowy

Nowy plik `packages/server/src/modules/materials/lessons/lesson-baseline-pool.ts`: `runLessonBaselinePool(deps, input: LessonPoolAgentRunInput, signal): Promise<LessonPoolAgentResult>` — te same typy wejścia i wyniku co `runLessonPoolAgent`, więc etap 4 podłącza go w workerze i sondzie bez adaptera wyniku. Teraz obsługuje źródło `catalog` i tryb `pool` z pustym `fixed`; inne wejście rzuca `AppError("validation")`. Haki `onObjectivesResolved` / `onObjectiveSettled` są wołane jak u agenta. Pola statystyk agenta, których przebieg nie ma (np. oczyszczenia), są zerowe. Polityka (`concurrency`, `callTimeoutMs`, `checkerTimeoutMs`, `runBudgetUsd`, `runTimeoutMs`, `unknownCallEstimateUsd`) przychodzi w `deps.policy` jak u agenta (`LessonAgentPolicy`, domyślnie `DEFAULT_LESSON_AGENT_POLICY`).

### 3.1 Paczki i liczby (domena)

Liczby wynikają z tego samego `poolSize` co u agenta, więc wybór rodzica (pula 20–120) zachowuje znaczenie, a obie ścieżki dają lekcje tej samej wielkości.

Nowy plik `domain/lessons/packet-plan.ts`: `packetPlan(subject, objective, targetCount, listenAllowance)` → paczki `{ type, count }` i cele etapów `{ guided, productive, independent }` (`targetCount` z `objectiveBatchCounts(poolSize, …)`, `listenAllowance` z `listenChoiceAllowance` — liczy je moduł, bo domena nie importuje modułów; wołający jak w `lessonAgentLimits`):

- **cel etapu** `S_s` = większe z: udziału etapu w `poolStageCounts(subject, objective.exerciseTypes, targetCount)` (podział agenta) i minimum `lessonPoolMinimums(subject)[s]` (dla independent `+ agentPolicy.independentReserve`, jak status agenta);
- `S_s` po równo między typy etapu dozwolone dla celu (kolejność katalogu), reszta do wcześniejszych; `lesson_listen_choice` poza podziałem;
- **zapas paczki**: nowa stała `PACKET_RESERVE = 2` w `packet-plan.ts`, dodana do każdej paczki etapu ocenianego. To nie jest `agentPolicy.slack` (u agenta zapas zagadnienia, pokrywany rundami naprawy, których tu nie ma); zapas paczki jest jednym z trzech pokręteł strojenia (§8);
- `lesson_notice` (intro, poza minimum): 2, bez zapasu;
- `lesson_listen_choice`: `listenAllowance` (2), bez zapasu;
- przykłady kart (1–3) zwraca pierwsza paczka celu.

**Przycięcie** (krok 5 w §3.2): po kontrolach i walidacji puli zostaje w każdym etapie zagadnienia najwyżej `S_s` ćwiczeń (pierwsze w kolejności lekcji), słuchania najwyżej `listenAllowance`, notice najwyżej 2. Usunięcie nadmiaru nie tworzy ujawnień ani duplikatów.

Przykład PS, 7 celów, domyślna pula (`defaultPoolSize(7)` = 84 → 12 na cel; podział agenta np. 4 / 6 / 2 → cele 4 / 6 / 3). `affirmative_base` (notice, choice, listen, gap, open_answer): notice 2, choice 4+2, listen 2, gap 6+2, open_answer 3+2 — 23 zamówione, najwyżej 17 przyjętych (agent: `maxExercises` = 12 + 2 + 2 = 16). Wszystkie 18 celów trzech tematów ma dozwolony typ w każdym etapie ocenianym (sprawdzone).

### 3.2 Kroki

Zagadnienia najwyżej `concurrency` naraz, paczki zagadnienia równolegle:

1. **Generowanie paczki** — `generatePacket` (§4). Zdania do unikania: `avoidSentencesFor` ze stanu na starcie runu (zdania kart, #328; w sondzie szkic pusty).
2. **Walidacja struktury** — kroki `parseRecord` agenta (`lesson-pool-agent-tools.ts:311`): `materializeRawExercise` → `rawShapeIssues` → `toExerciseDraft` (zdejmuje `null` ze schematu strict) → `foreignObjectiveIssues` → `sanitizeFreshLessonDraft` (usuwa złe wyjaśnienie, pola niedozwolone w słuchaniu, zbędne warianty) → `stripParentAddedFlags`; wspólna funkcja wydzielona z `parseRecord` zamiast kopii. Potem, jak przy przyjmowaniu agenta, `validateLessonExerciseIssues(draft, subject, topic, { agent: true })`. Ćwiczenie innego typu niż paczka odpada; nadmiar ponad zamówienie odpada od końca.
3. **Kontrola zamkniętych** — jedno `checkClosed` na paczkę typu zamkniętego z ocalałymi ćwiczeniami (§2). Paczki tekstowe bez kontroli.
4. **Walidacja puli** — raz, po wszystkich zagadnieniach, istniejącym kodem agenta: stan `createLessonAgentState` (temat, zagadnienia, `fixedSources: cardExposureSources`) z ocalałymi ćwiczeniami w kolejności paczek (`withPool`); przykłady kart przez `submitExamples` (walidacja linii: napis, przycięcie, ≤ `MAX_TEXT_LENGTH`, bez powtórzeń, najwyżej 3; linia, która ujawnia odpowiedź ćwiczenia, odpada — ćwiczenie zostaje); potem `lessonInvariantCheck` + `removeExercise` (duplikaty `validatePool`, słuchanie ujawniające odpowiedź, ujawnienia w trybie `generation` w kolejności `orderedEntries`). Wynik nie zależy od kolejności zakończenia wywołań.
5. **Przycięcie** do celów etapów (§3.1).
6. **Status** z `objectiveStatus` na tym stanie (minima z rezerwą, przykłady 1–3; limity z `targetCount: 0`, bo pula nie ma celu liczbowego): `complete` / `incomplete`; `failed` przy porażce wywołania. Bramka publikacji (§9) liczy `poolCoverage` z `lessonPoolMinimums` (bez rezerwy).

**Niepowodzenie** (§4 specu zbiorczego): jedno ponowienie w jednym miejscu — w przebiegu, tylko gdy `agentFailureOf(error).retryable`. Adapter ustawia limit żądania bez własnego ponowienia (`canRetry: () => false`). Drugie niepowodzenie → zagadnienie `failed` z kodem `agentFailureOf`, jego ćwiczenia nie trafiają do wyniku. Ćwiczenie bez kontroli nigdy nie przechodzi. Budżet runu (`RunCostMeter`) wyczerpany → nowe wywołania nie startują (zagadnienie `incomplete`). Termin runu i anulowanie jak u agenta (`deadlineSignal`). Limity żądania: generowanie `callTimeoutMs`, kontrola `checkerTimeoutMs`.

**Dzienniki** `[lesson-baseline]`: liczby, kody, typy i człony identyfikatorów zagadnień; bez treści.

### 3.3 Porty

`ports/ai.ts` dostaje dwa małe porty (istniejące porty i fake'i agenta bez zmian):

- `LessonPacketGenerator.generatePacket(input, cost, signal)` → `{ exercises: unknown[]; examples?: unknown[] }`;
- `ClosedExerciseChecker.checkClosed({ contract, items: { view }[] }, cost, signal)` → wynik per pozycja (`unknown`, parsowany schematem z domeny).

## 4. Adapter i prompt paczki

W `providers/openai/lesson-pool-agent.ts` (jedyne miejsce `ai`): `AiSdkLessonPoolAgent.generatePacket` i `AiSdkExerciseChecker.checkClosed` — `generateText` z `Output.object` (`jsonSchema`, bez walidacji SDK), `maxRetries: 0`, `tracked` z nowymi operacjami `packet_generate` i `check_closed` (rozszerzenie `AgentOperation`; kolumna `operation` jest tekstowa, bez migracji).

**Prompt paczki** (po angielsku), nowy i krótki:

- rola przedmiotu (`prompts.generationRole`), odbiorca (stały jak dziś, #279), `prompts.fieldRules` (np. polskie zdanie w `lesson_open_answer`, forma podstawowa w `hint`) i `interestsRule`, gdy są tematy zdań (bez niej `lessonUserMaterial` pomija ich blok);
- cel: tytuł, `descriptionEn` z katalogu, karty;
- z księgi reguł (`lessonRuleBook` z `exerciseTypes: [type]`): blok typu (format i przykład) i sekcja `general` (reguły struktury), bez sekcji `lesson` i `checks` (opisują limity, ujawnienia i kontrole agenta); `transforms` tematu dla `lesson_transform`; `explanationPl` jak dziś;
- liczba ćwiczeń; w pierwszej paczce celu także 1–3 przykłady kart;
- wymagania: polecenie i kontekst jednoznacznie wyznaczają odpowiedź; formy ze skrótem jako osobne warianty; zdania różne;
- wiadomość użytkownika: `lessonUserMaterial` (materiał, polecenie, tematy zdań, zdania do unikania) bez zmian.

Schemat wyniku: gałąź `exercises` z `lessonPoolJsonSchema` zawężona do typu paczki, plus `examples` w pierwszej paczce.

**Prompt kontroli**: `CHECKER_DATA_RULE`, pytanie kontraktu (§2), pozycje w `<ITEMS>` (`jsonForBlock`).

Migawki promptów (`__snapshots__/lesson-packet-prompt.*.txt`, PC) dają liczbę znaków do raportu.

## 5. Sonda: trzy warianty

Jedna sonda `tests/probes/agent-generation.probe.test.ts`, nowa zmienna `UMIEM_PROBE_AGENT_VARIANT`:

- `agent` — dzisiejszy agent, rejestr produkcyjny;
- `agent_plain` — agent na module gramatyki bez heurystyk językowych;
- `baseline` — przebieg bazowy na tym samym module bez heurystyk (przybliżenie stanu po etapie 4).

**Moduł bez heurystyk** (wyłącznie w sondzie, `tests/probes/grammar-plain-subject.ts`), dokładna konstrukcja:

- `{ ...englishGrammarSubject, validateExercise: () => [], rules: GUIDANCE_RULES }`, w rejestrze sondy z samym tym modułem (`createSubjectRegistry([…])`);
- usuwane: cały `validateExercise` (`validators.ts`: Present Simple, „to be”, Present Continuous, zaimek obrazka, słyszalność `listen-audibility`, tłumaczenie równe odpowiedzi) i wszystkie opisy reguł `GRAMMAR_RULES` (w tym wspólne `ENGLISH_RULES`);
- `GUIDANCE_RULES`: wskazówki dydaktyczne, których kod nie sprawdza, są doklejone do opisów reguł sprawdzanych (np. `rules.ts:81`). Dla każdego wpisu `GRAMMAR_RULES`, którego opis zawiera jedną z siedmiu stałych — `PC_GUIDANCE`, `PC_FORMS_TRANSLATION_GUIDANCE`, `PC_TENSE_CHOICE_GUIDANCE`, `PC_NOW_OR_USUALLY_GUIDANCE`, `PC_NOW_OR_USUALLY_MORE_GUIDANCE` (`present-continuous-guidance.ts`), `TO_BE_GUIDANCE`, `PICTURE_CHOICE_GUIDANCE` (`rules.ts`) — powstaje wpis o tym samym id i tych samych polach (`field`, `kind`, `types`, `when`, `priority`), którego opis to wyłącznie te stałe. Wskazówka trafia więc do promptu w tym samym miejscu i przy tych samych zagadnieniach co dziś. Pozostałe wpisy odpadają (np. listy wskaźników `PC_NOW_MARKERS`, które opisują sprawdzenie). Jedyna zmiana produkcyjna: `export` dwóch stałych w `rules.ts`, bez zmiany zachowania;
- zostają reguły rdzenia, normalizator, `prompts` (rola, `fieldRules`), karty i przykłady typów (`typeExamples`), `ruleNotes`.

Gramatyka nie ma `refineGeneratedPool`, `validatePoolExtra`, `exerciseGate` ani `sanitize`. Rejestr przyjmuje taki moduł (sprawdzone dla `rules: {}`; test pomocnika sprawdzi wersję ze wskazówkami). Po synchronizacji z `main` (894a9c2c) implementacja sprawdzi listę jeszcze raz. **PR pokazuje diff promptów agenta `agent` vs `agent_plain`** dla każdego zagadnienia trzech tematów (wygenerowany testem bez wywołań modelu, liczby znaków i różnica tekstu), żeby było widać, że różnią się tylko opisami sprawdzanych reguł.

Sonda nie ma własnych reguł: woła `runLessonPoolAgent` albo `runLessonBaselinePool`, potem tę samą kontrolę końcową co dziś. `graderAvailable` wymuszone na `true` we wszystkich wariantach i zapisane w zrzucie (od etapu 3 generowanie wymaga gradera). Zrzut w formacie `gen-blind-sheet.cjs` (+ statystyki, koszty, statusy, liczby per typ). Rejestr kosztów `UMIEM_PROBE_COSTS` jak dziś.

**Materiały** (fikcyjne, w repo): `present-simple-objectives.json`, `present-continuous-objectives.json` oraz nowe `to-be-objectives.json` (wszystkie zagadnienia tematu).

## 6. Ćwiczenia wzorcowe dla kontroli zamkniętych

Plik `tests/probes/fixtures/closed-check-gold.json` (fikcyjny) i sonda `tests/probes/closed-check-gold.probe.test.ts`: walidacja struktury (§3.2 krok 2), potem `checkClosed` + `closedCheckPasses`, bez generatora. Etykiety nadaje autor według polityki niżej; zatwierdzenie specu zatwierdza politykę (właściciel nie ocenia wierszy).

| Klasa | Liczba | Jak powstaje | Oczekiwany wynik |
|---|---|---|---|
| poprawne, wybór | 12 (po 3: choice, listen_choice, short_answer, notice) | ręcznie | przechodzi |
| poprawne, rozsypanka | 10, w tym 3 z przestawialnym „now” / „every day” | ręcznie | przechodzi |
| błędny klucz, wybór | 12 | mechanicznie z poprawnych: choice i short_answer — `correctOption` i `answer` na pierwszą opcję o innym tekście; listen_choice — to samo, a transkrypcja liczona od nowa z nowego klucza (nagranie mówi wybraną opcję); notice — `correctOption` na inny segment tego zdania. W słuchaniu autor potwierdza, że zdanie nagrania po zamianie jest błędne (gramatycznie albo znaczeniowo) — inaczej ćwiczenie jest spójne i nie należy do klasy | odpada |
| błędny klucz, rozsypanka | 10 | mechanicznie: zamiana dwóch sąsiednich klocków w `items` i `answer` razem; autor potwierdza, że wynik jest błędny dla polecenia | odpada |
| druga poprawna odpowiedź | 12 (po 4: choice, short_answer, notice) | ręcznie: dwie opcje / dwa słowa poprawne | odpada |

Słuchanie nie ma klasy „druga poprawna”: równoważne opcje odrzuca struktura (`listen.options_equivalent`), a dwie poprawne formy, z których tylko jedna jest w nagraniu, nie są wadą. Opcje nie do odróżnienia ze słuchu mierzy tylko rubryka (W8); po usunięciu `listenChoiceSibilantErrors` nie sprawdza ich kod.

Trzy powtórzenia całego zestawu (grosze). Progi: błędny klucz wykryty w 100% każdego powtórzenia; druga poprawna wykryta w ≥ 80% i poprawne odrzucone w ≤ 10% — oba łącznie z trzech powtórzeń. Raport zaznacza, że w wyborze błędny klucz to te same wejścia co poprawne (model nie widzi klucza), więc 100% nie świadczy o wykrywaniu subtelnych błędnych kluczy. Niespełniony próg = zmiana promptu kontroli, liczona jako runda strojenia (§8). Ćwiczenia wzorcowe służą i strojeniu promptu kontroli, i bramce — raport to nazywa.

## 7. Rubryka ślepej oceny

Nowy plik `tests/probes/blind/rubric-stage2.md`. Wiersz: `verdict` (`ok`/`defect`), `criterion` (klasy rozdzielone `|`), `adjudicatorNote`. Wada musi być wykazywalna; „mogłoby być lepiej” = `ok`.

| Klasa | Opis | Mianownik |
|---|---|---|
| W1 | błędny klucz w zadaniu zamkniętym (rozsypanka: klucz nie jest poprawną odpowiedzią na polecenie) | zamknięte |
| W2 | błędny klucz albo błędny wariant w zadaniu tekstowym | tekstowe |
| W3 | druga poprawna opcja albo słowo (inny poprawny szyk rozsypanki NIE jest wadą) | choice, short_answer, notice |
| W4 | dwuznaczne zadanie tekstowe: polecenie i kontekst pozwalają poprawnie odpowiedzieć bez ćwiczonej formy | tekstowe |
| W5 | poza zakresem celu | wszystkie |
| W6 | zdradzona odpowiedź w bodźcu, podpowiedzi, karcie albo przykładzie karty (dokładne powtórzenia w lekcji sprawdza kod; arkusz jest wymieszany) | wszystkie |
| W7 | `explanationPl` nieprawdziwe albo niezgodne z kluczem | z wyjaśnieniem |
| W8 | opcje nie do odróżnienia ze słuchu | listen_choice |
| W9 | błąd językowy w treści widocznej dla dziecka (EN albo PL) | wszystkie |

Rozstrzygnięcia: brak równoważnego wariantu (np. formy ze skrótem) = `ok` (od etapu 3 inną odpowiedź ocenia model); zadanie zamknięte z błędnym kluczem liczy się tylko jako W1, nie W3; inna poprawna odpowiedź zadania tekstowego, która używa ćwiczonej formy = `ok` (ocenia model), a bez ćwiczonej formy = W4. Poza bramką: uwaga `too_hard` / `too_easy` (poziom) i różnorodność (odsetek różnych odpowiedzi po `baseNormalizer` w zagadnieniu).

**Arkusz**: jeden na temat, wiersze wszystkich wariantów i przebiegów wymieszane; ćwiczenie tylko z polami kontraktu, klucze posortowane (warianty nie różnią się zestawem pól). Kolumna kontekstu wiersza (jak dziś w `gen-blind-sheet.cjs`, plus `descriptionEn`): tytuł i opis celu, karty i przykłady kart wygenerowane w tym przebiegu. Typ i obecność `explanationPl` czyta skrypt z arkusza.

**Pakiet sędziego** — ten sam dla obu: rubryka, materiał tematu, arkusz (z kolumną kontekstu). Bez klucza źródeł, kosztów i wyników poprzednich ocen. W6 obejmuje więc karty i przykłady kart; W8 to ocena par minimalnych z zapisu, nie odsłuch nagrania — raport to nazywa.

**Sędziowie**: (1) świeży subagent Claude (rodzina Anthropic), bez danych o źródle, partie po ok. 120 wierszy; (2) automatyczny `openai/gpt-5.6-terra` (rodzina OpenAI, OpenRouter) — plik `tests/probes/blind/auto-judge.probe.test.ts` na istniejącym rejestrze kosztów i kliencie sondy, partie po 25 wierszy. Obaj z innych rodzin niż generator (Google) i kontrola (DeepSeek). `score.cjs` rozszerzony o mianownik per klasa, przedział Wilsona 95% per klasa, wariant i temat, osobno dla każdego sędziego, oraz o zgodność sędziów (odsetek zgodnych werdyktów per klasa, z istniejących ocen); bez osobnego skryptu.

## 8. Biegi, strojenie, koszty

**Modele** (te same we wszystkich wariantach): generator `google/gemini-3.8-flash` (reasoning `low`, domyślny `UMIEM_LESSON_AGENT_MODEL`), kontrola i checker agenta `deepseek/deepseek-v4.1-flash-1017` (reasoning `low`). Zmiana modelu w strojeniu tylko w rodzinach Google (generator) i DeepSeek (kontrola); wtedy agent i `agent_plain` biegną ponownie na nowym modelu na wszystkich trzech tematach.

**Temat wstrzymany: „to be”** — niewykorzystany w strojeniu etapu 2 i bez fixture'u sondy (materiał sondy jest nowy). Temat katalogowy, jego reguły i migawka promptu istnieją od dawna, więc to dowód ograniczonego uogólnienia, nie test na nieznanym temacie. Strojenie tylko na Present Simple i Present Continuous.

**Strojenie zmienia wyłącznie**: tekst promptu paczki i promptu kontroli w adapterze (funkcje przebiegu bazowego), `PACKET_RESERVE` i model. **Nie wolno** stroić fragmentów wspólnych z agentem: `prompts` przedmiotu (`generationRole`, `fieldRules`, `interestsRule`), księgi reguł i jej opisów, katalogu (opisy celów, karty, przykłady typów) ani `lessonUserMaterial` — ich zmiana po rundzie 0 unieważniałaby biegi agenta tak jak zmiana modelu.

**Kolejność** (po scaleniu #365 i #366 i synchronizacji gałęzi — spełnione, 894a9c2c; SHA-256 rubryki, `to-be-objectives.json` i `closed-check-gold.json` w PR przed pierwszym płatnym biegiem; rundy strojenia zmieniają tylko pliki przebiegu bazowego, kod agenta stoi — pokazuje to diff):

1. Ćwiczenia wzorcowe (§6), 3 powtórzenia.
2. Runda 0: 3 warianty × PS, PC × 3 przebiegi = 18 biegów; sędzia 1. Po pierwszym biegu bazowym porównanie kosztu z limitem §9 pkt 5 — przekroczony → stop i decyzja właściciela.
3. Strojenie, gdy przebieg bazowy nie spełnia punktów §9 pkt 1–3 i 5 u sędziego 1 na PS/PC: najwyżej 2 rundy × 6 biegów bazowych; zmiana promptu, modelu albo zapasu.
4. Bieg potwierdzający na zamrożonej konfiguracji: 3 warianty × „to be” × 3; przy strojeniu także przebieg bazowy ponownie na PS i PC (bez strojenia runda 0 jest tą konfiguracją; biegi agenta z rundy 0 zostają). Do bramki trzy nowe arkusze (po jednym na temat, wszystkie warianty) oceniane od nowa obu sędziami; werdykty rundy 0 służą tylko strojeniu.
5. Wynik negatywny po 2 rundach albo w biegu potwierdzającym → decyzja właściciela, bez dalszego strojenia.

**Szacunek kosztu** (ceny OpenRouter z 2026-11-07: generator 0,83/4,13 USD za mln tokenów, kontrola 0,15/0,60, sędzia 2/12): przebieg bazowy ok. 0,3–0,5 USD na lekcję (ok. 30–40 paczek; szacunek, bez pomiaru), agent ok. 0,16 (pomiar sondy #328: 8 biegów PS/PC, te same modele, 1,26 USD). Bez strojenia ok. 10 USD (runda 0 ok. 4,5, „to be” ok. 2, sędzia automatyczny ok. 3–4, wzorcowe < 0,1); z dwiema rundami strojenia do ok. 17 USD. **Limit rejestru kosztów sondy: 18 USD** (`UMIEM_PROBE_COSTS_CAP_USD`); każdy run rezerwuje budżet 1 USD jak dziś (bezpiecznik), więc biegi idą po kolei.

## 9. Bramka po etapie 2

Liczone na biegu potwierdzającym, łącznie z 9 przebiegów przebiegu bazowego (3 tematy × 3) i 9 przebiegów agenta, osobno dla każdego sędziego; bramka przechodzi, gdy przechodzi u obu. Progi i porównania liczone na odsetku z próbki; przedział Wilsona tylko w raporcie.

1. **Progi bezwzględne przebiegu bazowego per klasa** (bez sumowania): W1 ≤ 1%, W2 ≤ 1%, W3 ≤ 1%, W4–W9 ≤ 3%.
2. **Porównanie z agentem** w każdej klasie: przebieg bazowy ≤ agent + 2 pp.
2a. **Temat wstrzymany osobno**: na samym „to be” (3 przebiegi) przebieg bazowy nie ma żadnej klasy powyżej 3% (także W1–W3), żeby agregacja z tematami strojenia nie maskowała tematu spoza strojenia.
3. **Minimum publikacji** (`poolCoverage` z `lessonPoolMinimums`, bez braków w żadnym zagadnieniu) w 3 z 3 przebiegów każdego tematu.
4. **Ćwiczenia wzorcowe**: progi z §6.
5. **Twardy limit kosztu**: każdy przebieg bazowy ≤ 0,60 USD zmierzonego kosztu na lekcję.
6. Raportowane bez progu: czas runu, `sceneShare` w celach porównania (cel ≥ 30%, #280), poziom, różnorodność, wynik `agent_plain` (ile heurystyki dają agentowi), wyniki per temat (osobno „to be”).

**Słabość próbki**: ok. 400 zadań zamkniętych i ok. 100 `listen_choice` przebiegu bazowego w biegu potwierdzającym. 0 wad na 400 daje górną granicę Wilsona ok. 1%, a 4 wady na 400 — ok. 2,5%; próbka nie odróżnia 1% od 3%. Ćwiczenia jednego przebiegu są skorelowane, więc przedział jest optymistyczny; raport podaje też liczniki per przebieg (min–max).

**Granica zatwierdzenia rodzica**: zatwierdzenie materiału nie chroni przed fałszywym sukcesem w sesji — przeoczony błędny klucz tekstowy zalicza się dokładnym dopasowaniem, a werdykt modelu oceniającego nie przechodzi przez rodzica.

## 10. Raport w opisie PR

- Per klasa, wariant i temat: wady / mianownik, odsetek, przedział Wilsona 95%, u obu sędziów; liczniki per przebieg (min–max) i per typ ćwiczenia; liczba ćwiczeń per wariant.
- Ocena punktów §9; rundy strojenia (co zmieniono); minimum publikacji per temat i przebieg; koszt i czas per lekcja oraz koszt na przyjęte ćwiczenie; ćwiczenia wzorcowe (z zastrzeżeniem z §6); `sceneShare`, poziom, różnorodność, `agent_plain` i diff promptów `agent` vs `agent_plain` (§5); zgodność sędziów per klasa.
- Słabość próbki i granica zatwierdzenia rodzica (§9).
- Bilans linii na ścieżkach §10 specu zbiorczego (z nowymi plikami `lesson-baseline-pool.ts`, `closed-check.ts`, `packet-plan.ts`); znaki promptów z migawek (paczka, kontrola, dzisiejszy agent PC 37,5 tys.) z zastrzeżeniem, że migawka jednej paczki nie jest porównywalna z promptem agenta wysyłanym w każdym kroku — porównanie kosztu daje USD na lekcję; rodzaje wywołań (generowanie: paczka + kontrola zamkniętych).
- Status zatwierdzenia przez właściciela decyzji z pkt 8 issue (progi, modele, limit kosztu, temat wstrzymany).
- Bez identyfikatorów modeli w opisie PR i commitach (są w tym specu).

## 11. Poprawki specu zbiorczego (w tym PR)

- §11 i §12.2: jedna nazwa „bramka po etapie 2” (dziś §12.2 „Bramka etapu 4”).
- §17: #288 zamykane po etapie 4.
- §2 (Zamrożenie) i §11: przy „nie” na bramce po etapie 2 zamrożenie heurystyk gramatyki znika, a niepodłączony kod etapu 2 jest usuwany w PR, który zapisuje tę decyzję.

## 12. Prywatność, integracje, dokumentacja

- Generator dostaje to samo co agent (materiał, polecenie, tematy zdań, karty, zdania do unikania, opis celu z katalogu); kontrola — widok dziecka bez tytułu celu, transkrypcję albo ułożony klucz. Nigdy dane dziecka. W sondzie dane fikcyjne.
- Bez zmian API, DTO, MCP, `SKILL.md`, `learning-overview`, Kid DTO i panelu: kod nie jest podłączony.
- Koszty (AGENTS.md): nowe operacje `packet_generate` i `check_closed` (feature `lesson_generation`) dopisane już w tym PR do `docs/architecture.md` §23 i tabeli specu kosztów, z adnotacją, że do etapu 4 zapisuje je tylko sonda. Opis przebiegu w §19.17 w etapie 4.

## 13. Testy

- `closed-check.test.ts`: kontrakt per typ, widok bez klucza i tytułu celu, transkrypcja, ułożony klucz, schemat (zły kształt = nie wiem), porównanie (kolejność, wielkość liter, apostrofy, duplikaty w odpowiedzi, odpowiedź spoza opcji, lista pusta, `null`), notice z kluczem w dwóch segmentach, rozsypanka tylko `yes`.
- `packet-plan.test.ts`: cele etapów z `targetCount` i minimum z rezerwą, podział na typy, reszta, zapas, notice, listen; małe i duże `poolSize`; wszystkie cele trzech tematów osiągają minimum.
- `lesson-baseline-pool.test.ts` (fake'i portów): kolejność i równoległość, struktura (te same kroki co agent), nadmiar, kontrola tylko zamkniętych, walidacja puli niezależna od kolejności zakończenia, przykład karty ujawniający odpowiedź odpada (ćwiczenie zostaje), przycięcie do celów etapów, jedno ponowienie tylko dla `retryable`, `failed`, budżet, termin, anulowanie, brak niesprawdzonych w wyniku, wynik przechodzi kontrolę końcową sondy, dzienniki bez treści.
- Adapter: `generatePacket` i `checkClosed` na `MockLanguageModel` (prompt, schemat, koszt, mapowanie błędów, brak ponowienia w adapterze); migawki promptów.
- Sonda: testy pomocników (wariant, moduł bez heurystyk, mutacje wzorcowych, Wilson w `score.cjs`).
- `tests/ai-sdk-scope.test.ts` i testy architektury bez wyjątków; `pnpm check`, `pnpm test:integration`, `pnpm test:e2e:shards` przed PR.

## 14. Historia

- **v1** — pierwsza wersja.
- **v2** (krytycy): wejście i wynik jak `runLessonPoolAgent`; walidacja struktury = sekwencja `parseRecord`; walidacja puli i status na istniejącym kodzie agenta (`lessonInvariantCheck`, `submitExamples`, `objectiveStatus`); jedno ponowienie w przebiegu tylko dla `retryable`; mniej kodów i prostszy schemat kontroli; widok kontroli bez tytułu celu; notice z jednym pasującym segmentem; słuchanie w kontroli i wzorcowych poprawione (transkrypcja z klucza, bez klasy „druga poprawna”); zamiana sąsiednich klocków zamiast odwrócenia; prompt paczki z `general`, `fieldRules`, `interestsRule`, bez `lesson` i `checks`; moduł bez heurystyk zachowuje same wskazówki dydaktyczne; `graderAvailable = true`; progi na odsetku z próbki; nowe arkusze per temat dla bramki obu sędziami; wyniki per temat, typ i przebieg; rozstrzygnięcia rubryki; `score.cjs` zamiast nowego skryptu, bez miary zgodności; SHA zamrożonych plików; poprawiony szacunek kosztu i źródło kosztu agenta.
- **v3** (review Muse): osobny warunek bramki dla tematu wstrzymanego (§9 pkt 2a) i uczciwy opis jego siły dowodu; liczby paczek z tego samego `poolSize` co agent, cele etapów i przycięcie, jawna stała `PACKET_RESERVE` zamiast `slack`; dokładna konstrukcja modułu bez heurystyk (siedem stałych wskazówek, te same id i pola) i diff promptów `agent` vs `agent_plain` w PR; zakaz strojenia fragmentów promptu wspólnych z agentem; notice i opcje porównywane normalizatorem przedmiotu (ta sama równoważność co struktura i materializacja); widok kontroli bez tytułu celu (kopia tematu); listen z `null`; wzorcowe: 12 w „drugiej poprawnej”, potwierdzenie autora przy słuchaniu, progi łącznie / per powtórzenie; pakiet wejściowy sędziów (kontekst celu, karty, przykłady), W8 nazwane jako ocena z zapisu, zgodność sędziów z istniejących ocen; dokładna sekwencja `parseRecord`; źródło polityki; operacje kosztów w §23 już teraz; koszt na przyjęte ćwiczenie.
