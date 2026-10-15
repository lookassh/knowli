# Zestawy obrazkowe — dziennik przygotowania i wykonania

Data: 2026-10-14.

Projekt: `../specs/2026-10-14-picture-vocabulary-design.md`.
Plan: `../plans/2026-10-14-picture-vocabulary.md`.

## Stan i zatwierdzenia

- [x] Uzgodniony koncept: flaga dziecka nieczytającego, wariant zestawu picture, dobór słów przez LLM, zatwierdzanie całego zestawu przez rodzica, cztery rodzaje zadań.
- [x] Właściciel zlecił przygotowanie planu przez Superpowers writing-plans.
- [x] Zapisano projekt i plan po wyłączeniu trybu Plan; przygotowano konkretne kontrakty, pliki i testy.
- [x] Wykonano przegląd własny treści i zgodności interfejsów planu.
- [x] Właściciel przejrzał projekt i plan, poprosił o review przed implementacją, a następnie zlecił wykonanie w TDD RED-GREEN i niezależny review końcowy.
- [x] Plan wykonany przez bieżącego agenta zgodnie z executing-plans; implementacji nie delegowano.
- [x] Worktree `C:/Users/looka/.codex/worktrees/picture-vocabulary/knowli`, branch `feat/picture-vocabulary`, baza `6faf2793d21e8cf98dcbd7cc655ccebc008393f6`; `.env` i zależności przygotowane zgodnie z AGENTS.md.

Plan został zaimplementowany w izolowanym worktree. Nie wykonano wdrożenia ani nie zmieniano profili dzieci ani materiałów rodzinnych. Push i PR następują po niezależnym review; merge pozostaje po stronie właściciela.

## Przygotowanie — dowody i adaptacje

- Odczytano aktualny writing-plans/SKILL.md z instalacji Superpowers 6.4.2 i sprawdzono istniejące kontrakty, generator, porty, publikację/wersjonowanie, scheduler, Kid router, media i testy.
- Stan Git przed zapisem dokumentów był czysty. Istniejącego kodu nie zmieniono.
- W trybie Plan wcześniejsze wersje były w rozmowie. Po przejściu do Default zapisano oba artefakty do przeglądu, bez traktowania wcześniejszej zgody na koncept jako zgody na implementację.
- Zgodnie z AGENTS.md dla samego planowania nie wykonano automatycznego commita ani publikacji dokumentacyjnego PR. Domyślny tryb wykonywania to executing-plans, nie delegacja sugerowana w generycznym nagłówku skilla.
- Weryfikacja przygotowania: odczyt zapisanych plików; UTF-8, brak końcowych spacji i poprawne odnośniki między specyfikacją/planem/dziennikiem. Przegląd własny poprawił liczbę stałych kluczy audio (17) i uściślił interfejs opcji, walidację SQL oraz konkretne ścieżki panelu postępu. Końcowy git diff --check i sprawdzenie dokumentów wykonane przed raportem.

## Review planu — 2026-10-14

- Właściciel poprosił o review, ponieważ implementację wykona słabszy model; ten review nie jest review przyszłej implementacji.
- requesting-code-review: dedykowany recenzent `/root/review_picture_plan`, model `gpt-6.1-sol`, reasoning `xhigh`, wybrany jako najmocniejszy dostępny poza rodziną GPT Astra. Czytał pełne trzy nieśledzone artefakty i aktualny kod; BASE=HEAD=6faf2793d21e8cf98dcbd7cc655ccebc008393f6, brak diffu commitów.
- Pierwszy werdykt: Ready for weaker-model implementation: No. Critical: 0; Important: 9; Minor: 3. Raport i dyspozycje: `../reviews/2026-10-14-picture-vocabulary-plan-review.md`.
- receiving-code-review: wszystkie Important potwierdzono w kodzie; poprawiono wyłącznie dokumenty. Dodano decyzje executora UI audio, transportu ujawnienia, zamrożonego zakresu ocen, tekstów opcji/raportu, cyklu disable/pending/rezerwacji, wyjątku resume, query mikrofonu, DTO okładki i error details.reason. Minor: poprawiono nazwę executeGeneration, dispatch ExerciseView/fixture i kolejność wspólnego walidatora.
- Druga runda tego samego niezależnego recenzenta objęła całe cztery artefakty: Ready for weaker-model implementation: Yes. Critical: 0, Important: 0; jedna Minor o opisie Recall po wzorcu.
- Pozostałą Minor poprawiono redakcyjnie i dopisano asercję zachowania wspomaganego Recall z independent=false, bez awansu samodzielności. Nie zmienia to zatwierdzonego rozwiązania; odbiór treści i formatowania wykonany przez autora po tej poprawce.
- Plan gotowy do przekazania słabszemu wykonawcy; sam review nie zastępuje polecenia implementacji, executing-plans ani końcowego review kodu. W chwili zapisu planu implementacja nie była jeszcze rozpoczęta.

