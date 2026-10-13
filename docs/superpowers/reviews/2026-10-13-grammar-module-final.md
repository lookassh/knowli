# PR #51 — końcowy niezależny review całego feature'u

**Ready to merge: No. Critical: 0. Important: 9. Minor: 2.**

Baza: `8b01cadafa15270f9c300dac27c29e5138ee448c`. HEAD: `05ea1380e1889bc203d2c98a1010ad07d5bd791a`. Zakres: cały feature, 180 zmienionych plików, a nie ostatni commit ani wyłącznie naprawy. Review był niezależny, wykonany przez dedykowanego recenzenta bez delegacji dalej. Checkout, indeks, HEAD i gałąź pozostały bez zmian. Jedyny zapis to ten raport, poza repozytorium, na polecenie koordynatora.

Przeczytano bieżące `requesting-code-review/SKILL.md` i `code-reviewer.md`, wymagania/projekt/zadania `.kiro/specs/grammar-module`, zatwierdzone plany napraw i kart rodzica, dziennik, pierwotne 10 uwag oraz ich audyt. Przegląd obejmował domenę i SubjectModule, kontrakty, generowanie/publikację/edycję, migracje, próby/projekcje, współbieżność, kartkówki, Kid UI, panel rodzica, współdzielone zmiany słówek i izolację API→MCP→skill. Przegląd testów dotyczył pokrycia scenariuszy i jakości danych/bariery; nie jest audytem każdej asercji ani ręcznym porównaniem każdej linii wygenerowanych snapshotów Drizzle.

## Mocne strony

- Silnik lekcji korzysta z wstrzykniętego rejestru i SubjectModule. Normalizacja angielskich skrótów, kategorie, katalog i prompty przedmiotu są wydzielone; fixture niejęzykowy sprawdza rozszerzalność.
- Autoryzacja rodzica pozostaje przed routingiem nowych operacji. Grader otrzymuje ograniczoną treść, bez identyfikatorów profilu; komentarze modelu pozostają w panelu rodzica.
- Niezmienność publikacji, ocen i zamkniętego raportu jest chroniona triggerami. Faza druga gradera ponawia wspólną blokadę sesji i sprawdza aktualny stan przed zapisem oceny/projekcji.
- Snapshot początkowego postępu naprawia przejście intro→guided i limit nowych celów, zachowując bieżącą projekcję dla należnych sprawdzeń.
- Zmiany raportu Hermesa filtrują lekcje w przypisaniach, aktywności, czasie, postępie i kartkówkach; schemat learning-overview v1 pozostał bez zmian, a skill opisuje ograniczenie.

## Important — wymagają naprawy

### R1 [P1] Walidacja dopuszcza ćwiczenia niemożliwe do wydania jako Kid DTO

Plik: [pool-validation.ts:214](C:/Users/looka/IdeaProjects/knowli/packages/server/src/domain/lessons/pool-validation.ts:214), szczególnie 225–228 i 386–398; limity 188–196.

`lesson_choice` bez `stem`, `lesson_open_answer` bez `prompt` i `lesson_error_fix` z pustym `statement` przechodzą walidację odpowiednich celów. Materializacja podstawia pusty tekst, a `TaskPromptSchema` odrzuca taki prompt. Generator może zatem zapisać je jako poprawne, edytor może usuwać pole choice/open przez wyczyszczenie inputu, a publikacja sprawdza tylko pokrycie i media. Dziecko zostaje z opublikowanym zadaniem, którego klient nie potrafi wczytać. Dodatkowo walidacja nie ogranicza długości `answer`, wariantów i tekstów opcji tak jak DTO rodzica: `answer` długości 121 przechodzi domenę, ale nie `LessonExerciseInputSchema`.

Dowód: rzeczywiste czyste funkcje `validateLessonExercise → materializeExercise → TaskPromptSchema.safeParse` dały `errors=[]` i `success=false` dla wszystkich trzech rodzajów. Odpowiedź długości 121: domena `[]`, DTO `false`.

Naprawa: wspólna walidacja wszystkich wymaganych pól i limitów rekordów zgodna z kontraktami, w tym niepuste bodźce per typ, przed zapisem i publikacją. Zachować odrzucenie pojedynczego rekordu, a nie całej poprawnej części generacji.

