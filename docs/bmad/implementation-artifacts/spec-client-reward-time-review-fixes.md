---
title: 'Poprawki niezależnego review raportu sesji i punktów'
status: 'done'
route: 'dispatch'
created: '2026-10-20'
baseline_commit: '78c7575b5c30d257dd2239236303f23cef982d14'
context:
  - 'docs/bmad/implementation-artifacts/client-reward-time/review-codex-2026-10-20.md'
  - 'docs/bmad/implementation-artifacts/client-reward-time/design.md'
  - 'docs/bmad/implementation-artifacts/client-reward-time/acceptance.md'
  - 'docs/bmad/implementation-artifacts/client-reward-time/migration.md'
---

<frozen-after-approval>

## Intent

Doprowadzić implementację client-reward-time do zgodności z zatwierdzonym planem: naprawić F01–F12/G01–G02 z niezależnego review, upraszczając istniejący kod. Właściciel zlecił szczegółowy plan, implementację subagentowi **GPT-6 Luna**, a następnie review przez głównego agenta. Nie ma kolejnego checkpointu zatwierdzania planu.

## Boundaries & Constraints

- Pracuj wyłącznie w `C:/Users/looka/.zcode/worktrees/knowli/client-reward-time`, gałąź `impl/client-reward-time`. Nie przełączaj gałęzi main ani innych worktree. Istniejące niezacommitowane dokumenty review są zamierzonym wejściem, zachowaj je. Nie commituj, nie pushuj, nie scalaj, nie wdrażaj.
- Bez nowych tabel, ledgera, serverowej kolejki ocen, mechanizmu ponawiania LLM, monitoringu, rekompensat, Xbox i ochrony przed samodzielnie spreparowanym klientem. Nadal jeden raport i maksymalnie jedno wywołanie modelu, 1 pkt/60 s, zachowanie reszty, atomowe naliczenie i retencja 7 dni.
- Naprawiamy istniejący przepływ, nie budujemy nowego frameworka. Zachowaj granice pakietów, jawne Kid API, autoryzację rodzica, historię nauki i MCP vocabulary-only/estimated.
- TDD dla znalezionych błędów: najpierw znaczący test RED, następnie najmniejsza spójna poprawka i GREEN. Test nie może jedynie potwierdzać napisanej implementacji. Nie zmieniaj starych oczekiwań, aby ukryć regresję.
- Istnieją `node_modules` i `.env`: nie instaluj zależności i nie wypisuj sekretów. Żadnych prawdziwych odpowiedzi dzieci ani wywołań płatnego LLM. Używaj fikcyjnych danych.
- Jeżeli drobna szczegółowa decyzja różni się od poniższej sugestii, wybierz rozwiązanie prostsze, które spełnia wszystkie AC; opisz odstępstwo. Nie pomijaj zadania ani AC jako „deferred” bez rzeczywistej blokady.

## I/O & Edge-Case Matrix

| Given / When | Then |
|---|---|
| Pytanie bez interakcji 300 s, następnie blur/background/offline | Maks. 60 s aktywności, reszta jawnie idle; pauza nie odzyskuje bezczynności. |
| Krótkie audio, pisanie, przerwanie/koniec/opóźnione zdarzenie | Unia rzeczywistej pracy; brak sztucznego przedłużenia audio; feedback też mierzony. |
| Wznowienie task.pendingAttemptId | Właściwe przypisanie zadania/próby, czekanie techniczne bez aktywności. |
| Spóźniony submit/retry sesji A po starcie B | Brak mutacji B i obcych prób/odsłuchów. |
| 257 okien edycji/129 odsłuchów/129 pauz jednego zadania | Raport po kompakcji przechodzi schemat; czas i zadania nie giną. |
| Reload aktywnej sesji | Zachowane wcześniejsze zadania/próby/pomiar; luka jest unobserved. |
| Koniec sesji przyjęty, utrata odpowiedzi i ponowne otwarcie FE | Identyczny finalny payload można dostarczyć/pobrać wynik, bez drugiego LLM i punktów. |
| Restart serwera po transakcji A; zwykły odczyt po deadline | Jawny review_interrupted, nie not_delivered; brak nowego LLM. |
| Wszystkie typy lekcji i słownictwa | LLM dostaje faktyczną treść, odpowiedź i wzorce, bez identyfikatorów i audio. |
| Rodzic przed/po upływie 7 dni | Przed: kontekst oceny i usługa; po: bez szczegółów, pozostaje ogólne podsumowanie i punkty. |
| Model cytuje odpowiedź w reason | Cytat tylko w 7-dniowym raporcie; trwałe reason tworzy kod bez treści odpowiedzi. |
| Migracja starej historii | Próby/oceny/summary wiedzy identyczne; usunięte wyłącznie stare nagrody. |