## Zadania implementacji — tabela

| Zadanie | Stan | RED | GREEN | Commit / odstępstwa |
| --- | --- | --- | --- | --- |
| 1. Kontrakty, baza, profil | Ukończone | 4 oczekiwane błędy w celowanych testach kontraktu/API | Unit 21/21, integration 26/26, typecheck | `7cee7bb`; brak odstępstw |
| 2. Generacja i retry | Ukończone | Asercje generowania, powtórzenia żądania i ochrony przed duplikacją | Unit 20/20, integration 13/13, E2E 11/11, typecheck | `573c0a6`; nieudany szeroki RED przerwany i zapisany, celowane RED użyte dalej |
| 3. Reprezentacje, media, publikacja | Ukończone | Edytor formatu, niepoprawny element i brak walidacji | Unit 12/12, integration 28/28, E2E 11/11, typecheck | `0e51e93`; brak odstępstw |
| 4. Katalog UI audio | Ukończone | Brak schematu/usługi katalogu | Unit 3/3, integration 45/45, typecheck | `654614d`; brak odstępstw |
| 5. Scheduler i Kid API | Ukończone | Celowane błędy kontraktu i sesji w task verify | Unit, integration, E2E oraz typecheck z `task5-verify.ps1` | `50c8227`; szczegóły w ignorowanym lokalnym task log |
| 6. Kid UI | Ukończone | RED w teście Kid API katalogu audio i brakującego modułu guidance | Unit 50/50, picture E2E 4/4, Kid regression E2E 57/57, typecheck | `182ee13`; część dodatkowych asercji kontrolera dodano po wstępnym wiring; w Task 7 wykryto i naprawiono status mikrofonu, z własnym RED-GREEN |
| 7. Raporty, MCP i odbiór | Ukończone | Progress E2E najpierw nie znalazł noty; integration/MCP potwierdziły niezmienny kontrakt; unit ujawnił regresję rezerwacji i statusu mikrofonu | Unit 1098/1098, integration 386/386, E2E 173/173, MCP 8/8, typecheck/build, eksport schematu bez diffu, `git diff --check` | Implementacja i testy ukończone; follow-up po review znajduje się w working tree do finalnego commita; manifest hash skilla odświeżony |

## Implementacyjny code review — pierwsza runda — 2026-10-14

