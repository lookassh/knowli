# Requirements — przedmioty szkolne i trener precyzji odpowiedzi

**Status:** Etapy 1–2 zaimplementowane na gałęzi (2026-10-28); etapy 2b–5 według `tasks.md`. Bieżący handoff: `HANDOFF.md`.
**Dokument źródłowy właściciela:** `source-requirements.md` w tym katalogu (kopia 1:1).
**Projekt:** `design.md`; **plan zadań:** `tasks.md`; **złoty zestaw gradera:** `grader-golden-set.json`.

## Wprowadzenie

Umiem! wspiera dziś słówka angielskie i lekcje gramatyki oparte na katalogu tematów
w kodzie. Ten moduł rozszerza istniejący silnik lekcji (`SubjectModule`, SPEC §29a,
architecture.md §19) o przedmioty szkolne — historię, biologię, język polski i inne —
w których to rodzic dostarcza materiał, a zagadnienia do nauki powstają z tego materiału.

Moduł realizuje dwa cele z dokumentu źródłowego:

1. przygotowanie do sprawdzianu: zrozumienie, zapamiętanie i samodzielne odtwarzanie
   najważniejszych informacji z materiału;
2. **trener precyzji**: nauka udzielania logicznych, precyzyjnych i zwięzłych odpowiedzi.
   Dziecko, które zna materiał, ale rozwleka odpowiedź, ma dostać zaliczoną wiedzę
   i osobny trening skracania — rozwlekłość nie jest błędem wiedzy.

Słowniczek:

- **Materiał źródłowy** — tekst wklejony przez rodzica (np. opracowanie z NotebookLM
  przygotowane ze zdjęć podręcznika). Jedyna forma wejścia w tym zakresie.
- **Zagadnienie** — najmniejsza sprawdzana jednostka wiedzy wyprowadzona z materiału
  (w silniku: cel nauki, `objective`), np. „przyczyny przyjęcia chrztu przez Mieszka I”.
- **Element wymagany** — pojedyncza informacja, która musi wystąpić w poprawnej
  odpowiedzi otwartej (np. „roślina wykorzystuje energię światła”).
- **Rodzina pytań** — kilka sformułowań tego samego pytania o wspólnej liście elementów
  wymaganych i wspólnej odpowiedzi wzorcowej; pozwala pytać o to samo na wiele sposobów
  bez generowania pytań w trakcie sesji.
- **Precyzja** — drugi, niezależny wymiar oceny odpowiedzi otwartej: czy odpowiedź jest
  na temat, uporządkowana i bez zbędnych dygresji. Nigdy nie wpływa na ocenę wiedzy.
- **Cytat źródłowy (`sourceRef`)** — dokładny fragment materiału źródłowego, z którego
  pochodzi pytanie i odpowiedź wzorcowa.

## Zakres i świadome wyłączenia

W zakresie: tworzenie zestawu lekcji z wklejonego tekstu, dynamiczne zagadnienia,
typy ćwiczeń 1–5 (karta, wybór, luka, porządkowanie, odpowiedź otwarta), ocena
dwuwymiarowa odpowiedzi otwartych, odpowiedź mówiona, trener precyzji (typy 6–8),
raport rodzica rozdzielający wiedzę i precyzję, próbny sprawdzian.

Poza zakresem (decyzja właściciela, 2026-10-28): upload zdjęć i PDF, OCR i analiza
dokumentów w aplikacji, wyświetlanie obrazów z podręcznika, generowane ilustracje
faktograficzne, generowanie pytań w trakcie sesji, swobodny czat
AI z dzieckiem, ocena długich swobodnych wypowiedzi (esejów). Kształt `sourceRefs`
ma pozwalać na późniejsze podpięcie dokumentów bez zmiany znaczenia zapisanych prób.

