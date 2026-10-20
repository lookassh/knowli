# Migracja i mapa usuwania starego systemu

Uzupełnia [specyfikację](../spec-client-reward-time.md) i [projekt](design.md). Przygotowanie migracji jest w zakresie implementacji; produkcyjne wykonanie wymaga osobnego polecenia.

## 1. Fakty z obecnego kodu

- `schema.ts`: 37 tabel aplikacji, w tym 10 tabel pomiaru/nagród.
- `reward-activity.ts`: pomiar, rozliczenia, trzy projekcje, rezerwacje Xbox, odbudowa i raporty w jednym module.
- `parent-work-card.ts` czyta bezpośrednio segmenty; samo DROP zepsuje Kartę pracy.
- `kid.ts` pobiera salda profilu, dzienne pakiety i punkty zestawów z projekcji.
- `sessions.ts:endSession` pobiera starą nagrodę przed zamknięciem; zwykły trening ponownie wykorzystuje `context.summary`.
- `session-controller.ts:#finishSession` ponawia całe zakończenie. Cztery inne ścieżki zamykają sesję bez tego ekranu.
- Speech i grader lekcji mają próby processing. Należy zamrozić fakty dopiero po zakończeniu przyjmowanej próby albo wykluczyć technicznie niedokończoną, bez oczekiwania na nią w nieskończoność.
- Dla kartkówek istnieją osobne zamknięcia i ekrany: słówkowy i lekcyjny. Wszystkie muszą otrzymać nowy wynik nagrody.
- `LocalPreferences` przechowuje ustawienia urządzenia; potrzebny osobny mały magazyn roboczego raportu.
- Migracje chronią `mockTestReport`, `lessonMockTestReport` i `training_plan`. Nie zmieniamy ich przy aktualizacji oceny czasu.

To mapa aktualnego checkoutu, a nie deklaracja przejścia testów produkcyjnych.

Aktualizacja bazy przekazania: main `b0abfca3451e41993e6c4166b2bbf406c4404dee` zawiera #101 i migrację `0020_deck_session_task_budget.sql`. Nową migrację dodaj po aktualnym końcu dziennika; zachowaj konfigurowalny budżet i skalowany limit sesji. Nie używaj bez weryfikacji numerów linii ze starszego rozpoznania.

## 2. Docelowa baza

Dedykowane tabele nagród: **10 → 0**. Nowe pola w profilu i sesji są opisane w projekcie. Liczba tabel całej aplikacji w tym zakresie: **37 → 27**.

Trwały licznik profilu zachowuje dotychczasowe `earnedPoints`, a nie saldo pomniejszone przez Xbox. Odebrane nagrody niczego już nie odejmują. Oczekujące/odrzucone zgłoszenia nie blokują punktów. Zachowujemy resztę milisekund z dotychczasowego naliczania, bez jej zaokrąglania w dół.

Nie przenosimy dziennych bloków, historii pauz, rozliczeń minut ani punktów zestawów do nowej tabeli. Od tej wersji jest ogólny dorobek dziecka. Stare sesje nie dostają wygenerowanych wstecz ocen LLM.

## 3. Kolejność migracji danych

1. Zatrzymać stare procesy zapisujące przed właściwym wdrożeniem. Nowa wersja i stare zapisy nie mogą działać równolegle po DROP.
2. Zweryfikować backup bazy/mediów i możliwość jego odtworzenia. Zapisać zestaw kontrolny: liczby profili, prób, ocen, sesji, dorobek i reszty każdego profilu.
3. Dodać pola profilu/sesji i ograniczenia. Profile bez historii dostają 0 punktów i 0 reszty.
4. Zestawić sumę `awarded_points` z ledgerem oraz `earned_points` projekcji. Przy różnicy przerwać migrację z kontrolowanym błędem; nie wybrać arbitralnie salda i nie DROPować danych.
5. Przenieść zgodne sumy i reszty do profili. Nie przeliczać historycznych punktów od całego czasu: stara migracja świadomie nie naliczała nagród wstecz.
6. Wykonać asercje: każdy profil zachowuje dorobek, reszta mieści się w 0..59999, sumy kontrolne są zgodne.
7. Usunąć historyczne pola nagrodowe z niechronionego `context.summary.reward`, bez zmiany wyników wiedzy. Upewnić się, że żaden chroniony raport kartkówki nie jest modyfikowany.
8. Usunąć tabele w kolejności zależności poniżej, bez szerokiego `DROP CASCADE`.
9. Zachować migracje 0012–0019 jako historię instalacji. Dopisać nową migrację, dziennik i snapshot Drizzle; nie usuwać starych plików SQL.
10. Po starcie nowego web/worker odświeżyć otwarte karty i PWA; stare żądania pomiaru mają czytelny błąd wymogu aktualizacji.
11. Sprawdzić profile, rozpoczęcie nauki, koniec treningu/kartkówki, nową ocenę i punkty. Nie uruchamiać masowych ocen historycznych.

Nowa wersja pomiaru jest przypięta w kontekście nowych sesji. Legacy sesja nie może zostać rozliczona jeszcze raz nowym mechanizmem.

## 4. Dziesięć tabel do usunięcia

| Kolejność | Tabela | Los danych |
|---|---|---|
| 1 | reward_activity_xbox_requests | usuwamy zgłoszenia i decyzje |
| 2 | reward_activity_xbox_blocks | usuwamy uprawnienia/pakiety |
| 3 | reward_activity_segments | usuwamy szczegółowe odcinki |
| 4 | reward_activity_pauses | usuwamy historię pauz |
| 5 | reward_activity_playback_authorizations | usuwamy autoryzacje pomiaru |
| 6 | reward_activity_streams | usuwamy protokół aktywności |
| 7 | reward_activity_settlements | po przeniesieniu dorobku usuwamy ledger |
| 8 | deck_reward_projection | usuwamy naliczenia per zestaw |
| 9 | reward_day_projection | usuwamy rozliczenia dzienne |
| 10 | child_reward_projection | po przeniesieniu licznika/reszty usuwamy projekcję |