- Niezależny recenzent `/root/independent_picture_review`, model `gpt-6.1-sol`, reasoning `xhigh`, objął zakres `6faf2793d21e8cf98dcbd7cc655ccebc008393f6..HEAD` wraz z niezacommitowanym diffem i testami.
- Werdykt: niegotowe. Critical: 0; Important: 9; Minor: 3. Wszystkie Important zweryfikowano w implementacji i naprawiono; trzy Minor także zamknięto.
- Scheduler: filtruje tekstowe zadania dla profilu nieczytającego i zwalnia rezerwacje Recall przy wyłączonym mikrofonie wyłącznie w zestawach obrazkowych. RED: 9 regresji w zastanych testach rezerwacji po zbyt szerokiej zmianie; GREEN po ograniczeniu zakresu — unit 1098/1098.
- Sesja/API: wyłączenie mikrofonu czyści rezerwacje i odrzuca sesję nieaktywną; końcowa ocena próby będącej w przetwarzaniu zachowuje stan pominięty. Integracyjne testy cyklu wyłączenia i finalizacji przechodzą.
- Kid UI audio: awaria odmowy wyłączenia mikrofonu jest widoczna i pozwala ponowić; mowa wskazówek nie nakłada się na mikrofon ani processing; błędy dekodowania mają retry/koniec. Dodano odtwarzanie wskazówek na profilach, zestawach, feedbacku i podsumowaniu oraz ikony akcji; testy kontrolera i E2E ścieżki audio przechodzą.
- Testy Recall picture: po poprawnym STT w 299 s ocena pozostaje wspomagana i nie kwalifikuje się do potwierdzenia; cisza, timeout i „Nie pamiętam” nie tworzą oceny pisowni. Testy RED początkowo zatrzymały się na brakującej konfiguracji testowego katalogu UI audio; po dodaniu gotowego katalogu fixture oba testy przechodzą.
- Kid deck: rekomendacje lekcji działają przy wyłączonym mikrofonie; karta aktywnej sesji zachowuje przypiętą wersję i okładkę. Zmiany potwierdzone integracją.
- Panel rodzica: ostrzega o wspólnym awatarze dzieci i przydziale standardowego zestawu dziecku nieczytającemu. Dwa testy E2E wykazały RED przed przywróceniem ostrzeżeń, po którym obie ścieżki przechodzą.
- Pierwsza pełna weryfikacja po poprawkach miała 169/173 E2E: trzy błędy stabilności layoutu wynikały z zawinięcia statusu sesji po dodaniu przycisku audio i ikony „Koniec”; usunięto ikonę przy zachowaniu tekstowej akcji. Czwarty błąd był niejednoznacznym selektorem przy ostrzeżeniach wielu dzieci; test zawężono do pierwszego równoważnego ostrzeżenia. Te cztery testy zaliczyły potem celowane GREEN.
- Końcowe pełne suite na stanie po poprawkach: unit 1098/1098, integration 386/386, E2E 173/173, MCP 8/8, typecheck i produkcyjny build. `contracts:export-learning-overview` nie zmienił wygenerowanego schematu.
- Nie wykonano testu na rzeczywistym urządzeniu ani z dzieckiem; symulowany WAV sprawdza ścieżkę przeglądarkowego audio, nie naturalność polskiego TTS.
- Następny krok: niezależne ponowne review całego diffu; wykonanie i weryfikacja jego uwag przed PR.

## Review implementacji — druga runda — 2026-10-14

- Pierwszy review końcowy zgłosił dwie uwagi Important o pominięciu mówionego zadania i zbyt słabej weryfikacji audio, oraz Minor o brakującej ikonie i tekstach liczebników. Wszystkie uwagi przeniesiono do kodu i zweryfikowano testami.
- TDD RED-GREEN: dodano testy wyścigu opóźnionej odmowy mikrofonu przy zmianie sesji, ponownego pobrania katalogu instrukcji po błędzie/not-ready, picture session bez dostępnego urządzenia, skip zadania mówionego bez mikrofonu oraz odmian etykiet liczebników. Testy pokazały brakujące zachowania, a następnie przechodziły po minimalnych poprawkach. Dodatkowo test pełnej ścieżki picture Recall uruchamia prawdziwe kodowanie audio w BrowserRecorder i żądanie API; test nie używa fizycznego mikrofonu.
- E2E odtwarzania instrukcji używa dekodowalnego WAV i natywnego `HTMLAudioElement.play`; test czeka na rzeczywiste `ended`, zamiast syntetyzować zdarzenie końca. Nie jest to walidacja jakości TTS ani urządzenia docelowego.
- Ostatnie weryfikacje: `pnpm test:unit` 116 plików / 1109 testów PASS; `pnpm test:integration` 39 plików / 386 testów PASS; `pnpm test:e2e` 175/175 PASS (7.3 min); `pnpm test:mcp` 8/8 PASS; `pnpm typecheck` exit 0; `pnpm build` PASS; `pnpm contracts:export-learning-overview` PASS bez zmian wygenerowanego kontraktu; `git diff --check` PASS. Pełny E2E wykonano po zmianach kontrolera, audio, UI i fixture.
- Następny krok: świeży niezależny review całego zakresu `6faf2793d21e8cf98dcbd7cc655ccebc008393f6..HEAD` razem z bieżącym diffem roboczym, potem naprawa ewentualnych uwag zgodnie z receiving-code-review.

