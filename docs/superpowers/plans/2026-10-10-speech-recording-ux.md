# Nagrywanie i wynik odpowiedzi ustnej — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Dziecko nagrywa jednym gestem i rozumie, co zostało rozpoznane, co poćwiczyć oraz kiedy problem leży po stronie analizy.

**Architecture:** Zachować domenę ocen i sesji; dodać jawne statusy mowy w feedbacku, ostrożne mapowanie fragmentów i autoryzowany odsłuch wzorca dla bieżącej karty wyniku. Przenośny kontroler zarządza cyklem mikrofonu, a adapter przeglądarkowy strumieniem i RMS; wspólny komponent obsługuje gest, klawiaturę i alternatywę kliknięciem.

**Tech Stack:** Obecne TypeScript/React, Zod, Drizzle/PostgreSQL, Vitest, Playwright i Web Audio API; bez nowych zależności produktu.

**Spec:** [2026-10-10-speech-recording-ux-design.md](../specs/2026-10-10-speech-recording-ux-design.md).

**Status:** Właściciel zaakceptował specyfikację i plan; implementacja jest wykonywana inline na `feature/speech-recording-ux`. PR #36 z dokumentacją pozostaje otwarty. Po wykonaniu planu wymagany jest niezależny review całości.

## Global Constraints

- Zakres `speech` i ustny `recall` w treningu; `mock_test` nadal bez odpowiedzi audio. UI `pl-PL`, Umiem!, treść i wymowa `en-GB`; wszystkie etykiety w `packages/contracts/src/messages.ts`.
- Domyślnie `hold`; alternatywa `toggle`, preferencja urządzenia `umiem.recordingMode`. Minimum 48×48 px; Space/Enter i reduced motion.
- Granica przypadkowego dotknięcia 300 ms faktycznego nagrywania; limit 15 000 ms. RMS `clamp(rms * 4, 0, 1)`, najwyżej 10 publikacji/s; wskaźnik nie wykrywa słowa ani nie ocenia wiedzy.
- Zachować STT confidence gate, NFC/trim/limit 200 znaków i zatwierdzone warianty. `below` pozostaje nieocenione; brak danych nigdy nie jest `good`. Nowy pusty STT nie jest błędną odpowiedzią.
- Kid DTO bez score, confidence, IPA, kryteriów/klucza. Fragmenty `good | almost | unknown`, maks. 6, oryginalny tekst bez utraty znaków; bez deklaracji rozpoznawania sylab.
- Żadnego audio dziecka na dysku/DB/kolejce/logach/trace/fixture. Poziom dźwięku tylko w pamięci; wszystkie tracki, AudioContext i timery zwalniane. Fake-providerzy i syntetyczne dane w testach.
- Ujawnienie i każdy replay zapisane przed HTTP, wspólna blokada sesji, kwalifikacja przy received_at, historia niezmienna. Bez zmiany progów, schedulera i budżetu.
- Dodatkowe pola feedbacku opcjonalne dla historii; legacy render bez zgadywania przyczyny. Brak migracji DB. Kid UI bez serwera/Next.js/SDK providerów.

## Review Focus

1. Puszczenie/anulowanie przed zwrotem getUserMedia: spóźnione tracki zamknięte, brak wysłania — zadania 3–4.
2. Limit, key-repeat, normalne lostpointercapture, drugi palec i blur: jeden wynik lub jedno anulowanie — zadania 3–4.
3. Brak score'u, niejednoznaczne fonemy, inny wariant i tekst ze znakami: bez fałszywego zielonego lub lokalizacji — zadania 1–2.
4. Feedback audio po terminalnej odpowiedzi vs next/end/dwie przeglądarki: właściwy cel i zamknięta ekspozycja przed odtworzeniem — zadania 5–6.
5. Niepewne STT vs cisza vs awaria, legacy/null feedback i partial zamykający speech: uczciwy tekst, właściwe akcje i bez regresji postępu — zadania 1, 6–7.

## Setup i dziennik wykonania

