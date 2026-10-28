# Handoff — przedmioty szkolne i trener precyzji odpowiedzi

**Data:** 2026-10-28
**Gałąź:** `feature/school-subjects-source-material`
**Worktree:** `C:\Users\looka\IdeaProjects\knowli-worktrees\school-subjects`
**Baza gałęzi:** `5163dfd` (`main` w momencie utworzenia worktree)
**Stan przy przekazaniu:** Etapy 0–2 zaimplementowane; poprawki po niezależnym workflow code review wprowadzone; zmiany mają zostać przekazane Codexowi jako lokalny commit zawierający także ten dokument. Nie wykonano pusha ani PR.

## 1. Po co jest ten dokument

Ten plik jest punktem startowym dla kolejnego agenta. Opisuje stan kodu, decyzje, dowody weryfikacji, ryzyka i następne kroki. Nie zastępuje źródeł prawdy:

1. `AGENTS.md` — zasady pracy, architektury, prywatności i weryfikacji w repozytorium.
2. `requirements.md` — wymagania i kryteria akceptacji feature’u.
3. `design.md` — projekt techniczny i kontrakty etapów 1–5.
4. `tasks.md` — plan etapów i checklisty; aktualizuj przy kolejnych zmianach.
5. `docs/SPEC.md` §28–29 oraz `docs/architecture.md` §22 — produktowy i architektoniczny stan docelowy/bieżący.
6. `grader-golden-set.json` i `grader-eval-2026-10-28.md` — bramka jakości gradera i zapis ostatniego przebiegu.
7. `source-requirements.md` — oryginalny dokument właściciela, kontekst historyczny.
8. `pilot-material.md` — materiał pilotażowy geografii; treść wymaga jeszcze weryfikacji właściciela.

W razie rozjazdu między tym handoffem a kodem/testami wygrywa kod i testy. W razie rozjazdu wymagań z aktualnym poleceniem właściciela trzeba zaktualizować odpowiedni dokument w tej samej zmianie.

## 2. Cel produktu i zakres

Feature rozszerza Umiem! poza angielskie słówka i gramatykę o inne przedmioty szkolne, np. historię, biologię, geografię i język polski.

Przepływ docelowy:

1. Rodzic wkleja tekstowe opracowanie jednego podrozdziału, np. wiernie przygotowane w NotebookLM ze zdjęć podręcznika.
2. System wyprowadza zagadnienia i karty nauki oraz generuje pulę ćwiczeń uziemionych cytatami w tym materiale.
3. Rodzic przegląda, edytuje i zatwierdza szkic.
4. Dopiero potem dziecko uczy się w istniejącym silniku lekcji.
5. Odpowiedź otwarta jest oceniana osobno pod względem wiedzy i precyzji. Rozwlekła, ale poprawna odpowiedź zalicza wiedzę; precyzja służy raportowi i przyszłemu trenerowi precyzji.

Świadomie poza zakresem:

- upload zdjęć/PDF, OCR i analiza dokumentów w aplikacji;
- wyświetlanie obrazów z podręcznika i generowane ilustracje faktograficzne;
- generowanie pytań dynamicznie podczas sesji;
- swobodny czat AI z dzieckiem i ocena długich esejów;
- dopisywanie przez model nowych faktów do pytań, wzorców lub elementów wymaganych.

## 3. Plan etapów i aktualny status

| Etap | Zakres | Status |
|---|---|---|
| 0 | Specyfikacja, design, złoty zestaw, materiał pilotażowy | Zrobione |
| 1 | Przedmiot `school`, temat dynamiczny, payload v3, generowanie, edytor i publikacja | Zrobione |
| 2 | Dwuwymiarowa ocena odpowiedzi otwartej, cache, feedback, raport, harness | Zrobione; kalibracja kosztu otwarta |
| 2b | Deterministyczne zadania rachunkowe `lesson_calculation` | Niezaimplementowane |
| 3 | Odpowiedź mówiona: polski STT i wspólna ocena tekstu | Niezaimplementowane; najpierw spike |
| 4 | Trener precyzji: słowa kluczowe i skracanie odpowiedzi | Tylko szkic semantyki/kontraktów |
| 5 | E2E, domknięcie dokumentacji i pełny przebieg końcowy | Niezaimplementowane jako etap domknięcia |

Zależności: `1 → 2 → 3`, `1 → 2 → 4 → 5`; etap 2b zależy tylko od etapu 1. Kolejny etap powinien wybrać właściciel. Przy braku wyboru Codex ma najpierw wykonać orientację w kodzie, przedstawić plan i poczekać na decyzję.

