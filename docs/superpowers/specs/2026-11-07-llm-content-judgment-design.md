# Treść językową ocenia model, strukturę — kod: uproszczenie generowania i oceniania lekcji — design

Wersja 4, 2026-11-07, po przeglądzie Codexa i trzech krytyków. Przebudowana pod cel właściciela z 2026-11-07 (§2): prosty przebieg jest rozwiązaniem bazowym, a każda dodatkowa warstwa wymaga wskazanego problemu, dowodu z próbek i mierzalnej korzyści. Wersje 1–3 (PR #357, #363) opisywały rozbudowaną kontrolę generowania; co z nich zostało, a co wypadło — §18. Stan kodu: `origin/main` 2d3a5336.
Spec zbiorczy: zasada, przebieg bazowy, ocena odpowiedzi, warstwy kandydujące, kryterium prostoty, etapy i bramki. Każdy etap 2–5 dostaje na starcie własny szczegółowy spec, plan i przegląd trzech krytyków.
Powiązane: #358 (epik), #359–#362 (etapy), #237 (agent puli), #279 (poziom materiału), #280 (Present Continuous v2), #288 (dwuznaczne ćwiczenia Present Simple), #328 (zdania z kart w ujawnieniach).

## 1. Problem

Generowanie lekcji korzysta z LLM, a jednocześnie próbuje sprawdzać język naturalny kodem: składnię, czas gramatyczny, podmiot, czasowniki, wskaźniki czasu i poprawność dystraktorów. Heurystyki rosną z każdym tematem, a mimo to nie gwarantują jakości.

- **Rozmiar.** Heurystyki językowe w generowaniu lekcji to ok. 4,7 tys. linii (bez testów), z czego 3,9 tys. w `english_grammar` (`present-continuous-validation.ts` 1843, `present-continuous-tense-choice.ts` 471, `present-continuous-exercise-rules.ts` 433, `validators.ts` 488, `time-markers.ts` 374, `be-agreement.ts` 241), a do tego `english/ing-forms.ts` 247. Do tego 830 linii opisów tych reguł dla modelu (`english-grammar/rules.ts`) i ok. 1,6 tys. linii orkiestracji agenta (`domain/lessons/agent/`) z narzędziami i pętlą odrzuceń.
- **Prompt.** Prompt generatora Present Continuous ma 37,5 tys. znaków, w 89% to opisy reguł; agent wysyła go w każdym z maksymalnie 8 kroków.
- **Błędy w obie strony** (potwierdzone wywołaniem walidatora, 2026-11-06): poprawne „Tom is quietly reading a book.” odpada; błędne „Tom reading is.” przechodzi jako klucz rozsypanki; „food and drinks” w celach porównania czasów odpada jako drugi czasownik.
- **Kontrola nie daje dydaktyki.** Sondy PR #329: 4 z 18 ćwiczeń (próg 30%) podaje czas wyłącznie w polskiej scence; ślepa ocena Present Simple znalazła 25% ćwiczeń dwuznacznych obok Present Continuous (#288).
- **Koszt utrzymania, nie działania.** Przebieg sondy PC kosztował 0,12–0,14 USD. Drogi jest każdy nowy temat: parser, prompt, trzy rundy krytyków i trzy płatne sondy.

## 2. Cel i zasady

**Cel właściciela (2026-11-07):** uprościć aplikację przez powierzenie modelowi rozumienia języka i treści zadań. Po implementacji ma być mniej logiki do utrzymania. Samo zastąpienie heurystyk językowych rozbudowaną orkiestracją modeli nie spełnia tego celu.

> LLM odpowiada za tworzenie i rozumienie treści językowej. Kod odpowiada za strukturę danych, jednoznaczne porównania, obliczenia i niezawodny przebieg nauki.

**Kryterium sukcesu jest podwójne:** odpowiednia jakość nauki (§12) oraz wyraźnie prostsza implementacja (§10). Jeśli nowy proces wymaga wielu specjalnych przypadków, rozgałęzień i etapów kontroli, wracamy do właściciela, zanim pójdziemy dalej.

Zasady:

- **Kod nie rozumie języka.** Nie budujemy parserów czasów, list wszystkich dopuszczalnych konstrukcji, reguł rozstrzygających znaczenie zdania ani wyjątków dla konkretnych słów — we wszystkich przedmiotach i typach lekcji, wszędzie tam, gdzie ocena wymaga interpretacji treści. Jawne wyjątki wymienia §10.
- **Prosty przebieg jest bazowy** (§4–§7). Dodatkowa warstwa wchodzi tylko z wskazanym problemem, dowodem z próbek i mierzalną korzyścią (§8); bez tego jej nie budujemy, a warstwa bez wykazanej korzyści jest usuwana.
- **Zastępowane heurystyki są usuwane,** a nie zostają jako dodatkowe zabezpieczenie (§9).
- **Historia, postęp, samodzielność, prywatność i obsługa awarii** zostają odpowiedzialnością kodu, bez zmiany zasad.
- **Koszt.** Akceptujemy większy koszt mocnego modelu, jeśli daje poprawne ćwiczenia, sprawiedliwe ocenianie i prostszy system. Nie optymalizujemy tokenów kosztem własnego silnika językowego. Koszt i czas mierzymy i oceniamy w kontekście rodzinnej aplikacji edukacyjnej.

**Zamrożenie.** Do usunięcia heurystyk nie dodajemy nowych heurystyk językowych i nie poprawiamy istniejących (AGENTS.md). Jeśli na bramce etapu 4 lub 5 przedmiot zostaje na agencie (§11), zamrożenie heurystyk tego przedmiotu zostaje zdjęte.

## 3. Stan obecny (mapa z 2026-11-07)

**Zestawy słówek są już zgodne z zasadą:** model generuje pozycje (`providers/openai/llm.ts`), kontrole po generowaniu są strukturalne, ocena 9 typów jest deterministyczna (`domain/evaluate.ts`, `modules/learning/speech.ts`), a dystraktory dobiera kod z pozycji zestawu. Jedyna heurystyka (`english/material-phrase.ts` i zależności, ok. 500 linii: czy słowo stoi w materiale źródłowym) zostaje poza zakresem. **Słówek ten spec nie zmienia.**

**Generowanie lekcji:** zagadnienia z katalogu (`english_grammar`), z planisty (`english_chapter`, `planObjectives`, pętla do 8 kroków) albo z jednego wywołania (`school`). Dla każdego zagadnienia podagent `runObjective` (`ToolLoopAgent`, narzędzia `submit_exercises` / `remove_exercise`, do 8 kroków). Przyjęcie (`lesson-pool-agent-tools.ts`, `agent/admission.ts`): oczyszczenie, limity, zod, reguły rdzenia, `subject.validateExercise` (tu heurystyki), walidacja puli, ujawnienia, kontrole LLM (`solve` — jedno ślepe rozwiązanie, `judgeVariants` — zakłada poprawny klucz, w szkole `judgeHints` i `solveOpen` + grader), odrzucenia wracają do modelu. Kontroler nie wymienia wszystkich poprawnych odpowiedzi, a `lesson_notice`, `lesson_short_answer`, `lesson_listen_choice`, `lesson_keywords` i szkolna `lesson_order` nie mają żadnej kontroli LLM. Niedostępny checker przepuszcza ćwiczenie jako `unchecked`. Heurystyki blokują też ręczną edycję szkicu przez rodzica (`lesson-api.ts`, błąd 400).

**Ocena odpowiedzi w lekcjach:** zadania zamknięte (choice, listen_choice, short_answer, notice, keywords, match, group, cloze, order) i rachunki ocenia kod. Tekstowe (gap, error_fix, transform, open_answer): `matchLessonAnswer` → cache `lesson_verdicts` → grader. Ustalenia:

- **Skróty.** Normalizator rozwija skróty po obu stronach dopasowania, więc dokładne dopasowanie zalicza bez modelu „Yes, she's.”, „Yes, I'm.”, „Yes, they're.” wobec pełnych kluczy i „He has running.” wobec klucza „He's running.” (potwierdzone wywołaniem `matchLessonAnswer`). Klucz cache (`normalizedAnswerKey`, `lesson-attempts.ts:474`) bierze tę samą rozwiniętą postać, więc „Yes, she's.” i „Yes, she is.” dzielą werdykt.
- **Warianty.** Porównanie wariantu z kluczem (`variants.duplicate`, `withoutRedundantAcceptedVariants` przy przyjęciu, zapisie i publikacji szkicu, „uznaj jako wariant” w nadzorze rodzica) też rozwija skróty, więc wariant ze skrótem równoważny kluczowi jest odrzucany albo po cichu usuwany, a prompt agenta mówi, że skróty liczą się jako to samo. `focus` jest sprawdzany względem rozwiniętej formy (`focusCoversAnswer`).
- **Rozsypanka** ignoruje `acceptedAnswers` (`evaluateSequence`) — inny poprawny szyk to błąd, choć agent pisze warianty szyku (korzysta z nich jego ślepe rozwiązanie).
- **Grader:** brak konfiguracji, limit (domyślnie 20 na sesję) albo awaria → nieocenione, bez kary. Typy zależne od gradera (error_fix, transform, open_answer — luka celowo przechodzi bez gradera) są zdefiniowane identycznie w trzech miejscach (`scheduler.ts:151`, `lesson-sessions.ts:733`, `lesson-shorten.ts:39`), a domyślny limit też w trzech (`config-defaults.ts:41`, `config.ts:377`, `lesson-sessions.ts:80`). Bez gradera selektor woli zadania od niego niezależne (preferencja, nie wykluczenie). Nieocenione nie zmienia serii ani projekcji i zostawia zadanie do ponowienia; ponowienie jest kolejną próbą, więc już niesamodzielne.
- Werdykt `correct` daje sukces celu, także gdy odpowiedź nie używa ćwiczonej formy.

## 4. Przebieg bazowy generowania

Paczka to jeden cel i jeden typ ćwiczenia (decyzja właściciela). Zagadnienia powstają jak dziś (katalog, planista rozdziału, wywołanie szkoły). Typy paczek celu i liczby ćwiczeń wynikają z istniejącej polityki puli: typy celu z katalogu, minima etapów (`poolMinimums`) z rezerwą i zapasem przedmiotu, limit słuchania. Spec etapu 2 ustala tylko podział minimum etapu na jego typy.

1. **Generowanie** — jedno wywołanie mocnego modelu ze schematem wyniku (Zod). Prompt: cel i jego zakres zwykłym tekstem (dydaktyka przeniesiona z kodu do opisów celów w katalogu), odbiorca (stały jak dziś, do czasu #279 — potem poziom materiału, nigdy wiek ani rok urodzenia z profilu), materiał i przykłady rodzica, karta typu (format i jeden przykład), liczba ćwiczeń z zapasem, zdania do unikania jak dziś (`avoidSentencesFor`: przykłady kart i ćwiczenia szkicu — wspólny materiał, nigdy z historii dziecka; #328). Prompt wymaga poprawnych, jednoznacznych poleceń i kontekstu, który rozstrzyga odpowiedź, oraz form ze skrótem jako osobnych wariantów. Model generatora wybiera spec etapu 2.
2. **Walidacja kodem** każdego ćwiczenia — struktura danych, wymagane pola, identyfikatory i powiązania, możliwość wyświetlenia i rozwiązania (klucz wśród opcji, klocki składają się na klucz, słowo `lesson_notice` występuje w zdaniu dokładnie raz). Rachunki liczy kod.
3. **Kontrola zadań zamkniętych** — jedno wywołanie na paczkę typu zamkniętego (§5).
4. **Odrzucone ćwiczenia odpadają.** Nie ma rund naprawy. Zapas w zamówieniu pokrywa typowe odrzucenia; brak do minimum publikacji rodzic widzi jako lukę celu i uzupełnia istniejącym dogenerowaniem.

Paczki jednego celu idą równolegle. Po kontrolach działa jedna walidacja całej puli: ujawnienia i identyczne duplikaty. Przy kolizji odpada ćwiczenie późniejsze w istniejącej kolejności lekcji (cel → etap → pozycja, jak w `lessonLeaks`), więc wynik nie zależy od tego, które wywołanie skończy się pierwsze.

**Niepowodzenie.** Wywołanie modelu (generowanie albo kontrola), które skończy się błędem technicznym, ma jedno ponowienie; potem zagadnienie kończy się porażką z kodem dostawcy, a run korzysta z istniejących automatycznych ponowień (`MAX_AUTOMATIC_ATTEMPTS`). Po ich wyczerpaniu rodzic widzi czytelny stan niepowodzenia. Ćwiczenie niesprawdzone nigdy nie trafia do szkicu. Bez pętli samonaprawy i kolejnych warstw awaryjnych; punkt kontrolny zostaje na poziomie celu, jak dziś.

**Klient modelu.** AI SDK zostaje (`generateText` z `Output.object`, routing OpenRouter, `tracked` do kosztów, timeouty, anulowanie), adapter w `providers/openai/lesson-pool-agent.ts`. Pętla `ToolLoopAgent` z narzędziami znika.

## 5. Kontrola zadań zamkniętych

**Problem:** ocena po ID nie uratuje zadania z dwiema poprawnymi opcjami ani z błędnym kluczem — dziecko dostaje „źle” za dobrą odpowiedź. To jedyna kontrola generowania w przebiegu bazowym.

- **Typy:** choice, listen_choice, short_answer, notice, keywords, match, group, cloze, order. Gramatyka (etapy 2 i 4) używa notice, choice, listen_choice, order i short_answer. Kontrakty match, group, cloze i keywords (komplet dla przypisań wielu pól, paczka keywords po paczce `lesson_open_answer`, z którą jest sparowana) ustala spec etapu 5.
- **Wejście:** to, co widzi lub słyszy dziecko — widok ćwiczenia bez wyjaśnień, w `lesson_listen_choice` transkrypcja nagrania, w szkole materiał lekcji, który dziecko poznało. Bez opisu celu: cel („Present Simple”) naprowadzałby na ćwiczoną formę i ukrywał drugą poprawną odpowiedź.
- **Dwa kontrakty, zależnie od sposobu odpowiadania.** Paczka ma jeden typ, więc jedno wywołanie ma jeden kontrakt:
  - **wybór i przypisanie** (wszystkie poza rozsypanką): model bez klucza podaje komplet poprawnych odpowiedzi tekstami (nie ID; opcje o tym samym tekście są zamienne, #298), albo „żadna nie jest poprawna”, albo „nie wiem”. Kod porównuje komplet z kluczem (zbiory i przypisania w całości) i przepuszcza tylko równość — tak wychodzi i błędny klucz, i druga poprawna opcja;
  - **rozsypanka** (order): model dostaje polecenie, klocki i ułożony z nich klucz i odpowiada, czy klucz jest poprawną odpowiedzią na polecenie: „tak”, „nie” albo „nie wiem”. Przepuszcza tylko „tak”. Innych szyków nie wyliczamy — inny poprawny szyk ułożony przez dziecko ocenia model oceniający (§6).
- **Każdy inny wynik usuwa ćwiczenie.**

Rachunki sprawdza kod (`calculation.ts`); pytania do historyjki są poza zakresem. Zadania tekstowe w przebiegu bazowym nie mają kontroli generowania — chroni je ocena odpowiedzi (§6), a ewentualna kontrola to warstwa kandydująca (§8).

## 6. Ocena odpowiedzi dziecka

| Zadania | Ocena |
|---|---|
| Słówka (9 typów), rachunki, pytania do historyjki | kod, bez zmian |
| choice, listen_choice, short_answer, notice, keywords, match, group, cloze | kod, po ID / przypisaniu, bez zmian |
| `lesson_order` | kod: klucz → zaliczenie; inny szyk → cache → model oceniający |
| gap, error_fix, transform, open_answer | zatwierdzony wariant → zaliczenie; inna odpowiedź → cache → model oceniający |

- **Model oceniający** dostaje polecenie, kontekst widoczny dla dziecka i cel ćwiczenia, i ocenia poprawność oraz to, czy odpowiedź ćwiczy cel (pole `usesTargetForm`). „Poprawna” znaczy: wykonuje polecenie. Pominięcie formy, której wymaga polecenie (np. w `lesson_transform` zdanie powtórzone bez zmiany), to błąd. Wynik „bez ćwiczonej formy” dotyczy tylko odpowiedzi, na które polecenie i kontekst pozwalają, np. „She is reading a book.” w tłumaczeniu na Present Simple bez wskaźnika „zwykle” (#288).
- **Wynik „bez ćwiczonej formy”** jest nową odmianą wyniku nieocenionego: bez kary i bez sukcesu celu, a zadanie się zamyka i nie wraca do ponowienia (nowa gałąź w `nextLessonTaskState`; dziś nieocenione zostaje do ponowienia). Dziecko widzi „Dobrze!” i formę ćwiczoną w lekcji (ekspozycja zapisana przed wysłaniem, jak przy `model_almost`), rodzic — komentarz modelu w istniejącym miejscu. Cache zapisuje `usesTargetForm` (migracja `lesson_verdicts`), więc trafienie w cache daje ten sam wynik co żywe wywołanie, a osobna wartość werdyktu w szczegółach oceny pozwala policzyć wyzwalacz z §8. Flaga trafia do DTO rodzica, nigdy do Kid DTO ani MCP.
- **Dopasowanie i klucz cache bez rozwijania skrótów.** `matchLessonAnswer` i klucz cache używają `baseNormalizer` (`normalize.ts`): wielkość liter, interpunkcja, ujednolicone apostrofy i spacje. `englishNormalizer` i `contractions.ts` zostają bez zmian (słówka, ujawnienia). Klucz cache zachowuje każdą inną różnicę, także w pisowni i skrótach, więc odpowiedzi różniące się literą albo skrótem nie dzielą werdyktu. Skrót zalicza się bez modelu tylko wtedy, gdy dokładnie ta forma jest w kluczu albo wariantach; każdą inną odpowiedź ze skrótem ocenia model. To usunięcie kodu, nie nowa reguła; działa dla wszystkich rewizji, także opublikowanych lekcji.
- **Literówki.** Tolerancja jednej literówki poza `focus` jest regułą porównania z zatwierdzonym wariantem i nie wchodzi do klucza cache. Działa tylko wtedy, gdy `focus` występuje dosłownie w wariancie po neutralnej normalizacji; inaczej focus liczy się jako pusty, czyli bez tolerancji (istniejąca reguła). Przykład: stara rewizja z kluczem „She doesn't like tea.” i focus „does not” nie zaliczy „She don't like tea.” jako literówki.
- **Warianty.** Porównanie wariantu z kluczem i z innymi wariantami (`variants.duplicate`, `withoutRedundantAcceptedVariants`, „uznaj jako wariant”) używa tej samej neutralnej normalizacji, więc wariant ze skrótem zostaje; dopisek promptu agenta „contractions count as the same” zmienia się na polecenie wpisywania form ze skrótem jako osobnych wariantów. Rozwijanie skrótów zostaje tylko w ujawnieniach i w duplikatach między ćwiczeniami albo opcjami, gdzie nadmiarowe wykrycie jest bezpieczne.
- **Rozsypanka.** Inny szyk (UI składa go tylko z wydanych klocków) idzie do modelu oceniającego nową ścieżką sekwencji (dziś grader dostaje tylko tekst). Bez gradera albo po limicie każdy inny szyk jest nieoceniony, a nie jak dziś błędny. Dotyczy też szkolnej rozsypanki (kroki procesu). `acceptedAnswers` rozsypanki nie są używane w ocenie (już dziś); decyzja rodzica działa przez cache werdyktów. Agent przestaje je generować dopiero razem ze swoim usunięciem (etapy 4–5), bo korzysta z nich jego ślepe rozwiązanie.
- **Nowa wersja promptu** modelu oceniającego (nowy klucz cache). Stare werdykty i decyzje rodzica zostają historią i nie są przenoszone; panel decyzji pokazuje werdykty bieżącej wersji. Pod nową wersją decyzja rodzica dotyczy jednej odpowiedzi i ma pierwszeństwo przed werdyktem modelu: „uznaj” oznacza sukces celu, „odrzuć” — błąd. Działa na kolejne identyczne odpowiedzi i nie przepisuje zakończonych ocen ani projekcji (jak dziś).
- **Bez zmian:** ocena szkolna (wiedza i precyzja, kryteria z materiału), decyzja rodzica nadpisująca werdykt, brak tolerancji literówek w tokenach `focus`. Bez osobnego wyjątku pisowni — model oceniający przypisuje kategorię `spelling`.

## 7. Model oceniający: dostępność i limit

1. **Brak konfiguracji** wykrywamy przed nauką: generowanie lekcji wymaga pełnej konfiguracji `UMIEM_GRADER_*`. To jeden warunek w `lessonAgentPublicFromEnv` (`config.ts`), więc panel pokazuje istniejący stan „generowanie niedostępne”, a tryb fake zwraca wynik przed tym warunkiem. Opublikowane lekcje działają jak dziś.
2. **Awaria działającej usługi** — bez zmian: nieocenione, bez kary, zadanie do ponowienia. Utrata samodzielności przy ponowieniu jest warstwą kandydującą (§8).
3. **Limit:** jedna stała typów zależnych od gradera (dzisiejsze trzy) i jedna wartość domyślna limitu zamiast trzech kopii. Luka i rozsypanka zostają dostępne bez gradera: klucz ocenia kod, inna odpowiedź jest nieoceniona. Domyślny limit pokrywa największy budżet sesji (100 zadań) z zapasem na ponowienia; istniejąca rezerwacja wywołań z planu sesji zostaje.

## 8. Warstwy dodatkowe — tylko z dowodem

Warstwa wchodzi do kodu tylko wtedy, gdy ma: (a) nazwany problem, (b) dowód z próbek — sondy albo produkcji — powyżej progu, (c) mierzalną korzyść wobec przebiegu bazowego na tych samych paczkach lub próbkach (bez dodatkowego generowania, gdzie to możliwe), (d) opisany koszt złożoności. Najpierw próbujemy prostych zmian przebiegu bazowego: promptu, wyboru modelu, wielkości zapasu; warstwę rozważamy dopiero, gdy one nie wystarczą. Decyzję podejmuje właściciel. Warstwa, która nie wykaże korzyści, jest usuwana. **Tabela nie jest planem prac.**

| Kandydat | Problem | Wyzwalacz | Miara korzyści |
|---|---|---|---|
| Kontrola klucza zadań tekstowych | błędny klucz zaliczany dokładnym dopasowaniem bez modelu | klasa „błędny klucz” w zadaniach tekstowych powyżej progu §12.2 | spadek błędnych kluczy na tych samych paczkach |
| Kontrola dwuznaczności zadań tekstowych | dużo wyników „bez ćwiczonej formy” | klasa „dwuznaczne zadanie tekstowe” powyżej progu §12.2 albo ten wynik w > 5% ocen modelu na produkcji | spadek dwuznacznych |
| Jedna runda naprawy | za mało ćwiczeń do minimum publikacji | minimum z §12.2 niespełnione po zmianach promptu, modelu i zapasu | minimum w 3 z 3 przebiegów |
| Kontrola zakresu, zdradzania odpowiedzi, wyjaśnień | ćwiczenia poza zakresem celu, zdradzona odpowiedź, wyjaśnienie niezgodne z kluczem | dana klasa powyżej progu §12.2 | spadek klasy |
| Słyszalność w słuchaniu (dziś `listen-audibility.ts`) | opcje nie do odróżnienia ze słuchu | ta klasa powyżej progu §12.2 | spadek wad |
| Samodzielność po awarii gradera | ponowienie po awarii traci kontekst pierwszej próby | > 1% ocen modelu na produkcji kończy się awarią techniczną | odzyskane samodzielne zaliczenia |
| Szkoła: sędzia podpowiedzi i kontrola odpowiedzi otwartych (istnieją) | — | muszą wykazać korzyść w sondzie etapu 5 | inaczej usuwane |

Wyzwalacze produkcyjne sprawdza ręczne zapytanie na bramce etapu (osobne wartości werdyktu z etapu 3), bez nowej telemetrii.

## 9. Co zostaje, co znika

**Zostaje:** kontrole strukturalne (`pool-validation.ts`, `rules/core-rules.ts`, `exposure-leaks.ts`, `lesson-coverage.ts`, `calculation.ts`, `catalog-validation.ts`), identyczne duplikaty, ujawnienia, neutralna normalizacja oceny, rozwijanie skrótów tylko w ujawnieniach i duplikatach między ćwiczeniami albo opcjami, zasady samodzielności, postępu i historii, limity kosztu, timeouty, anulowanie, idempotencja, transakcje, niezmienność opublikowanego materiału, prywatność.

**Znika** — bez pozostawiania jako dodatkowe zabezpieczenie:

- etap 3: rozwijanie skrótów w dopasowaniu, kluczu cache i porównaniu wariantów, dwie z trzech kopii typów zależnych od gradera i wartości domyślnej limitu;
- etap 4: heurystyki gramatyki (`present-continuous-*.ts`, `time-markers.ts`, `be-agreement.ts`, `present-simple-forms.ts`, heurystyczna część `validators.ts` i `rules.ts` z `*.rule-cases.ts` i migawkami promptu, `english/ing-forms.ts` w części gramatyki) i agent dla gramatyki, razem z generowaniem `acceptedAnswers` rozsypanki;
- etap 5: heurystyki rozdziału i szkoły (`instruction_stimulus`, słownik „słowo spoza materiału”, `school/hint-gate.ts`, `termOccursIn`, `listen-audibility.ts` — o ile §8 nie uzasadni warstwy), pętla agenta z narzędziami, kod przyjmowania i kontrole `solve` / `judgeVariants`.

Ręczna edycja i publikacja szkicu przez rodzica przechodzi przez walidację struktury automatycznie, gdy heurystyki przedmiotu znikają; nie budujemy tymczasowego podziału walidatorów.

## 10. Kryterium prostoty

- **Linie kodu poza testami** na stałej liście ścieżek. Stan bazowy na 2d3a5336:
  - generowanie: `domain/lessons/agent/` (1582), `domain/lessons/subjects/` bez `*.rule-cases.ts` (9312), `modules/materials/lessons/lesson-agent-*` i `lesson-pool-agent*` (3245), `providers/openai/lesson-pool-agent.ts` (802);
  - ocena: `domain/lessons/evaluate.ts` (736), `modules/learning/lessons/` (4679).

  Każdy PR etapu podaje bilans na tych ścieżkach. Bilans ujemny jest wymagany w etapach 4 i 5 i na końcu epiku; etapy 2 i 3 podają liczby.
- **Rodzaje wywołań modelu:** w generowaniu dwa — paczka i kontrola zamkniętych z dokładnie dwoma kontraktami (trzeci kontrakt to warstwa z §8) — plus dzisiejsze ustalanie zagadnień rozdziału i szkoły; w ocenie jeden (model oceniający).
- **Brak kodu, który rozumie język,** w walidacji i ocenie. Jawne wyjątki: neutralna normalizacja, tolerancja literówki (odległość edycyjna), rachunki, rozwijanie skrótów w ujawnieniach i duplikatach między ćwiczeniami albo opcjami.
- **Rozgałęzienia zależne od przedmiotu lub typu** PR wymienia z uzasadnieniem (struktura danych albo §8). Etap, który wymaga wielu takich przypadków, zatrzymuje się i wraca do właściciela.

## 11. Etapy i bramki

Każdy etap: osobna sesja, własny spec, plan, przegląd trzech krytyków i PR scalany przez właściciela.

1. **Ten spec** (PR dokumentacyjny).
2. **Przebieg bazowy i sonda gramatyki.** Warunek wstępny: scalone #328. Zakres: przebieg z §4–§5 napisany raz, w kodzie aplikacji (`modules/materials/lessons/` i adapter), bez podłączenia do workera, tylko dla typów gramatyki. Schemat kontroli i porównanie jako czyste funkcje domeny z testami. Sonda woła ten kod, jak dziś `agent-generation.probe.test.ts` woła `runLessonPoolAgent`, i nie ma własnych reguł. Do tego nowa zamrożona rubryka ślepej oceny, ćwiczenia wzorcowe dla kontroli zamkniętych i sonda §12.1. Warstwy z §8 ocenia się tylko wtedy, gdy przebieg bazowy przekroczy próg, i tylko na tych samych paczkach. Kończy się decyzją właściciela na bramce.
3. **Ocena odpowiedzi** (równolegle z etapem 2): §6 i §7. Odbiór na próbkach §12.3 przez pełną ścieżkę oceny.
4. **Gramatyka na przebiegu bazowym** — wymaga ukończenia etapów 2 i 3 (usunięcie heurystyk nie może wyprzedzić nowej oceny odpowiedzi). Na starcie sprawdzić, że na produkcji nadal nie ma lekcji PC. Podłączenie przebiegu z etapu 2 do workera dla gramatyki, tylko warstwy uzasadnione w etapie 2, usunięcie heurystyk gramatyki i agenta dla gramatyki, Present Continuous jako pilot. Rozdział i szkoła zostają na agencie do etapu 5.
5. **Rozdział i szkoła na przebiegu bazowym** — z własną sondą i bramką (przebieg bazowy kontra agent; agent w rozdziale daje dziś 0 ujawnień). Kontrakty match, group, cloze i keywords (§5); planista rozdziału jako jedno wywołanie ze schematem; kontrole szkoły zostają tylko z dowodem (§8); usunięcie pętli agenta. Wariant awaryjny: przedmiot, w którym przebieg bazowy przegrywa, zostaje na agencie, a zamrożenie jego heurystyk zostaje zdjęte.

## 12. Sondy i bramki

### 12.1 Etap 2: generowanie gramatyki

- **Materiały** (fikcyjne, w repo): „to be”, Present Simple, Present Continuous.
- **Przebiegi:** przebieg bazowy i dzisiejszy agent, po 3 przebiegi na temat.
- **Ćwiczenia wzorcowe dla kontroli zamkniętych** (kontrola przechodzi przez nie bez generatora), z etykietami nadanymi według polityki tego specu i zatwierdzonymi w specu etapu 2, w trzech klasach: błędny klucz (także w rozsypance), druga poprawna odpowiedź (typy z opcjami), poprawne ćwiczenie (w tym rozsypanka, w której inny szyk też jest poprawny, np. przestawialny wskaźnik „now” — to nie jest wada). Co najmniej 10 przypadków na klasę.
- **Miary:** ślepa ocena rubryką (błędny klucz osobno w zadaniach zamkniętych i tekstowych, druga poprawna odpowiedź w zadaniu zamkniętym, dwuznaczne zadanie tekstowe, poza zakresem, zdradzona odpowiedź, wadliwe wyjaśnienie, opcje nie do odróżnienia ze słuchu; różnorodność, poziom), `sceneShare` w celach porównania, minimum publikacji, koszt i czas runu, rozmiar kodu i rodzaje wywołań (§10).

### 12.2 Bramka etapu 4 (decyzja właściciela)

- **progi bezwzględne per klasa** (bez sumowania klas), łącznie z 3 przebiegów, z licznikiem i mianownikiem — propozycja do zatwierdzenia przed płatnym przebiegiem: błędny klucz ≤ 1% (osobno zamknięte i tekstowe), zadanie zamknięte z drugą poprawną odpowiedzią ≤ 1%, każda pozostała klasa ≤ 3%;
- porównanie z agentem w każdej klasie osobno: przebieg bazowy ≤ agent + 2 pp;
- minimum publikacji w 3 z 3 przebiegów każdego tematu;
- ćwiczenia wzorcowe: każda klasa wad wykryta w ≥ 80% przypadków, poprawne odrzucone w ≤ 10%;
- koszt i czas raportowane i oceniane przez właściciela; budżet runu (1 USD) to bezpiecznik, który można podnieść;
- `sceneShare` raportowane obok (cel ≥ 30% z #280, nie warunek bramki).

Przekroczony próg (klasy albo minimum publikacji) nie zatrzymuje projektu automatycznie: najpierw zmieniamy prompt, model albo zapas i powtarzamy pomiar; dopiero gdy to nie wystarcza, oceniamy warstwę kandydującą z §8 dla tego problemu. Stary zestaw testów heurystyk nie jest argumentem za ich zachowaniem; sama poprawność JSON nie jest dowodem jakości.

### 12.3 Etap 3: próbki odpowiedzi

Etykiety spisane przed przebiegiem, dla gramatyki, rozdziału i szkolnej rozsypanki:

- inne poprawne sformułowanie;
- poprawna odpowiedź inną formą, na którą pozwala polecenie (→ „bez ćwiczonej formy”);
- polecenie niewykonane, np. zdanie do przekształcenia powtórzone bez zmiany (→ błąd);
- alternatywny szyk w rozsypance, także w krokach procesu;
- odpowiedź częściowa, negacja zmieniająca sens, błąd w ćwiczonej formie;
- literówka w tokenie `focus` i poza nim, także na starej rewizji z focusem zapisanym względem rozwiniętej formy („She don't like tea.” wobec klucza „She doesn't like tea.”);
- skróty: He has running wobec klucza „He's running.”, Yes, she's., Yes, I'm., Yes, they're., poprawne She's reading, wariant ze skrótem dopisany przez rodzica;
- pisownia amerykańska.

Przez pełną ścieżkę oceny (dopasowanie → cache → model oceniający), także na starych rewizjach i przy wypełnionym cache. Pary różniące się tylko skrótem, wysyłane kolejno w obu kolejnościach, dostają osobne werdykty, a powtórzona odpowiedź „bez ćwiczonej formy” dostaje z cache ten sam wynik.

Progi (do zatwierdzenia w specu etapu 3):

- zero poprawnych odpowiedzi ocenionych jako błędne;
- zero zaliczonych odpowiedzi z klas „negacja zmieniająca sens”, „błąd w ćwiczonej formie” i „skrót niegramatyczny”;
- zero „Dobrze!” przy niewykonanym poleceniu;
- zero odpowiedzi ćwiczoną formą ocenionych jako „bez ćwiczonej formy”.

## 13. Zgodność z istniejącymi danymi

- Opublikowane lekcje, szkice i historia prób się nie zmieniają; zmiana oceny dotyczy nowych prób, także w opublikowanych lekcjach.
- Opublikowane rewizje mogą nie mieć wariantów ze skrótem (dotychczasowe porównanie wariantów je usuwało), więc po etapie 3 takie odpowiedzi ocenia model; rodzic może dopisać wariant w nowym szkicu.
- **Present Continuous nie ma na produkcji żadnych lekcji, szkiców ani runów** (właściciel, 2026-11-07): usunięcie heurystyk PC nie wymaga ścieżki zgodności. Do etapu 4 błędów heurystyk PC nie poprawiamy; #280 czeka na etap 4.
- Present Simple i „to be” mają lekcje na produkcji. Zamknięte ćwiczenia tych lekcji nie dostają automatycznego oznaczenia (ocena po ID nie woła modelu): dwuznaczne zostają do ręcznego przeglądu albo ponownego wygenerowania lekcji po etapie 4.
- Runy w toku przy wdrożeniu etapu 4/5 są anulowane istniejącym anulowaniem; rodzic ponawia je przez „Ponów” (#299).

## 14. Prywatność, koszty, integracje

- **Generator** dostaje to samo co dziś (materiał, polecenie rodzica, karty, zdania do unikania, tematy zdań) plus opis celu z katalogu. Nigdy imię, rok urodzenia, identyfikatory ani odpowiedzi dziecka.
- **Kontrola zadań zamkniętych** dostaje widok dziecka, w słuchaniu transkrypcję, w rozsypance ułożony klucz, w szkole materiał — nigdy polecenie rodzica, tematy zdań, karty ani dane dziecka. Opisać w panelu (`checkService`) i w `docs/architecture.md` §19.17 w etapie 4.
- **Model oceniający** — bez nowych danych: opis celu jest treścią katalogu, a ułożony szyk rozsypanki to odpowiedź dziecka przekazywana jako dane, jak tekst.
- **Dzienniki** nie zawierają treści ćwiczeń ani powodów kontroli (jak dziś `detail` odrzuceń).
- **Koszty:** nowe nazwy operacji (generowanie paczki, kontrola zamkniętych) w `provider_usage_events` i §23 w etapie 4.
- **MCP, `SKILL.md`, `learning-overview`, Kid DTO** — bez zmian (raport Hermesa nie obejmuje lekcji); każdy PR podaje wpływ na API → MCP → skill.

## 15. Ryzyka

- **Zadania tekstowe bez kontroli generowania:** błędny klucz tekstowy zalicza się dokładnym dopasowaniem. Mierzy to rubryka; przekroczenie progu uruchamia ścieżkę z §8.
- **Dwuznaczne zadania tekstowe** nie krzywdzą dziecka (wynik „bez ćwiczonej formy”), ale dają mniej dowodów postępu. Mierzy to rubryka i odsetek takich wyników na produkcji.
- **Rozsypanka bez gradera:** inny szyk jest nieoceniony zamiast błędny — mniej dowodów, ale bez fałszywego sukcesu i bez kary.
- **Kontrola zamkniętych ma ślepy punkt modelu** — inna rodzina modelu niż generator, ćwiczenia wzorcowe z progiem wykrycia.
- **Dydaktyka tylko w prompcie może dryfować** (np. proporcja scenek) — mierzy to sonda.
- **Dwa systemy między etapami 4 i 5** — z wariantem awaryjnym z §11.

## 16. Obowiązki dokumentacyjne etapów

- **Etap 3:** `docs/architecture.md` §19 (ocena rozsypanki, wynik „bez ćwiczonej formy”, normalizacja i warianty, limit), AGENTS.md (model oceniający w lekcjach, warunek dostępności generowania), `messages.ts`; migracja Drizzle `lesson_verdicts` ze schematem TypeScript.
- **Etap 4:** `docs/architecture.md` §19.17 i §23, AGENTS.md (obowiązkowe `agentPolicy`, katalog reguł i migawka promptu, dane dla checkera, agent jako generator), spec kosztów.
- **Etap 5:** jak etap 4 dla rozdziału i szkoły; usunięcie opisu pętli agenta.

## 17. Zgłoszenia

- **#328** — warunek wstępny sondy etapu 2.
- **#288** — rozwiązują etapy 3 (wynik „bez ćwiczonej formy”) i 4 (generowanie z jednoznacznym kontekstem; kontrola dwuznaczności tylko jako warstwa z §8); zamknąć po etapie 3.
- **#280** — zakres dydaktyczny w opisach celów, bez reguł w kodzie; wraca po etapie 4.
- **#279** — niezależne; do czasu wdrożenia stały odbiorca.

## 18. Historia wersji

- **Wersje 1–3** (PR #357, #363): kierunek i etapy, potem rozbudowana kontrola paczki (dwa wywołania, naprawa) i poprawki Codexa (dopasowanie bez rozwijania skrótów, ślepa kontrola bez celu, transkrypcja, progi bezwzględne).
- **Wersja 4** (cel właściciela z 2026-11-07, uwagi Codexa do wersji 3):
  - zostaje: dopasowanie i klucz cache bez rozwijania skrótów, ślepa kontrola bez celu (teraz tylko dla zadań zamkniętych), transkrypcja, progi bezwzględne, wynik bez ćwiczonej formy, rozsypanka przez model oceniający, decyzje rodzica bez przenoszenia, etap 4 po etapach 2 i 3, nowe etykiety ćwiczeń wzorcowych (przestawialny wskaźnik w rozsypance nie jest wadą);
  - wypada z przebiegu bazowego: drugie wywołanie kontroli z kluczem (`keyCorrect`, ocena kandydatów, `inScope`, `revealsAnswer`, `explanationConsistent`, `audible`), kontrola zadań tekstowych, runda naprawy, zachowywanie niesprawdzonych paczek i punkt kontrolny po paczce, limit liczony z planu sesji, osobne oznaczenie w panelu, tymczasowy podział walidatorów, reguła samodzielności po awarii — każde z nich wraca tylko przez §8.
- **Poprawki wersji 4 przed scaleniem** (review Codexa PR #364 i trzech krytyków):
  - rozsypanka: kontrola poprawności klucza zamiast kompletu szyków; dwa kontrakty kontroli;
  - klucz cache bez tolerancji literówek; dopasowanie i klucz cache na `baseNormalizer`, warianty i `focus` na tej samej normalizacji, tolerancja literówki tylko przy dosłownym `focus`;
  - wynik „bez ćwiczonej formy”: niewykonane polecenie to błąd, zapis w cache (migracja), nowa gałąź stanu zadania;
  - grader: dzisiejsze trzy typy w jednej stałej (luka i rozsypanka dalej bez gradera), dostępność jednym warunkiem w `lessonAgentPublicFromEnv`;
  - przebieg: liczby ćwiczeń z polityki puli, jedna walidacja puli w kolejności lekcji, etap 2 pisze przebieg raz w kodzie aplikacji tylko dla typów gramatyki;
  - jeden próg minimum publikacji w §8 i §12, najpierw prompt, model i zapas; wyzwalacze §8 odwołują się do progów §12.2;
  - kryterium prostoty: stała lista ścieżek z liczbami bazowymi, bilans ujemny od etapu 4, jawne wyjątki;
  - poprawki faktów w §1 i §3.
