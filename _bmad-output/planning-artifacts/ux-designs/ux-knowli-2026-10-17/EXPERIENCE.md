---
name: Umiem! — wybór obrazka
status: draft
direction: approved-A
updated: 2026-10-17
sources:
  - imports/phone-current.jpg
  - ../../../../docs/SPEC.md
  - ../../../../docs/architecture.md
  - ../../../implementation-artifacts/spec-picture-choice-grid.md
---

# Umiem! — zachowanie ekranu obrazkowego

Projekt jednego ekranu; właściciel zaakceptował kierunek A 2026-10-17. Wygląd określa [DESIGN.md](DESIGN.md). Makieta jest szkicem prezentacji, nie działającym Kid UI. Plan kolejnego etapu: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md).

## Foundation

Prywatna aplikacja rodzinna. Dziecko wybiera ilustrację po odsłuchu. Obsługa telefonu, PWA, tabletu i przeglądarki desktopowej; dotyk, mysz, klawiatura i czytnik ekranu. Dziedziczymy istniejący system Kid UI. UI po polsku, materiał po angielsku. Sam ekran nie zmienia reguł uczenia, ocen ani ujawnień.

## Information Architecture

Jedna powierzchnia `picture_listening`, osiągana w istniejącej sesji z wyboru zestawu. Podpowierzchnie to stany tego samego zadania, a nie nowe ekrany.

| Strefa | Cel |
| --- | --- |
| Pasek sesji | Koniec i status urządzenia |
| Instrukcja i odsłuch | Jednoznaczne pytanie i możliwość powtórnego odsłuchania |
| Siatka | 2–4 pełne obrazki, dostępne nazwy opcji |
| Wynik | Ocena z serwera i ewentualnie udostępnione rozwiązanie |
| Akcja | Kontynuacja odpowiednia do stanu zadania |

## Voice and Tone

| Sytuacja | Komunikat |
| --- | --- |
| Pytanie | „Posłuchaj i wybierz” |
| Oczekiwanie po wskazaniu | „Sprawdzam…” |
| Trafienie | „Dobrze!” |
| Pomyłka z ujawnieniem rozwiązania | „Posłuchaj: siedzieć.”; opcjonalny drugi wiersz „Poćwiczymy razem.” |
| Błąd techniczny | „Nie udało się sprawdzić. Spróbuj ponownie.” |
| Akcja po sukcesie lub zakończonej próbie | „Dalej” |
| Akcja, gdy serwer dopuszcza kolejną próbę | „Spróbuj jeszcze raz” |

Bez „ŹLE”, zawstydzania i chwalenia niepoprawnego wyboru. Nie używamy „Prawie”, jeżeli wynik nie oznacza częściowej poprawności. Etykieta „Spróbuj jeszcze raz” oznacza rzeczywiste ponowienie; nie może prowadzić do innego zadania. Dla dziecka nieczytającego informację przenoszą symbol, powiązanie z obrazkiem i dostępne nagranie, a nie sam tekst.

## Component Patterns

| Element | Zachowanie |
| --- | --- |
| Odsłuch pytania | Jawna akcja; zachowuje serwerową autoryzację i zasady odsłuchu. Przycisk nie znika po odpowiedzi; jego dostępność zależy od dozwolonej operacji. |
| Kafelek | Dotknięcie wysyła jedną odpowiedź. Rozmiar i kolejność opcji pozostają stałe podczas oczekiwania, wyniku i ponowienia tego zadania. |
| Znacznik wyniku | Pojawia się dopiero po odpowiedzi serwera. Stosuje `{components.outcome-mark.size}` i kolory z DESIGN.md. Nie zastępuje nazwy dostępnej ani komunikatu wyniku. |
| Wynik | Rezerwuje miejsce przed odpowiedzią. Pojawia się przy siatce, bez skoku pozycji. Przy większym tekście dostępność ma pierwszeństwo nad stałą wysokością. |
| Odsłuch rozwiązania | Korzysta wyłącznie z rozwiązania ujawnionego przez serwer; przycisk blisko komunikatu i wskazanego poprawnego obrazka. |
| Kontynuacja | Używa istniejącego stanu `retry`; nie wprowadza lokalnej decyzji o dodatkowej próbie ani nie wydłuża sesji. |
| Mikrofon | Status zgodny z urządzeniem i preferencją. Wyłączony mikrofon nie blokuje wyboru obrazka. |