</frozen-after-approval>

## Code Map

- Pomiar: `packages/kid-ui/src/session/activity-report.ts`, `activity-draft-store.ts`, `session-controller.ts`, `useLearningSession.ts`; media: `packages/kid-ui/src/media/{platform,browser}.ts` i odpowiednie fake/adapters/tests.
- Kontrakty: `packages/contracts/src/{reward-activity,parent-work-card,messages}.ts`; nie przenoś typów serwera do Kid UI.
- Ocena/zapis: `packages/server/src/modules/session-activity.ts`, `ports/ai.ts`, `providers/openai-compatible/session-activity.ts`, `modules/sessions.ts`, `modules/parent-work-card.ts`.
- Poprawne źródła semantyki odpowiedzi: `modules/lessons/{lesson-materialize,lesson-attempts,lesson-mock-tests}.ts`; nie twórz drugiego niezgodnego zestawu reguł.
- UI: `apps/web/src/parent/WorkCardPanel.tsx`, istniejąca informacja providera lekcji i router rodzica; informacje publiczne o usłudze bez apiKey.
- Testy: reporter/controller/browser unit, `tests/integration/{session-activity,session-activity-migration,parent-work-card,parent-work-card-regressions}.test.ts`, `tests/e2e/{kid-activity-lifecycle,parent-work-card}.spec.ts`.
- Dokumenty oryginalnego wdrożenia: `spec-client-reward-time.md` oraz `client-reward-time/{design,acceptance,migration}.md`.

## Tasks & Acceptance

### 1. Jedna reguła pomiaru pracy — F01/F04/F05/F06/F07/F08

- [x] W reporterze najpierw odtwórz RED: taskShown +300000 ms +pause('blur') daje obecnie 300000 ms zamiast 60000. Ujednolić domykanie idle/lifecycle/freeze; zachować rzeczywisty odsłuch i unię z pisaniem. Nie dodawać niezależnego licznika czasu.
- [x] Podłącz długość/rzeczywisty koniec audio z platformowego adaptera. Rozszerz istniejący port minimalnie, aktualizując jego implementacje i fake'i. Obsłuż koniec naturalny, stop, błąd, opóźnione zdarzenie i nieznaną długość konserwatywnie. Samo przycięcie tablicy playbacks nie wystarcza: test 2 s audio i callback po 300 s nie może dawać 300 s pracy. Nie przycinaj prawdziwego pisania do długości nagrania.
- [x] Feedback wzorca i poprawnej opcji kieruj przez istniejący wspólny wrapper mierzonego odtwarzania. Audio UI/instrukcji nie staje się automatycznie nagradzaną nauką. Czas pobierania/dekodowania nie udaje odsłuchu.
- [x] Przy pendingAttemptId przed pollingiem ustaw technical_wait, zachowując poprawne przypisanie zadania/próby. Guard epoch/task/session stosuj przed mutacją reportera w odpowiedzi async, nie dopiero w showResult. Test opóźnionego submit + retry + nowa sesja.
- [x] Jeden predykat wszystkich limitów raportu, globalnych/bajtowych i per zadanie, na wszystkich stopniach kompakcji. Test 257 okien edycji, 129 odsłuchów, 129 pauz oraz dotychczasowej dużej kartkówki. Nie scalaj przez luki tworząc fikcyjną pracę. Zachowaj sumę czasu, liczniki i zadania.

