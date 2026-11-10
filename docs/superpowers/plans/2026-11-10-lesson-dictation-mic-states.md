# Mikrofon i stany dyktowania odpowiedzi — plan (story 5)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development albo superpowers:executing-plans. Kroki mają pola wyboru (`- [ ]`).

**Cel:** przy dyktowaniu odpowiedzi przycisk mikrofonu mówi o odpowiedzi i o tym, jak skończyć (CAP-7), przerwane nagranie zostawia krótki komunikat (CAP-9), a tekst oczekiwania po „Sprawdź” nie mówi o nagraniu (CAP-10).

**Spec:** `_bmad-output/specs/spec-dyktowana-odpowiedz-sciezka-dziecka/` — story 5 w `stories.yaml`, wiersze AC-23–25, AC-29, AC-30. Przed kodem: `docs/agents/kid-ui.md`, `docs/agents/testing.md`.

**Moduły i granice:** wyłącznie `packages/kid-ui` i katalog komunikatów w `packages/contracts/src/messages.ts`. Serwer, Kid DTO, API, MCP i `SKILL.md` bez zmian. Nagranie nadal tylko w pamięci; przerwanie woła istniejące `recorder.cancel()`.

## Decyzje

1. **Teksty dyktowania w `SpeechRecordButton`.** Nowy opcjonalny prop `dictation?: boolean` (domyślnie `false` = teksty ćwiczenia słówek bez zmian, AC-25). Ustawiają go `LessonSentenceView` i `LessonShortenView` (oba już używają `mode="toggle"`). Przy `dictation`:

   | Stan | Etykieta przycisku | Linia statusu |
   | --- | --- | --- |
   | mikrofon niegotowy, bezczynny | „Włącz mikrofon” (jak dziś) | `dictationPermission`: „Dotknij, aby włączyć mikrofon.” |
   | przygotowanie (zgoda) | „Powiedz odpowiedź” | `dictationPrepare`: „Włącz mikrofon, a potem powiedz odpowiedź.” |
   | start | „Włączam mikrofon…” (jak dziś) | „Włączam mikrofon…” |
   | nagrywanie | `dictationStop`: „Dotknij, gdy skończysz” | „Słucham — mów teraz” (albo odliczanie) |
   | kończenie / rozpoznawanie | „Powiedz odpowiedź” | jak dziś („Zapisuję twoją odpowiedź…”) |
   | gotowy, bezczynny | `dictationRecord`: „Powiedz odpowiedź” (AC-23) | brak albo komunikat kontrolera |

   Żaden z tekstów nie zawiera „Nagraj”, „przytrzymaj” ani „słowo” (AC-24). Znacznik „Nagrywam…” pod przyciskiem zostaje.
2. **Przerwane nagranie (CAP-9).** Nowa metoda kontrolera `interruptRecording()`: gdy bieżące zadanie to dyktowanie (`#dictationLimitMs(screen) !== null`) i faza to `starting` albo `recording`, woła `cancelRecording(messages.kid.dictationInterrupted)`; w każdym innym przypadku `cancelRecording()` jak dziś. `useLearningSession` woła ją zamiast `cancelRecording()` w obsłudze `visibilitychange` (ukrycie), `blur` i `offline`. Tekst: „Nagranie przerwane. Powiedz jeszcze raz.” Stan `dictation` (licznik `failures`) nie jest ruszany; `technicalRecordingIssue` zostaje `false`. Ćwiczenia słówek zachowują się jak dotąd.
3. **Tekst oczekiwania (CAP-10).** `LearnScreen`: dla zadań `lesson_open_answer` i `lesson_shorten` komunikat `kid-processing` to nowy `processingAnswer`: „Sprawdzam odpowiedź…”; dla pozostałych zadań „Sprawdzam nagranie…” bez zmian (AC-30). Te dwa rodzaje nigdy nie wysyłają próby audio — dyktowanie kończy się tekstem w polu.
4. **Layout.** Zmieniają się tylko teksty w istniejących elementach; najdłuższa nowa etykieta przycisku („Dotknij, gdy skończysz”) dostaje asercję geometrii w istniejącym `tests/e2e/lesson-dictation-layout.spec.ts` (przycisk w oknie, ≥ 48 px, bez przepełnienia) na telefonie i tablecie.

