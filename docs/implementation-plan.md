# Rodzinny asystent nauki — plan implementacji MVP

## Uzupełnienie — niezawodność panelu rodzica (2026-10-09)

Panel zachowuje bazowy numer edycji podczas pollingu, ostrzega przed utratą niezapisanych zmian i po konflikcie pokazuje lokalną oraz zdalną wersję. Rodzic jawnie wybiera zdalną wersję, ręcznie przenosi potrzebne poprawki i zatwierdza zakończenie porównania. Nowa wersja po publikacji używa istniejącego przepływu szkicu. Szczegóły i dowody: `superpowers/plans/2026-10-09-parent-edit-protection.md`; testy `parent-edit-protection.spec.ts` (7/7), `manual-deck-flow.spec.ts` i `parent-flow.spec.ts` (24/24), `pnpm typecheck`. Natywne zachowanie `beforeunload` zależy od przeglądarki; automatyzacja sprawdza samo zdarzenie i czysty reload po zapisie.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Wybór trybu należy do użytkownika przed rozpoczęciem implementacji; bieżące zadanie obejmuje wyłącznie dokumentację.

**Goal:** Uruchomić rodzinne MVP, w którym rodzic przygotowuje i zatwierdza materiał, a dzieci uczą się z oddzielną historią, wymową i pisownią.

**Architecture:** Jeden workspace pnpm, Next.js web/API, Node worker i PostgreSQL. Kid UI komunikuje się przez jawne API. Historia jest relacyjna, a materiał i kryteria poszczególnych umiejętności są wersjonowane.

**Tech Stack:** Next.js, React, TypeScript, Zod, PostgreSQL, Drizzle, Graphile Worker, Tailwind, Docker/Coolify, Vitest, Playwright.

**Spec:** SPEC.md 1.1; architecture.md 1.2, schema.sql 1.2 i folder-structure.md 1.2. Przy przenoszeniu do repo wszystkie dokumenty umieścić w docs/. Ten plan umieścić w docs/implementation-plan.md.

## Global Constraints

- Profile dzieci, historia prób, pisownia i działanie bez mikrofonu są częścią MVP.
- Nie zapisujemy surowego nagrania jako części historii; nie umieszczamy go także w jobach, logach i plikach tymczasowych.
- „Nie pamiętam” oznacza trudność; cisza, awaria i „Pomiń” nie dowodzą braku wiedzy.
- Next.js/TypeScript jest wyborem zaakceptowanym. Nie dodawać osobnego backendu ani Redis.
- Krótkie sesje 5–10 minut; obietnica „Jeszcze 3” nie może się wydłużać.
- Reguły startowe: 300 sekund od ujawnienia, trzy ostatnie kwalifikujące sukcesy, inny dzień i minimum 12 godzin dla potwierdzenia po przerwie; dwa błędy przed wsparciem.
- Wymowa nie jest oceną treści; błędne lub niepewne rozpoznanie nie jest wiarygodnym wynikiem wymowy oczekiwanego słowa.
- Graphile retry nie oznacza exactly-once; idempotencję wyników zapewnia aplikacja.
- Kid UI nie importuje Next.js ani pakietów serwerowych; wszystkie sekrety i autorytatywne oceny pozostają na serwerze.
- Nie rozpoczynać source_material, OCR, czatu, realtime ani aplikacji Android.
- Wersje stabilne przypięte w lockfile i obrazach; nie korzystać produkcyjnie z RC/latest.
- Wartości proponowane w architekturze są startową konfiguracją, nie wynikiem badań z dzieckiem.

## Review Focus

1. Restart po opłaconej generacji przed zapisem: brak dwóch logicznych wyników i czytelna możliwość ponowienia — zadanie 3.
2. Utracone potwierdzenie klienta, dwa okna i retry po utracie sieci: brak fałszywego niezależnego sukcesu — zadania 6–7.
3. Niepoprawne słowo z wysokim score wymowy oczekiwanego tekstu: nie zaliczyć Recall — zadanie 8.
4. Edycja materiału podczas sesji: wynik starej wersji nie awansuje nowej — zadania 2 i 7.
5. Tło aplikacji, odmowa mikrofonu i autokorekta urządzenia: sesja pozostaje używalna, a nagranie nie pozostaje aktywne — zadania 8–9.

## Sposób wykonania

Każde zadanie kończy się działającym, weryfikowalnym fragmentem. Testy domeny i integralności danych powstają przed implementacją tych reguł; nie tworzymy testów wyłącznie sprawdzających wygląd konfiguracji. Setup i dokumentacja są częścią zadania, które ich potrzebuje. Po każdym zadaniu robimy oddzielny commit z podanych ścieżek.

Polecenia opisane poniżej są kontraktem przyszłego repo: pnpm test:unit uruchamia Vitest domeny; pnpm test:integration uruchamia wskazane pliki z testowym PostgreSQL; pnpm test:e2e uruchamia Playwright. Nie są deklaracją istniejących już skryptów.

## Kontrakty przekazywane między zadaniami

Implementacja contracts definiuje typy runtime przez Zod, a TypeScript wyprowadza typy z tych schematów. UUID to string walidowany jako UUID; Instant to ISO datetime; Day to YYYY-MM-DD.

