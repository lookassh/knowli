# Treść językową ocenia model, strukturę — kod: uproszczenie generowania i oceniania lekcji — design

Wersja 3, 2026-11-07 (po uwagach Codexa do scalonej wersji 2 — zmiany w §17; zaakceptowane przez właściciela). Wersja 2: po przeglądzie trzech krytyków (technika, dydaktyka, zakres i ryzyko — zmiany w §16). Wersja 1: kierunek zaakceptowany przez właściciela w czacie 2026-11-07 po przeglądzie Codexa i Claude'a, sekcje przebiegu, oceny, gradera i etapów zaakceptowane osobno. Stan kodu: `origin/main` 2d3a5336.
Spec zbiorczy: ustala zasadę, kontrakty, etapy i bramki. Każdy etap 2–5 dostaje na starcie własny szczegółowy spec, plan i przegląd trzech krytyków.
Powiązane: #237 (agent puli), #279 (poziom materiału), #280 (Present Continuous v2), #288 (dwuznaczne ćwiczenia Present Simple), #328 (zdania z kart w ujawnieniach), #253 (agent dla zestawów słówek).

## 1. Problem

Generowanie lekcji korzysta z LLM, a jednocześnie próbuje sprawdzać język naturalny kodem: składnię, czas gramatyczny, podmiot, czasowniki, wskaźniki czasu i poprawność dystraktorów. Heurystyki rosną z każdym tematem, a mimo to nie gwarantują jakości.

- **Rozmiar.** Heurystyki językowe w generowaniu lekcji to ok. 4,7 tys. linii (bez testów), z czego 3,9 tys. w `english_grammar`: `present-continuous-validation.ts` 1843, `present-continuous-tense-choice.ts` 471, `present-continuous-exercise-rules.ts` 433, `validators.ts` 488, `time-markers.ts` 374, `be-agreement.ts` 241, `english/ing-forms.ts` 247. Do tego 830 linii opisów tych reguł dla modelu (`english-grammar/rules.ts`).
- **Prompt.** Prompt generatora Present Continuous ma 37,5 tys. znaków, w 89% to opisy reguł; agent wysyła go w każdym z maksymalnie 8 kroków. Present Simple: 18,4 tys., „to be”: 22,2 tys.
- **Błędy w obie strony** (potwierdzone wywołaniem walidatora, 2026-11-06): poprawne „Tom is quietly reading a book.” odpada (`pc_sentence_not_continuous` — między „is” a -ing dopuszczone są tylko now/all/both); błędne „Tom reading is.” przechodzi jako klucz rozsypanki; „food and drinks” w celach porównania czasów odpada jako drugi czasownik (świadomy kompromis, `present-continuous-tense-choice.ts:119`).
- **Kontrola nie daje dydaktyki.** Sondy PR #329: 4 z 18 ćwiczeń (próg 30%) podaje czas wyłącznie w polskiej scence, w drugiej sondzie 0 z 26. Ślepa ocena Present Simple znalazła 25% ćwiczeń dwuznacznych obok Present Continuous (#288).
- **Koszt utrzymania, nie działania.** Przebieg sondy PC kosztował 0,12–0,14 USD przy 13% odrzuceń. Drogi jest każdy nowy temat: parser, prompt, trzy rundy krytyków i trzy płatne sondy.

Punkt odniesienia właściciela to wartość nauki i czas rodzica (korepetytor ok. 80 zł za niecałą godzinę). Minimalna liczba wywołań modelu nie jest celem; koszty są mierzone i ograniczane.

## 2. Zasada

> LLM odpowiada za tworzenie i rozumienie treści językowej. Kod odpowiada za strukturę danych, jednoznaczne porównania, obliczenia i niezawodny przebieg nauki.

Dwie niezależne decyzje: (1) jak generujemy i sprawdzamy materiał, (2) jak oceniamy odpowiedź dziecka. LLM może przygotować pytanie A/B/C z kluczem, a w sesji kod porównuje wybrane ID — bez modelu przy kliknięciu i bez parsera gramatyki.

**Zamrożenie.** Od zaakceptowania tego specu nie dodajemy nowych heurystyk językowych do walidatorów lekcji i nie poprawiamy istniejących. Zamrożenie trwa do ich usunięcia w etapach 4–5. Jeśli właściciel na bramce etapu 4 lub 5 zostawi przedmiot na agencie (§9), zamrożenie heurystyk tego przedmiotu zostaje zdjęte.

## 3. Stan obecny (mapa z 2026-11-07)

### 3.1 Zestawy słówek — już zgodne z zasadą

Model generuje pozycje (`providers/openai/llm.ts:509-555`); kontrole po generowaniu są strukturalne (`item-payload.ts`, `picture-vocabulary.ts`), poza heurystyką trybu „ze źródła” (`english/material-phrase.ts` z `inflection.ts`, `normalizer.ts`, `function-words.ts`, ok. 500 linii: czy słowo stoi w materiale). Ocena wszystkich 9 typów jest deterministyczna (`domain/evaluate.ts`, `modules/learning/speech.ts`), dystraktory dobiera kod z pozycji zestawu (`recognition-options.ts`, `picture-recognition-options.ts`). Mowa: STT → dopasowanie transkrypcji, ocena wymowy tylko dla kanonicznego celu. **Słówek ten spec nie zmienia.**

### 3.2 Generowanie lekcji