### R2 [P2] Zapis bez zmiany ćwiczenia rozcina zatwierdzone warianty zawierające przecinek

Plik: [lesson-editor-state.ts:88](C:/Users/looka/IdeaProjects/knowli/apps/web/src/parent/lessons/lesson-editor-state.ts:88), również 111 i 159.

`acceptedAnswers` są łączone przecinkiem, a każdy PATCH ponownie dzieli je po każdym przecinku. Poprawny wariant zdania `["Yes, he does."]` zmienia się na `["Yes", "he does."]` nawet przy zmianie wyłącznie tytułu. Oryginalna zatwierdzona odpowiedź przestaje trafiać deterministycznie, może trafić do modelu albo stać się nieoceniona; dodatkowo zapis dodaje niezamierzone fragmenty jako poprawne warianty.

Dowód: `createLessonSnapshot → toLessonDraftPatch` oraz `matchLessonAnswer`: przed zapisem `exact`, po zapisie `no_match`.

Naprawa: bezstratny edytor tablicy wariantów, np. osobne pola/wiersze. Test round-trip zdań z przecinkami i samej zmiany tytułu.

### R3 [P2] Zapis tytułu usuwa pytanie krótkiej odpowiedzi zapisane w prompt

Plik: [lesson-editor-state.ts:146](C:/Users/looka/IdeaProjects/knowli/apps/web/src/parent/lessons/lesson-editor-state.ts:146), 171–173; widok [LessonEditor.tsx:463](C:/Users/looka/IdeaProjects/knowli/apps/web/src/parent/lessons/LessonEditor.tsx:463).

Materializacja `lesson_short_answer` wspiera pytanie w `payload.prompt`, jednak serializacja wysyła `prompt` wyłącznie dla `lesson_open_answer`. Rodzic nie widzi też pola tego pytania w edytorze. Poprawne `prompt="Does he play?"` znika przy zapisie całej puli; dziecko otrzymuje zamiast niego tytuł celu „Krótkie odpowiedzi” lub ogólne polecenie. Nie wiadomo wtedy, na co odpowiadają opcje Yes/No.

Dowód: rzeczywisty round-trip i materializacja: przed zapisem `question="Does he play?"`, po zapisie `question="Krótkie odpowiedzi"`.

Naprawa: uzgodnić i zachować kanoniczne pole pytania dla short_answer w generatorze, DTO, edytorze i materializacji, z kompatybilnością obecnych `prompt/stem`.

### R4 [P2] Selekcja „widziane najdawniej” ignoruje poprzednie sesje

Plik: [lesson-sessions.ts:324](C:/Users/looka/IdeaProjects/knowli/packages/server/src/modules/lessons/lesson-sessions.ts:324), 325–332.

`lastSeenAt` jest ładowane z `session_tasks` ograniczonych do bieżącej sesji. Na początku następnej sesji wszystkie wcześniejsze czasy znikają. Gdy nie ma już ćwiczeń niewidzianych, selektor wybiera pierwszą pozycję puli, nawet jeśli dziecko widziało ją niedawno, a późniejszą pozycję znacznie wcześniej. Kolejne krótkie sesje mogą wielokrotnie wracać do początku puli. To narusza wymaganie 5.7.

Dowód statyczny: zapytanie przekazuje tylko `session.id`, natomiast `scheduler.orderBySeen` poprawnie porównuje dostarczone czasy i dla braku wpisu używa pustego stringa.

Naprawa: załadować historię tego dziecka dla elementów przypiętej puli ze wszystkich jego sesji; test dwóch sesji, odwrotnej kolejności puli/czasów i izolacji innego dziecka.

### R5 [P2] Leniwa finalizacja processing pozwala ponownie odpowiedzieć na ten sam slot kartkówki

Plik: [lesson-attempts.ts:812](C:/Users/looka/IdeaProjects/knowli/packages/server/src/modules/lessons/lesson-attempts.ts:812), 812–827; sprawdzenie stanu zadania 569–571.