AC1: Given powyższe przebiegi, when zamrażamy raport, then schema go przyjmuje i naliczany czas odpowiada jednej regule bez idle/technical_wait.

### 2. Pełne, typowane dane dla LLM — F02

- [x] Zastąp luźną konwersję snapshotu małymi typowanymi funkcjami dla faktycznych promptów i kluczy. Uwzględnij answer kanoniczne + warianty, options/optionValues, segments/segmentValues, items/itemValues. Uporządkuj istniejącą duplikację czystej konwersji, jeśli można to zrobić bez szerokiego refaktoru lekcji.
- [x] Karty: title/body/examples. Notice: tekst zdań i segmentów. Sequence: faktyczna kolejność tekstów, bez null. Ćwiczenia obrazkowe opisz tekstem dostępnym po stronie serwera bez przesyłania mediów/assetId. Nie gub prawidłowego wzorca tylko dlatego, że acceptedAnswers jest puste.
- [x] Testy tabelaryczne każdej obsługiwanej odmiany na rzeczywistych kształtach prompt/key/answer; integracyjny fake reviewer musi zobaczyć oczekiwaną treść lekcji i sekwencji. Zachować test braku identyfikatorów i ograniczenia tekstu odpowiedzi do 200 znaków w zewnętrznym payloadzie.
- [x] Usuń martwy reportByTaskId i zbędne niewykorzystane metadane, o ile żaden odbiorca ich nie potrzebuje. Nie usuwaj informacji koniecznych do wyjaśnienia oceny.

AC2: Given poprawnie rozwiązane lesson_order i lesson_gap z pustymi dodatkowymi wariantami, when model dostaje wejście, then widzi rzeczywistą odpowiedź i kanoniczny wzorzec. Given karta/notice, then widzi materiał czytany przez dziecko.

### 3. Trwały raport i jednoznaczny wynik — F03/F09/G01

- [x] Rozszerz istniejący draft store o dokładny finalny payload i możliwość odnalezienia niedostarczonego raportu po restarcie. Zachowaj zgodność odczytu dotychczasowego draftu v1; nie zamieniaj tego w nowy framework kolejki. TTL 7 dni, per session i poprawne przypisanie do profilu; usuń tylko potwierdzoną kopię.
- [x] Zamroź payload raz jako niezależną kopię, zapisz przed wysłaniem. Na starcie/wyborze właściwego profilu umożliw istniejącemu przepływowi wznowienia dokończenie dostarczenia także zakończonej sesji. Retry transportowe to ten sam payload i fingerprint. Nie wywołuj ponownie LLM po zapisanym błędzie. Wynik already_started nie jest zakończoną oceną ani podstawą do bezpowrotnego usunięcia jedynej kopii; bez pętli pollingu oceny w tle.
- [x] Ujednolić rozstrzyganie review_interrupted po deadline przy istniejącym odczycie/endSession bez payloadu i w panelu rodzica. Zablokuj wyścig ze spóźnioną finalizacją. Bez drugiego LLM i bez nowego workera ocen.
- [x] Test kontrolera z nową instancją + magazynem; rzeczywisty Playwright reload aktywnej sesji i utraconego potwierdzenia końca. Test PostgreSQL przerwanego przeglądu i zwykłego odczytu po deadline. Nie wystarczy test wywołujący bezpośrednio Reporter.resume.

AC3: Given finalny raport został wysłany i karta odświeżona po utracie odpowiedzi, when wracamy, then ponawiany jest identyczny payload, a naliczenie i LLM występują najwyżej raz. Given przyjęcie bez finalizacji, when odczyt po deadline, then widzimy zapisany błąd bez punktów.

### 4. Weryfikowalny panel rodzica i retencja — F10/F11/F12