## 4. Co zostało zaimplementowane

### 4.1 Etap 1 — zestaw szkolny z wklejonego tekstu

- Zestaw szkolny nadal jest lekcją (`decks.kind = 'lesson'`), bez nowego rodzaju zestawu.
- Dodano generyczny przedmiot `school` za interfejsem `SubjectModule`, z pustym katalogiem statycznym.
- Zagadnienia i karty konkretnego zestawu żyją w `lesson_context.dynamicTopic`.
- Identyfikatory celów mają format `school.d<deckId>.<slug>`, aby różne zestawy nie współdzieliły `child_objective_progress`.
- Silnik rozwiązuje temat jedną ścieżką `resolveLessonTopic(...)`; temat dynamiczny jest składany do `LessonTopic` (`dynamic@1`).
- Dodano payload v3 tylko dla `school`: `questionType`, `requiredElements`, `supplementaryElements`, `commonErrors`, `expectedForm`, `familyId`, `sourceRefs`.
- Komenda szkoły ma materiał do 16 000 znaków i pulę do 160. Gramatyka zachowuje własne limity oraz odrzuca pola v3.
- Limity po review: odpowiedź wzorcowa szkoły do 300 znaków, pojedynczy cytat do 600 znaków.
- Typy dostępne w etapach 1–2: `lesson_card`, `lesson_choice` (także prawda/fałsz), `lesson_gap`, `lesson_order`, `lesson_open_answer`.
- Generowanie w jednym runie najpierw tworzy zagadnienia/karty, potem partie ćwiczeń per cel.
- Każde ćwiczenie musi mieć cytat będący znormalizowanym dokładnym fragmentem materiału rodzica albo cytatem oznaczonym jako dodany przez rodzica. Flagi `parentAdded` z wyjścia modelu są usuwane przed walidacją.
- Pytania mogą tworzyć rodziny sformułowań o wspólnej odpowiedzi i elementach. Deduplikacja puli dla szkoły działa po tożsamości ćwiczenia, nie po odpowiedzi.
- Publikacja wymaga pokrycia etapów 3/2/2 na zagadnienie oraz co najmniej dwóch różnych pytań otwartych, nie tylko jednej rodziny.
- Liczba ćwiczeń generowanych per cel uwzględnia minima każdego etapu po podziale miksu, żeby szkic nie był strukturalnie niepublikowalny.
- Panel rodzica obsługuje tworzenie zestawu szkolnego, edycję zagadnień, kart, elementów, cytatów, rodzin i publikację, z widokiem „Skąd to pytanie?”.
- Endpoint tworzenia to `POST /lessons/school` (`lessons.createSchool`), z idempotencją po `clientRequestId`.

### 4.2 Etap 2 — ocena dwuwymiarowa

- Odpowiedź otwarta idzie ścieżką: dopasowanie deterministyczne → cache werdyktów → model oceniający.
- Do istniejącego portu gradera dodano dane `GraderInput.school`; adapter OpenAI-compatible ma osobny tryb szkolny.
- Limit odpowiedzi dziecka wysyłanej do modelu dla szkoły to 600 znaków; gramatyka pozostaje przy 200.
- Do modelu trafiają wyłącznie dane lekcji/ćwiczenia i odpowiedź dziecka jako dane. Nie wolno dodawać imienia, wieku ani identyfikatorów dziecka.
- Werdykt zawiera wiedzę (`correct|partial|incorrect`), precyzję (`concise|verbose|unfocused`), elementy trafione/brakujące, dokładne fragmenty błędnych i zbędnych stwierdzeń oraz komentarz wyłącznie dla rodzica.
- `commonErrors` są podłączone do materiału zadania, wejścia gradera i promptu; nie są już martwym polem.
- Zmiana kryteriów v3 wpływa na `skill_version`, aby stare próby nie awansowały nowych kryteriów.
- Tylko wiedza steruje wynikiem i projekcją celu. Precyzja trafia do szczegółów oceny, cache i raportów. Test pilnuje braku ścieżki precyzja → wiedza.
- `partial` mapuje się na wynik `incorrect` z werdyktem `model_almost`: nie zalicza opanowania i przerywa serię, ponieważ brakujący element jest sprawdzaną treścią.
- Forma `one_sentence` jest liczona deterministycznie. Naruszenie formy ogranicza precyzję, także dla werdyktu odtworzonego z cache, ale nie zmienia wiedzy.
- Migracja `0023_school_verdict_dimensions.sql` dodaje wymiary i listy elementów do cache `lesson_verdicts`.
- Feedback dziecka dla `partial`/`incorrect` nie ujawnia odpowiedzi wzorcowej przy pierwszej próbie. Jest budowany z szablonów przedmiotu; ujawnienie ma następować w istniejącym cyklu wsparcia.
- Raport rodzica pokazuje wiedzę i precyzję, częste braki, ostatnie odpowiedzi, polskie etykiety oraz wymiar szkolny na liście werdyktów. Agregaty obejmują wszystkie wersje zestawu, aby historia nie znikała po republicacji.

