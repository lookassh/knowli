# Implementacja: nagrywanie i wynik odpowiedzi ustnej — dziennik

Data: 2026-10-10. Worktree: `C:\Users\looka\.codex\worktrees\speech-recording-ux\knowli`. Gałąź: `feature/speech-recording-ux`.

## Zatwierdzenia i baza

- Właściciel zaakceptował zapisaną specyfikację i plan w rozmowie („Akceptuje”); wykonanie inline, bez delegowania.
- Plan: `docs/superpowers/plans/2026-10-10-speech-recording-ux.md`; specyfikacja: `docs/superpowers/specs/2026-10-10-speech-recording-ux-design.md`.
- BASE_SHA implementacji: `dd1e025092952977a43ba661e08d6efc41ded30b` (HEAD gałęzi dokumentacyjnej PR #36). PR #36 pozostaje otwarty i nie będzie scalany przez agenta.
- Stan początkowy worktree: czysty; izolacja w osobnym worktree, branch utworzony z commitu PR #36.
- [x] Zatwierdzenie dokumentów
- [x] Worktree/gałąź izolowana
- [x] Baseline testów i typecheck: `pnpm test:unit` 46 files / 394 tests PASS; `pnpm typecheck` PASS (zainstalowane zależności w izolowanym worktree).
- [x] Konflikty interfejsów preflight — sprawdzone z planem/specyfikacją; tabelka poniżej.
- [ ] Zadania 1–7 RED→GREEN i commity
- [ ] Niezależny review całości
- [ ] Końcowa weryfikacja, PR do main (właściciel scala przez squash)

## Dostosowanie narzędzi executing-plans

Zainstalowana wersja skill `6.4.2` udostępnia `sdd-workspace`, `task-brief` i `review-package`, ale nie ma skryptów `task-start` ani `task-done` wymaganych przez repozytoryjne AGENTS.md. Próba użycia `/bin/bash` przez systemowy Windows shim nie powiodła się (brak WSL); skrypty działają przez `C:\Program Files\Git\bin\bash.exe`. Dostosowanie równoważne: `task-brief` generuje briefy, ręczny wpis task-start do tego dziennika, każde polecenie testu uruchamiane i zapisywane jawnie, a task-done zastąpione ponownym końcowym uruchomieniem testu taska, odczytanym wynikiem i wpisem complete. `review-package` pozostaje wymagane.

## Preflight zależności interfejsów

| Producent → konsument | Interfejs / ustalenie |
|---|---|
| Task 1 → Task 2 | `PronunciationFragmentDto`/`SpeechFragment` dodają `unknown`; Task 2 używa fallbacku `unknown` i zachowuje podpis buildera. |
| Task 1 → Task 5 | Kid feedback DTO rozszerza się opcjonalnie o `speech` i `referenceAudioAvailable`; audio endpoint dostaje oddzielne `FeedbackAudioDto`, bez zmian tabel. |
| Task 3 → Task 4 | Fazy `idle/preparing/starting/recording/stopping`, `microphoneReady`, `inputLevel`, `recordingNotice`; recorder callbacki i metody prepare są źródłem sterowania wspólnego przycisku. |
| Task 3 → Task 6 | Kontroler dodaje zatrzymywanie odtwarzania i blokadę wyścigów; karta korzysta z aktualnego feedbacku/attemptId oraz API feedback audio w Task 5. |
| Task 4 → Task 6 | `SpeechRecordButton` i preferencja trybu wspólne dla ekranów; karta działa inline w LearnScreen i odczytuje tryb próby po modality. |
| Task 5 → Task 6 | `FeedbackDto.referenceAudioAvailable` jest tylko wskazówką UI; endpoint zawsze ponownie autoryzuje i wydaje `FeedbackAudioDto`. |
| Task 6 → Task 7 | Karta opisuje wynik i działania; testy E2E oraz dokumentacja końcowa/regresje należą do Task 7. |

Ruling: brak konfliktów kontraktów na podstawie planu/specyfikacji; wyżej wymienione typy dają się składać zgodnie z kolejnością zadań. Koszt błędnego założenia ograniczony do korekty interfejsu w zadaniu konsumenta i ponowienia jego RED→GREEN.

## Postęp zadań

- Task 1: brief utworzony przez `task-brief`; rozpoczynam test RED.
- Task 2: nie rozpoczęty.
- Task 3: nie rozpoczęty.
- Task 4: nie rozpoczęty.
- Task 5: nie rozpoczęty.
- Task 6: nie rozpoczęty.
- Task 7: nie rozpoczęty.


### Task 1 — jawny wynik mowy i zgodność historii: complete

- RED potwierdzony: nowy kontrakt, normalizacja, statusy w domenie i ekspozycje zawiodły przed implementacją (brak modułu/schema/statusów/helpera).
- Implementacja: statusy rozpoznania i wymowy, pusta transkrypcja jako no_speech, helper normalizacji i deduplikowanych ekspozycji z locale rewizji; wyeksportowany typ fragmentu z neutralnym verdict unknown.
- Testy: pnpm test:unit packages/contracts/src/speech-feedback.test.ts packages/server/src/domain/spoken-answer.test.ts packages/server/src/modules/speech.test.ts packages/server/src/domain/feedback.test.ts → 4 files, 33 tests PASS; pnpm test:integration tests/integration/speech.test.ts tests/integration/attempts.test.ts → 2 files, 33 tests PASS; pnpm typecheck PASS; git diff --check PASS.
- Pierwszy przebieg integracji ujawnił brak importu deckVersions, a potem nieaktualną asercję starego DTO; oba rozwiązano, ponownie potwierdzając zielony zestaw. Nie pozostawiono odstępstw.
- Commit: 6c62c64ea011b839c9b3177c441584096a596457.
- Task 1: complete (commits dd1e025..6c62c64ea011b839c9b3177c441584096a596457; tests: unit + integration + typecheck → PASS)
### Task 2 — uczciwe oznaczanie fragmentów: complete

- RED potwierdzony dla optymistycznego fallbacku, brakujących lub nieprawidłowych score'ów, ErrorType, zachowania liter i limitu fragmentów.
- Implementacja: neutralny unknown przy braku pewnej lokalizacji lub score'u, bez dowolnego dopasowania samogłoski; tylko zgodne fonemy i obsługiwane ErrorType kolorują zakresy. Oryginalna kapitalizacja, apostrof i łącznik pozostają zachowane; ponad sześć fragmentów wraca do neutralnego słowa. Mispronunciation i None zachowują wiarygodne lokalne oznaczenia.
- Test końcowy `pnpm test:unit packages/server/src/domain/pronunciation-fragments.test.ts packages/server/src/modules/speech.test.ts packages/server/src/domain/feedback.test.ts` → 3 files, 39 tests PASS; `pnpm typecheck` PASS; `git diff --check` PASS. Kontrola synthetic cherry/grape/apple/Thursday oraz zachowanych wariantów.
- Odstępstwa: brak.
- Commit: c87b499190f5d218163b8ed698879f58383e4df3.
- Task 2: complete (commits 6c62c64..c87b499190f5d218163b8ed698879f58383e4df3; tests: unit + typecheck → PASS)