| Typ | Minimalna treść i właściciel |
| --- | --- |
| Services | db, providers, media, clock, policyRegistry; packages/server/src/config.ts |
| ChildInput / ChildDto | displayName, avatarKey, birthYear? / dodatkowo id; contracts/decks.ts |
| VocabularyItemInput | source, target, acceptedAnswers[], locales, example?, visualType, visualData?; contracts/decks.ts |
| DraftInput / DraftPatch / DraftDto | title, items / zmieniane pola i wymagany expectedEditNumber / id, deckId, editNumber, status, zasoby; contracts/decks.ts |
| GenerationCommand / GenerationDto | prompt, sourceLocale, targetLocale, clientRequestId / id, deckId, state, progress, errorCode?; contracts/decks.ts |
| SessionInput / SessionDto | childId, deckId, microphoneEnabled / id, pinnedVersion, budget, state; contracts/kid.ts |
| SessionSummaryDto | sessionId, completedTasks, independentlyRecalledCount, independentlySpelledCount, practiceAgainCount; contracts/kid.ts |
| Skill / Policy | pięć kodów umiejętności MVP / wersja i jawna konfiguracja czasów, limitów oraz pasm providera; server/domain/types.ts |
| KidApi / PlatformMedia / LocalPreferences | metody klienta odpowiadające Kid API / recorder, player i cleanup / getSelectedChildId, setSelectedChildId, getSessionId, setSessionId; kid-ui/api/client.ts i media/platform.ts |
| TaskDto | id, kind, publicPrompt, mediaIds, optionIds, stepIds, remaining; bez answer_key; contracts/kid.ts |
| AttemptInput | clientAttemptId, taskId, discriminator choice/text/audio/dont_remember/skip, właściwy payload; contracts/kid.ts |
| AttemptDto | id, state, feedback, canRetry, nextAction; bez technicznego score dla dziecka; contracts/kid.ts |
| DisclosureInput / DisclosureDto | taskId, serwerowy stepId / dozwolona treść albo autoryzacja odsłuchu; contracts/kid.ts |
| PresentationCompletionInput / PresentationCompletionDto | taskId, clientCommandId / taskId, terminalny state; contracts/kid.ts |
| EventInput | opcjonalna obserwacja: clientEventId, taskId, stepId, eventKind; bez target_key i autorytatywnego czasu; contracts/kid.ts |
| AnswerKey | oczekiwane wartości, warianty, mapping opcji, kryteria; prywatny server/domain/types.ts |
| EvaluationContext | receivedAt, policy, lastExposureAt, firstTry, assistance, previousSessionContactAt, timezone; zamrożone przy przyjęciu próby; server/domain/types.ts |
| Grade | wyniki per skill: outcome, reason, independent, confirmationEligible, details; server/domain/types.ts |
| History / Progress | uporządkowane oceny z czasem/polityką / status, streak, nextReviewAt; server/domain/types.ts |
| ScheduleInput / TaskPlan | przypięta treść, postęp, trudności, budżet, termin, rezerwacje celów samodzielnego sprawdzenia, now / element, exerciseType, wsparcie; server/domain/scheduler.ts |
| AudioInput / SpeechEvidence | krótkotrwałe bytes, mime, locale / transkrypcja i osobny wynik wymowy; server/ports/ai.ts |
| ProgressDto | osobne umiejętności, stan nieoceniony, trudne elementy, kierunkowe pomyłki; contracts/progress.ts |

Nie eksportować Services, Grade ani AnswerKey do pakietu przeglądarkowego.

## Zadanie 0 — sprawdzenie mowy i mediów przed dużą implementacją

**Rezultat:** potwierdzony technicznie sposób nagrania, transkrypcji, oceny wymowy i syntezy; wynik opisany bez archiwizacji głosu dziecka.

**Pliki:** docs/speech-spike.md, docs/provider-config.md; tymczasowy prototyp poza kodem produktu.

**Consumes:** SPEC §22–24, telefon/tablet docelowy i skonfigurowane klucze usług dostarczone na etapie wykonania.

**Produces:** konfiguracja modeli, głosu en-GB, format wejścia i normalizacji, kryteria wiarygodności, pomiary opóźnienia i wniosek go/no-go. Żadne nagranie nie staje się fixture w repo.

- [ ] Ustalić krótką macierz próby: poprawne słowo, inne słowo, zniekształcona wymowa, cisza, hałas i odmowa mikrofonu; Wednesday/Thursday/Tuesday plus apple/red.
- [ ] Uruchomić tymczasowy ekran nagrywania na docelowym urządzeniu i potwierdzić rzeczywisty MIME/kodek; dopiero potem wybrać konwersję w pamięci.
- [ ] Sprawdzić oddzielnie rozpoznanie treści i wymowę, w tym błędne słowo oceniane względem expectedText. Jeśli brak wiarygodnego STT, nie zastępować go score wymowy.
- [ ] Wygenerować wzorzec TTS oraz obraz obiektu i czynności; sprawdzić możliwość zapisania i ponownego odtworzenia bez ponownego wywołania API.
- [ ] Zapisać czasy, przykładowe wyniki tekstowe bez danych osobowych, warunki retencji usług i proponowane pasma oceny. Kryterium techniczne: cały request kończy się wynikiem lub kontrolowanym timeoutem w 30 sekund; wynik niepewny jest nieoceniony. Szybkość wygodną dla dziecka ocenia rodzic w praktyce.
- [ ] Przedstawić wynik go/no-go. Brak kalibracji nie blokuje pracy nad tekstową częścią aplikacji, ale blokuje uznanie pełnego modułu Speech za gotowy. Usunąć prototyp i nagrania po próbie; zachować raport. Commit: docs: record speech and media feasibility.

## Zadanie 1 — uruchamialny fundament, dostęp rodzica i profile

**Pliki:** workspace package.json, pnpm-workspace.yaml, apps/web/src/composition.ts, packages/contracts/src/{common,decks,messages}.ts, packages/server/src/{config,db/client,db/schema,modules/auth,modules/profiles}.ts, packages/server/drizzle/, apps/web/src/http/security.ts, API login i profiles, tests/integration/auth-profiles.test.ts.

**Consumes:** schema.sql jako projekt do odwzorowania; decyzje fazy 0 nie są potrzebne dla profili.

**Produces:** createChild(s: Services, input: ChildInput): Promise<ChildDto>; deleteChild(s, childId): Promise<void>; loginParent(s, secret: string): Promise<{token: string; expiresAt: string}>; requireParent(s, token: string): Promise<void>.

