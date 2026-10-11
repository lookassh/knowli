# Redesign Kid UI — Skupienie i Karty zestawów

**Status:** Kierunek wizualny zatwierdzony w rozmowie 2026-10-11. Ten zapis i plan implementacji są przekazane właścicielowi do przeczytania przed wykonaniem. Zapisanie dokumentów nie oznacza rozpoczęcia implementacji.

## 1. Cel i granice

Dziecko wykonuje typowe zadanie i przechodzi przez jego wynik na Galaxy S25 w pionie bez przewijania strony. Interfejs ma wyglądać jak spójna aplikacja: jeden krok, czytelna instrukcja, przewidywalne miejsce działania oraz poprawny feedback. Ekran wyboru materiału otrzymuje zaakceptowane Karty zestawów.

Zakres obejmuje osiem rodzajów `TaskDto.prompt.kind`: `exposure`, `listening`, `reading`, `reverse_recognition`, `recall`, `spelling`, `letter_completion`, `speech`; ich stany wsparcia, ujawnienia, wyniku, przetwarzania i awarii; oraz `DeckScreen`. Wspólne kolory i kontrolki obejmują również istniejące ekrany profilu, rozpoczęcia kartkówki, konfliktu i podsumowań, aby nowe style nie pogorszyły tych przejść. Nie projektujemy dla nich nowych przepływów ani nowych raportów.

Bez zmian publicznego Kid API, schematu bazy, ocen, harmonogramu, ekspozycji, reguł kartkówki, liczby zadań, providerów i panelu rodzica. Bez Androida, przełącznika motywu/języka, dodatkowej gamifikacji i nowych zależności produkcyjnych. Nagrania pozostają krótkotrwałe w pamięci.