- [x] W stałym activityReview.reason przechowuj deterministyczny ogólny tekst utworzony z wyniku przez kod (np. liczba zadań zaliczonych/wykluczonych). Modelowy reason i konkretne uzasadnienia pozostają wyłącznie w activityReport z TTL. Dodaj instrukcję promptu, by ogólne uzasadnienie nie cytowało odpowiedzi; bezpieczeństwo trwałego zapisu nie zależy od posłuszeństwa LLM. Test modelu zwracającego cytat i test po cleanupie.
- [x] W istniejącej Karcie pracy dodaj prostą informację o usłudze otrzymującej odpowiedzi wszystkich ocenianych sesji. Udostępniaj wyłącznie bezpieczną nazwę/host/model konfiguracji, bez kluczy, credentials, query sekretów i wewnętrznych błędów providera. Brak konfiguracji opisz uczciwie.
- [x] Rozszerz ograniczone DTO rodzica o szczegóły zapisanej oceny: treść zadania, odpowiedzi i wzorce z serwerowego snapshotu, krótkie dane o aktywności i uwagi modelu. Jedno rozwinięcie w istniejącej karcie, bez nowego ekranu historii. Detale tylko przed expiresAt; po wygaśnięciu nie odtwarzaj ich z trwałych prób. Nie wystawiaj ich w Kid DTO.
- [x] Test parent endpointu/autoryzacji, UI przed i po TTL, cytatów i kształtu DTO dziecka. API → MCP → skill: sprawdź dotknięte kontrakty; nowe parent-only detale nie zmieniają learning-overview. Zapisz uzasadnienie i wykonane sprawdzenia w raporcie.

AC4: Given model zacytował odpowiedź, when upłynie 7 dni, then szczegóły API/JSONB nie są dostępne i trwałe reason nie zawiera cytatu. Given raport przed TTL, when rodzic rozwija kartę, then może sprawdzić pytanie, odpowiedź, aktywność i powód wykluczenia oraz zna usługę odbierającą dane.

### 5. Dowody migracji i odbiór — G02

- [x] Rozszerz istniejący test migracji PostgreSQL o rzeczywiste próby i oceny, pełną zawartość wyników wiedzy oraz kontrolę przed/po (z wyjątkiem summary.reward). Nie modyfikuj już poprawnej migracji tylko dla porządku. Sprawdź zachowanie punktów/reszty i DROP 10 tabel.
- [x] Przeczytaj package.json i uruchom testy celowane w trakcie, a po zakończeniu całej implementacji `pnpm test:unit`, `pnpm test:integration`, `pnpm typecheck`, `pnpm build` oraz adekwatne E2E lifecycle, audio, parent-work-card i oba podsumowania kartkówek. Nie powtarzaj całego E2E bez powodu. Bez pipe do tail, który ukrywa postęp; przy zawieszeniu sprawdź proces/webServer zamiast mnożyć timeout.
- [x] Zaktualizuj docs/SPEC.md i architecture.md tylko tam, gdzie doprecyzowano kontrakt. Nie zmieniaj frozen intent oryginalnej specyfikacji. Oznacz F/G w oryginalnej specyfikacji jako wykonane wyłącznie z rzeczywistym dowodem. Usuń odroczenie limitu audio, jeżeli zostało rozwiązane.
- [x] Dopisz do tego pliku raport wdrożenia: zmienione pliki, wykonane RED/GREEN, komendy i wyniki, pokrycie każdego wiersza macierzy oraz ograniczenia. Zostaw status `in-review` dla głównego agenta; nie deklaruj niezależnego review własnego kodu.

AC5: Given stary profil z historią prób/ocen, when migrujemy, then treść nauki jest identyczna, nagrody przeniesione, a wykonane testy dowodzą tego porównaniem danych. Given zakończone poprawki, then wszystkie zadania mają dowody i kod jest gotowy do niezależnego review, bez push/merge.

## Plan review po implementacji

Główny agent odczytuje rzeczywisty diff od commitu bazowego, oddziela pierwotną implementację od poprawek i weryfikuje każdy F/G i wiersz macierzy. Sprawdza zwłaszcza poprawność audio/idle, dokładność snapshotu, trwały payload i idempotencję, deadline oraz granicę retencji. Weryfikuje prostotę: bez dodatkowych stanów/kolejek i bez dublowania reguł. Zleca niezależną kontrolę zgodnie z bmad-build, triage'uje ustalenia i przekazuje poprawki z powrotem temu samemu implementerowi. Wynik prawdziwego LLM i migracja produkcyjna pozostają poza zakresem tej pracy.