- [ ] Utworzyć minimalny workspace i skrypty sprawdzeń wraz z testem integracyjnym: poprawny login działa, błędny nie tworzy sesji, parent endpoint bez cookie zwraca 401, dwa profile mają różne ID.
- [ ] Dodać test pierwszego uruchomienia: przy braku parent_credentials jednorazowy setup tworzy poświadczenia i przestaje być dostępny; równoległa konfiguracja nie tworzy drugiego wiersza.
- [ ] Uruchomić pnpm test:integration tests/integration/auth-profiles.test.ts; oczekiwane RED z powodu brakujących przypadków użycia.
- [ ] Odwzorować DDL w Drizzle, zachować klucze złożone i triggery jako jawne migracje. Zaimplementować transakcje, sesje, scrypt, limity loginu oraz walidację danych profilu; wszystkie query mają określone typy.
- [ ] Uruchomić powyższy test oraz pnpm typecheck. Wynik: PASS; baza po ponownym uruchomieniu zachowuje profile.
- [ ] Commit: feat: bootstrap app with parent access and child profiles.

## Zadanie 2 — wersje zestawów i umiejętności

**Pliki:** packages/server/src/modules/decks.ts, domain/revision-impact.ts i revision-impact.test.ts, tests/integration/revisions.test.ts, contracts/decks.ts.

**Consumes:** Services i profil z zadania 1.

**Produces:** createDraft(s, input: DraftInput): Promise<DraftDto>; editDraft(s: Services, draftId: string, input: DraftPatch): Promise<DraftDto>; classifyRevisionImpact(oldItem, newItem): Set<Skill>; publishDraft(s, draftId, expectedEditNumber): Promise<{deckVersionId: string}>.

- [ ] Dodać testy: ilustracja zachowuje skill_version; zmiana znaczenia zmienia listening/reading/recall; zmiana target zmienia pięć kluczy; edycja published kończy się błędem; obcy deck_version odrzuca FK.
- [ ] Uruchomić pnpm test:unit revision-impact oraz pnpm test:integration tests/integration/revisions.test.ts; oczekiwane RED przed implementacją.
- [ ] Zaimplementować szkice, optimistic locking edit_number, kopiowanie rewizji oraz mapowanie kluczy umiejętności. Stare sesje pozostają przypięte do starej wersji. Zaimplementować walidator publikacji z fake-ready mediami do czasu zadania 3.
- [ ] Powtórzyć testy; wymagane PASS również dla dwóch konkurujących edycji, z których tylko jedna ma właściwy edit_number.
- [ ] Commit: feat: version learning content and skill criteria.

## Zadanie 3 — trwałe generowanie, TTS i ilustracje

**Pliki:** server/modules/{generation,media-reconciliation}.ts, ports/{ai,media}.ts, providers/openai/, providers/images/, providers/media/local.ts, worker/src/{main,tasks,composition}.ts, tests/integration/{generation,media}.test.ts.

**Consumes:** createDraft/editDraft, Services, konfiguracja fazy 0; testy używają fake-providerów.

**Produces:** enqueueDeckGeneration(s, cmd: GenerationCommand): Promise<{runId: string; deckId: string}>; executeGeneration(s, runId: string): Promise<void>; retryGeneration(s, runId): Promise<{runId: string}>; readGeneration(s, runId): Promise<GenerationDto>. Porty: LlmProvider.generateDeck(input, signal), TtsProvider.synthesize(input, signal), ImageProvider.generate(input, signal), MediaStore.putImmutable/get. reconcileDraftAssets(s, draftId) działa w transakcji edycji: dobiera zasoby po fingerprint, zachowuje zgodne wyniki i zleca brakujące.

- [ ] Dodać testy: duplicate request nie tworzy drugiego zestawu; niepoprawny JSON nie publikuje; TTS o tym samym fingerprint używa jednego zasobu; obraz może failed bez utraty draftu; stary edit_number generacji LLM nie nadpisuje nowego szkicu. Media job ma tylko asset_id; zmiana ilustracji nie unieważnia trwającego TTS innej karty.
- [ ] Dodać test Review Focus 1: worker zatrzymany po uzyskaniu wyniku, przed zapisem; ponowienie kończy się jednym logicznym asset/run. Sprawdzić też lease na współdzielonym asset, późny wynik starego właściciela i brak nadpisania istniejącego blobu. Ręczna regeneracja tworzy nowe asset_id/generation_number; opublikowane audio pozostaje identyczne.
- [ ] Uruchomić pnpm test:integration tests/integration/generation.test.ts tests/integration/media.test.ts i uzyskać RED.
- [ ] Zaimplementować atomowe enqueue z zapisem run, lease compare-and-set, limity i maksymalnie trzy automatyczne próby, stany pending/ready/failed oraz content-addressed putImmutable z atomowym zapisem bez nadpisania. Gotowy asset jest niezmienny; media job nie zależy od edit_number. Każda edycja uzgadnia powiązania zasobów i zleca brakujące w tej samej transakcji. Stary worker może zostawić niepowiązany blob, ale nie może podmienić opublikowanego ani powiązań szkicu. Dodać adaptery według fazy 0, bez modeli w domenie.
- [ ] Uruchomić testy i próbę restartu workera na fake-providerach; oczekiwane PASS i zachowanie zleconych zadań po restarcie.
- [ ] Commit: feat: generate reviewed learning media through durable jobs.

## Zadanie 4 — pełny workflow rodzica i publikacja

**Pliki:** apps/web/src/parent/{DeckEditor,ChildEditor}.tsx, parent-router.ts, API parent/[...path]/route.ts, server/modules/decks.ts, tests/e2e/parent-flow.spec.ts.

**Consumes:** operacje zadań 1–3; polling readGeneration.

**Produces:** upsertAssignment(s, childId, deckId, testDate: string | null): Promise<void>; archiveDeck(s, deckId): Promise<void>; interfejs generuj → preview/edit → publikuj → przypisz.