- [x] Właściciel zaakceptował zapisaną specyfikację i plan („Akceptuje”). Tryb inline, bez delegowania.
- [ ] Przeczytać aktualne `AGENTS.md`, dokumenty bazowe SPEC/architecture/schema/folder-structure/implementation-plan, specyfikację tego zadania i ten plan; sprawdzić Git oraz odpowiednie scripts. Baza przygotowania dokumentów `b7f5f09c2144b1a484e2b58cd713513d0a63da83` nie zastępuje bazy rzeczywistej implementacji.
- [ ] Uruchomić `using-git-worktrees` i **`executing-plans` przed pierwszą zmianą implementacyjną**. Sprawdzić istniejącą izolację/artefakty; nie tworzyć kolejnego worktree bez potrzeby. Nie realizować planu na main.
- [x] Założono `docs/superpowers/progress/2026-10-10-speech-recording-ux-implementation.md` z BASE_SHA i checklistą. Wersja skill nie zawiera task-start/task-done; dostosowanie przez `task-brief`, testy uruchamiane jawnie i dziennik opisano w progress.
- [ ] Jeżeli brak zależności: `pnpm install --frozen-lockfile`. Baseline `pnpm test:unit` i `pnpm typecheck`; istniejące błędy odróżnić od nowych. Docker/PostgreSQL i `tests/test-run-config.ts` dla integracji/E2E; nie kierować testów na bazę rodzinną.

## Task 1: jawny wynik mowy i zgodność historii

**Files:** Modify `packages/contracts/src/kid.ts`, `packages/contracts/src/messages.ts`, `packages/server/src/domain/types.ts`, `packages/server/src/domain/feedback.ts`, `packages/server/src/modules/speech.ts`, `packages/server/src/modules/attempts.ts`. Create `packages/contracts/src/speech-feedback.test.ts`, `packages/server/src/domain/spoken-answer.ts`, `packages/server/src/domain/spoken-answer.test.ts`. Extend `packages/server/src/domain/feedback.test.ts`, `packages/server/src/modules/speech.test.ts`, `tests/integration/speech.test.ts`, `tests/integration/attempts.test.ts`.

**Interfaces:** Produces `SpeechFeedbackDtoSchema`/`SpeechFeedbackDto`, statusy zgodnie z §2 specyfikacji, opcjonalne `FeedbackDto.speech`, `Grade.speechFeedback: { recognition, pronunciation, referenceText?: string }`; zachowuje `assessSpeechEvidence(evidence, key, ctx): Grade` i `chooseFeedback(grade, correctText): FeedbackChoice`. `FeedbackChoice` otrzymuje te same opcjonalne dane publiczne. `PronunciationFragmentDtoSchema` i `SpeechFragment` rozszerzone o `unknown`; wyeksportować `PronunciationFragmentDto = z.infer<typeof PronunciationFragmentDtoSchema>`.

**Ekspozycje:** `normalizeSpokenAnswerText(answer: string): string` w `domain/spoken-answer.ts` wydziela bez zmiany semantyki istniejący NFC/trim/usunięcie brzegowej interpunkcji/symboli z matchSpokenAnswer. `feedbackExposureKeys(feedback: FeedbackDto, canonicalTargetKey: string, targetLocale: string): string[]` w `domain/feedback.ts` zachowuje dotychczasowy cel oraz dodaje deduplikowane klucze faktycznie ujawnionego referenceText i heardText; warianty mają własne targetKey. `discloseFeedback` i wszystkie jego ścieżki submit/read/retry używają tego samego helpera, z locale przypiętej wersji, przed HTTP.

