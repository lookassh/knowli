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
- [x] Zadanie 7 commit po review (`b679cdb`)
- [x] Zadania 1–6 RED→GREEN i commity
- [x] Niezależny review całości
- [x] Końcowa weryfikacja i PR do main: [#37](https://github.com/lookassh/knowli/pull/37), właściciel scala przez squash.

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
- Task 5: complete.
- Task 6: complete.
- Task 7: complete; PR #37 open for owner review/merge.


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

### Task 5 — odsłuch wzorca z aktualnej karty wyniku: complete

- RED potwierdzony: test kontrolera nie znalazł metody playFeedbackAudio; integracja PostgreSQL nie znalazła eksportu authorizeFeedbackAudio.
- Implementacja: opcjonalna flaga dostępności w feedbacku tylko dla wiarygodnie rozpoznanego kanonicznego tekstu z gotowym, zatwierdzonym TTS; endpoint POST /api/v1/kid/attempts/:attemptId/feedback-audio blokuje sesję, sprawdza aktywną kartę i najnowszą ukończoną próbę, ponownie waliduje rozpoznany tekst i zasób, po czym pieczętuje ekspozycję przed wydaniem ID. Odtwarzacz klienta autoryzuje przed audio i unieważnia opóźnioną zgodę po zmianie karty; attemptId pozostaje w feedbackzie z submit/poll/read.
- Testy PostgreSQL: kanoniczny wzorzec/replay, pieczęć i ekspozycja; odmowa po przejściu do kolejnej karty; brak audio dla zatwierdzonego niekanonicznego wariantu i niepewnego STT; brakujący attempt zwraca not_found. pnpm test:integration tests/integration/feedback-audio.test.ts tests/integration/speech.test.ts tests/integration/attempts.test.ts → 3 files, 36 tests PASS.
- Test kontrolera pnpm test:unit packages/kid-ui/src/session/session-controller.test.ts → 1 file, 36 tests PASS; obejmuje autoryzację przed odtworzeniem oraz tłumienie spóźnionej zgody po zmianie karty. pnpm typecheck PASS; git diff --check PASS.
- W pierwszym przebiegu integracji stara ścisła asercja nie uwzględniała nowego pola, a fragment zakładał małe litery mimo zachowania kapitalizacji. Zaktualizowano oczekiwanie; powtórny zestaw przeszedł. Jeden test asynchroniczny kontrolera wymagał przekazania następnego zadania po startAtTask; po poprawieniu fixture'a przeszedł.
- Odstępstwa: brak testu rzeczywistego równoległego requestu replay kontra end/next; bezpieczeństwo kolejności korzysta ze wspólnej blokady wiersza sesji i będzie sprawdzone w końcowym review. Powtórny odsłuch nie uruchamia STT/oceny ponownie.
- Commit: 9fe99f9b881f0dc375388e6f8c82d70f669d18dc.
- Task 5: complete (commits 6bf9fc5..9fe99f9b881f0dc375388e6f8c82d70f669d18dc; integration 36 + unit 36 + typecheck → PASS)

### Task 6 — czytelna karta wyniku i następny krok: complete

- RED unit potwierdzony: `speech-feedback-view.test.ts` nie mógł zaimportować nieistniejącego modułu. E2E nowej karty i końcowy test regresji uruchomiono po implementacji; pierwszy przebieg ujawnił problem z widocznością działań przy długim tekście, a potem test starego kid-flow ujawnił, że scenariusz musiał zatwierdzić ekran wyniku po „Pomiń”. Poprawiono układ karty i sekwencję testową.
- Implementacja: helper mapuje status STT/wymowy na wiarygodny komunikat/ton; nullable i legacy DTO zachowują neutralny fallback. Karta inline pokazuje „Usłyszałem” tylko dla tekstu z DTO, osobny wynik wymowy, fragmenty `good/almost/unknown` z tekstową legendą i lokalną wskazówkę tylko dla jawnego `almost`. Terminalny wynik pokazuje „Dalej”; wynik z retry oferuje ponowienie i „Pomiń”. Ponowienie wraca do `idle`, odsłuch wzorca wymaga dostępności i autoryzuje aktualną próbę.
- Testy: `pnpm test:unit packages/kid-ui/src/screens/speech-feedback-view.test.ts packages/kid-ui/src/session/session-controller.test.ts` → 2 pliki, 45 testów PASS; `pnpm typecheck` PASS; nowy `pnpm test:e2e tests/e2e/speech-recording-ux.spec.ts` → 3/3 PASS; `pnpm test:e2e tests/e2e/kid-flow.spec.ts tests/e2e/mock-test.spec.ts` → 13/13 PASS; `git diff --check` PASS.
- Odstępstwo: nie zapisano osobnego RED E2E przed implementacją komponentu; oczekiwany błąd przed kodem potwierdzono testem jednostkowym, a pierwsze E2E po implementacji zgłosiło błąd układu/akcji. Zapisujemy to jawnie, nie przypisując tego E2E jako RED testu braku funkcji. Bez testu na fizycznym telefonie/tablecie.
- Commit: `2aa548af8e61c6d4e6021b0b0a716d06aae899fe`.
- Task 6: complete (commits 9dbec06..2aa548a; unit 45 + E2E 16 + typecheck → PASS)

### Task 7 — regresje, dokumentacja, urządzenie i review całości: active

- Dodano testy RED→GREEN dla wyjątku `MediaRecorder.start()` po uzyskaniu strumienia i asynchronicznego `MediaRecorder.onerror`; oba przypadki zwalniają track, callbacki i stan aktywnego nagrania. Pozostałe przeglądane regresje: 15 s (`browser.test.ts`), przerwanie widoku (`kid-flow.spec.ts`), retry/read tej samej próby podczas `processing` (`speech.test.ts`), autoryzowany replay i zamknięta ekspozycja (`feedback-audio.test.ts`/`speech.test.ts`), kasowanie profilu (`auth-profiles.test.ts`), budżet („Jeszcze 3”) i idempotentny exposure (`sessions.test.ts`), zaakceptowany wariant/odrębna ocena wymowy (`speech.test.ts`), dwóch klientów (`mock-test.spec.ts`, konflikty attempt/sesji w testach unit/integration).
- Dokumentacja zaktualizowana w SPEC, architecture, folder-structure i implementation-plan. Pokrycie: R01 przez zamknięcia ekspozycji, replay i retry/read tej samej próby; istniejące testy dwóch klientów pokrywają ogólny konflikt/stale-task, ale bez osobnej równoległej próby replay audio kontra next/end. R03 przez historię prób i cascade profilu; R05 przez ochronę należnych sprawdzeń po ekspozycji; R07 przez zatwierdzone warianty; R04 skontrolowane istniejącym przejściem exposure/complete-presentation. R02/R06 są niezmienione i weryfikowane przez pełne suite istniejących testów mediów.
- Testy końcowe po poprawkach Task 7: `pnpm test:unit` → 50 plików, 437 testów PASS; `pnpm test:integration` → 19 plików, 176 testów PASS; `pnpm test:e2e` → 70/70 PASS (uruchomione przed ostatnią poprawką wyłącznie w adapterze na asynchroniczny błąd MediaRecorder; potem powtórzono cały unit 437/437 oraz browser adapter 16/16); `pnpm typecheck` PASS; `pnpm build` PASS; `git diff --check` PASS. Testy używały fake providerów i izolowanej bazy PostgreSQL.
- Brak dostępnego telefonu/tabletu i brak zgody na użycie prawdziwego głosu dziecka: test urządzenia i ocena jakości rozpoznania/wymowy nie są zweryfikowane; syntetyczne fake media nie są dowodem jakości providerów.
- Niezależny review (`gpt-6.1-sol`, xhigh) objął `dd1e025..2aa548a` i niezacommitowany diff. Nie znaleziono Critical; znaleziono 5 Important oraz 4 Minor. Po weryfikacji przyjęto wszystkie pięć pierwszych Important: przycisk hold zostaje aktywny dostępnościowo podczas `starting`, async błąd rejestratora wraca neutralnie do idle bez próby, retry/skip/next/end unieważnia odsłuch przed oczekiwaniem na serwer, autoryzacja audio zadania jest generacyjnie wycofywana przed await, a kanoniczny wzorzec jest dostępny również dla wiarygodnego `different`. Minor odłożone: legacy fragments w renderze, cleanup AudioContext po błędzie konfiguracji, rodzaj zdarzenia replay (`feedback_issued`/`audio_issued`) i komunikat po limicie/etykieta toggle.
- Runda 2 znalazła szósty Important: `endNow()` nie zwalniał mikrofonu przed await na zamknięcie sesji. Dodano teardown przed pierwszym await oraz testy dla aktywnego recording i opóźnionego starting; oba sprawdzają anulowanie, spóźniony limit i brak wysłanej próby. Test starting potwierdził RED po usunięciu teardown (`cancelled` 0 zamiast 1), potem GREEN. Niezależny finalny review potwierdził na BrowserRecorder+kontrolerze zwolnienie tracka przed odpowiedzią serwera dla obu faz; Critical 0, otwarte Important 0, Minor 4, gotowość do PR. Review package SHA256 `0905544982CE3882595F25D6835CDBFB888B6520F99D6F2B3EE504EE49FE34C5` odpowiada aktualnemu diffowi HEAD; lockfile czysty.
- Po poprawce kończącej sesję: `pnpm test:unit` 50 plików/443 testy PASS, `pnpm typecheck` PASS, `pnpm build` PASS, `git diff --check` PASS. Wcześniej po pięciu poprawkach review: `pnpm test:integration` 19 plików/177 testów PASS i `pnpm test:e2e` 70/70 PASS; nie powtarzano tych dwóch pełnych zestawów po lokalnej zmianie kontrolera `endNow()` (zmiana sprawdzona nowymi testami jednostkowymi). Pełny review końcowy był read-only i nie uruchamiał ponownie pełnych suite.
- Brak fizycznego telefonu/tabletu i brak autoryzowanej próbki prawdziwego głosu dziecka pozostają ograniczeniami. Nie ma dedykowanego testu wyścigu replay audio kontra równoległy next/end; istnieje wspólna blokada sesji i pokrycie osobnych przejść. Zachować te zastrzeżenia oraz cztery Minor w PR.
- Task 7: implementacja i niezależny review complete; commit `b679cdb` oraz push `feature/speech-recording-ux` wykonane; PR #37 do `main` otwarty. Oczekuje na review/scalenie właściciela przez squash. Worktree pozostaje zachowany.