- [ ] Dodać test E2E: wygeneruj siedem dni, popraw słowo, odtwórz nowe audio, usuń zły obraz, przypisz dwojgu dzieciom z różnymi datami; szkic nie jest dostępny w Kid API.
- [ ] Dodać przypadek blokady publikacji przy brakującym obowiązkowym TTS oraz zezwolenia po jawnym pominięciu ilustracji.
- [ ] Uruchomić pnpm test:e2e tests/e2e/parent-flow.spec.ts; oczekiwane RED.
- [ ] Zaimplementować widoki, przypisania, walidację i publikację. Zmiana wariantów odpowiedzi musi być widoczna rodzicowi. Nie ukrywać kosztownej regeneracji za każdym naciśnięciem klawisza.
- [ ] Powtórzyć test E2E; oczekiwane PASS również po odświeżeniu strony podczas generowania.
- [ ] Commit: feat: let parents review publish and assign decks.

## Zadanie 5 — ocena i projekcja postępu jako czysta domena

**Pliki:** server/domain/{types,evaluate,independence,progress,feedback}.ts, policies/learning-v1.ts i odpowiadające *.test.ts.

**Consumes:** AnswerKey, EvaluationContext oraz History; brak bazy i SDK.

**Produces:** evaluateWritten(answer: string, key: AnswerKey, ctx: EvaluationContext): Grade; qualifyAttempt(ctx): {independent: boolean; confirmationEligible: boolean; reason?: string}; projectProgress(history: History, policy: Policy, now: string): Progress.

- [ ] Napisać testy z kontrolowanym czasem: Monday jest poprawne, monday nie zalicza pełnej pisowni, zatwierdzony wariant działa, przypadkowy podobny wyraz nie jest samoczynnie poprawny. Pierwsze 299 sekund od ekspozycji nie kwalifikuje Recall, 300 sekund spełnia warunek czasu.
- [ ] Napisać testy: trzy kwalifikujące sukcesy z przerwą spełniają regułę; sukces–błąd–sukces nie daje serii trzech; 23:59 → 00:01 nie spełnia 12 godzin; nieocenione nie resetuje serii; nie pamiętam w sprawdzaniu resetuje ją; błędna pisownia nie kasuje poprawnego Recall.
- [ ] Napisać test kierunków reading: trzy kwalifikujące sukcesy w jednym kierunku nie opanowują umiejętności; ocena zapisuje direction w details, a projekcja wymaga obu kierunków.
- [ ] Uruchomić pnpm test:unit; oczekiwane RED dla nowych funkcji.
- [ ] Zaimplementować funkcje bez efektów ubocznych i rzeczywistego zegara. Oddzielić provider score od polityki oceny; nie wprowadzać uniwersalnego progu 80.
- [ ] Uruchomić pnpm test:unit i uzyskać PASS dla granic czasu, kapitalizacji i DST w Europe/Warsaw.
- [ ] Commit: feat: implement explainable learning and mastery rules.

## Zadanie 6 — sesje, pytania i ekspozycje

**Pliki:** server/modules/{sessions,events}.ts, domain/scheduler.ts i scheduler.test.ts, contracts/kid.ts, tests/integration/sessions.test.ts.

**Consumes:** wersje z zadania 2, projekcje zadania 5.

**Produces:** startSession(s, input: SessionInput): Promise<SessionDto>; nextTask(s, sessionId): Promise<TaskDto | null>; recordEvent(s, input: EventInput): Promise<void>; authorizeDisclosure(s, input: DisclosureInput): Promise<DisclosureDto>; completePresentation(s, input: PresentationCompletionInput): Promise<PresentationCompletionDto>; selectTask(input: ScheduleInput): TaskPlan | null; endSession(s, sessionId): Promise<SessionSummaryDto>.

- [ ] Napisać testy: dwa równoległe starty dają jedną sesję; next retry zwraca to samo issued task; brak mikrofonu wyklucza pronunciation; dwie pomyłki dają wsparcie i przerwę od elementu; końcowe trzy zadania nie rosną.
- [ ] Napisać test cyklu życia sesji: start dla innej talii zamyka aktywną sesję jako ended; sesja bez zdarzeń przez ponad 30 minut zamyka się zamiast być wznawiana; limit czasu kończy sesję między zadaniami i nigdy po obietnicy „Jeszcze N”.
- [ ] Napisać test Review Focus 2: audio/wybór ujawnia target także w innym ćwiczeniu; dystraktor Wednesday staje się ekspozycją Wednesday. Zapis ujawnienia poprzedza odpowiedź HTTP i działa bez ACK; test obejmuje utracony ACK, reload, retry feedbacku i drugi klient. Ten sam clientEventId nie tworzy dwóch obserwacji; każde ponowne wydanie treści odświeża możliwą ekspozycję.
- [ ] Uruchomić pnpm test:integration tests/integration/sessions.test.ts oraz pnpm test:unit scheduler; oczekiwane RED.
- [ ] Dodać test: exposure → complete-presentation → next działa bez attempt/assessment i bez zużycia budżetu; retry completion nie kończy kolejnego zadania. Odrzucić completion dla zadania ocenianego.
- [ ] Dodać test schedulera z należnymi Recall i pisownią: cel nie pojawia się wcześniej w recognition/dystraktorze; oba wyniki można zebrać z jednej pisemnej odpowiedzi. Pominięcie/podpowiedź zwalnia rezerwację; nieznane słowa nie są sprawdzane przed nauką.
- [ ] Zaimplementować blokady sesji, przypięcie wersji i polityki, ujawnienia serwerowo określonych stepId, zamknięcie prezentacji, budżet oraz rezerwacje celów i priorytety scheduler v1. Prezentacja nie liczy się jako poprawna próba, feedback bieżącej próby jest ekspozycją dopiero po ocenie.
- [ ] Powtórzyć testy; oczekiwane PASS. Sprawdzić start bez opublikowanego zestawu: czytelny pusty widok, bez wygenerowania fikcyjnych zadań.
- [ ] Commit: feat: schedule bounded sessions with exposure tracking.

## Zadanie 7 — wiarygodne przyjmowanie odpowiedzi