Moduł zmienia zakres oceny modelem zapisany w SPEC §30: w zakresie są krótkie
i średnie odpowiedzi otwarte oceniane względem zatwierdzonej listy elementów
wymaganych (nie swobodne eseje). Pozostałe zasady SPEC i architektury obowiązują,
w szczególności: zatwierdzenie rodzica przed dostępem dziecka, niezmienność
opublikowanej treści, rozróżnienie nauki wspomaganej od samodzielnego przypominania,
„nieocenione” nie jest błędem dziecka, brak przechowywania nagrań dziecka.

## Wymagania

### Wymaganie 1 — Tworzenie zestawu z materiału rodzica

**User story:** Jako rodzic chcę wkleić opracowanie rozdziału (np. z NotebookLM)
i dostać szkic zestawu do nauki, aby dziecko przygotowało się do sprawdzianu
z materiału ze szkoły, a nie z gotowego kursu.

#### Kryteria akceptacji

1. WHEN rodzic tworzy zestaw przedmiotu szkolnego, THE panel rodzica SHALL pozwolić
   podać nazwę przedmiotu (tekst, np. „Historia”), tytuł tematu, wkleić materiał
   źródłowy (limit dla przedmiotu szkolnego: 16 000 znaków — decyzja właściciela 2026-10-28 po pilotażu o długości 9208 znaków; limit gramatyki bez zmian) i opcjonalną instrukcję
   (np. zakres sprawdzianu od nauczyciela).
2. THE zestaw SHALL powstawać istniejącą ścieżką lekcji: szkic i trwałe zadanie
   generowania w jednej transakcji, z kluczem idempotencji; `vocabulary`
   i gramatyka angielska pozostają bez zmian.
3. THE panel rodzica SHALL zawierać krótką instrukcję przygotowania materiału
   w narzędziu zewnętrznym: opracowanie wierne (definicje, daty, nazwiska
   dosłownie), a nie streszczenie; jeden zestaw = jeden podrozdział.
4. WHEN generowanie się nie powiedzie, THE system SHALL zachować się jak przy
   lekcjach: brak częściowej publikacji, możliwość ponowienia i dogenerowania.

### Wymaganie 2 — Dynamiczne zagadnienia i uziemienie w źródle

**User story:** Jako rodzic chcę, aby pytania dotyczyły wyłącznie faktów z materiału,
który podałem, i abym mógł sprawdzić, skąd każde pytanie pochodzi.

#### Kryteria akceptacji

1. THE generowanie SHALL wyprowadzać z materiału zagadnienia z kartami nauki
   (krótkie wyjaśnienie prostym językiem, definicje, fakty do zapamiętania,
   zależności przyczynowe, przykłady) oraz pulę ćwiczeń przypisanych do zagadnień.
2. KAŻDE wygenerowane ćwiczenie otwarte SHALL mieć: odpowiedź wzorcową, listę
   elementów wymaganych, opcjonalną listę elementów uzupełniających i częstych
   błędów rzeczowych, typ pytania i oczekiwaną formę.
3. KAŻDE ćwiczenie SHALL mieć co najmniej jeden cytat źródłowy będący dokładnym
   fragmentem materiału rodzica; walidacja puli SHALL odrzucać ćwiczenie bez
   pokrycia w materiale zamiast dopowiadać fakt z wiedzy modelu.
4. THE pytania o to samo zagadnienie SHALL być generowane jako rodziny pytań:
   co najmniej dwa sformułowania o wspólnych elementach wymaganych tam, gdzie
   materiał na to pozwala.
5. WHEN model zwróci ćwiczenie niespełniające walidacji, THE system SHALL odrzucić
   tylko to ćwiczenie i pokazać rodzicowi liczbę odrzuconych — jak w lekcjach.
6. Informacje dopisane ręcznie przez rodzica SHALL być oznaczane jako źródło
   rodzica, odrębne od materiału źródłowego.
7. Rozszerzanie materiału przez Knowli jest wyłącznie pomocnicze (decyzja
   właściciela 2026-10-28): karty nauki MAY upraszczać wyjaśnienia własnymi
   słowami i dokładać przykłady lub analogie, które nie wprowadzają nowych
   faktów sprawdzanych w ćwiczeniach. Pytania, odpowiedzi wzorcowe i elementy
   wymagane SHALL pochodzić wyłącznie z materiału rodzica; system SHALL NOT
   dopisywać nowych faktów (dat, nazwisk, definicji) jako treści zestawu.

