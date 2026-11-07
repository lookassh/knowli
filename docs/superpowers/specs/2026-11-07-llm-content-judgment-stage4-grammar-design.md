# Etap 4: gramatyka na przebiegu bazowym, usunięcie heurystyk gramatyki — design

Wersja 2.1, 2026-11-07, po przeglądzie trzech krytyków specu i trzech krytyków planu (prostota, poprawność kodu i danych, dydaktyka i pomiar). Zatwierdzona przez właściciela 2026-11-07 (v2; v2.1 to poprawki implementacyjne po krytykach planu). Issue #361, epik #358. Spec zbiorczy: `2026-11-07-llm-content-judgment-design.md` (v4: §4, §5, §8, §9, §10, §11, §12.2, §13, §16, §17). Spec etapu 2: `2026-11-07-llm-content-judgment-stage2-baseline-design.md` (v3.1) i raport bramki w PR #367. Stan kodu: `main` 0e3277c5. Zamyka #361, #369, #288.

## 1. Cel i granice

`english_grammar` generuje się przebiegiem bazowym z etapu 2 na ścieżce workera. Heurystyki językowe gramatyki, ich opisy dla modelu i przypadki reguł znikają; bilans linii na ścieżkach §10 jest ujemny. Rozdział (`english_chapter`) i szkoła (`school`) zostają na agencie do etapu 5 — wspólny kod zmieniamy tylko tam, gdzie gramatyka na przebiegu bazowym tego wymaga.

Poza zakresem: rozdział i szkoła (etap 5), zestawy słówek, #279 (poziom materiału), #280 (Present Continuous v2), #370 (karty katalogu pokazują odpowiedzi — najpierw decyzja właściciela, czy zmienia się rubryka, czy karty; to nie jest drobna zmiana tekstu), warstwy z §8 bez decyzji właściciela.

## 2. Stan produkcji (sprawdzone 2026-11-07, tylko odczyt)

| Co | Liczba |
|---|---|
| wersje zestawów, rewizje ćwiczeń, runy i postęp z `present_continuous` | 0 |
| runy w toku (`queued`, `running`), wszystkie przedmioty | 0 |
| lekcje gramatyki: Present Simple | 1 opublikowana, 3 szkice w `review` |
| lekcje gramatyki: „to be” | 1 opublikowana (wersja tematu 1) |
| `to_be.contractions` | w 1 opublikowanej lekcji „to be” (16 rewizji); w żadnym szkicu |

Wnioski: usunięcie heurystyk Present Continuous nie wymaga ścieżki zgodności (§13 specu zbiorczego potwierdzone). #369 musi zachować wersję 1 tematu „to be”, bo przypina ją opublikowana lekcja (§6). Szkice Present Simple po wdrożeniu przechodzą przez samą walidację struktury (edycja, publikacja) i mogą dogenerować zagadnienie przebiegiem bazowym (§4.3).

## 3. Zakres pilota — do decyzji właściciela

**Rekomendacja: cała gramatyka naraz** (Present Simple, „to be”, Present Continuous).

- Bramka po etapie 2 zmierzyła przebieg bazowy na wszystkich trzech tematach na module bez heurystyk; to jest stan po tym etapie.
- Opublikowane lekcje są niezmienne, a nowe zatwierdza rodzic — nowa ścieżka nie zmienia niczego, co dziecko już ćwiczy.
- Pilot samego Present Continuous wymagałby wyboru generatora per temat, zostawienia agenta i heurystyk Present Simple i „to be” i dwóch ścieżek gramatyki do utrzymania; heurystyki PS i „to be” to większość `validators.ts` i `rules.ts`, więc bilans §10 prawie by nie spadł.

Nie znalazłem konkretnego powodu przeciw. Najsłabszy punkt pełnego zakresu — luki w zagadnieniach z krótkimi odpowiedziami w Present Simple i „to be” (§5.1) — dotyczy też pilota, bo to samo zagadnienie dogenerowuje się tą samą ścieżką.

## 4. Przebieg bazowy na ścieżce workera

### 4.1 Wybór generatora

