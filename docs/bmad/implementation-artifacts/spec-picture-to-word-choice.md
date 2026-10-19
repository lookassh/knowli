---
title: 'Obrazek → wybór słowa (picture word choice)'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_commit: '2a35693f2ed0fe7e69cfdd83aade5d12ef80052a'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Dziecko nieczytające (`canRead=false`, zestawy picture) ma dziś tylko ćwiczenia bez pisanej formy angielskiego słowa (prezentacja obrazkowa, `picture_listening`, `picture_recall`, `picture_speech`). Brak ćwiczenia uczącego skojarzenia obrazka z pisanym wyrazem — rozpoznawania słowa „jak obrazka".

**Approach:** Nowy typ `picture_recognition`: prompt = wizualizacja znaczenia (`MeaningVisual`: obraz/kolor/liczba), odpowiedź = wybór 1 z maks. 4 angielskich słów, po mechanice zadań wyboru (`reading`). Dystraktory z współdzielonego mechanizmu z ochroną celów zarezerwowanych dla samodzielnych sprawdzeń.

## Boundaries & Constraints

**Always:**

- Opcje: ≥2 różne, maks. 4, unikalne teksty, jeden poprawny, tasowanie; pula za mała → mniej opcji lub inny typ, nigdy wymuszona losowa odpowiedź (SPEC §13).
- Cel zarezerwowany (należne sprawdzenie recall/spelling) nigdy nie jest opcją ani dystraktorem.
- Ekspozycje (`prompt_issued`, klucze wszystkich pokazanych słów łącznie z dystraktorami) zapisane i zamknięte przed wysłaniem treści (architektura §9.2).
- Standardowa maszyna stanów: pomyłka → druga próba, druga pomyłka → wsparcie; „Nie pamiętam" = trudność; feedback zgodny z wynikiem (§9.1a).
- Wizualy tylko istniejące i zatwierdzone z przygotowania materiału; brak jednoznacznego wizualu → typ pomijany (fallback), nigdy blokada sesji.
- Nowy kind dostają tylko klienci z nową flagą zdolności zadeklarowaną przy starcie sesji (wzorzec `supportsPictureVocabulary`, architektura §20).
- Kid DTO bez klucza odpowiedzi i technicznych score'ów; polski interfejs; klawiatura 1–4 i ↑/↓ przez `useChoiceKeyboard`; reset stanu przez `key={taskId}`.
- Pod obrazkiem widoczny mały polski podpis (np. „koń") — polska nazwa przedmiotu jest częścią promptu; nie ujawnia angielskiej odpowiedzi, więc nie zmienia kwalifikacji próby.
- Odsłuch poprawnego słowa tylko w feedbackzie: `FeedbackDto` dla tego typu może nieść `audioAssetId` poprawnej opcji, ujawniane wraz ze zdarzeniem `audio_issued` dopiero przy zwrocie oceny; kid-ui pokazuje głośniczek przy podświetlonej poprawnej opcji.

## Decisions (2026-10-19, właściciel)

1. **Grupa docelowa: wyłącznie dzieci nieczytające** (`canRead=false`, zestawy picture) — rozszerzenie SPEC §34; czytający nie dostają tego typu.
2. **Umiejętność: `reading`** — poprawna odpowiedź zalicza rozpoznawanie tekstu; zapis kierunku pojęcie→słowo w details analogicznie do architektura §9.3; gwiazdki §6 bez zmian (dla nieczytających liczą listening/recall).
3. **Podpis PL pod obrazkiem: tak** — mały, widoczny podpis z polskim słowem źródłowym (np. „koń"), wzmacnia skojarzenie PL↔EN; prompt DTO przenosi `source`.
4. **Audio słowa: tylko w feedbacku** — po przyjęciu próby feedback udostępnia odsłuch poprawnego słowa (głośniczek przy podświetlonej opcji, z `audioAssetId` ujawnianym serwerowo dopiero w feedbackzie); przed odpowiedzią żadne audio, więc próba pozostaje czystym rozpoznawaniem wzrokowym.

**Never:**

- Brak audio docelowego słowa przed odpowiedzią (wyciek odpowiedzi, SPEC A07; ćwiczenie pozostaje wzrokowe). Wyjątek: odsłuch w feedbackzie po przyjęciu próby.
- Bez nowej umiejętności, tabel i migracji (`session_tasks.exercise_type` jest tekstowa).
- Bez zmian API/MCP/learning-overview; wpływ na MCP uzasadnić w PR (AGENTS.md).
- Poza zakresem: mock-testy, moduł lekcji, TTS/STT, generowanie obrazków w sesji.

## I/O & Edge-Case Matrix

| Scenariusz | Wejście / stan | Oczekiwane zachowanie | Błędy |
|---|---|---|---|
| Poprawny wybór | Obrazek + 4 opcje; wybór poprawnego słowa | „Świetnie!", ocena umiejętności, w feedbackzie głośniczek przy poprawnym słowie, dalej | N/A |
| Pomyłka | Wybór dystraktora | Feedback klasy „Prawie!…", podświetlenie czerwone/zielone, odsłuch poprawnego słowa dostępny, druga próba | Druga pomyłka → wsparcie |
| Mała pula | <3 bezpiecznych kandydatów | 2–3 opcje | Niewystarczająca → inny typ zadania |
| Brak wizualu | Item bez jednoznacznego obrazka | Typ pomijany w planowaniu | Sesja trwa innymi typami |
| Stary klient | Start bez nowej flagi zdolności | Brak `picture_recognition` w sesji | N/A — graceful |
| Klawiatura | 1–4, ↑/↓, focus | Jak w `reading` | Zdarzenia z inputów ignorowane |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/kid.ts` -- `TaskPromptSchema` (union po `kind`), `ChoiceOptionSchema`, `MeaningVisualSchema`; tu nowy wariant.
- `packages/contracts/src/messages.ts` -- `stepType` + komunikaty PL.
- `packages/server/src/domain/types.ts` -- `ExerciseType`; `evaluate.ts` -- `skillsForExercise` (mapowanie na umiejętność); `vocabulary-capabilities.ts` -- dostępność per dziecko + flaga klienta.
- `packages/server/src/domain/scheduler.ts` -- `selectTask`, `recognitionTaskPlan` (gałąź `picture_listening` jako wzorzec), `reservedTargetKeys`.
- `packages/server/src/domain/recognition-options.ts` -- `buildRecognitionOptions`: opcje tekstowe, pary mylące, ochrona rezerwacji — użyć bez zmiany semantyki.
- `packages/server/src/modules/sessions.ts` -- `materializeTask`, `nextTask` (snapshot + `prompt_issued`), `issuedTaskDto`; wzorzec kompatybilności: `task-prompt-compat.ts`.
- `packages/kid-ui/src/exercises/` -- `ExerciseView.tsx` (dyspozytor, `never`-guard), `ReadingView.tsx` (siatka opcji + klawiatura), `PictureRecallView.tsx` + `visuals/MeaningVisualView.tsx` (prompt obrazkowy), `ExerciseFrame`/`exercise-presentation`/`option-outcome`/`useChoiceKeyboard` (współdzielone).
- `packages/kid-ui/src/session/session-controller.ts` -- `answerChoice` → `POST /api/v1/kid/tasks/{id}/attempts` — bez zmian.
- Wzorce testowe: `scheduler-picture-reader.test.ts`, `tests/integration/picture-vocabulary.test.ts`, `tests/e2e/picture-vocabulary.spec.ts`, `contracts/src/kid-picture.test.ts`.

## Tasks & Acceptance

**Execution:**

- [x] `packages/contracts/src/kid.ts` + `kid-picture.test.ts` -- wariant `picture_recognition { visual, source, options: ChoiceOption[2..4] }` (`source` = polskie słowo podpisu) oraz opcjonalne `FeedbackDto.correctAudioAssetId`; testy Zod.
- [x] `packages/server/src/domain/{types,evaluate,vocabulary-capabilities}.ts` -- nowy `ExerciseType` oceniany jako `reading`; dostępność wyłącznie dla `canRead=false` w zestawach picture, po nowej fladze klienta.
- [x] `packages/server/src/domain/scheduler.ts` -- plan typu: eligibility (jednoznaczny `visual`, pula), `buildRecognitionOptions`, rezerwacje, `revealsTargetKeys`.
- [x] `packages/server/src/modules/sessions.ts` -- `materializeTask` (tasowanie, `AnswerKey.correctOptionId`, `source` w prompcie), `nextTask` (snapshot + ekspozycje przed zwrotą DTO), feedback z `correctAudioAssetId` poprawnej opcji i ujawnieniem `audio_issued`.
- [x] `packages/kid-ui/src/exercises/PictureRecognitionView.tsx` (nowy) + `ExerciseView.tsx` + `exercise-presentation.ts` + `styles.css` -- `ExerciseFrame` + `MeaningVisualView` z małym podpisem `source` + siatka opcji z `useChoiceKeyboard` i `option-outcome`; w feedbackzie głośniczek odtwarzający poprawne słowo.
- [x] `packages/contracts/src/messages.ts` -- instrukcja PL („Które słowo pasuje do obrazka?") + etykieta `stepType` i aria głośniczka.
- [x] Testy: `scheduler-picture-recognition.test.ts` (eligibility, ≥2 opcje, rezerwacje, fallback) + integracja sesji (ekspozycje przed wysłaniem, próba choice, audio ujawniane dopiero w feedbackzie) -- pokryć matrycę I/O.
- [x] `tests/e2e/picture-recognition.spec.ts` -- poprawna i błędna odpowiedź w UI dziecka + przycisk odsłuchu w feedbackzie.
- [x] `docs/SPEC.md` + `docs/architecture.md` -- udokumentować typ (§ćwiczenia/§34, §9.3/§20).

**Acceptance Criteria:**

- Given item z `visual` i wystarczającą pulą, when serwer planuje zadanie dla uprawnionego dziecka, then `picture_recognition` ma 2–4 unikalne opcje i jeden klucz poprawny.
- Given cel zarezerwowany dla należnego sprawdzenia, when budowane opcje, then cel nie występuje wśród nich.
- Given zadanie wysłane klientowi, then ekspozycje wszystkich ujawnionych słów są zamknięte w tej samej transakcji.
- Given sesja bez nowej flagi klienta, then `picture_recognition` nie zostaje wydane.
- Given wybór dystraktora, then czerwone podświetlenie i druga próba bez zaliczenia sukcesu.
- Given item bez wizualu, then typ pominięty, sesja trwa dalej.

## Implementation Notes

- 2026-10-19: Flaga klienta `supportsPictureRecognition` (SessionInput, domyślnie false, snapshot w kontekście sesji); kid-ui deklaruje ją przy starcie sesji. `getVocabularyCapabilities` dopina `picture_recognition` wyłącznie dla `canRead=false` + `vocabularyFormat=picture` + flaga; `reading` świadomie NIE wchodzi do `skills` nieczytającego (gwiazdki §6 bez zmian), wyniki reading żyją w historii i raporcie.
- 2026-10-19: Planowanie wpięte w `recognitionTaskPlan`/`recognitionPlan`/`picturePracticePlan` przez wspólny `buildRecognitionOptions` w kierunku `source_to_target` (pary mylące + ochrona rezerwacji bez zmian semantyki); `recognitionPossibleWithoutReservations` uznaje typ za ścieżkę dowodu; `practiceMix` miksuje go ze słuchowym (pierwsze pytanie świeżego słowa pozostaje słuchowe). Należne powtórki reading dla nieczytającego nie są planowane (reading poza `skills`); gałąź `source_to_target` w due-review zostawiona jako zabezpieczenie przyszłych rozszerzeń.
- 2026-10-19: `correctAudioAssetId` trafia do feedbacku tylko przy próbie ocenionej (gotowe, zatwierdzone TTS `target_audio`); ujawnienie pieczętowane zdarzeniem `audio_issued` z ekspozycją celu w tej samej transakcji, przed HTTP. `task-assistance`/`projection-evidence` traktują odsłuch przed odpowiedzią jak w pozostałych typach tekstowych — ponowna próba po feedbacku jest świadomie nie-niezależna (integracja to asertuje).
- 2026-10-19: Wiersz matrycy „druga pomyłka → wsparcie" nie ma dedykowanego testu dla tego typu — pokrywa go współdzielona, typowo-agnostyczna maszyna stanów prób wyboru (`CHOICE_EXERCISES`), którą ćwiczą istniejące suite'y listening/reading (zielone w pełnym przebiegu). Pozostałe wiersze matrycy mają dedykowane testy (scheduler/integracja/e2e).
- 2026-10-19: Weryfikacja: vitest (kid-picture + scheduler-picture-recognition) 14/14 zielono — re-run niezależny w sesji głównej; typecheck bez błędów — re-run; pełny `test:unit` 1329 testów zielono, `test:integration` picture-vocabulary 10/10, e2e picture-recognition 3/3 oraz wcześniejszy pełny e2e (200) zielono wg raportu implementacyjnego. MCP/learning-overview bez zmian (Kid API only) — uzasadnienie trafia do PR.
- 2026-10-19 (patch po review): 5 poprawek u subagenta implementacyjnego: (1) `hasDueRecognition` bramkuje `isDue(reading)` membreshipem `reading ∈ capabilities.skills` (due reading nieczytającego przestało tłumić recognition-fallback); (2) peery o wizualu identycznym z celem (eksport `visualKey`) odfiltrowani z opcji — zduplikowany wizual nie oferuje dwóch poprawnych słów; (3) `correctAudioAssetId` z deterministycznym `orderBy(desc(createdAt), desc(id))`; (4) podpis `lang="pl-PL"`; (5) testy regresyjne: task-assistance/projection-evidence (odsłuch przed odpowiedzią → assisted), scheduler (peery bez wizuali → plan, nie fallback; due-reading nie blokuje fallbacku; duplikat wizuala nigdy w opcjach), integracja (seria kolejnych picture_recognition per element ≤ 2 — świadome odstępstwo od literalnego „zero przyległych": formuła miksów legalnie dopuszcza dokładnie dwie, zepsuty licznik dałby serię bez ograniczeń), confusion-priority (łańcuch par mylących), capabilities (mikrofon+picture+flaga współistnieje z recall/speech).
- 2026-10-19: Re-weryfikacja po patchu (niezależna, sesja główna): unit 30/30 (6 plików), typecheck czysto, integracja 10/10, e2e 3/3. Diff po patchu: 34 pliki, +1157/−35.

## Spec Change Log

## Review Triage Log

Review 1 (2026-10-19; warstwy: blind-hunter 16, edge-case-hunter 2, verification-gap 4):

- BH1 `materializeTask` asercja `listeningVisual!` — **false**: kandydat dostaje `visual = listeningVisual ?? meaningVisual` (sessions.ts:820), a scheduler odrzuca brak wizualu; jedna z dwóch wartości zawsze istnieje, kolejność `??` w materialize obejmuje ten sam zbiór.
- BH2 dystraktory o identycznym wizualu co cel (dwie pozycje tego samego koloru/liczby/obrazka) — **medium**: walidator picture (picture-vocabulary.ts) sprawdza tylko kształt wizuala, nie unikalność między itemami; `buildRecognitionOptions` deduplikuje odpowiedzi, nie wizuale — oba słowa pasują do obrazka, a jedno zostaje zaliczone jako pomyłka; picture_listening ma ochronę `visualKey`, ten typ nie.
- BH3 brak `ORDER BY` w zapytaniu `correctAudioAssetId` — **low**: przy kilku zatwierdzonych `target_audio` wybór niedeterministyczny; fix bezpośredni (deterministyczne sortowanie).
- BH4 numeracja `stepId` `d${prior.length+1}` — **low→reject**: identyczny, przyjęty wzorzec w events.ts:268–272; kolizja wymagałaby zmiany zbioru rodzajów ujawnień, nie wykazana.
- BH5 kontrakt `correctAudioAssetId` dostępny dla każdego ocenionego kindu — **low→reject**: emitter wyłącznie serwerowy (attempts.ts), reguła `not_assessed` pokrywa wyciek; luz kontraktu spójny z resztą FeedbackDto.
- BH6 brak testu capabilities z mikrofonem (picture+flaga+recall/speech) — **low**: realna luka testowa, fix trywialny (przypadek w suite capabilities) — do patcha razem z lukami V-G.
- BH7 brak testu ścieżki bez TTS (brak głośniczka) — **low→reject**: zachowanie to łagodna degradacja (feedback bez dźwięku), skutek nie szkodzi dziecku; fixture bez audio wymaga dedykowanego setupu ponad prostą korektę.
- BH8 `supportsPictureRecognition: true` także dla mock_test — **false**: warstwa V-G potwierdziła, że nieczytający są wykluczeni z mock_test, a capabilities i tak bramkują format+canRead; flaga nie ma tam skutku.
- BH9 fallback z pierwszego pytania słuchowego na tekstowe przy niewykonalnym builderze — **low→reject**: matryca I/O wprost dopuszcza „inny typ zadania" przy niewystarczającej puli; brak wykazanej szkody pedagogicznej.
- BH10 fixture e2e bez `correctAudioAssetId` w drugiej próbie — **low→reject**: wierność fixture, prawda serwera pokryta integracją; kosmetyka.
- BH11 schemat nie wymusza unikalności tekstów opcji — **low→reject**: spójne z istniejącymi schematami wyboru (listening/reading); gwarancja w builderze serwerowym od zawsze.
- BH12 etykieta „Słowo do obrazka" rzekomo odwrotna — **low→reject**: czytane „słowo (pasujące) do obrazka", paralela do „Wybór obrazka"; kosmetyka właścicielska, do ewentualnej zmiany decyzją właściciela.
- BH13 brak artefaktu weryfikacji MCP — **false**: grep integrations/umiem-mcp nie znajduje konsumpcji TaskPrompt/FeedbackDto/SessionInput (pakiet eksponuje learning-overview); obowiązkowa nota trafia do opisu PR.
- BH14 zimny start par mylących (seed z reverse_recognition) — **low→defer**: pomysł na ulepszenie, nie wada; stan pusty jest zamierzony przy nowym typie.
- BH15a podpis bez `lang="pl-PL"` — **low**: realne ulepszenie a11y (czytniki czytają „koń" angielską fonetyką), fix jednoargumentowy — do patcha.
- BH15b głośniczek poza mapą 1–4/strzałek — **low→reject**: zwykły przycisk, osiągalny Tabem; e2e klika go myszą, istnienie pokryte.
- EC1 scheduler.ts:483 `hasDueRecognition` bez bramki capabilities — **medium**: po tej zmianie nieczytający mają postęp reading (oceny zapisane), `isDue(reading)` zaczyna tłumić `recognitionFallback`; należne powtórki reading dla nieczytającego nigdy nie są planowane (reading poza `skills`), więc tłumienie tylko traci zadania — do patcha (bramka `reading ∈ skills`).
- EC2 endpoint ujawnień zwraca `reveal.target` dla hintu — **low→reject**: audio dla tego typu nie jest zwracane (tylko picture_recall dostaje asset); hint to mechanism wsparcia całej rodziny wyboru (identycznie reverse_recognition), oznacza próbę wspieraną i zwalnia rezerwacje; kid-ui nie wystawia hintu w zadaniach wyboru.
- VG1 brak testu `task-assistance`/`projection-evidence` dla picture_recognition (odsłuch przed odpowiedzią → assisted) — **medium** (pre-verified): reguła istnieje, ale żadna asercja jej nie zabezpiecza przed regresją — patch: przypadek jednostkowy.
- VG2 nowa ścieżka `recognitionPossibleWithoutReservations` (cel ma wizual, peery nie) bez testu — **medium** (pre-verified): jedyny stan, w którym dysjunkcja zmienia wynik — patch: przypadek schedulera.
- VG3 licznik `practiceMix` dla picture_recognition w statystykach sesji niezweryfikowany — **medium** (pre-verified): usunięcie warunku zapada miks w ciągłe pytania tekstowe bez czerwonego testu — patch: asercja integracyjna per element.
- VG4 łańcuch par mylących (confusion-priority, learning-snapshot, preferredRevisionIds) bez testu — **medium** (pre-verified): wpis §9.3 „źródło par mylących" niechroniony — patch: przypadek jednostkowy (+ opcjonalnie mirror schedulera).

## Design Notes

Składanie sprawdzonych elementów: prompt obrazkowy z `picture_recall` + siatka opcji z `reading` + `buildRecognitionOptions` (te same reguły dystraktorów i rezerwacji). Złoty przykład: obrazek konia z podpisem „koń" + `[horse, house, mouse, door]` → `horse`. Audio nie występuje w prompcie (A07); wzmocnienie dźwiękowe następuje w feedbackzie — serwer ujawnia `correctAudioAssetId` dopiero wraz z oceną, więc decyzja „co i kiedy dziecko słyszy" pozostaje po stronie serwera, a próba pozostaje czystym rozpoznawaniem wzrokowym.

## Verification

**Commands:**

- `pnpm vitest run packages/contracts/src/kid-picture.test.ts packages/server/src/domain/scheduler-picture-recognition.test.ts` -- zielono, w tym nowe przypadki eligibility i rezerwacji.
- `pnpm vitest run tests/integration/picture-vocabulary.test.ts` -- zielono z nowym typem w integracji sesji.
- `pnpm typecheck` -- brak błędów (`never`-guard wymusza kompletność gałęzi).
- `pnpm test:e2e -- tests/e2e/picture-recognition.spec.ts` -- zielono lokalnie (stack compose).

**Manual checks (if no CLI):**

- UI dziecka: obrazek duży i wycentrowany, opcje o dużej czcionce, klawiatura 1–4 działa, focus nie gubi się po feedbacku.
