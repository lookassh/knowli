---
title: 'Raport sesji, ocena LLM i proste punkty'
type: 'refactor'
created: '2026-10-19'
updated: '2026-10-20'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '12963bf192d1bc19a571cef0b22e894ecae9586b'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

FE zbiera aktywność sesji nauki/kartkówki lokalnie i wysyła raport na koniec. Serwer zapisuje raport, dołącza zadania/odpowiedzi z bazy i wywołuje LLM. Usuwamy Xbox, historię nagród i serwerowy protokół aktywności. Zostają proste punkty.

## Boundaries & Constraints

**Zawsze:** model wskazuje zadania bez podstaw do zaliczenia pracy i uzasadnia wykluczenia. Nie wyznacza sekund ani punktów. Kod sumuje zmierzony aktywny czas pozostałych zadań i nalicza 1 pkt/60 s; reszta przechodzi między sesjami. Zachowujemy obecny dorobek dzieci. Dużo błędów nie oznacza braku pracy.

Szczegółowy JSONB zawiera aktywność, zadania, odpowiedzi i ocenę; retencja 7 dni. Trwale zostaje krótki wynik: czas całkowity, zatwierdzony, punkty i uzasadnienie. Awaria/niepoprawny wynik LLM: zachować raport i błąd, pokazać komunikat; bez punktów i automatycznych ponowień.

**Nigdy:** heartbeatów, nagrodowych autoryzacji audio, ledgera punktów, stanów/kolejki ocen. Nie zapisujemy nagrań i każdego klawisza. Model nie otrzymuje imion, identyfikatorów i sekretów. Zachowujemy historię nauki. Bez wdrożenia produkcyjnego.

## I/O & Edge-Case Matrix

| Warunek | Zachowanie |
|---|---|
| Koniec sesji | Jeden ograniczony raport: kolejność zadań, edycje, odsłuchy, bezczynność i tło. Odpowiedzi zapisują się na bieżąco. |
| Przerwanie | FE zachowuje raport do potwierdzenia zapisu; zamknięcie karty nie wymaga wywołania LLM w tle. |
| Retry transportu | Sesja identyfikuje raport; zapisany wynik zwracany ponownie. Punkty najwyżej raz, także po retencji. |
| Timeout/błędny werdykt | Raport i błąd zachowane; bez punktów. Powtórzenie żądania nie uruchamia kolejnej oceny. |
| Po 7 dniach | Szczegółowy JSONB znika; punkty, krótki wynik i historia nauki zostają. |

</frozen-after-approval>

## Dokumenty wykonawcze

Cały zakres do zatwierdzenia obejmuje tę specyfikację oraz:

1. [Projekt przepływu, danych, oceny LLM i UI](client-reward-time/design.md).
2. [Migrację i mapę zmian w kodzie](client-reward-time/migration.md).
3. [Scenariusze odbioru i kolejność implementacji](client-reward-time/acceptance.md).
4. [Instrukcja przekazania do ZCode](client-reward-time/handoff.md) i [przykłady wyników](client-reward-time/examples.json).

## Code Map

Pełne ścieżki i działania: tabela w `client-reward-time/migration.md`, sekcja 5. Wskazane dalej „pliki z mapy” odnoszą się do tej tabeli.

## Tasks & Acceptance

