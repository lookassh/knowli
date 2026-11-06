# Agent puli lekcji — katalog reguł walidacji z opisami w prompcie (#237, PR 3)

Wersja 1, 2026-11-06. Projekt zatwierdzony przez właściciela w rozmowie
(„Zatwierdzam”, 2026-11-06), razem z poluzowaniami reguł w wariancie A.
Gałąź `feature/lesson-agent-rule-catalog-237` wychodzi z PR 2
(`feature/lesson-pool-agent-stage3-pr2-237`, commit `783f7220`).

## 1. Cel i decyzje właściciela

**Problem.** W płatnym przebiegu kontrolnym z 2026-11-05 szkoła odrzuciła 65
ze 133 propozycji agenta (49%), a rozdział i gramatyka po ok. 20%. Audyt kodu
pokazał dwie przyczyny:

- **Prompt nie zna części reguł,** które walidacja egzekwuje: podpowiedzi
  pytań otwartych, tolerancji rachunku ≤ 1% wyniku, zakazu pustych napisów,
  wymaganych pól pytania otwartego, rodzin pytań i dokładności cytatów.
- **Agent dostaje ogólne odrzucenia:**
  - `shape_malformed` ma jeden stały komunikat o polu `answer`, którego
    część typów w ogóle nie wysyła;
  - komunikaty walidatorów są po polsku (pisane dla rodzica), zwykle nie
    podają złej wartości ani tego, co zrobić;
  - bramka podpowiedzi nie mówi, które słowo uznała za zdradzające.

Prompt i walidatory to dziś dwa niezależne teksty, więc rozjeżdżają się przy
każdej nowej regule.

**Cel.** Każda deterministyczna reguła, która może odrzucić ćwiczenie agenta,
ma wpis w katalogu z opisem dla modelu. Prompt agenta składa się z opisów
reguł pasujących do przedmiotu i dozwolonych typów, a każde odrzucenie podaje
id reguły, ten sam opis i konkretną wartość, która ją złamała. Nowej kontroli
nie da się dodać bez wpisu z opisem (pilnuje kompilator i test).

| Pytanie | Decyzja (2026-11-06) |
|---|---|
| Opis reguły w prompcie | tak: prompt składa się z opisów reguł katalogu (pomysł właściciela) |
| Podpowiedź zdradzająca odpowiedź (bramka deterministyczna) | poluzować: bez słów pomocniczych i słów z pytania; gdy dalej zdradza, usunąć podpowiedź i przyjąć ćwiczenie z notą |
| Cytaty z materiału | poluzować: porównanie bez różnic cudzysłowów, myślników, wielokropka i wielkości liter |
| Wariant odpowiedzi uznany za nierównoważny | poluzować: usunąć wariant, przyjąć ćwiczenie z notą |
| Rodziny pytań otwartych | bez zmian (identyczna odpowiedź i elementy), ale jasny komunikat |
| Ślepe rozwiązanie z inną liczbą odpowiedzi | bez zmian |
| Podział | osobny PR 3 na gałęzi z PR 2 |
| Płatny przebieg kontrolny po zmianach | tak, za osobną zgodą przed startem (§8) |

**Poza zakresem:**
- zamiana `""` na brak pola w kodzie (zostaje reguła i komunikat);
- prompty etapu zagadnień szkoły (`generateLessonObjectives`), historyjki i planisty;
- reguły edytora rodzica nieosiągalne dla agenta (np. ręczne cytaty rodzica);
- zmiana kontroli modelami (ślepe rozwiązanie, sędzia podpowiedzi, ocena
  pytań otwartych) poza poluzowaniem wariantów — dostają tylko opisy w katalogu;
- zmiany Kid UI, sesji, MCP i `learning-overview`.

**Moduł i zależności.** Domena lekcji (`domain/lessons`: walidacja puli,
przedmioty, przyjmowanie agenta) i autorstwo materiału
(`modules/materials/lessons`: kształt rekordu, wejście agenta), adapter promptu
(`providers/openai/llm.ts`, `lesson-pool-agent.ts`) i materializery w
`providers/`. Kontrakty (`packages/contracts`) dostają tylko nowe eksporty
stałych limitów. Bez nowych zależności, bez migracji. Transakcje bez zmian:
katalog i komunikaty to czyste funkcje nad przekazanymi danymi.

## 2. Katalog reguł

### 2.1. Wpis reguły

Nowy katalog `domain/lessons/rules/` (czysta domena, bez importów providerów).
Wpis reguły:

| Pole | Znaczenie |
|---|---|
| `id` | stały identyfikator `obszar.nazwa`, np. `cloze.gap_count`, `school.quote_in_material`; tylko `[a-z0-9_.]` |
| `field` | pole ćwiczenia, którego dotyczy (do komunikatu), albo `exercise` |
| `appliesTo` | zakres: typy ćwiczeń (`types`) i warunek z kontekstu promptu (`when`, np. cytaty wymagane, ton lektora dozwolony) |
| `description` | jedno–trzy zdania po angielsku dla modelu: co musi być prawdą i jak to spełnić; liczby wstawione ze stałych, którymi posługuje się sprawdzenie |
| `promptless` | opcjonalny powód, dla którego reguła nie trafia do promptu (np. „answer computed by code”); tylko reguły nieosiągalne dla agenta |

`description` jest jedynym tekstem reguły dla modelu: ten sam trafia do
promptu i do odrzucenia. Katalogi są literałami `as const`, więc typ id jest
kluczem katalogu.

### 2.2. Gdzie żyją katalogi

| Katalog | Plik | Reguły |
|---|---|---|
| rdzeń | `domain/lessons/rules/core-rules.ts` | pola wspólne i kontrakt (puste napisy, długości, liczności), reguły typów z `pool-validation.ts`, rachunki (`calculation.ts`), kształt rekordu agenta i materializery |
| lekcja | `domain/lessons/rules/lesson-rules.ts` | reguły całej puli (`validatePool`: powtórzony bodziec, równoważne odpowiedzi), limity zagadnienia, ujawnienia odpowiedzi, opisy kontroli modelami (ślepe rozwiązanie, warianty, sędzia podpowiedzi, ocena pytań otwartych) |
| przedmiot | `domain/lessons/subjects/<przedmiot>/rules.ts` | reguły `validateExercise`, `validatePoolExtra`, `refineGeneratedPool`, bramek `exerciseGate` i sanityzacji polityki |

`SubjectModule` dostaje wymagane pole `rules` (katalog przedmiotu). Silnik nie
zna identyfikatorów przedmiotów: katalog przedmiotu przychodzi z modułu.

### 2.3. Zgłoszenie złamanej reguły

Sprawdzenia nie piszą już wolnego tekstu do `errors`. Zgłaszają:

```ts
type LessonRuleIssue = {
  readonly rule: string;      // id z katalogu
  readonly field: string;     // ścieżka pola, np. "sourceRefs[1].quote"
  readonly pl: string;        // komunikat dla rodzica (dotychczasowy polski tekst)
  readonly found?: string;    // po angielsku: co konkretnie jest nie tak, z wartością
};
```

Fabryka zgłoszeń jest budowana z katalogu (`issueFrom(catalog)`), więc
`issue("cloze.gap_count", …)` z id spoza katalogu się nie kompiluje.

- **`pl`** zostaje dosłownie dzisiejszym komunikatem, gdy taki istnieje, żeby
  panel rodzica i jego testy się nie zmieniły. Nowe zgłoszenia (np. kształt
  rekordu) dostają polski tekst w stylu istniejących.
- **`found`** podaje wartość, którą wysłał model, i liczbę albo różnicę
  (np. `5 gaps`, `quote "…" (not found in the material)`,
  `answer "A B" differs from the family answer "A C"`). Teksty z ćwiczenia
  wycinamy do 120 znaków z wielokropkiem.

Funkcje zwracające dziś `string[]` dla rodzica (`validateLessonExercise`,
`validatePool`, `SubjectModule.validateExercise`, `validatePoolExtra`) zwracają
zgłoszenia; wołający, który potrzebuje tekstu dla rodzica, bierze `pl`.
Publiczne sygnatury dla web (API lekcji) zachowują dotychczasowe komunikaty.

### 2.4. Gwarancje automatyczności

1. **Kompilator:** zgłoszenie wymaga id z katalogu.
2. **Test architektury** (`rules.architecture.test.ts`): w plikach walidatorów
   lekcji (`pool-validation.ts`, `calculation.ts`, walidatory, polityki i reguły
   przedmiotów, `agent/admission.ts`, kształt w `lesson-drafts.ts` i
   `lesson-pool-agent-tools.ts`, materializery) nie ma `errors.push(` ze
   zwykłym napisem ani zwracanych powodów odrzucenia spoza zgłoszeń.
3. **Test katalogu:**
   - każdy id jest unikalny w całym zbiorze katalogów i ma niepusty `description`
     albo `promptless`;
   - każdy id występuje w kodzie źródłowym poza katalogiem (żadnej martwej reguły);
   - `promptless` mają wyłącznie reguły z listy uzasadnionej w teście.