Aktualna baza planowania: `main` i `origin/main` na `3efdc168181d1922cadcf8c0042dbdb548d6ba7b`. Ustawienie `recordingMode` pochodzi już z profilu dziecka (#40); redesign ma je zachować. Implementer ponownie sprawdza Git przed wykonaniem.

## 2. Zatwierdzony wygląd

- Niebieskie Skupienie, jasny/ciemny motyw zgodny z preferencją systemową. Zieleń oznacza poprawny wynik; bursztyn wsparcie; neutralny kolor brak oceny. Kolor główny jest decyzją projektową, bez twierdzenia o przewadze naukowej.
- Pod nagłówkiem/postępem jest osobny wiersz instrukcji: ikona i treść, bez prostokątnego tła, ramki i kolorowego paska. Materiał zadania jest w oddzielnej części ekranu.
- Duży odsłuch w zadaniu słuchowym to okrągły przycisk z ikoną głośnika bez widocznego napisu. Ma polską dostępną nazwę. Odsłuchy słowa i przykładu pozostają przypisane do odpowiedniej treści.
- Sukces: ciemny tekst na jasnej powierzchni w motywie jasnym / jasny tekst na ciemnej w ciemnym, większe „Świetnie!”, wyraźny znak ✓ i zielone oznaczenie poprawnej opcji. Zablokowana poprawna/błędna odpowiedź nadal jest czytelna; nie stosujemy do niej globalnej przezroczystości disabled.
- Systemowe SVG ikon w kodzie pakietu zamiast emoji głośnika/mikrofonu. Obrazki i deterministyczne symbole są materiałem dydaktycznym, nie ikonami sterowania.

Tokeny bazowe (jasny / ciemny): tło `#f6f8fd / #182134`, powierzchnia `#ffffff / #253049`, tekst `#202c45 / #f1f5ff`, tekst pomocniczy `#596982 / #bdc9df`, akcent `#3855ca / #aec0ff`, tekst na akcencie `#ffffff / #18244a`, obramowanie `#dae2f0 / #455370`, delikatny akcent `#e9eefb / #303f64`, sukces `#196044 / #a1e0ba`, powierzchnia sukcesu `#e6f3e9 / #214b36`, wsparcie `#fbefd8 / #493f2b`, tekst wsparcia `#78521d / #f3d8a4`.

Wyjściowa skala: tekst zadania 16–20 CSS px, słowo 30–43 px, instrukcja 16–17 px, etykiety pomocnicze minimum 12 px. Kontrolki mają cele dotykowe minimum 44 × 44 CSS px; główna akcja minimum 52 px wysokości. Odstępy 8/12/16/24 px, promienie 12/16/24 px, głośnik około 96 px z ikoną około 48 px. Rozmiar słowa może dostosować się do długości i wysokości, ale nie kosztem czytelności albo usuwania treści. Kontrast normalnego tekstu minimum 4,5:1, dużego tekstu i istotnych elementów graficznych minimum 3:1; sprawdzić także stany focus/disabled.

Referencje zatwierdzone w rozmowie: makieta zadań `umiem-skupienie-v4.html` oraz pierwszy wariant „Karty zestawów” w `umiem-co-dzis-robimy.html`. Ich lokalne egzemplarze są w katalogu wizualizacji tego czatu `C:/Users/looka/.codex/visualizations/2026/10/11/01a129fc-7484-75e1-9c13-18001949f850/`. To pomocnicze, interaktywne szkice; nie są kodem aplikacji ani zależnością wykonania. Ten dokument przenosi wymagania również do innych checkoutów. Przykładowe wartości postępu, obraz kota, paski przeglądarki oraz symulacje API z makiet nie trafiają do produkcji.

## 3. Rama sesji i wysokość ekranu

Sesja ma cztery obszary: nagłówek z prawdziwą pozostałą liczbą zadań i zakończeniem; instrukcję; elastyczną część materiału/odpowiedzi; strefę wyników i działań. Materiał ustępuje miejsca feedbackowi, a przycisk następnego kroku jest dostępny bez szukania. Nie dokładamy drugiej dużej karty pod całym zadaniem.

Rama korzysta z dynamicznej wysokości viewportu, a po otwarciu klawiatury z dostępnego prostokąta `visualViewport`, gdy przeglądarka go udostępnia. Obsługuje również `offsetTop`, resize, zmianę orientacji, paski przeglądarki i bezpieczne odstępy systemowe. Bez `visualViewport` działa przez CSS `100dvh` i bezpieczny fallback. Rejestrowane listenery są zwalniane; SSR nie odwołuje się do `window` w renderze serwera.

Zmiana viewportu nie remountuje pól ani przycisku nagrywania. Nie gubi wpisu, zaznaczenia, focusu, trybu profilu ani nagrania. Nie blokuje przewijania globalnego `body` dla wszystkich tras; rodzic i długie raporty zachowują naturalną dostępność treści.

Nagłówek pokazuje istniejący komunikat `remainingFor(task)`. Jeśli dodajemy pasek, obliczamy go wyłącznie z `task.remainingAssessed` i `session.taskBudget`: przed odpowiedzią bieżące zadanie pozostaje w liczbie pozostałych; prezentacja nie zużywa budżetu. Dla braku zadania pasek jest pomijany; nie używamy przykładowych „40%” ani stałego „Jeszcze 3”.

Typowe zadania przy standardowej wielkości tekstu muszą mieścić się w dostępnej części telefonu. Przy maksymalnie długich danych, powiększonym tekście, bardzo małej wysokości lub orientacji poziomej priorytetem jest dostępność: kontrolowane przewijanie szczegółów i widoczna główna akcja, bez clippingu, ellipsis usuwającego odpowiedź i bez zmniejszania tekstu do nieczytelności. Raporty/listy podsumowań mogą przewijać się normalnie.

Pinch-zoom jest odrębnym przypadkiem: `visualViewport.scale > 1.01` przełącza ramę sesji w naturalny flow dokumentu, bez ponownego skalowania wysokości/offsetu i bez blokady scroll/panning. Wszystkie treści i działania pozostają osiągalne przez normalne przewijanie powiększonego widoku; nie obiecujemy ich jednoczesnej widoczności przy powiększeniu gestem. Po powrocie do scale ≤ 1.01 wraca rama sesji, bez remountu i utraty wpisu. Próg odróżnia drobne odchylenia pomiaru od powiększenia. Brak/niepoprawne scale traktujemy jako 1.

## 4. Ćwiczenia i informacje zwrotne

| Rodzaj | Instrukcja | Materiał i działania |
| --- | --- | --- |
| exposure | Poznaj nowe słowo | Zatwierdzony obraz/symbol, cel i odsłuch, źródło, istniejący przykład i jego odsłuch, „Rozumiem”. |
| listening | Posłuchaj i wybierz | Głośnik, niezmienione opcje serwera; bez tekstu celu i obrazka zdradzającego rozwiązanie. |
| reading | Wybierz znaczenie słowa | Tekst celu i opcje serwera. |
| reverse_recognition | Wybierz angielskie słowo | Polski prompt i opcje serwera. |
| recall | Jak jest po angielsku? | Prompt, pole, „Sprawdź”, istniejąca możliwość mowy, „Nie pamiętam — pokaż”, „Pomiń”. |
| spelling | Napisz po angielsku | Prompt, pole i akcje; brak odpowiedzi głosowej. |
| letter_completion | Uzupełnij litery | Prompt, niezmienne litery i edytowalne luki, „Sprawdź”, wsparcie/pominięcie. |
| speech | Powiedz na głos | Istniejący obraz/symbol i tekst, odsłuch, nagrywanie zgodne z `recordingMode`, pominięcie. |

Obraz i symbol występują wyłącznie w rodzajach wspierających je w obecnym kontrakcie (`exposure`, `speech`). Zachowujemy `Visual` i `imageAssetId`: brak/błąd obrazu nie blokuje akcji; liczby, kolory i sekwencje pozostają deterministyczne. Nie dopisujemy nowej pomocy do samodzielnego pytania.

Wszystkie przyciski nadal wywołują istniejące `ExerciseHandlers` i kontroler. `complete-presentation` pozostaje jedyną akcją zamykającą exposure. Odsłuch, ujawnienie i retry przechodzą przez obecną autoryzację ekspozycji. Nie ukrywamy żadnej opcji odpowiedzi ani istotnej informacji po to, by zmieścić zadanie.

Feedback wyboru/pisma jest osadzony w strefie wyniku; w miejscu dotychczasowego dialogu pisma również pozostaje w ramie. Na czas feedbacku pole pisemne traci focus, żeby zwolnić klawiaturę, a uwaga przechodzi na dostępny wynik bez wymuszonego scrollowania całej strony. Nie powstaje dodatkowa próba wskutek zmiany layoutu/focusu. Poprawność i teksty pochodzą z obecnego DTO oraz mapowania domenowego; `content_matched`/`not_assessed` nie dostają „Świetnie!”.

Wynik mowy używa istniejącego `describeSpeechFeedback`, pewnego `heardText`, wzorca, fragmentów, legendy i rozdzielenia treści od wymowy. Zachowuje aktualną semantykę: serwerowe `great`/`capitalization_hint` może mieć pozytywny komunikat/ton dla ocenionej treści także przy niedostępnej ocenie wymowy, z osobnym komunikatem tej awarii. `content_matched` z pewnym dopasowaniem speech może mieć obecny pozytywny ton treści i tekst „To właściwe słowo.”, ale nie dostaje „Świetnie!” ani informacji o poprawnej wymowie. Nie zmieniamy tych reguł w redesignie. Zastępuje centralny materiał zadania, gdy jego pełne powtórzenie nie jest potrzebne; jego działania mieszczą się w stałej strefie. Długie wyjaśnienia przewijają się wewnątrz przeznaczonej części, bez zasłaniania przycisków. Nie przywracamy wyboru trybu nagrywania przez dziecko.

Przetwarzanie, brak sieci, odmowa mikrofonu i niepewne STT są neutralnymi stanami z dostępnym następnym działaniem. Błąd odtworzenia wzorca lub oceny wymowy nie zmienia wcześniej ocenionej poprawnej treści w nieocenioną/błędną. Tryb `mock_test` zachowuje „Odpowiedź zapisana” i wyniki dopiero na końcu; nie pokazujemy natychmiastowego podświetlenia poprawnej odpowiedzi.

## 5. Co dziś robimy? — Karty zestawów

Nagłówek: Umiem! i istniejąca Strefa rodzica. Następnie powitanie i „Co dziś robimy?”. Polecane materiały odpowiadają wyłącznie `deck.recommended`, pozostałe nadal są dostępne.

Jedna karta grupuje tytuł, liczbę słów, przypominanie samodzielne, datę i akcje danego zestawu. Wyraźna niebieska akcja „Ucz się” wywołuje `onStart(deckId)`; drugorzędna „Próbna kartkówka” wywołuje `onMockTest(deckId)` i istnieje tylko dla `mockTestAvailable` oraz przekazanego handlera. Nie otaczamy obu przycisków innym przyciskiem/klikalną kartą. Zachowujemy wznowienie/konflikt aktywnej sesji obsługiwane przez kontroler.

Data jest kalendarzową datą przypisania, np. „Sprawdzian: 23 paź”, a nie UTC instantem. Nie może przesunąć dnia w innej strefie. Bieżący rok pomijamy, inny pokazujemy; wartość null pomija etykietę. Niepoprawna wartość nie może wywrócić ekranu. Liczba samodzielnych przypomnień ma dotychczasowe znaczenie; nie nazywamy jej łącznym opanowaniem wszystkich umiejętności.

Dla 1–2 zestawów typowa karta jest widoczna bez przewijania. Przy większej liczbie zestawów korzystamy z paginacji małych porcji: jedna karta na stronę w widoku telefonu z nawigacją poprzednia/następna i liczbą stron. Zachowujemy porządek: polecane, potem pozostałe, oraz kolejność API w grupie. Żaden zestaw nie znika. Długa nazwa/powiększenie ma bezpieczny fallback dostępności; nie ucinamy nazwy bez możliwości odczytania całości. Zmiana danych ponownie ogranicza bieżącą stronę do prawidłowego zakresu.

Mikrofon to dostępny przełącznik w stałej dolnej części: istniejąca preferencja włączenia, tekst objaśniający działanie bez nagrywania i odmowa uprawnienia. Nie myli się z ustawieniem `recordingMode` rodzica. Strefa rodzica zachowuje realny link i serwerowe zabezpieczenia; makieta nie zastępuje autoryzacji.

## 6. Dowody odbioru

- Automatyczny layout: wszystkie 8 rodzajów, jasny/ciemny motyw, `360×640`, `390×700`, `412×760` CSS px (dostępne viewporty testowe, nie deklarowane parametry S25), tablet `768×1024`, desktop `1440×900`. Dla standardowych fixtures: brak przewijania dokumentu i nachodzenia instrukcji/materiału/wyniku/akcji; główna akcja jest w widocznym prostokącie i da się ją nacisnąć.
- Osobne fixtures: pisanie i luki przy dostępnej wysokości 350 px, długie słowo do obecnego limitu 120 znaków, przykład 300 znaków, zawijane opcje, wiele fragmentów mowy, 0/1/2/4 zestawy, brak daty/obrazu, niedostępna kartkówka i mikrofon, powiększony tekst 200%. Wyjątki sprawdzają pełną dostępność treści oraz działań, nie sztuczne zero scrolla.
- Testowe DTO/fake-adaptery służą deterministycznej macierzy UI; istniejące testy z PostgreSQL i prawdziwym routingiem potwierdzają naukę, retry, disclosure, kartkówkę, wznowienie, odmowę mikrofonu i offline. Testy layoutu nie zastępują tych regresji.
- Osobny zapis z fizycznego Galaxy S25: rzeczywisty `innerWidth/innerHeight`, `visualViewport.height/offsetTop/scale`, pinch-zoom 1×/2× i powrót oraz osobno rozmiar tekstu, przeglądarka z paskami pokazanymi/schowanymi, PWA standalone, klawiatura w recall/spelling/lukach, hold/toggle, poprawna i błędna odpowiedź. Weryfikacja nie wymaga zapisywania ani wysyłania prywatnego nagrania dziecka; można użyć syntetycznego materiału i głosu dorosłego.
- Brak urządzenia lub dowodu PWA jest opisanym brakiem odbioru, nie sukcesem wywnioskowanym z emulatora. Nie blokuje niezależnego przygotowania kodu, ale nie pozwala deklarować celu „sprawdzone na S25”.

## 7. Realizacja

Domyślnie wykonanie przez bieżącego agenta przez `superpowers:executing-plans`, dopiero po akceptacji zapisanego planu. Delegacja implementacji wymaga osobnej wyraźnej zgody. Końcowy niezależny review całego zakresu, obsługa uwag, weryfikacja i PR do main; scala właściciel przez squash. Zmiana layoutu nie wymaga nowych migracji ani testów przepisujących algorytm uczenia.