Przed zatwierdzeniem SQL sprawdzić rzeczywiste FK i zależne indeksy/funkcje. Nie usuwamy tabel prób, ocen, wydarzeń ani postępu.

## 5. Mapa kodu

| Plik/obszar | Działanie |
|---|---|
| contracts/src/kid.ts | nowy raport końca sesji i mały wynik, usunięcie Xbox/sald/dziennych bloków; punkty ogólne profilu |
| contracts/src/reward-activity.ts | zastąpienie kontraktami raportu sesji, bez sygnałów i playback authorization |
| contracts/src/parent-work-card.ts | usunięcie Xbox, podsumowanie sesji i opcjonalne szczegóły z retencją |
| contracts/src/messages.ts | teksty wyniku/błędu, usunięcie komunikatów Xbox/pakietów |
| kid-ui/src/session/session-controller.ts | lokalny reporter i zamrożenie raportu; usunięcie activity stream, timerów sieciowych i kolejki sygnałów |
| kid-ui/src/KidApp.tsx | przekazanie lifecycle do reportera; brak sieciowych heartbeatów |
| kid-ui/src/storage.ts | pozostaje portem preferencji; osobny SessionActivityDraftStore w nowym pliku |
| kid-ui/src/api/KidApi.ts, client.ts | raport przy końcu, odczyt istniejącego wyniku; usunięcie Xbox/measurement endpoints |
| kid-ui/src/screens/ProfileScreen.tsx | jeden ogólny licznik punktów, bez salda, celów dnia i pakietów |
| kid-ui/src/screens/DeckScreen.tsx | usunięcie punktów konkretnego zestawu, zachowanie gwiazdek postępu i szacunku aktywności |
| SummaryScreen, MockTestSummaryScreen, LessonMockTestSummaryScreen | wspólny mały wynik punktowy/błąd, zachowane wyniki nauki |
| apps/web/src/kid/kid-router.ts | obsługa raportu, usunięcie stream/playback/Xbox |
| apps/web/src/parent/parent-router.ts | usunąć decyzje Xbox i stary reward-activity |
| apps/web/src/parent/WorkCardPanel.tsx | nowa karta wyniku sesji i rozwinięcie szczegółów do 7 dni |
| server/src/modules/sessions.ts | oddzielić zamknięcie wiedzy od oceny aktywności; nie trzymać transakcji podczas LLM |
| server/src/modules/attempts.ts, speech.ts, lessons/lesson-attempts.ts | usunąć settle/discard reward per krok, zachować oceny i ekspozycje |
| server/src/modules/reward-activity.ts | usunąć dotychczasowy moduł po przepięciu wszystkich odbiorców |
| server/src/modules/parent-work-card.ts | czytać nowy wynik, nie segmenty; starszy czas nagrodowy nie jest rekonstruowany |
| server/src/modules/kid.ts | punkty z profilu; usunąć snapshoty/projekcje nagród |
| server/src/modules/progress-rebuild.ts | usunąć tylko ewentualne zależności nagrodowe; nie naruszać odbudowy postępu wiedzy |
| server/src/ports/ai.ts, config.ts, index.ts | wąski port oceny sesji i składanie zależności |
| server/src/providers/openai-compatible/session-activity.ts | osobny prompt i walidacja odpowiedzi, wspólny transport połączenia |
| apps/web/src/composition.ts | dostępność modelu w web i fake w testach |
| apps/worker/src/tasks.ts | ograniczone okresowe czyszczenie raportów |
| db/schema.ts, drizzle/, meta/ | nowe pola, DROP tabel, zgodne metadane |
| docs/SPEC.md, architecture.md, AGENTS.md | nowe zasady danych wysyłanych do modelu, zakres retencji i rzeczywisty pomiar |

Nie zostawiać historycznych metod jako nieużywanego API.

## 6. Raporty po migracji

Nowe sesje pokazują czas obliczony przez kod po wykluczeniu zadań wskazanych przez LLM oraz ocenę z nowych pól. Stare sesje zachowują pytania/odpowiedzi i wynik wiedzy; nowy zatwierdzony czas jest niedostępny, a nie 0 sekund.

Karta pracy przestaje zależeć od segmentów i zgłoszeń Xbox. Suma zatwierdzonego czasu obejmuje ocenione nowe sesje zakończone w danym lokalnym dniu, a obok pozostaje liczba sesji bez oceny. Nie zamieniać braku wyniku w potwierdzenie braku nauki.

MCP/Hermes i dzisiejszy szacunek aktywności na liście zestawów mają własne źródło. Nie podmieniamy go bez zmiany kontraktu. W testach potwierdzić brak importów tabel nagród, zachowany vocabulary-only oraz oznaczenie czasu jako estimated.

## 7. Odwracalność i warunki wdrożenia

Przed wykonaniem DROP można cofnąć transakcję migracji. Po usunięciu starej historii nagród powrót do starej wersji wymaga odtworzenia backupu; sam checkout poprzedniego kodu nie wystarczy. Odtworzenie starszego backupu po nowej nauce może utracić nowe próby: wymaga osobnej decyzji właściciela.

Implementacja przygotuje i sprawdzi migrację na fikcyjnej bazie. Nie wykona backupu/restore ani DROP na produkcji i nie uzna lokalnych testów za dowód poprawnego wdrożenia.