4. **Test promptu:** dla każdego przedmiotu i każdego jego typu ćwiczenia opis
   każdej pasującej reguły pojawia się w złożonym prompcie agenta, a reguła
   typu niedozwolonego w zagadnieniu się nie pojawia.

## 3. Prompt agenta z katalogu

**Składanie.** Domenowa funkcja `lessonRuleBook(subject, ctx)` zwraca listę
`{ id, types, description }` reguł pasujących do przedmiotu, dozwolonych typów
zagadnienia i warunków (`groundingRequired`, `voiceTones`,
`exerciseExplanations`, przydział `lesson_listen_choice`, typy kontroli z
`agentPolicy`). Wejście agenta (`lesson-pool-agent-input.ts`) przekazuje ją w
`LessonPoolInput.ruleBook`. Adapter tylko ją renderuje:

```
RULES — the tool checks every rule below; a rejection names the broken rule in [brackets].
General: [field.empty] … [field.max_length] …
lesson_cloze: [cloze.gap_count] … [cloze.bank_outside_gap] …
lesson_open_answer: [school.open_required_fields] … [hint.reveals_answer] …
Lesson: [lesson.duplicate_stimulus] … [lesson.leak] …
Checks by another model: [check.blind_solve] … [check.variants] …
```

**Co zastępuje.** Ręcznie pisane fragmenty, które opisują egzekwowane reguły,
znikają z `lessonSystemPrompt`, `objectiveInstructions` oraz z `fieldRules`,
`typeRules` i `promptNotes` przedmiotów: struktura `lesson_listen_choice`,
`lesson_calculation`, `lesson_keywords`, `lesson_match`, `lesson_group`,
`lesson_cloze`, wymóg `sourceRefs`, unikalność odpowiedzi i bodźców, reguły
`explanationPl`. Zostają ręcznie pisane wskazówki, których kod nie sprawdza:
rola, przedmiot, lista zagadnień i przekształceń, podział na etapy i
rezerwacja etapu samodzielnego, dostępność gradera, dobór tonu lektora, styl
i treść wyjaśnień, opis kształtu JSON oraz przepływ narzędzi.

**Brak utraty treści.** Każde zdanie usunięte z ręcznego promptu ma
odpowiednik w opisie reguły albo zostaje jako wskazówka. Plan zadań zawiera
zrzut złożonego promptu każdego przedmiotu przed zmianą i po niej (plik poza
repozytorium, fikcyjny materiał z testów), a przegląd końcowy porównuje je
zdanie po zdaniu.

**Nowe opisy reguł dziś nieobecnych w prompcie** (z audytu), m.in.:
- podpowiedź pytania otwartego nie zawiera odpowiedzi, wariantu ani tekstu
  elementu wymaganego, ani większości ich słów treściowych w żadnej formie;
  `null` jest zawsze dozwolony;
- `tolerance` rachunku to liczba, 0 albo najwyżej 1% obliczonego wyniku,
  nigdy `null`; `templateFamilyId` to małe litery i cyfry łączone `-`;
- żadne pole nie jest pustym napisem: pole, które nie dotyczy, ma `null`;
- `lesson_open_answer` szkoły wymaga niepustych `questionType`,
  `requiredElements` (1–6) i `expectedForm`; `supplementaryElements` i
  `commonErrors` najwyżej po 4;
- członkowie jednej rodziny pytań mają znak w znak tę samą odpowiedź wzorcową
  i te same elementy wymagane (te same id i teksty); `lesson_keywords` wysyła
  się razem z jego pytaniem otwartym, bo bez przyjętego pytania odpada;
- cytat to jeden ciągły fragment materiału, bez łączenia „…” i znaczników list;
- odpowiedź ćwiczenia samodzielnego nie może równać się odpowiedzi ćwiczenia
  kierowanego lub produktywnego ani przykładowi z karty;
- dla pytań typu „podaj dowolne dwa” elementy wymagane opisują to, co spełnia
  każdy poprawny wybór, a konkretne przykłady idą do `supplementaryElements`
  (dziś tylko w tekście odrzucenia `openMissing`).

Opis może mieć wariant zależny od przedmiotu (np. limit długości odpowiedzi
szkoły), ale wtedy reguła żyje w katalogu przedmiotu.

## 4. Odrzucenia dla agenta

**Format powodu.** Każdy powód odrzucenia deterministycznego ma postać:

```
[<rule id>] <field>: <found>. Rule: <description>
```

Bez `found` zostaje `[<id>] <field>. Rule: <description>`. Kod odrzucenia
(`rule_exercise`, `lesson_extra` itd.) i histogram `rejectedReasons` dla
rodzica się nie zmieniają. Dziennik odrzuceń (`RejectionLogEntry`, tylko w
pamięci) i logi `[lesson-agent]` dostają listę id reguł — bez treści ćwiczeń.

