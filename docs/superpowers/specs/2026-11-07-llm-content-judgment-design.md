# Treść językową ocenia model, strukturę — kod: uproszczenie generowania i oceniania lekcji — design

Wersja 1, 2026-11-07. Status: kierunek zaakceptowany przez właściciela (czat 2026-11-07, po przeglądzie Codexa i Claude'a, sekcje §4–§9 zaakceptowane osobno). Stan kodu: `origin/main` 2d3a5336.
Spec zbiorczy: ustala zasadę, kontrakty i etapy. Każdy etap 2–5 dostaje na starcie własny szczegółowy spec, plan i przegląd trzech krytyków.
Powiązane: #237 (agent puli), #279 (poziom materiału), #280 (Present Continuous v2), #288 (dwuznaczne ćwiczenia Present Simple), #328 (zdania z kart w ujawnieniach), #253 (agent dla zestawów słówek).

## 1. Problem

Generowanie lekcji korzysta z LLM, a jednocześnie próbuje sprawdzać język naturalny kodem: składnię, czas gramatyczny, podmiot, czasowniki, wskaźniki czasu i poprawność dystraktorów. Heurystyki rosną z każdym tematem, a mimo to nie gwarantują jakości.

- **Rozmiar.** Heurystyki językowe w generowaniu lekcji to ok. 4,7 tys. linii (bez testów), z czego 3,9 tys. w `english_grammar`: `present-continuous-validation.ts` 1843, `present-continuous-tense-choice.ts` 471, `present-continuous-exercise-rules.ts` 433, `validators.ts` 488, `time-markers.ts` 374, `be-agreement.ts` 241, `english/ing-forms.ts` 247. Do tego 830 linii opisów tych reguł dla modelu (`english-grammar/rules.ts`, 92 reguły, w tym 70 `pc_*`).
- **Prompt.** Prompt generatora Present Continuous ma 37,5 tys. znaków, w 89% to opisy reguł; agent wysyła go w każdym z maksymalnie 8 kroków. Present Simple: 18,4 tys., „to be”: 22,2 tys.
- **Błędy w obie strony** (potwierdzone wywołaniem walidatora, 2026-11-06): poprawne „Tom is quietly reading a book.” odpada (`pc_sentence_not_continuous` — między „is” a -ing dopuszczone są tylko now/all/both); błędne „Tom reading is.” przechodzi jako klucz rozsypanki; „food and drinks” w celach porównania czasów odpada jako drugi czasownik (świadomy kompromis, `present-continuous-tense-choice.ts:119`).
- **Kontrola nie daje dydaktyki.** Sondy PR #329: 4 z 18 ćwiczeń (próg 30%) podaje czas wyłącznie w polskiej scence, w drugiej sondzie 0 z 26. Ślepa ocena Present Simple znalazła 25% ćwiczeń dwuznacznych obok Present Continuous (#288).
- **Koszt utrzymania, nie działania.** Przebieg sondy PC kosztował 0,12–0,14 USD przy 13% odrzuceń. Drogi jest każdy nowy temat: parser, prompt, trzy rundy krytyków i trzy płatne sondy.

Punkt odniesienia właściciela to wartość nauki i czas rodzica (korepetytor ok. 80 zł za niecałą godzinę). Minimalna liczba wywołań modelu nie jest celem; koszty są mierzone i ograniczane.

## 2. Zasada

> LLM odpowiada za tworzenie i rozumienie treści językowej. Kod odpowiada za strukturę danych, jednoznaczne porównania, obliczenia i niezawodny przebieg nauki.

Dwie niezależne decyzje: (1) jak generujemy i sprawdzamy materiał, (2) jak oceniamy odpowiedź dziecka. LLM może przygotować pytanie A/B/C z kluczem, a w sesji kod porównuje wybrane ID — bez modelu przy kliknięciu i bez parsera gramatyki.

Od zaakceptowania tego specu nie dodajemy nowych heurystyk językowych do walidatorów lekcji i nie poprawiamy istniejących (zamrożenie do ich usunięcia w etapach 4–5).

## 3. Stan obecny (mapa z 2026-11-07)

### 3.1 Zestawy słówek — już zgodne z zasadą

Model generuje pozycje (`providers/openai/llm.ts:509-555`); kontrole po generowaniu są strukturalne (`item-payload.ts`, `picture-vocabulary.ts`), poza heurystyką trybu „ze źródła” (`english/material-phrase.ts` z `inflection.ts`, `normalizer.ts`, `function-words.ts`, ok. 500 linii: czy słowo stoi w materiale). Ocena wszystkich 9 typów jest deterministyczna (`domain/evaluate.ts`, `modules/learning/speech.ts`), dystraktory dobiera kod z pozycji zestawu (`recognition-options.ts`, `picture-recognition-options.ts`). Mowa: STT → dopasowanie transkrypcji, ocena wymowy tylko dla kanonicznego celu. **Słówek ten spec nie zmienia.**

### 3.2 Generowanie lekcji

- Zagadnienia: `english_grammar` z katalogu, `english_chapter` z planisty (`planObjectives`, `ToolLoopAgent`, do 8 kroków), `school` z jednego wywołania (`generateLessonObjectives`).
- Dla każdego zagadnienia (współbieżnie 4) podagent `runObjective` — `ToolLoopAgent` z narzędziami `submit_exercises` / `remove_exercise`, do `UMIEM_LESSON_AGENT_MAX_STEPS` (8) kroków. Przyjęcie (`lesson-pool-agent-tools.ts:705-786`, `agent/admission.ts`): parsowanie i oczyszczenie → limity → zod, reguły rdzenia, `subject.validateExercise` (tu heurystyki) → walidacja całej puli → ujawnienia → kontrole LLM → odrzucenia wracają do modelu w następnym kroku.
- **Kontrole LLM** (`providers/openai/lesson-pool-agent.ts`): `solve` — jedno ślepe rozwiązanie (`blindSolveTypes`), `judgeVariants` — zakłada, że klucz jest poprawny, `judgeHints` i `solveOpen` + grader — tylko szkoła.
- **Luki kontroli:** solver nie wymienia wszystkich poprawnych odpowiedzi i nie zgłasza „żadna nie jest poprawna”; dwie poprawne opcje wychodzą tylko, gdy solver przypadkiem wybierze drugą. `lesson_notice`, `lesson_short_answer`, `lesson_listen_choice`, `lesson_keywords` nie mają żadnej kontroli LLM. Przy niedostępnym checkerze ćwiczenie przechodzi jako `unchecked` (fail-open).
- **Ścieżka rodzica:** `editLessonDraft` i `publishLessonDraft` (`lesson-api.ts`) wołają `validatePool` z `subject.validateExercise`, więc heurystyki blokują ręczną edycję szkicu (400).
- Budżety (`lesson-pool-agent-policy.ts`): 1 USD na run, termin runu 10 min, zagadnienia 300 s, checker innej rodziny niż generator (`config.ts`), `MAX_AUTOMATIC_ATTEMPTS` 3.

### 3.3 Ocena odpowiedzi w lekcjach

- Kod po ID / przypisaniu / kolejności: choice, listen_choice, short_answer, notice, keywords, match, group, cloze, order (`domain/lessons/evaluate.ts`). Historyjka: osobna ścieżka bez oceny celu (`lesson-story-attempts.ts`). Rachunki: `calculation.ts`, nieparsowalne → nieocenione.
- Tekst (gap, error_fix, transform, open_answer): `matchLessonAnswer` (normalizacja, skróty angielskie, jedna literówka poza `focus`) → cache `lesson_verdicts` → grader (`lesson-attempts.ts:1380+`). Dokładne dopasowanie zalicza bez modelu.
- **`lesson_order` ignoruje `acceptedAnswers`** (`evaluateSequence`), choć prompty agenta gramatyki i rozdziału każą tam wpisywać równoważne szyki, a solver je przyjmuje.
- Grader: brak konfiguracji, limit (`UMIEM_GRADER_MAX_CALLS_PER_SESSION`, domyślnie 20) albo awaria → nieocenione. Plan sesji odejmuje od limitu sloty error_fix/transform/open_answer, ale nie `lesson_gap`. Panel rodzica nie ma flagi dostępności gradera.
- Nieocenione (zweryfikowane): nie zmienia serii ani projekcji opanowania, zadanie w treningu zostaje do ponowienia (ponowienie jest już niesamodzielne), na kartkówce próba jest zamykana bez oceny wiedzy.
- Nie ma oznaczenia celu odpowiedzi (pisownia vs znaczenie); ścieżkę wybiera typ, modalność, wynik dopasowania i obecność `schoolCriteria`.

## 4. Docelowe generowanie: stały przebieg cel × typ

Paczka to jeden cel i jeden typ ćwiczenia (decyzja właściciela: wariant „B”; sonda porównuje go z dzisiejszym agentem). Zagadnienia powstają jak dziś (katalog, planista rozdziału, wywołanie szkoły; planistę rozdziału ocenia etap 5).

Dla każdej pary cel × typ:

1. **Generowanie** — jedno wywołanie ze schematem wyniku (Zod). Prompt: cel i jego zakres zwykłym tekstem (dydaktyka przeniesiona z kodu do opisów celów w katalogu, np. „tylko czasowniki, które dostają -ing bez zmian”, „bez znaczenia przyszłego”, „czas wynika ze scenki w poleceniu”), poziom materiału (#279 — właściwość materiału ustawiana przez rodzica, nigdy wiek ani rok urodzenia z profilu), materiał i przykłady rodzica, karta typu (format i jeden przykład), liczba ćwiczeń z zapasem, zdania do unikania (karty i wcześniejsze paczki tego celu). Typy jednego celu idą po kolei (lista „unikaj”), cele równolegle.
2. **Kontrola struktury kodem** — dzisiejsze reguły strukturalne i ujawnień (§8), bez heurystyk.
3. **Kontrola paczki** — jedno wywołanie modelu z innej rodziny niż generator (§5).
4. **Porównanie kodem** wyniku kontroli z kluczem (§5.2).
5. **Jedna naprawa** — wadliwe pozycje wracają do generatora z powodem (kod reguły albo zdanie kontroli) i przechodzą kroki 2–4 jeszcze raz; nadal wadliwe odpadają.
6. **Braki** do minimum publikacji widzi rodzic jako lukę celu; uzupełnia je istniejące dogenerowanie celu.

**Awaria kontroli:** jedno ponowienie wywołania, potem paczka nie wchodzi do szkicu (fail-closed). Ćwiczenie niesprawdzone nigdy nie trafia do szkicu. Automatyczne ponowienia runu zostają.

**Zostaje:** budżet runu i rejestr kosztów, punkty kontrolne po celu (z innym formatem), prywatność danych w promptach (§10), checker innej rodziny niż generator.

**Znika:** pętla agenta z narzędziami w generowaniu ćwiczeń (`runObjective`, `submit_exercises`, `remove_exercise`, zwracanie odrzuceń modelowi), opisy reguł heurystycznych w prompcie, jednorazowe ślepe rozwiązanie i osobny sędzia wariantów (zastępuje je §5).

**AI SDK zostaje** jako klient modelu w workerze: generowanie, kontrola i naprawa to `generateText` z `Output.object` (jak dziś checker), z istniejącym routingiem OpenRouter, tolerancyjnym parserem, `tracked` (koszty), timeoutami i anulowaniem. Ograniczenie SDK do workera (`tests/ai-sdk-scope.test.ts`) zostaje. Pętla `ToolLoopAgent` znika z ćwiczeń w etapie 4/5; planista rozdziału prawdopodobnie staje się jednym wywołaniem ze schematem (etap 5). Kodu pętli nie zostawiamy „na później”.

## 5. Kontrakt kontroli paczki

### 5.1 Wejście i wyjście

Model kontroli dostaje dla każdego ćwiczenia widok dziecka (bez klucza, wariantów i wyjaśnień), opis celu i jego zakresu, a w przedmiocie z `checkerNeedsMaterial` (szkoła) materiał lekcji. Zwraca dla każdego ćwiczenia jedno z trzech:

- **`answers`** — komplet poprawnych odpowiedzi w kształcie typu: ID opcji (wybór jednokrotny), zbiór ID (słowa kluczowe), przypisania (dopasowanie, grupowanie, luki z banku), kolejności klocków (rozsypanka), teksty (luka, poprawianie, przekształcenie, odpowiedź otwarta). Każda odpowiedź ma znacznik `exercisesObjective` — czy ćwiczy cel (np. „She is reading” w ćwiczeniu na Present Simple: poprawne, celu nie ćwiczy).
- **`none`** — żadna odpowiedź nie jest poprawna; jedno zdanie powodu.
- **`unsure`** — model nie umie rozstrzygnąć; jedno zdanie powodu.

### 5.2 Porównanie kodem

| Typ | Ćwiczenie przyjęte, gdy |
|---|---|
| Zamknięte (choice, listen_choice, short_answer, notice, keywords, match, group, cloze) | `answers` dokładnie równe kluczowi (dla zbiorów i przypisań — cały komplet) |
| Rozsypanka | klucz jest w `answers`; pozostałe szyki z `exercisesObjective` trafiają do `acceptedAnswers` |
| Tekstowe | klucz jest w `answers`; pozostałe odpowiedzi z `exercisesObjective` trafiają do `acceptedAnswers` |
| Rozsypanka i tekstowe | każda poprawna odpowiedź ćwiczy cel; poprawna odpowiedź z `exercisesObjective = false` oznacza ćwiczenie dwuznaczne |

`none`, `unsure`, rozjazd z kluczem i dwuznaczność to wady → naprawa (§4 krok 5). Szczegóły schematu, limity długości i sposób porównania tekstów (normalizator przedmiotu) ustala etap 4.

### 5.3 Szkoła

Sędzia podpowiedzi (`judgeHints`) i kontrola odpowiedzi otwartych (`solveOpen` + grader) zostają w szkole do oceny w etapie 5; heurystyka `school/hint-gate.ts` (dubluje werdykt `reveals`) jest kandydatem do usunięcia tamże.

## 6. Docelowa ocena odpowiedzi dziecka

Kod ocenia wszystko, co ma jednoznaczny klucz; model oceniający tylko tam, gdzie poprawnych sformułowań może być wiele. Poprawność klucza zapewnia §5 — dokładne dopasowanie nadal zalicza bez modelu.

| Zadania | Ocena | Zmiana |
|---|---|---|
| Słówka (9 typów), rachunki, pytania do historyjki | kod | bez zmian |
| choice, listen_choice, short_answer, notice, keywords, match, group, cloze | kod, po ID / przypisaniu | bez zmian |
| `lesson_order` | kod: klucz albo szyk z `acceptedAnswers` | **ocena czyta warianty** (zestaw szyków z §5) |
| gap, error_fix, transform, open_answer | znany wariant → zaliczenie; inaczej cache → model oceniający | nowa reguła modelu (niżej) |
| Cel z wymaganą pisownią (np. `ing_spelling`) | kod: klucz i warianty, bez tolerancji literówek, niedopasowanie = błąd | **nowy jawny wyjątek na poziomie celu** |

- **Rozsypanka bez modelu oceniającego.** Szyków z kilku klocków jest niewiele; komplet wypisuje kontrola paczki. Model oceniający dla rozsypanki tylko wtedy, gdy porównanie pokaże, że kontrola gubi poprawne szyki. Kod sprawdza, że dziecko użyło dokładnie wydanych klocków (jak dziś).
- **Nowa reguła modelu oceniającego.** Odpowiedź poprawna dla tego, co widzi dziecko, jest zaliczana także wtedy, gdy nie używa ćwiczonej formy; komentarz dla rodzica wskazuje wadę ćwiczenia. Dziecko nie traci punktów za dwuznaczność materiału (#288). Nowa wersja promptu = nowy klucz cache; stare werdykty zostają historią.
- **Wyjątek pisowni** działa bez modelu oceniającego. Reprezentację oznaczenia w katalogu, planie rozdziału i celach szkoły ustala etap 3. Innych oznaczeń celu odpowiedzi nie wprowadzamy.
- **Bez zmian:** ocena szkolna (wiedza i precyzja, kryteria z materiału), cache werdyktów, decyzja rodzica nadpisująca werdykt, mapowanie werdyktów na wynik.

## 7. Model oceniający: dostępność i limit

1. **Brak konfiguracji — wykrywany przed nauką.** Generowanie lekcji wymaga pełnej konfiguracji `UMIEM_GRADER_*` (drugi warunek `lessonGenerationAvailable`); panel wyjaśnia, czego brakuje. W domyślnej konfiguracji grader bierze ten sam klucz OpenRouter co generator. Opublikowane lekcje działają dalej — selektor pomija zadania zależne od gradera, gdy go nie ma (`GRADER_DEPENDENT_TYPES`). Zestawów słówek to nie dotyczy.
2. **Awaria działającej usługi** — bez zmian: nieocenione, bez kary, zadanie do ponowienia.
3. **Limit z planu sesji.** Plan liczy wszystkie zadania zależne od gradera, także `lesson_gap`; limit sesji = te zadania × 2 (ocena i zapas na ponowienie po awarii). `UMIEM_GRADER_MAX_CALLS_PER_SESSION` zostaje twardym sufitem kosztu, z domyślną wartością pokrywającą największy budżet sesji (100 zadań). Po wyczerpaniu selektor jak dziś preferuje zadania zamknięte. Mnożnik i domyślny sufit potwierdza etap 3 na danych.

## 8. Co zostaje w kodzie, co znika

**Zostaje** (ok. 7,5 tys. linii kontroli strukturalnych, m.in. `pool-validation.ts`, `rules/core-rules.ts`, `exposure-leaks.ts`, `lesson-coverage.ts`, `calculation.ts`, `catalog-validation.ts`): schematy, wymagane pola, ID i relacje; klucz zgodny z opcjami i klockami; liczba zadań i pokrycie celów; identyczne duplikaty; ujawnienia (zdania z kart, odpowiedzi samodzielnych sprawdzeń); rachunki i ocena pisowni; normalizatory oceny (`english/contractions.ts`, `english/normalizer.ts`); zasady samodzielności, postępu i historii; limity kosztu, timeouty, anulowanie, ponowienia; idempotencja, transakcje, niezmienność opublikowanego materiału; prywatność i obsługa błędów usług. Punktów, czasu, harmonogramu powtórek ani decyzji o samodzielności nie przenosimy do LLM.

**Znika** (ok. 4,7 tys. linii heurystyk + 830 linii ich opisów):

- etap 4: `english-grammar/present-continuous-*.ts`, `time-markers.ts`, `be-agreement.ts`, `present-simple-forms.ts`, heurystyczna część `validators.ts` i `rules.ts`, `english/ing-forms.ts` i `listen-audibility.ts` w części używanej przez gramatykę; dydaktyka z tablic w kodzie przechodzi do opisów celów;
- etap 5: heurystyki rozdziału (`instruction_stimulus`, słownik „słowo spoza materiału”, `lexicon.ts` / `material-lexicon.ts` w części niepotrzebnej po zmianie pokrycia), `school/hint-gate.ts`, `termOccursIn`, pętla agenta, narzędzia i kod przyjmowania (`agent/admission.ts` itd.) w części nieużywanej przez przebieg B.

Usunięcie dotyczy heurystyk językowych; walidacja struktury i reguły działania aplikacji zostają. Ręczna edycja szkicu przez rodzica przechodzi wtedy tylko przez walidację struktury.

## 9. Etapy

Każdy etap: osobna sesja, własny spec, plan, przegląd trzech krytyków i PR scalany przez właściciela.

1. **Ten spec** (PR dokumentacyjny).
2. **Zestaw porównawczy i sonda** (płatna, za zgodą właściciela; szacunek ok. 4 USD). §11.
3. **Ocena odpowiedzi** — rozsypanka czyta warianty, wyjątek pisowni, nowa reguła modelu oceniającego, warunek dostępności generowania, limit z planu z lukami. Nie zależy od wyniku sondy — może iść równolegle z etapem 2.
4. **Przebieg B dla `english_grammar`** — po decyzji właściciela na wynikach etapu 2. Kontrola paczki (§5), dydaktyka w opisach celów, usunięcie heurystyk gramatyki, #328 (zdania z kart na liście „unikaj” i w ujawnieniach). Rozdział i szkoła zostają na agencie: między etapami 4 i 5 działają dwa systemy, świadomie i z terminem końca. Present Continuous jest pilotem (§12).
5. **`english_chapter` i `school` na przebiegu B** — planista rozdziału jako jedno wywołanie, ocena sędziego podpowiedzi i kontroli otwartej w szkole, usunięcie heurystyk rozdziału i szkoły oraz pętli agenta.

## 10. Prywatność, koszty, integracje

- **Generator** dostaje to samo co dziś (materiał, polecenie rodzica, karty, zdania do unikania, tematy zdań) plus opis celu i poziom materiału. Nigdy imię, rok urodzenia, identyfikatory ani odpowiedzi dziecka.
- **Kontrola paczki** dostaje widok dziecka, opis celu i (szkoła) materiał — nigdy polecenie rodzica, tematy zdań, karty ani dane dziecka. Opis celu to wspólna treść katalogu; nowy przepływ danych do opisania w panelu (`checkService`) i w `docs/architecture.md` §19.17 w etapie 4.
- **Model oceniający** — bez nowych danych; nowa reguła to tekst promptu.
- **Koszty:** nowe nazwy operacji (generowanie paczki, kontrola, naprawa) w `provider_usage_events` i §23 w etapie 4; ten sam adapter, więc `PAID_ADAPTERS` bez zmian.
- **MCP, `SKILL.md`, `learning-overview`, Kid DTO** — bez zmian (raport Hermesa nie obejmuje lekcji).

## 11. Porównanie (etap 2)

- **Fixture w repo** (fikcyjne materiały): „to be”, Present Simple, Present Continuous, rozdział (słowa i ramy), szkoła (odpowiedzi opisowe), rachunki (regresja oceny deterministycznej).
- **Próbki odpowiedzi:** inne poprawne sformułowanie, alternatywny szyk, odpowiedź częściowa, negacja zmieniająca sens, poprawna gramatyka bez wykonania polecenia, błąd w ćwiczonej formie, literówka w zadaniu na pisownię i w zadaniu na wiedzę.
- **Generowanie:** prototyp przebiegu B w `tests/probes` na istniejącym adapterze (etap 4 przenosi go do kodu aplikacji) kontra dzisiejszy agent; po 3 przebiegi na wariant i materiał. Ślepa ocena rubryką (`tests/probes/blind`): poprawność klucza, jednoznaczność, różnorodność, poziom, scenki w celach porównania; do tego koszt, czas i liczba ćwiczeń wymagających ręcznej poprawki.
- **Ocena odpowiedzi:** próbki przez dzisiejszy prompt gradera i prompt z regułą z §6.
- **Kryterium startu etapu 4:** wadliwych kluczy i dwuznacznych ćwiczeń nie więcej niż dziś, koszt w budżecie runu (1 USD), czas w terminie runu (10 min). Decyzję podejmuje właściciel. Stary zestaw testów heurystyk nie jest argumentem za ich zachowaniem; sama poprawność JSON nie jest dowodem jakości.

## 12. Zgodność z istniejącymi danymi

- Opublikowane lekcje, szkice i historia prób się nie zmieniają; zmiana oceny dotyczy nowych prób.
- **Present Continuous nie ma na produkcji żadnych wygenerowanych lekcji, szkiców ani runów** (właściciel, 2026-11-07): usunięcie heurystyk PC nie wymaga ścieżki zgodności, a PC jest pilotem sondy i etapu 4. Do etapu 4 błędów heurystyk PC nie poprawiamy; #280 czeka na etap 4 i zostaje zawężone do zakresu dydaktycznego.
- Present Simple i „to be” mają lekcje na produkcji: ich opublikowane ćwiczenia zostają, a nowa reguła gradera działa także dla nich.
- **Zapisane warianty rozsypanek** w istniejących lekcjach pisał agent, ale żaden model ich nie sprawdzał (order nie jest w `variantCheckTypes`). Etap 3 decyduje, czy włączyć je tylko dla lekcji z przebiegu B (rekomendacja), czy także dla starszych.
- **Runy w toku** przy wdrożeniu etapu 4/5: stary format punktu kontrolnego → anulowanie i ponowienie runu.

## 13. Ryzyka

- **Kontrola ma ten sam ślepy punkt co generator.** Mitygacja: inna rodzina modelu, widok dziecka bez klucza, pomiar rubryką, przegląd rodzica przed publikacją.
- **Dydaktyka tylko w prompcie może dryfować** (np. proporcja scenek). Mierzy to sonda; wymuszenie w kodzie wraca tylko dla klasy błędów, którą kontrola wielokrotnie przepuszcza.
- **Więcej wywołań** (ok. 30 paczek na lekcję z sześcioma celami) — krótsze prompty; koszt mierzony w sondzie.
- **Podobne zdania w różnych typach celu** — lista „unikaj” między paczkami; identyczne duplikaty odrzuca kod.
- **Fail-closed kontroli** — przy awarii usługi lekcje się nie wygenerują; świadomy wybór zamiast niesprawdzonego materiału.
- **Dwa systemy między etapami 4 i 5.**

## 14. Poza zakresem

Zestawy słówek (już zgodne; heurystyka `material-phrase` zostaje), Kid UI, panel rodzica poza flagą dostępności i informacją o usługach, MCP i `SKILL.md`, ocena wymowy i STT, harmonogram powtórek i postęp. #253 (agent dla zestawów słówek) — do zamknięcia: przy tym kierunku agent z pętlą nie jest planowany.
