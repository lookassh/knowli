# Etap 5: rozdział i szkoła na przebiegu bazowym, usunięcie pętli agenta — design

Wersja 2.2, 2026-11-08 (v2.2: kolejność bramek, §14), po przeglądzie trzech krytyków (prostota, poprawność kodu i danych, dydaktyka i pomiar). **Zatwierdzona przez właściciela 2026-11-08** z rekomendacjami §13 (podział 5a/5b/5c, keywords w wariancie A). Zgoda na płatne biegi — osobno. Issue #362, epik #358. Spec zbiorczy: `2026-11-07-llm-content-judgment-design.md` (v4: §4, §5, §8, §9, §10, §11 pkt 5, §12, §14, §16). Spece etapów 2 (v3.1) i 4 (v2.1), raport bramki w PR #367 i przebiegu kontrolnego w PR #371. Stan kodu: `main` 6de15af2. Równolegle: #372 (luki w `short_answers` gramatyki; może dotknąć `packet-plan.ts` i promptu paczki — po scaleniu tamtego PR synchronizujemy gałąź).

## 1. Cel i granice

Wszystkie przedmioty lekcji na jednym przebiegu: paczka cel × typ → oczyszczenie i walidacja struktury → kontrola zamkniętych → jedna walidacja puli. Rozdział (`english_chapter`) i szkoła (`school`) przechodzą na przebieg bazowy, każdy przez własną bramkę; potem znika pętla agenta z narzędziami, jego kontrole i heurystyki obu przedmiotów. Bilans §10 ujemny.

Poza zakresem: zestawy słówek (w tym `english/material-phrase.ts` i `english/inflection.ts`), #279, #280, #370, historyjka lekcji, ocena odpowiedzi dziecka (etap 3 bez zmian), warstwy z §8 bez dowodu i decyzji właściciela.

## 2. Podział na PR — do decyzji właściciela