### 4.3 Poprawki po workflow code review

Review Etapów 1–2 zakończyło się werdyktem „po poprawkach”: 2 ustalenia krytyczne, 21 ważnych i 28 drobnych. Krytyczne i ważne zostały zaadresowane kodem, testami albo udokumentowaną decyzją.

Najważniejsze poprawki:

- **K1:** wcześniej werdykt `correct` mógł pominąć element wymagany w obu listach i fałszywie zaliczyć wiedzę. Walidator wymaga teraz pełnej partycji elementów, a prompt ma wersję `school-grader-v2`.
- **K2:** wcześniej `partial` ujawniał dziecku pełny wzorzec przy pierwszej próbie. Obecny feedback tego nie robi.
- Uzupełniono regułę `partial`, kategorie błędów i zapis `errorCategory`, dzięki czemu raport kartkówki nie gubi kategorii dla szkoły.
- Naprawiono niepublikowalne pule: minima etapów, różne pytania otwarte, regułę ciągłego `focus`, limit cytatu i walidację tematu dynamicznego.
- Naprawiono kolizje identyfikatorów elementów, blokowanie zapisu przez puste wpisy i podwójną wersję pytania `lesson_short_answer` w edytorze.
- Naprawiono licznik odrzuceń/porzuconych zagadnień, polskie etykiety raportu, agregaty po republicacji i ryzyko duplikatu zestawu po niepewnym wyniku formularza.
- Harness ewaluacyjny porównuje teraz także `missingElementIds` i formę, dostaje cytaty oraz `commonErrors`, a bramka twarda nie wyłącza się po cichu.
- Dodano testy routera `createSchool` i kolejne przypadki integracyjne gradera.

## 5. Architektura i przepływy

### 5.1 Granice modułów

- Kontrakty publiczne: `packages/contracts`.
- Reguły domenowe: `packages/server/src/domain/lessons`.
- Przedmiot szkolny: `packages/server/src/domain/lessons/subjects/school`.
- Autorstwo materiału: `packages/server/src/modules/materials/lessons`.
- Sesje i próby: `packages/server/src/modules/learning/lessons`.
- Raporty: głównie `materials/lessons/lesson-supervision.ts` i istniejące widoki raportujące; raportowanie nie modyfikuje ocen źródłowych.
- Adaptery AI: `packages/server/src/providers/openai`, `providers/openai-compatible`, `providers/fake.ts`; porty w `packages/server/src/ports/ai.ts`.
- Web rodzica: `apps/web/src/parent/lessons`, kontrakt w `apps/web/src/parent/orpc-contract.ts`, router w `apps/web/src/orpc/parent-router.ts`.
- Kid UI nie dostało kryteriów oceny ani nowych pól klucza odpowiedzi. Etap 2 korzysta z istniejących rodzajów feedbacku.

Nie wprowadzaj logiki przedmiotu do silnika lekcji. Nowy przedmiot lub mechanika ma przechodzić przez kontrakty, `SubjectModule`, walidację puli, silnik, edytor i widoki jawnie, zgodnie z `AGENTS.md` i testami architektonicznymi.

### 5.2 Tworzenie i generowanie

1. `NewLessonForm` buduje `SchoolLessonCommand` z nazwą przedmiotu, tematem, materiałem, opcjonalną instrukcją, rozmiarem puli i `clientRequestId`.
2. Router wywołuje `createSchoolLesson`; szkic i run generowania powstają w istniejącej, idempotentnej ścieżce lekcji.
3. Worker najpierw woła generowanie zagadnień, serwer nadaje identyfikatory celów i składa `dynamicTopic`.
4. Ten sam run generuje partie ćwiczeń per cel. Model jest niezaufanym wejściem: kształt, limity, rodziny, cytaty i reguły przedmiotu waliduje serwer.
5. Ćwiczenia niespełniające reguł są odrzucane pojedynczo. Liczniki odrzuconych ćwiczeń i porzuconych zagadnień trafiają do kontekstu szkicu i panelu.
6. Rodzic edytuje szkic. Zapis i publikacja rewalidują temat dynamiczny oraz całą pulę. Opublikowana treść pozostaje niezmienna według istniejących zasad lekcji.