**Execution:**
- [x] `packages/kid-ui/src/session/activity-report.ts` i pliki FE z mapy — lokalny raport z podmienialnym zegarem, kopią do odbioru i limitami; usunąć sygnały nagrodowe.
- [x] Kontrakty/router z mapy — raport końcowy, wersja formatu, walidacja i wymóg odświeżenia starego klienta.
- [x] `packages/server/src/modules/session-activity.ts`, `ports/ai.ts`, adapter providera — zapis przed pojedynczą oceną poza transakcją; Zod wyniku i timeout. Zadania/odpowiedzi jako dane, nie instrukcje. Serwer dołącza własne zadania i odpowiedzi.
- [x] `schema.ts` i migracja w `packages/server/drizzle/` — raport JSONB/retencja i krótki wynik sesji, licznik/reszta punktów profilu. Przenieść dorobek, usunąć 10 tabel nagrodowych i zależności. Bez migracji produkcyjnej.
- [x] Moduły serwera z mapy — usunąć Xbox, streamy, stare rozliczenia/odbudowę nagród. Krótkie znaczniki przyjęcia/rozliczenia w sesji chronią przed równoległą oceną i ponownymi punktami; bez maszyny stanów.
- [x] `apps/web/src/parent/WorkCardPanel.tsx`, ekrany profilu/podsumowania — wynik sesji i punkty, bez Xbox i salda do wydania.
- [x] `apps/worker/src/tasks.ts` — czyścić wygasły JSONB/szczegóły błędu, zachować sesję/punkty.
- [x] `docs/{SPEC,architecture}.md` i testy — nowy model, migracja i API → MCP → skill; osobny szacunek learning-overview pozostaje.

**Acceptance Criteria:**
- Given poprawny raport, when LLM wskaże wykluczone zadania, then kod oblicza czas pozostałych i punkty z resztą.
- Given zapisany wynik/błąd, when ponowimy żądanie, then nie powstaje drugie naliczenie ani automatyczna ocena.
- Given minęło 7 dni, when worker czyści dane, then szczegóły znikają, a punkty i krótki wynik zostają.
- Given istniejące punkty, when migrujemy, then dorobek pozostaje, a tabele i funkcje Xbox/pomiaru nie istnieją.

## Implementation Notes

- 2026-10-20: właściciel zatwierdził cały pakiet. Przygotowanie przekazania nie oznacza rozpoczęcia implementacji.
- 2026-10-20: ZCode wdrożył cały zakres w worktree `impl/client-reward-time` (TDD na kontraktach, reporterze FE i module serwera; integracja PostgreSQL; E2E lifecycle/karta pracy). Szczegóły weryfikacji w raporcie implementacji; wdrożenie produkcyjne migracji 0021 wymaga osobnego polecenia.
- 2026-10-20: niezależny review (3 warstwy) — 17 łatek naniesiono (m.in. zamrożenie raportu raz przy retry, walidacje kontraktu, per-dziecko kontrola migracji, odtworzone regresje karty pracy, testy adaptera/payloadu/worker); 1 odkrycie odroczono (brak długości nagrania w porcie AudioPlayer); podczas weryfikacji końcowej naprawiono też utajony bug useChoiceKeyboard (strzałki po usunięciu przypadkowego re-emitu). Pełne suite'y zielone: unit 1352, integracja 472, E2E 204, typecheck, build.

## Spec Change Log

- 2026-10-20: właściciel zastąpił plan per krok raportem sesji/LLM, usuwa Xbox/historię nagród. Ustalił 1 pkt/60 s, retencję 7 dni i błąd bez punktów/ponowień.
- 2026-10-20: na prośbę właściciela dodano szczegółowy projekt, migrację i scenariusze odbioru. Zatwierdzenie obejmuje cały pakiet.
- 2026-10-20: właściciel zaakceptował korektę: LLM wyklucza zadania, kod liczy czas i punkty; awarie bez monitoringu i ponowień.

## Review Triage Log

Review 2026-10-20 (blind-hunter + edge-case-hunter + verification-gap; triage po samodzielnej weryfikacji każdego twierdzenia):