- [ ] RED: kontrakt akceptuje legacy `{kind:"great"}` i nowe statusy; odrzuca nieznane statusy/werdykty oraz ujawniony tekst/fragments dla `uncertain | no_speech | unavailable`. `heardText` max 200. Sprawdzić payload DTO na brak technicznych pól.
- [ ] RED tabeli §2: `no_speech`, `ok + text:null`, tekst `"  "`, failed/deadline, niepewna rozbieżność, wiarygodny inny wyraz, correct/partial/below, awaria wymowy, brak pasm i wariant inny niż oceniony. Dla recall+failed pronunciation nadal correct Recall, dla below nadal unevaluated. `referenceText` wskazuje rzeczywisty dopasowany wariant lub rozwiązanie przy different. Null STT nie daje transkrypcji/wzorca/fragments/confusion ani incorrect.
- [ ] RED unit helpera ekspozycji: canonical+reference wariantu+heardText, deduplikacja, brzegowa interpunkcja i brak ukrytych niepewnych tekstów. RED PostgreSQL `variant_feedback_exposes_target_in_other_deck`: sofa/couch, pokazany couch chroni należny samodzielny Recall couch w drugim zestawie; submit/read/retry tworzą zamknięte ekspozycje przed zwrotem. Analogicznie wiarygodny heardText innego wyrazu. Wcześniejsza ocena/kontekst są niezmienne.
- [ ] Uruchomić `pnpm test:unit packages/contracts/src/speech-feedback.test.ts packages/server/src/domain/spoken-answer.test.ts packages/server/src/modules/speech.test.ts packages/server/src/domain/feedback.test.ts` oraz `pnpm test:integration tests/integration/speech.test.ts tests/integration/attempts.test.ts`; zapisać oczekiwany RED na nowych asercjach.
- [ ] Implementować statusy z pełnego `SpeechEvidence`, przed utratą przyczyny; pusty/null STT jako no_speech i nieoceniony. Zachować outcome, kwalifikację, confidence gate i zamknięcie zadań. Dodać dokładne polskie komunikaty z tabeli specyfikacji. Kontrakt Zod waliduje kombinacje statusów/tekstu; nie rekonstruować brakującej przyczyny z legacy. Wydzielić normalizację i helper pełnych ekspozycji oraz zastosować je w discloseFeedback także przy ponownym wydaniu starego payloadu, bez przepisywania historii.
- [ ] GREEN powyższych unit/integration; `submit_and_read_preserve_speech_statuses`: submit/poll/read/retry zwracają ten sam utrwalony wynik; cisza/niepewność nie tworzą confusion, usunięcie profilu usuwa transkrypcje. W razie nowych zmian przy integracji utrwalić oddzielny RED→GREEN.
- [ ] Commit `feat: explain speech recognition and pronunciation outcomes`; zapisać SHA, dowody i odstępstwa.

## Task 2: uczciwe oznaczanie fragmentów

**Files:** Modify `packages/server/src/domain/pronunciation-fragments.ts`, `packages/server/src/domain/pronunciation-fragments.test.ts`, `packages/server/src/modules/speech.ts`, `packages/server/src/modules/speech.test.ts`.

**Interfaces:** Consumes werdykt `unknown` z zadania 1. Zachowuje `buildPronunciationFragments(target, word, bands, overallBand): PronunciationFragment[]`; fallback `[{text: target, verdict:"unknown"}]`. `letterGroups(word): string[]` pozostaje helperem; rekonstruowany tekst musi być oryginalny.

- [ ] RED: lokalny null/NaN/Infinity nie jest good; brak words, Omission/Insertion/nieznany ErrorType, niezgodny tekst, brak fonemów, niejednoznaczna samogłoska oraz niezużyty fonem → neutralny fallback. **partial + Mispronunciation + kompletne mapowalne fonemy** nadal daje lokalny almost obok good; null/None także dopuszczalne. Poprawnie dopasowane różne score'y → good/almost/unknown; połączenie tekstów dokładnie równe target, także `Monday`, apostrof i łącznik. >6 segmentów po scaleniu → cały wyraz unknown.
- [ ] Uruchomić `pnpm test:unit packages/server/src/domain/pronunciation-fragments.test.ts packages/server/src/modules/speech.test.ts`, zachować oczekiwany RED.
- [ ] Usunąć optymistyczne score'y i niejednoznaczne dopasowania; scalać tylko jednakowe werdykty. Dopuścić null/None/Mispronunciation, pozostałe ErrorType neutralnie. Generować lokalne oznaczenia tylko przy ocenionym zgodnym wariancie i band correct/partial. Gdy lokalizacja niepewna, zachować ogólny wynik bez udawania precyzji. Nie budować nowego algorytmu sylabizacji.
- [ ] GREEN tych samych testów plus `pnpm test:unit packages/server/src/domain/feedback.test.ts`. Kontrola syntetycznych przykładów cherry/grape/apple/Thursday i alternatywnego zaakceptowanego wariantu, bez deklarowania walidacji na głosie dziecka.
- [ ] Commit `fix: keep uncertain pronunciation fragments neutral`; dowody do dziennika.

## Task 3: bezpieczny cykl mikrofonu i wskaźnik dźwięku

**Files:** Modify `packages/kid-ui/src/media/platform.ts`, `packages/kid-ui/src/media/browser.ts`, `packages/kid-ui/src/media/browser.test.ts`, `packages/kid-ui/src/session/session-controller.ts`, `packages/kid-ui/src/session/session-controller.test.ts`, `packages/kid-ui/src/session/useLearningSession.ts`. Update fake `PlatformMedia`/`SpeechRecorder` znalezione przez `rg` w repo.