## Raport implementacji (2026-10-20)

### Review Triage Log — główny agent, po pierwszej implementacji Luny

Trzy niezależne warstwy zakończyły review; poniżej werdykt każdego zgłoszenia przed grupowaniem. `high` = błąd kluczowego naliczania, `medium` = istotna poprawka/test, `false` = sprawdzone i odrzucone. Potwierdzone problemy skierowano do tego samego implementera jako poprawki; status pozostaje `in-review` do odbioru. Wyniki suite'ów poniżej odnoszą się do pierwszego drzewa, przed korektami review.

| Kandydat | Werdykt / dowód | Działanie |
|---|---|---|
| blind 1: późna edycja podczas wiszącego audio | high: reprodukcja audio 2s, edycja250s, koniec300s daje300000ms bez idle | poprawka wspólnego domykania przed nową interakcją |
| blind 2: >256 rozłącznych przedziałów | medium: 257 cykli blur/interakcja daje raport odrzucany przez schema | usunąć niższy limit przedziałów na zadanie, zachować globalny4096/bajty, test bezstratności |
| blind 3: usuwanie expired pomija fresh | medium: reprodukcja localStorage zwraca pustą listę przy istniejącym finalPayload | stabilna lista kluczy i test browser adaptera |
| blind 4: reason liczy inną populację | medium: kod odejmuje wykluczone prezentacje od assessed-only count; możliwe -1z0 | ta sama kolekcja ocenianych FE zadań i wykluczeń |
| blind 5: cytat pozostaje trwale | false: finalizacja zastępuje reason deterministycznie przed zapisem | odrzucone |
| blind 6: snapshot odtworzony po TTL | false: details powstaje tylko z activityReport przed expiresAt | odrzucone |
| blind 7: późny LLM naliczy ponownie | false: blokada i zapisany wynik/deadline zatrzymują finalizację | odrzucone |
| blind 8: already_started usuwa kopię | false: obie ścieżki zachowują finalPayload | odrzucone |
| blind 9: canonical answer wciąż ginie | false: answer i mapy są odczytywane niezależnie od dodatkowych wariantów | odrzucone |
| blind 10: credentials/query w usłudze | false: URL.host nie zawiera credentials, path, query | odrzucone |
| edge 1: późna edycja/audio | high: ta sama niezależna reprodukcja co blind1 | wspólna poprawka |
| edge 2: brak poprawnego raportu po kompakcji | medium: reprodukcja257cykli nie przechodzi schematu | wspólna poprawka |
| verification 1: test starego submitu tylko odrzuca | medium: odrzucenie nie wchodzi do #applyAttempt i nie wykrywa starego błędu | test sukcesu starej próby i zawartości raportuB |
| verification 2: test freeze nie mutuje kolekcji | medium: recordInteraction zmienia skalary; test przechodziłby ze starymi referencjami | recordEdit w istniejącym oknie, próba, odsłuch po snapshot |
| verification 3: adapter duration niepokryty | medium: browser test nie wywołuje onplaying, fake kontrolera zawsze null | test duration2s→2000ms w adapterze i kontrolerze |
| verification 4: brak browser lost-end ACK | medium: E2E reload aktywnej sesji; fake unit rzuca przed przyjęciem | E2E akceptuje /end, traci odpowiedź, ponawia identyczny JSON po reload |
| verification other: mutacja indeksów localStorage | medium: potwierdzone jak blind3 | wspólna poprawka |
| parent: powtórzone ternaries w typowanym switch | low: bezpośrednie usunięcie redundantnych gałęzi; czytelność konwersji i zawężanie TS | switch(p.kind), bez fikcyjnego lesson_card |
| parent: druga definicja StoredReport w karcie | low: dwa opisy tego samego zapisywanego JSONB mogą się rozjechać przy zmianie snapshotu | type-only import istniejącego wewnętrznego typu |
| parent: nowe teksty poza messages | low: bezpośrednie przeniesienie zgodnie z AGENTS, brak nowego mechanizmu | istniejący katalog workCard |
| parent: niepełna tabela typów promptu | medium: zaznaczone zadanie „każda odmiana” ma testy tylko części kształtów | testy pozostałych rzeczywistych schematów |