## State Patterns

| Stan | Kafelki | Wynik / akcja |
| --- | --- | --- |
| Gotowość | Neutralne, wszystkie czytelne | Odsłuch i wybór; slot wyniku i akcji zachowuje geometrię |
| Audio w trakcie | Kolejność i rozmiar bez zmian | Stan odtwarzania widoczny i dostępny |
| Wysyłanie | Wybrany ma neutralny obrys; brak ✓/×. Kolejne wysłania zablokowane | „Sprawdzam…”; brak lokalnego sukcesu |
| Poprawny wybór | Tylko wybrany otrzymuje ✓ i ramkę sukcesu | „Dobrze!”, „Dalej” |
| Pomyłka, rozwiązanie ujawnione | Wybrany × i ramka błędu; poprawny ✓ i ramka sukcesu | „Posłuchaj: …”, odsłuch rozwiązania; retry albo dalej zgodnie z serwerem |
| Pomyłka bez rozwiązania | Tylko wybrany ×; brak oznaczenia nieujawnionego celu | Uczciwy komunikat i dozwolona akcja |
| Brak oceny / awaria | Brak ✓/×; brak ujawnionego lokalnie rozwiązania | Komunikat techniczny i ponowienie bez fałszywej porażki |
| Offline | Bez nowych wyników; zachowane pozycje | Zablokowany wybór/odsłuch wymagający sieci; powrót zgodnie z istniejącą synchronizacją |
| Brak obrazka | Stała geometria i neutralny placeholder | Dziecko nie zgaduje przez uszkodzony obraz; dostępna istniejąca droga pominięcia lub odzyskania treści |

Poprawny obrazek ujawniony po pomyłce nie oznacza poprawnej odpowiedzi dziecka. Czytnik ogłasza „Twój wybór: pić — spróbuj ponownie. Pokazana odpowiedź: siedzieć”, zamiast ogłaszać ogólny sukces. Jeżeli powiązania rozwiązania z opcją nie da się ustalić jednoznacznie z serwerowego feedbacku, pokazujemy tylko potwierdzony wynik, bez zgadywania kafelka.

## Interaction Primitives

Jeden tap wybiera opcję; Enter/Spacja działają na natywnych przyciskach. Bez wymaganego gestu, hovera, przeciągania i automatycznego przechodzenia do kolejnego zadania. Wynik utrzymuje się do świadomego działania dziecka. Powrót do próby usuwa znaczniki dopiero po potwierdzeniu przejścia stanu. Ponowienie zachowuje wydane opcje i nie losuje ich lokalnie.

## Accessibility Floor

Cele dotykowe co najmniej 48×48 CSS px; główna akcja `{components.primary-action.min-height}`. Kafelki mają polskie nazwy dostępne. Fokus jest widoczny niezależnie od wyniku, a jego obrys nie jest obcięty. Tab porusza się zgodnie z kolejnością wizualną A B C D, następnie wynikowymi przyciskami. Wynik ogłaszany raz przez status, bez wielokrotnego czytania całej siatki. Przeniesienie fokusu po odpowiedzi wymaga zachowania orientacji użytkownika; wynik nie może być dostępny wyłącznie przez kolor ani wyłączony przycisk.

Zoom i powiększenie tekstu do 200% zachowują pełną treść oraz działania. Przy braku miejsca dozwolone przewijanie. Brak obowiązkowej animacji i automatycznego przejścia; respektujemy ograniczenie ruchu. Ilustracje bez obniżania czytelności przez globalne przygaszenie stanu disabled.