**Interfaces:** Produces `RecorderOptions { onLevel?: (level:number)=>void; onLimitReached?:()=>void }`, `PlatformMedia.prepareMicrophone(): Promise<void>`, `createRecorder(options?: RecorderOptions): SpeechRecorder`. Kontroler: `prepareMicrophone(): Promise<void>`, zachowane start/stop/cancel, dodatkowe `LearningScreen.microphoneReady: boolean`, `recordingPhase: "idle" | "preparing" | "starting" | "recording" | "stopping"`, `inputLevel: number | null`, `recordingNotice: string | null`. `recording` pozostaje zgodnym pochodnym phase; `processing` oznacza transport/ocenę.

- [ ] RED fake clock/deferred getUserMedia: prepare nie zaczyna MediaRecorder, zwalnia tracki; cancel/puszczenie/teardown przed startem zamyka spóźniony strumień. Drugi start podczas starting nic nie robi. Zwolnienie po 299 ms nie wysyła, po 300 ms może wysłać. Callback limitu po 15 000 ms i równoczesny stop wysyłają raz. Po odejściu od taska nie ma callbacków UI.
- [ ] RED: RMS skończony 0–1 i ≤10 publikacji/s; brak Web Audio nie blokuje, wszystkie stop/cancel/error zamykają resources. Odmowa mikrofonu zachowuje ścieżkę tekstową; awaria urządzenia nie jest trwałą odmową. Hidden/blur/offline anuluje; wzorzec zatrzymany przed startem, start podczas trwającej/spóźnionej autoryzacji blokuje odtwarzanie.
- [ ] RED adaptera player: opóźniony fetch i osobno blob, następnie stop/start mikrofonu/next/end → audio.play nigdy nie jest wywołane. Nowy play unieważnia stary. Stop rozpoczętego audio rozwiązuje oczekującą Promise neutralnie i zwalnia object URL; późny callback starej generacji nie psuje nowej. Cancel nie pokazuje błędu odtwarzania w kontrolerze.
- [ ] RED kontrolera listening: stop przed zakończeniem fetch/blob neutralnie kończy play, ale nie wywołuje `recordObservation(audio_played)`. Nowy play nie dziedziczy callbacku starego; prawidłowy nieanulowany odsłuch nadal zapisuje opcjonalną obserwację. Ekspozycja przed wydaniem wzorca pozostaje niezależna od ACK.
- [ ] Uruchomić `pnpm test:unit packages/kid-ui/src/media/browser.test.ts packages/kid-ui/src/session/session-controller.test.ts`; zapisać RED.
- [ ] Implementować generację zamiaru nagrania niezależną od epoch zadania. Przypisać recorder przed await start; cancel unieważnia generację. Ustawić stopping/busy przed await stop. Opóźnione callbacks sprawdzają task/epoch/generację. BrowserAudioPlayer: generacja i AbortController dla fetch, ponowna kontrola po fetch/blob, cleanup URL i neutralne domknięcie Promise na stop. Kontroler: wspólny prywatny `#stopPlayback(): void` zwiększa generację i wywołuje player.stop; każdy nowy play ma swoją generację, sprawdzaną po await także przed audio_played. Zastąpić bezpośrednie wywołania stop w kontrolerze tym helperem. W adapterze RMS bez zapisu próbek, monotoniczny czas i zamknięcie Web Audio; hook anuluje na hidden/blur/offline. Rozróżnić anulowanie od ponowienia transportowego rozpoczętej już próby.
- [ ] GREEN wybranych unit oraz `pnpm typecheck` po aktualizacji fake-adapterów. Kontrola, że retry transportu zachowuje clientAttemptId, a nowy gest po zakończonej próbie otrzymuje nowy; bufory dostępne tylko w pamięci, po zakończeniu/rezygnacji zwolnione.
- [ ] Commit `feat: manage microphone lifecycle and input level safely`; dowody do dziennika.

## Task 4: wspólne sterowanie przez przytrzymanie

**Files:** Create `packages/kid-ui/src/exercises/SpeechRecordButton.tsx`, `packages/kid-ui/src/exercises/recording-gesture.ts`, `packages/kid-ui/src/exercises/recording-gesture.test.ts`. Modify `packages/kid-ui/src/exercises/types.ts`, `SpeechView.tsx`, `WrittenView.tsx`, `packages/kid-ui/src/screens/LearnScreen.tsx`, `packages/kid-ui/src/storage.ts`, `packages/kid-ui/src/styles.css`, `packages/contracts/src/messages.ts`, `packages/kid-ui/src/session/session-controller.ts`, `packages/kid-ui/src/session/session-controller.test.ts`. Create `tests/e2e/speech-recording-ux.spec.ts`.