### Wymaganie 3 — Przegląd, edycja i publikacja

**User story:** Jako rodzic chcę poprawić zagadnienia, odpowiedzi wzorcowe
i elementy wymagane przed udostępnieniem dziecku.

#### Kryteria akceptacji

1. THE panel rodzica SHALL pokazywać szkic pogrupowany po zagadnieniach,
   z widocznym oznaczeniem rodziny pytań przy ćwiczeniu i edytowalnym
   podglądem cytatów źródłowych („Skąd to pytanie?”). Rodzic może edytować
   tytuły zagadnień i treść kart oraz usuwać zagadnienia wraz z ćwiczeniami.
2. Rodzic SHALL móc edytować: karty nauki, pytania, odpowiedzi wzorcowe, listy
   elementów wymaganych i uzupełniających, oczekiwaną formę odpowiedzi oraz
   usuwać ćwiczenia i całe zagadnienia; walidacja przy zapisie i publikacji jest
   taka sama jak przy generowaniu (w tym pokrycie cytatem, o ile rodzic nie doda
   własnego źródła).
3. Cykl szkicu, niezmienność po publikacji, przypisania dzieciom i termin
   sprawdzianu SHALL działać jak w lekcjach; dziecko nie widzi szkicu.
4. Publikacja SHALL wymagać minimalnego pokrycia etapów na zagadnienie
   (konkretne progi ustala `design.md` na wzór lekcji).

### Wymaganie 4 — Typy ćwiczeń przedmiotów szkolnych

**User story:** Jako dziecko chcę ćwiczyć od poznania pojęcia do samodzielnej
odpowiedzi, różnymi sposobami.

#### Kryteria akceptacji

1. THE przedmiot szkolny SHALL używać typów: `lesson_card`, `lesson_choice`
   (w tym prawda/fałsz jako wybór z dwiema opcjami), `lesson_gap`,
   `lesson_order`, `lesson_open_answer`, a od etapu 2b także
   `lesson_calculation`, a od etapu 7 (decyzja właściciela 2026-10-29,
   wcześniejsze wyłączenie „dopasowywania par” uchylone) `lesson_match`
   („Połącz w pary”) i `lesson_group` („Pogrupuj”) — ocenianie
   deterministycznie z przypisań, bez modelu (design §10). Typów gramatycznych (`lesson_notice`,
   `lesson_short_answer`, `lesson_error_fix`, `lesson_transform`) nie włącza się.
2. `lesson_card` SHALL pozostawać ekspozycją bez próby, oceny i zużycia budżetu.
3. Typy zamknięte i luka z dopasowaniem do zatwierdzonych wariantów SHALL być
   oceniane deterministycznie, bez modelu oceniającego.
4. Cała ścieżka SHALL działać bez mikrofonu; mowa (wym. 6) jest dodatkiem,
   nigdy warunkiem.
5. `lesson_calculation` (decyzja właściciela 2026-10-28) SHALL być zadaniem
   parametrycznym: model proponuje szablon i parametry z zamkniętej listy
   rodzajów obliczeń (m.in. odległość ze skali mapy, wysokość względna,
   przeliczanie jednostek), a poprawną odpowiedź SHALL obliczać i weryfikować
   kod deterministyczny — przy walidacji puli, edycji i ocenie. Pula zawiera
   warianty liczbowe tego samego szablonu, zatwierdzane przez rodzica razem
   z policzonymi odpowiedziami. Ocena SHALL parsować polski zapis liczb
   (spacje tysięcy, przecinek dziesiętny, opcjonalna jednostka) i stosować
   tolerancję zadaną w szablonie; model oceniający nie bierze w niej udziału.

### Wymaganie 5 — Odpowiedź otwarta i ocena dwuwymiarowa