- Zagadnienia: `english_grammar` z katalogu, `english_chapter` z planisty (`planObjectives`, `ToolLoopAgent`, do 8 kroków), `school` z jednego wywołania (`generateLessonObjectives`).
- Dla każdego zagadnienia (współbieżnie 4) podagent `runObjective` — `ToolLoopAgent` z narzędziami `submit_exercises` / `remove_exercise`, do `UMIEM_LESSON_AGENT_MAX_STEPS` (8) kroków. Przyjęcie (`lesson-pool-agent-tools.ts:705-786`, `agent/admission.ts`): parsowanie i oczyszczenie → limity → zod, reguły rdzenia, `subject.validateExercise` (tu heurystyki) → walidacja całej puli → ujawnienia → kontrole LLM → odrzucenia wracają do modelu w następnym kroku.
- **Kontrole LLM** (`providers/openai/lesson-pool-agent.ts`): `solve` — jedno ślepe rozwiązanie (`blindSolveTypes`), `judgeVariants` — zakłada, że klucz jest poprawny, `judgeHints` i `solveOpen` + grader — tylko szkoła.
- **Luki kontroli:** solver nie wymienia wszystkich poprawnych odpowiedzi i nie zgłasza „żadna nie jest poprawna”; dwie poprawne opcje wychodzą tylko, gdy solver przypadkiem wybierze drugą. Bez żadnej kontroli LLM: `lesson_notice`, `lesson_short_answer`, `lesson_listen_choice`, `lesson_keywords`, w szkole także `lesson_order`; `lesson_calculation` liczy kod. Przy niedostępnym checkerze ćwiczenie przechodzi jako `unchecked` (fail-open).
- **Ścieżka rodzica:** `editLessonDraft` i `publishLessonDraft` (`lesson-api.ts:846,953`) wołają `validatePool` z `subject.validateExercise`, więc heurystyki blokują ręczną edycję szkicu (400).
- Budżety (`lesson-pool-agent-policy.ts`): 1 USD na run, wywołanie 90 s, zagadnienie 300 s, run 10 min; checker innej rodziny niż generator (`config.ts:603-605`); `MAX_AUTOMATIC_ATTEMPTS` 3, a run wraca do kolejki tylko przy ponawialnej porażce zagadnienia (`lesson-agent-outcome.ts:226-231`).

### 3.3 Ocena odpowiedzi w lekcjach