### 5.3 Sesja i ocena odpowiedzi otwartej

1. Sesja rozwiązuje temat dynamiczny i przypina opublikowaną wersję zestawu/polityki według istniejącego silnika.
2. Kryteria v3 trafiają wyłącznie do prywatnego klucza zadania (`schoolCriteria`), nigdy do Kid DTO.
3. Deterministyczne dopasowanie może zakończyć ocenę bez modelu. W przeciwnym razie używany jest cache albo grader.
4. Surowy wynik modelu przechodzi walidację domenową. Niezgodny werdykt, awaria lub brak modelu oznacza „nieocenione” bez kary.
5. Finalizacja zapisuje próbę, ocenę, ekspozycje i projekcję w istniejących granicach transakcyjnych. Historia zakończonych ocen nie jest przepisywana; decyzja rodzica działa na przyszłość.
6. Precyzja nie ma prawa zmienić wiedzy, serii ani opanowania.

Ważne przy nowych testach sesji: plan sesji jest zamrażany. Dla nowego celu pierwsza sesja może obejmować tylko wprowadzenie, a zadanie otwarte etapu `independent` pojawia się głównie jako należne sprawdzenie. Istniejące testy integracyjne szkoły seedują należny postęp albo przechodzą kolejne sesje — nie zakładaj, że jedno przejście nowej sesji zawsze dojdzie do `lesson_open_answer`.

## 6. Mapa najważniejszych plików

| Obszar | Pliki / symbole |
|---|---|
| Kontrakty | `packages/contracts/src/lessons.ts`: `SchoolLessonCommandSchema`, `DynamicTopicDtoSchema`, payload v3, `MAX_SCHOOL_MATERIAL_LENGTH`, `MAX_LESSON_ANSWER_LENGTH`, `MAX_SOURCE_QUOTE_LENGTH` |
| Teksty UI | `packages/contracts/src/messages.ts`: etykiety szkoły, wiedzy, precyzji i liczników |
| Domena tematów | `packages/server/src/domain/lessons/topic-resolution.ts`: `resolveLessonTopic`, `validateDynamicTopicData` |
| Przedmiot | `subjects/school/module.ts`, `validators.ts`, `prompts.ts`, `module.test.ts` |
| Walidacja puli | `packages/server/src/domain/lessons/pool-validation.ts` |
| Werdykt | `packages/server/src/domain/lessons/evaluate.ts`: `validateSchoolVerdict`, `gradeFromSchoolVerdict`, `countSentences` |
| Generowanie | `materials/lessons/lesson-drafts.ts`: `createSchoolLesson`, `buildDynamicTopicData`, `countPerObjective`, `buildObjectiveCriteria`, `stripParentAddedFlags` |
| API materiału | `materials/lessons/lesson-api.ts`: patch `dynamicTopic`, publikacja, `distinctOpenAnswerGaps`, `objectiveImpacted` |
| Próby | `learning/lessons/lesson-attempts.ts`: `buildGraderInput`, `resultFromSchoolVerdict`, cache i `formOkFor` |
| Materializacja | `learning/lessons/lesson-materialize.ts`: prywatne `schoolCriteria` |
| Sesje | `learning/lessons/lesson-sessions.ts`: rozwiązywanie tematu dynamicznego |
| Raport | `materials/lessons/lesson-supervision.ts`, `apps/web/src/parent/lessons/LessonSupervisionPanel.tsx` |
| Port AI | `packages/server/src/ports/ai.ts`: `generateLessonObjectives`, `GraderInput.school` |
| LLM puli | `providers/openai/llm.ts`, `providers/openai/lesson-pool-schema.ts` |
| Grader | `providers/openai-compatible/grader.ts` (`school-grader-v2`) |
| Fake providery | `providers/fake.ts`; heurystyki służą testom przepływu, nie dowodzą jakości |
| Baza | `packages/server/src/db/schema.ts`, `packages/server/drizzle/0023_school_verdict_dimensions.sql`, journal migracji |
| Web rodzica | `NewLessonForm.tsx`, `LessonEditor.tsx`, `lesson-editor-state.ts`, `LessonSupervisionPanel.tsx` |
| Router | `apps/web/src/parent/orpc-contract.ts`, `apps/web/src/orpc/parent-router.ts` |
| Ewaluacja | `scripts/evaluate-school-grader.mts`, `grader-golden-set.json` |
| Testy integracyjne | `tests/integration/lesson-grader-school.test.ts`, `tests/integration/lesson-generation.test.ts`, wpis w `tests/integration-buckets.ts` |
| Dokumentacja ogólna | `docs/SPEC.md` §28–29, `docs/architecture.md` §22, `AGENTS.md` |