**User story:** Jako rodzic chcę, aby odpowiedź dziecka własnymi słowami była
oceniana osobno pod względem wiedzy i precyzji, aby rozwlekła, lecz poprawna
odpowiedź zaliczała wiedzę.

#### Kryteria akceptacji

1. THE odpowiedź otwarta SHALL być oceniana hybrydowo jak w lekcjach:
   deterministyczne dopasowanie do wariantów → cache werdyktów → model
   oceniający; brak konfiguracji modelu lub jego awaria = „nieocenione” bez kary.
2. Model SHALL otrzymywać wyłącznie dane ćwiczenia i kontekstu lekcji:
   pytanie i polecenie, odpowiedź wzorcową z wariantami, elementy wymagane
   i uzupełniające, typowe błędy, oczekiwaną formę, cytaty źródłowe, tytuł
   przedmiotu i zagadnienia, opis celu z kategoriami błędów oraz odpowiedź
   dziecka jako dane. Bez imienia, wieku i identyfikatorów dziecka.
   (Lista urealniona po review Etapu 2 — W10; wcześniej węższa niż praktyka.)
3. Werdykt SHALL zawierać dwa niezależne wymiary: wiedzę
   (`correct|partial|incorrect|unevaluated`) i precyzję
   (`concise|verbose|unfocused|unevaluated`), wykryte i brakujące elementy
   wymagane, błędne stwierdzenia oraz fragmenty zbędne jako dokładne podciągi
   odpowiedzi dziecka. Backend SHALL walidować werdykt i odrzucać niezgodny.
4. Precyzja SHALL NOT wpływać na ocenę wiedzy, serię sukcesów ani opanowanie
   zagadnienia; trafia do szczegółów oceny i raportów.
5. Odpowiedź zawierająca istotne błędne stwierdzenie SHALL NOT być zaliczana
   jako poprawna, nawet jeśli zawiera właściwe słowa kluczowe.
6. Poprawna parafraza SHALL być zaliczana; ocena nie wymaga brzmienia wzorca.
7. Feedback dla dziecka SHALL być krótki i budowany z zatwierdzonych szablonów:
   co było dobre → jeden najważniejszy brak → zachęta do poprawy. Po pierwszej
   częściowo poprawnej próbie system SHALL NOT ujawniać odpowiedzi wzorcowej;
   ujawnienie następuje zgodnie z istniejącym cyklem wsparcia.
8. Rodzic SHALL móc nadpisać werdykt modelu na przyszłość jak w lekcjach
   (bez wstecznego przeliczania historii).

### Wymaganie 6 — Odpowiedź mówiona

**User story:** Jako dziecko chcę odpowiadać głosem, bo mówię szybciej, niż piszę.

#### Kryteria akceptacji

1. Odpowiedź otwarta SHALL przyjmować modalność mówioną: nagranie → polska
   transkrypcja STT → ta sama ocena co tekstu. Ocena wymowy nie jest stosowana.
2. Niepewna lub nieudana transkrypcja SHALL kończyć się „nieocenione”,
   bez zapisu błędu wiedzy i bez pomyłki między pojęciami.
3. Modalność (pisemna/mówiona) SHALL być zapisywana przy próbie; obie liczą się
   do wiedzy, a raport rodzica pokazuje je osobno.
4. Surowe nagranie SHALL NOT być przechowywane (zasady jak w całej aplikacji).

### Wymaganie 7 — Trener precyzji

**User story:** Jako rodzic chcę, aby dziecko ćwiczyło wybieranie najważniejszych
informacji i krótkie odpowiadanie, a nie tylko odtwarzanie definicji.

#### Kryteria akceptacji

1. „Najpierw słowa kluczowe”: dziecko SHALL wskazać 2–3 najważniejsze pojęcia
   (wybór z listy zawierającej dystraktory) przed zbudowaniem odpowiedzi.
   Jest to etap wspomagany — sukces po nim nie potwierdza samodzielnej pamięci.
2. „Odpowiedz w jednym zdaniu” SHALL być wariantem odpowiedzi otwartej
   z oczekiwaną formą `one_sentence`, stosowanym tylko do pytań, którym tę
   formę nadał materiał/rodzic; liczbę zdań liczy kod deterministycznie.