Jedno rozgałęzienie w `lesson-agent-generation.ts` (`attempt`): przedmiot z polem modułu `baselinePool: true` → `runLessonBaselinePool`, pozostałe → `runLessonPoolAgent`. Pole ma tylko gramatyka; przebieg bazowy obsługuje wyłącznie zagadnienia z katalogu i odrzuca inne źródło błędem walidacji. Rozgałęzienie zależy od pola modułu, nie od identyfikatora przedmiotu (PR wymienia je w §10). Pole zamiast źródła `catalog` (v2): testy integracyjne mechaniki workera i agenta (ok. 70 przypadków na gramatyce ze scenariuszami `runObjective`) zostają na agencie przez przedmiot testowy bez pola, a etap 5 usuwa je razem z agentem. Oba przebiegi mają te same typy wejścia i wyniku, więc punkt kontrolny, scalenie próby (`mergeAttemptIntoProgress`), wynik próby (`lessonAgentRunOutcome`), `MAX_AUTOMATIC_ATTEMPTS`, termin runu, budżet, anulowanie, kontrola końcowa i zapis szkicu zostają bez zmian.

Zależności: `LessonAgentDeps.agent` i `.checker` już są obiektami adaptera z metodami `generatePacket` i `checkClosed` (etap 2); typy pól rozszerzamy o porty `LessonPacketGenerator` i `ClosedExerciseChecker`.

**Polityka agenta gramatyki zostaje** (`agent-policy.ts`, 49 linii) do etapu 5, który usuwa cały typ razem z agentem. Przebieg bazowy korzysta z jej pól wspólnych z agentem (`independentReserve`, `slack` w limitach zapisu, `typeExamples` i dopisek `variants.duplicate` „formy ze skrótem i pełne jako osobne warianty” w sekcji `general` księgi reguł — był w prompcie zmierzonym w bramce); pola tylko dla agenta (typy ślepego rozwiązania, warianty) nie mają w gramatyce odbiorcy. Bez tej polityki trzeba by przenieść pola do `SubjectModule`, dodać obsługę braku polityki w ok. 20 miejscach i przepiąć testy agenta — praca, którą etap 5 i tak wykona przy usunięciu typu.

### 4.2 Punkt kontrolny i limity

- **Punkt kontrolny per zagadnienie, zapisywany na końcu próby** — jak w etapie 2: `onObjectiveSettled` dla każdego zagadnienia po walidacji puli. Porażka zagadnienia albo termin runu i tak rozliczają wszystkie zagadnienia na końcu (`lesson-baseline-pool.ts:347-377`), a ponowienie startuje z punktu kontrolnego (§4.3). Tracimy tylko próbę przerwaną w połowie restartem workera albo błędem kodu: jedna próba to średnio 63–88 s i ok. 0,17–0,26 USD (bramka). Zapis po każdym zagadnieniu w trakcie próby wymagałby przyjmowania w kolejności lekcji i zmiany semantyki przykładów kart (przykład wcześniejszej karty usuwałby późniejsze ćwiczenia, najmocniej ostatnie zagadnienie „to be” — `short_answers`) — nie robimy go; znane ograniczenie w §19.17.
- **Te same limity co zapis.** Status zagadnienia w przebiegu bazowym liczy się z `lessonAgentLimits` (te same `targetCount` co `finalize` i `completeObjectivesOnLesson`), a nie z `targetCount: 0` jak w etapie 2 — inaczej zagadnienie `complete` w punkcie kontrolnym (pomijane przy wznowieniu) mogłoby po zapisie okazać się luką. Przyjmowanie do puli zostaje z limitami kubełków planu paczek (bez limitu łącznego `maxExercises`). Plan sprawdza, że kontrola końcowa `finalize` nie tnie ćwiczeń przyjętych ponad `maxExercises` (cele etapów podniesione do minimum z rezerwą mogą przekroczyć `targetCount + listen + slack`); jeśli tnie, przebieg bazowy dostaje ten sam limit łączny.
- **Wpis zagadnienia** zawiera tylko ćwiczenia przyjęte w tej próbie (`entry.id !== null`, jak `poolExercises` agenta) — bez `fixed`.
- **Przyjęcie kandydata kroki 3–4 przyjmowania agenta** (reguły lekcji i ujawnienia, `admission.ts`, wydzielone do wspólnej funkcji) zamiast `lessonInvariantCheck`: kandydat odpada także wtedy, gdy jego dodanie czyni nową ofiarą ćwiczenie `fixed` (duplikat albo ujawnienie ćwiczenia szkicu w dogenerowaniu — `lessonInvariantCheck` pomija ofiary `fixed`). Kody odrzuceń są kodami agenta (`lesson_pool`, `lesson_extra`, `leak_victim`, `leak_source`, z etykietami) z identyfikatorami reguł (dziś `ruleIds: []`), bez treści — więc kontrolny przebieg rozstrzyga przyczynę luk z §5.1.