## 7. Decyzje, których nie należy przypadkiem cofnąć

1. **Bez nowego rodzaju zestawu.** Szkoła to lekcja z przedmiotem `school`, nie `decks.kind = 'source_material'`.
2. **Tekst zamiast OCR.** Wejściem jest wyłącznie tekst wklejony przez rodzica. Kształt `sourceRefs` może w przyszłości przyjąć dokument/stronę, ale nie implementuj uploadu bez nowej decyzji właściciela.
3. **Uziemienie ponad kreatywność.** Model może upraszczać karty i dodawać analogie pomocnicze, ale pytania, wzorce i elementy wymagane muszą wynikać z materiału rodzica.
4. **Pula z góry, nie generowanie w sesji.** Rodziny pytań są zatwierdzane przed nauką. Nie generuj pytań dynamicznie przy każdym zadaniu.
5. **Rodzic jest bramką.** Dziecko nie widzi niezatwierdzonego szkicu, kryteriów, wzorców, komentarzy modelu ani technicznych szczegółów oceny.
6. **Precyzja nigdy nie obniża wiedzy.** Rozwlekła poprawna odpowiedź zalicza wiedzę. Precyzja jest danymi do raportu/cache i przyszłego trenera.
7. **`partial` nie zalicza.** To wynik `incorrect/model_almost`, bo brak elementu wymaganego oznacza brak sprawdzanej treści.
8. **Brak wzorca po pierwszej częściowej próbie.** Feedback szkolny nie ujawnia pełnej odpowiedzi; ujawnienie pozostaje w cyklu wsparcia.
9. **Pełna partycja werdyktu.** Model musi sklasyfikować każdy element wymagany jako trafiony albo brakujący. Werdykt niespełniający reguł jest odrzucany jako nieoceniony.
10. **Brak danych dziecka u providerów.** Do gradera nie wolno dodawać imienia, wieku, identyfikatorów ani nagrań. Komentarz modelu jest tylko dla rodzica.
11. **Brak wpływu na Hermes/MCP.** Zestawy szkolne są lekcjami, a `learning-overview` nadal wyklucza lekcje. Przy każdej zmianie API sprawdź wpływ API → MCP → skill zgodnie z `AGENTS.md`.
12. **Gramatyka bez regresji.** Payload v3, limit 600 znaków i werdykt szkolny nie mogą zmieniać ścieżki gramatyki.
13. **Zadania rachunkowe liczy kod.** W Etapie 2b model może proponować szablon/parametry, ale wynik i ocena muszą być deterministyczne.
14. **Głos dopiero po spike’u.** Etap 3 nie powinien deklarować jakości polskiego STT na głosie dziecka bez dowodu; nagrań nie wolno przechowywać.

## 8. Zweryfikowane przy przekazaniu

Ostatnie pełne sprawdzenia wykonane podczas prac nad poprawkami:

- `corepack pnpm typecheck` — czysto.
- `corepack pnpm test:unit` — 2085/2085 testów.
- Integracje lekcji na prawdziwym PostgreSQL — wszystkie 13 plików `tests/integration/lesson-*.test.ts` przeszły w kolejnych przebiegach, w tym `lesson-grader-school.test.ts` 4/4.
- `corepack pnpm build` — sukces.
- `corepack pnpm eval:school-grader` na skonfigurowanym prawdziwym modelu `deepseek/deepseek-v4.1-flash`, prompt `school-grader-v2`:
  - wiedza 19/20 (95%),
  - przypadki twarde: wiedza 100%,
  - brakujące elementy 19/20,
  - precyzja 18/20 (raportowana, nie bramkuje),
  - forma 2/2,
  - werdykty odrzucone: 0,
  - wynik: `BRAMKA: OK`.
- Wcześniejsza sonda generowania na prawdziwym LLM po wymuszeniu tablicy cytatów dała 24/24 ważnych ćwiczeń.

Nie traktuj wyniku fake gradera jako dowodu jakości. Jedyny rozjazd wiedzy w ostatnim przebiegu to G20: oczekiwane `partial`, model `incorrect`. Złoty zestaw ma tylko 20 przypadków i jeden przebieg nie dowodzi stabilności statystycznej modelu.