Po przerwaniu procesu web między rezerwacją próby i finalizacją modelu odczyt po >60 s kończy próbę jako `completed/not_assessed`, lecz zostawia zadanie `issued`. W aktywnej kartkówce nowy `clientAttemptId` przechodzi więc walidację i pozwala wysłać drugą odpowiedź na ten sam slot. `nextTask` również ponownie zwraca ten slot. Normalna finalizacja nieocenionej odpowiedzi kończy slot prawidłowo, ale ścieżka recovery tego nie robi. Narusza to jedną odpowiedź na zadanie (9.1); recovery wpisuje ponadto feedback zamiast zachować `null` w kartkówce.

Dowód: prześledzony kod recovery i akceptacji nowej próby. Nie wykonywano mutującej reprodukcji PostgreSQL w tym read-only review. Istniejący test stale gradera obejmuje trening, nie kartkówkę.

Naprawa: pod wspólną blokadą terminalizować stale slot mock_test bez feedbacku, pozostawiając retry treningu; test restartu/recovery, drugiej próby i braku wycieku wyniku.

### R6 [P2] „Uznaj za błędne” nie działa dla pierwotnego werdyktu correct

Plik: [lesson-attempts.ts:429](C:/Users/looka/IdeaProjects/knowli/packages/server/src/modules/lessons/lesson-attempts.ts:429), 429–430; [evaluate.ts:304](C:/Users/looka/IdeaProjects/knowli/packages/server/src/domain/lessons/evaluate.ts:304), 304–309.

Pierwotny modelowy `correct` ma `errorCategory=null`. Decyzja rodzica `overridden_incorrect` przekształca go w `incorrect + other`, a zwykłe mapowanie modelu daje `unevaluated/model_other`. Następna identyczna odpowiedź jest neutralna, nie przerywa serii i pozostawia zadanie treningu do ponowienia. Rodzic widzi skuteczne „uznaj za błędne”, ale system nie stosuje tej decyzji jako błędnej odpowiedzi (8.2).

Dowód: kod transformacji cache i czysta reprodukcja `gradeFromVerdict({verdict:"incorrect",errorCategory:"other",...}) → unevaluated`. Endpoint decyzji zmienia tylko `parentDecision`, nie zapisuje innej kategorii.

Naprawa: potraktować nadrzędną decyzję rodzica jako autorytatywny outcome. Brak kategorii może oznaczać brak szczegółowej podpowiedzi, nie neutralizację decyzji; nie zmieniać dawnych ocen. Jeśli produkt wymaga wskazania kategorii celu przez rodzica, zaprojektować tę opcję jawnie zamiast pozornej korekty.

### R7 [P2] Przykłady z modelu są zapisywane bez walidacji i mogą zepsuć gotową lekcję

Plik: [lesson-drafts.ts:496](C:/Users/looka/IdeaProjects/knowli/packages/server/src/modules/lessons/lesson-drafts.ts:496), 496–498 i 568; [card.ts:37](C:/Users/looka/IdeaProjects/knowli/packages/server/src/domain/lessons/card.ts:37).

Surowe `result.examples` są rzutowane w adapterze LLM i kopiowane do `lesson_context` bez sprawdzenia tablic/elementów. Przy prawidłowych ćwiczeniach i `examples[objectiveId]=[null]` run kończy się sukcesem i stanem review. Panel rodzica i karta dziecka dereferencjonują `line.trim()/example.trim()` i rzucają wyjątek. Poprawiony guard ćwiczeń nie chroni tego fragmentu structured output.

Dowód: kod kopiowania surowych przykładów; rzeczywisty `renderCard(...,[null])` rzuca `Cannot read properties of null (reading 'trim')`.

Naprawa: walidacja examples na granicy portu przed zapisem, z kluczami celów i tablicami niepustych ograniczonych tekstów; zachować prawidłowe ćwiczenia przy odrzuconych przykładach i umożliwić poprawę/dogenerowanie przykładów.

### R8 [P2] Edycja i publikacja omijają zakaz duplikatów odpowiedzi w puli

Plik: [lesson-api.ts:533](C:/Users/looka/IdeaProjects/knowli/packages/server/src/modules/lessons/lesson-api.ts:533), 533–542; publikacja 597–605.

