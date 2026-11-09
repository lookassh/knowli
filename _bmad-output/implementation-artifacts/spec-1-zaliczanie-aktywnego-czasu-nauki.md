---
title: 'Zaliczanie aktywnego czasu nauki'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: '324523809ff53ac583697c6f93f08acd9a79c366'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/SPEC.md'
  - '{project-root}/docs/architecture.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/activity-policy.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/acceptance-scenarios.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Obecne sesje nie rozliczają wiarygodnie aktywnej pracy dziecka. Czas raportowy jest tylko estymacją między zdarzeniami, a kliknięcia, otwarta sesja i jej zakończenie nie dowodzą wykonania kroku.

**Approach:** Dodać osobny, serwerowo rozliczany strumień krótkich odcinków aktywności powiązanych z wydanym zadaniem. Zaliczać je dopiero przy zaakceptowanym przez serwer kroku, z idempotencją, obsługą pauz/przejęcia urządzenia i chronionym odczytem faktów rozliczenia dla rodzica.

**Boundaries & Constraints**

**Always:** A1 zatwierdzone: sygnał co 15 s, potwierdzenie łączności do 30 s i bezczynność po 60 s od rzeczywistej interakcji. Heartbeat sam nie odnawia bezczynności; nie dopisujemy czasu po ostatnim potwierdzonym odcinku. Audio liczy się wyłącznie podczas faktycznego playbacku. Ciche czytanie bez interakcji może zostać wstrzymane po minucie. Pokaż pauzę neutralnie i pozwól dziecku wrócić do pracy bez utraty wcześniejszego czasu. Liczymy aktywność niezależnie od poprawności, gwiazdek, mikrofonu i kompletności sesji. Pomiń, cisza i awaria same nie zatwierdzają czasu kroku; wcześniej rozliczona praca pozostaje. Serwer wiąże sygnały z profilem, sesją, zadaniem i monotonicznym identyfikatorem; dwa urządzenia nie mogą dodać tych samych sekund. Przechowujemy wyłącznie ograniczone przedziały i powody pauzy, bez audio, surowych klawiszy ani ruchów myszy. Odczyt diagnostyczny wymaga Parent Mode. Stosuj TDD RED–GREEN, zachowaj dowód rzeczywistego RED i minimalnego GREEN oraz wykonaj niezależne review na końcu.

**Never:** Nie dodawaj w tym story punktów, salda, celu dnia, rundy, wymiany Xbox, automatycznego sterowania Xbox, oceny uczciwości ani zmiany semantyki ocen, ekspozycji, gwiazdek lub budżetu zadań. Nie używaj `estimateLearningTime` do nagród i nie zapisuj sukcesu lokalnie bez potwierdzenia serwera.

</frozen-after-approval>

## Code Map