## 9. Co jeszcze zostało

### 9.1 Otwarte zadanie z Etapu 2

- **Kalibracja limitu wywołań gradera.** Limit pozostaje domyślny: 20 wywołań na sesję. Nie zgaduj nowej wartości bez danych pilotażu. Parafrazy zwykle omijają cache, więc koszt rośnie niemal liniowo z liczbą odpowiedzi otwartych. Partie generowania puli na prawdziwym modelu trwały w sondach ok. 32–80 s przy timeoutcie 90 s; obserwuj to przy kolejnych zmianach providerów/promptów.

### 9.2 Etap 2b — `lesson_calculation`

Cel: parametryczne zadania rachunkowe liczone wyłącznie deterministycznie przez kod.

Zalecana kolejność:

1. Przeczytaj wymaganie 4.5 i sekcję zadań rachunkowych w `design.md` pkt 3 oraz przykłady z `pilot-material.md`.
2. Najpierw doprecyzuj kontrakt payloadu, etap zadania, zasady samodzielności/ekspozycji i zachowanie dla nieparsowalnej odpowiedzi na podstawie istniejącego silnika; zapisz decyzje w `design.md`/`tasks.md`.
3. Zaimplementuj czystą funkcję domenową `computeCalculationAnswer(kind, params)` dla `scale_distance`, `height_difference` i `unit_conversion` wraz z testami.
4. Zaimplementuj parser polskiego zapisu liczb: spacje tysięcy, przecinek dziesiętny, opcjonalna jednostka i tolerancja szablonu.
5. Dodaj kontrakty/payload `calculation` oraz `templateFamilyId`; walidacja puli ma przeliczać każde ćwiczenie i odrzucać niezgodność odpowiedzi.
6. Rozszerz generowanie, fake provider i schemat structured output tak, aby model proponował wyłącznie szablon i parametry z zamkniętej listy, nie wynik.
7. Pokaż w edytorze rodzica szablony razem z policzonymi odpowiedziami; rodzic zatwierdza warianty przed publikacją.
8. Oceń próbę deterministycznie w ścieżce prób bez gradera. Kid UI ma użyć istniejącego pola odpowiedzi pisemnej i wspólnych komponentów.
9. Dodaj testy domenowe, kontraktów, generowania, edycji/publikacji i integracyjne próby. Przykłady kontrolne: `1:25 000`, `3 cm → 750 m`; `400 m n.p.m. - 150 m n.p.m. → 250 m`.

### 9.3 Etap 3 — odpowiedź mówiona

Cel: dziecko może podyktować odpowiedź otwartą po polsku zamiast pisać.

Zalecana kolejność:

1. Najpierw wykonaj spike obecnego providera STT dla `pl-PL` na głosie dziecka i zapisz wynik/decyzję w `design.md` albo `tasks.md`. Bez dowodu nie deklaruj gotowości.
2. Otwórz modalność audio wyłącznie dla `lesson_open_answer` przedmiotu `school`; transkrypcja ma wejść do tej samej finalizacji co tekst.
3. Niska pewność, cisza, odmowa mikrofonu lub awaria STT = `unevaluated`, bez błędu wiedzy i bez pomyłki pojęć.
4. Zapisz modalność przy próbie i rozdziel ją w raporcie rodzica. Surowe nagranie przetwarzaj tylko krótkotrwale w pamięci; zwolnij mikrofon/bufory także przy błędzie.
5. W Kid UI użyj istniejącego `SpeechRecordButton` i wspólnych komponentów. Ścieżka bez mikrofonu pozostaje pełnoprawna.
6. Dodaj testy z fake STT (sukces, niska pewność, awaria, anulowanie) i jawnie raportuj brak odbioru na fizycznym urządzeniu, jeśli nie zostanie wykonany.

### 9.4 Etap 4 — trener precyzji

Cel: osobny trening wyboru istotnych informacji i zwięzłego formułowania odpowiedzi.

Przed kodem trzeba dopisać szczegółowe kontrakty DTO do `design.md`. Dopiero potem:

1. `lesson_keywords`: wybór 2–3 kluczowych pojęć z dystraktorami; wynik deterministyczny; zadanie poprzedza powiązaną odpowiedź otwartą i oznacza ją jako wspomaganą, z ekspozycją zapisaną przed ujawnieniem.
2. „Jedno zdanie”: istniejący wariant `expectedForm = 'one_sentence'`; nie twórz duplikującej mechaniki bez potrzeby.
3. „Skróć odpowiedź”: zadanie następcze po `verbose`/`unfocused`, z osobną próbą powiązaną z oryginałem. Poprawka nigdy nie jest samodzielnym sukcesem; utrata elementu wymaganego musi być wykryta.
4. Selektor doboru ćwiczeń na podstawie wiedzy, precyzji, braków i pomyłek pojęć.
5. Pełna ścieżka mechaniki: kontrakty, walidacja puli, generowanie/fake, silnik i plan sesji, ekspozycje, edytor rodzica, Kid UI oraz raport.
6. Widoki Kid UI tylko przez wspólne komponenty; dodaj testy geometrii Playwright i wpisy do `tests/e2e/spec-projects.ts` zgodnie z `AGENTS.md`.

### 9.5 Etap 5 — domknięcie

- Uzupełnić raport próbnej kartkówki o wymiar precyzji tam, gdzie jeszcze go brakuje.
- Dodać brakujące E2E nowych ekranów rodzica i dopisać specyfikacje do właściwej partycji/kosza.
- Ponownie sprawdzić wpływ API → MCP → skill; oczekiwany jest brak wpływu, ale trzeba go udokumentować w PR.
- Doprowadzić SPEC i architekturę od opisu etapów do faktycznego stanu kodu po etapach 2b–4.
- Na końcu wykonać pełny przebieg właściwy dla zakresu, w tym `pnpm test:e2e:shards` przed PR.

## 10. Znane ograniczenia i dług drobny

Poniższe pozycje nie blokowały zamknięcia Etapów 1–2, ale Codex powinien o nich wiedzieć i nie traktować ich jako świeżo odkrytych regresji:

- Brak E2E dla nowych ekranów rodzica; to nadal luka Etapu 5.
- Brak odbioru na fizycznym urządzeniu i brak weryfikacji produkcyjnej.
- Złoty zestaw ma 20 przypadków i 4 pytania; brakuje klas granicznych, m.in. pustej odpowiedzi, odpowiedzi >600 znaków, próby injekcji, dosłownej kopii wzorca i odpowiedzi mieszanej językowo.
- Autor powinien zweryfikować fakty z `pilot-material.md` przed użyciem z dzieckiem. W materiale zauważono m.in. Merkatora w XVII zamiast XVI wieku oraz niespójne progi gór 300/500 m.
- Minimalna długość cytatu 10 znaków i normalizacja małymi literami pozostały świadomie; bardzo krótki dokładny cytat, np. sama data, może zostać odrzucony.
- Spójność rodziny jest sprawdzana głównie po identyfikatorach elementów, nie po pełnej treści każdego elementu; rodzina jednoelementowa jest możliwa.
- Dogenerowanie nie ma tak pełnej walidacji rodziny względem całego istniejącego szkicu jak publikacja; publikacja pozostaje twardą bramką.
- Jeden semantycznie wadliwy cel na etapie zagadnień nadal może zakończyć cały run, choć pominięcia ponad limit 8 i złe rekordy są liczone.
- Schematy structured output nie egzekwują wszystkich kardynalności; ostateczną ochroną jest walidacja serwerowa.
- Fake provider uziemia ćwiczenia początkiem materiału i używa prostych heurystyk słownych/długości. Nie wykryje regresji jakości prawdziwego modelu.
- W migawce celu tytuł tematu przekazywany graderowi może być tytułem celu; to kwestia jakości promptu, nie prywatności.
- W panelu/edytorze pozostały drobne kwestie UX z review, m.in. zachowanie pustych grup po usunięciu zagadnienia, textarea list oraz możliwy wyścig przy ładowaniu kartkówek.
- Polska deterministyczna poprawna odpowiedź w części Kid UI może nadal korzystać z odziedziczonego `lang="en-GB"`; to drobna kwestia dostępności do poprawy przy pracy nad feedbackiem.
- Snapshoty Drizzle dla migracji od 0018 są zaległym długiem repozytorium; runtime migrator działa na journalu i SQL, ale przyszłe `drizzle-kit generate` może pokazać dryf.
- Zdanie w `design.md` o doklejaniu konkretnego brakującego elementu przy ujawnieniu jest starszym szkicem. Obecny kod po K2 używa szablonu kategorii i nie ujawnia wzorca przy pierwszej próbie; przy pracy nad feedbackiem uzgodnij tekst projektu z kodem i wymaganiem 5.7.

## 11. Jak pracować dalej w tym worktree

