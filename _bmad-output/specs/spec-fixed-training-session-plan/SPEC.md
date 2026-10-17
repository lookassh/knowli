---
id: SPEC-fixed-training-session-plan
companions:
  - session-rules.md
  - delivery.md
  - execution.md
sources:
  - ../../implementation-artifacts/spec-fixed-training-session-plan.md
  - ../../planning-artifacts/architecture-task-transition-options.md
---

# Stała lista zadań w sesji Umiem!

## Why

Dziecko czeka około 1–2 s po kliknięciu między zadaniami. Obecny trening ponownie zbiera dane i historię do wyboru każdego pytania. Właściciel wybiera listę ustaloną na początku sesji oraz dostosowanie materiału pomiędzy sesjami. Celem jest płynniejsze przechodzenie i zachowanie uczenia na podstawie rzeczywistych trudności.

## Capabilities

- **CAP-1**
  - **intent:** Dziecko rozpoczyna sesję z ustaloną listą prezentacji i pytań dobraną do dotychczasowej wiedzy.
  - **success:** Po zapisaniu planu różne wyniki odpowiedzi nie zmieniają listy ani kolejności jego przyszłych kroków; nie ma dopisywania zadań wsparcia lub awansu etapu.
- **CAP-2**
  - **intent:** Dziecko otrzymuje więcej wsparcia dla trudnego materiału w kolejnej nowej sesji.
  - **success:** Dla tego samego materiału i kontrolowanego seed historia rzeczywistych trudności prowadzi do prezentacji/łatwiejszego utrwalania, a historia opanowania do odpowiedniego sprawdzania/powtórek; pominięcia i awarie nie udają trudności z wiedzą.
- **CAP-3**
  - **intent:** Dziecko nadal otrzymuje bieżący feedback i pomoc przy aktualnym pytaniu.
  - **success:** Wynik, podpowiedź, „Nie pamiętam” i istniejące ponowienie działają w bieżącym zadaniu; nie przebudowują przyszłej listy.
- **CAP-4**
  - **intent:** Dziecko bezpiecznie wznawia sesję i przechodzi przez jej przygotowane kroki.
  - **success:** Retry, reload, restart i dwie karty zachowują identyczne wydane zadanie bez podwójnej próby/nagrody; mikrofon, limit czasu i wcześniejszy koniec mogą tylko skrócić plan.
- **CAP-5**
  - **intent:** System uczciwie odróżnia przygotowany materiał, rzeczywiste ujawnienie i samodzielną odpowiedź.
  - **success:** Niewydany slot nie tworzy ekspozycji i nie trafia do Kid DTO; każde ujawnienie poprzedza commit, a kwalifikacja próby korzysta z faktycznych ekspozycji i received_at.
- **CAP-6**
  - **intent:** Dziecko widzi reakcję na kliknięcie od razu i krócej czeka na kolejne zadanie.
  - **success:** UI utrzymuje stabilny stan oczekiwania; next nie odtwarza pełnej historii i nie wywołuje planera adaptacyjnego. Raport porównuje czas startu, next i całego przejścia przed/po, uwzględniając sieć, activity i blokady.

## Constraints

- Zakres obejmuje nowe treningi słówek standardowych/obrazkowych, oba canRead i lekcje; reguły przedmiotowe pozostają za SubjectModule.
- Zachować obecne sygnały trudności modułu, m.in. dwa błędy w zadaniu lub „Nie pamiętam”. Wsparcie planować w kolejnej sesji po ochronie należnych sprawdzeń i w dostępnym budżecie; wszystkie zaległości nie muszą mieścić się naraz.
- Zachować przypięcie materiału/polityki, blokadę sesji, idempotencję, historię i projekcje ocen/nagród. Nie tworzyć fikcyjnych sukcesów podczas planowania.
- Chronić należne sprawdzenia przed ujawnieniem celu i dystraktorów; plan nie zamraża samodzielności ani nie przewiduje upływu 300 s.
- Plan ma skończoną liczbę wszystkich kroków; dotychczasowy budżet dotyczy zadań ocenianych. Prezentacje go nie zużywają. Obietnica „Jeszcze N” i limit czasu obowiązują.
- Aktywne stare treningi kończą się dotychczasową ścieżką. Nowy plan jest trwały i niezmienny; wznowienie nie jest nową sesją.
- Obowiązują RED–GREEN–Refactor, wszystkie zielone testy przed review, jeden niezależny reviewer gpt-6.1-sol / medium naraz i cykl poprawki→testy→review do zamknięcia uwag. Commit lokalny dopiero po domknięciu zadania.
- Implementacja i review kodu rozpoczynają się dopiero na osobne polecenie właściciela. Po nim wszystkie zadania realizowane są kolejno bez dodatkowych checkpointów człowieka; pełne reguły w execution.md.

## Non-goals

- Adaptacja pytań w trakcie sesji, zmiany progów opanowania/nagród i zachowania kartkówki.
- Przesyłanie całej listy do klienta, offline, nowa infrastruktura, batchowanie activity, wydawanie next w tle lub łączenie complete+next.
- Push, PR, merge i wdrożenie w ramach uzgodnionego wykonania lokalnego.

## Success signal

Na fikcyjnej historii trudności nowa sesja zawiera łatwiejszą ścieżkę dla trudnego celu, a zapisany plan nie zmienia się po błędach w jej trakcie. Ślad next nie zawiera pełnej rekonstrukcji historii; porównywalny pomiar wykazuje spadek p95 next bez pogorszenia p95 całego przejścia. Czas startu i rozrzut pomiarów raportujemy osobno.

Reakcja UI ma cel ≤100 ms w kontrolowanym środowisku. Odbiór na urządzeniu referencyjnym wymaga osobnego dowodu; nie zastępuje go emulacja. Bez baseline nie obiecujemy absolutnego p95 całego przejścia.