**Rekomendacja: trzy PR po kolei w tej sesji.** Wspólny kod (`closed-check.ts`, `lesson-baseline-pool.ts`, adapter, fake'i) zmieniany po kolei, bez równoległych gałęzi; po scaleniu każdego PR następny startuje od `main`.

| PR | Zakres | Bramka | Gdy bramka nie przejdzie (§8) |
|---|---|---|---|
| **5a** | `english_chapter`: kontrola match, group, cloze (§3); etap zagadnień jednym wywołaniem (§4.1); przebieg bazowy dla tematu dynamicznego; oczyszczenie przedmiotu w kroku struktury (§4.4); `baselinePool: true`; usunięcie heurystyk rozdziału (sam hak `refineGeneratedPool` i haki bramek agenta w typach — w 5c, używa ich przedmiot testowy agenta) | rozdziału (§7.5) | zostaje tylko kontrola match, group, cloze (potrzebna szkole); reszta PR wraca, rozdział zostaje na agencie |
| **5b** | `school`: keywords (§5.1); materiał w kontroli zamkniętych; oczyszczenie szkoły w kroku struktury; `baselinePool: true`; usunięcie `hint-gate.ts`, `termOccursIn` i kontroli 2b (§5.3) | szkoły (§7.6) | szkoła zostaje na agencie |
| **5c** | usunięcie pętli agenta (§6), mechaniczny PR po obu bramkach | — (testy) | gdy przedmiot został na agencie: plan wyjścia z dwóch generatorów (§8) |

Bramki są niezależne (inne materiały, typy i kontrole), więc wynik jednej nie blokuje drugiej; 5c jest mechaniczne i najłatwiej je przejrzeć, gdy żadne zachowanie się już nie zmienia. Podział nie tworzy kodu pisanego tylko po to, żeby go usunąć: 5a i 5b usuwają, 5c usuwa resztę.

## 3. Kontrola match, group, cloze i keywords

Wszystkie cztery mieszczą się w **pierwszym kontrakcie §5** („wybór i przypisanie”: model bez klucza podaje komplet poprawnych odpowiedzi tekstami, albo „żadna”, albo „nie wiem”; kod przepuszcza tylko równość z kluczem) — **bez nowego kształtu wyniku i bez zmiany promptu kontroli**.

- **Wiele pól = wiele pozycji tej samej paczki kontroli.** `closedCheckItem` rozkłada ćwiczenie z przypisaniem na pozycje, po jednej na pole: widok całego ćwiczenia (jak dziś z `solverView`, bez klucza i tytułu celu), wiersz wskazujący pole i jego opcje (cele przypisania). Model odpowiada na każdą pozycję dzisiejszym `{ "answers": string[] | null }`. Ćwiczenie przechodzi, gdy przechodzi każda jego pozycja; wynik pozycji porównuje istniejący `closedCheckVerdict` (opcje = cele pola).

| Typ | Pole (pozycja) | Opcje pola | Klucz pola |
|---|---|---|---|
| `lesson_match` | element lewej strony | prawe strony par i `extraRight` | prawa strona jego pary |
| `lesson_group` | element (kolejność widoku: `groupItemsInViewOrder`, wspólna z widokiem) | etykiety grup | etykieta jego grupy |
| `lesson_cloze` | luka (numer) | słowa banku (`gapAnswers` + `extraWords`) | słowo luki |
| `lesson_keywords` | jedno (całe zadanie) | pojęcia | komplet `keyOptionIds` |

- **Pola ocenia się niezależnie.** Wiersz pola mówi, że inne pola nie zawężają odpowiedzi (bez eliminacji: dziecko, które dopasuje pozostałe pary, nie powinno być jedyną drogą do rozwiązania). Ćwiczenie rozwiązywalne tylko eliminacją odpada — bezpieczny kierunek.
- **Co wychodzi:** błędny klucz (komplet pola bez klucza), druga poprawna odpowiedź (dystraktor `extraRight` / `extraWords` pasujący do pola, element pasujący do dwóch grup, dwie zamienne luki, pojęcie spoza `keyOptionIds`, które też jest kluczowe) i brak rozstrzygnięcia.
- **Luki numerowane tylko w widoku kontroli.** Dziś `solverView` pokazuje luki jako `___` bez numerów (`solver.ts:150-155`); numery dokłada `closedCheckItem`, bo zmiana `solverView` zmieniłaby ślepe rozwiązanie agenta, czyli ramię agenta szkoły w trakcie 5a.
- **Teksty, nie identyfikatory** (#298): przypisanie tekstu modelu do celu przez `answersEquivalent` z normalizatorem przedmiotu. Powtórzone teksty celów odrzuca już struktura (`match.confusable`, `group.label_confusable`, `group.item_repeated`, `cloze.bank_confusable`, `keywords.option_duplicate`).
- **Keywords.** Dziś widok wypisuje polecenie, tytuł celu i pojęcia — bez pytania, do którego pojęcia są kluczowe. `closedCheckItem` dokłada wiersz `Question: <prompt pytania otwartego rodziny>` (bez odpowiedzi wzorcowej i elementów wymaganych). Kid ocenia keywords jako „każde wskazane pojęcie jest kluczowe, co najmniej 2” (`evaluate.ts:206-214`); równość kompletu z `keyOptionIds` jest ostrzejsza, ale łapie i błędny klucz, i drugie kluczowe pojęcie.
- **Kody:** `check_wrong_set`, `check_unknown`. Bez nowych kodów i etykiet.

Rozsypanka (`lesson_order`), także szkolna (kroki procesu), zostaje przy drugim kontrakcie. `lesson_calculation` liczy kod; gap i open_answer bez kontroli generowania (§5 specu zbiorczego).

## 4. PR 5a: rozdział na przebiegu bazowym

### 4.1 Etap zagadnień: jedno wywołanie

Dziś planista rozdziału to pętla do 8 kroków (`planAgentObjectives`, narzędzie `propose`, `validateAgentPlan` z `planGate`). Szkoła ma etap zagadnień jako **jedno wywołanie** (`generateDynamicObjectives` → `LlmProvider.generateLessonObjectives`, ścieżka `needsObjectives` w workerze, wynik w punkcie kontrolnym).

**Rozdział używa tej samej ścieżki.** Gdy przedmiot ma `prompts.objectivesRules` (tylko rozdział), schemat etapu wymaga pola `kind` (`words` / `frame`; bez niego `TYPES_BY_KIND` po cichu brałby `words`), a prompt dostaje `objectivesRules`. Liczbę zagadnień rozdziału (3–6, stałe przeniesione z `agent/plan.ts` do `english-chapter/prompts.ts`) podaje tylko tekst `objectivesRules`; kod zostawia wspólny limit `buildDynamicTopicData` (najwyżej 8) — bez nowej reguły per przedmiot. Zły wynik = błąd `validation` i istniejące ponowienia runu.

- **Bez `planGate` i listy pokrycia** (`planCoverage`, `material-lexicon.ts`): bramka porównywała słowa materiału z kartami wyrażeniem regularnym z końcówkami (`mentions`) i wymagała pętli poprawek. `objectivesRules` już każe przypisać każde słowo do zagadnienia; pokrycie mierzy sonda (§7.5 pkt 6).
- **Bez przykładów kart z planu**: daje je pierwsza paczka zagadnienia, jak w gramatyce. Pole `planExamples` w punkcie kontrolnym zostaje czytane do 5c (wznowienie runu agenta w toku przy wdrożeniu — istniejący kod: `planExamples` → `initialExamples`), w 5c znika.
- **Usługa i koszt:** etap zagadnień idzie przez `UMIEM_LLM_*` (domyślnie ten sam model co generator, przez OpenRouter; wymagana zależność workera), do usługi trafia to samo co dziś do planisty — materiał i polecenie rodzica. Panel pokaże tę usługę dla rozdziału sam, gdy zniknie `planCoverage` (`lesson-api.ts:189`). Koszt etapu jest poza budżetem runu (`RunCostMeter`), jak w szkole — koszt lekcji w sondzie liczymy z `provider_usage_events`.

### 4.2 Przebieg bazowy dla tematu dynamicznego

`runLessonBaselinePool` przyjmuje dziś tylko źródło `catalog`. Rozszerzenie: źródło `input` (temat dynamiczny z etapu zagadnień albo punktu kontrolnego), temat składa `subject.buildDynamicTopic`, jak u agenta. Reszta (paczki z `packetPlan`, limity z `lessonAgentLimits`, przyjęcie krokami agenta, status, wznowienie, „dodaj N”) bez zmian. Plan paczek z `TYPES_BY_KIND`: `words` — guided: match, group, choice, cloze; `frame` — guided: match, order, choice, cloze; oba — productive: gap, independent: open_answer, słuchanie poza etapami.

`lesson_group` dostaje paczkę jak każdy typ; dzisiejszy `typeRules.lesson_group` pozwala zwrócić mniej, gdy słowa nie dzielą się na grupy. Brak uzupełniają w tym samym runie zapasy pozostałych typów etapu (limit jest per kubełek, zapasy przyjmowane po udziałach). Sonda raportuje liczby per typ.

### 4.3 Co znika w rozdziale

- `chapter.instruction_stimulus` (lista ogólnych poleceń i wyrażenie „zdanie, potem polecenie”), `chapter.word_outside_material`, `chapter.function_words_only` (słownik `lexicon.ts`) i cały `refineChapterPool` (hak `SubjectModule.refineGeneratedPool` i regułę `lesson.refine_unnamed` usuwa 5c — do tego czasu używa ich przedmiot testowy agenta);
- bramki agenta `exerciseGate` (`card_word_missing`, `frame_missing`), `objectiveGaps`, `planGate`, `planCoverage` z `material-lexicon.ts`; fake'i dostają własne proste dane zamiast słownika;
- `requiredTypes`: plan paczek zamawia każdy typ zagadnienia, minimum publikacji typów nie wymaga; sonda raportuje typy bez progu;
- `english/listen-audibility.ts` i `english/rules.ts` — bez warunku (AGENTS.md: zamrożone do usunięcia w etapie 5; w gramatyce W8 0/54 po usunięciu); wysokie W8 w sondzie to sygnał do zmiany promptu, nie do zachowania heurystyki;
- `english/inflection.ts` bez zmian (`stemsOf` używa `formsOf` słówek).

**Dydaktyka przenoszona do promptu przed rundą 0** (usunięcie reguł usuwa ich opisy z księgi reguł, `lessonRuleBook`): do `fieldRules` / `typeRules` rozdziału trafiają po jednym zdaniu — polskie zdanie-bodziec w poleceniu wyboru, luki, rozsypanki i tekstu z lukami (zwykłe „Wybierz słowo” nie wystarcza), sprawdzana część ćwiczenia ze słów albo ramy TEGO zagadnienia, tylko słowa materiału i słowa funkcyjne (już w `generationRole`). Bez list sprawdzeń.

Zostają reguły strukturalne: `chapter.stem_single_gap`, `chapter.translation_instruction_required`, `chapter.hint_not_allowed`, `chapter.order_items_distinct`. Zdania kart zostają źródłem ujawnień (`cardExposureTexts`). Ręczna edycja i publikacja szkicu sprawdzają tylko strukturę (już dziś słownik działał tylko na świeżym wyjściu modelu).

### 4.4 Oczyszczenie w kroku struktury

Agent czyści ćwiczenie przed przyjęciem (`agentPolicy.sanitize`, `refineGeneratedPool`, `admission.ts:234-240`); przebieg bazowy tego nie woła. W 5a przebieg bazowy woła `sanitize` przedmiotu zaraz po `parseLessonRecord`; przyjmowanie agenta zachowuje swoje wywołanie do 5c (agent szkoły na produkcji bez zmian), a 5c zostawia jedno miejsce. Gramatyka nie ma `sanitize`, więc jej przebieg się nie zmienia. Treść:

- ogólnie dla przedmiotów bez `usesV3Payload`: usunięcie pól payloadu v3 (dziś robi to `refineChapterPool`) — w `sanitizeFreshLessonDraft`, bez kodu przedmiotu;
- rozdział: wstawienie brakującego stałego polecenia tłumaczenia („Przetłumacz na angielski.”) — przed walidacją, inaczej `chapter.translation_instruction_required` odrzuci tłumaczenia; wariantów `acceptedAnswers` ze słowami spoza materiału już nie usuwamy (słownik znika);
- szkoła (5b): usunięcie podpowiedzi spoza pytania otwartego i wyrównanie cytatów do dokładnego fragmentu materiału (`snapQuote`: normalizacja białych znaków i cudzysłowów, porównanie napisów — nie reguła językowa); bez części z `hint-gate.ts`.

### 4.5 Fake'i i testy ścieżki

`FakeLessonPoolAgent.generatePacket` i `FakeExerciseChecker.checkClosed` obsługują typy rozdziału (match, group, cloze — klucz pozycji pola z widoku fake'a); etap zagadnień fake'a zwraca `kind`. Testy integracyjne, które skryptują fake agenta rozdziału (`lesson-chapter`, `lesson-listen-choice`, `source-materials`), przechodzą na fake paczek; speki E2E rozdziału bez zmiany oczekiwań albo z jawnie opisaną zmianą.

## 5. PR 5b: szkoła na przebiegu bazowym

### 5.1 Keywords — do decyzji właściciela

`lesson_keywords` to opcjonalny trener precyzji poza minimum publikacji (`typeRules.lesson_keywords`: „at most one per objective”), sparowany z rodziną pytań otwartych przez `familyId`. Trzy drogi:

| | Jak | Kod | Koszt dydaktyczny |
|---|---|---|---|
| **A (rekomendacja)** | paczka `lesson_open_answer` zwraca też 0–1 keywords swojej rodziny (gałąź keywords w schemacie tej paczki) | najmniej: pytanie i keywords w jednej odpowiedzi, bez kolejności paczek | brak; wyjątek od zasady „paczka = jeden typ” — keywords to dodatek pytania otwartego, jak przykłady kart w pierwszej paczce |
| B | osobna paczka keywords po walidacji struktury paczki pytań otwartych | kolejność paczek, blok ocalałych pytań w wejściu (z `familyBase`, inaczej `scopeFamiliesToRun` dokleja sufiks drugi raz), kubełek keywords; jedno wywołanie więcej na zagadnienie | brak |
| C | przebieg bazowy nie generuje keywords (rodzic może dodać w edytorze, stare pule działają) | ujemny | dziecko traci trening precyzji w nowych lekcjach |

W A i B keywords przechodzą kontrolę zamkniętych (§3) w osobnej pozycji paczki kontroli typu keywords, a w walidacji puli są przyjmowane **po** wszystkich innych ćwiczeniach zagadnienia (jak `processingOrder` agenta, `admission.ts:195`): inaczej keywords rodziny z zapasu pytań otwartych odpadłyby jako `school.keywords_family_missing`, zanim to pytanie zostanie przyjęte. Osierocone keywords (pytanie odpadło) usuwa istniejąca walidacja rodzin i zapis (`ORPHAN_KEYWORDS_REASON`). Kubełek keywords z limitem 1 na zagadnienie (dziś `bucketOf` przypisuje typy spoza ścieżki do kubełka słuchania). Reguła `school.keywords_family_rejected` (kontekst tylko agenta) znika.

### 5.2 Kontrola zamkniętych w szkole

Wejście kontroli dostaje materiał lekcji, gdy przedmiot go wymaga (`agentPolicy.checkerNeedsMaterial`, w 5c pole modułu o tej samej nazwie) — §5 i §14 specu zbiorczego. Port `ClosedExerciseChecker.checkClosed` dostaje opcjonalne `material`. Typy z kontrolą: choice, match, group, cloze, keywords, order. `lesson_calculation` dostaje paczkę także w przedmiocie bez metod obliczeń (dzisiejszy `typeRules` każe wtedy nic nie zwracać) — jedno puste wywołanie na zagadnienie, raportowane w koszcie.

### 5.3 Kontrole 2b, `hint-gate.ts`, `termOccursIn`

- **Heurystyki znikają bez warunku** w 5b: obie rozumieją polską odmianę prefiksem słowa (§2 specu zbiorczego). `school.keyword_not_in_answer` zastępuje kontrola keywords (§3).
- **Instrukcja podpowiedzi zostaje.** Dziś jedynym tekstem „Give each lesson_open_answer a short hint… never names the answer” jest opis reguły `hint.reveals_words` (`school/rules.ts:167-177`); przy usunięciu reguły ten tekst (bez części o liczeniu słów) przechodzi do `typeRules.lesson_open_answer` przed rundą 0.
- **Kontrole 2b** (`judgeHints`, `solveOpen` + grader w workerze): przebieg bazowy szkoły biegnie **bez nich**. Dowód daje ramię agenta (biegnie z nimi): kontrole zostają tylko wtedy, gdy po strojeniu przebieg bazowy przekracza agenta o więcej niż 2 pp w W6h (zdradzona odpowiedź w podpowiedzi pytania otwartego) albo w W2 pytań otwartych **u obu sędziów**. Wtedy decyduje właściciel: warstwa z §8 w przebiegu bazowym albo szkoła zostaje na agencie. Bez osobnej sondy odtwarzającej kontrole.
- Przy usunięciu znikają: `judgeHints`, `solveOpen`, grader w zależnościach workera, wyłącznik i pamięć gradera, liczniki kontroli 2b, `agentCheckStartLine`, pole `openCheckService` w DTO katalogu (§10), nowe zapisy operacji `check_hints`, `check_open`, `check_grade`. **Zostaje** warunek dostępności generowania w `lessonAgentPublicFromEnv` (pełna konfiguracja `UMIEM_GRADER_*` — grader ocenia dziecko, etap 3); z DTO znika tylko etykieta.

## 6. PR 5c: usunięcie pętli agenta

Znika (szczegóły i liczby — §9):

- `runLessonPoolAgent`, kierownik, podagent `runObjective` (`ToolLoopAgent`), narzędzia `submit_exercises` / `remove_exercise`, przyjmowanie agenta poza krokami wspólnymi, kontrole `solve` i `judgeVariants`, prompt i schemat podagenta, generowanie `acceptedAnswers` rozsypanki (prośba w notach `check.blind_solve`), port `runObjective` / `planObjectives` i metody checkera poza `checkClosed`, fake'i agenta, ok. 70 scenariuszy mechaniki agenta (`agentGrammarSubject`, `agentGrammarRegistry()` — mechanika workera przechodzi na przebieg bazowy albo przypadek samej pętli znika), `probe:agent` i `probe-submissions.ts`, pole `planExamples` (po zapytaniu o runy w toku);
- pole modułu `baselinePool` i rozgałęzienie w workerze;
- `SubjectAgentPolicy`: `independentReserve` (1 we wszystkich przedmiotach) staje się stałą w `packet-plan.ts`; `typeExamples`, `checkerNeedsMaterial` i `sanitize` przechodzą do `SubjectModule` bez zmiany nazw; `ruleNotes` znika razem z regułami `check.*` i notami `lesson.leak*` — przebieg bazowy pomija sekcje `lesson` i `checks` księgi reguł, więc nikt ich nie czyta (`validateSubject` odrzuciłby notę bez reguły); `slack` i listy kontroli znikają. Rejestr przestaje wymagać `agentPolicy`.

Zostaje: wspólne kroki przyjmowania (`lessonRulesStep`, `submitExamples`, `snapshotOf`, `removeExercise`), stan i status zagadnienia, `solverView`, `RunCostMeter`, terminy i anulowanie, punkt kontrolny, wynik próby, `MAX_AUTOMATIC_ATTEMPTS`, adapter `generatePacket` / `checkClosed`, `tracked`. Nazwy plików `lesson-agent-*` i `lesson-pool-agent-*` zostają (zmiana nazwy to tylko szum diffu). `rules/lesson.rule-cases.ts` przechodzi z `admitBatch` na `lessonRulesStep`.

## 7. Sondy i bramki

### 7.1 Narzędzia

- **Ścieżka:** `probe:chapter` (przypadki użycia z bazą jak w workerze, adaptery z `lessonAgentDepsFromEnv`, zapis szkicu, luki, „+N”, zrzut arkusza) w obu ramionach. `probe:agent` nie służy do bramki (własne adaptery; etap 4 znalazł zamienione domyślne modele).
- **Ramiona:** agent = worktree `main` na przypiętym SHA (dzisiejsza produkcja: agent z heurystykami i kontrolami 2b), przebieg bazowy = gałąź PR. Bez przełącznika w kodzie — dwa realne stany, jak sonda #328. Ten sam plik materiału, `UMIEM_PROBE_POOL_SIZE`, rejestr kosztów. SHA obu ramion w zrzucie.
- **Modele** (te same w obu ramionach, pełne ID ustawione jawnie, zapisane w zrzucie; zrzut bez nich unieważnia bieg): generator i etap zagadnień `google/gemini-3.8-flash` (reasoning `low`), kontrola zamkniętych i checker agenta `deepseek/deepseek-v4.1-flash-1017` (reasoning `low`), grader szkoły w ramieniu agenta `google/gemini-3.8-flash`. Planista agenta działa na modelu agenta, etap zagadnień przebiegu bazowego na `UMIEM_LLM_*` — sonda ustawia oba na ten sam model i reasoning i dopisuje model etapu zagadnień rozdziału do zrzutu.
- **Zmiany danych w narzędziach sondy** (bez nowych reguł): `score.cjs` — listy typów per klasa dla match, group, cloze, keywords, calculation i nowa klasa W6h (pole `hasHint` w kluczu arkusza), klasy z mianownikiem < 34 liczone jako „≤ 1 wada” w progach materiału wstrzymanego; `gen-blind-sheet.cjs` — nazwa rubryki jako argument, `graderAvailable` poza polami, które muszą być równe w ramionach szkoły (agent z graderem, przebieg bazowy po 5b bez); `probe-preflight.ts` — szkoła na gałęzi 5b bez wymogu gradera tylko wtedy, gdy kontrole 2b zostały usunięte (generowanie i tak wymaga `UMIEM_GRADER_*`); `probe:gold` — przedmiot i materiał per przypadek (dziś na sztywno gramatyka).
- **Ślepa ocena:** nowa zamrożona rubryka `rubric-stage5.md` (§7.4). Sędzia 1: skryptowy `anthropic/claude-opus-5.5` przez OpenRouter (`probe:judge`, kredyt właściciela — OpenRouter raportuje koszt 0, więc osobny plik rejestru i szacunek z cen tokenów; spójniejszy niż subagenci, decyzja z bramki etapu 2), w rundach strojenia i w biegu potwierdzającym; sędzia 2: `openai/gpt-5.6-terra` (`probe:judge`). Obaj spoza rodzin generatora i kontroli.

### 7.2 Materiały (fikcyjne, w repo `tests/probes/fixtures/`, kopiowane poza repo na czas biegu)

- **Rozdział:** trzy rozdziały w formacie podręcznika (listy „en — pl”, sekcja zwrotów z ramami): dwa do strojenia (np. ubrania i pogoda; dom i pokoje), jeden wstrzymany (np. jedzenie i „I like / I don't like”). Każdy fixture ma listę słów i ram do pomiaru pokrycia: autor wpisuje formy do szukania (`shoe|shoes`, stała część ramy).
- **Szkoła:** trzy materiały z odpowiedziami opisowymi: dwa do strojenia (np. przyroda: obieg wody; historia: chrzest Polski), jeden wstrzymany (np. geografia: krajobrazy Polski), każdy z faktami, procesem (rozsypanka) i pojęciami (keywords).
- SHA-256 fixture'ów, rubryki i ćwiczeń wzorcowych w PR przed pierwszym płatnym biegiem.

### 7.3 Ćwiczenia wzorcowe

Kontrola przechodzi przez nie bez generatora (oczyszczenie i struktura → `checkClosed` → werdykt). Etykiety według polityki niżej; zatwierdzenie specu zatwierdza politykę.

| Klasa | Liczba | Jak powstaje | Oczekiwane |
|---|---|---|---|
| poprawne | po 4: match, group, cloze, keywords, szkolne choice i order (z materiałem); po 2: choice, listen_choice, order rozdziału | ręcznie | przechodzi |
| błędny klucz | z każdego poprawnego | **mechanicznie**: match — zamiana prawych stron dwóch par; group — przeniesienie elementu do innej grupy; cloze — zamiana słów dwóch luk (autor potwierdza, że nie są zamienne); keywords — jedno `keyOptionIds` na dystraktor; choice — `correctOption` na inną opcję; order — zamiana dwóch sąsiednich klocków w `items` i `answer` (autor potwierdza błąd) | odpada |
| druga poprawna | po 3: match (`extraRight` pasujący do elementu), group (element dwóch grup), cloze (słowo banku pasujące do luki), keywords (dystraktor, który też jest kluczowy), szkolny choice | ręcznie | odpada |

**Wywołania:** w kontrakcie wyboru i przypisania mutacja klucza daje bajt w bajt ten sam widok co poprawne ćwiczenie (cele posortowane, klucz ukryty), więc klasę „błędny klucz” tych typów liczy kod z odpowiedzi modelu na poprawne ćwiczenie (porównanie z kluczem po mutacji), bez osobnych wywołań; wywołania z mutacją ma tylko rozsypanka (wiersz „Arranged answer”). Trzy powtórzenia. Progi: błędny klucz wykryty w **100%** każdego powtórzenia; druga poprawna wykryta w ≥ 80% i poprawne odrzucone w ≤ 10% łącznie z trzech powtórzeń. Raport zaznacza, że 100% w kontrakcie wyboru i przypisania nie świadczy o wykrywaniu subtelnych błędnych kluczy (model nie widzi klucza). Niespełniony próg = zmiana promptu kontroli w części wielu pól (nowej), liczona jako runda strojenia; prompt pozycji jednego pola jest wspólny z gramatyką i się nie zmienia.

### 7.4 Rubryka `rubric-stage5.md`

Klasy W1–W9 z `rubric-stage2.md` z tymi samymi identyfikatorami, rozszerzone:

- **W1** błędny klucz w zadaniu zamkniętym — także match, group, cloze, keywords (którekolwiek pole) i szkolna rozsypanka;
- **W2** błędny klucz albo wariant w zadaniu tekstowym; w szkole także element wymagany albo odpowiedź wzorcowa sprzeczne z materiałem;
- **W3** druga poprawna odpowiedź — także `extraRight`, element dwóch grup, zamienne luki, słowo banku pasujące do luki, drugie kluczowe pojęcie;
- **W4** dwuznaczne zadanie tekstowe: rozdział — polecenie pozwala poprawnie odpowiedzieć bez sprawdzanego słowa lub ramy; szkoła — poprawna według materiału odpowiedź, której nie pokrywają elementy wymagane;
- **W5** poza zakresem: rozdział — słowo treści spoza materiału w sprawdzanej części albo słowo / rama innego zagadnienia; szkoła — fakt spoza materiału;
- **W6** zdradzona odpowiedź w bodźcu, podpowiedzi, karcie albo przykładzie karty; **W6h** — to samo, gdy źródłem jest podpowiedź pytania otwartego szkoły. Karta rozdziału z parą „słowo — znaczenie” nie zdradza ćwiczenia z tym słowem (karta uczy słowa); zdradą jest zdanie odpowiedzi widoczne wcześniej;
- **W7** `explanationPl` (rozdział); **W8** słuchanie (rozdział); **W9** błąd językowy.

Rozstrzygnięcia z etapu 2 bez zmian. Poza bramką: poziom i różnorodność.

### 7.5 Bramka rozdziału (PR 5a)

Liczone na biegu potwierdzającym, osobno u każdego sędziego; przechodzi, gdy przechodzi u obu.

1. **Twardo: 0 ujawnień — z konstrukcji kodu, sprawdzane asercją sondy.** Oba ramiona przy przyjmowaniu odrzucają ujawnienia ostrzejszym trybem `generation` (`lessonRulesStep`, ze zdaniami kart). Sonda na każdym zapisanym szkicu czyta `exposureLeaks` szkicu (`findExposureLeaks` w trybie `coverage`, ten, który wyklucza ujawnione zadania z pokrycia, `lesson-coverage.ts:93`) — z przykładami kart, bez samych zdań kart, które sprawdza już przyjęcie w obu ramionach; wynik > 0 to błąd ścieżki zapisu i zatrzymuje bramkę. To jest mechanizm, który daje agentowi rozdziału jego 0. Ujawnienia, których kod nie widzi (bliskie kopie), mierzy W6 ślepej oceny — porównaniem jak niżej, bo sędziowie dawali w etapie 2 W6 na `lesson_open_answer` 4–11% w obu ramionach przy zgodności 79–94%, więc twarde 0 u sędziów obaliłoby dobrą bramkę szumem.
2. **Progi bezwzględne przebiegu bazowego per klasa** (bez sumowania): W1 ≤ 1%, W2 ≤ 1%, W3 ≤ 1%, W5, W7, W8, W9 ≤ 3%; W4 i W6 tylko porównaniem (decyzja właściciela z bramki etapu 2).
3. **Porównanie z agentem** w każdej klasie: przebieg bazowy ≤ agent + 2 pp.
4. **Materiał wstrzymany osobno:** żadna klasa przebiegu bazowego powyżej 3% (klasy z mianownikiem < 34 na tym materiale: ≤ 1 wada).
5. **Minimum publikacji** (`poolCoverage` z `lessonPoolMinimums`): w co najmniej 5 z 6 biegów przebiegu bazowego i nie mniej biegów niż u agenta; bieg z luką przechodzi „+N” na luce (sonda robi to w tym samym biegu) i daje szkic publikowalny.
6. **Pokrycie materiału:** formy z listy fixture'u szukane bez rozróżniania wielkości liter jako podciąg w kartach i angielskich polach ćwiczeń szkicu; braki na lekcję ≤ agent + 1.
7. **Ćwiczenia wzorcowe:** progi §7.3.
8. **Twardy limit kosztu:** każdy przebieg bazowy rozdziału ≤ **0,60 USD** na lekcję (z `provider_usage_events`, razem z etapem zagadnień; agent rozdziału dziś 0,13–0,19).
9. Raportowane bez progu: czas runu, odrzucenia per kod i reguła, liczby per typ (zwłaszcza `lesson_group`), poziom, różnorodność.

### 7.6 Bramka szkoły (PR 5b)

Jak §7.5 pkt 1–5, 7, 9 (W7 i W8 nie dotyczą szkoły; pkt 6 bez pokrycia słów), oraz:

- **W6h i W2 pytań otwartych** osobno — od nich zależą kontrole 2b (§5.3);
- **twardy limit kosztu:** ≤ **0,80 USD** na lekcję (agent szkoły dziś 0,45–0,49 z kontrolami 2b).

### 7.7 Biegi, strojenie, koszty

Dla każdego przedmiotu osobno, po kolei (najpierw rozdział, potem szkoła), każdy płatny krok za zgodą właściciela:

1. **Ćwiczenia wzorcowe** — 3 powtórzenia (grosze).
2. **Runda 0:** 2 materiały strojenia × 2 ramiona × 2 biegi = 8 biegów; sędzia 1. Po pierwszym biegu bazowym koszt wobec limitu — przekroczony → stop i decyzja właściciela.
3. **Strojenie** (gdy przebieg bazowy nie spełnia progów u sędziego 1): **najwyżej 2 rundy** × 4 biegi bazowe. Zmieniamy wyłącznie pola przedmiotu, którego dotyczy bramka (`prompts.generationRole`, `fieldRules`, `typeRules`, w rozdziale `objectivesRules`) i część promptu kontroli dla wielu pól. **Nie zmieniamy** modeli ani fragmentów wspólnych z gramatyką albo drugim przedmiotem: prompt paczki i prompt pozycji kontroli w adapterze (`packetInstructions`, `closedCheckPrompt`), `PACKET_RESERVE`, wspólny prompt etapu zagadnień w `llm.ts` — zmieniłyby po cichu gramatykę, która przeszła bramkę, albo szkołę bez jej bramki. Ramię agenta stoi na przypiętym `main`, więc strojenie go nie dotyka.
4. **Bieg potwierdzający na zamrożonej konfiguracji:** 3 materiały × przebieg bazowy × 2 biegi + materiał wstrzymany × agent × 2 (biegi agenta z rundy 0 zostają); nowe arkusze per materiał (z biegami agenta: ok. 12 biegów), oba sędziowie od nowa. Werdykty rundy 0 służą tylko strojeniu.
5. Wynik negatywny po 2 rundach albo w biegu potwierdzającym → decyzja właściciela (§8), bez dalszego strojenia.

**Szacunek kosztu** (pomiary: agent rozdziału 0,13–0,19 USD, szkoły 0,45–0,49; przebieg bazowy gramatyki 0,18–0,28; sędzia 2 ok. 0,16 USD na 100 wierszy):

| | Rozdział | Szkoła |
|---|---:|---:|
| wzorcowe | < 0,1 | < 0,1 |
| runda 0 (8 biegów) | ok. 1,7 | ok. 3,7 |
| strojenie (do 2 × 4 biegi bazowe) | do ok. 2,0 | do ok. 3,6 |
| potwierdzający (8 biegów) | ok. 1,9 | ok. 3,6 |
| sędzia 2 na arkuszach potwierdzających (ok. 780 wierszy) | ok. 1,3 | ok. 1,6 |
| **razem** (bez strojenia / z 2 rundami) | **ok. 5 / 7** | **ok. 9 / 12,6** |

**Limit rejestru kosztów sondy** (`UMIEM_PROBE_COSTS_CAP_USD`): rozdział **8 USD**, szkoła **14 USD**, osobne rejestry. Każdy run rezerwuje budżet runu (1 USD) jak dziś, więc biegi idą po kolei.

**Słabość próbki:** bieg potwierdzający przebiegu bazowego to ok. 6 lekcji × 50–80 ćwiczeń na przedmiot, w tym ok. 250 zamkniętych; 0 wad W1 daje górną granicę Wilsona ok. 1,5%, 2 wady — ok. 2,9%. Próbka nie odróżnia 1% od 3%; ćwiczenia jednego biegu są skorelowane, więc przedział jest optymistyczny — raport podaje liczniki per bieg (min–max).

### 7.8 Raport w opisie PR

Per klasa, ramię i materiał: wady / mianownik, odsetek, Wilson 95% u obu sędziów; liczniki per bieg; ocena punktów bramki; rundy strojenia (co zmieniono); minimum publikacji, „+N” i pokrycie per bieg; koszt i czas na lekcję i na przyjęte ćwiczenie; wzorcowe (z zastrzeżeniem §7.3); W6h i W2 pytań otwartych (szkoła); zgodność sędziów; słabość próbki; bilans §10 i znaki promptów z migawek; status decyzji właściciela. Bez identyfikatorów modeli w opisie PR i commitach (są w tym specu).

## 8. Wariant awaryjny

Gdy przedmiot przegra bramkę (po strojeniu albo w biegu potwierdzającym) i właściciel nie przyjmie wyniku:

- przedmiot zostaje na agencie (bez `baselinePool`); PR zostawia tylko kontrolę z §3 (potrzebną drugiemu przedmiotowi albo niezależną), resztę kodu wycofuje — także etap zagadnień z §4.1, bo agent bez `planGate` i przykładów planu to konfiguracja, której nie zmierzyła żadna bramka;
- **zamrożenie heurystyk tego przedmiotu znika** (AGENTS.md, punkt o kierunku z 2026-11-07; §2 specu zbiorczego);
- w issue #362 (albo nowym) zapisujemy termin ponownej bramki (najpóźniej 4 tygodnie albo po #279, co pierwsze), co ją uruchomi (nowy model generatora, prompt, warstwa z §8) i **plan wyjścia z dwóch generatorów**: przy drugiej porażce agent zostaje jedynym generatorem tego przedmiotu, a przebieg bazowy reszty — z datą przeglądu;
- 5c w zakresie niedotyczącym agenta (np. `planExamples` zostaje; testy mechaniki agenta przepięte z gramatyki na przedmiot, który na nim został).

## 9. Co zostaje, co znika

### 9.1 Tabela (linie bez testów na `main` 6de15af2; „znika” to szacunek z zakresów funkcji, do potwierdzenia w PR)

Ścieżki względem `packages/server/src/`.

| Plik | Linie | Zostaje (kto używa) | Znika | PR |
|---|---:|---|---:|---|
| `domain/lessons/agent/admission.ts` | 783 | `lessonRulesStep`, `snapshotOf`, `submitExamples`, `removeExercise` (kontrola końcowa), `lessonRules`, `lessonLeaks`, `rejectionOf` | ok. 450: oczyszczenie, kroki deterministyczne agenta, `precheckBatch`, `admitBatch`, kroki checkera, ustalenia podpowiedzi, kontroli otwartej i wariantów | 5a (oczyszczenie), 5b (2b), 5c |
| `domain/lessons/agent/status.ts` | 293 | status i limity zagadnienia, kontrola końcowa | ok. 15: haki `requiredTypes`, `objectiveGaps` | 5c |
| `domain/lessons/agent/solver.ts` | 252 | `solverView` | ok. 88: ślepe rozwiązanie | 5c |
| `domain/lessons/agent/plan.ts` | 83 | — (stałe do `english-chapter/prompts.ts`) | 83 | 5a |
| `domain/lessons/agent/state.ts`, `capable.ts` | 160 + 26 | całe | 0 | — |
| `subjects/english-chapter/agent-policy.ts` | 214 | do 5c `independentReserve` i pola wymagane typu | ok. 195 | 5a (bramki), 5c |
| `subjects/english-chapter/lexicon.ts`, `material-lexicon.ts` | 91 + 91 | — | 182 | 5a |
| `subjects/english-chapter/validators.ts` | 281 | reguły strukturalne (§4.3), polecenie tłumaczenia do `sanitize` | ok. 130 | 5a |
| `subjects/english-chapter/rules.ts` | 79 | 4 reguły strukturalne | ok. 40 | 5a |
| `subjects/english/listen-audibility.ts`, `english/rules.ts` | 73 + 22 | — | 95 | 5a |
| `subjects/school/hint-gate.ts` | 155 | — | 155 | 5b |
| `subjects/school/agent-policy.ts` | 120 | oczyszczenie bez bramki podpowiedzi (do modułu w 5c) | ok. 90 | 5b, 5c |
| `subjects/school/validators.ts`, `rules.ts` | 352 + 183 | uziemienie cytatów, rodziny, rachunki | ok. 27 + 25 (`termOccursIn`, `keyword_not_in_answer`, `keywords_family_rejected`; tekst `hint.reveals_words` do `typeRules`) | 5b |
| `subjects/school/quote-normalize.ts` | 159 | całe | 0 | — |
| `subjects/english-grammar/agent-policy.ts` | 54 | `typeExamples` → moduł | ok. 25 | 5c |
| `modules/materials/lessons/lesson-pool-agent.ts` | 702 | typy wejścia i wyniku, `poolStartState`, `addModePlan`, `lessonAgentLimits`, `objectivesToRun`, `slugOf`, `kindsOf` | ok. 420 | 5c |
| `…/lesson-pool-agent-tools.ts` | 823 | `parseLessonRecord`, `RejectionLogEntry` (ok. 50) | ok. 770 | 5c |
| `…/lesson-pool-agent-plan.ts` | 135 | — | 135 | 5a |
| `…/lesson-agent-check-run.ts` | 133 | — | 133 | 5b (2b) / 5c |
| `…/lesson-pool-agent-input.ts` | 125 | `lessonAvoidSentences` | ok. 95 | 5c |
| `…/lesson-pool-agent-policy.ts` | 122 | `RunCostMeter`, `agentFailureOf`, polityka domyślna | ok. 15 | 5b, 5c |
| `…/lesson-agent-outcome.ts`, `-checkpoint.ts`, `-generation.ts` | 378 + 220 + 558 | worker | ok. 35 + 5 + 25 | 5a–5c |
| `…/lesson-agent-timers.ts`, `lesson-baseline-pool.ts` | 104 + 392 | całe | 0 (przebieg bazowy rośnie, §9.3) | — |
| `providers/openai/lesson-pool-agent.ts` | 932 | `generatePacket`, `checkClosed`, prompty paczki i kontroli, `tracked`, mapowanie błędów | ok. 430 | 5a (planista), 5b (2b), 5c |
| poza §10: `ports/ai.ts` | 685 | porty paczki i kontroli | ok. 200 | 5c |
| poza §10: `providers/fake-lesson-agent.ts`, `fake-lesson-pool.ts` | 658 + 596 | fake paczki i kontroli | ok. 470 + 345 | 5a–5c |
| poza §10: testy tylko agenta (15 plików) | 5524 | — | 5524; testy mieszane (`admission`, `solver`, `status`, adapter, fake'i) maleją | 5a–5c |

Testy integracyjne zależne od agenta są przepinane, nie usuwane: skrypty fake'a agenta w `lesson-chapter`, `lesson-listen-choice`, `lesson-present-continuous`, `source-materials` (5a/5b); `agentGrammarSubject` w `lesson-agent-generation`, `lesson-generation`, `lesson-story`, `child-interests`, `helpers.ts` (5c).

### 9.2 Bilans §10

| Ścieżka | `main` 6de15af2 | po 5a | po 5b | po 5c |
|---|---:|---:|---:|---:|
| `domain/lessons/agent/` | 1597 | ok. 1480 | ok. 1330 | ok. 960 |
| `domain/lessons/subjects/` (bez `*.rule-cases.ts`) | 4336 | ok. 3800 | ok. 3580 | ok. 3440 |
| `lesson-agent-*`, `lesson-pool-agent*` | 3300 | ok. 3150 | ok. 3000 | ok. 1670 |
| `providers/openai/lesson-pool-agent.ts` | 932 | ok. 870 | ok. 760 | ok. 500 |
| przebieg bazowy (`lesson-baseline-pool.ts`, `closed-check.ts`, `packet-plan.ts`) | 556 | ok. 610 | ok. 640 | ok. 640 |
| **generowanie razem** | **10721** | **ok. 9910 (−810)** | **ok. 9310 (−600)** | **ok. 7210 (−2100); razem ok. −3500** |

Przy keywords w wariancie A i szkole bez kontroli 2b. Etap zagadnień rozdziału dokłada kilka linii w `lesson-drafts.ts` i `providers/openai/llm.ts` (poza ścieżkami §10, podane w PR).

**Rodzaje wywołań modelu w generowaniu po 5c:** paczka, kontrola zamkniętych (dwa kontrakty), etap zagadnień (rozdział i szkoła).

**Rozgałęzienia zależne od przedmiotu lub typu** (§10 specu zbiorczego): keywords razem z pytaniem otwartym i przyjmowane po innych ćwiczeniach zagadnienia (struktura danych: `familyId`), materiał w kontroli (pole modułu), `kind` w etapie zagadnień (pole `objectivesRules`), pola v3 usuwane przy braku `usesV3Payload`. Do 5c — `baselinePool` w workerze.

## 10. Prywatność, koszty, integracje

- **Generator paczki** dostaje to samo co agent: materiał, polecenie rodzica, karty, opis celu, zdania do unikania (wspólny materiał); tematy zdań tylko gramatyka. **Etap zagadnień rozdziału** — materiał i polecenie rodzica, jak dziś planista, ale przez `UMIEM_LLM_*` (jak szkoła). **Kontrola zamkniętych** — widok ćwiczenia bez klucza i tytułu celu, wiersz pola, w słuchaniu transkrypcja, w rozsypance ułożony klucz, w keywords prompt pytania otwartego, w szkole materiał. Nigdy imię, rok urodzenia, identyfikatory ani odpowiedzi dziecka.
- **Dzienniki** `[lesson-baseline]` — liczby, kody, identyfikatory reguł, typy i człony identyfikatorów zagadnień; bez treści ćwiczeń, podpowiedzi, materiału i powodów kontroli (istniejący test).
- **Koszty:** bez nowych operacji. Po 5b i 5c nie powstają nowe wiersze `agent_step`, `plan_step`, `check_solve`, `check_variants`, `check_hints`, `check_open`, `check_grade` (§23 i tabela specu kosztów: oznaczone jako historyczne).
- **Panel:** `generationServices` dla rozdziału obejmie `UMIEM_LLM_*` (etap zagadnień); `checkServiceIncludesMaterial` szkoły bez zmian (`true`); przy usunięciu kontroli 2b znika `openCheckService` z DTO katalogu lekcji (`packages/contracts`, tylko panel rodzica).
- **API → MCP → skill:** MCP i `SKILL.md` bez zmian — `learning-overview` nie obejmuje lekcji, a zmiana dotyczy opcjonalnego pola DTO panelu rodzica (web i panel wdrażane razem). Kid DTO bez zmian.
- **Migracja:** brak (schemat punktu kontrolnego odrzuca nieznane pola, `kind` już istnieje w temacie dynamicznym).
- **Wdrożenie:** przed każdym PR zapytanie tylko do odczytu o runy rozdziału / szkoły w toku (jak w etapie 4 §2); run w toku wznawia się przebiegiem bazowym z punktu kontrolnego agenta.

## 11. Dokumentacja (§16)

- `docs/architecture.md` §19.17 — rozdział i szkoła na przebiegu bazowym (kontrola wielu pól, keywords, materiał w kontroli, etap zagadnień rozdziału, oczyszczenie w kroku struktury); w 5c usunięcie opisu pętli agenta, kontroli 2b i źródła `planner`; §23 — operacje historyczne.
- AGENTS.md — przebieg bazowy dla wszystkich przedmiotów (w 5c bez `baselinePool` i `agentPolicy`), dane dla kontroli zamkniętych w szkole, usunięte akapity o agencie puli, etapie 2b i checkerze, katalog reguł bez reguł rozdziału z heurystyk; przy wariancie awaryjnym — zdjęcie zamrożenia heurystyk przedmiotu.
- Spec kosztów (tabela §2), spec zbiorczy (§3, §11 — stan etapu 5).

## 12. Testy

- `closed-check.test.ts`: pozycje pól dla match, group, cloze, keywords (kolejność pól = kolejność widoku, numery luk, wiersz `Question:`), widok bez klucza i przypisań, ćwiczenie przechodzi tylko przy przejściu wszystkich pól, `null` / brak pozycji pola = nie wiem.
- `packet-plan.test.ts`: plan rozdziału per `kind`; keywords w kubełku z limitem 1.
- `lesson-baseline-pool.test.ts`: źródło `input`, wznowienie z punktu kontrolnego agenta rozdziału (`dynamicTopic`, `planExamples` → `initialExamples`), keywords przyjmowane po innych ćwiczeniach zagadnienia (także keywords rodziny z zapasu), `familyId` keywords zgodne z rodziną po `scopeFamiliesToRun`, materiał w kontroli szkoły, oczyszczenie przedmiotu w kroku struktury (rozdział: polecenie tłumaczenia, pola v3; szkoła: podpowiedź, cytaty).
- Etap zagadnień: `kind` wymagany w schemacie i wyniku tylko przy `objectivesRules`; fake.
- Worker (integracja, fake'i): nowa lekcja rozdziału i szkoły przebiegiem bazowym, wznowienie, „dodaj N”, kontrola końcowa.
- `rule-cases.test.ts` bez przypadków usuniętych reguł; migawki promptu paczki rozdziału i szkoły (nowe); migawki promptu agenta rozdziału i szkoły znikają w 5c.
- E2E: speki rozdziału i szkoły na fake'ach przebiegu bazowego; `pnpm check`, `pnpm test:integration`, `pnpm test:e2e:shards`, testy architektury przed każdym PR.

## 13. Decyzje do zatwierdzenia

1. Podział na 5a / 5b / 5c (§2).
2. Etap zagadnień rozdziału przez istniejący etap szkoły (`UMIEM_LLM_*`), bez `planGate`, listy pokrycia i przykładów z planu (§4.1).
3. Usunięcie `requiredTypes` i `listen-audibility.ts` bez warunku (§4.3).
4. Keywords: wariant A (z pytaniem otwartym w jednej paczce), B (osobna paczka po pytaniach) albo C (bez keywords) (§5.1).
5. Kontrole 2b szkoły: przebieg bazowy bez nich; zostają tylko przy przewadze agenta > 2 pp w W6h albo W2 pytań otwartych u obu sędziów (§5.3).
6. „0 ujawnień”: twardo jako asercja kodu na każdym szkicu; W6 ślepej oceny porównaniem z agentem (§7.5 pkt 1).
7. Progi, minimum publikacji 5 z 6 z „+N”, modele, limity kosztu na lekcję (0,60 / 0,80 USD) i rejestru (8 / 14 USD), materiały, najwyżej 2 rundy strojenia wyłącznie na polach przedmiotu, bieg potwierdzający (§7).
8. Wariant awaryjny i termin ponownej bramki (§8).

## 14. Historia

- **v1** — pierwsza wersja.
- **v2.1** — zatwierdzenie właściciela; sędzia 1 = skryptowy Claude Opus 5.5 przez OpenRouter (kredyt właściciela).
- **v2.2** — decyzja właściciela z 2026-11-08 po biegu potwierdzającym rozdziału (sędzia 1 przepuszcza, sędzia 2 nie: W6 ram na kartach, W9 przykładów kart z „and” ze strojenia 2; koszt sędziego 2 ok. 0,27 USD na 100 wierszy zamiast 0,16): przed każdym płatnym strojeniem darmowy przegląd promptów przedmiotu i istniejących zrzutów przez Opusa (subagent sesji, bez OpenRoutera); PR 5a po zaliczonej bramce u sędziego 1 i poprawkach wad wskazanych przez sędziego 2, z jednym kontrolnym biegiem ocenianym tylko przez sędziego 1; w 5b rundy z sędzią 1; jedno wspólne strojenie i jeden bieg potwierdzający z sędzią 2 dla obu przedmiotów na końcu, przed scaleniem 5c (§7.5–§7.7 stosowane wtedy).
- **v2** (trzej krytycy):
  - kontrola wielu pól jako pozycje paczki w dzisiejszym kształcie wyniku (bez nowego promptu), numery luk tylko w widoku kontroli, pola oceniane niezależnie, widok keywords z pytaniem;
  - keywords: trzy warianty do decyzji (z pytaniem otwartym w jednej paczce, osobna paczka, bez keywords), limit 1 zgodny z `typeRules`, przyjmowanie po innych ćwiczeniach zagadnienia, `familyBase` w wejściu;
  - „0 ujawnień”: asercja kodu w trybie `coverage` (nie ma trybu „publikacji”), W6 sędziów porównaniem — twarde 0 u sędziów obaliłoby bramkę szumem;
  - strojenie tylko na polach przedmiotu (wspólne prompty adaptera i `PACKET_RESERVE` zmieniałyby gramatykę), ramię agenta na przypiętym `main`; dydaktyka usuwanych reguł i instrukcja podpowiedzi do promptu przedmiotu przed rundą 0;
  - kontrole 2b: decyzja z porównania z ramieniem agenta, bez sondy odtwarzającej; warunek dostępności gradera w `lessonAgentPublicFromEnv` zostaje;
  - oczyszczenie przedmiotu w `sanitizeFreshLessonDraft` dla obu generatorów, pola v3 ogólnie, usunięcie haka `refineGeneratedPool` i `lesson.refine_unnamed`; `listen-audibility.ts` bez warunku; `stemsOf` zostaje;
  - `kind` wymagany, liczba zagadnień tylko w tekście `objectivesRules`; koszt etapu zagadnień poza budżetem runu — koszt lekcji z dziennika kosztów;
  - 5c: `independentReserve` jako stała, `ruleNotes` i `slack` znikają, bez zmiany nazw pól;
  - wariant awaryjny 5a bez etapu zagadnień; minimum publikacji 5 z 6 z „+N”; „≤ 1 wada” przy małych mianownikach; formy do szukania w pokryciu; W4 szkoły zdefiniowane przez elementy wymagane; zmiany danych w narzędziach sondy wymienione; wzorcowe bez zbędnych wywołań; koszty z arkuszami ok. 780 wierszy, limit szkoły 14 USD.
