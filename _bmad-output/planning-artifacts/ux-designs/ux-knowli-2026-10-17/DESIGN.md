---
name: Umiem! — wybór obrazka
description: Propozycja wyglądu jednego ekranu ćwiczenia na telefonie i desktopie.
status: draft
direction: approved-A
updated: 2026-10-17
sources:
  - imports/phone-current.jpg
  - ../../../../docs/SPEC.md
  - ../../../../docs/architecture.md
colors:
  canvas: '#182134'
  surface: '#253049'
  ink: '#F1F5FF'
  muted: '#BDC9DF'
  accent: '#AEC0FF'
  on-accent: '#18244A'
  border: '#455370'
  success: '#A1E0BA'
  on-success: '#143323'
  error: '#FFB5AB'
  on-error: '#48201D'
  canvas-light: '#F6F8FD'
  surface-light: '#FFFFFF'
  ink-light: '#202C45'
  accent-light: '#3855CA'
  success-light: '#196044'
  error-light: '#A52B24'
typography:
  instruction:
    fontFamily: inherit
    fontSize: 22px
    fontWeight: '700'
    lineHeight: '1.3'
  feedback:
    fontFamily: inherit
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  action:
    fontFamily: inherit
    fontSize: 18px
    fontWeight: '700'
    lineHeight: '1.3'
rounded:
  lg: 20px
  md: 16px
  full: 9999px
spacing:
  gutter-mobile: 16px
  gutter-desktop: 32px
  tile-gap-mobile: 12px
  tile-gap-desktop: 16px
  related: 12px
  section: 24px
components:
  answer-grid:
    max-width: 560px
    columns: 2
  outcome-mark:
    size: 40px
    inset: 8px
    symbol-size: 26px
  answer-tile:
    ratio: '1:1'
    state-border: 4px
    radius: '{rounded.lg}'
  primary-action:
    min-height: 56px
    radius: '{rounded.md}'
---

# Umiem! — projekt wizualny ekranu obrazkowego

Właściciel wybrał wariant A 2026-10-17: „Podoba mi sie wariant A”. Kierunek UX jest zaakceptowany; dokument pozostaje roboczym opisem szczegółów do wdrożenia. Zachowujemy stylistykę pokazaną w makiecie oraz istniejący jasny i ciemny motyw aplikacji. Dokumenty określają projekt, makieta go ilustruje; przy rozbieżności dokumenty mają pierwszeństwo. Wybór kierunku nie jest poleceniem implementacji.

## Brand & Style

Spokojny ekran dziecka: główną treścią są duże ilustracje. Nagłówek, odsłuch, siatka i wynik tworzą jeden zwarty blok. Istniejący system Kid UI jest punktem wyjścia; proponowane zmiany dotyczą rozmiaru siatki i hierarchii wyniku. Makieta używa umownych ilustracji wektorowych, aby pokazać geometrię; docelowo pozostają zatwierdzone obrazki rodzica.

## Colors

Kolory płótna, tekstu i akcentu dziedziczą obecną paletę Kid UI. W ciemnym motywie znacznik poprawnej odpowiedzi ma pełne tło `{colors.success}` i ciemny symbol `{colors.on-success}`. Znacznik pomyłki ma pełne tło `{colors.error}` i symbol `{colors.on-error}`. Te same kolory tworzą grubą ramkę. Jednolita podkładka oddziela symbol od ilustracji. W jasnym motywie używamy ciemnych kolorów stanów i białego symbolu. Kolor zawsze ma towarzyszący kształt lub opis.

Progi odbioru przyszłej implementacji: tekst 4,5:1, duże napisy 3:1, znaczące symbole i obrysy 3:1 wobec bezpośredniego tła. Nie deklarujemy zmierzonej zgodności aplikacji na podstawie projektu.

## Typography

Instrukcja 20–24 px, wynik i akcja 18–20 px. Na kafelkach nie ma nazw obrazków. Komunikaty mogą zajmować dwa wiersze i rosną przy powiększeniu. Nie ściskamy fontu, aby zmieścić długi wynik.

## Layout & Spacing

Telefon pionowo: marginesy 16 px, odstęp między kafelkami 12 px, dwie równe kolumny. Siatka wykorzystuje szerokość pomiędzy marginesami, o ile mieści się także w dostępnej wysokości. Przy 390 CSS px kafelek ma 173 px; przy 360 CSS px — 158 px. Rozdzielczość załączonego JPG nie jest szerokością CSS urządzenia.

Kolejność pionowa: pasek sesji → instrukcja z odsłuchem → siatka → zarezerwowane miejsce wyniku → główna akcja. Odstęp siatka–wynik 12–16 px. Duża wolna przestrzeń zostaje za całym blokiem ćwiczenia, zamiast oddzielać obrazki od wyjaśnienia. Pasek sesji: „Koniec” po lewej, status mikrofonu po prawej; pozycję globalnego sterowania dźwiękiem należy uzgodnić przy implementacji na podstawie jego rzeczywistej funkcji.