**Pliki:** server/modules/attempts.ts, kid-router.ts, API kid/[...path]/route.ts, tests/integration/{attempts,history}.test.ts, tests/e2e/privacy.spec.ts.

**Consumes:** evaluateWritten/qualifyAttempt/projectProgress, zadania sesji i ich prywatne klucze.

**Produces:** submitAttempt(s, input: AttemptInput): Promise<AttemptDto>; readAttempt(s, attemptId): Promise<AttemptDto>; finalizeAttempt(s, attemptId, grade: Grade): Promise<AttemptDto>.

- [ ] Napisać testy: powtórzone clientAttemptId z tą samą treścią zwraca ten sam wynik; inna treść daje 409; wynik drugiego dziecka nie może trafić do zadania pierwszego; awaria w połowie transakcji nie pozostawia zaktualizowanej tylko połowy postępu.
- [ ] Napisać test leniwej finalizacji: processing starsze niż 60 sekund zamienia się w nieocenione przy readAttempt oraz przy złożeniu nowej próby tego samego zadania, bez osobnego joba w tle.
- [ ] Napisać test Review Focus 4: publikacja zmienionego słowa podczas sesji nie pozwala starej próbie awansować nowego skill_version. Przycisk „Nie pamiętam” tworzy trudność bez confusion; skip nie udaje błędu.
- [ ] Uruchomić pnpm test:integration tests/integration/attempts.test.ts tests/integration/history.test.ts; oczekiwane RED.
- [ ] Dodać testy history.test.ts: nie można zmienić answer_key wydanego zadania, ekspozycji ani usunąć/ponownie wstawić oceny zakończonej próby; usunięcie profilu usuwa całą jego historię. Weryfikować blokady assessment insert kontra finalizacja.
- [ ] Zaimplementować jednokrotną finalizację, stan processing/completed, wynik per skill i aktualizację projekcji w tej samej transakcji. Kontekst kwalifikacji zamrozić przy received_at pod blokadą sesji; test 299 sekund + 30 sekund analizy nadal nie kwalifikuje Recall. Odczyt/retry feedbacku zapisuje ujawnienie przed wysłaniem. Kid DTO nie zawiera answer_key ani technicznego score. Zasady wyboru feedbacku pochodzą z domeny.
- [ ] Uruchomić integrację i pnpm test:e2e tests/e2e/privacy.spec.ts; oczekiwane PASS i brak sekretów/ukrytych odpowiedzi w response.
- [ ] Commit: feat: persist attempts and progress atomically.

## Zadanie 8 — ocena mowy bez trwałego audio

**Pliki:** server/modules/speech.ts, providers/azure/, providers/audio/normalize.ts, ports/ai.ts, tests/integration/speech.test.ts, kid-ui/src/media/{platform,browser}.ts.

**Consumes:** konfiguracja fazy 0 i finalizeAttempt zadania 7.

**Produces:** analyzeSpeech(s, audio: AudioInput, key: AnswerKey, signal: AbortSignal): Promise<SpeechEvidence>; assessSpeechEvidence(evidence, key, ctx): Grade; BrowserRecorder.start/stop/cancel.

- [ ] Napisać testy z fake-providerami: poprawne słowo + awaria pronunciation daje częściowy wynik; cisza/hałas/timeout nie obniżają postępu; za duży payload jest odrzucany przed pełnym buforowaniem; processing retry nie wywołuje providera drugi raz.
- [ ] Napisać test Review Focus 3: STT zwraca Tuesday, pronunciation zwraca wysoki score dla Thursday — Recall nie jest poprawny, a wynik wymowy Thursday pozostaje nieadekwatny. Niepewny STT nie tworzy mylonej pary. Dla sofa z zatwierdzonym couch, transkrypcja couch zalicza Recall; wymowa oceniona względem sofa nie jest używana. Ocenić couch w tym samym deadline albo pozostawić pronunciation nieocenione.
- [ ] Uruchomić pnpm test:integration tests/integration/speech.test.ts; oczekiwane RED.
- [ ] Zaimplementować streaming limitu 2 MiB, limit 15 sekund po dekodowaniu, konwersję sprawdzoną w fazie 0, 30-sekundowy deadline i finalizację starych processing po 60 sekundach. Nie używać trwałej kolejki dla audio. Zwalniać mikrofon i bufory po końcu, błędzie i anulowaniu.
- [ ] Uruchomić testy; zweryfikować brak plików/audio w logach również przy wyjątkach. Powtórzyć krótką próbę na urządzeniu, porównując z wynikami fazy 0.
- [ ] Commit: feat: assess child speech with ephemeral audio.

## Zadanie 9 — pełny Kid Mode i PWA

**Pliki:** packages/kid-ui/src/KidApp.tsx, api/client.ts, session/useLearningSession.ts, screens/, exercises/, visuals/Visual.tsx, styles.css, web/app/learn/page.tsx, manifest.ts, tests/e2e/kid-flow.spec.ts.

**Consumes:** Kid API z zadań 6–8, platform media z zadania 8.

**Produces:** KidApp({api: KidApi, media: PlatformMedia, storage: LocalPreferences}); ekran wyboru profilu, tematu, nauki i końca, manifest PWA.

- [ ] Napisać E2E: jeden profil pomija wybór; dwa profile mają osobne sesje; exposure → rozpoznawanie → Recall → pisownia; przyciski Nie pamiętam/Pomiń działają zgodnie z kontraktem.
- [ ] Napisać testy Review Focus 5: odmowa mikrofonu przełącza na tryb bez nagrywania; opuszczenie widoku zatrzymuje stream; błąd sieci pokazuje zapis w toku/błąd i nie dopisuje sukcesu lokalnie.
- [ ] Uruchomić pnpm test:e2e tests/e2e/kid-flow.spec.ts; oczekiwane RED.
- [ ] Zaimplementować ekrany i ćwiczenia z minimalnym tekstem, odsłuchem na żądanie, brakującymi literami i samodzielną pisownią. Przed ujawnieniem podpowiedzi/odtworzeniem wzorca uzyskać serwerową autoryzację także dla pliku w cache; opcjonalny ACK tylko potwierdza obserwację. Exposure zamykać przez complete-presentation. Po utracie sieci ukryć wzorce, zablokować odsłuchy i oceniane próby; powrót z tła odświeża krok. Nie dodawać zadań po obiecanym końcu. PWA nie cache'uje prywatnych API i nie obiecuje offline.
- [ ] Uruchomić E2E, pnpm typecheck i sprawdzenie zależności pakietów. Ręcznie ocenić dotyk, klawiaturę/autokorektę, audio, powrót z tła i instalację PWA na docelowym urządzeniu.
- [ ] Commit: feat: deliver child learning flow as portable PWA UI.