Generowanie używa `validatePool`, natomiast edycja waliduje tylko każde ćwiczenie oddzielnie, a publikacja liczy wyłącznie pokrycie. Rodzic może zapisać kilka ćwiczeń z tą samą znormalizowaną odpowiedzią i opublikować je jako osobne pozycje spełniające minima. Taką pulę generator odrzuciłby jako nieprawidłową. Ponieważ samodzielność jest po `target_key`, ujawnienie jednego ćwiczenia wyklucza niezależność pozostałych duplikatów; w skrajnym przypadku minima publikacji spełniają klony, na których dziecko nie może zebrać wymaganych niezależnych sukcesów.

Dowód: dwa prawidłowe choice z różnymi stem, odpowiedzią `plays`: walidacja pojedynczych rekordów `[[],[]]`, ale `validatePool` odrzuca drugi. Właśnie tej fazy brakuje w edycji/publikacji.

Naprawa: pełna walidacja puli także przy edycji i przed publikacją, z konkretnymi błędami duplikatów dla rodzica; bez cichego usuwania jego ćwiczeń.

### R9 [P2] Restart workera nie odzyskuje rozpoczętego generowania lekcji

Plik: [generation.ts:550](C:/Users/looka/IdeaProjects/knowli/packages/server/src/modules/generation.ts:550), 550–558; [lesson-drafts.ts:436](C:/Users/looka/IdeaProjects/knowli/packages/server/src/modules/lessons/lesson-drafts.ts:436), 436–440.

Po claimie run ma `running`. Jeśli worker zginie przed terminalnym zapisem, nowy proces wybiera wyłącznie `queued`, a executeLessonGeneration odmawia wykonania `running`. Run pozostaje tam bez końca. Istniejące API retry potrafi zresetować running, lecz nowy edytor pokazuje retry tylko dla failed i cały czas pokazuje generowanie. Rodzic nie ma ścieżki odzyskania w interfejsie. Test „restart procesu workera” restartuje połączenie przed claimem, kiedy run nadal jest queued, więc nie dowodzi odporności na przerwanie rozpoczętej pracy.

Dowód statyczny: claim, filtr pętli i brak odzyskiwania w main/tasks workera. To wzorzec odziedziczony ze ścieżki deck, ale nowa ścieżka lekcji nadal musi obsłużyć opisany scenariusz; nie traktuję samego wcześniejszego istnienia wzorca jako dowodu zgodności zadania 10.

Naprawa: bezpieczne odzyskiwanie osieroconych runów lub jawna bezpieczna ścieżka wznowienia dla rodzica, chroniąca przed żywym/spóźnionym workerem i podwójnym dopisaniem ćwiczeń. Test przerwania po claimie i restartu, nie tylko startu queued.

## Minor

1. [sessions.ts:119](C:/Users/looka/IdeaProjects/knowli/packages/server/src/modules/sessions.ts:119): wspólne `taskCounts` wyklucza tylko exposure, więc SessionDto przy wznowieniu i podsumowanie treningu liczą lesson_card jako `assessedTasksIssued`. Faktyczny budżet selektora używa poprawnego lessonTaskCounts, dlatego nie jest to dodatkowe zużycie 12 zadań, ale publiczne liczniki są niespójne. Wspólny helper powinien wykluczać obie prezentacje.
2. [lesson-supervision.ts:436](C:/Users/looka/IdeaProjects/knowli/packages/server/src/modules/lessons/lesson-supervision.ts:436): nowa pusta linia EOF powoduje niezerowy `git diff --check BASE..HEAD`. To porządek diffu, nie błąd funkcjonalny.

## Weryfikacja wszystkich 10 pierwotnych findings