Desktop: wyśrodkowany blok ćwiczenia o szerokości do 560 px; siatka nadal 2×2. Odstęp 16 px, kafelek do 272 px. Cały ekran nie rozciąga siatki do szerokości monitora. Przy 768–1023 px stosujemy ten sam limit, bez dodatkowych kolumn. Projekt domyślny pokazuje wynik i akcję pod siatką.

Wysokość jest drugim ograniczeniem: najpierw zmniejszamy puste odstępy, potem równomiernie całą siatkę. Kafelki pozostają kwadratowe. Jeżeli czytelne ilustracje, tekst i dostępne działania nie mieszczą się, dopuszczamy przewijanie zamiast obcinania. W poziomie przy szerokości co najmniej 700 px i wysokości poniżej 540 px proponujemy siatkę po lewej, wynik i akcję po prawej; bez zmiany kolejności kafelków.

Trzy opcje: A B / C, trzecia po lewej. Dwie opcje: A B. Zmniejszona liczba odpowiedzi nie zwiększa rozmiaru pojedynczego kafelka w danym viewporcie. Bez karuzeli, bez układu czterech opcji w jednym rzędzie.

## Elevation & Depth

Brak cienia na znakach jako jedynej poprawy czytelności. Znaczniki mają pełną podkładkę; delikatny cień może tylko odseparować ich krawędź. Brak migania, potrząsania i powiększania kafelka po wyniku.

## Shapes

Kafelki mają stały zarezerwowany obrys 4 px, promień 20 px. Wynik zmienia kolor obrysu, nie zewnętrzny wymiar kafelka. Znacznik ✓ jest okrągły. Znacznik × ma kształt zaokrąglonego kwadratu, dzięki czemu stany różnią się również sylwetką.

## Components

| Element | Propozycja |
| --- | --- |
| Odsłuch pytania | Jeden wyraźny przycisk 56×56 px obok instrukcji. Napis „Posłuchaj i wybierz” pozostaje krótki. |
| Kafelek | Cały jest celem dotykowym. Pełna ilustracja dopasowana bez kadrowania i deformacji. Dopuszczalne tło w wolnej przestrzeni. |
| Poprawny wybór | Gruba zielona ramka i pełny okrągły znacznik ✓ 40 px w prawym górnym rogu. |
| Błędny wybór | Gruba koralowa ramka i pełny kwadratowy znacznik × 40 px w prawym górnym rogu. |
| Ujawnione rozwiązanie po pomyłce | Zielona ramka i ✓, komunikat „Posłuchaj: siedzieć”, audio wskazujące to samo znaczenie. Nie opisujemy tego jako sukces dziecka. |
| Pozostałe opcje | Bez znacznika. Ilustracje czytelne, bez globalnej opacity dla całego zestawu. |
| Wynik | Bezpośrednio pod siatką; krótki komunikat z symbolem, a przy ujawnieniu przycisk odsłuchu. Rezerwacja dwóch wierszy w zwykłym widoku. |
| Główna akcja | Wspólna szerokość z siatką. „Dalej” albo „Spróbuj jeszcze raz” wyłącznie według aktualnego stanu sesji. |

Znacznik zajmuje narożnik, więc nie zasłania środka sceny. Przy zatwierdzaniu makiety warto sprawdzić ilustracje, w których istotny detal jest w tym narożniku; alternatywą jest znacznik w osobnym pasku pod obrazkiem.

## Do's and Don'ts

| Stosuj | Unikaj |
| --- | --- |
| Szerokość siatki zależna od miejsca na ekranie | Stały limit 150 px na wszystkich telefonach |
| Stałe pozycje przed odpowiedzią i po niej | Powiększanie poprawnego obrazka albo przestawianie opcji |
| Pełny kontrastowy znaczek i obrys | Mały biały znak bez podkładki na obrazku |
| Krótki wynik przy siatce | Wielka pusta przestrzeń pomiędzy obrazkami a wynikiem |
| Oddzielny stan oczekiwania na serwer | Zielony wynik natychmiast po dotknięciu |

Porównanie do decyzji: **A — znacznik na kafelku (proponowany)** daje największe obrazki i mało tekstu. **B — pasek wyniku pod każdą ilustracją** eliminuje zasłanianie narożnika i pozwala dopisać „Twój wybór” / „Posłuchaj”, lecz zużywa więcej wysokości. **C — osobna duża karta rozwiązania** skupia uwagę na jednym obrazku, lecz utrudnia porównanie i narusza ciągłość ekranu. Wstępna makieta pokazuje A.

Odniesienie: [.working/preview.html](.working/preview.html).