## Niezależne review implementacji — runda 2 i poprawka — 2026-10-14

- Dedykowany recenzent `/root/independent_picture_review`, `gpt-6.1-sol` xhigh, read-only, objął `6faf2793d21e8cf98dcbd7cc655ccebc008393f6..182ee131dfc974fef4f64498555e8a6aebeb9346` oraz bieżący diff i nowe pliki. Pełny raport tej rundy: `../reviews/2026-10-14-picture-vocabulary-implementation-review-round-2.md`.
- Werdykt: 0 Critical, 0 Important, 1 Minor. Pozostałe zachowanie było regresją UI: `listKidDecks` wymuszało zero gwiazdek dla aktywnej wersji słownikowej, więc po reloadzie dziecko czytające chwilowo traciło widoczne dotychczasowe postępy.
- receiving-code-review potwierdziło, że uwaga jest zasadna. Test integracyjny najpierw RED: aktywna sesja zwracała licznik `0`, oczekiwane `1` (uruchomienie przez konfigurację integracyjną, 1 failing / 386 passing). Minimalna poprawka zachowuje licznik przypiętej wersji zarówno dla widocznej, jak i wznawianej archiwalnej sesji.
- GREEN: celowany test 1/1; pełne `pnpm test:integration` 39 plików / 387 testów; `pnpm test:unit` 116 / 1109; `pnpm typecheck` exit 0; `pnpm build` PASS; picture E2E 7/7. Poprzedni pełny E2E suite przed samą poprawką gwiazdek: 175/175. Review obejmie ponownie całą gałąź i tę poprawkę przed integracją.
- `git diff --check` zostaje do potwierdzenia po finalnych dokumentach. Nie wykonano urządzeniowego ani rodzinnego odbioru.

## Końcowe bramki wykonania

- [x] Pełne suite unit/integration/E2E, MCP, typecheck, build i diff check zielone.
- [x] Druga niezależna runda review całego zakresu; brak Critical/Important, jedna Minor naprawiona przez RED-GREEN.
- [x] Niezależne potwierdzenie poprawki gwiazdek i gotowości całego zakresu (finalny werdykt rundy 3).
- [x] Rzeczywiste urządzenie i dziecko nie były dostępne; nie deklarujemy ich odbioru ani jakości prawdziwej mowy.
- [ ] Verification-before-completion i finishing-a-development-branch.
- [ ] PR do main po review; scala właściciel przez Squash and merge.
- [x] Wdrożenie i aktualizacja skilla Hermesa wymagają odrębnego uruchomienia/odbioru; pakiet repozytorium zaktualizowany i testy konsumenta przechodzą.

## Niezależne review implementacji — poprawki po drugiej rundzie — 2026-10-15

- Po wcześniejszym review dodano trzy regresje TDD, każda z potwierdzonym RED przed poprawką i GREEN po niej:
  1. `tests/integration/sessions.test.ts` wykrył licznik aktywnej vocabulary sesji równy 0 zamiast 1. Poprawka pobiera przypiętą wersję do progressu tylko dla `deckKind=vocabulary`; test w `tests/integration/lesson-sessions.test.ts` chroni aktywną lekcję przed wejściem w vocabulary snapshot i błędem `computeTargetKey(undefined)`.
  2. `tests/integration/picture-vocabulary.test.ts` wykrył, że po timeoutcie przetwarzanej próby i lazy finalizacji świeże `dont_remember` próbowało ponownie otworzyć terminalne zadanie. `startAttempt` ponownie odczytuje stan po finalizacji/wyłączeniu mikrofonu i odrzuca konflikt przed utworzeniem drugiej próby; asercje sprawdzają brak dodatkowej próby i brak fałszywej oceny wiedzy.
  3. `packages/kid-ui/src/session/session-controller.test.ts` wykrył, że błąd sieci przy odtwarzaniu audio picture Recall nie pokazywał offline/retry (`offline=false`). Kontroler teraz obsługuje błąd przez wspólny kanał retry/feedback; ponowienie autoryzuje i odtwarza dźwięk.