3. „Skróć swoją odpowiedź”: po swobodnej odpowiedzi dziecko SHALL otrzymać
   wskazanie elementów niezbędnych, zbędnych i niezwiązanych oraz spróbować
   wersji krótszej. Oryginał i poprawka SHALL być zapisane jako osobne,
   powiązane próby; poprawka po informacji zwrotnej nie jest samodzielnym
   sukcesem. Utrata elementu wymaganego w poprawce SHALL być wykrywana.
4. Selektor SHALL dobierać ćwiczenia trenera na podstawie zapisanych trudności:
   poprawna wiedza + `verbose` → skracanie; brak elementu → powtórka zagadnienia
   lub ćwiczenie tego elementu; pomyłka pojęć → pytanie porównawcze z puli.

### Wymaganie 8 — Postęp, powtórki i raport rodzica

1. Postęp SHALL być śledzony per dziecko i zagadnienie istniejącą projekcją
   lekcji; opanowanie wymaga samodzielnych sukcesów po przerwie, jak w lekcjach
   (sukces tuż po karcie, podpowiedzi lub poprawce nie potwierdza pamięci).
2. THE panel rodzica SHALL pokazywać osobno: opanowanie zagadnień, brakujące
   elementy, powtarzające się błędy rzeczowe oraz wymiar precyzji (w tym liczbę
   odpowiedzi poprawnych, lecz rozwlekłych i udanych skróceń), z podglądem
   oryginalnej i poprawionej odpowiedzi. Raport nie ocenia cech dziecka.
3. Próbny sprawdzian SHALL działać jak kartkówka lekcji: bez podpowiedzi
   i wzorców w trakcie, z raportem per zagadnienie po zakończeniu.
4. Historia prób SHALL zapisywać m.in.: pierwszą i poprawioną odpowiedź,
   brakujące elementy, użyte wsparcie, modalność i wersję kryteriów (przez
   wersję zestawu) — bez przepisywania zakończonych ocen.

### Wymaganie 9 — Prywatność, regresje i granice

1. Zestawy szkolne SHALL być lekcjami; raport `learning-overview` (Hermes/MCP)
   nadal wyklucza wszystkie lekcje. Bez zmian kontraktu: brak wpływu na MCP
   i `SKILL.md` poza utrzymaniem noty o wyłączeniu.
2. Kid DTO SHALL NOT zawierać odpowiedzi wzorcowych, elementów wymaganych,
   kategorii oceny ani komentarza modelu (komentarz widzi tylko rodzic).
3. Usunięcie profilu dziecka usuwa jego historię także dla zestawów szkolnych;
   wspólny materiał zostaje — jak dziś.

## Kryteria akceptacji N01–N15 (mapowanie z dokumentu źródłowego)

- **N01′** (zastępuje N01): rodzic wkleja opracowanie rozdziału biologii
  przygotowane z 15 zdjęć w narzędziu zewnętrznym; aplikacja tworzy szkic
  zagadnień i pytań. Sam upload zdjęć jest poza zakresem.
- **N02′** (zastępuje N02): fragment materiału nie pokrywa wygenerowanego
  pytania — walidacja odrzuca ćwiczenie zamiast dopowiadać fakt. Wykrywanie
  nieczytelnych stron należy do narzędzia zewnętrznego.
- **N03**: bez zmian — dziecko zaczyna naukę dopiero po zatwierdzeniu.
- **N04–N10**: bez zmian; pokrywają je wymagania 5, 7 i 8 oraz złoty zestaw.
- **N11**: bez zmian (wymaganie 6.2).
- **N12**: bez zmian — nowa wersja kryteriów nie zmienia historycznych prób.
- **N13**: bez zmian (wymaganie 8.3).
- **N14**: bez zmian (wymaganie 8.2).
- **N15**: bez zmian — zero wpływu na słówka i gramatykę; pilnują tego testy
  regresji lekcji i zestawów słówek.