**Interfaces:** Produces `RecordingMode = "hold" | "toggle"`, `RECORDING_MODE_KEY = "umiem.recordingMode"`, `SpeechRecordButton(props: {phase, ready, disabled, level, mode, onModeChange, onPrepare, onStart, onStop, onCancel})`. Callbacki bez parametrów, `onModeChange(mode: RecordingMode)`. Pure `reduceRecordingGesture(state: GestureState, event: GestureEvent): {state:GestureState; action:"none"|"start"|"stop"|"cancel"}`; stan przechowuje właściciela gestu (pointerId albo key), a event obejmuje start/release/cancel/settled. Faza kontrolera rozstrzyga, czy release wysyła audio.

Kontroler publikuje `LearningScreen.recordingMode: RecordingMode` i `setRecordingMode(mode: RecordingMode): void`; odczytuje/pisze preferencję przez istniejące `LocalPreferences`, nie bezpośredni localStorage. Brak/nieznana wartość → hold. Zmiana podczas dowolnej aktywnej fazy albo processing jest ignorowana także poza UI. Ekran przekazuje te wartości i callback do wspólnego komponentu.

- [ ] RED reducer: niegłówny pointer ignorowany, jeden pointer/key jest właścicielem, key-repeat/synthetic click nie duplikują, drugi palec nie kończy, release daje jeden stop, unexpected capture loss/escape daje cancel, normalny capture loss po release no-op. Toggle start/stop działa także po aktywacji z klawiatury. Wyłączyć trace (`test.use({ trace: "off" })`), HAR/video oraz dumpy payloadów w nowym pliku i istniejących testach nagrywania z kid-flow; syntetyczne audio tworzone tylko w pamięci.
- [ ] RED preferencji w session-controller.test.ts: nowy kontroler zachowuje toggle, nieznana wartość daje hold, zmiana podczas aktywnej fazy jest ignorowana. `pnpm test:unit packages/kid-ui/src/exercises/recording-gesture.test.ts packages/kid-ui/src/session/session-controller.test.ts` — potwierdzić RED obu zestawów. E2E RED dla dotyku/myszy/Space/Enter, release poza przyciskiem i odmowy uprawnienia; użyć fake strumienia, nie nagrania dziecka.
- [ ] Implementować jeden współdzielony komponent obu ćwiczeń z pointer capture, `touch-action` ograniczonym do przycisku, prawidłowym preventDefault dla gestu i ochroną click. Nie zastępować elementu DOM podczas trzymania. Ustawić instrukcje §1, wskaźnik oraz jawny przełącznik toggle; minimum 48×48 px i reduced motion. Start/stop/cancel zawsze przez kontroler zadania 3.
- [ ] GREEN obu plików unit z kroku RED, `pnpm test:e2e tests/e2e/speech-recording-ux.spec.ts`; oba viewporty ze specyfikacji, tab/fokus, normalne przewijanie poza przyciskiem, brak menu długiego dotyku, przełącznik niedostępny podczas nagrywania. Brak zgody nie blokuje sesji bez mikrofonu.
- [ ] Commit `feat: record speech with hold and accessible toggle controls`; zapisać dowody.

## Task 5: odsłuch wzorca dla bieżącej karty wyniku

**Files:** Create `packages/server/src/modules/feedback-audio.ts`, `tests/integration/feedback-audio.test.ts`. Modify `packages/contracts/src/kid.ts`, `packages/server/src/modules/attempts.ts`, `packages/server/src/modules/events.ts`, `packages/server/src/index.ts`, `apps/web/src/kid/kid-router.ts`, `packages/kid-ui/src/api/KidApi.ts`, `packages/kid-ui/src/api/client.ts`, `packages/kid-ui/src/session/session-controller.ts`, `packages/kid-ui/src/session/session-controller.test.ts`.

