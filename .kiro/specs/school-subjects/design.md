# Design — przedmioty szkolne i trener precyzji odpowiedzi

**Status:** Etapy 1–2 zaimplementowane na gałęzi `feature/school-subjects-source-material` (2026-10-28); ewaluacja gradera na złotym zestawie: wiedza 19/20 (95%), przypadki twarde 100% wiedzy, brakujące elementy 19/20 (model `deepseek/deepseek-v4.1-flash`, prompt `school-grader-v2`; zapis przebiegu: `grader-eval-2026-10-28.md`). Etap 2b (zadania rachunkowe) zaimplementowany na tej samej gałęzi (2026-10-28), kontrakt poniżej w pkt 3; Etapy 1–2b scalone do `main` (PR #149). Etap 4 (trener precyzji) zaimplementowany na gałęzi `feature/school-precision-trainer` (2026-10-29), kontrakt w pkt 6. Etapy 3 i 5 według `tasks.md`.
**Wymagania:** `requirements.md`. **Baza:** silnik lekcji (architecture.md §19, SPEC §29a).

## 1. Decyzja główna: przedmiot generyczny na silniku lekcji

Zestaw szkolny jest lekcją (`decks.kind = 'lesson'`, `learning_items.kind =
'lesson_exercise'`). Nie wprowadzamy `decks.kind = 'source_material'` z dokumentu
źródłowego: nowy rodzaj zestawu wymusiłby duplikację wszystkich rozgałęzień
z architecture.md §19.2 (sesje, próby, kartkówki, postęp, raporty, usuwanie profilu)
bez korzyści produktowej. Nowy jest jeden przedmiot w rejestrze `SubjectModule`
o identyfikatorze `school` oraz mechanizm **tematu dynamicznego** (pkt 2).

Obszary modułów bez zmian granic: autorstwo w `materials/lessons/`, sesje i próby
w `learning/lessons/`, reguły w `domain/lessons/`, przedmiot w
`domain/lessons/subjects/school/`. Raportowanie tylko czyta. Kierunki zależności
i test architektoniczny silnika (brak importów `subjects/` poza rejestrem)
obowiązują nadal.

## 2. Temat dynamiczny

Dziś `SubjectModule.topics` to statyczny, wersjonowany katalog w kodzie,
a `deck_versions.lesson_context` przechowuje `subjectId`, `topicId`,
`topicVersion`, `objectiveIds`, `material`, `instruction`, `poolSize`, `examples`.
Dla przedmiotu `school` katalog w kodzie jest pusty; temat i cele pochodzą
z materiału konkretnego szkicu.

Rozwiązanie:

1. `lesson_context` dla `school` dostaje pole `dynamicTopic`:
   `{ titlePl, objectives: [{ id, titlePl, descriptionEn, cards: [{title, body}],
   errorCategories, exerciseTypes }] }` — ten sam kształt co `LessonTopic` /
   `LearningObjective` z `domain/lessons/types.ts`, walidowany schematem Zod
   w kontraktach przed zapisem. `topicId = 'dynamic'`, `topicVersion = 1`
   (kontekst opublikowanej wersji jest niezmienny istniejącym triggerem).
2. Czysta funkcja domenowa `buildDynamicTopic(context): LessonTopic` składa temat
   z kontekstu. Rejestr dostaje jedną ścieżkę rozwiązywania tematu:
   `resolveTopic(subject, context)` — statyczny temat z katalogu albo dynamiczny
   z kontekstu. Silnik (selektor, ocena, pula, kartkówka) pracuje na `LessonTopic`
   jak dziś i nie wie, skąd temat pochodzi.
3. Identyfikator celu ma postać `school.d<deckId>.<slug>` (slug nadawany przy
   generowaniu, niemutowalny w edytorze). Unikalność między zestawami jest
   konieczna, bo `child_objective_progress` jest kluczowane parą
   (dziecko, przedmiot, cel) — dwa zestawy o celu „fotosynteza” nie mogą
   współdzielić projekcji, skoro ich kryteria wolno edytować niezależnie.
   Usunięcie i ponowne utworzenie zagadnienia daje nowy identyfikator; edycja
   treści przy zachowanym identyfikatorze zachowuje postęp (analogia do reguły
   katalogu: zmiana znaczenia = nowy identyfikator, decyzja nadawcy).
4. Kategorie błędów przedmiotu `school` są stałe i generyczne
   (`missing_element`, `wrong_fact`, `confused_concept`, `incomplete` + kategorie
   bazowe); szablony podpowiedzi żyją w module przedmiotu, nie pochodzą z modelu.
   Po odpowiedzi częściowej/błędnej feedback to wyłącznie szablon kategorii,
   bez treści wzorca i bez zapisu ekspozycji (wym. 5.7); wzorzec pokazuje
   dopiero istniejący cykl wsparcia (np. „Nie pamiętam”), z ekspozycją.
5. `validateExercise` przedmiotu `school` sprawdza reguły szkolne z pkt 3;
   `ttsForAnswers = false`; `poolDeduplication = 'exercise'` (rodziny pytań współdzielą odpowiedź wzorcową — deduplikacja po odpowiedzi odrzucałaby każdego kolejnego członka rodziny; korekta po code review Etapu 1); normalizator bazowy
   (polska odpowiedź: NFC, wielkość liter, interpunkcja, spacje).

Generowanie puli (worker, `generateLessonPool`) dostaje dla `school` dodatkowy
etap w tym samym runie: najpierw model proponuje `dynamicTopic` (zagadnienia
i karty), walidacja domenowa sprawdza kształt i reguły katalogu (pkt 2); karty nie niosą cytatów — są parafrazą materiału zatwierdzaną przez rodzica, a uziemienie cytatami (pkt 3) dotyczy ćwiczeń i elementów wymaganych,
potem istniejące generowanie partiami per cel produkuje ćwiczenia. Oba etapy
w jednym `generation_runs.kind = 'lesson'`; niepowodzenie etapu zagadnień kończy
run bez zapisu częściowego, jak dziś.

Granica rozszerzania materiału (decyzja właściciela 2026-10-28): generowanie
może upraszczać karty własnymi słowami i dokładać przykłady/analogie pomocnicze,
ale nie wolno mu wprowadzać nowych faktów do pytań, odpowiedzi wzorcowych ani
elementów wymaganych. Prompt generacji `school` ma to jako twardą regułę,
a pokrycie cytatem (pkt 3) jest jej egzekwowalnym przybliżeniem; ostateczną
bramką pozostaje zatwierdzenie rodzica. Sugerowane dopiski faktograficzne
i oznaczanie ich w edytorze świadomie odrzucono (słabsze uziemienie).

## 3. Payload ćwiczenia v3 (`payload_version = 3`, tylko przedmiot `school`)

Payload v2 gramatyki pozostaje bez zmian. Dla `school` dochodzą pola opcjonalne
w `LessonExerciseDraft` i schemacie kontraktów (`packages/contracts/src/lessons.ts`):

| Pole | Kształt | Zasada |
| --- | --- | --- |
| `questionType` | `definition \| enumeration \| cause \| comparison \| fact \| process` | wymagane dla `lesson_open_answer` |
| `requiredElements` | `[{ id, text }]`, 1–6 elementów, każdy ≤120 znaków | wymagane dla `lesson_open_answer`; `id` stabilne w ćwiczeniu |
| `supplementaryElements` | `string[]`, ≤4 | informacje poprawne, lecz niewymagane |
| `commonErrors` | `string[]`, ≤4 | typowe błędne stwierdzenia; tylko dla gradera i rodzica |
| `expectedForm` | `short \| one_sentence \| explanation \| list` | domyślnie `explanation` dla otwartej, `short` dla faktograficznej |
| `familyId` | string (slug w obrębie celu) | grupa sformułowań tego samego pytania; ten sam slug w innym celu to inna rodzina |
| `sourceRefs` | `[{ quote }]`, 1–3 | `quote` = dokładny fragment źródła; pola `documentId`/`page` zarezerwowane na przyszły import, dziś nieużywane |

Walidacja (generowanie, edycja rodzica i publikacja — ta sama funkcja):

- każdy `sourceRefs[].quote` po normalizacji (NFC, białe znaki) jest podciągiem
  materiału źródłowego z kontekstu albo tekstu dodanego i oznaczonego przez
  rodzica; brak pokrycia = odrzucenie ćwiczenia (uziemienie, wym. 2.3);
- ćwiczenia otwarte mają 1–6 elementów wymaganych i odpowiedź wzorcową, która
  je wszystkie zawiera treściowo (sprawdza rodzic; automat sprawdza tylko
  obecność i limity — świadomie, bez kolejnego wywołania modelu);
- rodzina pytań to para (`objectiveId`, `familyId`): identyczny zbiór
  identyfikatorów elementów wymaganych i wspólna odpowiedź wzorcowa; różny
  tekst pytania. Model generuje każdy cel osobną partią i nie zna slugów innych
  partii, więc ten sam slug w dwóch celach to dwie rodziny; przy dogenerowaniu
  slugi rodzin nowej partii dostają sufiks runu, by nie dołączyć do istniejącej
  rodziny z inną odpowiedzią;
- limity pól (odpowiedź ≤300, 1–6 elementów ≤120 znaków, ≤4 elementy
  uzupełniające i typowe błędy, 1–3 cytaty ≤600) wymusza ten sam schemat
  kontraktu co API rodzica; puste tablice v3 ze structured output traktujemy
  jak brak pola;
- typy zamknięte (`lesson_choice`, `lesson_gap`, `lesson_order`) używają
  istniejących pól i walidacji puli; `sourceRefs` wymagane także dla nich.

Zadania rachunkowe (etap 2b, decyzja właściciela 2026-10-28): nowy typ
`lesson_calculation` z polem payloadu
`calculation: { kind, params, unit, tolerance?, templateFamilyId }`, gdzie
`kind` należy do zamkniętego enuma implementowanego w domenie — na start:
`scale_distance` (skala mapy: mianownik skali × odległość na mapie, z wyborem
jednostki wyniku), `height_difference` (wysokość względna: różnica wysokości
bezwzględnych), `unit_conversion` (cm↔m↔km). Czysta funkcja domenowa
`computeCalculationAnswer(spec)` jest jedynym źródłem poprawnej
odpowiedzi: walidacja puli przelicza każde ćwiczenie i odrzuca niezgodne
(model proponuje szablon i parametry, nie wynik), a ocena próby parsuje polski
zapis liczby (spacje tysięcy, przecinek dziesiętny), opcjonalną jednostkę
i porównuje z tolerancją szablonu — bez gradera. Warianty liczbowe szablonu
to osobne ćwiczenia w puli o wspólnym `templateFamilyId`, w edytorze
pokazywane razem z policzonymi odpowiedziami; Kid UI używa istniejącego
pola odpowiedzi z przyciskiem „Sprawdź” (odpowiedź pisemna). Przykłady
z pilotażu: skala 1:25 000 i 3 cm → 750 m; 400 m n.p.m. − 150 m n.p.m. → 250 m.

Kontrakt Etapu 2b (2026-10-28; decyzje przyjęte i zaimplementowane w całym przepływie — domena, walidacja, generowanie, edytor z podglądem `lessons.previewCalculation`, ocena prób i kartkówka, Kid UI):

- `CalculationSpecSchema` to ścisła unia po `kind`; ścisłe `params` zawierają
  odpowiednio `{scaleDenominator,mapDistanceCm}`, `{upperHeightM,lowerHeightM}`
  lub `{value,fromUnit}`. `unit` i `fromUnit` należą do `cm | m | km`.
  `templateFamilyId` to slug `[a-z0-9]+(?:-[a-z0-9]+)*`, 1–64 znaków,
  identyfikujący rodzinę w obrębie celu (jak `familyId`).
- Parametry są skończone, mają ≤3 miejsca dziesiętne i moduł ≤1 000 000;
  odległości i wartość konwersji są nieujemne, wysokości mogą być ujemne,
  `upperHeightM >= lowerHeightM`. Mianownik skali jest całkowity 1–1 000 000 000.
- Schemat sprawdza kształt i lokalne ograniczenia; domena oblicza dokładny
  wynik i dopiero wtedy wymaga tolerancji absolutnej w jednostce wyniku od 0
  do 1% modułu wyniku (domyślnie 0; przy wyniku 0 wyłącznie 0).
- Domena udostępnia `computeCalculationAnswer(spec): {value,unit,answer}`,
  `renderCalculationPrompt(spec): string`,
  `parseCalculationAnswer(text): {value,unit:null|LengthUnit}|null` oraz
  `evaluateCalculationAnswer(text,spec): correct|incorrect|unevaluated`.
  Każda funkcja przyjmująca spec waliduje go również po odczycie z JSONB.
  Ułamki `bigint` pozostają prywatne; `value:number` jest przybliżeniem do
  wymiany JSON, nigdy podstawą obliczeń, renderowania ani oceny. `answer`
  zachowuje wynik dokładny, przecinek dziesiętny, bez grupowania i zbędnych zer.
- Parser czyta cały tekst: opcjonalny znak `+`/`-`/`−`, cyfry, opcjonalny
  przecinek z 1–9 cyframi, opcjonalną jednostkę bez rozróżniania wielkości
  liter — symbol `cm|m|km` albo polską nazwę (`metr`, `metry`, `metrów`,
  `metra`, analogicznie centymetr i kilometr). Po jednostce wolno dopisać
  `n.p.m.` (zapis przepisany z polecenia wysokości), a na końcu jedną kropkę
  („750 m.”). Grupy tysięcy mają po 3 cyfry (spacja, NBSP lub wąski NBSP).
  Kropka dziesiętna, wykładniki i dodatkowy tekst są odrzucane. Ocenianie
  przelicza jawne jednostki; brak jednostki oznacza jednostkę polecenia.
  Porównuje dokładne ułamki z oryginalnego tekstu, bez poszerzającego
  tolerancję epsilonu.
- Nieparsowalny niepusty tekst daje `unevaluated`/`not_assessed`, bez modelu
  i zmiany serii; parsowalny błędny wynik daje `incorrect` z podpowiedzią
  metody z `messages.kid.lessonCalculationHints`, bez wyniku i bez ekspozycji
  odpowiedzi (ekspozycję zapisuje wyłącznie feedback pokazujący odpowiedź:
  `great` oraz feedback z `correctText`). Pusta odpowiedź nadal jest
  odrzucana przez kontrakt tekstu. Skip i „Nie pamiętam” zachowują semantykę
  silnika. Rachunek nie ma wymiaru precyzji ani werdyktu modelu. Rachunek bez
  własnego polecenia (np. z generacji) dostaje `messages.kid.lessonCalculationInstruction`.
- Etap `independent`, także w kartkówce, oznacza odpowiedź pisemną; nadal
  obowiązuje kwalifikacja próby i ekspozycji. Minima puli 3/2/2 oraz dwa różne
  otwarte pytania zostają; rachunki uzupełniają pulę. Zachowujemy globalny
  `computeTargetKey(answer, answerLocale)` i konserwatywne wykluczanie wyniku
  po ujawnieniu. Parametry rachunku pozostają prywatne poza Kid DTO.
- Pytania renderuje kod z zamkniętych szablonów, model proponuje parametry
  i rodzaj, nigdy swobodny tekst ani wynik. Warianty liczbowe są przykładami
  metody ze źródła, bez nowych faktów czy nazw miejsc; wymagają cytatu
  i zatwierdzenia rodzica. Brak uploadu, OCR i generowania pytań podczas sesji.

Pokrycie minimalne publikacji na zagadnienie (do potwierdzenia na pilotażu):
karty nauki w celu, ≥3 ćwiczenia prowadzone (wybór), ≥2 produktywne
(luka/porządkowanie), ≥2 otwarte. Pula musi zawierać co najmniej dwa różne
pytania otwarte na zagadnienie (nie tylko jedną rodzinę): rodzina współdzieli
odpowiedź, więc po jej ujawnieniu pozostałe sformułowania nie są już
samodzielnym sprawdzeniem w sensie ekspozycji silnika. Rodziny dają różnorodność
pierwszego sformułowania i powtórek innymi słowami; opanowanie nadal wymaga
sukcesów na różnych ćwiczeniach z różnymi odpowiedziami.

## 4. Ocena dwuwymiarowa odpowiedzi otwartej

Rozszerzamy istniejący port `AnswerGraderProvider` i ścieżkę hybrydową
(`learning/lessons/lesson-attempts.ts`), bez nowego portu i bez zmian dla
gramatyki (werdykt v1 gramatyki pozostaje ważny; rozróżnia je pole wersji
w wejściu gradera i `promptVersion`).

Wejście dla `school`: pytanie, odpowiedź wzorcowa, `requiredElements`,
`supplementaryElements`, `commonErrors`, `expectedForm`, cytaty źródłowe,
odpowiedź dziecka (limit podniesiony dla tego przedmiotu do 600 znaków;
limit gramatyki bez zmian). Wyjście (surowy JSON, walidowany w domenie):

```json
{
  "knowledge": "correct | partial | incorrect",
  "precision": "concise | verbose | unfocused",
  "matchedElementIds": ["e1"],
  "missingElementIds": ["e2"],
  "incorrectStatements": ["<dokładny podciąg odpowiedzi>"],
  "redundantFragments": ["<dokładny podciąg odpowiedzi>"],
  "note": "<krótki komentarz wyłącznie dla rodzica>"
}
```

Zasady `validateVerdict` (naruszenie = odrzucenie werdyktu, próba „nieocenione”):

- `correct` ⇒ brak `missingElementIds` i brak `incorrectStatements`;
- `partial` ⇒ co najmniej jeden element trafiony oraz (brak elementu albo
  nieistotna nieścisłość), bez istotnego błędu rzeczowego jako jedynej treści;
- obecność istotnego błędnego stwierdzenia przy braku trafień ⇒ `incorrect`;
- każdy fragment (`incorrectStatements`, `redundantFragments`) jest dokładnym
  podciągiem odpowiedzi po NFC, jak dziś;
- identyfikatory elementów wyłącznie ze zbioru ćwiczenia.

Mapowanie na istniejący model wyników: `correct` → sukces kwalifikujący
(jak dziś, z zasadami samodzielności i ekspozycji), `partial` → werdykt
„prawie” (`model_almost` w szczegółach) z wynikiem `incorrect`: bez zaliczenia
opanowania i — jak każdy niepełny wynik samodzielnego sprawdzenia — przerywa
serię (reguła silnika „błąd przerywa serię”; korekta pierwotnego szkicu, bo
brakujący element wymagany JEST sprawdzaną treścią, inaczej niż literówka
poza focusem w gramatyce), z zapisem brakujących elementów jako trudności;
`incorrect` → błąd. Precyzja zapisuje się do `assessments.details` i cache
`lesson_verdicts` wraz z elementami trafionymi/brakującymi i identyfikatorem werdyktu;
nie istnieje ścieżka kodu, w której precyzja zmienia wynik wiedzy — pilnuje
tego test jednostkowy mapowania.

Forma `one_sentence`: liczbę zdań liczy kod (podział po `. ! ? …`, z tolerancją
na brak kropki końcowej) przed wywołaniem modelu; więcej niż jedno zdanie
ustawia w szczegółach `formOk = false` i wymusza precyzję co najwyżej
`verbose`, wiedzy nie zmienia. Cache werdyktów: ten sam stół `lesson_verdicts`,
`promptVersion = 'school-grader-v2'` (v2 po review Etapu 2: prompt i walidator wymagają pełnej partycji elementów wymaganych); nadpisanie przez rodzica jak dziś.

Koszt: swobodne parafrazy rzadko trafiają w cache, więc koszt rośnie liniowo
z liczbą odpowiedzi otwartych. Istniejący limit wywołań na sesję pozostaje
bezpiecznikiem; jego wartość dla zestawów szkolnych kalibrujemy na pilotażu
(Etap 2), nie zgadujemy teraz.

Bramka jakości (Etap 2): ewaluacja na `grader-golden-set.json` przez fake
i skonfigurowany model. Twarde wymaganie: wszystkie przypadki klasy
„słowa kluczowe + błędna zależność” i „istotny błąd rzeczowy” ocenione jako
`incorrect`; próg zgodności wymiaru wiedzy ≥90%. Precyzja jest raportowana
(zgodność mierzona), ale w pierwszej wersji nie bramkuje wdrożenia.

## 5. Odpowiedź mówiona (Etap 3)

Dziś `lesson-attempts.ts` odrzuca modalność audio. Etap 3 otwiera ją wyłącznie
dla `lesson_open_answer` przedmiotów, które to zadeklarują: transkrypcja
istniejącym portem STT z locale `pl-PL`, potem ta sama finalizacja co tekstu,
z modalnością zapisaną przy próbie. Niska pewność transkrypcji lub awaria STT
= „nieocenione” (bez oceny, bez pomyłki). Przed implementacją krótki spike:
jakość polskiego STT obecnego providera na głosie dziecka; wynik spike'a
decyduje o ewentualnej zmianie adaptera. Kid UI reużywa `SpeechRecordButton`
w widoku odpowiedzi otwartej lekcji.

## 6. Trener precyzji (Etap 4) — kontrakty

Status: zaakceptowany przez właściciela 2026-10-29 (decyzje 6.5 z
rekomendacjami) i zaimplementowany na gałęzi `feature/school-precision-trainer`;
korekty wprowadzone przy implementacji opisuje 6.7. Moduł
odpowiedzialny: silnik lekcji (`learning/lessons/`) i przedmiot `school`
(`domain/lessons/subjects/school/`); zapis treści — `materials/lessons/`.
Gramatyka i słówka bez zmian.

Ustalenie z kodu, które kształtuje projekt: sesja treningowa lekcji ma plan
zamrożony przy starcie (`trainingPlan`, sloty indeksowane liczbą wydanych
zadań), a budżet liczy zadania inne niż karty. Zadanie dokładane w trakcie
sesji musiałoby więc przesunąć plan albo zjeść budżet — stąd osobna kategoria
„zadanie następcze” (6.3).

### 6.1. „Najpierw słowa kluczowe” — typ `lesson_keywords`

Ćwiczenie w puli (payload v3, tylko `school`), powiązane z rodziną pytań
otwartych przez `familyId`:

| Pole | Kształt | Zasada |
| --- | --- | --- |
| `exerciseType` | `"lesson_keywords"` | etap `guided` (wspomagany) |
| `familyId` | slug | wymagane; wskazuje rodzinę `lesson_open_answer` w tym samym celu |
| `keywordOptions` | `[{ id, text }]`, 4–6, tekst ≤40 znaków | pojęcia do wyboru; unikalne po normalizacji |
| `keyOptionIds` | `string[]`, 2–3 | pojęcia kluczowe, podzbiór `keywordOptions` |
| `answer` | string | pojęcia kluczowe złączone `", "` (dla `targetKey` i podglądu rodzica) |
| `instructionPl`, `sourceRefs` | jak w innych typach | `sourceRefs` wymagane |

Walidacja puli: każde pojęcie kluczowe występuje (NFC, bez wielkości liter,
z tolerancją polskiej odmiany — każde słowo pojęcia ma w tekście słowo o tym
samym początku bez dwóch ostatnich liter, min. 4 znaki: „światło” pasuje do
„światła”) w odpowiedzi wzorcowej rodziny albo w materiale; ćwiczenie bez rodziny otwartej
w celu jest odrzucane. Dobór dystraktorów (z materiału, nie kluczowe) sprawdza
rodzic — automat pilnuje kształtu, unikalności i obecności pojęć kluczowych.
Publikacja nie wymaga `lesson_keywords` (minima puli bez zmian).

Kid DTO (`.strict()`, bez klucza):

```ts
{ kind: "lesson_keywords", instructionPl: string, prompt: string,
  options: ChoiceOption[] /* 4–6, UUID nadane przy materializacji */,
  minSelected: 2, maxSelected: /* liczba pojęć kluczowych: 2 albo 3 */ }
```

`prompt` to tekst pytania otwartego zaplanowanego bezpośrednio po tym zadaniu
(dziecko widzi pytanie, na które zaraz odpowie). Odpowiedź: nowa modalność
`selection` (`itemIds`: 2–3 unikalne UUID; migracja rozszerza
`attempts_modality_allowed`) — nie `sequence`, bo kolejność nie ma znaczenia.

Ocena deterministyczna, bez modelu: poprawna, gdy wszystkie wybrane pojęcia są
kluczowe; inaczej `incorrect` z `correctText` = pojęcia kluczowe. Próba jest
zawsze wspomagana (`independent = false`, bez potwierdzenia), więc jak każda
nieniezależna ocena nie wchodzi do serii opanowania. Zadanie liczy się do
budżetu sesji (zwykłe ćwiczenie).

Plan i ekspozycje: selektor wydaje parę slotów — `lesson_keywords`, a zaraz po
nim pytanie otwarte z tej samej rodziny (powód `precision_practice`). Wydanie
`lesson_keywords` zapisuje ekspozycję `targetKey` tej rodziny przed
ujawnieniem listy pojęć, więc następująca odpowiedź otwarta jest wspomagana
istniejącą regułą ekspozycji (wym. 7.1, N09); sam wybór pojęć ma zawsze
`independent = false`. Para to osobny priorytet planu (po należnych
sprawdzeniach, wsparciu i oknie sprawdzianu, przed kontynuacją), raz na cel
w sesji, tylko w planie zamrożonym (sesje bez planu jej nie dostają), przy
graderze z wolnym wywołaniem i budżecie na oba sloty; nigdy w kartkówce.
Zwykły wybór ćwiczeń prowadzonych nie wydaje `lesson_keywords`, a słowa
kluczowe nie liczą się do minimów pokrycia puli.

### 6.2. „Odpowiedz w jednym zdaniu”

Bez nowego typu: to `lesson_open_answer` z `expectedForm: one_sentence`
nadanym przez materiał lub rodzica (wym. 7.2), zaimplementowane w Etapie 2
(`countSentences`, `formOk`, klamra precyzji, także przy dokładnym
dopasowaniu). Etap 4 dodaje tylko preferencję selektora (6.4).

### 6.3. „Skróć swoją odpowiedź” — zadanie następcze `lesson_shorten`

Wyzwalacz, sprawdzany przy finalizacji odpowiedzi otwartej `school` w sesji
treningowej (nie w kartkówce):

- wiedza `correct` i precyzja `verbose` lub `unfocused`, z co najmniej jednym
  fragmentem zbędnym (`redundantFragments`) albo z `formOk = false`;
- zostało co najmniej jedno wywołanie gradera;
- sesja nie była w fazie obietnicy „Jeszcze 3 i koniec!”, gdy dziecko
  odpowiadało (`remainingAssessed` tego zadania > 3, czyli baner jeszcze się
  nie pokazał).

Dokładne dopasowanie wariantu nie ma fragmentów, więc skrócenie proponujemy
w nim tylko przy `formOk = false`.

Oryginał finalizuje się bez zmian (ocena, ekspozycje, projekcja), z nowym
rodzajem feedbacku `lesson_precision_hint` z szablonu („Wiesz to! Teraz spróbuj
powiedzieć to krócej”). W tej samej transakcji powstaje zadanie następcze
`lesson_shorten` w stanie `issued` — technicznie odpowiedź otwarta
(`exerciseType: lesson_open_answer`, ta sama rewizja i klucz z dopisanym
`revisionOf`), rozpoznawana przez Kid UI po `prompt.kind`:

- `session_tasks.context.followUpOf = { taskId, attemptId }`, ordinal = kolejny
  wolny. Zadanie następcze nie jest slotem planu, nie liczy się do budżetu
  (liczniki i indeks slotu pomijają zadania z `followUpOf`) i nie trafia do
  historii sesji selektora ani do `historicalSupportObjectives`.
- Kid DTO (`.strict()`): `{ kind: "lesson_shorten", instructionPl, prompt,
  originalAnswer /* ≤600, własny tekst dziecka */,
  answerSegments /* SpellingDiffSegment[], pill = do usunięcia */ }`. Pole
  odpowiedzi startuje z treścią oryginału (dziecko usuwa zaznaczone części).
  Prompt niczego nie ujawnia (to tekst dziecka), więc nie zapisuje ekspozycji.
- Odpowiedź: modalność `text` (mowa po Etapie 3) albo `skip` („Dalej” bez
  skracania — zadanie `skipped`, bez oceny). Tekst identyczny z oryginałem po
  normalizacji → podpowiedź „To ta sama odpowiedź…” bez oceny i bez modelu,
  zadanie zostaje `issued`.
- Ocena: ten sam grader i kryteria oryginału (`school-grader-v2`, cache
  `lesson_verdicts`), z `independent = false` i `confirmationEligible = false`,
  więc bez wpływu na serię opanowania. `details` dostają
  `revisionOf: { taskId, attemptId }`, `lostElementIds` (trafione w oryginale,
  brakujące w poprawce) i `shorter: boolean` (długość w znakach). Wynik
  `correct` tylko przy zachowaniu wszystkich elementów wymaganych; utrata
  elementu (N07) → `incorrect` z podpowiedzią z szablonu („Krócej, ale
  zgubiła się ważna informacja”), bez treści elementu i odpowiedzi wzorcowej.
- Raport rodzica (nadzór lekcji, `school.shortening`): per zagadnienie liczba
  zaproponowanych, podjętych i udanych skróceń (krócej, bez utraty elementu)
  oraz do 3 ostatnich par oryginał → poprawka z utraconymi elementami
  (wym. 8.2). Poprawki nie wchodzą do liczników wiedzy i precyzji, ostatnich
  odpowiedzi ani najczęstszych błędów celu.

### 6.4. Selektor trenera (wym. 7.4)

Reguły w czystej funkcji selektora, nad ostatnią oceną odpowiedzi otwartej
per cel z poprzednich sesji (bez zadań następczych):

1. wiedza poprawna + precyzja `verbose`/`unfocused` → przy wyborze odpowiedzi
   otwartej tego celu preferuj członka rodziny z `expectedForm`
   `one_sentence` lub `short`; skracanie i tak zaproponuje 6.3;
2. precyzja `unfocused` albo wiedza `partial` → jeśli cel ma `lesson_keywords`,
   dołóż parę 6.1 (osobny priorytet planu, nie zamiast należnego
   samodzielnego sprawdzenia);
3. brakujący element → bez nowej reguły: `partial` mapuje się na `incorrect`,
   więc działa istniejąca ścieżka wsparcia (karta wsparcia i ćwiczenie
   prowadzone celu); nie ma mapowania element → ćwiczenie;
4. pomyłka pojęć → odłożone (6.5, punkt 5);
5. samodzielnie i zwięźle → bez zmian (rzadsza powtórka po przerwie).

### 6.5. Decyzje właściciela (zaakceptowane 2026-10-29)

Punkty 1–3 i 6 wdrożone; punkty 4 i 5 odłożone na krok po pilotażu.

1. `lesson_shorten` jako zadanie następcze poza planem i budżetem, wyłączone
   w fazie „Jeszcze 3 i koniec!” i w kartkówce.
2. `lesson_keywords` jako osobne ćwiczenie w puli, powiązane `familyId`,
   liczone do budżetu, zawsze wspomagane; generator dokłada je opcjonalnie.
3. Nowa modalność `selection` i migracja `0024` (check `attempts_modality_allowed`).
4. Kategorie fragmentów: Etap 4 pokazuje jedną kategorię „do usunięcia”
   (`redundantFragments`). Rozróżnienie „poprawne, ale zbędne” od
   „niezwiązane z pytaniem” (źródło §5.5) wymaga nowego pola werdyktu
   i `school-grader-v3` (unieważnia cache) — proponuję osobny krok po pilotażu.
5. Reguła „myli pojęcia → pytanie porównawcze” nie ma dziś sygnału: werdykt v2
   nie zwraca `confused_concept`. Proponuję odłożyć razem z punktem 4.
6. Pole poprawki startuje z tekstem oryginału (łatwiejsze skracanie na
   telefonie); alternatywa: puste pole.

### 6.6. Klienci i integracje

- Kid UI: `lesson_keywords` przez rozszerzenie `AnswerGrid` o wybór wielokrotny
  (min/max, „Sprawdź” jak w formularzach lekcji); `lesson_shorten` przez
  `ExerciseFrame`, istniejące segmenty odpowiedzi i `AnswerField` z wartością
  początkową. Testy geometrii obu widoków (portrait, landscape, tablet,
  desktop, cele ≥48 px), specy dopisane do partycji `tests/e2e/spec-projects.ts`.
- Edytor rodzica: edycja pojęć i flag kluczowości `lesson_keywords` z podglądem
  powiązanej rodziny; generator: opcjonalne `lesson_keywords` w partii celu.
- API → MCP → skill: lekcje są poza `learning-overview`, więc brak wpływu
  (do odnotowania w PR).

### 6.7. Korekty przy implementacji (2026-10-29)

- Para słów kluczowych: pierwotny szkic zamieniał na parę odpowiedź otwartą,
  która nie jest samodzielnym sprawdzeniem. W planie zamrożonym etap nie
  awansuje bez prawdziwych wyników, więc odpowiedzi otwarte trafiają do planu
  prawie wyłącznie jako sprawdzenia — reguła nie działałaby. Para jest więc
  osobnym priorytetem (6.1).
- Obietnica końca sesji liczona przed odpowiedzią (6.3), zgodnie z banerem
  Kid UI (`remainingAssessed ≤ 3`). Przy jednym zagadnieniu plan bywa krótki,
  więc skrócenie pojawia się głównie w dłuższych sesjach — do obserwacji na
  pilotażu.
- Kryteria `lesson_keywords` (`skill_versions.criteria`) zawierają pojęcia
  kluczowe (`keyTerms`): zmiana klucza to nowa wersja kryteriów.
- Fake grader zaznacza przy rozwlekłej odpowiedzi zdania bez słów elementów
  wymaganych jako zbędne, żeby testy i tryb fake przechodziły ścieżkę skracania.

## 7. Transakcje, prywatność, kontrakty publiczne

- Finalizacja próby bez zmian: ocena + ekspozycje + projekcja celu w jednej
  transakcji; wywołanie modelu poza transakcją przez istniejący wzorzec
  `processing` i finalizację CAS.
- Kid DTO nie dostaje nowych pól kryteriów: dziecko widzi pytanie, ewentualnie
  listę pojęć w `lesson_keywords` (to treść zadania, nie klucz — serwer nie
  zdradza w DTO, które pojęcia są kluczowe) oraz feedback z szablonów.
- Do providera gradera trafia wyłącznie treść ćwiczenia i odpowiedź dziecka
  jako dane (pkt 4). Panel rodzica informuje o usłudze oceniającej tak jak dziś.
- API → MCP → skill: zestawy szkolne są lekcjami, a `learning-overview`
  filtruje `decks.kind = 'vocabulary'`, więc kontrakt raportu, schemat JSON
  i skill Hermesa pozostają bez zmian; w opisie PR każdego etapu odnotowujemy
  ten brak wpływu.
- Migracja bazy w Etapie 1 najpewniej nie jest potrzebna (`lesson_context`
  i `payload` są JSONB walidowanym w kontraktach/domenie); jeśli walidacja
  kształtu `dynamicTopic` będzie wymagała więzów bazowych, decyzja zapada
  w Etapie 1 na podstawie istniejącego triggera kontekstu lekcji.

## 8. Raport kartkówki z wymiarem precyzji (Etap 5) — kontrakt

Status: zaakceptowany przez właściciela 2026-10-29 (decyzje 8.4 z
proponowanymi tekstami) i zaimplementowany na gałęzi
`feature/school-mock-test-precision`. Moduł
odpowiedzialny: kartkówka lekcji (`learning/lessons/lesson-mock-tests.ts`);
kontrakty w `packages/contracts/src/lessons.ts`. Słówka i gramatyka bez zmian.

Stan dziś: raport rodzica (`LessonMockTestReportDto`) liczy per zagadnienie
wynik zamknięty (poprawne, błędne, nieocenione, pominięte, kategorie błędów),
a omówienie dziecka (`LessonMockTestSummaryDto`) pokazuje odpowiedź dziecka,
poprawną odpowiedź i wynik. Wymiar precyzji odpowiedzi otwartych jest
zapisany w ocenach (`assessments.details`), ale żaden z raportów go nie
pokazuje. Źródło (§5.6) oczekuje po kartkówce: poprawności, opanowanych
zagadnień, brakujących informacji, wskazówek dotyczących precyzji
i propozycji powtórek.

### 8.1. Raport rodzica — `objectives[].school` (opcjonalne)

```ts
school?: {
  knowledge: { correct: number; partial: number; incorrect: number };
  precision: { concise: number; verbose: number; unfocused: number };
  /** Odpowiedzi z naruszoną formą jednego zdania (`formOk = false`). */
  formViolations: number;
  /** Najczęściej brakujące elementy wymagane (tekst, liczba), malejąco, ≤5. */
  missingElements: { text: string; count: number }[];
}
```

- Tylko dla zagadnień przedmiotu `school`, gdy co najmniej jedna odpowiedź
  otwarta tej kartkówki ma ocenę z wymiarem wiedzy. Liczy kod z
  `assessments.details`; „nieocenione” i pominięte nie wchodzą.
- Raport jest zamrażany przy zamknięciu kartkówki (jak dziś,
  `context.lessonMockTestReport`). Raporty zamknięte przed wdrożeniem nie
  mają pola i pozostają bez zmian — bez przeliczania historii.
- Panel rodzica (lista kartkówek w nadzorze lekcji) pokazuje pod wynikiem
  zagadnienia jedną linię wiedzy i precyzji oraz brakujące elementy.

### 8.2. Omówienie dziecka — wskazówka przy rozwiązaniu (opcjonalna)

```ts
solutions[].hintPl?: string  // gotowy tekst z katalogu komunikatów
```

Serwer dobiera jedną wskazówkę z szablonów, bez kategorii, liczb i treści
spoza omówienia:

| Ocena odpowiedzi otwartej | Wskazówka (propozycja) |
| --- | --- |
| wiedza poprawna, precyzja `verbose` albo `formOk = false` | „Dobrze! Następnym razem spróbuj krócej.” |
| wiedza poprawna, precyzja `unfocused` | „Dobrze! Trzymaj się samego pytania.” |
| wiedza `partial` z brakującym elementem | „Zabrakło ważnej informacji. Porównaj z poprawną odpowiedzią.” |
| pozostałe | brak wskazówki |

Omówienie i tak pokazuje poprawną odpowiedź po zakończeniu kartkówki, więc
wskazówka niczego nowego nie ujawnia; nie podaje treści brakującego
elementu ani komentarza modelu.

### 8.3. Omówienie dziecka — „Warto powtórzyć” (opcjonalne)

```ts
reviewObjectives?: { objectiveId: string; titlePl: string }[]
```

Zagadnienia z co najmniej jedną odpowiedzią błędną, niepełną albo
pominiętą, w kolejności tematu (≤8). Ekran omówienia pokazuje je jako krótką
listę nad przyciskiem „Poćwicz”. To informacja dla dziecka, nie zmiana
harmonogramu: powtórki nadal planuje selektor z historii ocen.

### 8.4. Decyzje do akceptacji właściciela

1. Wymiar precyzji w raporcie rodzica tylko dla nowych kartkówek (bez
   przeliczania zamrożonych raportów).
2. Dziecko dostaje gotowe zdania-wskazówki z katalogu, nie kategorie ani
   liczby precyzji.
3. „Warto powtórzyć” liczone z wyników tej kartkówki (błędne, niepełne,
   pominięte), bez zmian w harmonogramie.
4. Teksty wskazówek z tabeli 8.2 — do korekty, jeśli brzmią nienaturalnie.

### 8.5. Klienci i integracje

- Kid UI: `LessonMockTestSummaryScreen` — wskazówka pod odpowiedziami
  rozwiązania i lista „Warto powtórzyć” (tylko przedmiot szkolny);
  wspólne komponenty `KidScreen`, test geometrii w nowym specu
  `lesson-mock-precision-layout.spec.ts` (portrait, landscape, tablet,
  desktop).
- Panel rodzica: `LessonSupervisionPanel` — sekcja kartkówek.
- API → MCP → skill: raport kartkówek lekcji nie wchodzi do
  `learning-overview`, więc brak wpływu (do odnotowania w PR).
- Etap 5 obejmuje też przepisanie SPEC §28 i architektury §22 na stan kodu
  oraz pełny przebieg bramek.