Reprodukcje rodzica: `%TEMP%/knowli-luna-final-review-repro.ts`; wcześniejsze regresje również ponownie sprawdzone — blur60s,257editWindows poprawnie kompaktowane, stara próba nie trafia już do nowej sesji, edycja3s przy późnym audio mieści się w63s. Nie powielano pełnych suite'ów podczas pracy implementera.

Poniższy raport opisuje pierwsze przekazanie implementacji do review, przed dodatkowymi poprawkami. Ostateczny wynik jest w sekcji „Odbiór końcowy” na końcu dokumentu. Zmiany obejmują reporter i kompakcję aktywności, pomiar audio, odzyskiwanie draftu/finalnego payloadu, typowane snapshoty zadań, rozstrzyganie przerwanego review, DTO i kartę pracy rodzica oraz test migracji.

**TDD RED → GREEN:** RED odtworzono dla blur po 300 s (przed poprawką pełne 300 s), 257 okien edycji bez kompakcji, spóźnionego callbacku audio z edycją, nadpisania finalPayload po `teardown`, oraz braku zapisu `technical_wait` przed pollingiem. GREEN: blur domyka się do limitu bezczynności; compaction przechodzi kontrakt; krótkie audio nie jest przedłużane przez callback i nie skraca zwykłego myślenia; zamrożony payload jest odłączoną kopią; final report po nowej instancji kontrolera jest wysyłany identycznie i kopia znika po udanym ACK. Dodatkowe testy obejmują opóźniony submit sesji A po uruchomieniu sesji B oraz `pendingAttemptId` w stanie `technical_wait`.

| Wiersz macierzy | Dowód |
|---|---|
| Blur/background po długim bezruchu | Unit reporter: aktywność ograniczona idle 60 s; blur zapisuje pauzę. |
| Krótkie audio, edycja, koniec/opóźnienie | Unit reporter/media; 2 s audio z późnym callbackiem nie zalicza całego oczekiwania; audio + edycja jest sumą unii. |
| Wznowienie `pendingAttemptId` | Controller test: draft ma `technical_wait`, polling kończy się przypiętym wynikiem bez drugiej próby. |
| Spóźniony submit starej sesji po starcie nowej | Controller test: późny błąd A nie zmienia tasku, feedbacku, offline ani draftu B. |
| 257 okien / limity wpisów na zadanie | Unit reporter testy kompakcji i walidacji raportu. |
| Reload aktywnej sesji | Playwright lifecycle: wypełnienie, blur, reload, wznowienie, zachowanie edycji i `unobserved` gap. |
| Utracone potwierdzenie końca | Dwie instancje kontrolera i wspólny draft store wysyłają identyczny payload; błędy/already_started zachowują kopię. |
| Przerwany review po deadline | PostgreSQL integration: zwykły end po deadline zwraca `review_interrupted`, 0 pkt, karta rodzica pokazuje błąd; zapytanie kandydatów filtruje `activityReview IS NULL` i deadline przed lockiem. |
| Treść zadań słownictwa/lekcji | Unit z `TaskPromptSchema` i rzeczywistym `materializeExercise`; PostgreSQL fake reviewer dla `lesson_order`/`lesson_gap`, 2D notice, obrazkowy visual bez asset ID, answer values i sequence. |
| Kontekst rodzica przed/po retencji | PostgreSQL test API sprawdza szczegóły przed i po cleanup; E2E karta sprawdza rozwinięcie, usługę oraz komunikat po wygaśnięciu. |
| Cytat modelu w reason | PostgreSQL test: cytat zostaje wyłącznie w raporcie TTL; trwały reason jest deterministyczny i po cleanup cytat znika. |
| Migracja starej historii | PostgreSQL migration test porównuje próby/oceny i pełny summary; różnica wyłącznie `summary.reward`; fixture próby jest finalizowany dopiero po wstawieniu assessment. |