### 4.3 Wznowienie i dogenerowanie

Przebieg bazowy przestaje odrzucać pola wznowienia (etap 2: `AppError("validation")`) i obsługuje wejście, które już dziś buduje `lessonAgentRunInputFor`:

- **wznowienie** (próba 2+): `fixed` (ćwiczenia zagadnień `complete` z punktu kontrolnego) wchodzi do stanu walidacji puli, `skipObjectives` są pomijane, `initialExamples` wchodzą jako przykłady stanu. Punkt kontrolny zapisany przez agenta (run gramatyki w toku przy wdrożeniu) ma ten sam format i wznawia się tak samo: dla tematu katalogowego nie ma przykładów planu, a ćwiczenia `fixed` sprawdza ponownie kontrola końcowa;
- **dogenerowanie** („dodaj N”, `target.mode = "add"`): jedno zagadnienie. Liczby z istniejącej `addModePlan` (braki etapów + N, reszta dodatku słuchowego; eksport z `lesson-pool-agent.ts`). Paczki i limity kubełków powstają wprost z tych liczb — bez podnoszenia do minimum, bez paczki `lesson_notice` i bez przykładów kart (`examplesFixed`); status z limitów `addModePlan`. `fixed` = ćwiczenia szkicu (+ dodane w poprzedniej próbie), `initialExamples` = przykłady szkicu, `extraExposureSources` = zdania historyjki szkicu (źródła ujawnień, jak u agenta);
- **zdania do unikania** z `avoidSentencesFor` na stanie startowym, a więc z ćwiczeniami `fixed` (szkic albo zagadnienia z punktu kontrolnego) i przykładami — pkt 5 issue („istniejący szkic na liście unikaj”).

### 4.4 Niepowodzenie, terminy

Bez zmian względem etapu 2: jedno ponowienie błędu technicznego, potem porażka zagadnienia z kodem dostawcy; wynik próby i ponowienia runu z `lessonAgentRunOutcome` i `MAX_AUTOMATIC_ATTEMPTS`; po wyczerpaniu rodzic widzi istniejący stan niepowodzenia. Ćwiczenie niesprawdzone nie trafia do szkicu. Terminy: domyślne `callTimeoutMs` i `checkerTimeoutMs` (90 s) i termin runu (600 s). W biegu potwierdzającym etapu 2 lekcja trwała średnio 63–88 s (27 przebiegów, ok. 30–34 paczek, równoległość 4), bez przekroczeń limitu żądania — terminów nie zmieniamy.

### 4.5 Runy w toku przy wdrożeniu