| Oryginalna uwaga | Wynik na 05ea138 |
| --- | --- |
| P1-1 correctOption po tekście | Naprawiona: choice i short_answer oznaczają poprawność po źródłowym ID przed UUID; notice współdzieli normalizator z walidacją. Unit materializacji i integracja kształtu obejmują obie gałęzie. |
| P1-2 znika statement transform | Naprawiona: STATEMENT_TYPES obejmuje transform, UI edytuje statement, walidator wymaga niepustego statement. Realny flow obejmuje title edit z transformami. R3 to osobna analogiczna luka short_answer. |
| P1-3 CHECK nieocenionej po przerwie | Naprawiona: obie ścieżki używają confirmationEligibleFor, która dla unevaluated zwraca false. Integracja po 26 h ma wariant bez gradera i awarię gradera/fazy drugiej. |
| P1-4 order zalicza samodzielność | Naprawiona: order ma assistance=options; integracja sprawdza independent=false po poprawnej sekwencji. |
| P1-5 spóźniony model zmienia zamkniętą kartkówkę | Naprawiony reprodukowany wyścig: wspólna blokada i świeży stan przed zapisem ocen/projekcji. Test używa jawnych entered/released, zamyka sesję, a potem zwalnia grader i sprawdza brak późnego correct. R5 dotyczy innej ścieżki recovery w aktywnej kartkówce. |
| P2-6 omijany guided i limit nowych | Naprawiona: initialObjectiveProgress przy starcie, initialProgress dla startu/nowości, bieżący progress dla due/mastered. Testy obejmują aktualizację projekcji, kontynuację productive i limit nowych. |
| P2-7 wadliwy pojedynczy rekord przerywa generację | Naprawiona dla ćwiczeń: guard sprawdza wszystkie dereferencjonowane tablice i typy tekstów, rejectedCount obejmuje malformed, terminalny catch kończy run. Integracje options/acceptedAnswers/focus zachowują poprawne rekordy. R7 dotyczy osobnego obiektu examples. |
| P2-8 almost z błędem reguły daje sukces | Naprawiona: almost z kategorią celu daje incorrect/model_incorrect, null/other zachowuje almost. Unit pokrywa sprzeczny missing_ending. |
| P2-9 brak Nie pamiętam | Naprawiona dla czterech ćwiczeń tekstowych: Gap/Sentence wywołują onNotRemember i onSkip. Realna integracja dont_remember prowadzi do support_card i guided; E2E sprawdza akcję dziecka. |
| P2-10 brak edycji i podglądu kart | Naprawiona: parent catalog jawnie mapuje title/body, edytor renderuje karty oraz lokalne examples i zapisuje PATCH.examples. Kontrakt i E2E obejmują preview przed/po edycji oraz ponowne wejście. |

## Dowody sprawdzeń

Odczytano świeże logi koordynatora: unit 957/957, integration 327/327, realny flow/generacja 28/28, E2E 147/147, build oraz MCP 8/8 PASS. Typecheck sześciu konfiguracji i schema --check PASS potwierdził koordynator; nie uruchamiałem ich ponownie. Pełny E2E wystartował przed ostatnią zmianą fake providera; koordynator jawnie planuje odświeżenie dotkniętych E2E po naprawach.

Recenzent wykonał czyste reprodukcje rzeczywistych funkcji domeny/serializacji/materializacji opisane w R1–R3 oraz R6–R8, i `git diff --check BASE..HEAD` (FAIL wyłącznie Minor 2). R4/R5/R9 potwierdzono statycznie; nie uruchamiano mutujących reprodukcji DB. Po review checkout jest nadal czysty na 05ea138.

## Declined to judge

- Trafność ocen rzeczywistego modelu i jakość pedagogiczna rzeczywistych generacji: brak próby realnego providera; oceniono deterministyczne kontrakty, walidację, błędy i cache.
- Fizyczny Galaxy S25, klawiatura systemowa i rzeczywisty odsłuch: brak próby urządzenia; desktopowe E2E nie zastępują tego dowodu.
- Migracja istniejącej produkcyjnej bazy oraz backup/rollback: nie wdrażano; lokalne integracje PostgreSQL nie dowodzą migracji produkcji.
- Zainstalowany MCP/skill u Hermesa: sprawdzono repozytoryjne filtrowanie i dokumentację, bez zdalnej aktualizacji konsumenta.
- Ręczny audyt każdego generated snapshot Drizzle i każdej asercji suite: scope review obejmuje cały feature i relewantne scenariusze, ale nie deklaruje takiego dodatkowego audytu mechanicznych artefaktów.

## Ocena

Dziesięć pierwotnych usterek naprawiono, a architektura, izolacja i nowe testy są wyraźnie lepsze. Nadal nie należy scalać: dziewięć wskazanych luk pozwala publikować wadliwy materiał, bezstratnie go nie zachowuje albo łamie konkretne reguły sesji i odzyskiwania. Naprawy wymagają nowych testów RED→GREEN oraz niezależnego sprawdzenia diffu poprawek i aktualnych końcowych wyników.