**Weryfikacja końcowa:** `vitest run --config vitest.unit.config.ts` — 143 pliki, 1367 testów PASS; pełne `vitest run --config vitest.integration.config.ts` — 51 plików, 474 PASS, 2 istniejące testy SKIP; TypeScript `--noEmit` dla root, contracts, server, web, worker i kid-ui PASS; `next build apps/web` PASS; Playwright wybrane lifecycle, karta pracy, mock-test i lesson-mock-test — 16 PASS, oraz po dodaniu sprawdzenia wygasłych szczegółów `parent-work-card.spec.ts` — 5 PASS. E2E używa fixture przeglądarkowej, więc nie jest odbiorem na fizycznym urządzeniu. Żaden prawdziwy provider/LLM ani płatna usługa nie był wywoływany.

**API → MCP → skill:** nowe szczegóły są parent-only w kontrakcie karty pracy; `learning-overview` i jego MCP/skill pozostają vocabulary-only, więc ich kształt nie został zmieniony. Sprawdzenie MCP regresji: pełny zestaw integracyjny PASS; osobnej regeneracji schematu MCP nie wymaga ta zmiana. Brak pozostałych blokad implementacyjnych; niezależne review głównego agenta pozostaje do wykonania.

## Odbiór końcowy — główny agent

**Wynik: zaakceptowane w zakresie implementacji i automatycznej weryfikacji.** Plan przekazano GPT-6 Luna; po implementacji wykonano trzy niezależne warstwy review oraz samodzielną kontrolę rzeczywistego diffu i reprodukcji. Wszystkie potwierdzone ustalenia z powyższego triage zostały poprawione i sprawdzone. Nie ma otwartych usterek F01–F12/G01–G02 ani otwartych poprawek z review pierwszego drzewa Luny.

### Poprawki po review Luny

- Wspólne domykanie wygasłego odsłuchu przed interakcją, zmianą zadania, pauzą i freeze. Późna edycja250s przy audio2s i callbacku300s daje112000ms dwóch rzeczywistych okien, zamiast300000ms ciągłej aktywności; zwykły czas myślenia po audio pozostaje.
- Limit rozłącznych przedziałów jednego zadania korzysta z istniejącego globalnego limitu4096 wpisów. Reprodukcja257 cykli blur/interakcja przechodzi schemat bez łączenia bezczynnych luk. Pozostałe limity są nadal wspólnie kontrolowane.
- Browser draft store iteruje po stabilnej kopii kluczy: wygasły wpis nie zasłania ważnego finalPayload. Odtworzenie po utracie ACK jest sprawdzone przez rzeczywisty localStorage i reload w Playwright: identyczny JSON, zachowanie kopii przy already_started, usunięcie po wyniku.
- Trwałe uzasadnienie liczy dokładnie raportowaną/ocenianą kolekcję, włącznie z prezentacjami; LLM nie może wykluczyć niewysłanego ordinalu. Testy integracyjne obejmują samą ekspozycję, raport częściowy i błędny ordinal.
- Test starego submitu rozwiązuje również sukces po starcie sesjiB i sprawdza submittedAttempts. Test freeze faktycznie mutuje okno edycji, próby i odsłuchy po snapshot. Test adaptera emituje onplaying z duration2s, kontroler przekazuje2000ms do reportera.
- Recovery zakończonej kartkówki odświeża deck snapshot przed automatycznym resume, pilnuje epoch/profilu i usuwa zakończone activeSession z lokalnej kopii także przy błędzie odświeżenia. Nie rozpoczyna samo następnej kartkówki.
- Uproszczono describeTaskPrompt do typowanego switch(p.kind) z kontrolą wyczerpania wariantów, bez redundantnych ternaries i fikcyjnej karty. Parent DTO korzysta ze współdzielonego wewnętrznego StoredReport; nowe teksty są w messages.workCard.
- Główny agent poprawił dwie usterki kompilacji wprowadzone w ostatniej rundzie: typ statusów fixture E2E oraz brak przekazania epoch przy starcie z initialChildId. Usunął też niewykorzystany znacznik czasu z openPlayback i zamknął nieaktualne odroczenie audio.