## Responsive & Platform

Telefon pionowo używa `{spacing.gutter-mobile}`, siatka dwóch równych kolumn i odstęp `{spacing.tile-gap-mobile}`. Szerokość ogranicza także dostępna wysokość: cel to największa siatka mieszcząca się z instrukcją, wynikiem i akcją. Maksymalna szerokość `{components.answer-grid.max-width}` zapewnia rozsądny rozmiar na desktopie.

Przy małej wysokości najpierw redukujemy puste odstępy, następnie skalujemy całą siatkę; ostateczny fallback to kontrolowane przewijanie. W poziomie wariant z siatką i panelem obok jest propozycją do oceny. Uwzględniamy safe areas i paski przeglądarki. Nie projektujemy według rozdzielczości fizycznej zrzutu.

Przyszły odbiór: 360×640, 390×844, 412×915, tablet 768×1024, desktop 1366×768 i 1920×1080 CSS px; poziom 844×390; po 2, 3 i 4 opcje, stany oczekiwania i wyniku, motyw jasny/ciemny oraz powiększenie. Rzeczywisty telefon/PWA wymagają osobnego obejrzenia — makieta nie potwierdza działania aplikacji na urządzeniu.

## Key Flows

### Przykładowa ścieżka — dziecko ok. 8 lat, telefon, pomyłka

1. Dziecko słyszy słowo i widzi cztery duże obrazki bez przewijania.
2. Wybiera picie. Przycisk wysyła odpowiedź, nie pokazuje jeszcze oceny.
3. Po wyniku wybrany obrazek ma wyraźny ×, a ujawniona poprawna odpowiedź — ✓.
4. **Moment rozstrzygający:** patrząc na obrazki i słuchając „Posłuchaj: siedzieć”, dziecko rozumie różnicę bez odczytywania długiego tekstu. Obrazki nie przesunęły się.
5. Uruchamia odsłuch rozwiązania lub wybiera dozwoloną kontynuację. System zachowuje istniejącą historię i budżet.

### Przykładowa ścieżka — dziecko, komputer, poprawna odpowiedź

1. Otwiera zadanie; siatka jest wyśrodkowana i ma rozsądny maksymalny rozmiar.
2. Wybiera poprawny obrazek myszą albo klawiaturą.
3. **Moment rozstrzygający:** ✓ jednoznacznie wskazuje jego wybór, a „Dobrze!” potwierdza wynik.
4. Sam wybiera „Dalej”. Pozycja przycisku odpowiada miejscu przewidzianemu przed wynikiem.

## Ustalenia i pytania do właściciela

Potwierdzone: projekt mobile i desktop, większa siatka oraz czytelniejszy wynik, bez implementacji. Układ 2×2 i brak podpisów są zgodne także z istniejącą specyfikacją ekranu.

Wybrany kierunek: wariant A znacznika na narożniku, bieżąca stylistyka i wynik z akcją bezpośrednio pod siatką. B i C pozostają porównaniem rozważanych wariantów. Drobne decyzje techniczne opisuje plan wdrożenia; nie wymagają ponownego wyboru wariantu.

Zakres API → MCP → skill: projekt prezentacji nie zmienia DTO ani znaczenia danych raportowych. Przy implementacji należy ponownie potwierdzić, że czytelne stany można oprzeć na istniejącym feedbacku; projekt nie zakłada nowego kontraktu.

## Status materiału

Wersja robocza z zaakceptowanym kierunkiem A. Makieta ilustruje telefon w gotowości i po dwóch rodzajach wyniku oraz desktop po pomyłce. Pozostałe stany są opisane w tabeli. Nie uruchamiano testów aplikacji ani nie wykonano odbioru na telefonie. Niezależna walidacja projektu BMAD nie została wykonana; pozostaje opcjonalna.