## Zadanie 1: teksty przycisku (AC-23, AC-24, AC-25)

**Pliki:** `packages/contracts/src/messages.ts`, `packages/kid-ui/src/exercises/SpeechRecordButton.tsx` (+ `SpeechRecordButton.test.tsx`), `LessonSentenceView.tsx`, `LessonShortenView.tsx`, `packages/kid-ui/src/exercises/lesson/dictation-views.test.tsx`.

- [ ] Testy (czerwone) w `SpeechRecordButton.test.tsx`: z `dictation` i `mode="toggle"` — dla każdej fazy z tabeli tekst przycisku i statusu równy oczekiwanemu oraz niezawierający `/nagraj|przytrzymaj|słowo/i`; bez `dictation` — tablica dotychczasowych tekstów (`record`, `recordHold`, `recordingPrepare`, `recordingPermission`) bez zmian. W `dictation-views.test.tsx`: oba widoki renderują przycisk z etykietą „Powiedz odpowiedź”.
- [ ] Implementacja: trzy nowe klucze w `messages.kid` (`dictationStop`, `dictationPrepare`, `dictationPermission`), gałąź `dictation` w wyliczeniu `status` i `label`, prop w obu widokach.
- [ ] `corepack pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/exercises`. Commit.

## Zadanie 2: komunikat po przerwanym nagraniu (AC-29)

**Pliki:** `packages/kid-ui/src/session/session-controller.ts` (+ `session-controller.test.ts`), `packages/kid-ui/src/session/useLearningSession.ts`.

- [ ] Testy (czerwone) w `session-controller.test.ts`, wzorem istniejących testów dyktowania: zadanie odpowiedzi otwartej z `speechInput`, nagranie w toku → `interruptRecording()` → `recordingPhase: "idle"`, `recordingNotice` = „Nagranie przerwane. Powiedz jeszcze raz.”, `technicalRecordingIssue: false`, fake rejestratora dostał `cancel()`, `dictation` (w tym `failures`) bez zmian, API `dictate` niewołane. Drugi test: to samo przy ćwiczeniu słówek → `recordingNotice: null`. Trzeci: bez trwającego nagrania `interruptRecording()` nie nadpisuje istniejącego komunikatu dyktowania.
- [ ] Implementacja:

```ts
/** Utrata fokusu, ukrycie karty albo brak sieci: przerwane dyktowanie zostawia komunikat, nie jest nieudaną próbą. */
interruptRecording(): void {
  const screen = this.#learning();
  if (!screen || this.#recorder === null) return;
  const recording = screen.recordingPhase === "starting" || screen.recordingPhase === "recording";
  this.cancelRecording(recording && this.#dictationLimitMs(screen) !== null ? messages.kid.dictationInterrupted : null);
}
```

(warunek „bez rejestratora nic nie rób” do potwierdzenia z dzisiejszym zachowaniem `cancelRecording()` wołanego bez nagrania — nie może zmienić czyszczenia komunikatów w ćwiczeniach słówek) oraz trzy podmiany w `useLearningSession.ts`.
- [ ] Test kontrolera zielony. Commit.

## Zadanie 3: tekst oczekiwania (AC-30)

**Pliki:** `packages/contracts/src/messages.ts`, `packages/kid-ui/src/screens/LearnScreen.tsx`, test ekranu (istniejący plik testów `LearnScreen` albo spec E2E `lesson-kid.spec.ts`, w którym próba wraca w stanie `processing`).

- [ ] Test (czerwony): odpowiedź otwarta w stanie `processing` → `kid-processing` ma „Sprawdzam odpowiedź…”; ćwiczenie słówek w stanie `processing` → „Sprawdzam nagranie…”.
- [ ] Implementacja: `messages.kid.processingAnswer` i wybór tekstu po `task.prompt.kind`.
- [ ] Commit.

## Zadanie 4: geometria, dokumentacja, całość