### Końcowe dowody wykonane przez głównego agenta

| Sprawdzenie | Wynik |
|---|---|
| `corepack pnpm test:unit` | 144 pliki,1396/1396 PASS |
| `corepack pnpm test:integration` | 51 plików,475 PASS,2 istniejące SKIP; prawdziwy PostgreSQL |
| `corepack pnpm typecheck` | PASS, wszystkie6 konfiguracji; po korektach ostatniej rundy |
| `corepack pnpm build` | PASS |
| Playwright: kid-activity-lifecycle,parent-work-card,mock-test,lesson-mock-test | 16/16 PASS,42.5s, po ostatnich poprawkach |
| Rzeczywisty LLM, adapter produkcyjny i `SessionActivityReviewVerdictSchema` | 8/8 odpowiedzi poprawnych schematowo i zgodnych ze scenariuszami; szczegóły poniżej |
| Test kontrolera po poprawieniu przekazania epoch | 82/82 PASS |
| Reprodukcje pierwotne i z review Luny | PASS: idle,audio,późny submit,257edycji,257pauz,localStorage |
| `git diff --check` | PASS |

Pełnych suite'ów nie powtarzano po zmianach wyłącznie dokumentacyjnych. Pierwsze wykonanie końcowego typechecku wykryło dwie usterki kompilacji wymienione powyżej; poprawiono je, następnie typecheck, build, test kontrolera i E2E przeszły. Pełna integracja obejmuje zmiany serwera, migrację i integracje MCP; nie zmieniano kontraktu learning-overview ani nie regenerowano jego schematu.

Rzeczywisty model wywołano 8 razy na fikcyjnych danych. Test obejmował adapter produkcyjny i walidację schematu odpowiedzi, ale nie pełny przepływ HTTP/DB ani fizyczne urządzenie. Nie dowodzi niezawodności klasyfikacji dla wszystkich dzieci i zachowań. Nie wykonywano odbioru na fizycznym urządzeniu ani migracji produkcyjnej. Nie dodano tabel, kolejki ocen, ledgera ani mechanizmu ponownego LLM. Bez commit/push/merge; poprawki i dokumenty pozostawiono lokalnie w impl/client-reward-time, zgodnie z granicą przekazania.

### Rzeczywisty LLM — test promptu na fikcyjnych danych

Data: 2026-10-20. Adapter: `openai-compatible-session-activity`; prompt: `session-activity-v1`; model z lokalnego `.env`: `deepseek/deepseek-v4.1-flash`. Każdy scenariusz był osobnym wywołaniem, bez automatycznego ponawiania. Wszystkie osiem odpowiedzi przeszło ścisły `SessionActivityReviewVerdictSchema`.

| Scenariusz | Wynik | Oczekiwanie |
|---|---|---|
| A03: kilka błędnych, lecz powiązanych odpowiedzi | 0 wykluczeń | zaliczyć pracę |
| A04: „aaa” przy czterech różnych zadaniach | wykluczono zadania 0–3 z konkretnym uzasadnieniem | model może wskazać taki wzorzec |
| A05: „aaa” jest poprawną odpowiedzią | 0 wykluczeń | nie karać za sam tekst |
| A08: wiele edycji, końcowe „x” niezwiązane z zadaniem | wykluczono zadanie 0 | wskazać brak sensownej próby, nie liczyć edycji jako zadań |
| A09: trzy odsłuchy, powiązana poprawna odpowiedź | 0 wykluczeń | nie karać za odsłuch |
| A10: długie myślenie, powiązana poprawna odpowiedź | 0 wykluczeń | nie karać za tempo |
| A11: „Nie pamiętam”, pomoc, następnie poprawna odpowiedź | 0 wykluczeń | pomoc i brak pamięci nie są automatyczną odmową |
| A12: niepewne audio i przerwa techniczna | 0 wykluczeń | nie traktować jako dowodu braku pracy |

Wynik testu potwierdza zachowanie tego modelu dla tych ośmiu przykładów; nie jest miarą ogólnej trafności ani gwarancją wykrywania pozorowania aktywności.