**Interfaces:** Produces `FeedbackAudioDtoSchema`/type `{attemptId,taskId,stepId,audioAssetId}`, optional `FeedbackDto.referenceAudioAvailable`, `authorizeFeedbackAudio(services: Services, attemptId: string): Promise<FeedbackAudioDto>` i POST `/api/v1/kid/attempts/:attemptId/feedback-audio`. `KidApi.authorizeFeedbackAudio(attemptId: string): Promise<FeedbackAudioDto>`. Kontroler `playFeedbackAudio(): Promise<void>` i `LearningScreen.feedback.attemptId: string` zachowane przy submit/poll/read.

- [ ] RED PostgreSQL: zakończona próba speech w issued i answered może odsłuchać swój dostępny wzorzec; każdy replay pieczętuje ekspozycję przed odpowiedzią. Recall po odsłuchu nie zalicza kolejnej odpowiedzi jako samodzielnej przed 300 s. Stare oceny i otrzymany kontekst nie zmieniają się.
- [ ] RED odmowy: brak gotowego audio, inny wariant niż wzorzec, niepewne STT, processing, mock_test, ended session, nowsza próba lub późniejszy task. Replay vs next/end/dwie przeglądarki — tylko jedna prawidłowa kolejność pod wspólną blokadą; żadnego ujawnienia obcego celu. `referenceAudioAvailable` nie omija walidacji.
- [ ] `pnpm test:integration tests/integration/feedback-audio.test.ts` — RED na nowych wymaganiach. Kontroler unit RED: autoryzacja przed player.play, brak odtwarzania po zmianie karty/start nagrania, błąd odtwarzania zachowuje feedback.
- [ ] Implementować osobny moduł i cienką trasę. Reużyć/podzielić minimalnie helper zapisu ekspozycji/reservations z events; nie rozluźniać normalnego authorizeDisclosure. Dostępność obliczać przy nowej finalizacji z przypiętej rewizji; nie mutować legacy. Klient używa baseUrl i publicznego DTO. Zachować blokadę sesji; po await sprawdzić bieżący attempt/task.
- [ ] GREEN integracyjny plik, `pnpm test:integration tests/integration/speech.test.ts tests/integration/attempts.test.ts`; unit kontrolera i `pnpm typecheck`. Sprawdzić read/retry bez ponownej płatnej analizy i usunięcie profilu bez pozostawionego feedbacku/transkrypcji.
- [ ] Commit `feat: authorize reference audio from current speech feedback`; dowody do dziennika.

## Task 6: czytelna karta wyniku i następny krok

**Files:** Create `packages/kid-ui/src/screens/SpeechFeedbackCard.tsx`, `packages/kid-ui/src/screens/speech-feedback-view.ts`, `packages/kid-ui/src/screens/speech-feedback-view.test.ts`. Modify `packages/kid-ui/src/screens/LearnScreen.tsx`, `packages/kid-ui/src/session/session-controller.ts`, `packages/kid-ui/src/styles.css`, `packages/contracts/src/messages.ts`, `tests/e2e/speech-recording-ux.spec.ts`.

**Interfaces:** `describeSpeechFeedback(dto: FeedbackDto | null): {heardText?:string; message:string; referenceText?:string; fragments: readonly PronunciationFragmentDto[]; tone:"correct"|"practice"|"neutral"}` wybiera z katalogu treść na podstawie jawnych statusów, z fallbackiem legacy/null. `SpeechFeedbackCard` consumes nullable DTO, retry/busy, callbacks `onPlay`, `onRetry`, `onSkip`, `onNext`; kontroler zapisuje `LearningScreen.feedback.modality: AttemptDto["modality"]` obok attemptId, aby rozpoznać legacy/null feedback audio. onRetry wraca do idle, nie zaczyna nagrania; onSkip korzysta z istniejącej operacji pominięcia tylko gdy retry=true.

- [ ] RED unit tabeli §2 i legacy/null: właściwy tekst/tone, brak przyczyny zmyślonej, brak pochwały dla different/partial, brak sugestii lokalizacji bez almost. Null → ogólny feedbackNotAssessed, neutralny tone, brak heardText/referenceText/fragments. Neutralne unknown nie znaczy błąd. Poprawny Recall i awaria wymowy pokazują oba wyniki.
- [ ] `pnpm test:unit packages/kid-ui/src/screens/speech-feedback-view.test.ts`; zapisać RED. E2E RED: karta w przepływie dla audio, duży heardText, legenda i brak modalu; pozostałe zadania bez regresji. Terminalny partial speech ma Dalej, bez nowego nagrania. issued ma Nagraj jeszcze raz/Pomiń. unavailable bez transkrypcji nie pokazuje wzorca.
- [ ] Implementować kartę zgodnie z §4. Fokus na tytule i scroll, bez automatycznego startu mikrofonu. Odsłuch wyłącznie gdy referenceAudioAvailable=true. Dodać styl neutralny/bursztynowy/podkreślenie i dostępny tekst fragmentów; niewyłącznie kolor. Wyjście z karty, task change i end zatrzymują odtwarzanie. Nie rozszerzać serwerowego budżetu ani retry.
- [ ] GREEN unit; E2E nowego pliku oraz `pnpm test:e2e tests/e2e/kid-flow.spec.ts tests/e2e/mock-test.spec.ts`; brak poziomego overflow 390×844/768×1024, karta i działania widoczne przy długim heardText, keyboard/screen reader focus, offline nie tworzy lokalnego sukcesu.
- [ ] Commit `feat: show actionable speech feedback beside the task`; dowody do dziennika.