- [ ] `tests/e2e/lesson-dictation-layout.spec.ts`: w stanie nagrywania przycisk ma etykietę „Dotknij, gdy skończysz”, mieści się w oknie 390×844 i 768×1024, ≥ 48 px; zaktualizować asercje tekstów, które się zmieniły.
- [ ] `docs/architecture.md` (sekcja dyktowania): teksty przycisku dla dyktowania i komunikat przerwania. `stories.yaml`: story 5 zrealizowane datą, czeka na odbiór.
- [ ] `pnpm check`, pełne `pnpm test:e2e:shards`.
- [ ] Trzech krytyków gałęzi, `/ponytail:ponytail-review`, PR. `done_checkpoint: true`: po PR zatrzymać się; odbiór na tablecie dopiero po decyzji właściciela z Open Questions w `SPEC.md`.

## Wiersz AC → test

| AC | Test |
| --- | --- |
| AC-23 | `SpeechRecordButton.test.tsx` (gotowy, bezczynny), `dictation-views.test.tsx` |
| AC-24 | `SpeechRecordButton.test.tsx` (wszystkie fazy bez „przytrzymaj”/„słowo”; nagrywanie pokazuje „Dotknij, gdy skończysz”) |
| AC-25 | `SpeechRecordButton.test.tsx` (teksty bez `dictation` bez zmian), istniejące testy ćwiczeń mowy |
| AC-29 | `session-controller.test.ts` (trzy testy z zadania 2) |
| AC-30 | test ekranu z zadania 3 |

## Poza zakresem

Dopisywanie przy kolejnym dyktowaniu (wycofane CAP-8); kalibracja rozpoznawania mowy; odbiór na urządzeniu; komunikat przerwania w ćwiczeniach słówek.

## Poprawki po przeglądzie trzech krytyków (2026-11-10) — mają pierwszeństwo przed treścią wyżej

1. **Faza kończenia.** Kontroler przy zatrzymaniu dyktowania od razu ustawia komunikat „Zapisuję twoją odpowiedź…” (znika stare odliczanie); przycisk w trybie dyktowania mapuje `stopping` na ten sam tekst statusu, a znacznik „Nagrywam…” jest w tej fazie ukryty.
2. **Bez `dictationPermission`.** Przy niegotowym mikrofonie etykieta „Włącz mikrofon” wystarcza; linia statusu jest pusta.
3. **`interruptRecording()` bez wczesnego wyjścia.** Zawsze woła `cancelRecording(...)` jak dziś (ćwiczenia słówek bez zmian, sonda auto-nagrania nadal przerywana). Komunikat „Nagranie przerwane. Powiedz jeszcze raz.” tylko gdy zadanie jest dyktowaniem, rejestrator istnieje i faza nie jest `starting` (zgoda na mikrofon sama potrafi wywołać `blur`); drugi z pary zdarzeń (ukrycie + blur) nie kasuje już ustawionego komunikatu.
4. **Komunikat przeżywa ponowne wczytanie zadania.** `#loadNext` zachowuje `dictationInterrupted`, gdy wraca to samo zadanie (powrót z tła woła `refreshStep()`, powrót sieci — `retry()`; oba dotąd zerowały komunikat). Testy: przerwanie → `refreshStep()`, przerwanie → `markOffline()` → `retry()`, dwa przerwania z rzędu, licznik `failures` po wcześniejszym nieudanym dyktowaniu bez zmian.
5. **Testy E2E** w `lesson-dictation-layout.spec.ts`: zdarzenie `blur` w trakcie nagrania → tekst statusu, zwolnione ścieżki mikrofonu (`__microphoneTrackStops`), zero wywołań dyktowania; etykieta „Dotknij, gdy skończysz” w geometrii. AC-30: asercja tekstu w `kid-layout-stability.spec.ts` (ćwiczenie słówek) i wariant odpowiedzi otwartej.
6. `dictation-views.test.tsx:50` (dziś przypina „Nagraj”) do odwrócenia. `docs/SPEC.md` — jedno zdanie o przerwanym nagraniu.
7. Poza zakresem, do odnotowania w PR: inne pisane typy lekcji (poprawa zdania, przekształcenie) nadal pokazują „Sprawdzam nagranie…”.
