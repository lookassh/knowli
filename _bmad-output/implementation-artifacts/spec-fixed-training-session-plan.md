---
title: 'Stały plan nauki przygotowany przy rozpoczęciu sesji'
type: 'refactor'
created: '2026-10-17'
status: 'draft'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

## Decyzja właściciela

„Wystarczy dostosowanie kolejnej sesji”. Zmieniamy model treningu: wyniki są zapisywane i oceniane od razu, ale dobór kolejnych pytań aktualizuje się dopiero w nowej sesji. To decyzja produktowa; poniższe szczegóły wykonania są projektem do zatwierdzenia.

## Zachowanie

- Start sesji odczytuje historię i przygotowuje skończony, prywatny plan: wersja formatu, przypięty materiał/polityka, kroki z typem ćwiczenia, promptem, opcjami, kluczem i mediami. Zapis jest atomowy z utworzeniem sesji.
- Plan obejmuje prezentacje i pytania. Zadania należnych samodzielnych sprawdzeń poprzedzają ujawnienia ich celów, również jako dystraktorów. Terminy i gotowość etapów planujemy na podstawie startowej wiedzy, bez symulowania poprawnych odpowiedzi dziecka. Czas przyszłej odpowiedzi nie jest przewidywany jako dowód samodzielności.
- Nowy materiał może mieć z góry przewidzianą prezentację i utrwalanie. Wynik pytania nie wstawia dodatkowego wsparcia, nie zmienia trudności i nie awansuje etapu w pozostałej części tej sesji.
- Obecny feedback, jawna podpowiedź i ponowienie wewnątrz tego samego zadania pozostają. „Nie pamiętam” ujawnia rozwiązanie zgodnie z protokołem bieżącego zadania. Potrzeba dodatkowych ćwiczeń trafia do planu następnej sesji.
- Next odczytuje aktualny krok i wydaje go idempotentnie. Wydane zadanie i ekspozycje zapisuje przed zwrotem treści. Planowanie nie tworzy ekspozycji i nie wysyła ukrytych kroków do klienta.
- Kwalifikacja próby, ostatnie ujawnienia i ocena opierają się na rzeczywistym received_at. Plan nie gwarantuje z góry niezależności odpowiedzi.
- Wyłączenie mikrofonu pomija przyszłe niewykonalne kroki bez kary i bez nowych zadań zastępczych. Wcześniejsze zakończenie i limit czasu mogą skrócić sesję. Obietnica „Jeszcze N” i istniejące limity nadal obowiązują.
- Reload i druga karta używają tej samej listy i bieżącego zadania; nowa sesja jest planowana z uwzględnieniem ostatnich wyników. Samo wznowienie nie przebudowuje listy.

## Plan implementacji

1. `packages/server/src/domain/training-session-plan.ts` (nowy): czysty planer słówek z danych startowych i seed. Wykorzystać reguły wyboru celów, dostępności, miksu i ochrony ekspozycji z `scheduler.ts`; oddzielić statystykę zaplanowanych kroków od rzeczywistej wiedzy. Nie uruchamiać starego selektora w pętli z fikcyjnymi ocenami.
2. `packages/server/src/modules/lessons/lesson-sessions.ts`: równoważne przygotowanie planu lekcji z reguł przedmiotowych. Wspólny protokół planu nie przenosi logiki przedmiotu do silnika.
3. `packages/server/src/db/schema.ts`, przeglądana migracja w `packages/server/drizzle/`: prywatny, wersjonowany plan treningu w sesji z niezmiennością po zapisie. Nie rozszerzać semantyki mock_test_plan na trening wbrew obecnym ograniczeniom bazy. Brak nagrań i sekretów w planie.
4. `packages/server/src/modules/sessions.ts`: start zbiera dane raz, zapisuje plan; next wydaje istniejący slot bez planNextTask i rekonstrukcji historii. Model kartkówki służy jako wzorzec, bez kopiowania odczytów N+1. Zachować blokadę sesji i ograniczenie jednego issued.
5. Aktywne treningi sprzed wdrożenia kończą się starym protokołem; nowe otrzymują plan. Nie przepisywać rozpoczętych zadań ani dawnych ocen. Kartkówki zachowują własne zasady.
6. `packages/kid-ui/src/session/session-controller.ts`, `screens/LearnScreen.tsx`, `styles.css`: natychmiastowy, stabilny stan oczekiwania i neutralny wybór; aktualna liczba pozostałych pytań uwzględnia pominięte niewykonalne sloty. Dostosować kontrakty w `packages/contracts/src/kid.ts` tylko w zakresie wymaganym do prezentacji tego stanu.
7. `docs/SPEC.md`, `docs/architecture.md`, `docs/implementation-plan.md`: zastąpić wymagania adaptacji wewnątrz treningu nowymi zasadami, opisać start, wznowienie, wyjątki i wdrożenie. Sprawdzić API → MCP → skill; raport nadal przedstawia rzeczywiste wyniki, a nie plan jako odbytą naukę.

## Kryteria akceptacji

- Given ten sam zapisany plan, when odpowiedzi w sesji różnią się poprawnością, then lista i kolejność przyszłych kroków pozostają takie same; różnią się feedback i historia.
- Given różna historia zakończonych wyników, when zaczyna się nowa sesja, then planer uwzględnia te wyniki w wyborze materiału i trudności.
- Given istniejący plan, when next wydaje kolejne zadanie, then nie pobiera całej historii, nie wywołuje adaptacyjnego planera i nie wykonuje LLM.
- Given retry, reload lub dwie karty, when żądają tego samego kroku, then wraca to samo zadanie, bez podwójnego rozliczenia.
- Given przygotowane niewydane sloty, when start zakończy się powodzeniem, then brak ekspozycji tych slotów i brak ich treści w Kid DTO.
- Given nowe ujawnienie odpowiedzi, when nastąpi późniejsza próba, then niezależność wynika z faktycznych ekspozycji i zegara.
- Given mikrofon zostanie wyłączony, when plan zawiera mowę, then niewykonalne kroki są pomijane bez nowych pytań i kary za wiedzę.

## Weryfikacja

Przy implementacji: testy jednostkowe planera oraz kolejności niezależnej od odpowiedzi; PostgreSQL dla atomowości, immutability, retry, ekspozycji i nagród; e2e słówek i lekcji dla stałej sekwencji, reload i mikrofonu; typecheck/build; niezależne review. Zmierzyć osobno start, next, zapisy aktywności i blokady na tej samej historii/instancji przed i po zmianie. Nie deklarować usunięcia 1–2 s bez pomiaru: przygotowany plan nie eliminuje transportu activity.

## Stan

Wybrany kierunek architektoniczny; kod niezmieniony. Plan zastępuje spec-task-transition-solution.md. Nie zawiera batchowania activity ani wydawania następnego zadania w tle.