**Wszystkie błędy naraz.** Gdy kontrakt (schemat Zod) przechodzi, zgłoszenia
rdzenia, przedmiotu i bramki `exerciseGate` zbieramy razem w jednym odrzuceniu
(kod `rule_exercise`, a gdy są tylko ustalenia bramki — kod pierwszego
ustalenia). Gdy kontrakt nie przechodzi, zwracamy wszystkie zgłoszenia
kontraktu (jak dziś) i dalszych reguł nie sprawdzamy, bo zakładają poprawny
kształt. Reguły lekcji i ujawnienia nadal po regułach ćwiczenia.

**Kontrakt (Zod).** Zgłoszenie schematu dostaje id według rodzaju błędu:
`field.empty` (pusty napis), `field.max_length`, `field.count` (liczność listy),
`field.invalid` (zły typ albo wartość spoza listy). `found` podaje ścieżkę,
otrzymaną wartość (wyciętą) albo długość i limit. Opisy tych reguł wymieniają
limity pól ze stałych eksportowanych z `packages/contracts` (nowe eksporty dla
dziś literalnych 4, 6, 64, 3).

**Kształt rekordu agenta (`shape_malformed`).** Jeden ogólny komunikat znika:
- `rawExerciseShapeSchema` zwraca zgłoszenie z polem, oczekiwanym kształtem i
  otrzymanym typem, np. `options[0]: expected {id, text}, got a string`;
- materializery rachunku, słów kluczowych, par, grup i luk z bankiem zwracają
  zgłoszenie z przyczyną (np. tolerancja ponad 1% wyniku z obiema liczbami)
  zamiast ustawiać `answer: undefined`;
- `sourceRefs` i `requiredElements` w złym kształcie (np. napisy zamiast
  obiektów) dają zgłoszenie kształtu zamiast cichego usunięcia, po którym
  agent słyszał „brak cytatu”.

**Przykłady konkretnych komunikatów (wymagane w testach):**
- cytat spoza materiału: który cytat (indeks i tekst);
- rodzina pytań: które pole się różni (odpowiedź albo zbiór id elementów),
  obie wartości i slug bez sufiksu runu;
- słowa kluczowe bez rodziny: wyjaśnienie, że pytanie otwarte z tym
  `familyId` nie zostało przyjęte albo nie ma `familyId`;
- `focus` i `items`: oczekiwane tokeny odpowiedzi i złożony tekst;
- `correctOption` i `groupId` spoza listy: dozwolone id;
- odrzucenie ślepego rozwiązania: także klucz odpowiedzi.

## 5. Poluzowania reguł (wariant A)

### 5.1. Podpowiedź pytania otwartego (szkoła)

- `hintRevealsAnswer` zwraca dopasowanie (cel: odpowiedź, wariant albo element
  wymagany; jego tekst; wspólne słowa) zamiast wartości logicznej.
- Słowa treściowe celu nie obejmują:
  - polskich słów pomocniczych ze stałej listy w `hint-gate.ts` (m.in. „jest”,
    „przez”, „które”, „oraz”, „tego”, „była”, „może”, „gdzie”, „kiedy”);
  - słów, które występują w pytaniu ćwiczenia (`prompt`), dopasowanych tak samo
    jak dziś (wspólny początek).
- Gdy podpowiedź dalej zdradza, sanityzacja polityki szkoły (`sanitize`) usuwa
  podpowiedź, a ćwiczenie przechodzi dalej. Agent dostaje notę
  `hint removed [hint.reveals_answer]: shares "…", "…" with the required element "…"`.
  Bramka `exerciseGate` przestaje zgłaszać `hint_reveals_answer`.
- Sędzia podpowiedzi (model) zostaje bez zmian i nadal odrzuca
  (`hint_reveals_paraphrase`, `hint_unsupported`, `hint_language`). Po
  usunięciu podpowiedzi sędzia nie jest wołany.
- Bramka działa tylko w przyjmowaniu agenta; edytor rodzica się nie zmienia.

### 5.2. Cytaty z materiału (szkoła)

Porównanie cytatu z materiałem (`validateSchoolPool`) normalizuje obie strony:
NFC, cudzysłowy typograficzne („ ” “ ” « » ‚ ‘ ’) do prostych, myślniki i
łączniki (‐ ‑ ‒ – — ― −) do `-`, `…` do `...`, zwinięte białe znaki i małe
litery (`toLocaleLowerCase("pl")`). Długość minimalna liczona jak dziś.
Dotyczy też publikacji i edycji rodzica (ta sama reguła), co tylko je łagodzi.

