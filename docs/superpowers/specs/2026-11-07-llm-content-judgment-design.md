# Treść językową ocenia model, strukturę — kod: uproszczenie generowania i oceniania lekcji — design

Wersja 4, 2026-11-07. Przebudowana pod cel właściciela z 2026-11-07 (§2): prosty przebieg jest rozwiązaniem bazowym, a każda dodatkowa warstwa wymaga wskazanego problemu, dowodu z próbek i mierzalnej korzyści. Wersje 1–3 (PR #357, #363) opisywały rozbudowaną kontrolę generowania; co z nich zostało, a co wypadło — §18. Stan kodu: `origin/main` 2d3a5336.
Spec zbiorczy: zasada, przebieg bazowy, ocena odpowiedzi, warstwy kandydujące, kryterium prostoty, etapy i bramki. Każdy etap 2–5 dostaje na starcie własny szczegółowy spec, plan i przegląd trzech krytyków.
Powiązane: #358 (epik), #359–#362 (etapy), #237 (agent puli), #279 (poziom materiału), #280 (Present Continuous v2), #288 (dwuznaczne ćwiczenia Present Simple), #328 (zdania z kart w ujawnieniach).

## 1. Problem

Generowanie lekcji korzysta z LLM, a jednocześnie próbuje sprawdzać język naturalny kodem: składnię, czas gramatyczny, podmiot, czasowniki, wskaźniki czasu i poprawność dystraktorów. Heurystyki rosną z każdym tematem, a mimo to nie gwarantują jakości.

- **Rozmiar.** Heurystyki językowe w generowaniu lekcji to ok. 4,7 tys. linii (bez testów), z czego 3,9 tys. w `english_grammar`: `present-continuous-validation.ts` 1843, `present-continuous-tense-choice.ts` 471, `present-continuous-exercise-rules.ts` 433, `validators.ts` 488, `time-markers.ts` 374, `be-agreement.ts` 241, `english/ing-forms.ts` 247. Do tego 830 linii opisów tych reguł dla modelu (`english-grammar/rules.ts`) i ok. 1,6 tys. linii orkiestracji agenta (`domain/lessons/agent/`) z narzędziami i pętlą odrzuceń.
- **Prompt.** Prompt generatora Present Continuous ma 37,5 tys. znaków, w 89% to opisy reguł; agent wysyła go w każdym z maksymalnie 8 kroków.
- **Błędy w obie strony** (potwierdzone wywołaniem walidatora, 2026-11-06): poprawne „Tom is quietly reading a book.” odpada; błędne „Tom reading is.” przechodzi jako klucz rozsypanki; „food and drinks” w celach porównania czasów odpada jako drugi czasownik.
- **Kontrola nie daje dydaktyki.** Sondy PR #329: 4 z 18 ćwiczeń (próg 30%) podaje czas wyłącznie w polskiej scence; ślepa ocena Present Simple znalazła 25% ćwiczeń dwuznacznych obok Present Continuous (#288).
- **Koszt utrzymania, nie działania.** Przebieg sondy PC kosztował 0,12–0,14 USD. Drogi jest każdy nowy temat: parser, prompt, trzy rundy krytyków i trzy płatne sondy.

## 2. Cel i zasady

**Cel właściciela (2026-11-07):** uprościć aplikację przez powierzenie modelowi rozumienia języka i treści zadań. Po implementacji ma być mniej logiki do utrzymania. Samo zastąpienie heurystyk językowych rozbudowaną orkiestracją modeli nie spełnia tego celu.

> LLM odpowiada za tworzenie i rozumienie treści językowej. Kod odpowiada za strukturę danych, jednoznaczne porównania, obliczenia i niezawodny przebieg nauki.

**Kryterium sukcesu jest podwójne:** odpowiednia jakość nauki (§12) oraz wyraźnie prostsza implementacja (§10). Jeśli nowy proces wymaga wielu specjalnych przypadków, rozgałęzień i etapów kontroli, wracamy do właściciela, zanim pójdziemy dalej.

Zasady:

- **Kod nie rozumie języka.** Nie budujemy parserów czasów, list wszystkich dopuszczalnych konstrukcji, reguł rozstrzygających znaczenie zdania ani wyjątków dla konkretnych słów — we wszystkich przedmiotach i typach lekcji, wszędzie tam, gdzie ocena wymaga interpretacji treści.
- **Prosty przebieg jest bazowy** (§4–§7). Dodatkowa warstwa wchodzi tylko z wskazanym problemem, dowodem z próbek i mierzalną korzyścią (§8); bez tego jej nie budujemy, a warstwa bez wykazanej korzyści jest usuwana.
- **Zastępowane heurystyki są usuwane,** a nie zostają jako dodatkowe zabezpieczenie (§9).
- **Historia, postęp, samodzielność, prywatność i obsługa awarii** zostają odpowiedzialnością kodu, bez zmiany zasad.
- **Koszt.** Akceptujemy większy koszt mocnego modelu, jeśli daje poprawne ćwiczenia, sprawiedliwe ocenianie i prostszy system. Nie optymalizujemy tokenów kosztem własnego silnika językowego. Koszt i czas mierzymy i oceniamy w kontekście rodzinnej aplikacji edukacyjnej.

**Zamrożenie.** Do usunięcia heurystyk nie dodajemy nowych heurystyk językowych i nie poprawiamy istniejących (AGENTS.md). Jeśli na bramce etapu 4 lub 5 przedmiot zostaje na agencie (§11), zamrożenie heurystyk tego przedmiotu zostaje zdjęte.

## 3. Stan obecny (mapa z 2026-11-07)

**Zestawy słówek są już zgodne z zasadą:** model generuje pozycje (`providers/openai/llm.ts`), kontrole po generowaniu są strukturalne, ocena 9 typów jest deterministyczna (`domain/evaluate.ts`, `modules/learning/speech.ts`), a dystraktory dobiera kod z pozycji zestawu. Jedyna heurystyka (`english/material-phrase.ts` i zależności, ok. 500 linii: czy słowo stoi w materiale źródłowym) zostaje poza zakresem. **Słówek ten spec nie zmienia.**

**Generowanie lekcji:** zagadnienia z katalogu (`english_grammar`), z planisty (`english_chapter`, `planObjectives`, pętla do 8 kroków) albo z jednego wywołania (`school`). Dla każdego zagadnienia podagent `runObjective` (`ToolLoopAgent`, narzędzia `submit_exercises` / `remove_exercise`, do 8 kroków). Przyjęcie (`lesson-pool-agent-tools.ts`, `agent/admission.ts`): oczyszczenie, limity, zod, reguły rdzenia, `subject.validateExercise` (tu heurystyki), walidacja puli, ujawnienia, kontrole LLM (`solve` — jedno ślepe rozwiązanie, `judgeVariants` — zakłada poprawny klucz, w szkole `judgeHints` i `solveOpen` + grader), odrzucenia wracają do modelu. Kontroler nie wymienia wszystkich poprawnych odpowiedzi, a `lesson_notice`, `lesson_short_answer`, `lesson_listen_choice`, `lesson_keywords` nie mają żadnej kontroli LLM. Niedostępny checker przepuszcza ćwiczenie jako `unchecked`. Heurystyki blokują też ręczną edycję szkicu przez rodzica (`lesson-api.ts`, błąd 400).

**Ocena odpowiedzi w lekcjach:** zadania zamknięte (choice, listen_choice, short_answer, notice, keywords, match, group, cloze, order) i rachunki ocenia kod. Tekstowe (gap, error_fix, transform, open_answer): `matchLessonAnswer` → cache `lesson_verdicts` → grader. Ustalenia:

- **Skróty.** Normalizator rozwija skróty po obu stronach dopasowania, więc dokładne dopasowanie zalicza bez modelu „Yes, she's.”, „Yes, I'm.”, „Yes, they're.” wobec pełnych kluczy i „He has running.” wobec klucza „He's running.” (potwierdzone wywołaniem `matchLessonAnswer`). Klucz cache (`normalizedAnswerKey`, `lesson-attempts.ts:474`) bierze tę samą rozwiniętą postać, więc „Yes, she's.” i „Yes, she is.” dzielą werdykt.
- **Rozsypanka** ignoruje `acceptedAnswers` (`evaluateSequence`) — inny poprawny szyk to błąd, choć agent pisze warianty szyku.
- **Grader:** brak konfiguracji, limit (domyślnie 20 na sesję) albo awaria → nieocenione, bez kary. Typy zależne od gradera są zdefiniowane w trzech miejscach (`scheduler.ts:151`, `lesson-sessions.ts:733`, `lesson-shorten.ts:39`), pierwsze bez `lesson_gap`. Nieocenione nie zmienia serii ani projekcji; ponowienie jest kolejną próbą, więc już niesamodzielne.
- Werdykt `correct` daje sukces celu, także gdy odpowiedź nie używa ćwiczonej formy.

## 4. Przebieg bazowy generowania

Paczka to jeden cel i jeden typ ćwiczenia (decyzja właściciela). Zagadnienia powstają jak dziś (katalog, planista rozdziału, wywołanie szkoły).

1. **Generowanie** — jedno wywołanie mocnego modelu ze schematem wyniku (Zod). Prompt: cel i jego zakres zwykłym tekstem (dydaktyka przeniesiona z kodu do opisów celów w katalogu), odbiorca (stały jak dziś, do czasu #279 — potem poziom materiału, nigdy wiek ani rok urodzenia z profilu), materiał i przykłady rodzica, karta typu (format i jeden przykład), liczba ćwiczeń z zapasem, zdania do unikania (karty — #328 — i wcześniejsze lekcje). Prompt wymaga poprawnych, jednoznacznych poleceń i kontekstu, który rozstrzyga odpowiedź. Model generatora wybiera spec etapu 2.
2. **Walidacja kodem** — struktura danych, wymagane pola, identyfikatory i powiązania, możliwość wyświetlenia i rozwiązania (klucz wśród opcji, klocki składają się na klucz, słowo `lesson_notice` występuje w zdaniu dokładnie raz), reguły ujawnień, identyczne duplikaty. Rachunki liczy kod.
3. **Kontrola zadań zamkniętych** — jedno wywołanie na paczkę typów zamkniętych (§5).
4. **Odrzucone ćwiczenia odpadają.** Nie ma rund naprawy. Zapas w zamówieniu pokrywa typowe odrzucenia; brak do minimum publikacji rodzic widzi jako lukę celu i uzupełnia istniejącym dogenerowaniem.

Paczki jednego celu idą równolegle, z wyjątkiem `lesson_keywords`, które powstają po paczce `lesson_open_answer` (słowa kluczowe są sparowane z pytaniem otwartym). Po wszystkich paczkach działa walidacja całej puli i ujawnień; kolizja usuwa późniejsze ćwiczenie.

**Niepowodzenie.** Wywołanie modelu (generowanie albo kontrola), które skończy się błędem technicznym, ma jedno ponowienie; potem zagadnienie kończy się porażką z kodem dostawcy, a run korzysta z istniejących automatycznych ponowień (`MAX_AUTOMATIC_ATTEMPTS`). Po ich wyczerpaniu rodzic widzi czytelny stan niepowodzenia. Ćwiczenie niesprawdzone nigdy nie trafia do szkicu. Bez pętli samonaprawy i kolejnych warstw awaryjnych; punkt kontrolny zostaje na poziomie celu, jak dziś.

**Klient modelu.** AI SDK zostaje (`generateText` z `Output.object`, routing OpenRouter, `tracked` do kosztów, timeouty, anulowanie), adapter w `providers/openai/lesson-pool-agent.ts`. Pętla `ToolLoopAgent` z narzędziami znika.

## 5. Kontrola zadań zamkniętych

**Problem:** ocena po ID nie uratuje zadania z dwiema poprawnymi opcjami ani z błędnym kluczem — dziecko dostaje „źle” za dobrą odpowiedź. To jedyna kontrola generowania w przebiegu bazowym.

- **Typy:** choice, listen_choice, short_answer, notice, keywords, match, group, cloze, order.
- **Wejście:** tylko to, co widzi lub słyszy dziecko — widok ćwiczenia bez klucza i wyjaśnień, w `lesson_listen_choice` transkrypcja nagrania, w szkole materiał lekcji, który dziecko poznało. Bez opisu celu: cel („Present Simple”) naprowadzałby na ćwiczoną formę i ukrywał drugą poprawną odpowiedź.
- **Wyjście:** komplet poprawnych odpowiedzi podany tekstami (nie ID; klocki i opcje o tym samym tekście są zamienne, #298), albo „żadna nie jest poprawna”, albo „nie wiem”.
- **Porównanie kodem:** komplet musi się równać kluczowi (zbiory i przypisania w całości). W rozsypance wystarczy, że klucz jest wśród zwróconych szyków — inny poprawny szyk ocenia przy dziecku model oceniający (§6). Każdy inny wynik usuwa ćwiczenie.

Rachunki sprawdza kod (`calculation.ts`); pytania do historyjki są poza zakresem. Zadania tekstowe w przebiegu bazowym nie mają kontroli generowania — chroni je ocena odpowiedzi (§6), a ewentualna kontrola to warstwa kandydująca (§8).

## 6. Ocena odpowiedzi dziecka

| Zadania | Ocena |
|---|---|
| Słówka (9 typów), rachunki, pytania do historyjki | kod, bez zmian |
| choice, listen_choice, short_answer, notice, keywords, match, group, cloze | kod, po ID / przypisaniu, bez zmian |
| `lesson_order` | kod: klucz → zaliczenie; inny szyk ułożony dokładnie z wydanych klocków → cache → model oceniający |
| gap, error_fix, transform, open_answer | zatwierdzony wariant → zaliczenie; inna odpowiedź → cache → model oceniający |

- **Model oceniający** dostaje polecenie, kontekst widoczny dla dziecka i cel ćwiczenia, i ocenia poprawność oraz to, czy odpowiedź ćwiczy cel (pole `usesTargetForm`). Odpowiedź poprawna, ale bez ćwiczonej formy (np. „She is reading a book.” w tłumaczeniu na Present Simple bez wskaźnika „zwykle”, #288) daje istniejący wynik **nieoceniony**: bez kary i bez sukcesu celu, zadanie nie wraca do ponowienia, dziecko widzi „Dobrze!” i formę ćwiczoną w lekcji (ekspozycja zapisana przed wysłaniem, jak przy `model_almost`), a rodzic widzi komentarz modelu w istniejącym miejscu.
- **Dopasowanie i klucz cache bez rozwijania skrótów.** `matchLessonAnswer` i klucz cache używają neutralnej normalizacji: wielkość liter, interpunkcja, ujednolicone apostrofy, spacje i jedna literówka poza `focus`. Skrót zalicza się tylko wtedy, gdy dokładnie ta forma jest w kluczu albo wariantach; każdą inną odpowiedź ze skrótem ocenia model. To usunięcie kodu, nie nowa reguła; działa dla wszystkich rewizji, także opublikowanych lekcji. Rozwijanie skrótów zostaje tylko w porównaniach ujawnień i duplikatów, gdzie nadmiarowe wykrycie jest bezpieczne.
- **Rozsypanka** przestaje używać i generować `acceptedAnswers`.
- **Nowa wersja promptu** modelu oceniającego (nowy klucz cache). Stare werdykty i decyzje rodzica zostają historią i nie są przenoszone: stary klucz był znormalizowany z rozwiniętymi skrótami, a dawne „poprawne” nie rozróżniało sukcesu celu. Pod nową wersją decyzja rodzica dotyczy jednej odpowiedzi i ma pierwszeństwo przed werdyktem modelu: „uznaj” oznacza sukces celu, „odrzuć” — błąd.
- **Bez zmian:** ocena szkolna (wiedza i precyzja, kryteria z materiału), decyzja rodzica nadpisująca werdykt, brak tolerancji literówek w tokenach `focus`, cache werdyktów (poza normalizacją klucza). Bez osobnego wyjątku pisowni — model oceniający przypisuje kategorię `spelling`.

## 7. Model oceniający: dostępność i limit

1. **Brak konfiguracji** wykrywamy przed nauką: generowanie lekcji wymaga pełnej konfiguracji `UMIEM_GRADER_*` (drugi warunek `lessonGenerationAvailable`, z powodem w DTO katalogu i wyjaśnieniem w panelu; bez blokady w trybie fake). Opublikowane lekcje działają dalej — selektor pomija zadania zależne od gradera, gdy go nie ma.
2. **Awaria działającej usługi** — bez zmian: nieocenione, bez kary, zadanie do ponowienia. Utrata samodzielności przy ponowieniu jest warstwą kandydującą (§8).
3. **Limit:** jedna definicja typów zależnych od gradera (z `lesson_gap` i `lesson_order`) zamiast trzech, a domyślna wartość `UMIEM_GRADER_MAX_CALLS_PER_SESSION` pokrywa największy budżet sesji (100 zadań) z zapasem na ponowienia. Bez limitu liczonego z planu sesji.

## 8. Warstwy dodatkowe — tylko z dowodem

Warstwa wchodzi do kodu tylko wtedy, gdy ma: (a) nazwany problem, (b) dowód z próbek — sondy albo produkcji — powyżej progu, (c) mierzalną korzyść wobec przebiegu bazowego na tych samych paczkach lub próbkach (bez dodatkowego generowania, gdzie to możliwe), (d) opisany koszt złożoności. Decyzję podejmuje właściciel. Warstwa, która nie wykaże korzyści, jest usuwana.

| Kandydat | Problem | Wyzwalacz | Miara korzyści |
|---|---|---|---|
| Kontrola klucza zadań tekstowych | błędny klucz zaliczany dokładnym dopasowaniem bez modelu | błędne klucze tekstowe > 1% przyjętych (rubryka) | spadek błędnych kluczy na tych samych paczkach |
| Kontrola dwuznaczności zadań tekstowych | dużo wyników „nieoceniony — bez ćwiczonej formy” | dwuznaczne zadania tekstowe > 3% (rubryka) albo ten wynik w > 5% ocen modelu na produkcji | spadek dwuznacznych |
| Jedna runda naprawy | za mało ćwiczeń do minimum publikacji | minimum niespełnione w więcej niż 1 z 3 przebiegów mimo zapasu | spełnienie minimum |
| Kontrola zakresu, zdradzania odpowiedzi, wyjaśnień | ćwiczenia poza zakresem celu, zdradzona odpowiedź, wyjaśnienie niezgodne z kluczem | dana klasa > 3% (rubryka) | spadek klasy |
| Słyszalność w słuchaniu (dziś `listen-audibility.ts`) | opcje nie do odróżnienia ze słuchu | wady słuchania > 3% zadań słuchania (rubryka) | spadek wad |
| Samodzielność po awarii gradera | ponowienie po awarii traci kontekst pierwszej próby | techniczne porażki > 1% ocen modelu na produkcji | odzyskane samodzielne zaliczenia |
| Szkoła: sędzia podpowiedzi i kontrola odpowiedzi otwartych (istnieją) | — | muszą wykazać korzyść w sondzie etapu 5 | inaczej usuwane |

## 9. Co zostaje, co znika

**Zostaje:** kontrole strukturalne (`pool-validation.ts`, `rules/core-rules.ts`, `exposure-leaks.ts`, `lesson-coverage.ts`, `calculation.ts`, `catalog-validation.ts`), identyczne duplikaty, ujawnienia, neutralna normalizacja oceny, rozwijanie skrótów tylko w porównaniach ujawnień i duplikatów, zasady samodzielności, postępu i historii, limity kosztu, timeouty, anulowanie, idempotencja, transakcje, niezmienność opublikowanego materiału, prywatność.

**Znika** — bez pozostawiania jako dodatkowe zabezpieczenie:

- etap 3: rozwijanie skrótów w dopasowaniu i kluczu cache, `acceptedAnswers` rozsypanki, dwie z trzech definicji typów zależnych od gradera;
- etap 4: heurystyki gramatyki (`present-continuous-*.ts`, `time-markers.ts`, `be-agreement.ts`, `present-simple-forms.ts`, heurystyczna część `validators.ts` i `rules.ts` z `*.rule-cases.ts` i migawkami promptu, `english/ing-forms.ts` w części gramatyki) i agent dla gramatyki;
- etap 5: heurystyki rozdziału i szkoły (`instruction_stimulus`, słownik „słowo spoza materiału”, `school/hint-gate.ts`, `termOccursIn`, `listen-audibility.ts` — o ile §8 nie uzasadni warstwy), pętla agenta z narzędziami, kod przyjmowania i kontrole `solve` / `judgeVariants`.

Ręczna edycja i publikacja szkicu przez rodzica przechodzi przez walidację struktury automatycznie, gdy heurystyki przedmiotu znikają; nie budujemy tymczasowego podziału walidatorów.

## 10. Kryterium prostoty

Mierzone w każdym PR etapu i na końcu epiku:

- **Linie kodu:** bilans ujemny w generowaniu i ocenie lekcji — usunięte heurystyki (ok. 4,7 tys.), ich opisy (830) i orkiestracja agenta; nowy przebieg (generowanie paczki, kontrola zamkniętych, porównanie) ma być mniejszy niż usuwany kod przyjmowania i agenta. PR podaje liczby dodanych i usuniętych linii poza testami.
- **Rodzaje wywołań modelu:** w generowaniu dwa (paczka, kontrola zamkniętych) plus dzisiejsze ustalanie zagadnień rozdziału i szkoły; w ocenie jeden (model oceniający).
- **Brak kodu, który rozumie język,** w walidacji i ocenie — poza neutralną normalizacją i rachunkami.
- **Każde nowe rozgałęzienie lub specjalny przypadek** w przebiegu PR uzasadnia według §8. Etap, który wymaga wielu takich przypadków, zatrzymuje się i wraca do właściciela.

## 11. Etapy i bramki

Każdy etap: osobna sesja, własny spec, plan, przegląd trzech krytyków i PR scalany przez właściciela.

1. **Ten spec** (PR dokumentacyjny).
2. **Przebieg bazowy jako prototyp i sonda gramatyki.** Warunek wstępny: scalone #328. Zakres: schemat kontroli zamkniętych i porównanie (§5) jako czyste funkcje domeny z testami, orkiestracja przebiegu bazowego jako prototyp w `tests/probes`, nowa zamrożona rubryka ślepej oceny, ćwiczenia wzorcowe dla kontroli zamkniętych, sonda §12.1. Warstwy z §8 ocenia się tylko wtedy, gdy przebieg bazowy przekroczy próg danej klasy, i tylko na tych samych paczkach. Kończy się decyzją właściciela na bramce.
3. **Ocena odpowiedzi** (równolegle z etapem 2): §6 i §7. Odbiór na próbkach §12.3 przez pełną ścieżkę oceny.
4. **Gramatyka na przebiegu bazowym** — wymaga ukończenia etapów 2 i 3 (usunięcie heurystyk nie może wyprzedzić nowej oceny odpowiedzi). Na starcie sprawdzić, że na produkcji nadal nie ma lekcji PC. Przebieg z §4–§5 w kodzie aplikacji na funkcjach z etapu 2, tylko warstwy uzasadnione w etapie 2, usunięcie heurystyk gramatyki i agenta dla gramatyki, Present Continuous jako pilot. Rozdział i szkoła zostają na agencie do etapu 5.
5. **Rozdział i szkoła na przebiegu bazowym** — z własną sondą i bramką (przebieg bazowy kontra agent; agent w rozdziale daje dziś 0 ujawnień). Planista rozdziału jako jedno wywołanie ze schematem; kontrole szkoły zostają tylko z dowodem (§8); usunięcie pętli agenta. Wariant awaryjny: przedmiot, w którym przebieg bazowy przegrywa, zostaje na agencie, a zamrożenie jego heurystyk zostaje zdjęte.

## 12. Sondy i bramki

### 12.1 Etap 2: generowanie gramatyki

- **Materiały** (fikcyjne, w repo): „to be”, Present Simple, Present Continuous.
- **Przebiegi:** przebieg bazowy i dzisiejszy agent, po 3 przebiegi na temat.
- **Ćwiczenia wzorcowe dla kontroli zamkniętych** (kontrola przechodzi przez nie bez generatora), z etykietami nadanymi według polityki tego specu i zatwierdzonymi w specu etapu 2, w trzech klasach: błędny klucz, druga poprawna odpowiedź, poprawne ćwiczenie (w tym rozsypanka z innym poprawnym szykiem, np. przestawialny wskaźnik „now” — to nie jest wada). Co najmniej 10 przypadków na klasę.
- **Miary:** ślepa ocena rubryką (błędny klucz, druga poprawna odpowiedź w zadaniu zamkniętym, dwuznaczne zadanie tekstowe, poza zakresem, zdradzona odpowiedź, wadliwe wyjaśnienie; różnorodność, poziom), `sceneShare` w celach porównania, minimum publikacji, koszt i czas runu, rozmiar prototypu (linie, rodzaje wywołań).

### 12.2 Bramka etapu 4 (decyzja właściciela)

- **progi bezwzględne per klasa** (bez sumowania klas), łącznie z 3 przebiegów, z licznikiem i mianownikiem — propozycja do zatwierdzenia przed płatnym przebiegiem: błędny klucz ≤ 1%, zadanie zamknięte z drugą poprawną odpowiedzią ≤ 1%, każda pozostała klasa ≤ 3%;
- porównanie z agentem w każdej klasie osobno: przebieg bazowy ≤ agent + 2 pp;
- minimum publikacji w 3 z 3 przebiegów każdego tematu;
- ćwiczenia wzorcowe: każda klasa wad wykryta w ≥ 80% przypadków, poprawne odrzucone w ≤ 10%;
- koszt i czas raportowane i oceniane przez właściciela; budżet runu (1 USD) to bezpiecznik, który można podnieść;
- `sceneShare` raportowane obok (cel ≥ 30% z #280, nie warunek bramki).

Przekroczony próg klasy nie zatrzymuje projektu automatycznie: uruchamia ocenę warstwy kandydującej z §8 dla tej klasy na tych samych paczkach. Stary zestaw testów heurystyk nie jest argumentem za ich zachowaniem; sama poprawność JSON nie jest dowodem jakości.

### 12.3 Etap 3: próbki odpowiedzi

Etykiety spisane przed przebiegiem, dla gramatyki i rozdziału: inne poprawne sformułowanie, poprawna odpowiedź inną formą (→ nieoceniony bez sukcesu celu), alternatywny szyk w rozsypance, odpowiedź częściowa, negacja zmieniająca sens, poprawna gramatyka bez wykonania polecenia, błąd w ćwiczonej formie, literówka w tokenie `focus` i poza nim, skróty (He has running wobec klucza „He's running.”, Yes, she's., Yes, I'm., Yes, they're., poprawne She's reading), pisownia amerykańska. Przez pełną ścieżkę oceny (dopasowanie → cache → model oceniający), także na starych rewizjach i przy wypełnionym cache: pary różniące się tylko skrótem wysyłane kolejno, w obu kolejnościach, dostają osobne werdykty. Progi (do zatwierdzenia w specu etapu 3): zero poprawnych odpowiedzi ocenionych jako błędne i zero zaliczonych odpowiedzi z klas „negacja zmieniająca sens”, „błąd w ćwiczonej formie” i „skrót niegramatyczny”.

## 13. Zgodność z istniejącymi danymi

- Opublikowane lekcje, szkice i historia prób się nie zmieniają; zmiana oceny dotyczy nowych prób, także w opublikowanych lekcjach.
- **Present Continuous nie ma na produkcji żadnych lekcji, szkiców ani runów** (właściciel, 2026-11-07): usunięcie heurystyk PC nie wymaga ścieżki zgodności. Do etapu 4 błędów heurystyk PC nie poprawiamy; #280 czeka na etap 4.
- Present Simple i „to be” mają lekcje na produkcji. Zamknięte ćwiczenia tych lekcji nie dostają automatycznego oznaczenia (ocena po ID nie woła modelu): dwuznaczne zostają do ręcznego przeglądu albo ponownego wygenerowania lekcji po etapie 4.
- Runy w toku przy wdrożeniu etapu 4/5 są anulowane i ponawiane od nowa z zachowanym wydatkiem.

## 14. Prywatność, koszty, integracje

- **Generator** dostaje to samo co dziś (materiał, polecenie rodzica, karty, zdania do unikania, tematy zdań) plus opis celu z katalogu. Nigdy imię, rok urodzenia, identyfikatory ani odpowiedzi dziecka.
- **Kontrola zadań zamkniętych** dostaje widok dziecka, w słuchaniu transkrypcję, w szkole materiał — nigdy polecenie rodzica, tematy zdań, karty ani dane dziecka. Opisać w panelu (`checkService`) i w `docs/architecture.md` §19.17 w etapie 4.
- **Model oceniający** — bez nowych danych; opis celu jest treścią katalogu.
- **Dzienniki** nie zawierają treści ćwiczeń ani powodów kontroli (jak dziś `detail` odrzuceń).
- **Koszty:** nowe nazwy operacji (generowanie paczki, kontrola zamkniętych) w `provider_usage_events` i §23 w etapie 4.
- **MCP, `SKILL.md`, `learning-overview`, Kid DTO** — bez zmian (raport Hermesa nie obejmuje lekcji); każdy PR podaje wpływ na API → MCP → skill.

## 15. Ryzyka

- **Zadania tekstowe bez kontroli generowania:** błędny klucz tekstowy zalicza się dokładnym dopasowaniem. Mierzy to rubryka; przekroczenie progu uruchamia warstwę z §8.
- **Dwuznaczne zadania tekstowe** nie krzywdzą dziecka (nieoceniony), ale dają mniej dowodów postępu. Mierzy to rubryka i odsetek takich wyników na produkcji.
- **Kontrola zamkniętych ma ślepy punkt modelu** — inna rodzina modelu niż generator, ćwiczenia wzorcowe z progiem wykrycia.
- **Dydaktyka tylko w prompcie może dryfować** (np. proporcja scenek) — mierzy to sonda.
- **Dwa systemy między etapami 4 i 5** — z wariantem awaryjnym z §11.

## 16. Obowiązki dokumentacyjne etapów

- **Etap 3:** `docs/architecture.md` §19 (ocena rozsypanki, wynik bez ćwiczonej formy, normalizacja, limit), AGENTS.md (model oceniający w lekcjach, `lessonGenerationAvailable`), `messages.ts`.
- **Etap 4:** `docs/architecture.md` §19.17 i §23, AGENTS.md (obowiązkowe `agentPolicy`, katalog reguł i migawka promptu, dane dla checkera, agent jako generator), spec kosztów.
- **Etap 5:** jak etap 4 dla rozdziału i szkoły; usunięcie opisu pętli agenta.

## 17. Zgłoszenia

- **#328** — warunek wstępny sondy etapu 2.
- **#288** — rozwiązują etapy 3 (wynik bez ćwiczonej formy) i 4 (generowanie z jednoznacznym kontekstem; kontrola dwuznaczności tylko jako warstwa z §8); zamknąć po etapie 3.
- **#280** — zakres dydaktyczny w opisach celów, bez reguł w kodzie; wraca po etapie 4.
- **#279** — niezależne; do czasu wdrożenia stały odbiorca.

## 18. Historia wersji

- **Wersja 1** (PR #357): kierunek i etapy.
- **Wersja 2** (#357, po trzech krytykach): kontrola paczki w dwóch wywołaniach, wynik „ćwiczenie dwuznaczne”, rozsypanka przez model oceniający, bez wyjątku pisowni.
- **Wersja 3** (PR #363, uwagi Codexa): dopasowanie bez rozwijania skrótów, ślepa kontrola bez opisu celu, transkrypcja w słuchaniu, bez oznaczeń starych zadań zamkniętych, progi bezwzględne.
- **Wersja 4** (cel właściciela z 2026-11-07, uwagi Codexa do wersji 3):
  - zostaje: dopasowanie i klucz cache bez rozwijania skrótów, ślepa kontrola bez celu (teraz tylko dla zadań zamkniętych), transkrypcja, progi bezwzględne, wynik bez ćwiczonej formy jako nieoceniony, rozsypanka przez model oceniający, decyzje rodzica bez przenoszenia, etap 4 po etapach 2 i 3, nowe etykiety ćwiczeń wzorcowych (przestawialny wskaźnik w rozsypance nie jest wadą);
  - wypada z przebiegu bazowego: drugie wywołanie kontroli z kluczem (`keyCorrect`, ocena kandydatów, `inScope`, `revealsAnswer`, `explanationConsistent`, `audible`), kontrola zadań tekstowych, runda naprawy, zachowywanie niesprawdzonych paczek i punkt kontrolny po paczce, limit liczony z planu sesji, osobne oznaczenie w panelu, tymczasowy podział walidatorów, reguła samodzielności po awarii — każde z nich wraca tylko przez §8.
