# Stan obecny w kodzie

Miejsca potwierdzone przeglądem z 2026-11-10 (ścieżki względem `packages/`). Numery linii z gałęzi `main` na `82835e07`.

| CAP | Gdzie | Co jest dziś |
| --- | --- | --- |
| CAP-1 | `tests/probes/fixtures/school-grader-golden-set.json`, `scripts/evaluate-school-grader.mts:175-244` | 27 przypadków pisanych; precyzja liczona, ale poza bramką |
| CAP-2 | `server/src/providers/openai-compatible/grader.ts:98-153` | Prompt i dane bez znacznika mowy; zawsze „Oczekiwana forma odpowiedzi” |
| CAP-2 | `server/src/modules/learning/lessons/lesson-attempts.ts:842-851` | Kod już rozróżnia `speech` niepoprawioną i pomija dla niej liczenie zdań |
| CAP-3 | `server/src/domain/lessons/evaluate.ts:441-465` | Fragment niedosłowny, limit 4, duplikat lub nachodzenie kategorii zwraca `null` |
| CAP-3 | `server/src/modules/learning/lessons/lesson-attempts.ts:771`, `:1451` | `null` daje `not_assessed`, zadanie zostaje `issued`, brak wpisu w cache |
| CAP-4 | `kid-ui/src/exercises/useRetryReset.ts`, `kid-ui/src/exercises/lesson/LessonSentenceView.tsx:39` | Każde ponowienie czyści pole; hook nie zna powodu ponowienia |
| CAP-5 | `server/src/domain/lessons/precision-trainer.ts:43-49` | Oferta także przy samym `formOk === false` |
| CAP-5 | `server/src/modules/learning/lessons/lesson-shorten.ts:156-158` | Gdy segmentów nie da się zbudować, cały tekst idzie jako `plain` |
| CAP-6 | `server/src/modules/learning/lessons/lesson-shorten.ts:74-96`, `contracts/src/messages.ts:822` | Wynik `incorrect` z podpowiedzią „Porównaj z poprzednią odpowiedzią”, bez treści |
| CAP-7 | `kid-ui/src/exercises/SpeechRecordButton.tsx:91-99`, `contracts/src/messages.ts:655-665`, `:826` | Teksty ćwiczenia słówek; `dictationRecord` nieużyte |
| CAP-8 | `kid-ui/src/exercises/lesson/useDictation.ts:23` | `setText(dictation.text)` zastępuje pole |
| CAP-8 | `server/src/modules/learning/lessons/lesson-attempts.ts:953-957` | „Poprawiono” rozstrzyga odcisk ostatniej transkrypcji (`dictatedFingerprint`) |
| CAP-9 | `kid-ui/src/session/useLearningSession.ts:53-61`, `session-controller.ts:2292` | `cancelRecording()` bez komunikatu |
| CAP-10 | `kid-ui/src/session/session-controller.ts:1340`, `kid-ui/src/screens/LearnScreen.tsx:352` | `busy`/`transitioning` ustawiane; jedyny tekst to „Sprawdzam nagranie…” |

Uwaga do CAP-8: dopisywanie zmienia tekst względem odcisku ostatniej transkrypcji, więc odpowiedź z dwóch dyktowań serwer uzna dziś za poprawioną ręcznie i zastosuje liczenie zdań. AC-28 wymaga rozstrzygnięcia tego w planie story.

Zachowania, których nie wolno zepsuć: transkrypt widoczny i poprawialny przed „Sprawdź”; pisanie bez mikrofonu jako pełna ścieżka; nagranie tylko w pamięci, zerowane w `finally`; próba skracania zawsze wspomagana i neutralna dla serii; brak oferty skracania w ostatnich trzech zadaniach sesji.