Na produkcji nie ma runów w toku (§2). Gdyby przy wdrożeniu był run gramatyki, wznawia się przebiegiem bazowym (§4.3) — bez kodu migracji. Anulowanie i „Ponów” (#299) zostają bez zmian. Przed wdrożeniem: zapytanie z §2.

### 4.6 Fake'i (tryb `UMIEM_FAKE_PROVIDERS=1`, E2E)

`FakeLessonPoolAgent.generatePacket` buduje ćwiczenia typu paczki istniejącym generatorem fake'a zagadnień (`stagedObjectiveExercises`) z przesunięciem zależnym od zagadnienia i typu paczki (paczki biegną równolegle, a wspólne przesunięcie dałoby duplikaty i odrzucenia `lesson_pool`), z unikaniem zdań kart i `avoidSentences` jak dziś i z `FAKE_SLOW_MARKER`. `FakeExerciseChecker.checkClosed` podaje deterministycznie klucz ćwiczeń fake'a (pierwsza opcja albo pierwszy segment, „tak” dla rozsypanki; plan sprawdza kolejność opcji w widoku). E2E `lesson-parent.spec.ts` oczekuje pustych `rejectionCodes` i kompletnych zagadnień — fake ma ich nie psuć. Tryb fake nie zapisuje kosztów (jak dziś).

## 5. Poprawki z bramki etapu 2

### 5.1 `PACKET_RESERVE` 3 i zdania do unikania w trakcie runu

Raport bramki: minimum publikacji niespełnione w 2 z 9 przebiegów; zagadnienia niekompletne wobec minimum z rezerwą — w 6 z 9 (w „to be” `short_answers` w 3 z 3). Zrzuty biegu potwierdzającego (9 przebiegów bazowych): 50 z 71 odrzuceń to `lesson_pool` (reszta to kontrola zamkniętych), w tym 43 w `lesson_open_answer` etapu samodzielnego, skupione w `short_answers` (PS i „to be”) i `question` — zagadnieniach z kilkunastoma możliwymi odpowiedziami („Yes, she does.”). Najbardziej prawdopodobna przyczyna to ujawnienie (odpowiedź samodzielna równa zdaniu pokazanemu wcześniej), ale zrzuty nie mają identyfikatorów reguł — stąd §4.2 (dziennik). W jednym przebiegu PS `short_answers` straciło też wszystkie przykłady kart.

- **`PACKET_RESERVE` = 3** (pokrętło zapasu ze specu etapu 2 §8; zatwierdzony kandydat z bramki). Koszt ok. +0,025 USD na lekcję. Dla minimum publikacji (2 samodzielne) prawdopodobnie wystarczy; dla kompletu z rezerwą (3) przy ok. 70% strat w `short_answers` — raczej nie. Brak kompletu rodzic widzi jako lukę i uzupełnia dogenerowaniem.
- **Zdania do unikania dokładane w trakcie runu — nie dodajemy.** Paczki zagadnienia biegną równolegle, więc zdania z innych paczek tego zagadnienia nie są znane w chwili generowania; dokładanie wymagałoby kolejności paczek (dłuższy run i nowy kod). To warstwa z §8 („za mało ćwiczeń do minimum publikacji”) — tylko po pomiarze i decyzji właściciela, jeśli zapas 3 nie wystarczy.

### 5.2 Etykiety kodów odrzuceń

Nowe kody przebiegu bazowego dostają polskie etykiety w `messages.lessons.agentRejectionReasons`: `shape_type` („ćwiczenie innego typu niż zamówione”), `over_count` („więcej ćwiczeń niż zamówiono”), `check_wrong_set` („drugi model wskazał inną odpowiedź”), `check_unknown` („drugi model nie rozstrzygnął odpowiedzi”), `check_order_no` („drugi model uznał ułożenie za błędne”). Pozostałe kody (`shape_*`, `rule_exercise`, `lesson_pool`) mają etykiety od etapu agenta. Tekst `checkServiceInfo` („drugi model rozwiązuje je na próbę”) pasuje do obu ścieżek i zostaje; `checkServiceIncludesMaterial` gramatyki zostaje `false` (polityka bez zmian).

### 5.3 Pozostałe znane ograniczenia etapu 2

`packetInstructions` bez `voiceTone` i widok kontroli bez zastępczego tytułu dla `notice`/rozsypanki bez `instructionPl` — bez zmian (pierwsze dotyczy szkoły, drugie było w zmierzonej konfiguracji).

## 6. #369: zagadnienie `to_be.contractions`

- Nowa wersja tematu `to_be` 2: wersja 1 bez zagadnienia `contractions` (składana z obiektów wersji 1, bez kopii tekstów). Wersja 1 zostaje w `topics`, bo przypina ją opublikowana lekcja (§2); rejestr i katalog dają nowym lekcjom najnowszą wersję. To jest materiał „to be” zmierzony w biegu potwierdzającym (`to-be-objectives.json` bez skrótów).
- Edycja opublikowanej lekcji v1 tworzy szkic na v1, nadal z `contractions`; dogenerowanie tego zagadnienia idzie przebiegiem bazowym bez dawnego walidatora, z promptem „skrót i pełna forma są obie poprawne”. Świadomie bez osobnej ścieżki: jedna lekcja na produkcji, rodzic zatwierdza szkic.
- Karty pozostałych zagadnień pokazują skrót jako informację („is not → isn't”), nie jako wymóg — bez zmian. Kategoria błędu `wrong_contraction` zostaje (grader może ją przypisać).
- Testy zakładające jedną wersję tematu (`module.test.ts`, `lesson-materialize.test.ts`: `topics.find(t => t.id === "to_be")`, mapa `fromEntries` po id) — do poprawy, żeby sprawdzały właściwą wersję.

## 7. Co znika, co zostaje

Liczby linii (bez testów) na `main` 0e3277c5.

| Plik | Linie | Los |
|---|---:|---|
| `english-grammar/present-continuous-validation.ts` | 1843 | znika |
| `english-grammar/present-continuous-tense-choice.ts` | 471 | znika |
| `english-grammar/present-continuous-exercise-rules.ts` | 433 | znika |
| `english-grammar/validators.ts` | 488 | znika (cały; §7.1) |
| `english-grammar/rules.ts` | 830 | znika; `rules: {}` |
| `english-grammar/time-markers.ts` | 374 | znika |
| `english-grammar/be-agreement.ts` | 241 | znika |
| `english-grammar/present-continuous-guidance.ts` | 131 | znika; wskazówki do katalogu (§8) |
| `english-grammar/present-simple-forms.ts` | 76 | znika |
| `english/ing-forms.ts` | 247 | znika (używa go tylko gramatyka) |
| **razem znika** | **5134** | |
| `english-grammar/grammar.rule-cases.ts`, `present-continuous.rule-cases.ts` | 107 + 145 | znikają (poza §10) |
| testy powyższych plików (`*-validation`, `*-tense-choice`, `*-exercise-rules`, `validators`, `time-markers`, `be-agreement`, `ing-forms`) | ok. 2460 | znikają |
| migawki promptu agenta gramatyki (`lesson-pool-prompt.english_grammar*.txt`, 4 pliki, ok. 117 tys. znaków) | — | znikają; migawka paczki PC zostaje (nowa treść) |
| `tests/probes/grammar-plain-subject.ts` i test, `present-continuous-stats.ts` z testem (`sceneShare` liczony heurystyką wskaźników) | — | znikają; wariant sondy `agent_plain` znika |
| `english-grammar/agent-policy.ts` | 49 | zostaje do etapu 5 (§4.1) |
| `english-grammar/module.ts`, `prompts.ts`, `type-examples.ts`, `error-categories.ts`, `topics/*` | — | zostają; `module.ts` z `validateExercise: () => []` i `rules: {}` |
| `english/normalizer.ts`, `contractions.ts`, `card-sentences.ts` | — | zostają (ujawnienia, duplikaty, karty) |
| `english/listen-audibility.ts`, `english/rules.ts` | — | zostają dla rozdziału (etap 5); gramatyka przestaje ich używać |
| kontrole strukturalne (`pool-validation.ts`, `rules/core-rules.ts`, `lesson-rules.ts`, `exposure-leaks.ts`, `lesson-coverage.ts`, `catalog-validation.ts`) | — | zostają |
| agent (`domain/lessons/agent/`, `lesson-pool-agent*`, `lesson-agent-*`) | — | zostaje dla rozdziału i szkoły; zmiany tylko z §4 |

Testy agenta, które używają `englishGrammarSubject` jako przedmiotu agenta i opierają się na regułach lub walidatorze gramatyki (np. `admission.checks.test.ts`, `admission.leaks.test.ts`), plan przepina na przedmiot testowy (`testing/agent-test-subject.ts`) albo usuwa przypadek, który sprawdzał samą heurystykę.

### 7.1 Walidator przedmiotu

Gramatyka dostaje `validateExercise: () => []` (pole zostaje wymagane — jedno wywołanie w `pool-validation.ts`, bez zmiany typu), jak moduł sondy etapu 2. Znika też jedyna reguła porównawcza walidatora — `grammar.translation_prompt_equals_answer` (bodziec tłumaczenia równy odpowiedzi): bramka zmierzyła przebieg bez niej. Słyszalność opcji w słuchaniu (`english.listen_sibilant_merge`) też wypada z gramatyki: bramka bez niej dała W8 0/54 u obu sędziów, a mechaniczne sprawdzenie tych 54 ćwiczeń — 0 trafień; górna granica Wilsona 6,6% (powyżej progu 3%) — próbka nie wyklucza rzadkiej wady, raport to podaje. Ręczna edycja i publikacja szkicu gramatyki przechodzą przez samą walidację struktury (§9 specu zbiorczego).

### 7.2 Bilans §10 (szacunek do potwierdzenia w PR)

| Ścieżka | `main` | po etapie 4 |
|---|---:|---:|
| `domain/lessons/agent/` | 1582 | ok. 1582 |
| `domain/lessons/subjects/` (bez `*.rule-cases.ts`) | 9321 | ok. 4270 |
| `lesson-agent-*`, `lesson-pool-agent*` | 3255 | ok. 3270 |
| `providers/openai/lesson-pool-agent.ts` | 931 | ok. 935 |
| przebieg bazowy (`lesson-baseline-pool.ts`, `closed-check.ts`, `packet-plan.ts`) | 536 | ok. 580 |
| **generowanie razem** | **15625** | **ok. 10640 (−5000)** |
| ocena: `evaluate.ts` + `modules/learning/lessons/` | 711 + 4676 | bez zmian |

Dochodzą: rozgałęzienie i typy w workerze (§4.1), wznowienie i dogenerowanie (§4.3), notatki dydaktyczne w katalogu (§8, kilkadziesiąt linii tekstu w `topics/*`), fake'i (`providers/fake-*`, poza §10).

## 8. Dydaktyka w katalogu

Nowe opcjonalne pole zagadnienia katalogu `generationNotesEn` (zwykły tekst po angielsku) w `LearningObjective`. Trafia wyłącznie do promptu paczki (`buildPoolInput`/instrukcje paczki), zaraz po `descriptionEn` — nie do modelu oceniającego i nie do `AgentObjective` ani punktu kontrolnego (przebieg bazowy czyta temat z katalogu). `descriptionEn` idzie też do gradera (`lesson-attempts.ts:486` → wejście gradera) i jest zapisywane w szkicu z limitem 400 znaków (`lesson-drafts.ts`), więc dopisanie tam instrukcji generowania zmieniłoby wejście gradera zmierzone w etapie 3 i zostałoby ucięte.

Treść:

1. **Siedem stałych wskazówek** z modułu sondy etapu 2 (`PC_GUIDANCE`, `PC_FORMS_TRANSLATION_GUIDANCE`, `PC_TENSE_CHOICE_GUIDANCE`, `PC_NOW_OR_USUALLY_GUIDANCE`, `PC_NOW_OR_USUALLY_MORE_GUIDANCE`, `TO_BE_GUIDANCE`, `PICTURE_CHOICE_GUIDANCE`) przy tych samych zagadnieniach co w sondzie (warunki `when` ich reguł), jako literały w plikach tematów; wskazówki całego tematu dołączane do każdego zagadnienia tematu wspólną stałą pliku. Jedna poprawka tekstu: w `PC_GUIDANCE` „never a verb of the table as an adjective after is” → „never a verb used as an adjective after is” (tabela czasowników znika). W zmierzonej konfiguracji wskazówki stały w opisach reguł w bloku typu, teraz stoją przy celu i trafiają do każdej paczki celu: `PC_FORMS_TRANSLATION_GUIDANCE` była tylko w paczkach tłumaczeń (zaczyna się od „A translation…”, więc to nieszkodliwe), a `PICTURE_CHOICE_GUIDANCE` była w każdej paczce „to be” — świadomie zawężona do `to_be.affirmative_forms`, jedynego celu, którego dotyczy jej tekst. Mierzy to §9.
2. **Pułapki z usuwanych heurystyk**, których nie ma w kartach, `descriptionEn`, przykładach typów, wskazówkach ani w prompcie paczki — po jednym zdaniu, tylko dydaktyka, bez list sprawdzeń (listy wskaźników czasu, tabele czasowników `-ing` i czasowników stanu opisywały sprawdzenia kodu; bramka zmierzyła prompt bez nich). Przegląd krytyków dydaktyki wskazał cztery: Present Continuous ze wskaźnikiem przyszłości (today, tomorrow, on Monday) znaczy przyszłość, więc ćwiczenie „teraz” go nie używa; samo „now” w przeczeniu Present Continuous bywa czytane jako „obecnie” — przeczenie dostaje mocny wskaźnik albo scenkę; twierdząca krótka odpowiedź nie kończy się skrótem („Yes, I'm.”, „Yes, she's.” są błędne — inaczej trafią do wariantów i dadzą fałszywe „dobrze”); podmiot bez liczby mnogiej widocznej w formie (fish, sheep, deer) dopuszcza dwie formy — nie używać go bez słowa liczby. Plan robi pełny inwentarz wpisów `rules.ts` i `*.rule-cases.ts` z etykietą „już w katalogu/prompcie” / „pułapka → zdanie” / „opis sprawdzenia → odpada”; spodziewana skala: kilka zdań na temat.

Bez nowych reguł kodu. Odbiorca w prompcie — stały jak dziś (#279). `PC_TENSE_CHOICE_GUIDANCE` prosi o co najmniej połowę scenek; po usunięciu `sceneShare` (§9) nikt tego nie mierzy — przechodzi do #280.

## 9. Kontrolny przebieg sondy

Raport etapu 2 jest głównym dowodem jakości. Kontrolny przebieg sprawdza kod aplikacji po zmianach na ścieżce workera: istniejąca sonda `probe:chapter` (przypadki użycia z bazą jak w workerze, adaptery z `lessonAgentDepsFromEnv`, zapis szkicu, luki po zapisie, „+N” przez `regenerateObjective`, zrzut puli w formacie arkusza), rozszerzona o wybór tematu gramatyki i zagadnienia „+N” — produkcyjny moduł gramatyki, notatki z §8, `PACKET_RESERVE` 3, limity z §4.2. Sonda `probe:agent` (własne adaptery, inne domyślne modele) nie służy do tego przebiegu.

- **Biegi:** „to be” (wersja 2) × 3 — temat z największym ryzykiem luk; Present Simple × 1, Present Continuous × 1; jedno dogenerowanie („dodaj 3” w `short_answers` „to be” na szkicu z pierwszego biegu) — najmniej zmierzona ścieżka, zależna od listy unikania. Materiały sondy etapu 2 (fikcyjne). Wznowienie z punktu kontrolnego sprawdzają testy na fake'ach (bez płatnego biegu).
- **Sędzia:** sędzia 2 z etapu 2 (automatyczny, rodzina OpenAI), ta sama zamrożona rubryka `rubric-stage2.md`; nowe arkusze z samymi wierszami przebiegu bazowego.
- **Kryteria** (§12.2 i decyzje bramki): W1, W2, W3 ≤ 1%; W5, W7–W9 ≤ 3%; W4 i W6 w zakresie przebiegów bazowych bramki u sędziego 2 (min–max per przebieg i temat) — agent gramatyki nie biegnie, porównujemy z zatwierdzonym wynikiem; przy wyniku poza zakresem jeden powtórny bieg tego tematu przed jakąkolwiek zmianą; minimum publikacji w każdym biegu; koszt ≤ 0,60 USD na lekcję.
- **Raport:** liczby per klasa i temat; status każdego zagadnienia (komplet z rezerwą / minimum publikacji / brak); odrzucenia per kod, reguła (§4.2) i zagadnienie wobec etapu 2; mechaniczna liczba kluczy ze skrótem bez wariantu z pełną formą (bramka: 1/164); wynik dogenerowania (dodane z zamówionych); koszt, czas, znaki promptów z migawek.
- **Słabość:** ok. 450 ćwiczeń z 5 biegów, w tym ok. 160 zamkniętych; 0 wad W1 daje górną granicę Wilsona ok. 2,3% — przebieg wykrywa regresję, nie potwierdza progu 1%. Przy przekroczeniu progu: najpierw prompt, notatki albo zapas (§12.2 specu zbiorczego), potem decyzja właściciela.
- **Koszt (szacunek):** generowanie ok. 1,15 USD (3 × 0,17 + 0,25 + 0,26 z bramki, +10% za zapas), dogenerowanie ok. 0,02, sędzia 2 ok. 0,8; razem ok. 2 USD. Limit rejestru kosztów sondy: 3,5 USD. Bieg płatny tylko po zgodzie właściciela.

Sonda: wariant `baseline` woła produkcyjny rejestr przedmiotów; `agent` zostaje dla rozdziału i szkoły (etap 5). `sceneShare` znika razem z heurystyką wskaźników.

## 10. Prywatność, koszty, integracje

- **Generator paczki** dostaje to samo co agent: materiał, polecenie rodzica, karty, opis celu i notatki z katalogu, zdania do unikania (wspólny materiał: karty, przykłady, ćwiczenia szkicu, zdania historyjki szkicu — nigdy z historii dziecka), tematy zdań. **Kontrola zamkniętych** — widok ćwiczenia bez klucza i tytułu celu, w słuchaniu transkrypcję, w rozsypance ułożony klucz. Nigdy imię, rok urodzenia, identyfikatory ani odpowiedzi dziecka.
- **Dzienniki** `[lesson-baseline]` i `[lesson-agent]` — liczby, kody, identyfikatory reguł, typy i człony identyfikatorów zagadnień; bez treści ćwiczeń i powodów kontroli (test z etapu 2 zostaje).
- **Koszty:** operacje `packet_generate` i `check_closed` (feature `lesson_generation`) zaczynają trafiać do `provider_usage_events` na produkcji — aktualizacja §23 i tabeli specu kosztów (bez dopisku „tylko sonda”). Adapter jest już w `PAID_ADAPTERS`; test inwentarza uzupełniamy tylko, jeśli tego wymaga.
- **Panel:** `generationServices`, `checkService` i `checkServiceIncludesMaterial` bez zmian dla gramatyki (ten sam model generatora i kontroli, kontrola bez materiału); etykiety kodów §5.2.
- **API → MCP → skill:** bez zmian. DTO katalogu, szkicu i Kid DTO zachowują kształt (nowe etykiety to wartości istniejącego `rejectedReasons`); `learning-overview` nie obejmuje lekcji, `SKILL.md` bez zmian.
- **Migracja:** brak (operacja kosztu to tekst; wersja tematu i notatki są w kodzie).

## 11. Dokumentacja (§16)

- `docs/architecture.md` §19.17 — przebieg bazowy jako generator gramatyki (paczki, kontrola zamkniętych, limity, wznowienie, dogenerowanie, dane dla kontroli, punkt kontrolny na końcu próby), agent tylko dla rozdziału i szkoły; §23 — operacje bez dopisku „tylko sonda”.
- AGENTS.md — generator wybierany polem modułu `baselinePool` (gramatyka → przebieg bazowy), agent jako generator rozdziału i szkoły, dane dla kontroli zamkniętych, katalog reguł bez reguł gramatyki, notatki dydaktyczne w katalogu (`generationNotesEn`).
- Spec kosztów (tabela §2).
- Spec zbiorczy: §13 (stan produkcji z §2), §17 (#288 zamknięte).

## 12. Testy

- `lesson-baseline-pool.test.ts`: status z `lessonAgentLimits`, wpis bez `fixed`, `ruleIds` przy `lesson_pool`, wznowienie (`fixed`, `skipObjectives`, `initialExamples`), dogenerowanie (jedno zagadnienie, paczki z `addModePlan` bez podnoszenia, bez notice i przykładów, szkic i historyjka jako źródła ujawnień i zdania do unikania), nieobsługiwane źródła zagadnień.
- `packet-plan.test.ts`: zapas 3; plan dogenerowania.
- Worker (`lesson-agent-generation`): przedmiot z `baselinePool` idzie przebiegiem bazowym, bez pola — agentem; integracyjnie na fake'ach: nowa lekcja gramatyki, wznowienie z punktu kontrolnego (także zapisanego przez agenta), dogenerowanie zagadnienia szkicu, kontrola końcowa nie tnie przyjętych.
- Moduł gramatyki: bez walidatora i reguł; `to_be` v2 bez `contractions`, v1 bez zmian; notatki tylko w prompcie paczki, nie w wejściu gradera.
- Migawka promptu paczki PC (nowa) i liczba znaków; `rule-cases.test.ts` bez przypadków gramatyki.
- E2E: istniejące speki gramatyki na fake'ach przebiegu bazowego (§4.6); `pnpm check`, `pnpm test:integration`, `pnpm test:e2e:shards`, testy architektury.

## 13. Historia

- **v1** — pierwsza wersja.
- **v2.1** (krytycy planu): rozgałęzienie po polu modułu `baselinePool` (testy mechaniki agenta zostają); przyjęcie krokami 3–4 przyjmowania agenta (ofiary `fixed`, kody i reguły agenta); kontrolny przebieg przez `probe:chapter` na ścieżce workera; dwie kolejne pułapki dydaktyczne; zakres `PICTURE_CHOICE_GUIDANCE` i `PC_FORMS_TRANSLATION_GUIDANCE`; tekst poprawki `PC_GUIDANCE`.
- **v2** (krytycy): polityka agenta gramatyki zostaje do etapu 5 (bez przenoszenia pól i opcjonalnego `agentPolicy`; zachowuje zmierzony dopisek o wariantach ze skrótem); generator wybierany źródłem zagadnień `catalog`; bez punktu kontrolnego w trakcie próby (zapis na końcu, jak w etapie 2) i bez zmiany semantyki przykładów kart; status z limitów zapisu; wpis zagadnienia bez `fixed`; dogenerowanie z liczb `addModePlan` bez podnoszenia do minimum; `validateExercise: () => []` bez zmiany typu; identyfikatory reguł przy `lesson_pool`; fake paczki z przesunięciem per paczka; kontrolny przebieg: „to be” × 3, dogenerowanie, liczba kluczy bez pełnej formy, statusy zagadnień, powtórka przy W4/W6 poza zakresem; dwie pułapki dydaktyczne i poprawka tekstu `PC_GUIDANCE`; #369: edycja lekcji v1 i testy wersji tematu.
