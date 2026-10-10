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

Zainstalowana wersja skill `6.4.2` udostępnia `sdd-workspace`, skrypty `task-start`, `task-done` i `review-package`; oddzielnego skryptu `task-brief` nie ma. Briefy powstają przez `task-start`. Próba użycia `/bin/bash` przez systemowy Windows shim nie powiodła się (brak WSL); skrypty działają przez `C:\Program Files\Git\bin\bash.exe`. Przy `task-done` Git Bash nie miał `pnpm` w PATH, więc podano pełną ścieżkę do `pnpm.cmd` z runtime. `review-package` pozostaje wymagane.

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

- Task 1: complete.
- Task 2: complete.
- Task 3: complete.
- Task 4: complete.
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

### Task 3 — bezpieczny cykl mikrofonu i wskaźnik dźwięku: complete

- RED potwierdzony dla spóźnionego getUserMedia, przygotowania mikrofonu, poziomu RMS, końca limitu, anulowanego fetch/blob i potwierdzenia odsłuchu po przerwaniu. Dodatkowy test kontrolera ujawnił, że ACK dla przerwanego odsłuchu listening musi być tłumiony.
- Implementacja: nowy port `prepareMicrophone` i callbacki rejestratora; tor RMS Web Audio z limitem 10 Hz; limit 15 s; zamykanie strumieni i analizatora; kontrola generacji po spóźnionym getUserMedia; odtwarzacz z abortem i neutralnym domknięciem Promise; kontroler z fazami nagrania, progiem 300 ms, serializacją stopu, blokowaniem przestarzałych callbacków i bez ACK po przerwaniu; blur/hidden/offline anuluje nagranie.
- Test końcowy `pnpm test:unit packages/kid-ui/src/media/browser.test.ts packages/kid-ui/src/session/session-controller.test.ts` → 2 files, 47 tests PASS; `pnpm typecheck` PASS; `git diff --check` PASS. Po testach przywrócono wyłącznie niezamierzoną zmianę lockfile wygenerowaną przez pnpm.
- W trakcie weryfikacji nowy test najpierw zawiódł, bo fake player rozwiązywał gate przy początkowym stopie sprzątającym przed rozpoczęciem odtwarzania; po poprawie fake'a aktywny przypadek przerwania odtwarzania przechodzi i nie wysyła `audio_played`.
- Odstępstwa: brak; rzeczywisty telefon/tablet i zachowanie uprawnień przeglądarki pozostają weryfikacją z Task 7.
- Commit: `1339658c146246931734121ba54fc4b54f5abbea`.
- Task 3: complete (commits c87b499..1339658c146246931734121ba54fc4b54f5abbea; tests: selected unit + typecheck → PASS)

### Task 4 — wspólne sterowanie przez przytrzymanie: complete

- RED potwierdzony dla brakującego reduceru gestów i ustawienia recordingMode w LearningScreen; kontroler nie zachowywał trybu toggle ani fallbacku hold. Po dodaniu reduceru jego 5 testów przechodziło niezależnie.
- Implementacja: jeden `SpeechRecordButton` obsługuje pointer capture, primary mouse, touch/pen, Space/Enter, key repeat, Escape, focus loss i toggle click bez zdublowania syntetycznym clickiem. Domyślny przycisk `Włącz mikrofon` tylko pyta o zgodę; gotowy przycisk działa jako hold. Dodano wskaźnik dźwięku, instrukcje i komunikat fazy, przełącznik trybu oraz zapis `umiem.recordingMode` w `LocalPreferences`. Tryb nie zmienia się podczas aktywnego nagrania/analizy; zadania tekstowe, Skip i odsłuch są blokowane w aktywnych fazach. Trace wyłączony w nowych i istniejących testach nagrywania.
- Test końcowy `pnpm test:unit packages/kid-ui/src/exercises/recording-gesture.test.ts packages/kid-ui/src/session/session-controller.test.ts` → 2 files, 39 tests PASS; wcześniejszy wybór obejmujący adapter: 3 files, 53 tests PASS; `pnpm typecheck` PASS; `git diff --check` PASS.
- `pnpm test:e2e tests/e2e/speech-recording-ux.spec.ts` → 2 tests PASS, w tym Space/Enter/Escape, mouse release outside, touch release outside w widoku 768×1024 po sprawdzeniu 390×844, toggle myszą i klawiaturą, odmowa mikrofonu i droga pisemna. `pnpm test:e2e tests/e2e/kid-flow.spec.ts -g "jeden profil|opuszczenie widoku"` → 2 tests PASS, w tym pełna sesja z mową i sprzątanie nagrania po opuszczeniu.
- Pierwszy przebieg E2E zgłosił asercję testową: przycisk Sprawdź pozostaje disabled dla pustego pola; test poprawiono, wypełniając odpowiedź przed sprawdzeniem dostępności. Końcowy przebieg E2E jest zielony.
- Odstępstwa: brak; brak testu na fizycznym telefonie/tablecie pozostaje udokumentowany do Task 7.
- Commit: `a7bd73a869c30e3c95486e1a668e2e0ed577742b`.
- Task 4: complete (commits ae96fc7..a7bd73a, tests: focused unit + typecheck + new E2E + kid-flow recording regressions → PASS)