- high/patch — ponowienie końca sesji po utracie odpowiedzi HTTP zamraża raport od nowa (inny elapsedMs → inny fingerprint → trwały 409 zamiast zwrotu zapisanego wyniku; narusza wiersz macierzy „Retry transportu"). Fix: zamrożenie raz i ponowne użycie obiektu.
- medium/patch — utracone regresje Karty pracy (ocena mixed, answerExample sekwencji, domyślna data wg strefy rodziny, zadanie sprzed północy, remainingSteps) — acceptance §6 wymaga ich zachowania; fix: odtworzenie scenariuszy.
- medium/patch — widoki lekcji (gap/sentence/order) wołają onInteraction zamiast onEdit → editCount/editWindows zerowe dla zadań lekcji (verification-gap, pre-verified).
- medium/patch — brak testu wiązania cleanup w processDueWork (godzinny throttle, błąd nie psuje przebiegu) — retention opiera się na nietestowanym kleju (pre-verified).
- medium/patch — adapter OpenAI-compatible i sessionActivityFromEnv bez testów transportowych mimo wzorca grader.test.ts (pre-verified).
- medium/patch — brak asercji kształtu payloadu do modelu (brak attemptId, ≤200 znaków) — prywatność bez sieci regresyjnej (pre-verified).
- medium/patch — readCappedJson buforuje całe żądanie przed limitem i porównuje UTF-16 length zamiast bajtów (Content-Length precheck + Buffer.byteLength).
- medium/patch — zadanie z pendingAttemptId nie dostaje taskShown (wznowienie w trakcie processing): czas niewymierzony, próba przypisana poprzedniemu zadaniu.
- medium/patch — migracja 0021 porównuje sumy globalne ledgera/projekcji; przeciwstawny rozjazd per dziecko przechodzi (D02 wymaga porównania per child_id).
- medium/patch — raport może przypisać próbę innego zadania tej sesji; weryfikacja tylko do sesji + O(n²) (Set + sprawdzenie próba→zadanie).
- low/patch — zdublowana arytmetyka punktów (inline 60_000) zamiast sessionActivityAward; new Date() w catch not_found zamiast services.clock.now().
- low/patch — pauzy bez walidacji zakresu/kolejności w superRefine; brak kontroli duplikatów taskId.
- low/patch — pendingPause (technical_wait) domykany przy pierwszej aktywności następnego zadania — pauza w niewłaściwym zadaniu.
- low/patch — play() odrzucone po starcie zostawia wiszący odsłuch (try/finally w #playCountedAudio).
- low/patch — drabina kompakcji nie reaguje na rozmiar bajtowy i nie scala stykających się przedziałów (unia zachowana) — realny maksimum ~100 KB po drabinie wpisów, ale tania odporność.
- low/patch — SummaryScreen dubluje SessionActivityResultView; already_started bez asercji renderowania.
- low/patch — higiena: literówki („komaktuje", „kopy brak", „bazieMIGRACJI"), brak nowej linii w _journal.json, martwe wyrażenie w describeTaskPrompt.
- low/defer — playbackStarted(assetId, null) w produkcji: port AudioPlayer nie wystawia długości nagrania, przycinanie odsłuchu tylko deklaratywne (wymaga zmiany portu; odnotowane w raporcie implementacji).
- false — granularność kopii roboczej (task/pauza, nie co klawisz): projekt §4 świadomie tak stanowi i akceptuje konserwatywny brak obserwacji.
- false — already_started „ślepy" UX: projekt §4/§8 świadomie akceptuje (pierwsze żądanie dokończy; komunikat zgodny ze stanem).
- false — ujemne fromMs po regresji zegara: oba operandy pochodzą z trwałego stanu (zawsze ≥); Math.max chroni nowOffset.
- false — overflow int4 od zmodyfikowanego klienta: design §5 wprost wyklucza ochronę przed ręcznie zmodyfikowanym klientem.
- high/patch (fix podczas weryfikacji końcowej) — useChoiceKeyboard czyścił tablicę refów w efekcie po montażu; strzałki działały tylko dzięki przypadkowemu re-emitowi starego #startRewardActivity, który ta zmiana usunęła → e2e picture_recognition „strzałki przenoszą fokus" padał. Fix: przycinanie do liczby opcji zamiast czyszczenia.
- rejected (low/negligible) — zawyżony licznik czyszczenia przy wyścigu dwóch workerów; brak AbortSignal w pętli czyszczenia; brak sprzątania porzuconych kluczy kopii (kwota localStorage niezagrożona przy realnych rozmiarach).

## Verification

48 scenariuszy, polecenia, RED → GREEN i niezależny review opisuje `client-reward-time/acceptance.md`.