- Końcowy niezależny probe recenzenta potwierdził retry audio jako GREEN; nie znalazł otwartych Critical/Important/Minor w kodzie po tych poprawkach. Końcowy raport Ready to merge ma zostać dopisany przez recenzenta po uwzględnieniu pełnego E2E i tego dziennika.
- Ostateczne bramki na stanie po wszystkich poprawkach: `corepack pnpm test:unit` 116 plików / 1110 testów PASS; `corepack pnpm test:integration` 39 plików / 387 testów PASS; `corepack pnpm test:e2e` 175/175 PASS (7.3 min); `corepack pnpm test:mcp` 8/8 PASS; `corepack pnpm typecheck` exit 0; `corepack pnpm build` exit 0; `corepack pnpm contracts:export-learning-overview` PASS bez zmiany wygenerowanego kontraktu; `git diff --check` PASS.
- E2E picture flow używa fake platformowego capture provider, ale realnego BrowserRecorder kodującego dźwięk i wysyłającego API; instrukcje odtwarzają dekodowalny WAV przez natywne audio. Brak odbioru na fizycznym urządzeniu i z dzieckiem; naturalność TTS/ilustracji pozostaje niezweryfikowana.
- Stan PR: jeszcze nie utworzono. Po zapisaniu finalnego niezależnego werdyktu pozostaje workflow `verification-before-completion` i `finishing-a-development-branch`, push gałęzi oraz otwarcie PR do `main`; squash merge wykonuje właściciel.

## Końcowe bramki wykonania — aktualizacja 2026-10-15

- [x] Wszystkie poprawki review zamknięte testami RED-GREEN.
- [x] Pełne suite unit/integration/E2E, MCP, typecheck, build, eksport kontraktu i diff check zielone na końcowym kodzie.
- [x] Recenzent niezależnie potwierdził trzy poprawki i brak bieżących findings; finalny zapis werdyktu dołączony w `../reviews/2026-10-14-picture-vocabulary-implementation-review-round-3.md`.
- [x] Ograniczenia urządzeniowego i rodzinnego odbioru jawnie udokumentowane.
- [ ] Workflow końcowy `verification-before-completion` i `finishing-a-development-branch` oraz utworzenie PR do `main` (bez scalania przez agenta).



## Ponowna weryfikacja po aktualizacji bazy — 2026-10-15