## Zadanie 10 — panel postępów i zarządzanie historią

**Pliki:** server/modules/reporting.ts, contracts/progress.ts, parent/ProgressPanel.tsx, parent/progress/page.tsx, tests/integration/reporting.test.ts, uzupełnienie auth-profiles.test.ts.

**Consumes:** historia i projekcje zadań 5–8, przypisania z zadania 4.

**Produces:** getProgress(s, childId, deckId): Promise<ProgressDto>; usunięcie profilu wraz z historią i transkrypcjami.

- [ ] Napisać test: child A rozpoznaje 7/7, Recall 5/7, pisownia 3/7, speech nieocenione; child B pozostaje bez tych wyników. Thursday → Tuesday nie jest automatycznie pokazywane jako oba kierunki.
- [ ] Napisać test: po zmianie znaczenia nowy klucz ma needs_confirmation, ale stary wynik można odczytać w historii; usunięcie dziecka usuwa jego próby i nie usuwa wspólnego zestawu.
- [ ] Uruchomić pnpm test:integration tests/integration/reporting.test.ts; oczekiwane RED.
- [ ] Zaimplementować zwięzłe zapytania i widok. Dane score oznaczyć jako ocenę automatyczną konkretnej usługi; nie uśredniać nieporównywalnych skal/providerów.
- [ ] Uruchomić testy raportowania i usuwania; oczekiwane PASS.
- [ ] Commit: feat: report skill-specific progress and confusions.

## Zadanie 11 — wdrożenie i próba całego MVP

**Pliki:** deploy/{Dockerfile,compose.yaml,migrate.ts,backup.sh,restore.sh}, .env.example, docs/backup-restore.md, docs/provider-config.md, health endpoints, uzupełnienie E2E.

**Consumes:** pełny przepływ zadań 1–10 oraz zaakceptowana konfiguracja usług.

**Produces:** prywatne uruchomienie w Coolify, instrukcja konfiguracji i zweryfikowany backup/restore. Publiczne wystawienie wymaga wcześniejszego ustalenia bramy dostępu.

- [ ] Zdefiniować test dymny: generacja fake → publikacja → sesja → zapis → restart web/worker → odczyt tych samych wyników i plików.
- [ ] Zbudować obrazy, dodać jednorazowe migracje aplikacji/kolejki, healthcheck i sekrety runtime. Tylko web otrzymuje port przez HTTPS; baza pozostaje prywatna.
- [ ] Uruchomić pnpm test:unit, pnpm test:integration, pnpm test:e2e, pnpm typecheck, pnpm build i test dymny na Compose. Zakończenie wymaga PASS, nie samego uruchomienia poleceń.
- [ ] Zrobić backup, odtworzyć w osobnej pustej instancji i sprawdzić profile, published version, history i media. Zanotować wynik w docs/backup-restore.md.
- [ ] Przejść z rodzicem i dzieckiem dwie krótkie sesje na rzeczywistym zestawie oraz powtórkę po przerwie. Sprawdzić, czy system odróżnia poprawność z podpowiedzią od samodzielności i czy feedback mowy jest wiarygodny.
- [ ] Skorygować parametry wyłącznie jako nową wersję polityki, bez przepisywania historycznych wyników. Commit: ops: deploy and verify family learning MVP.

## Mapa kryteriów SPEC → zadania

| Kryteria | Zadania |
| --- | --- |
| A01–A03: szkic, zatwierdzenie, edycja/audio | 2, 3, 4 |
| A04–A05: profile i osobny postęp | 1, 9, 10 |
| A06–A08: exposure i właściwe rozpoznawanie | 5, 6, 9 |
| A09–A12: treść vs wymowa, podpowiedzi, awarie, brak mikrofonu | 5, 7, 8, 9 |
| A13–A14: wsparcie po błędach, mylone pary | 6, 7, 10 |
| A15–A18: pisownia, literówki, potwierdzenie, sprawdzian | 5, 6, 9 |
| A19–A21: cache, retry, brak trwałego audio | 3, 7, 8 |
| A22–A25: raport, koniec, trwałość i urządzenia | 9, 10, 11 |
| A26–A28: niedawna ekspozycja, edycja i aktywna sesja | 2, 5, 6, 7 |
| A29–A30: seria wyników i prawdziwa przerwa | 5 |
| A31–A34: nie pamiętam, skip, odsłuch jako pytanie/wsparcie | 5, 6, 7, 9 |
| A35–A37: kapitalizacja, warianty, klawiatura | 5, 9 |
| A38–A39: generowanie i pomijanie obrazów | 0, 3, 4 |

## Regresje z review architektury 1.1

| ID | Obowiązkowy scenariusz | Zadania |
| --- | --- | --- |
| R01 | Utrata ACK, reload i dwa klienty nie pomijają ekspozycji; kwalifikacja według received_at | 6, 7, 9 |
| R02 | Regeneracja współdzielonego audio i stary worker nie zmieniają gotowych bajtów | 3 |
| R03 | SQL odrzuca zmianę klucza zadania, ekspozycji i oceny po finalizacji; CASCADE profilu działa | 1, 7, 10 |
| R04 | Zakończenie exposure pozwala przejść dalej, jest idempotentne i nie tworzy wyniku | 6, 9 |
| R05 | Należny niezależny sprawdzian poprzedza ujawnienia także jako dystraktor | 5, 6 |
| R06 | Edycja innej karty/ilustracji podczas TTS zachowuje zgodne audio; zmieniony tekst dostaje nowe | 2, 3, 4 |
| R07 | Zatwierdzony wariant mowy zalicza treść; wymowa dotyczy faktycznego wariantu lub jest nieoceniona | 0, 8 |

