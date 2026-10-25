# Mikrofon w nagłówku wyboru zestawu — projekt do przeglądu

Status: propozycja do zatwierdzenia razem z planem; bez implementacji.

## Cel i warianty

Usunąć stale widoczny panel mikrofonu, który zasłania zestawy na telefonie. Zachować świadome włączenie odpowiedzi głosowych przed rozpoczęciem nauki.

Rozważone warianty:

1. **Ikona otwierająca ustawienie — rekomendowany i przyjęty jako założenie planu.** Jedno dodatkowe dotknięcie, ale jasna informacja i mniejsze ryzyko przypadkowej zmiany.
2. Ikona przełączająca mikrofon od razu — szybsza, lecz trudniej wyjaśnić znaczenie i zmianę stanu.
3. Mniejszy panel pod nagłówkiem — czytelny, ale nadal zajmuje miejsce nad materiałem.

Właściciel poprosił o przygotowanie planu po rekomendacji wariantu 1. Projekt i plan pozostają do przeglądu przed implementacją.

## Zachowanie i wygląd

- Ekran wyboru zestawu: ikona mikrofonu obok przycisku odsłuchu instrukcji; gdy odsłuch nie jest dostępny, mikrofon nadal jest dostępny.
- Informacja o czasie i przycisk „Strefa rodzica” pozostają w nagłówku. Grupa ikon może przejść do kolejnego wiersza; nie wymuszać wszystkiego w jednym rzędzie na wąskim ekranie.
- `IconActionButton`, minimum 48 × 48 px. Mikrofon przekreślony przy `microphone=false`, zwykły przy `true`. Nazwa dostępności opisuje aktualny stan; `aria-expanded` opisuje rozwinięcie ustawienia. Włączony oznacza wybór odpowiedzi głosowych, a nie potwierdzenie dostępu do urządzenia.
- Kliknięcie otwiera panel `Paper` pozycjonowany `fixed` przy ikonie, z tytułem „Odpowiedzi głosowe”, istniejącym przełącznikiem „Mikrofon” i tekstem „Możesz uczyć się również bez nagrywania.” Pozycjonowanie omija Mantine Popover, który nie działał w produkcyjnym bundle; wymiary viewportu pochodzą z `KidPage`, a panel uwzględnia safe area.
- Przełączenie używa dotychczasowego `onToggleMicrophone(on: boolean): void`. Panel pozostaje otwarty po zmianie. Escape i kliknięcie poza panelem zamykają go; po Escape fokus wraca na ikonę.
- Panel mieści się w widocznym viewporcie, również przy małej wysokości i tekście 200%; w razie potrzeby jego treść przewija się. Nie rezerwuje stałego miejsca w liście zestawów.
- Domyślne wyłączenie i odświeżenie listy po zmianie mikrofonu pozostają bez zmian. Otwarcie panelu nie wywołuje `getUserMedia` ani zapytania o zgodę.
- Istniejący komunikat `microphoneDeniedHint` pozostaje wewnątrz panelu przy `micDenied=true`. Nie nazywać tego stanu odmową uprawnienia przeglądarki: kontroler ustawia go także po świadomym wyłączeniu.
- Ekran ćwiczenia i jego ikona stanu pozostają bez zmian.

## Granice

Właściciel: `packages/kid-ui`, komponent ustawienia mikrofonu i kompozycja `DeckScreen`. Zależności: istniejące komponenty dziecka, Mantine, katalog tekstów `packages/contracts`. Kontroler i API pozostają niezmienione; brak nowych zapisów i granicy transakcji. Brak wpływu API → MCP → skill: DTO, endpointy, parametry, autoryzacja i znaczenie raportów nie zmieniają się.

## Odbiór

Testy komponentu sprawdzają stany, otwieranie i zmianę ustawienia; testy kontrolera zachowanie ustawienia przy starcie sesji; Playwright sprawdza klawiaturę, brak wywołania mikrofonu i geometrię. Matryca: 360×640, 390×844, 844×390, 768×1024, 1280×800 oraz tekst 200%. Test fizycznego telefonu raportować osobno; emulacja nie zastępuje odbioru urządzenia.