- Przed PR odświeżono `origin/main`: zawierał commit `1d5399dd3ab2bb3999fe6060355293f1280f58a9` (#64), dotyczący domyślnego wyłączenia mikrofonu. Feature został bez konfliktów przeniesiony na tę bazę. Nowy merge-base `HEAD`/`origin/main`: `1d5399dd3ab2bb3999fe6060355293f1280f58a9`.
- Po rebase ponownie wykonano pełne bramki: unit 116 plików / 1111 testów PASS; integration 39 plików / 387 testów PASS; E2E 175/175 PASS (7.3 min); MCP 8/8 PASS; typecheck exit 0; build exit 0; `git diff --check` PASS.
- Ta gałąź jeszcze wymaga końcowego niezależnego potwierdzenia na nowej bazie przed push/PR. Review z rundy 3 dotyczyło wcześniejszego SHA; nie traktować go jako recenzji wyniku rebase.

## Ostatnie poprawki po rebase — TDD RED-GREEN — 2026-10-15

Recenzent rundy po rebase wykrył pięć krawędzi. Każda została odtworzona w teście/probe, naprawiona minimalnie i sprawdzona:

1. Pierwsze pobranie listy zestawów wysyłało `microphoneEnabled=true`, mimo że widoczna kontrolka startuje z `false`. Test kontrolera RED (true zamiast false), GREEN po podaniu false w `#openDeckScreen`.
2. Wznowiona sesja z `session.microphoneEnabled=true` gubiła lokalną zapisaną odmowę. Test standardowej sesji RED (`micDenied=false`), GREEN po zachowaniu `this.#micDenied`.
3. Dla promptu picture Recall z `exerciseType=recall` playback pieczętował disclosure dwa razy. Test RED (2 zgody zamiast jednej), GREEN po wykluczeniu picture Recall z drugiej, ogólnej gałęzi.
4. `hasScheduledWork` pomijał historię niedostępnego dziecku `reading` przed ustaleniem, czy element był już rozpoczęty. Test RED (nowa rekomendacja mimo wcześniejszej oceny), GREEN po wyznaczaniu `started` z pełnej historii przed filtrem kwalifikowalnych umiejętności.
5. Zapisana odmowa przy wznowieniu picture sesji nieczytającego dziecka nie wyłączała mikrofonu po stronie serwera; niewidoczna karta głosowa mogła nadal zostać wydana. Test RED (brak wywołania disable), GREEN po synchronizacji przez istniejące `disableMicrophone` przed `nextTask`. Błąd sieci pozostawia komunikat i retry; ponowienie wyłącza mikrofon, a potem ładuje zadanie.

Po poprawkach: targeted controller 63/63, scheduler regression GREEN; pełne unit 116 plików / 1115 testów PASS; pełne integration 39/387 PASS z unikalnym `UMIEM_TEST_RUN_ID`; typecheck/build, MCP 8/8, eksport schematu bez diffu. Jedno wcześniejsze pełne uruchomienie integration na domyślnym identyfikatorze pokazało 3 błędy w `sessions.test.ts`; każdy test osobno i cały plik 44/44 przechodziły, a pełne suite na izolowanym identyfikatorze przeszło 387/387. Nie przypisano tym obserwacjom poprawki kodu.

Jedno uruchomienie E2E zostało celowo przerwane w trakcie, gdy dodatkowy review ujawnił wariant wymagający korekty. Nie jest zaliczane jako wynik testowy. Końcowy pełny E2E na ostatnim kodzie, z odrębnym portem i run ID: 175/175 PASS (7.7 min). Niezależny werdykt rundy 4 został zapisany poniżej.

## Niezależne review po rebase — runda 4 — 2026-10-15

- Dedykowany recenzent `/root/independent_picture_review`, `gpt-6.1-sol` xhigh, objął pełny feature oraz zakres `1d5399dd3ab2bb3999fe6060355293f1280f58a9..fba3852b08353949dadfb5b1512e9767f408772e` i wszystkie pięć plików working diffu.
- Werdykt: **Ready to merge: Yes**; Critical 0, Important 0, Minor 0. Recenzent niezależnie potwierdził pięć poprawek, kolejność wyłączenia mikrofonu i pobrania zadania, retry błędu oraz kontrakty, ekspozycje, kwalifikację ocen, publikację, niezmienność mediów i MCP.
- Szczegółowy raport: `docs/superpowers/reviews/2026-10-14-picture-vocabulary-implementation-review-round-4.md`.
- Końcowe bramki: unit 116 plików / 1115 testów; integration 39 plików / 387 testów; E2E 175/175 (7.7 min); MCP 8/8; typecheck/build PASS; eksport schematu bez zmian; `git diff --check` PASS.
- Rzeczywisty TTS, ilustracje, mowa prawdziwego dziecka i fizyczne urządzenie nie były przedmiotem tego odbioru. Wdrożenie i aktualizacja zainstalowanego skilla Hermesa wymagają osobnych działań.

## Końcowe czynności

- [x] Pełna weryfikacja i niezależny review całego zakresu po rebase; brak otwartych findings.
- [ ] `git diff --check`, commit zmian po review, push gałęzi roboczej i PR do `main` (bez scalania przez agenta).
