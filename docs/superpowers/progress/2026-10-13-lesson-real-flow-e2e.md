# Postęp: rzeczywisty przepływ lekcji E2E

Plan: [`2026-10-13-lesson-real-flow-e2e.md`](../plans/2026-10-13-lesson-real-flow-e2e.md)

Baza: `64c42652267427d56e4d7ebea180011c4ed3b470`
Gałąź: `feature/grammar-module`; wykonanie w istniejącym checkout PR #51.

## Zakres i decyzje

- [x] Odczytano zatwierdzony plan, SPEC/architekturę dotyczącą lekcji i stan Git/PR. Brak zmian produktu; tylko nowy E2E i dokumentacja planu/postępu.
- [x] Scenariusz korzysta z istniejącego global setup i fake providerów zewnętrznych. Materiał, publikacja, przypisanie, sesja, wznowienie, próby i raport przechodzą rzeczywistą aplikacją/API. SQL służy wyłącznie do asercji odczytowych na danych testu.
- [x] Założono kontrolę bez mikrofonu w UI; odczyt `SessionDto` potwierdza `microphoneEnabled=false`.
- [x] Listę lekcji mapuje się przez `deckId` z prawdziwego DTO, nie przez stały indeks. Dla kontroli wznowienia przechwytuje się TaskDto z prawdziwej odpowiedzi `/next` i wiąże z `data-task-id`.
- [x] Po zapisaniu szkicu odczytano DTO, następnie wyszło się z edytora i otworzyło dokładnie tę lekcję ponownie przez indeks wyznaczony z listy DTO po `deckId`; pole przykładu zachowało wartość.
- [x] Panel rodzica wybiera pierwsze dziecko domyślnie. Listener progress GET jest zainstalowany przed otwarciem lekcji; zmianę wyboru wykonuje się wyłącznie, gdy wybrane ID różni się od celu.
- [x] Podsumowanie po przycisku zakończenia może mieć stan `ended` albo `completed` zgodnie z SessionSummaryDto; asercja sprawdza jeden z tych terminalnych stanów i identyfikator tej sesji.

## TDD i wykonanie

- [x] RED — tymczasowe `renderCard(...).examples = []` sprawiło, że test nie znalazł zatwierdzonego przykładu w Kid UI. Dowód: ignorowany lokalny `.superpowers/sdd/2026-10-13-lesson-real-flow-e2e/red-examples.log`. Mutacja została cofnięta; plik produkcyjny ma czysty diff.
- [x] RED — tymczasowe `independent: true` w zapisie wspomaganej odpowiedzi sprawiło, że asercja objective assessment oczekująca `independent=false` zawiodła. Dowód: `red-independent.log`. Mutacja cofnięta; brak diffu produkcyjnego.
- [x] Pierwsze wykonanie już istniejącego zachowania było GREEN; test rozszerzono z kolejnymi asercjami i ponownie uruchomiono.
- [x] Niezależny przegląd wskazał brak kolumny `assessments.id`; schema ma klucz `(attempt_id, skill)`. Test wykonał RED na błędnym zapytaniu, potem licznik poprawiono do klucza złożonego i filtra niepustej próby.
- [x] Walidacja końca sesji pokazała zgodny z kontraktem stan `completed` przy wyczerpaniu ćwiczeń. Asercję zawężono do `ended | completed`, zamiast wymuszać wyłącznie `ended`.
- [x] Po „Nie pamiętam” weryfikowane są `taskId`, `modality`, `taskState`, feedback `incorrect`, odpowiedź poprawna i widoczny komunikat trudności. Po zakończeniu odczytywane są ponownie liczby prób i ocen wcześniejszych prób guided.

## Sprawdzenia

- [x] Celowany test końcowej wersji: 1/1 GREEN; wynik potwierdzony z bieżącego wyjścia Playwright.
- [x] Powtórzenie końcowej wersji 3 razy (`--repeat-each=3 --retries=0`): 3/3 GREEN, `repeat-final.log`.
- [x] Specy lekcji: 18/18 GREEN (`lesson-specs.log`).
- [x] Pełny Playwright E2E: 149/149 GREEN (`full-e2e.log`) przed ostatnimi rozszerzeniami asercji w tym samym pliku.
- [x] `corepack pnpm typecheck` przechodzi po rozszerzeniu końcowych asercji.
- [x] Pełny E2E końcowej wersji: 149/149 GREEN, `full-e2e-final.log`.
- [x] Końcowy `git diff --cached --check`: GREEN; staged scope obejmuje plan, dziennik i jeden test E2E.
- [ ] Wysłanie zmiany i aktualizacja PR #51: końcowy krok; bez scalania.

## Review

- [x] Dedykowany niezależny recenzent `gpt-6.1-sol` xhigh sprawdził test, mutacje i zakres od BASE. Pierwsze uwagi dotyczyły wyścigu parent GET, dokładnej listy przykładów, licznika prób i zakończenia sesji; wprowadzono korekty opisane powyżej.
- [x] Potwierdzenie recenzenta dla ostatecznej wersji z ponownym otwarciem edytora: Critical 0, Important 0, Minor 0; finalna rekomendacja: po końcowej weryfikacji uruchomień.
- [x] Wpływ API → MCP → skill: brak. Zmiana dotyczy wyłącznie E2E i dokumentacji; nie zmienia kontraktu API ani learning-overview.