- Kod po ID / przypisaniu / kolejności: choice, listen_choice, short_answer, notice, keywords (dowolny podzbiór klucza w [min, max]), match, group, cloze, order (`domain/lessons/evaluate.ts`). Historyjka: osobna ścieżka bez oceny celu (`lesson-story-attempts.ts`). Rachunki: `calculation.ts`, nieparsowalne → nieocenione.
- Tekst (gap, error_fix, transform, open_answer): `matchLessonAnswer` (normalizacja, rozwijanie skrótów angielskich, jedna literówka poza `focus`, w `focus` bez tolerancji) → cache `lesson_verdicts` → grader (`lesson-attempts.ts:1380+`). Dokładne dopasowanie zalicza bez modelu.
- **Skróty w odpowiedzi dziecka.** `englishNormalizer` rozwija skróty po obu stronach dopasowania (`english/contractions.ts`, np. he's → „is” albo „has” w :79-86), więc dokładne dopasowanie zalicza bez modelu odpowiedzi niegramatyczne. Potwierdzone wywołaniem `matchLessonAnswer` (2026-11-07): klucz „Yes, she is.” zalicza „Yes, she's.”, „Yes, I am.” — „Yes, I'm.”, „Yes, they are.” — „Yes, they're.”, a klucz „He's running.” — „He has running.”. Reguła PC `grammar.pc_s_contraction` (`english-grammar/rules.ts:357`) chroni tylko klucze PC przed „'s” i nie obejmuje skrótów na końcu zdania.
- **`lesson_order` ignoruje `acceptedAnswers`** (`evaluateSequence`), choć prompty agenta gramatyki i rozdziału każą tam wpisywać równoważne szyki, a solver je przyjmuje; nikt ich nie sprawdza (order nie jest w `variantCheckTypes`).
- Grader: brak konfiguracji, limit (`UMIEM_GRADER_MAX_CALLS_PER_SESSION`, domyślnie 20, sprawdzany względem stałej z env, `lesson-attempts.ts:1414`) albo awaria → nieocenione. Typy zależne od gradera są zdefiniowane w trzech miejscach (`scheduler.ts:151-155` bez `lesson_gap`, `lesson-sessions.ts:733`, `lesson-shorten.ts:39`). Panel rodzica nie ma flagi dostępności gradera; DTO katalogu jest `.strict()` (`contracts/src/lessons.ts:158`).
- Nieocenione (zweryfikowane): nie zmienia serii ani projekcji opanowania, zadanie w treningu zostaje do ponowienia (ponowienie jest już niesamodzielne), na kartkówce próba jest zamykana bez oceny wiedzy.
- Werdykt modelu `correct` daje `model_correct` → „Świetnie!” i sukces celu (`evaluate.ts:591`, `lesson-attempts.ts:570`). Decyzja rodzica jest zapisana w wierszu cache razem z `promptVersion` (`lesson-attempts.ts:1396-1397`).

## 4. Docelowe generowanie: stały przebieg cel × typ

Paczka to jeden cel i jeden typ ćwiczenia (decyzja właściciela: wariant „B”). Zagadnienia powstają jak dziś (katalog, planista rozdziału, wywołanie szkoły; planistę rozdziału ocenia etap 5).

Dla każdej paczki:

1. **Generowanie** — jedno wywołanie ze schematem wyniku (Zod). Prompt: cel i jego zakres zwykłym tekstem (dydaktyka przeniesiona z kodu do opisów celów w katalogu, np. „tylko czasowniki, które dostają -ing bez zmian”, „bez znaczenia przyszłego”, „czas wynika ze scenki w poleceniu”), stały odbiorca jak dziś (do czasu #279, potem poziom materiału — właściwość materiału, nigdy wiek ani rok urodzenia z profilu), materiał i przykłady rodzica, karta typu (format i jeden przykład), liczba ćwiczeń z zapasem, zdania do unikania (karty — #328 — i wcześniejsze lekcje).
2. **Kontrola struktury kodem** — reguły strukturalne i ujawnień (§8), bez heurystyk.
3. **Kontrola paczki** — dwa wywołania modelu z innej rodziny niż generator (§5).
4. **Porównanie kodem** wyniku kontroli z kluczem (§5.3).
5. **Jedna naprawa** — wadliwe pozycje wracają do generatora z powodem (kod reguły albo zdanie kontroli) i przechodzą kroki 2–4 jeszcze raz; nadal wadliwe odpadają.

**Równoległość.** Paczki jednego celu idą równolegle (ograniczona współbieżność), z wyjątkiem `lesson_keywords`, które powstają po przyjęciu paczki `lesson_open_answer` (słowa kluczowe są sparowane z pytaniem otwartym). Po wszystkich paczkach lekcji działa walidacja całej puli i ujawnień (zdania między paczkami, historyjka, karty, odpowiedzi samodzielnych sprawdzeń); kolizja usuwa późniejsze ćwiczenie. Identyczne duplikaty odrzuca kod; podobieństwo zdań między typami mierzy sonda.

**Braki** do minimum publikacji widzi rodzic jako lukę celu; uzupełnia je dogenerowanie celu — także przebiegiem B, z istniejącym szkicem na liście „unikaj”.

**Awaria kontroli (fail-closed).** Jedno ponowienie wywołania; potem porażka zagadnienia z kodem dostawcy (`transient` / `rate_limit` — ponawialne, run wraca do kolejki). Wygenerowane, niesprawdzone paczki zostają w punkcie kontrolnym, więc ponowienie tylko je sprawdza (bez ponownej opłaty za generowanie). Ćwiczenie niesprawdzone nigdy nie trafia do szkicu. Rodzic widzi osobny komunikat „kontrola niedostępna” — inny niż luka po odrzuceniu.

**Zwolnienia z kontroli paczki:** `lesson_calculation` (wynik liczy kod, `calculation.ts`) i pytania do historyjki (osobna ścieżka, poza zakresem).

**Terminy i punkty kontrolne:** punkt kontrolny po paczce, nie po celu, z wyróżnikiem formatu. Terminy wywołania, celu i runu ustala etap 4 z pomiaru czasu w sondzie (dzisiejsze 90 s / 300 s / 10 min są dla pętli agenta).

**Zostaje:** budżet runu i rejestr kosztów, prywatność danych w promptach (§10), checker innej rodziny niż generator.

**Znika:** pętla agenta z narzędziami w generowaniu ćwiczeń (`runObjective`, `submit_exercises`, `remove_exercise`, zwracanie odrzuceń modelowi), opisy reguł heurystycznych w prompcie, jednorazowe ślepe rozwiązanie i dzisiejszy sędzia wariantów (zastępuje je §5).

**AI SDK zostaje** jako klient modelu w workerze: generowanie, kontrola i naprawa to `generateText` z `Output.object` (jak dziś checker), z istniejącym routingiem OpenRouter, tolerancyjnym parserem, `tracked` (koszty), timeoutami i anulowaniem. Adapter przebiegu B zostaje w `providers/openai/lesson-pool-agent.ts` (lista plików w `tests/ai-sdk-scope.test.ts` i `PAID_ADAPTERS` bez zmian; zmiana pliku = świadoma aktualizacja tych list). Pętla `ToolLoopAgent` znika z ćwiczeń w etapach 4–5; planista rozdziału prawdopodobnie staje się jednym wywołaniem ze schematem (etap 5). Kodu pętli nie zostawiamy „na później”.

## 5. Kontrakt kontroli paczki

Dwa wywołania tego samego modelu kontroli, bo ślepe rozwiązanie nie może widzieć klucza, a ocena klucza musi go widzieć.

### 5.1 Wywołanie ślepe (bez klucza)

Model dostaje **wyłącznie to, co widzi albo słyszy dziecko**: widok ćwiczenia (bez klucza, wariantów i wyjaśnień), w `lesson_listen_choice` transkrypcję nagrania („bodziec + poprawna opcja”), a w przedmiocie z `checkerNeedsMaterial` (szkoła) materiał lekcji, który dziecko poznało. **Nie dostaje opisu celu ani zakresu** — cel („Present Simple”) naprowadzałby na ćwiczoną formę i ukrywał inną poprawną odpowiedź („Ona czyta książkę.” → także „She is reading a book.”). Dla każdego ćwiczenia zwraca jedno z trzech:

- **`answers`:**
  - typy zamknięte — **komplet** poprawnych odpowiedzi: opcje (wybór jednokrotny, słuchanie, krótka odpowiedź), zbiór pojęć (słowa kluczowe — z pytaniem sparowanej odpowiedzi otwartej w widoku), przypisania (dopasowanie, grupowanie, luki z banku), para zdanie + pozycja (wskazanie);
  - rozsypanka i typy tekstowe — do trzech **różnych** poprawnych odpowiedzi, z poleceniem szukania także innych form i czasów, które pasują do tego, co widzi dziecko; bez wymogu kompletu.
- **`none`** — żadna odpowiedź nie jest poprawna; jedno zdanie powodu.
- **`unsure`** — model nie umie rozstrzygnąć; jedno zdanie powodu.

Odpowiedzi zamknięte model podaje tekstami, nie ID (widok ukrywa ID; klocki i opcje o tym samym tekście są zamienne, #298); kod mapuje teksty na ID.

### 5.2 Wywołanie z kluczem

Model dostaje widok (w słuchaniu z transkrypcją nagrania), klucz, warianty generatora, odpowiedzi ze ślepego wywołania, wyjaśnienie błędu (`explanationPl`, gdy jest) oraz opis celu i zakresu. Dopiero tu ocenia się dwie osobne rzeczy: „odpowiada na polecenie widoczne dziecku” (`correct`) i „ćwiczy wskazany cel” (`exercisesObjective`). Dla każdego ćwiczenia zwraca:

- **`keyCorrect`** — klucz jest poprawną odpowiedzią na to, co widzi dziecko;
- **ocenę każdego kandydata** (warianty generatora i odpowiedzi ślepe): `correct` i `exercisesObjective` (np. „She is reading” w ćwiczeniu na Present Simple: poprawne, celu nie ćwiczy);
- **`inScope`** — ćwiczenie mieści się w zakresie celu (np. bez znaczenia przyszłego, bez czasownika ze zmianą pisowni w celu, który jej jeszcze nie uczy); przy `false` jedno zdanie powodu;
- **`revealsAnswer`** — polecenie, bodziec albo podpowiedź zdradza odpowiedź ponad to, co zakłada typ ćwiczenia (wszystkie przedmioty; w szkole obok dzisiejszego `judgeHints` do czasu etapu 5). Zamierzony bodziec się nie liczy: nagranie w słuchaniu i zdanie we „Wskaż słowo” z założenia zawierają odpowiedź;
- **`explanationConsistent`** — wyjaśnienie zgadza się z kluczem i nazywa to, z czego wynika odpowiedź (wskaźnik albo scenkę);
- **`audible`** (tylko `lesson_listen_choice`) — słuchacz odróżni poprawną opcję od każdego dystraktora.

### 5.3 Porównanie kodem

| Typ | Ćwiczenie przyjęte, gdy |
|---|---|
| Zamknięte | ślepy komplet dokładnie równy kluczowi (dla zbiorów i przypisań — cały komplet) |
| Rozsypanka i tekstowe | `keyCorrect`; żaden kandydat nie jest `correct` z `exercisesObjective = false` (inaczej ćwiczenie jest dwuznaczne) |
| Każdy typ | `inScope`, nie `revealsAnswer`, `explanationConsistent` (gdy jest wyjaśnienie), `audible` (słuchanie); brak `none` i `unsure` |

**Warianty.** Do `acceptedAnswers` typów tekstowych trafiają wyłącznie kandydaci ocenieni jako `correct` i `exercisesObjective`; warianty generatora bez takiej oceny są usuwane. Generator dopisuje do wariantów formy ze skrótami (She's reading, isn't), bo dopasowanie odpowiedzi dziecka nie rozwija skrótów (§6). Rozsypanka nie przechowuje wariantów (§6). Odpowiedź dziecka spoza wariantów oceni model oceniający przy pierwszej próbie, z zapisem w cache.

Każda niespełniona przesłanka to wada → naprawa (§4 krok 5). Schemat obu wywołań i porównanie powstają w etapie 2 jako czyste funkcje domeny z testami jednostkowymi w docelowym miejscu; etap 4 ich nie zmienia bez nowej sondy.

### 5.4 Słuchanie i szkoła

- `english/listen-audibility.ts` (zlewające się końcówki -s, używane też przez rozdział) zostaje do etapu 5; usuwamy go dopiero, gdy sonda pokaże, że `audible` łapie ten błąd.
- W szkole sędzia podpowiedzi (`judgeHints`) i kontrola odpowiedzi otwartych (`solveOpen` + grader) zostają do oceny w etapie 5; heurystyka `school/hint-gate.ts` (dubluje `reveals`) jest kandydatem do usunięcia tamże.

## 6. Docelowa ocena odpowiedzi dziecka

Kod ocenia wszystko, co ma jednoznaczny klucz; model oceniający tylko tam, gdzie poprawnych sformułowań może być wiele. Poprawność klucza zapewnia §5 — dokładne dopasowanie nadal zalicza bez modelu.

| Zadania | Ocena | Zmiana |
|---|---|---|
| Słówka (9 typów), rachunki, pytania do historyjki | kod | bez zmian |
| choice, listen_choice, short_answer, notice, keywords, match, group, cloze | kod, po ID / przypisaniu | bez zmian |
| `lesson_order` | kod: klucz → zaliczenie; inny szyk z dokładnie wydanych klocków → cache → model oceniający | **inny szyk ocenia model** zamiast automatycznego błędu |
| gap, error_fix, transform, open_answer | znany wariant → zaliczenie; inaczej cache → model oceniający | dopasowanie bez rozwijania skrótów; nowy wynik „ćwiczenie dwuznaczne” (niżej) |

- **Dopasowanie bez rozwijania skrótów.** Dokładne dopasowanie odpowiedzi dziecka (`matchLessonAnswer`) używa wyłącznie neutralnej normalizacji: wielkość liter, interpunkcja, ujednolicone apostrofy, spacje i jedna literówka poza `focus`. Skrót zalicza się tylko wtedy, gdy dokładnie ta forma stoi w kluczu albo w wariantach (warianty ze skrótami dopisuje generowanie, §5.3); każdą inną odpowiedź ze skrótem ocenia cache i model oceniający. Dziś normalizator zalicza w ten sposób „Yes, she's.”, „Yes, I'm.” i „He has running.” (§3.3), także w opublikowanych lekcjach — zmiana działa dla wszystkich rewizji, bo dotyczy oceny, nie materiału. Rozwijanie skrótów zostaje w porównaniach ujawnień i duplikatów, gdzie nadmiarowe wykrycie jest bezpieczne.
- **Rozsypanka.** `acceptedAnswers` rozsypanki przestają być używane i generowane (dziś ich nikt nie sprawdza, a ocena ich nie czyta). Inny szyk ułożony dokładnie z wydanych klocków ocenia model oceniający (rzadkie, tanie, z cache); kod nadal sprawdza, że dziecko użyło dokładnie wydanych klocków.
- **Ćwiczenie dwuznaczne.** Werdykt modelu oceniającego dostaje pole `usesTargetForm`. Odpowiedź poprawna dla tego, co widzi dziecko, ale bez ćwiczonej formy (np. „She is reading a book” w tłumaczeniu na Present Simple bez wskaźnika „zwykle”, #288):
  - wynik **nieoceniony** z powodem „ćwiczenie dwuznaczne” — bez kary i bez sukcesu celu (seria i projekcja bez zmian, na kartkówce próba zamknięta bez oceny wiedzy), zadanie nie wraca do ponowienia;
  - dziecko widzi „Dobrze!” i formę ćwiczoną w lekcji (najbliższy wariant z formą celu), z ekspozycją zapisaną przed wysłaniem jak przy dzisiejszym `model_almost`;
  - ćwiczenie dostaje oznaczenie dla rodzica w panelu (do poprawy albo usunięcia w nowym szkicu).
- **Wersja promptu modelu oceniającego** rośnie (nowy klucz cache); stare werdykty zostają historią, a decyzje rodzica (`parent_decision`) przechodzą na nową wersję dla tej samej rewizji i odpowiedzi.
- **Bez zmian:** ocena szkolna (wiedza i precyzja, kryteria z materiału), cache werdyktów, decyzja rodzica nadpisująca werdykt, mapowanie pozostałych werdyktów, brak tolerancji literówek w tokenach `focus`.
- **Oznaczenie „ćwiczenie dwuznaczne” powstaje tylko z werdyktu modelu oceniającego**, więc obejmuje typy tekstowe i rozsypankę. Zamknięte ćwiczenia opublikowanych lekcji (ocena po ID) nie dostają automatycznego oznaczenia — §12.
- **Bez wyjątku pisowni.** Wersja 1 specu wprowadzała cel „wymagana pisownia” oceniany samym kodem. Po przeglądzie (§16) wyjątek wypada: tokeny `focus` już dziś nie tolerują literówek, a grader (teraz wymagany, §7) przypisuje kategorię błędu `spelling`, więc wyjątek oszczędzałby tylko wywołanie modelu, a odbierał kategorię błędu i ocenę parafraz.

## 7. Model oceniający: dostępność i limit

1. **Brak konfiguracji — wykrywany przed nauką.** Generowanie lekcji wymaga pełnej konfiguracji `UMIEM_GRADER_*` (drugi warunek `lessonGenerationAvailable`, liczony w web); DTO katalogu dostaje powód niedostępności, a panel go wyjaśnia (zmiana kontraktu `.strict()`). W trybie fake worker nie ma gradera — warunek nie blokuje tam generowania. W domyślnej konfiguracji grader bierze ten sam klucz OpenRouter co generator. Opublikowane lekcje działają dalej — selektor pomija zadania zależne od gradera, gdy go nie ma. Zestawów słówek to nie dotyczy.
2. **Awaria działającej usługi** — bez zmian: nieocenione, bez kary, zadanie do ponowienia.
3. **Limit z planu sesji.**
   - Jedna definicja typów zależnych od gradera, także `lesson_gap` i `lesson_order` (zamiast trzech dzisiejszych).
   - Limit sesji = zaplanowane zadania zależne od gradera × 2 (ocena i zapas na ponowienie po awarii), zapisany w kontekście sesji przy starcie; sesje bez planu (starsze dynamiczne) dostają domyślny sufit.
   - `UMIEM_GRADER_MAX_CALLS_PER_SESSION` zostaje twardym sufitem kosztu, z domyślną wartością pokrywającą największy budżet sesji (100 zadań); wywołania spoza planu (trener precyzji, „Skróć”) mieszczą się w suficie.
   - Po wyczerpaniu selektor jak dziś preferuje zadania zamknięte. Mnożnik i domyślny sufit potwierdza etap 3 na danych.

## 8. Co zostaje w kodzie, co znika

**Zostaje** (ok. 7,5 tys. linii kontroli strukturalnych, m.in. `pool-validation.ts`, `rules/core-rules.ts`, `exposure-leaks.ts`, `lesson-coverage.ts`, `calculation.ts`, `catalog-validation.ts`): schematy, wymagane pola, ID i relacje; klucz zgodny z opcjami i klockami; liczba zadań i pokrycie celów; identyczne duplikaty; ujawnienia (zdania z kart, odpowiedzi samodzielnych sprawdzeń); rachunki; neutralna normalizacja dopasowania odpowiedzi dziecka (§6) oraz rozwijanie skrótów (`english/contractions.ts`, `english/normalizer.ts`) wyłącznie w porównaniach ujawnień i duplikatów; zasady samodzielności, postępu i historii; limity kosztu, timeouty, anulowanie, ponowienia; idempotencja, transakcje, niezmienność opublikowanego materiału; prywatność i obsługa błędów usług. Punktów, czasu, harmonogramu powtórek ani decyzji o samodzielności nie przenosimy do LLM.

**Nowa reguła strukturalna** (format, nie rozumienie języka): `lesson_notice` — słowo `correctOption` występuje w zdaniu dokładnie raz. Reguła skrótów „'s” z wersji 2 wypada: przy dopasowaniu bez rozwijania skrótów (§6) klucz ze skrótem jest bezpieczny, a `grammar.pc_s_contraction` znika razem z heurystykami PC.

**Znika** (ok. 4,7 tys. linii heurystyk + 830 linii ich opisów):

- etap 4: `english-grammar/present-continuous-*.ts` (z `present-continuous-guidance.ts` przeniesionym do opisów celów), `time-markers.ts`, `be-agreement.ts`, `present-simple-forms.ts`, heurystyczna część `validators.ts` i `rules.ts` z przypadkami `*.rule-cases.ts` i migawkami promptu, `english/ing-forms.ts` w części używanej przez gramatykę; dydaktyka z tablic w kodzie przechodzi do opisów celów;
- etap 5: heurystyki rozdziału (`instruction_stimulus`, słownik „słowo spoza materiału”, `lexicon.ts` / `material-lexicon.ts` w części niepotrzebnej po zmianie pokrycia), `listen-audibility.ts` (§5.4), `school/hint-gate.ts`, `termOccursIn`, pętla agenta, narzędzia i kod przyjmowania w części nieużywanej przez przebieg B.

Usunięcie dotyczy heurystyk językowych; walidacja struktury i reguły działania aplikacji zostają.

**Ścieżka rodzica (etap 3):** walidatory przedmiotów dzielą się na część strukturalną (działa wszędzie) i heurystyczną (tylko generowanie, do usunięcia). Ręczna edycja i publikacja szkicu przechodzą przez część strukturalną, więc heurystyki przestają blokować rodzica jeszcze przed etapem 4.

## 9. Etapy i bramki

Każdy etap: osobna sesja, własny spec, plan, przegląd trzech krytyków i PR scalany przez właściciela.

1. **Ten spec** (PR dokumentacyjny).
2. **Kontrakt kontroli i sonda generowania** (płatna, za zgodą właściciela; ok. 2,5 USD z limitem w rejestrze kosztów sondy). Warunek wstępny: scalone #328 (zdania z kart w ujawnieniach — reguła ujawnień, dotyczy też produkcyjnych lekcji PS i „to be”; bez niej porównanie faworyzuje B). Zakres: schemat obu wywołań kontroli i porównanie z §5 jako czyste funkcje domeny z testami; orkiestracja przebiegu B jako prototyp w `tests/probes`; nowa, zamrożona przed przebiegiem wersja rubryki ślepej oceny; progi bezwzględne §11.2 zatwierdzone przez właściciela przed płatnym przebiegiem; sonda §11.
3. **Ocena odpowiedzi i ścieżka rodzica** — dopasowanie bez rozwijania skrótów (§6), rozsypanka przez model oceniający, wynik „ćwiczenie dwuznaczne” z oznaczeniem dla rodzica, nowa wersja promptu z przeniesieniem decyzji rodzica, dostępność i limit (§7), podział walidatorów przedmiotów i ścieżka rodzica (§8). Odbiór: próbki odpowiedzi z §11.3 przez **pełną ścieżkę oceny** (dopasowanie → cache → model oceniający), także na starych rewizjach z kluczami ze skrótami, z etykietami spisanymi przed przebiegiem i progami bezwzględnymi (mały płatny przebieg modelu oceniającego). Nie zależy od sondy generowania — może iść równolegle z etapem 2.
4. **Przebieg B dla `english_grammar`** — po bramce etapu 2. Na starcie sprawdzić, że na produkcji nadal nie ma lekcji PC (§12). Zakres: przebieg z §4 w kodzie aplikacji na funkcjach z etapu 2, dydaktyka w opisach celów, usunięcie heurystyk gramatyki, nowe terminy i format punktu kontrolnego, dogenerowanie celu przebiegiem B, wydzielenie strukturalnej części `agent/admission.ts` dla obu systemów, `agentPolicy` opcjonalne dla przedmiotu na B, etykiety nowych kodów odrzuceń (`rejectedReasons`), tekst usług w panelu zależny od przedmiotu (`checkService`). Present Continuous jest pilotem. Rozdział i szkoła zostają na agencie (fail-open), gramatyka jest na B (fail-closed): dwa systemy do etapu 5.
5. **`english_chapter` i `school` na przebiegu B** — z własną sondą i bramką (fixture rozdziału i szkoły, porównanie z agentem, który w rozdziale daje dziś 0 ujawnień). Planista rozdziału jako jedno wywołanie, ocena sędziego podpowiedzi i kontroli otwartej w szkole, usunięcie heurystyk rozdziału i szkoły oraz pętli agenta. **Wariant awaryjny:** przedmiot, w którym B przegrywa na bramce, zostaje na agencie, a zamrożenie jego heurystyk zostaje zdjęte; pętla agenta zostaje wtedy tylko dla niego.

## 10. Prywatność, koszty, integracje

- **Generator** dostaje to samo co dziś (materiał, polecenie rodzica, karty, zdania do unikania, tematy zdań) plus opis celu (wspólna treść katalogu). Nigdy imię, rok urodzenia, identyfikatory ani odpowiedzi dziecka.
- **Kontrola paczki** dostaje w wywołaniu ślepym tylko widok dziecka (w słuchaniu z transkrypcją nagrania), w wywołaniu z kluczem także opis celu, klucz, warianty, odpowiedzi ślepe i wyjaśnienie, a w szkole materiał — nigdy polecenie rodzica, tematy zdań, karty ani dane dziecka. Nowy przepływ (opis celu, wyjaśnienie) opisać w panelu (`checkService`) i w `docs/architecture.md` §19.17 w etapie 4.
- **Dzienniki:** powody `none` / `unsure` / `inScope`, ocena kandydatów i prompt naprawy zawierają treść ćwiczeń — nie trafiają do dzienników `[lesson-agent]` ani do `detail` w punkcie kontrolnym (jak dziś `detail` odrzuceń).
- **Model oceniający** — bez nowych danych; nowe pole werdyktu i reguła to tekst promptu.
- **Koszty:** nowe nazwy operacji (generowanie paczki, kontrola ślepa, kontrola z kluczem, naprawa) w `provider_usage_events` i §23 w etapie 4; dzisiejsze `agent_objective`, `check_solve`, `check_variants` stają się historyczne jak `lesson_pool`. Liczba wywołań zapisu w `usage-recording.architecture.test.ts` się zmieni.
- **MCP, `SKILL.md`, `learning-overview`, Kid DTO** — bez zmian (raport Hermesa nie obejmuje lekcji); każdy PR etapu podaje „brak wpływu na API → MCP → skill” z uzasadnieniem.

## 11. Sondy i bramki

### 11.1 Etap 2: generowanie, tylko gramatyka

- **Materiały** (fikcyjne, w repo): „to be”, Present Simple, Present Continuous. Rozdział i szkoła — sonda etapu 5. Rachunki nie potrzebują sondy (kod deterministyczny, testy jednostkowe).
- **Przebiegi:** prototyp B i dzisiejszy agent, po 3 przebiegi na temat (ok. 18 runów).
- **Wady wzorcowe:** fixture celowo wadliwych ćwiczeń z historii PC (spec PC §16.9–16.13): goły „now” w przeczeniu, przestawialny wskaźnik w rozsypance, „doesn't watching” z dwiema poprawkami, dystraktor w innym poprawnym czasie, dwie formy -ing w „Wskaż słowo”, „Look! Tom is eating bread and drinks milk.”, „The fish ___”, znaczenie przyszłe oraz ćwiczenia, w których czas rozstrzyga dopiero ukryty cel (np. tłumaczenie „Ona czyta książkę.” w celu Present Simple, luka „She ___ (sit) on the sofa.” — kontrola musi zgłosić dwuznaczność); obok ćwiczenia poprawne. Kontrola paczki (§5) przechodzi przez nie bez generatora; wykrycie liczone osobno dla każdej klasy.
- **Miary:** ślepa ocena rubryką (wadliwy klucz, dwuznaczność, poza zakresem, zdradzona odpowiedź, wadliwe wyjaśnienie; różnorodność, poziom), ścisła miara scenek `sceneShare` w celach porównania, odsetek odrzuceń osobno dla ćwiczeń ze scenką i ze wskaźnikiem, spełnienie minimum publikacji, koszt runu, czas na cel i na run.

### 11.2 Bramka etapu 4 (decyzja właściciela na wynikach)

- **progi bezwzględne per klasa wad** (bez sumowania klas), na przyjęte ćwiczenie, per temat, łącznie z 3 przebiegów — propozycja do zatwierdzenia przez właściciela w specu etapu 2, przed płatnym przebiegiem: błędny klucz ≤ 1%, ćwiczenie zamknięte z drugą poprawną odpowiedzią (niesprawiedliwa ocena dziecka) ≤ 1%, każda pozostała klasa (dwuznaczne tekstowe, poza zakresem, zdradzona odpowiedź, wadliwe wyjaśnienie) ≤ 3%;
- porównanie z agentem w każdej klasie osobno: B ≤ agent + 2 pp;
- minimum publikacji spełnione w 3 z 3 przebiegów B dla każdego tematu;
- każda klasa wad wzorcowych wykryta w ≥ 80% przypadków, poprawne ćwiczenia wzorcowe odrzucone w ≤ 10%;
- maksymalny koszt runu B ≤ 1 USD, czas mieści się w terminie runu;
- `sceneShare` raportowane obok (cel ≥ 30% z #280, nie warunek bramki).

Stary zestaw testów heurystyk nie jest argumentem za ich zachowaniem; sama poprawność JSON nie jest dowodem jakości.

### 11.3 Etap 3: próbki odpowiedzi

Etykiety wzorcowe spisane przed przebiegiem, dla gramatyki i rozdziału: inne poprawne sformułowanie, poprawna odpowiedź inną formą (dwuznaczność → „ćwiczenie dwuznaczne”), alternatywny szyk w rozsypance, odpowiedź częściowa, negacja zmieniająca sens, poprawna gramatyka bez wykonania polecenia, błąd w ćwiczonej formie, literówka w tokenie `focus` i poza nim, skróty (He has running wobec klucza „He's running.”, Yes, she's., Yes, I'm., Yes, they're., poprawne She's reading), pisownia amerykańska. Próbki przechodzą pełną ścieżkę oceny (dopasowanie → cache → model oceniający), także na starych rewizjach. Progi bezwzględne (propozycja do zatwierdzenia w specu etapu 3): zero poprawnych odpowiedzi ocenionych jako błędne i zero zaliczonych odpowiedzi z klas „negacja zmieniająca sens”, „błąd w ćwiczonej formie” i „skrót niegramatyczny”; dla pozostałych klas próg ustala spec etapu 3.

## 12. Zgodność z istniejącymi danymi

- Opublikowane lekcje, szkice i historia prób się nie zmieniają; zmiana oceny dotyczy nowych prób.
- **Present Continuous nie ma na produkcji żadnych wygenerowanych lekcji, szkiców ani runów** (właściciel, 2026-11-07): usunięcie heurystyk PC nie wymaga ścieżki zgodności, a PC jest pilotem. Do etapu 4 błędów heurystyk PC nie poprawiamy; #280 czeka na etap 4. Etap 4 sprawdza ten stan na starcie.
- Present Simple i „to be” mają lekcje na produkcji: ich opublikowane ćwiczenia zostają; dopasowanie bez rozwijania skrótów, wynik „ćwiczenie dwuznaczne” i model oceniający dla rozsypanki działają także dla nich. **Zamknięte ćwiczenia tych lekcji nie dostają automatycznego oznaczenia** (ocena po ID nie woła modelu): dwuznaczne zostają do ręcznego przeglądu rodzica albo do ponownego wygenerowania lekcji po etapie 4. Jednorazowe sprawdzenie opublikowanych lekcji kontrolą z etapu 2 jest możliwe jako osobna decyzja właściciela, poza zakresem tego specu.
- Zapisane warianty rozsypanek w istniejących lekcjach przestają mieć znaczenie (§6).
- **Runy w toku** przy wdrożeniu etapu 4/5: punkt kontrolny dostaje wyróżnik formatu; run ze starym formatem jest anulowany i ponawiany od nowa z zachowanym wydatkiem (dziś `parseLessonAgentProgress` z `salvageLessonAgentSpend` robi to po cichu — etap 4 czyni to jawnym).

## 13. Ryzyka

- **Kontrola ma ten sam ślepy punkt co generator.** Mitygacja: inna rodzina modelu, wywołanie ślepe bez klucza i bez opisu celu, wady wzorcowe w sondzie z progiem wykrycia per klasa, wynik „ćwiczenie dwuznaczne” z produkcji jako sygnał zwrotny dla rodzica. Przegląd rodzica (ok. 85 ćwiczeń w puli) nie jest główną ochroną.
- **Dydaktyka tylko w prompcie może dryfować** (np. proporcja scenek). Mierzy to sonda; `inScope` łapie wyjście poza zakres; wymuszenie w kodzie wraca tylko dla klasy błędów, którą kontrola wielokrotnie przepuszcza.
- **Fail-closed odbiera trudne ćwiczenia** (scenki). Mierzy to odsetek odrzuceń per rodzaj w sondzie.
- **Więcej wywołań i czas** (ok. 30 paczek × 3–5 wywołań na lekcję z sześcioma celami) — paczki równolegle, terminy z pomiaru.
- **Fail-closed kontroli** — przy awarii usługi lekcje się nie wygenerują od razu; run się ponowi bez ponownej opłaty za generowanie.
- **Dwa systemy między etapami 4 i 5** — wspólna strukturalna część przyjmowania; wariant awaryjny z §9.

## 14. Obowiązki dokumentacyjne etapów

- **Etap 3:** `docs/architecture.md` §19 (ocena rozsypanki, „ćwiczenie dwuznaczne”, limit), AGENTS.md (zdanie o modelu oceniającym w lekcjach, znaczenie `lessonGenerationAvailable`), komunikaty w `messages.ts`.
- **Etap 4:** `docs/architecture.md` §19.17 i §23, AGENTS.md (linie o obowiązkowym `agentPolicy`, o katalogu reguł z `lessonRuleBook` i migawką promptu, o danych dla checkera, o agencie jako jedynym generatorze), spec kosztów (nazwy operacji).
- **Etap 5:** jak etap 4 dla rozdziału i szkoły; usunięcie opisu pętli agenta.
- Każdy etap: wpływ na API → MCP → skill w opisie PR.

## 15. Zgłoszenia

- **#328** — warunek wstępny sondy etapu 2.
- **#288** — rozwiązują etapy 3 (wynik „ćwiczenie dwuznaczne”) i 4 (kontrola paczki); propozycja heurystyki PS z issue nie będzie realizowana (zamrożenie). Zamknąć po etapie 3 z odesłaniem.
- **#280** — zawęzić do zakresu dydaktycznego bez nowych reguł w kodzie; „minimum scenek egzekwowane przez kierownika” zastępuje pomiar w sondzie i `inScope`. Wraca po etapie 4.
- **#279** — niezależne; do czasu wdrożenia przebieg B używa stałego odbiorcy jak dziś.
- **#253** — zamknąć: przy tym kierunku agent z pętlą dla zestawów słówek nie jest planowany.
- **#237** — etap 3 agenta zakończony; ten spec go zastępuje w kierunku dalszego rozwoju.

## 16. Przegląd trzech krytyków (wersja 2)

Zmiany względem wersji 1 (krytycy: A — technika, B — dydaktyka i sprawiedliwość, C — zakres i ryzyko):

- **Kontrola paczki: dwa wywołania zamiast jednego** (A1, B K2, B W1, B W5). Wymóg „klucz jest w ślepym komplecie” dawał fałszywe wady w tłumaczeniach (wiele poprawnych sformułowań); ślepe wywołanie zostaje dla kompletu w typach zamkniętych, a klucz, warianty, zakres, zdradzanie odpowiedzi i wyjaśnienia ocenia wywołanie z kluczem. Warianty bez oceny modelu nie trafiają do `acceptedAnswers`.
- **Reguła modelu oceniającego zmieniona** (B K1, C W2, A9; zgodnie wszyscy trzej): poprawna odpowiedź bez ćwiczonej formy nie daje już sukcesu celu — wynik nieoceniony „ćwiczenie dwuznaczne” bez kary, z oznaczeniem dla rodzica. Decyzje rodzica przechodzą na nową wersję promptu (C W2, A9).
- **Rozsypanka przez model oceniający, bez wariantów** (B W3, C W1, A8): wersja 1 zakładała komplet szyków z kontroli i brak zapasu; zapisane warianty wymagałyby znacznika pochodzenia.
- **Wyjątek pisowni usunięty** (B W2, C W1, A10) — uzasadnienie w §6.
- **Paczki celu równolegle, słowa kluczowe po odpowiedzi otwartej, walidacja puli po scaleniu, punkt kontrolny po paczce** (A3, A5, B W4, C W5).
- **Fail-closed jako ponawialna porażka zagadnienia z zachowaniem niesprawdzonych paczek; osobny komunikat „kontrola niedostępna”** (A4, B W7).
- **Słuchanie: `audible` i zachowanie `listen-audibility.ts` do etapu 5** (A2). **Wskazanie: para zdanie + pozycja i reguła „dokładnie raz”** (A7). **Rachunki i historyjka zwolnione z kontroli** (A6). **Porównanie po tekstach** (A8).
- **Skróty „'s” jako reguła strukturalna** (B W1; potwierdzone w `contractions.ts:79-86`).
- **Bramki mierzalne, etap 2 tylko gramatyka (ok. 2,5 USD), kontrakt kontroli zamrożony w etapie 2 jako kod domeny, wady wzorcowe, #328 przed sondą, nowa rubryka** (C K1, C W3, C W4, B K3, C D5).
- **Etap 5 z własną bramką i wariantem awaryjnym; zdjęcie zamrożenia przy porażce B; ścieżka rodzica w etapie 3** (C K2).
- **Etap 3 z własnym odbiorem na próbkach odpowiedzi** (C W1). **Limit: jedna definicja typów, zapis w kontekście sesji, sufit dla wywołań spoza planu** (A11). **`lessonGenerationAvailable` z powodem w kontrakcie, bez blokady w trybie fake** (A12). **Stały odbiorca do #279** (B W8, C W7). **Zakres etapu 4, obowiązki dokumentacyjne, zgłoszenia, sprawdzenie stanu PC na produkcji** (A13–A15, C W6, C D1–D4, B D1).

Odrzucone: opcjonalna kontrola modelem przy ręcznej publikacji szkicu przez rodzica (B D2 — rodzic jest zatwierdzającym, dodatkowa ścieżka bez potrzeby); `sceneShare` ≥ 30% jako warunek bramki (B W6 — właściciel zdecydował 2026-11-06, że minimum scenek należy do #280; zostaje miarą); zamknięta lista kodów zakresu w katalogu (B K2 — wystarcza `inScope` z jednym zdaniem powodu); warianty tylko z przecięcia generatora i kontroli (B W1 — zastąpione oceną kandydatów w wywołaniu z kluczem).

## 17. Uwagi Codexa do wersji 2 (wersja 3)

Pięć uwag do scalonej wersji 2 (PR #357), przyjętych przez właściciela 2026-11-07:

- **P1 — normalizator zalicza błędy przed modelem oceniającym.** Potwierdzone wywołaniem `matchLessonAnswer`: „Yes, she's.”, „Yes, I'm.”, „Yes, they're.” wobec pełnych kluczy i „He has running.” wobec klucza „He's running.” dają `exact`. Zakaz „'s” w nowych kluczach (wersja 2) tego nie naprawiał. Zmiana szersza niż propozycja: dopasowanie odpowiedzi dziecka przestaje rozwijać skróty (§6), formy ze skrótami stają się sprawdzonymi wariantami (§5.3), reguła strukturalna „'s” wypada (§8), a odbiór etapu 3 idzie przez pełną ścieżkę oceny, także na starych rewizjach (§11.3).
- **P2 — ślepa kontrola widziała cel.** Wywołanie ślepe dostaje tylko to, co widzi dziecko, i szuka także odpowiedzi w innych formach; cel i zakres ocenia wywołanie z kluczem, rozdzielając „odpowiada na polecenie” od „ćwiczy cel” (§5.1–§5.2). Wady wzorcowe obejmują ćwiczenia, w których czas rozstrzyga tylko ukryty cel (§11.1).
- **P3 — słuchanie.** Transkrypcja nagrania trafia do obu wywołań; `revealsAnswer` nie liczy zamierzonego bodźca (nagranie w słuchaniu, zdanie we „Wskaż słowo”) (§5.1–§5.2).
- **P4 — brak źródła oznaczeń dla starych ćwiczeń zamkniętych.** Obietnica oznaczenia usunięta: zamknięte ćwiczenia opublikowanych lekcji zostają do ręcznego przeglądu albo ponownego wygenerowania (§6, §12).
- **P5 — bramka tylko względna.** Dodane progi bezwzględne per klasa wad, bez sumowania klas, zatwierdzane przed płatnym przebiegiem (§11.2); w etapie 3 progi bezwzględne na próbkach odpowiedzi (§11.3).