### 5.3. Warianty odpowiedzi (wszystkie przedmioty)

Gdy niezależny model uzna wariant z `acceptedAnswers` za nierównoważny,
przyjmowanie usuwa ten wariant i przyjmuje ćwiczenie, jeśli kroki
deterministyczne przechodzą także dla ćwiczenia bez niego (powtórzone na
oczyszczonym szkicu). Agent dostaje notę
`variant "…" removed [check.variants]: not equivalent to the answer "…"`.
Kod `variant_rejected` znika z histogramu; liczba usuniętych wariantów trafia
do liczników dziennika (bez treści).

## 6. Testy

- Katalog i gwarancje z §2.4.
- Złożony prompt (§3): obecność pasujących opisów, brak opisów typów
  niedozwolonych, brak usuniętych ręcznych fragmentów.
- Komunikaty: dla każdej grupy reguł co najmniej jeden test, że powód zawiera
  id, pole, wartość i opis; przykłady z §4 jako osobne testy.
- Poluzowania: podpowiedź z „jest” i słowami pytania przechodzi; podpowiedź ze
  słowami elementu wymaganego traci podpowiedź z notą, a ćwiczenie jest
  przyjęte; cytat różniący się cudzysłowem, myślnikiem lub wielkością liter
  przechodzi; inny cytat odpada; wariant odrzucony przez model znika, a
  ćwiczenie jest przyjęte; wariant, którego usunięcie nie wystarcza (krok
  deterministyczny dalej odpada), daje odrzucenie.
- Istniejące testy, które sprawdzają polskie komunikaty dla rodzica, przechodzą
  bez zmian; testy powodów agenta przechodzą na nowy format.
- Pełne bramki: `pnpm check`, `pnpm test:integration`, `pnpm test:e2e:shards`.

## 7. Prywatność i dane

- Odrzucenia i noty cytują wyłącznie treść ćwiczenia, którą ten sam model
  właśnie wysłał, i materiał rodzica, który model już dostał. Bez danych
  dziecka.
- Logi i dziennik dostają tylko id reguł i liczniki, nigdy `found`, `pl`,
  treści ćwiczeń ani materiału.
- Bez zmian w Kid DTO, MCP, `SKILL.md` i `learning-overview`; lekcje są poza
  nimi. Komunikaty walidacji dla rodzica zostają po polsku.

## 8. Płatny przebieg kontrolny

Za osobną zgodą właściciela przed startem, jak 2026-11-05: rozdział, gramatyka
(+6) i szkoła na tych samych materiałach, z zapisem treści i odrzuceń
(`UMIEM_PROBE_DUMP`, `UMIEM_PROBE_POOL_DUMP_OUT`, `agentSubmissions`) poza
repozytorium. Porównujemy odsetek odrzuceń per kod i reguła, koszt i czas z
przebiegiem 2026-11-05 oraz przeglądamy treść przyjętych ćwiczeń i
usuniętych podpowiedzi. Spadek odrzuceń szkoły jest oczekiwanym skutkiem, nie
warunkiem scalenia; wynik trafia do `docs/architecture.md` §19.17 i opisu PR.

## 9. Dokumentacja

- `docs/architecture.md` §19.17: katalog reguł, format odrzuceń, poluzowania.
- `AGENTS.md`: nową regułę walidacji ćwiczeń lekcji dodaje się jako wpis
  katalogu z opisem dla modelu; prompt agenta składa się z opisów, a
  odrzucenie podaje id reguły.
- Opis PR: wpływ na API → MCP → `SKILL.md` (brak, uzasadnienie), poluzowania i
  ich skutek dla rodzica (ćwiczenie bez podpowiedzi, mniej wariantów).

## 10. Ryzyka

| Ryzyko | Ograniczenie |
|---|---|
| Nowy prompt pogorszy treść ćwiczeń | zrzuty promptu przed i po w przeglądzie; płatny przebieg z przeglądem treści |
| Duża, mechaniczna zmiana ok. 190 miejsc | zadania per obszar, testy komunikatów rodzica bez zmian, test architektury |
| Dłuższy prompt (opisy reguł) | tylko reguły dozwolonych typów; pomiar kosztu w przebiegu |
| Podpowiedź usuwana zbyt często | nota z dopasowanymi słowami w wynikach przebiegu; przegląd usuniętych podpowiedzi |
| Łagodniejsze cytaty przepuszczą zmieniony sens | normalizujemy tylko znaki typograficzne i wielkość liter, nie słowa |