- `packages/contracts/src/kid.ts`, `apps/web/src/kid/kid-router.ts` — kontrakty Zod i dispatch Kid API; nie ma jeszcze komend odcinków aktywności.
- `packages/kid-ui/src/session/useLearningSession.ts`, `session-controller.ts` — obsługa tła/offline oraz stany zadania, odpowiedzi i prezentacji; dodawać sygnały bez lokalnego naliczania.
- `packages/server/src/modules/attempts.ts` (`startAttempt`/finalizacja), `sessions.ts` (`completePresentation`, `lockSession`) i `events.ts` (`lockTaskWithSession`) — przyjęcie kroków, idempotencja i blokada sesji.
- `packages/server/src/db/schema.ts`, `packages/server/drizzle/` — źródło prawdy Drizzle/migracje; brak tabel odcinków. Współbieżność klientów wymaga atomowej reguły per dziecko.
- `apps/web/src/parent/parent-router.ts` — każde żądanie sprawdza Parent Mode; tu dodać ograniczony odczyt rozliczeń, bez karty dziennej (story 4).
- `packages/server/src/domain/learning-time.ts`, `modules/learning-overview.ts` — raportowa estymacja do 120 s z `estimated: true`; nie nadaje się do nagrody.
- Testy: `packages/kid-ui/src/session/session-controller.test.ts`, `tests/integration/sessions.test.ts`, `tests/integration/attempts.test.ts`; MCP `learning-overview` i skill pozostają przy estymowanym raporcie v1, bez nowego czasu nagrody.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/reward-activity.ts` — zdefiniować walidowane sygnały i DTO bez zaufanej kwoty czasu z klienta.
- [x] `packages/server/src/db/schema.ts`, nowa migracja `packages/server/drizzle/0012_reward_activity.sql` — utrwalić wersję polityki, odcinki i rozliczenia; dodać unikalność, indeksy, współbieżność i kasowanie profilu.
- [x] Nowy `packages/server/src/modules/reward-activity.ts`, `attempts.ts`, `sessions.ts`, `apps/web/src/kid/kid-router.ts` i `apps/web/src/parent/parent-router.ts` — przyjmować sygnały, rozliczać zaakceptowany krok atomowo oraz udostępniać ograniczony odczyt po Parent auth.
- [x] `packages/kid-ui/src/session/useLearningSession.ts`, `session-controller.ts`, `packages/kid-ui/src/api/KidApi.ts` — emitować sygnały; pauzować przy tle, braku fokusu/sieci, bezczynności i oczekiwaniu technicznym; obsłużyć playback i wznowienie.
- [x] `packages/server/src/domain/reward-activity.test.ts`, `tests/integration/reward-activity.test.ts`, `packages/contracts/src/reward-activity.test.ts` i testy Kid UI — pokryć retry, skip/ciszę/awarię, prezentację, dwa urządzenia, zegar, offline, podział dni, odtworzenie i kaskadę.
- [x] `docs/architecture.md` i `docs/folder-structure.md` — opisać nowy kontrakt oraz brak zmian znaczenia MCP; zweryfikować testem istniejącego klienta Streamable HTTP.

**Acceptance Criteria:**
- Given samo otwarcie/pusty przebieg, pominięcie lub ręczny koniec bez przyjętego kroku, when sesja się zamyka, then nie powstaje nowy zaliczony czas; wcześniej rozliczona praca pozostaje, a koniec sesji nie daje premii.
- Given zaakceptowana odpowiedź lub complete-presentation, when zadanie ma zatwierdzalne odcinki, then serwer rozlicza niepokrywające się sekundy raz; prezentacja nie tworzy attempt/assessment.
- Given ciszę, błąd providera albo oczekiwanie na processing, when krok nie został przyjęty, then jego niezatwierdzony czas nie trafia do sumy, a wcześniejsze rozliczenie pozostaje.
- Given tło, utratę fokusu, offline, bezczynność po 60 s lub spóźniony sygnał, when dziecko wraca do zadania, then pauza jest wyjaśniona, a czas po potwierdzonej granicy nie jest dopisywany.
- Given wolne czytanie, playback rzeczywiście trwającego audio albo wolne wpisywanie, when krok zostaje przyjęty, then brak progu szybkości/poprawności, rzeczywiste audio liczy się tylko podczas playbacku, a ciche czytanie może zapauzować się po 60 s.
- Given retry, powtórzony/cofnięty/podrobiony czas, dwa urządzenia lub jawne przejęcie pomiaru, when serwer odtwarza stan, then każda sekunda jest rozliczona najwyżej raz bez zaufania do zegara klienta.
- Given odczyt diagnostyczny bez Parent Mode albo usunięcie profilu, when serwer obsługuje żądanie, then odczyt jest odrzucony albo dane dziecka usunięte kaskadowo; po Parent Mode dostępne są tylko fakty bez surowych danych.
- Given odbudowa rozliczeń po restarcie, when serwer odtwarza trwały dziennik, then sumy są takie same, a żadne punkty ani dane materiału wspólnego nie są dodawane lub usuwane.
- Given nowy Kid/Parent API, when sprawdzana jest integracja, then MCP `learning-overview` v1, JSON Schema i skill nadal opisują tylko estymowany czas raportowy.

## Implementation Notes

Implementacja utrwala ograniczone sygnały i przedziały po stronie serwera, a rozliczenie wiąże je atomowo z zaakceptowanym zadaniem/prezentacją. Klient używa monotonicznych sekwencji w kolejce sygnałów, jawnie przejmuje strumień przy starcie, wznawia go po pauzie i wiąże playback z jednorazową autoryzacją serwera oraz długością zatwierdzonego zasobu. Odrzucone/pominięte zadanie zwalnia strumień i autoryzacje bez rozliczenia czasu. Raport rodzica wymaga Parent Mode i uwzględnia wyłącznie pauzy strumieni z rozliczonymi przedziałami. Historia jest odtwarzana z trwałego dziennika; nie zmieniono punktów, gwiazdek ani Xbox.

Ograniczenie: zdarzenie `onplaying` potwierdza stan odtwarzacza przeglądarki, lecz nie dowodzi, że dźwięk dotarł do głośnika lub dziecka. Czas audio dodatkowo ogranicza serwer do długości pliku; nie należy interpretować tego pomiaru jako dowodu uczciwości.

## Spec Change Log

## Review Triage Log

- false — Ponowienie starszego numeru sekwencji odrzucane jest celowo: UI serializuje sygnały, nie zwiększa sekwencji po błędzie transportu, a powtórzenie ostatniego zaakceptowanego sygnału zwraca ten sam wynik; test integracyjny sprawdza retry i odrzucenie sekwencji przestarzałej.
- low — Ten sam ostatni numer z inną treścią zwraca bieżący DTO, ale nie zmienia strumienia, przedziałów ani rozliczenia; obsługa wymagałaby utrwalania treści ostatniego sygnału dla przypadku, którego klient nie emituje.
- low — Ponowne użycie identyfikatora nieaktywnego strumienia w `takeover` kończy się konfliktem klucza; kontroler generuje nowe UUID dla każdego strumienia, więc nie jest to osiągalna ścieżka normalnego użycia.
- false — Przedział po przekroczeniu 30 s jest w całości odrzucany jako utracone potwierdzenie łączności, zgodnie z limitem i zakazem dopisywania czasu wstecz; test domeny potwierdza zero sekund dla późnego sygnału.
- false — Czas zasobu audio pochodzi z metadanych zapisywanych przez generator po analizie bajtów MP3 albo z ponownego odczytu tych bajtów; klient nie podaje czasu i brak prawidłowego czasu blokuje autoryzację.
- patch — Playback kończy się teraz sygnałem `playback_end` tylko po wywołaniu `onStarted`; test UI sprawdza, że odrzucenie autoplay przed startem nie emituje `playback_start` ani `playback_end`.
- false — Kolejka aktywności serializuje żądania, a zmiana zadania rozlicza/wyłącza stary strumień; odpowiedź starego strumienia nie aktualizuje stanu nowego UUID. Testy sprawdzają takeover i zmianę zadania.
- false — Wznowienie zatrzymuje istniejący timer przed ustawieniem kolejnego, a start także go zatrzymuje; wznowienie bez strumienia wraca po pojedynczym starcie.
- patch — Kontrakt odrzuca `pauseReason` poza sygnałem `pause` i zawęża `pauseReasons` DTO do enumu; test kontraktu obejmuje oba typy walidacji.
- patch — Raport zbiera powody pauz wyłącznie ze strumieni mających rozliczone przedziały; odrzucone i pominięte zadania nie zanieczyszczają faktów raportu.
- false — W typowym kliencie playback po pauzie poprzedza sygnał `interaction`; serwer dodatkowo unieważnia aktywną autoryzację i czyści `playbackStartedAt` przy pauzie. Test integracyjny sprawdza odrzucenie starego playbacku i ponowną autoryzację po wznowieniu.
- false — Opis `sameSignalAsStored` i wskazany guard nie występują w aktualnym diffie ani pliku; powtórzenie aktualnego numeru zwraca istniejący DTO, a kolejne testy nie mogą wysłać różnych danych z tego samego wywołania kontrolera.
- patch — Pauza w trakcie playbacku zamyka przedział, unieważnia autoryzację i zeruje znacznik odtwarzania; test integracyjny sprawdza pauzę, konflikt starego tokenu i możliwość nowej autoryzacji po wznowieniu.

Verification-gap review: niezależna warstwa nie mogła zostać uruchomiona z powodu limitu wątków po dwóch warstwach review. Ręcznie sprawdziłem nowy parent endpoint i cascade; test integracyjny potwierdza 401 bez Parent Mode i usunięcie wszystkich pięciu tabel aktywności przy usunięciu profilu. Inne warstwy zostały uruchomione i ich wyniki sklasyfikowano powyżej.

## Design Notes

Potencjalny czas lokalny w przeglądarce jest wyłącznie kandydatem. Rozliczenie ma wynikać z serwerowych znaczników czasu i przyjętych sygnałów przypisanych do konkretnego `taskId`; odpowiedź klienta nie może bezpośrednio podać liczby sekund. Odpowiedź w toku nie nalicza czasu oczekiwania na provider. Wspólna blokada sesji chroni kolejność zadań, ale dla wielu klientów potrzebna jest także atomowa reguła aktywnego strumienia dziecka.

## Verification

**Commands:**
- `corepack pnpm test:unit -- packages/server/src/domain/reward-activity.test.ts packages/contracts/src/reward-activity.test.ts` -- expected: reguły czasu, idempotencja i walidacja kontraktu przechodzą.
- `corepack pnpm test:integration -- tests/integration/reward-activity.test.ts` -- expected: PostgreSQL potwierdza atomowość, przejęcie urządzenia, kaskadę i retry.
- `corepack pnpm test:mcp` -- oczekiwane: istniejący klient Streamable HTTP nadal zgadza się z `learning-overview` v1.
- `corepack pnpm typecheck` oraz `corepack pnpm build` -- oczekiwane: workspace typuje się i buduje.