## Task 7: regresje, dokumentacja, urządzenie i review całości

**Files:** Modify `docs/SPEC.md` (§6, §12.5–12.6, §14–16, §23), `docs/architecture.md` (§11–12, ujawnienia), `docs/folder-structure.md`, `docs/implementation-plan.md`; update dziennik implementacyjny. Extend odpowiednie istniejące tests privacy/learning-algorithm oraz nowy E2E.

- [ ] Dodać brakujące regresje z Review Focus, potwierdzając RED przed odpowiadającą zmianą: reload/retry tej samej próby, dwie przeglądarki, usunięcie profilu, limit 15 s, brak tracków po błędzie, niepowiększony banner „Jeszcze N”. Nie zapisywać audio ani transkrypcji do artefaktów diagnostycznych.
- [ ] Zaktualizować kontrakty w dokumentach, neutralne fragmenty i mapę nowych plików. Zapisać rzeczywiste pokrycie R01/R03/R05/R07 i kontrolę R04 według §5 specyfikacji; R02/R06 pozostają istniejącymi regresjami niezmiennych mediów. Bez twierdzenia o regresjach nieuruchomionych.
- [ ] Wykonać `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm build`, `git diff --check`. Zapisać aktualne wyniki, liczby i środowisko. Pełny zestaw tylko na izolowanych fake-providerach/bazie testowej.
- [ ] Rzeczywisty telefon/tablet: zgoda, opóźnienie startu, puszczenie poza polem, tło/blur, sygnał audio, stopped indicator, limit, kliknięcia, czytelność i wzorcowe audio. Bez docelowego urządzenia zapisać brak dowodu; nie wysyłać głosu dziecka do usług bez osobnej zgody. Nie deklarować walidacji jakości wymowy na podstawie syntetycznych testów.
- [ ] `requesting-code-review`: jeden niezależny dedykowany recenzent **całego BASE_SHA..HEAD i niezacommitowanego diffu**, z tym projektem/planem, Review Focus, dowodami i dziennikiem. Jawnie wybrać najmocniejszy dostępny model z wykluczeniem GPT Astra; w obecnym katalogu `gpt-6.1-sol`, effort `xhigh`. Recenzent read-only, bez dalszej delegacji.
- [ ] `receiving-code-review`: zweryfikować uwagi, naprawić Critical/Important, RED→GREEN dla zmian zachowania. Odrzucone uwagi uzasadnić dowodem, Minor odłożone opisać. Ponowny review poprawek według tej samej reguły modelu, jeśli potrzebny.
- [ ] `verification-before-completion`: powtórzyć sprawdzenia dotknięte poprawkami; potwierdzić wszystkie kryteria odbioru i stan Git. Commit dokumentacji/review; stage tylko ścieżki tego zadania.
- [ ] `finishing-a-development-branch`: push gałęzi roboczej do origin i PR do main, z opisem końcowego rezultatu, niezależnego review, weryfikacji i brakujących dowodów. Dołączyć PR do wątku. **Scala właściciel przez Squash and merge**; bez samodzielnego merge/push do main. Zachować worktree na czas review PR.

## Zakończenie planu

Gotowość oznacza potwierdzenie kryteriów specyfikacji i niezależnego review całego zakresu, nie samo ukończenie ostatniego zadania. Raport oddziela testy automatyczne, test urządzenia i jakość rzeczywistego rozpoznawania/wymowy. Przy wznowieniu wrócić do pierwszego niezakończonego checkboxa w dzienniku i aktualnego Git; nie powtarzać już zamkniętych zadań.