## Bramki decyzji

1. Przegląd tej architektury i schematu przed implementacją.
2. Wybór trybu wykonania planu. Rekomendacja: realizacja bezpośrednio etapami w tej rozmowie, z przeglądem po każdym działającym fragmencie; delegowanie tylko po wybraniu go przez użytkownika.
3. Akceptacja wyniku próby mowy i parametrów usług przed uznaniem Speech za gotowe.
4. Osobna decyzja o sposobie dostępu spoza domu przed wystawieniem usługi.

## Weryfikacja pakietu dokumentów

Przygotowano dokumenty, a nie implementację aplikacji. Sprawdzono 73 instrukcje schema.sql parserem PostgreSQL. Wykonano pełny DDL w izolowanym PGlite (PostgreSQL w WebAssembly): PASS. Przeszło 56 sprawdzeń ograniczeń i operacji SQL, w tym niezmienności zadania, oceny, ekspozycji i gotowego zasobu; zamrożenia kontekstu próby; zamknięcia prezentacji; oddzielenia media job od draftu; odrzucenia starego lease przez CAS; oraz kaskadowego usuwania profilu z zachowaniem wspólnych zestawów. Testy SQL nie sprawdzają działania HTTP, dwóch rzeczywistych klientów, planowania sesji, zapisu blobów ani usług mowy. Scenariusze R01–R07 przypisano do odpowiednich zadań implementacyjnych. To nie zastępuje testu migracji na docelowym serwerze PostgreSQL ani testu Graphile Worker; należą one do implementacji. Testy aplikacji, providerów i urządzeń opisane wyżej są przyszłymi pracami; nie zostały wykonane w ramach projektowania.

## Uzupełnienie: polityka wymowy per dziecko — 2026-10-09

Zaimplementowano plan `docs/superpowers/plans/2026-10-09-per-child-pronunciation-policy.md`: wersjonowane progi wymowy profilu dziecka, pasma i wizualne fragmenty słowa, adapter fonemów Azure, endpointy i widok ustawień rodzica oraz listę ostatnich ocen. `learning-v2` ma progi początkowe 70/50; wynik poniżej pasma „prawie” pozostaje nieoceniony. Zmiana progów dotyczy nowych sesji.

Weryfikacja tego zakresu: testy unit 200/200, integration 115/115, e2e 10/10, typecheck wszystkich sześciu projektów i produkcyjny build przeszły. Lokalny Compose deploy został zbudowany i uruchomiony; web i worker są healthy, a `/api/v1/health` zwraca `ok`. Read-only odczyt bazy po deployu zawierał `learning-v1`; `learning-v2` jest wstawiane idempotentnie przy pierwszym wejściu w ustawienia wymowy albo rozpoczęciu sesji i nie zostało jeszcze w tej instancji wywołane. Prawdziwe wyniki fonemów Azure z nagraniem dziecka i kalibracja progów na rodzinnych próbach pozostają niezweryfikowane.

## Uzupełnienie: ręczne tworzenie zestawu — 2026-10-09

Rodzic może utworzyć pusty szkic bez promptu i wywołania LLM, wpisać słówka
w istniejącym edytorze, zapisać sam tytuł pustego szkicu oraz opublikować
materiał dopiero po zapisaniu kompletnej karty i wymaganych mediów. Ponowienie
niepewnego POST używa tego samego UUID; błąd odświeżenia listy nie zamyka
edytora. Zmiana nie wymaga migracji ani zmiany Kid API.

Weryfikacja 2026-10-09: testy jednostkowe 232/232, integracyjne PostgreSQL
131/131, typecheck sześciu projektów i produkcyjny build przeszły. Nowe E2E
manualne 12/12, `parent-flow.spec.ts` 3/3 i pełny przebieg E2E 23/23 przeszły.
Pełne E2E uruchomiono w prywatnej konfiguracji Playwright z osobnym
kontenerem i portami, ponieważ równoległy worktree korzystał ze stałych
zasobów domyślnego runnera. W czasie pełnego przebiegu test „jeden profil”
usuwa własne syntetyczne profile pozostałe po wcześniejszych testach; test
pełnego przypisania czeka na potwierdzenie zapisu przed odczytem Kid API.
Zrzuty listy i edytora na 390×844, 768×1024 i 1440×900 obejrzano; nie ma
poziomego overflow.
### Uzupełnienie: edycja profilu dziecka (2026-10-09)

Kontrakt `updateChild(s: Services, childId: string, input: ChildPatch): Promise<ChildDto>` i PATCH profilu uzupełniają zadanie 1. Testy `auth-profiles.test.ts` obejmują częściową aktualizację, bezpieczeństwo, walidację i dwóch klientów. `history.test.ts` rozszerza R03: edycja zachowuje pełne rekordy historii, politykę, przypisania i dane drugiego dziecka, podczas gdy DELETE nadal usuwa historię przez CASCADE. Plan szczegółowy: `superpowers/plans/2026-10-09-child-profile-edit.md`.

### Uzupełnienie: przygotowanie do sprawdzianu i izolacja runnerów (2026-10-09)

Runner Vitest/Playwright przyjmuje walidowany `UMIEM_TEST_RUN_ID` oraz `UMIEM_E2E_PORT`, a kontener E2E, prefiks kontenerów integracyjnych i plik `.world` są rozdzielane dla danego przebiegu. Domena `test-preparation.ts` liczy lokalne okno od początku dnia sprawdzianu w IANA timezone, bez zakładania stałego offsetu ani 24-godzinnego dnia. Nowa sesja zapisuje datę z przypisania w prywatnym kontekście; scheduler korzysta z pieczętowanej historii ekspozycji, pozostawia należne sprawdzenia/wsparcie/poprawkę wyżej, wydaje pisemne Recall dla znanych słów i wstawia bezpieczne rozpoznawanie po dwóch kolejnych próbach przygotowawczych. Zadania generacji, POST Kid API, schemat bazy i DTO publiczne nie są zmieniane.