1. Zacznij od przeczytania `AGENTS.md`, tego pliku, `requirements.md`, `design.md` i `tasks.md` tylko w zakresie wybranego etapu.
2. Sprawdź `git status`, `git branch --show-current`, `git log -1 --oneline` i `git show --stat HEAD`. Nie zakładaj, że drzewo jest czyste; nie nadpisuj cudzych zmian.
3. Pracuj w istniejącym worktree i na istniejącej gałęzi, o ile właściciel nie poleci inaczej. Nie pushuj do `main`, nie twórz PR i nie scalaj bez wyraźnego polecenia właściciela.
4. W PowerShellu używaj `corepack pnpm`, bo samo `pnpm` może nie być dostępne. Nie uruchamiaj `npm install`.
5. Przed instalacją sprawdź, czy istnieje `node_modules`. Jeśli brakuje `.env`, użyj `node scripts/setup-worktree.cjs --skip-install`; nigdy nie wypisuj ani nie commituj sekretów.
6. Wiele plików ma CRLF. Przy edycji zachowuj istniejące końce linii i nie rób pozornie ogromnych diffów przez globalną konwersję.
7. Dla reguł dodawaj najpierw celowany test jednostkowy, dla gwarancji bazy/współbieżności test integracyjny. Nowy plik integracyjny dopisz do kosza w `tests/integration-buckets.ts`; nowy E2E do `tests/e2e/spec-projects.ts`.
8. Przy zmianie API zawsze sprawdź i opisz wpływ `API → MCP → skill`.
9. Aktualizuj `tasks.md`, a przy zmianie kontraktu/decyzji także `requirements.md`, `design.md`, SPEC lub architekturę.

Przydatne komendy:

```powershell
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm exec vitest run --config vitest.integration.config.ts tests/integration/lesson-grader-school.test.ts
corepack pnpm build
corepack pnpm eval:school-grader
corepack pnpm eval:school-grader -- --fake
```

Przed PR wymagany jest pełny przebieg E2E `corepack pnpm test:e2e:shards` zgodnie z `AGENTS.md`.

## 12. Prompt startowy dla Codexa

```text
Przejmujesz feature „Przedmioty szkolne i trener precyzji odpowiedzi” w repozytorium Knowli/Umiem!.

Pracuj wyłącznie w istniejącym worktree:
C:\Users\looka\IdeaProjects\knowli-worktrees\school-subjects
na gałęzi:
feature/school-subjects-source-material

Najpierw przeczytaj w całości AGENTS.md oraz:
- .kiro/specs/school-subjects/HANDOFF.md
- .kiro/specs/school-subjects/requirements.md
- .kiro/specs/school-subjects/design.md
- .kiro/specs/school-subjects/tasks.md

Potem wykonaj wyłącznie odczyt:
- git status
- git branch --show-current
- git log -1 --oneline
- git show --stat HEAD

Krótko potwierdź: co jest zaimplementowane, które decyzje są niezmienne, jakie są ryzyka i jaki jest dokładny następny krok.

Zasady:
- Etapy 0–2 są zaimplementowane i po poprawkach code review. Nie przebudowuj ich bez dowodu regresji.
- Nie implementuj uploadu/OCR, generowania pytań w sesji ani nowych faktów spoza materiału rodzica.
- Precyzja nigdy nie może obniżać wiedzy; brak modelu/awaria = nieocenione bez kary.
- Nie wysyłaj do providerów danych dziecka; Kid DTO nie może zawierać kryteriów ani wzorców.
- Używaj corepack pnpm, zachowuj CRLF i nie commituj .env ani sekretów.
- Nie pushuj, nie twórz PR i nie scalaj bez wyraźnego polecenia właściciela.

Zakres tej sesji: [UZUPEŁNIJ: Etap 2b / Etap 3 / Etap 4 / tylko analiza / inny dokładny zakres].

Jeżeli zakres nie został uzupełniony, nie zaczynaj implementacji. Przedstaw plan dla Etapu 2b i Etapu 3, wskaż zależności, ryzyka i rekomendację, a potem poczekaj na wybór właściciela.
Jeżeli zakres został uzupełniony, rozpocznij od przeczytania kodu i istniejących testów w tym obszarze, dodaj testy dla nowej reguły, wdróż najmniejszy kompletny przyrost, zaktualizuj tasks.md/dokumentację i uruchom adekwatne bramki z AGENTS.md. Na końcu raportuj wyłącznie to, co rzeczywiście wykonałeś i zweryfikowałeś.
```