### Uzupełnienie: ochrona zmian rodzica i ponawianie generacji (2026-10-09)

Plan wykonania: `docs/superpowers/plans/2026-10-09-learning-and-parent-reliability.md`.
Edycja zachowuje bazową rewizję i lokalne poprawki przy konflikcie; wyjście
w stanie dirty wymaga decyzji rodzica. Generowanie po utracie odpowiedzi
ponawia ten sam payload i klucz, waliduje oba UUID odpowiedzi 202 oraz otwiera
otrzymany edytor niezależnie od odświeżenia listy. Nie dodano endpointu ani
trwałego stanu klienta. E2E sprawdzają utraconą odpowiedź i jedną operację
w PostgreSQL, uszkodzone potwierdzenia, błędy transportu/autoryzacji,
podwójne kliknięcie, refresh fail i nowy klucz dla kolejnej generacji.
Pełny odbiór 2026-10-09: unit 288/288, integration 139/139, E2E 54/54,
typecheck sześciu projektów i produkcyjny build przeszły. Testowa baza
potwierdziła jeden generation_run i jeden deck dla ponowionego klucza.

### Uzupełnienie: audyt i naprawa algorytmu nauki — 2026-10-09

Plan wykonania: `docs/superpowers/plans/2026-10-09-learning-algorithm-repair.md`;
wyjściowy audyt: `docs/audits/2026-10-09-learning-algorithm-audit.md`.
Zakres I01–I10 obejmuje izolację historii per dziecko i umiejętność, kwalifikację
audio, jedno ograniczone wsparcie z poprawką, zachowanie należnego późniejszego
Recall/pisowni, kierunki reading, bezpieczne opcje, deterministyczne fragmenty,
priorytet wiarygodnych mylonych par, pierwszeństwo należnych sprawdzeń przed
nowym materiałem oraz odbudowę skażonych projekcji.

Odbudowa `child_skill_progress` używa wspólnego czytnika historii i zapisu
projekcji w wersji `proj-2`; dry-run jest domyślny. Apply działa osobno dla
każdego profilu, odmawia przy sesji aktywnej lub próbie `processing` i nie
zmienia surowej historii, ekspozycji ani podsumowań. Instrukcja obsługi:
`docs/operations/progress-rebuild.md`.

Regresja `tests/integration/learning-algorithm.test.ts` prowadzi dwa profile
przez 12 miesięcy w maksymalnie 14 dniach symulowanych i sprawdza niezależne
Recall oraz pisownię dla każdego słowa. `tests/integration/progress-rebuild.test.ts`
sprawdza dry-run, izolację, brakujące i osierocone projekcje, idempotencję oraz
blokady apply. Pełny wynik bramek dla tej naprawy zapisuje końcowy raport pracy;
próby na danych rodzinnych, deploy i test wymowy z prawdziwym nagraniem nie są
częścią tej regresji.

### Uzupełnienie: UX nagrywania i wyniku mowy — 2026-10-10

Plan szczegółowy: `docs/superpowers/plans/2026-10-10-speech-recording-ux.md`;
specyfikacja projektu: `docs/superpowers/specs/2026-10-10-speech-recording-ux-design.md`.
Domyślny gest `hold` kończy nagranie po puszczeniu, z klawiaturą, anulowaniem,
limitem i profilem `toggle` konfigurowanym przez rodzica. Mikrofon i nagranie są zwalniane po
zatrzymaniu, anulowaniu, zmianie widoku i błędzie. UI pokazuje wiarygodne
„Usłyszałem: …”, osobną ocenę wymowy i maksymalnie sześć fragmentów, gdzie
`unknown` pozostaje neutralne. Odsłuch wzorca jest autoryzowany ponownie dla
bieżącej próby i zapisuje ekspozycję przed wydaniem zasobu.

Implementację podzielono na siedem commitowanych zadań w izolowanym worktree.
Istniejące regresje obejmują próbę idempotentną podczas `processing`,
konflikt dwóch klientów, usuwanie profilu, 15-sekundowy limit rejestratora,
zwalnianie śladów mediów oraz niezmienny budżet sesji. Końcowe pokrycie R01,
R03, R05 i R07 oraz kontrolę R04 odnotowuje dziennik
`docs/superpowers/progress/2026-10-10-speech-recording-ux-implementation.md`.
Testy automatyczne nie zastępują próby na rzeczywistym telefonie/tablecie ani
walidacji jakości na prawdziwej mowie dziecka; te dowody pozostają wymagane
 przed deklaracją gotowego MVP.

### Uzupełnienie: preferencja gestu nagrywania dla profilu dziecka — 2026-10-11

Rodzic wybiera `hold` („Przytrzymaj, aby mówić”) lub `toggle` („Naciśnij, aby rozpocząć i zatrzymać”) podczas edycji profilu. Wartość jest kolumną `child_profiles.recording_mode`, ograniczoną do tych dwóch trybów i domyślną jako `hold`; migracja 0005 uzupełnia nią istniejące profile. Parent PATCH aktualizuje tylko dostarczone pola, a Kid Profile DTO dostarcza preferencję do kontrolera. Kid UI nie pokazuje dziecku przełącznika i nie zapisuje trybu lokalnie; pozostałe preferencje urządzenia, np. odmowa mikrofonu, zachowują dotychczasową obsługę. Stary klucz `umiem.recordingMode` jest ignorowany. Specyfikacja i plan: `docs/superpowers/specs/2026-10-11-parent-recording-mode-setting-design.md` i `docs/superpowers/plans/2026-10-11-parent-recording-mode-setting.md`.
