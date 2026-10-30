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

Status: **zaakceptowany przez właściciela 2026-10-29** (decyzje 5.9 według rekomendacji, provider STT: Scribe v2 przez OpenRouter) i zaimplementowany; korekty przy implementacji — 5.11. Moduł odpowiedzialny:
silnik lekcji (`learning/lessons/`, nowy plik ścieżki mowy lekcji) z czystymi
regułami w `domain/lessons/` i deklaracją w przedmiocie `school`
(`domain/lessons/subjects/school/`); port `SttProvider` współdzielony ze
słówkami, adapter STT lekcji osobny (5.2). Gramatyka i słówka bez zmian.

Pierwotny szkic: dziś `lesson-attempts.ts` odrzuca modalność audio. Etap 3
otwiera ją wyłącznie dla `lesson_open_answer` przedmiotów, które to zadeklarują:
transkrypcja istniejącym portem STT z locale `pl-PL`, potem ta sama finalizacja
co tekstu, z modalnością zapisaną przy próbie. Niska pewność transkrypcji lub
awaria STT = „nieocenione” (bez oceny, bez pomyłki).

### 5.1. Spike STT `pl-PL` (2026-10-29)

Narzędzie próby `scripts/evaluate-dictation-stt.mts` (`corepack pnpm
eval:dictation-stt`, poza kodem produktu; zostaje do próby na głosie dziecka
i kalibracji) porównuje na tych samych bajtach WAV PCM 16 kHz mono cztery
warianty Azure (region `germanywestcentral`):

| Wariant | Opis |
| --- | --- |
| A | produkcyjny adapter `createAzureSttProvider` (REST short-audio, `conversation`, `DisplayText`) |
| B | ten sam REST, forma leksykalna `NBest[0].Lexical` (liczby słownie, bez interpunkcji) |
| C | Azure Fast Transcription (`transcriptions:transcribe`, cały plik, frazy z confidence) |
| D | C z listą fraz z materiału rodzica (`phraseList`, api `2025-10-15`) |

Tryb `synth`: polski neuronowy TTS Azure (Zofia, Marek, Agnieszka) z prozodią
podniesioną o 35% i zwolnioną o 12% — **przybliżenie** głosu dziecka, nie jego
zastępstwo — na 11 fikcyjnych odpowiedziach do materiału pilotażowego
(pojęcia, liczby, nazwy własne, pauzy 1–4 s w środku odpowiedzi, „yyy”,
odpowiedź błędna, lista 7 nazw) oraz cisza i szum. Tryb `live`: lokalna strona
`http://127.0.0.1:5180` do nagrań przy urządzeniu; nagranie żyje tylko
w pamięci żądania, konsola wypisuje wyłącznie statusy i czasy.

Wyniki macierzy syntetycznej (33 nagrania z mową + cisza i szum; „pojęcia” =
odsetek oczekiwanych pojęć obecnych w transkrypcji):

| Wariant | Pojęcia | Confidence (min / mediana) | Czas (mediana / max) | Cisza 3 s | Szum 3 s |
| --- | --- | --- | --- | --- | --- |
| A | 137/150 (91%) | 0,60 / 0,91 | 1,36 s / 2,51 s | pusty tekst, 0,00 | pusty tekst, 0,00 |
| B | 146/150 (97%) | 0,60 / 0,91 | 1,24 s / 2,36 s | pusty tekst, 0,00 | pusty tekst, 0,00 |
| C | 141/150 (94%) | 0,63 / 0,82 | 0,69 s / 1,45 s | **„I'm going to do that.”, 0,31** | `no_speech` |
| D | 141/150 (94%) | 0,63 / 0,89 | 0,58 s / 1,17 s | **„I'm going to do that.”, 0,31** | `no_speech` |

Wnioski:

1. **Pauzy nie ucinają odpowiedzi.** REST short-audio przepisał całość także
   przy pauzach 2 s i 4 s w środku odpowiedzi; stawia za to kropkę w miejscu
   pauzy („…powierzchni ziemi.Pomniejszeniu…”). Liczenie zdań z transkrypcji
   karałoby namysł, nie formę.
2. **Pewność nie odróżnia przekłamań zmieniających sens.** „niziny” →
   „zimy” (conf 0,88–0,91), „Vasco da Gama” → „was Skoda gama” (0,77),
   „1 : 25 000, 3 cm” → „jeden do 25003 cm” (0,92–0,96 we wszystkich trzech
   głosach). Próg pewności odsiewa śmieci i ciszę, ale nie uchroni poprawnej
   odpowiedzi przed oceną „błąd” — to główny wniosek spike'u.
3. **Forma leksykalna (B) usuwa sklejanie liczb** („dwudziestu pięciu tysięcy
   trzy centymetry”) i podnosi trafienie pojęć do 97%, kosztem braku
   interpunkcji i wielkich liter. Nazw własnych nie poprawia.
4. **Fast Transcription (C) lepiej zapisuje nazwy** (Vasco da Gama, Marco
   Polo) i jest 2× szybsze, ale **na ciszy halucynuje angielskie zdanie**
   przy locale `pl-PL`, przekręca „James Cook” → „Dzień Skok” i ma niski limit
   wywołań na minutę w obecnej warstwie (HTTP 429 przy kilku żądaniach).
5. **Lista fraz (D) podnosi confidence (0,78 → 0,97) bez poprawy treści** —
   zafałszowuje próg i wysyła treść materiału do usługi. Odrzucona.
6. Odpowiedź błędna („Południk zero przechodzi przez Paryż”) przepisana
   wiernie przez wszystkie warianty — brak biasu w stronę poprawnej odpowiedzi.
7. Czas: pełne żądanie STT ≤ 2,5 s dla nagrań do 13 s; deadline 30 s
   z dużym zapasem.

**Runda 2 — OpenRouter `POST /api/v1/audio/transcriptions`** (te same
nagrania, `language: "pl"`, `temperature: 0`, klucz z konfiguracji gradera).
Najpierw z polityką `provider: { zdr: true, data_collection: "deny" }`
(Zero Data Retention), potem — tylko na głosach syntetycznych — bez ZDR
dla modeli, które endpointu ZDR nie mają:

| Model (OpenRouter) | ZDR | Pojęcia | Czas (mediana / max) | Cisza 3 s | Szum 3 s | Uwagi |
| --- | --- | --- | --- | --- | --- | --- |
| `elevenlabs/scribe-v2` | tak | **150/150 (100%)** | 1,09 s / 2,42 s | pusty | „[szum]” (znacznik zdarzenia) | nazwy, liczby słownie bez sklejania, „yyy” zapisane; confidence 0,94–1,00 |
| `mistralai/voxtral-small-transcribe-3-0` | tak | 148/150 (99%) | 1,14 s / **17,6 s** | pusty | pusty | „1:25003”; brak confidence |
| `openai/whisper-large-v3` | tak | 142/150 (95%) | 1,57 s / 11,5 s | pusty | **„Dziękuję.”** | „równi kto?”, „Awasko Dagama”, „25003” |
| `openai/gpt-transcribe` | **nie** | 150/150 (100%) | 0,99 s / 2,28 s | pusty | pusty | jakość jak Scribe, ale bez ZDR |
| `google/gemini-3.5-transcribe` | **nie** | 148/150 (99%) | 2,51 s / 3,04 s | pusty | pusty | „1:250003” |
| `openai/gpt-4o-transcribe` | **nie** | 149/150 (99%) | 1,09 s / 1,85 s | **„Siamo pronti.”** | „。” | **parafrazuje**: „równik” → „Ekwator” |
| `assemblyai/universal-3-6-pro` | tak | — | — | — | — | HTTP 400 dla WAV/`pl` (niezbadane dalej) |

Wnioski rundy 2:

8. **`elevenlabs/scribe-v2` jest najlepszy w obu rundach**: jedyny bez
   żadnego zgubionego pojęcia przy ZDR, poprawnie zapisuje nazwy własne
   (Vasco da Gama, James Cook, Marco Polo), liczby słownie bez sklejania
   i zachowuje „yyy”/„Ekke” (dosłowność — nie poprawia dziecka). Cisza → pusty
   tekst. Szum → sam znacznik zdarzenia dźwiękowego „[szum]”, który adapter
   musi usuwać (tekst złożony wyłącznie ze znaczników = `no_speech`).
   Koszt ~0,0004 USD za 6 s (≈ 0,22 USD/h).
9. **Confidence Scribe nie rozróżnia** (0,94–1,00 dla poprawnej mowy, 0,93
   dla znacznika szumu) — w rekomendowanym przepływie (5.3) to akceptowalne,
   bo tekst i tak ocenia wzrokiem dziecko; w wariancie bez potwierdzenia
   (5.9 pkt 2) próg pewności byłby z tym providerem bezużyteczny.
10. **Modele LLM-owe potrafią „poprawiać” wypowiedź** (gpt-4o-transcribe:
    „równik” → „Ekwator”) i halucynować na ciszy w obcym języku. Dosłowność
    jest warunkiem: model, który parafrazuje, ukrywa błąd albo go dokłada.
11. Gemini i GPT Transcribe nie mają endpointów ZDR w OpenRouter — odpadają
    z powodu prywatności, nie jakości.

Ograniczenia: syntetyczny głos z podniesioną wysokością **nie jest głosem
dziecka** (artykulacja, tempo, wahania, szum domowy). Próba `live` na głosie
dziecka nie została jeszcze wykonana — patrz 5.9 pkt 1. Tryb `live` porównuje
wszystkie warianty naraz: `SPIKE_SET=openrouter corepack pnpm
eval:dictation-stt live`.

### 5.2. Decyzja o adapterze

Ocena wymowy słówek zostaje na Azure (tam STT i Pronunciation Assessment
działają w parze); **odpowiedzi szkolne nie potrzebują oceny wymowy**, więc
nie muszą iść przez Azure. Rekomendacja: **`elevenlabs/scribe-v2` przez
OpenRouter z wymuszonym ZDR** (`zdr: true`, `data_collection: "deny"`) jako
STT lekcji:

- nowy adapter `providers/openai-compatible/stt.ts` (endpoint
  `audio/transcriptions` w formacie OpenAI, JSON z `input_audio` base64)
  implementujący istniejący port `SttProvider` — bez nowego portu;
- osobna zależność `services.lessonSpeech` (env `UMIEM_LESSON_STT_BASE_URL`,
  `UMIEM_LESSON_STT_API_KEY`, `UMIEM_LESSON_STT_MODEL`, domyślnie
  `elevenlabs/scribe-v2`; ZDR wymuszane w adapterze dla adresu OpenRouter);
  może wskazywać ten sam klucz OpenRouter co grader. Brak konfiguracji →
  lekcje bez mikrofonu (`speechInput` nie trafia do DTO);
- adapter usuwa znaczniki zdarzeń `[…]`, traktuje tekst pusty po ich usunięciu
  jako `no_speech`, a confidence bierze z `confidence` albo średniej `words[]`
  (`verbose_json`), gdy provider je zwraca;
- słówka bez zmian (`services.speech`, Azure).

Alternatywa: zostać przy Azure (A) — działa, jest w regionie UE i nie
halucynuje, ale gubi 9% pojęć (nazwy, sklejone liczby, „zimy”). Fast
Transcription, Whisper, gpt-4o-transcribe odrzucone (halucynacje na ciszy
lub szumie, parafrazowanie); Gemini i GPT Transcribe — brak ZDR. Decyzję
potwierdza lub koryguje próba `live` na głosie dziecka (5.9 pkt 1).

### 5.3. Przepływ: dyktowanie do pola z potwierdzeniem (rekomendacja)

Wniosek 2 rozstrzyga kształt funkcji: skoro pewna transkrypcja potrafi
zmienić sens, dziecko widzi tekst **przed** oceną. Mowa jest sposobem
wpisania odpowiedzi, a ocena dotyczy tekstu, który dziecko zatwierdziło:

1. Dziecko dotyka mikrofonu, mówi (do 45 s), dotyka ponownie.
2. Klient wysyła nagranie do nowego endpointu dyktowania; serwer zwraca
   transkrypcję albo powód braku tekstu. **Nie powstaje próba ani ocena.**
3. Tekst trafia do pola odpowiedzi („Sprawdź, czy dobrze cię usłyszałem”).
   Dziecko może poprawić tekst, nagrać ponownie albo od razu „Sprawdź”.
4. „Sprawdź” wysyła istniejącą odpowiedź tekstową z oznaczeniem sposobu
   wprowadzenia; dalej ścieżka tekstu bez zmian (warianty → cache → grader).

Skutki: niepewna lub nieudana transkrypcja nigdy nie dochodzi do oceny, więc
nie może stać się błędem wiedzy ani pomyłką pojęć (wym. 6.2) — dziecko
po prostu nie dostaje tekstu i może powtórzyć albo pisać. Pewne przekłamanie
(„zimy”) dziecko widzi i poprawia. Bez nowego wariantu promptu gradera
i bez nowego klucza cache — oceniany jest tekst, jak dziś. Alternatywa
(ocena bezpośrednio z nagrania) — 5.9 pkt 2.

### 5.4. Kontrakt endpointu dyktowania i DTO

- **Endpoint**: `POST /api/v1/kid/tasks/{taskId}/dictation` (oRPC
  `kid.tasks.dictation`), multipart z polem `audio` (WAV PCM 16 kHz mono),
  ten sam `sameOriginMiddleware` i pre-check rozmiaru co próby mowy.
- **Wynik** (`.strict()`, bez confidence i innych score'ów):
  `{ status: "heard", text: string /* 1–600 */ }` albo
  `{ status: "no_speech" | "uncertain" | "too_long" | "unavailable" }`.
- **Autoryzacja (T1, blokada sesji)**: zadanie `issued`, sesja aktywna
  i treningowa, `microphoneEnabled`, przedmiot deklaruje mowę, typ
  `lesson_open_answer` (także zadanie następcze `lesson_shorten`),
  limit dyktowań sesji nieprzekroczony. Naruszenie → błąd walidacji albo
  konfliktu jak przy innych operacjach zadania. Brak `services.lessonSpeech`
  → `unavailable`.
- **Deklaracja przedmiotu**: `SubjectModule.spokenAnswers?: { locale: "pl-PL",
  exerciseTypes: ["lesson_open_answer"] }`. Ma ją tylko `school`. Locale
  wybiera serwer, nie klient. Gramatyka, `lesson_calculation`,
  `lesson_short_answer` i pozostałe typy — bez mowy.
- **Kid DTO zadania**: opcjonalne `speechInput: { maxSeconds: 45 }` w promptach
  odpowiedzi otwartej szkoły i `lesson_shorten`, obecne tylko gdy powyższe
  warunki są spełnione i STT lekcji jest skonfigurowany. Brak pola = brak mikrofonu.
- **Limit nagrania**: 45 s (słówka bez zmian: 15 s). WAV 32 kB/s → 45 s
  ≈ 1,44 MB < `MAX_AUDIO_BYTES` = 2 MB; REST short-audio przyjmuje do 60 s.
  `normalizeAudioInput` dostaje limit czasu od wywołującego (15 s / 45 s),
  `BrowserRecorder` — `maxRecordingMs` z `speechInput.maxSeconds`.
- **Limit kosztu**: `dictationCalls` w kontekście sesji lekcji (wzorzec
  `graderCalls`), domyślnie 40 na sesję; po wyczerpaniu `unavailable`
  i klient zostawia samo pisanie.
- **Odpowiedź z dyktowania**: istniejące wejście tekstowe dostaje opcjonalne
  `inputMethod: "keyboard" | "speech"` (domyślnie `keyboard`).

### 5.5. Progi i klasyfikacja transkrypcji

Czysta funkcja domenowa `classifyDictation(transcription, policy)`:

| Wynik STT | Status | Uwagi |
| --- | --- | --- |
| `failed` (awaria, timeout, 401/403, przerwanie) | `unavailable` | |
| `no_speech` albo pusty tekst | `no_speech` | |
| `ok`, confidence < 0,5 | `uncertain` | tekstu nie zwracamy (jak w słówkach) |
| `ok`, tekst > 600 znaków | `too_long` | „Powiedz krócej” |
| `ok`, confidence ≥ 0,5 (albo brak confidence) | `heard` | tekst providera po usunięciu znaczników `[…]` |

Próg 0,5 to parametr polityki lekcji (wersjonowany jak pasma wymowy),
stosowany tylko, gdy provider zwraca confidence (brak = tylko reguły
pustego tekstu). Uzasadnienie: dla Azure śmieci, cisza i szum 0,00–0,12,
poprawna mowa w zdaniach ≥ 0,60; Scribe zwraca dla poprawnej mowy
0,94–1,00, a szum odsiewa usunięcie znacznika „[szum]” (5.2). Tekst i tak
ocenia dziecko wzrokiem przed wysłaniem. Wartość do kalibracji na nagraniach
dziecka. Ewentualne sklejone liczby („25003” w Azure) dziecko widzi
i może poprawić.

### 5.6. Zapis modalności, ocena i raport rodzica

- **Zapis**: próba odpowiedzi z dyktowania ma `attempts.modality = 'text'`
  i `answer = { text, inputMethod: "speech", edited: boolean }`; brak
  `inputMethod` = klawiatura (wszystkie dotychczasowe próby). Kolumny
  `modality` nie zmieniamy, bo `audio` ma w kodzie słówek inny kształt
  odpowiedzi (`transcript`), a cache, raporty i oryginał `lesson_shorten`
  czytają `answer.text` — modalność mówiona jest zapisana przy próbie bez
  rozgałęzień ani migracji.
- **Weryfikacja deklaracji**: serwer przyjmuje `inputMethod: "speech"` tylko
  dla zadania, dla którego w tej sesji zwrócił `heard`. Kontekst sesji trzyma
  `dictations[taskId] = sha256(NFC(tekst))` — skrót, nie tekst. `edited`
  liczy serwer (skrót odpowiedzi ≠ skrót transkrypcji). Deklaracja bez
  dyktowania → zapis jako klawiatura (bez błędu: dziecko niczego nie traci).
- **Ocena**: identyczna jak tekstu — obie modalności liczą się do wiedzy,
  samodzielności, ekspozycji i projekcji celu tak samo (wym. 6.3). Jedyna
  różnica: dla `inputMethod: "speech"` bez edycji forma `one_sentence` nie
  jest liczona z kropek (`formOk = null`, wniosek 1); precyzję nadal ocenia
  model. Bez nowego promptu i klucza cache.
- **Raport rodzica** (`SchoolProgress`): opcjonalne `byInputMethod:
  { keyboard: { correct, partial, incorrect }, speech: { correct, partial,
  incorrect, edited } }`; `recentAnswers[].inputMethod` opcjonalne (ikonka
  mikrofonu przy odpowiedzi). Dotychczasowe liczniki pozostają sumą.
  Nieudane dyktowania nie są próbami, więc raport ich nie liczy.
- **Karta pracy rodzica i raport kartkówki**: bez zmian w tym etapie
  (kartkówka — 5.9 pkt 4).

### 5.7. Transakcje

- **Dyktowanie**: T1 (blokada sesji) — autoryzacja i inkrement
  `dictationCalls`; poza transakcją STT z deadlinem `SPEECH_ANALYSIS_TIMEOUT_MS`
  (30 s) i sygnałem przerwania żądania; T2 — zapis skrótu `dictations[taskId]`
  tylko dla `heard` i tylko gdy zadanie nadal jest `issued` (inaczej wynik
  wraca do klienta, ale skrót nie powstaje). Żadnych zapisów prób, ocen ani
  ekspozycji: dyktowanie niczego nie ujawnia.
- **Odpowiedź**: bez zmian — jedna transakcja finalizacji (ocena + ekspozycje
  + projekcja celu + przejście zadania + ewentualne zadanie następcze), grader
  poza transakcją przez `processing` i CAS. Kontekst kwalifikacji zamraża się
  przy `received_at` odpowiedzi, jak dla tekstu.

### 5.8. Awarie i prywatność

- Awaria, timeout, brak kluczy, limit → `unavailable`: Kid UI pokazuje
  „Nie udało się rozpoznać. Napisz odpowiedź albo spróbuj jeszcze raz”, pole
  tekstowe zostaje aktywne. `no_speech`/`uncertain` → „Nie usłyszałem
  wyraźnie. Powiedz jeszcze raz”. Po dwóch nieudanych dyktowaniach z rzędu
  klient eksponuje pisanie. Nic z tego nie tworzy próby ani oceny.
- Utrata sieci nie tworzy lokalnego sukcesu; ocena pochodzi wyłącznie
  z serwera.
- Nagranie istnieje wyłącznie w pamięci żądania: nie trafia do bazy, kolejki,
  plików, logów, fixture ani backupu; transkrypcja nie trafia do logów. Do
  usługi STT idą tylko bajty audio i język — bez imienia, wieku,
  identyfikatorów (także bez `user`/`session_id` OpenRouter) i treści
  materiału (bez `keyterms`). Przy OpenRouter adapter zawsze wysyła
  `zdr: true` i `data_collection: "deny"`; brak endpointu ZDR = błąd
  (`unavailable`), nigdy cichy fallback na providera z retencją. Różnica
  względem Azure: przetwarzanie poza deklarowanym regionem UE
  (OpenRouter + ElevenLabs) — do świadomej decyzji (5.9 pkt 7).
- Transkrypcja przed „Sprawdź” żyje tylko w polu klienta; po wysłaniu jest
  zwykłą odpowiedzią dziecka (zapisaną w próbie, usuwaną z profilem,
  wysyłaną do gradera jako dane).
- Klient zwalnia mikrofon i bufory po wysłaniu, błędzie, anulowaniu,
  odmontowaniu widoku i przejściu dalej (istniejący `BrowserRecorder`
  + test każdej ścieżki).
- Panel rodzica przy zestawie szkolnym informuje, że odpowiedzi głosem trafiają
  do usługi rozpoznawania mowy (nazwa modelu z konfiguracji), obok informacji
  o usłudze oceniającej.

### 5.9. Decyzje do akceptacji właściciela

1. **Próba na głosie dziecka** (`live`) przed scaleniem — kalibracja progu 0,5
   i potwierdzenie adaptera. Wymaga udziału właściciela z dzieckiem przy
   komputerze (strona lokalna, nic nie jest zapisywane). Bez niej PR
   jawnie raportuje brak tej próby.
2. **Przepływ**: dyktowanie do pola z potwierdzeniem (5.3, rekomendacja)
   zamiast oceny bezpośrednio z nagrania. Alternatywa „jak słówka” (jeden
   krok, transkrypcja od razu do gradera z asymetrią pewności, formą
   leksykalną i promptem `school-grader-v2-spoken`) jest szybsza dla
   dziecka, ale spike pokazał pewne przekłamania sensu (conf ~0,9), których
   próg nie wyłapie — poprawna odpowiedź dostałaby „błąd”.
3. **Zapis**: `modality = 'text'` + `answer.inputMethod = 'speech'` (5.6)
   zamiast `modality = 'audio'` — bez migracji i rozgałęzień w raportach.
4. **Kartkówka**: bez mikrofonu (symuluje pisemny sprawdzian). Alternatywa:
   mikrofon także w kartkówce.
5. **`lesson_shorten`**: mikrofon także w „Skróć odpowiedź” — dyktowanie
   zastępuje treść pola (oryginał zostaje widoczny nad polem).
6. **Limity**: nagranie 45 s, 40 dyktowań na sesję, tryb przełącznika
   (dotknij — mów — dotknij) niezależnie od ustawienia „przytrzymaj” profilu.
7. **Provider STT lekcji**: `elevenlabs/scribe-v2` przez OpenRouter z ZDR
   (5.2, rekomendacja) zamiast Azure. Wymaga akceptacji przetwarzania głosu
   dziecka poza regionem UE (OpenRouter + ElevenLabs, bez retencji);
   alternatywa: Azure `germanywestcentral` kosztem ~9% zgubionych pojęć.
   Słówka zostają na Azure niezależnie od wyboru.

### 5.10. Klienci i integracje

- Kid UI: `SpeechRecordButton` w `LessonSentenceView` (tylko gdy prompt ma
  `speechInput`) i w `LessonShortenView`, obok `AnswerField`; tryb
  przełącznika z odliczaniem ostatnich 10 s; stany dyktowania (nagrywanie,
  rozpoznawanie, „Sprawdź, czy dobrze cię usłyszałem”, błędy) przez wspólne
  komponenty (`ExerciseFrame`, `AnswerField`, `SpeechRecordButton`,
  `ActionButton`). Testy jednostkowe widoków i testy geometrii Playwright
  (portrait, landscape, tablet, desktop, cele ≥ 48 px, klawiatura) w nowym
  specu w partycji `mocked` `tests/e2e/spec-projects.ts`. Odbiór na
  fizycznym urządzeniu — jawnie w raporcie.
- Panel rodzica: liczniki `byInputMethod` i ikonka przy ostatnich
  odpowiedziach w nadzorze lekcji; informacja o usłudze mowy.
- API → MCP → skill: lekcje są poza `learning-overview`, więc brak wpływu
  (do odnotowania w PR).

### 5.11. Korekty przy implementacji (2026-10-29)

- Próg pewności i limity (600 znaków, 45 s, 40 dyktowań) są stałą domenową
  `DEFAULT_DICTATION_POLICY` (`domain/lessons/dictation.ts`), nie wpisem polityki
  w bazie — zmiana wartości to zmiana kodu z testem.
- Próg pewności stosujemy tylko, gdy provider zwraca confidence; adapter
  liczy ją z `confidence` albo średniej `words[]` (Scribe), inne modele mogą
  jej nie mieć.
- `answer.edited` liczy serwer ze skrótu; skrót ostatniego dyktowania
  nadpisuje poprzedni w tym samym zadaniu.
- `lessonSessionContextOf` przenosi `dictationCalls` i `dictations`, żeby zapis
  licznika gradera nie gubił stanu dyktowania.
- Mikrofon w zadaniu zależy od `speechInput` zamrożonego w prompcie; endpoint
  sprawdza dodatkowo aktywną sesję treningową z włączonym mikrofonem.
- Review: zapisy kontekstu sesji przy rezerwacjach (`events.ts` — podpowiedź
  „Nie pamiętam” w lekcji, `attempts.ts`, `feedback-audio.ts`,
  `voice-task-lifecycle.ts`, `vocabulary-task-issuance.ts`) budowały kontekst
  z `contextOf` i gubiły klucze lekcji (`dictationCalls`, `dictations`, ale też
  wcześniejsze `graderCalls`); teraz scalają się z surowym kontekstem sesji.
- Znane ograniczenie: po wyczerpaniu 40 dyktowań mikrofon zostaje widoczny,
  a każde nagranie kończy się „Nie udało się rozpoznać. Napisz odpowiedź…”
  (bez osobnego statusu limitu w kontrakcie).
- Konfiguracja: `UMIEM_LESSON_STT_BASE_URL`, `UMIEM_LESSON_STT_API_KEY`,
  opcjonalnie `UMIEM_LESSON_STT_MODEL` (domyślnie `elevenlabs/scribe-v2`);
  w trybie `UMIEM_FAKE_PROVIDERS=1` stały polski tekst z fake STT.

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
4. pomyłka pojęć → pytanie porównawcze celu (Etap 6, §9.3);
5. samodzielnie i zwięźle → bez zmian (rzadsza powtórka po przerwie).

### 6.5. Decyzje właściciela (zaakceptowane 2026-10-29)

Punkty 1–3 i 6 wdrożone w Etapie 4; punkty 4 i 5 — w Etapie 6 (§9).

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

## 9. Precyzja v3: kategorie fragmentów i pomylone pojęcia (Etap 6) — kontrakt

Status: **zaakceptowany przez właściciela 2026-10-29** (decyzje 9.6 bez zmian)
i zaimplementowany; ewaluacja gradera v3 w `grader-eval-2026-10-29-v3.md`,
korekta przy implementacji w 9.7. Realizuje punkty 4 i 5
odłożone w 6.5 (źródło §5.5 i reguła „myli dwa pojęcia → ćwiczenie ich
porównywania”, wym. 7.3–7.4). Moduły: werdykt i reguły w domenie
(`domain/lessons/evaluate.ts`, `precision-trainer.ts`, `scheduler.ts`), ścieżka
oceny `learning/lessons/`, raport `materials/lessons/lesson-supervision.ts`,
adapter gradera; gramatyka bez zmian (jej werdykt v1 się nie zmienia).

### 9.1. Werdykt `school-grader-v3`

Wyjście modelu rozszerza v2 o dwa pola:

```json
{
  "knowledge": "correct | partial | incorrect",
  "precision": "concise | verbose | unfocused",
  "matchedElementIds": ["e1"],
  "missingElementIds": ["e2"],
  "incorrectStatements": ["<dokładny podciąg odpowiedzi>"],
  "redundantFragments": ["<poprawne, ale zbędne — dokładny podciąg>"],
  "offTopicFragments": ["<niezwiązane z pytaniem — dokładny podciąg>"],
  "confusedConcepts": [{ "said": "<pojęcie użyte przez dziecko, podciąg odpowiedzi>", "meant": "<pojęcie właściwe>" }],
  "note": "<krótki komentarz wyłącznie dla rodzica>"
}
```

Zasady `validateSchoolVerdict` (naruszenie = odrzucenie werdyktu, próba
„nieocenione”, jak dziś), dopisane do reguł v2:

- `redundantFragments` i `offTopicFragments` — po maks. 4, każdy dokładnym
  podciągiem odpowiedzi po NFC, rozłączne (ten sam fragment nie może być w obu
  listach ani w `incorrectStatements`);
- `confusedConcepts` — maks. 2 pary; `said` jest podciągiem odpowiedzi, `said`
  ≠ `meant`, oba 1–60 znaków; para wymaga wiedzy `partial` albo `incorrect`
  (pomylenie pojęć to błąd treści, nigdy `correct`);
- kategoria błędu oceny: przy niepustym `confusedConcepts` →
  `confused_concept` (kategoria istnieje w module szkoły od Etapu 1), poza tym
  jak w v2 (`missing_element` / `wrong_fact` / `incomplete`).

Prompt v3 opisuje trzy rodzaje treści zbędnej wprost ze źródła §5.5
(niezbędne = elementy wymagane; poprawne, ale zbędne; niezwiązane z pytaniem)
oraz definicję pomylenia: dziecko użyło jednego pojęcia z materiału zamiast
drugiego (np. „równoleżnik” zamiast „południk”, „wysokość względna” zamiast
„bezwzględna”). Wszystko nadal jako dane, bez danych dziecka.

**Cache i historia.** Nowy `promptVersion = 'school-grader-v3'` to nowy klucz
`lesson_verdicts`: werdykty v2 zostają w bazie (historia ocen i decyzje
rodzica bez zmian), ale nie są używane dla nowych odpowiedzi — powtórzona
odpowiedź raz jeszcze trafi do modelu. Decyzje rodzica na werdyktach v2 nie
przechodzą na v3 (inny tekst oceny). Migracja `0025`: kolumny
`off_topic_fragments` i `confused_concepts` (jsonb, domyślnie pusta lista)
w `lesson_verdicts`; stare wiersze dostają puste listy. `assessments.details`
dostaje `offTopicFragments` i `confusedConcepts` obok dzisiejszych pól.

**Bramka jakości (golden set).** Złoty zestaw dostaje przypadki: fragment
niezwiązany z pytaniem, fragment poprawny, ale zbędny, oraz pomylenie pojęć.
Twarde wymagania v2 bez zmian (≥ 90% zgodności wiedzy, zero werdyktów
odrzuconych, błędy rzeczowe zawsze `incorrect`); nowe: przypadki pomylenia
pojęć dają niepusty `confusedConcepts` w ≥ 80% i nigdy wiedzę `correct`.
Rozróżnienie zbędne/niezwiązane jest raportowane, nie bramkuje (jak precyzja).

### 9.2. „Skróć odpowiedź” z dwiema kategoriami

- Wyzwalacz 6.3 bez zmian poza jednym: fragment do usunięcia to
  `redundantFragments` **albo** `offTopicFragments`.
- Kid DTO `lesson_shorten.answerSegments`: stan segmentu rozszerzony o
  `"offtopic"` (`plain | pill | offtopic`; `pill` = poprawne, ale zbędne —
  bez zmiany znaczenia dla istniejących zadań). Rozszerzenie wspólnego
  `SpellingDiffSegmentSchema` dotyczy wyłącznie segmentów lekcji; diff pisowni
  słówek nie używa nowej wartości (test kontraktu).
- Kid UI: dwa style zaznaczenia z tokenów M3 (zbędne — obecny styl pigułki,
  nie na temat — rola `error-container`) i legenda pod tekstem: „zbędne”,
  „nie na temat”. Kolor nie jest jedynym nośnikiem: segmenty mają etykiety
  dostępności i różny obrys. Testy geometrii dopisane do
  `lesson-precision-layout.spec.ts`.
- Feedback `lesson_precision_hint` z szablonu zależnie od kategorii: tylko
  zbędne — „Wiesz to! Teraz spróbuj powiedzieć to krócej”; są fragmenty nie na
  temat — „Wiesz to! Usuń to, co nie odpowiada na pytanie”.
- Poprawka: `lostElementIds` i ocena bez zmian.

### 9.3. Pomylone pojęcia → pytanie porównawcze

- **Sygnał:** ostatnia ocena odpowiedzi otwartej celu z poprzednich sesji
  (ten sam odczyt co `precisionHistory`, bez zadań następczych) z niepustym
  `confusedConcepts`. Snapshot selektora dostaje `confusedConcepts`.
- **Reguła selektora (6.4 pkt 4):** przy wyborze odpowiedzi otwartej tego celu
  preferuj ćwiczenia z `questionType = comparison`; wśród nich najpierw te,
  których pytanie lub elementy wymagane zawierają (po normalizacji) `said`
  albo `meant`. Stabilny podział jak `preferConciseForms`; bez pytań
  porównawczych w puli kolejność się nie zmienia (działa istniejąca ścieżka
  wsparcia, bo pomylenie daje wynik `incorrect`). Reguła pomylenia ma
  pierwszeństwo przed preferencją form zwięzłych.
- **Pula:** generator już zna `questionType: comparison`; prompt generowania
  dostaje zdanie: „gdy materiał zawiera pary łatwo mylonych pojęć (np.
  południk/równoleżnik), dodaj co najmniej jedno pytanie porównawcze dla tej
  pary”. Dotyczy tylko nowych generacji i dogenerowań; istniejące zestawy
  rodzic może uzupełnić w edytorze (pytanie otwarte z typem „porównanie”).
- Bez nowego typu ćwiczenia, bez mapowania pojęć między celami.

### 9.4. Raport rodzica

`SchoolProgress` dostaje opcjonalne:

- `topConfusions: [{ said, meant, count }]` (maks. 5, malejąco) — „Myli pojęcia”;
- `fragmentKinds: { redundant, offTopic }` — liczba ocen z fragmentami każdej
  kategorii (obok liczników precyzji).

Para oryginał → poprawka w `shortening.recent` bez zmian. Raport kartkówki
(`objectives[].school`) dostaje `confusions` (te same pary, maks. 3). Raport
nie ocenia cech dziecka — tylko treść odpowiedzi.

### 9.5. Prywatność, transakcje, integracje

- Do gradera trafiają te same dane co w v2 (treść ćwiczenia, kryteria,
  odpowiedź dziecka jako dane); komentarz modelu i pary pojęć wyłącznie dla
  rodzica i selektora — Kid DTO dostaje tylko kategorie segmentów własnego
  tekstu dziecka (bez `meant`, które ujawniałoby odpowiedź przed ponowieniem).
- Finalizacja próby bez zmian (jedna transakcja; model poza transakcją, CAS).
- API → MCP → skill: lekcje poza `learning-overview` — brak wpływu.

### 9.6. Decyzje do akceptacji właściciela

1. **Werdykt v3** z `offTopicFragments` i `confusedConcepts` (pary `said`/`meant`)
   i nowym kluczem cache `school-grader-v3`: werdykty v2 i decyzje rodzica na
   nich zostają w historii, ale nie są używane dla nowych odpowiedzi (koszt:
   ponowne wywołania modelu dla powtarzanych odpowiedzi po wdrożeniu).
2. **Migracja `0025`** (dwie kolumny jsonb w `lesson_verdicts`).
3. **Kid UI „Skróć”**: dwa style zaznaczeń + legenda „zbędne” / „nie na temat”
   (rozszerzenie stanu segmentu o `offtopic`).
4. **Selektor**: po pomyleniu pojęć preferencja pytań porównawczych celu, bez
   nowego typu ćwiczenia; pierwszeństwo przed formami zwięzłymi.
5. **Generator**: zdanie o pytaniach porównawczych dla par mylonych pojęć
   (tylko nowe generacje).
6. **Raport**: „Myli pojęcia” per zagadnienie i w raporcie kartkówki, licznik
   fragmentów zbędnych / nie na temat.
7. **Bramka jakości**: ewaluacja golden setu na prawdziwym modelu
   (`google/gemini-3.8-flash`) przed PR; próg dla pomylenia pojęć ≥ 80%.

### 9.7. Korekty przy implementacji (2026-10-29)

- Reguła pytań porównawczych działa w obu ścieżkach wyboru odpowiedzi
  otwartej: także przy należnym samodzielnym sprawdzeniu (wykrył to test
  integracyjny — pierwotnie tylko ścieżka utrwalania).
- Pary pojęć w raporcie grupowane bez wielkości liter; zapis — pierwszy
  alfabetycznie wariant z ocen.
- Decyzja rodzica „uznaj za poprawne” na werdykcie v3 zeruje także
  `confusedConcepts` (znika błąd treści, więc i pomylenie).
- Review: pomylenie pojęć liczy się jako luka w treści (werdykt „częściowa”
  z samym pomyleniem przy komplecie elementów jest poprawny); pary są
  przycinane i liczone raz; zapis pary w raportach — najmniejszy wariant
  w porządku kodów znaków (`collate "C"` w SQL). Kolory w „Skróć”: zbędne —
  rola `secondary-container`, nie na temat — `error-container`.
- Fake grader dzieli zdania bez elementów wymaganych: z rdzeniem słowa pytania
  albo odpowiedzi wzorcowej → „zbędne”, pozostałe → „nie na temat”;
  `fake-school-grader-v3`.

## 10. Ćwiczenia „Połącz w pary” i „Pogrupuj” (Etap 7) — kontrakt

Status: **zaakceptowany przez właściciela 2026-10-29** (decyzje 10.8 bez
zmian). Zmienia zakres
z 2026-10-28: „dopasowywanie par” przestaje być wyłączeniem (requirements,
„Zakres i świadome wyłączenia”). Moduły: typy i ocena w domenie
(`domain/lessons/types.ts`, `pool-validation.ts`, `evaluate.ts`,
`subjects/school/`), materializacja i próby w `learning/lessons/`, generowanie
i szkic w `materials/lessons/`, widoki w `packages/kid-ui`, edytor
w `apps/web/src/parent/lessons`. Gramatyka i słówka bez zmian.

Zasada: model generuje wyłącznie dane (teksty i przypisania), serwer je
waliduje, rodzic zatwierdza, a Kid UI rysuje je wspólnymi komponentami. Ocena
jest deterministyczna, bez modelu w trakcie sesji; klucz zostaje na serwerze.
Żadnego HTML ani kodu generowanego przez model.

### 10.1. „Połącz w pary” — typ `lesson_match`

Ćwiczenie w puli (tylko `school`), etap `guided` (jak `lesson_order`):

| Pole | Kształt | Zasada |
| --- | --- | --- |
| `exerciseType` | `"lesson_match"` | etap `guided` |
| `pairs` | `[{ left, right }]`, 3–5 | `left` ≤40 znaków (pojęcie, miejsce, przyczyna), `right` ≤100 (definicja, cecha, skutek) |
| `extraRight` | `string[]`, 0–2, ≤100 znaków | dystraktory po prawej, żeby ostatniej pary nie dało się dobrać eliminacją |
| `answer` | string | lewe strony par złączone `", "` (`targetKey`, podgląd rodzica; wylicza kod) |
| `instructionPl`, `sourceRefs` | jak w innych typach | `sourceRefs` wymagane |

Walidacja puli: liczby i długości jak wyżej; lewe i prawe teksty unikalne po
normalizacji (NFC, białe znaki, wielkość liter) w obrębie ćwiczenia, także
dystraktory względem prawych stron par; żaden tekst nie jest podciągiem innego
po tej samej stronie (dwie prawie identyczne definicje są nie do odróżnienia).
Merytoryczną poprawność par sprawdza rodzic.

Kid DTO (`.strict()`, bez klucza):

```ts
{ kind: "lesson_match", instructionPl: string,
  left: LessonItem[]  /* 3–5, UUID nadane przy materializacji, tasowane */,
  right: LessonItem[] /* pary + dystraktory, UUID, tasowane niezależnie */ }
```

### 10.2. „Pogrupuj” — typ `lesson_group`

| Pole | Kształt | Zasada |
| --- | --- | --- |
| `exerciseType` | `"lesson_group"` | etap `guided` |
| `groups` | `[{ id, label }]`, 2–3 | `id` slug unikalny w ćwiczeniu, `label` ≤30 znaków („ssaki”, „ptaki”) |
| `groupItems` | `[{ text, groupId }]`, 4–8 | tekst ≤40 znaków; każda grupa ma co najmniej 2 elementy |
| `answer` | string | etykiety grup złączone `" / "` (wylicza kod) |
| `instructionPl`, `sourceRefs` | jak w innych typach | `sourceRefs` wymagane |

Walidacja puli: liczby i długości jak wyżej; `groupId` wskazuje istniejącą
grupę; etykiety grup i teksty elementów unikalne po normalizacji; element nie
może być równy etykiecie żadnej grupy.

Kid DTO (`.strict()`, bez klucza):

```ts
{ kind: "lesson_group", instructionPl: string,
  groups: LessonItem[] /* 2–3, UUID, kolejność z materiału */,
  items: LessonItem[]  /* 4–8, UUID, tasowane */ }
```

### 10.3. Odpowiedź i ocena

Jedna nowa modalność `assignment` dla obu typów (migracja `0026` rozszerza
`attempts_modality_allowed`, wzór `0024`):

```ts
{ modality: "assignment", assignments: { itemId: Uuid, targetId: Uuid }[] /* 3–8 */ }
```

- `lesson_match`: `itemId` = element lewej kolumny, `targetId` = element
  prawej. Każdy lewy dokładnie raz, każdy prawy co najwyżej raz (bijekcja na
  parach, dystraktory zostają nieużyte).
- `lesson_group`: `itemId` = element, `targetId` = grupa. Każdy element
  dokładnie raz.
- Kształt niezgodny z zadaniem (brakujący lub obcy identyfikator, powtórzenie)
  → `400`, bez próby — jak dzisiejsze strażniki modalności.
- Hash żądania (idempotencja) liczony z przypisań posortowanych po `itemId`;
  kolejność stukania nie ma znaczenia.

Ocena deterministyczna, bez modelu: `correct`, gdy wszystkie przypisania są
zgodne z kluczem; inaczej `incorrect` z `correctText` = poprawne pary lub
grupy (format jak `answer`). Bez oceny częściowej i bez „prawie” — jeden błąd
w parach zawsze psuje dwie pary, więc liczenie trafień myliłoby dziecko.
Pomoc `options` jak w `lesson_order` (elementy widoczne), więc pierwsza
poprawna odpowiedź nie jest samodzielnym przypomnieniem i nie wchodzi do serii
opanowania. Zadanie liczy się do budżetu sesji.

Kartkówka: oba typy dopuszczone (jak `lesson_order`), z ekspozycją przy
wydaniu; omówienie pokazuje odpowiedź dziecka i poprawne pary lub grupy
tekstem. Raport aktywności sesji i karta pracy dla rodzica opisują odpowiedź
jako `lewe → prawe` lub `grupa: elementy`.

### 10.4. Tasowanie bez rozwiązanego układu (także `lesson_order`)

Dziś `seededShuffle` (ziarno = id zadania) może zwrócić układ kanoniczny:
przy 3 blokach `lesson_order` co szóste zadanie startuje już rozwiązane.
Reguła wspólna dla trzech typów: gdy wynik tasowania jest równy układowi
rozwiązanemu, materializacja przesuwa go cyklicznie o jedną pozycję
(deterministycznie, bez nowej losowości):

- `lesson_order`: kolejność bloków ≠ kolejność kanoniczna;
- `lesson_match`: prawa kolumna nie stoi w całości naprzeciw swoich par
  (porównanie pozycji par po tasowaniu obu kolumn);
- `lesson_group`: elementy nie są ułożone grupami w kolejności grup.

Dotyczy tylko nowo wydanych zadań; wydane zadania mają niezmienny prompt.

### 10.5. Kid UI

Dwa widoki w `exercises/lesson/` z istniejących klocków: `ExerciseFrame`,
`LessonBlockButton`, `ActionButton` („Sprawdź”, aktywne dopiero przy
komplecie przypisań), `useRetryReset`. Wyłącznie stukanie, bez przeciągania
(dostępność, klawiatura, spójność z „Ułóż”). Czyste funkcje stanu obok
widoków, jak `block-order.ts`.

- **„Połącz w pary”**: każdy element lewej kolumny ma pod sobą puste
  miejsce. Stuknięcie miejsca czyni je aktywnym (domyślnie pierwsze puste),
  stuknięcie elementu z puli prawych wstawia go tam; stuknięcie wstawionego
  elementu oddaje go do puli. Compact: lewy element i jego miejsce jeden pod
  drugim, pula pod listą; expanded: dwie kolumny.
- **„Pogrupuj”**: grupy jako przełączniki (jedna aktywna, domyślnie
  pierwsza); stuknięcie elementu z puli dodaje go do aktywnej grupy;
  stuknięcie elementu w grupie oddaje go do puli. Zawartość grup widoczna pod
  przełącznikami; compact w jednej kolumnie, expanded grupy obok siebie.
- Cele ≥48 px, główna akcja ≥54 px, teksty zawijają się (do 120 znaków po
  prawej w parach), brak przepełnienia poziomego, klawiatura ekranowa nie
  zasłania „Sprawdź”. Nowe specy geometrii (portrait, landscape, tablet,
  desktop) w partycji `mocked`.
- Feedback: dotychczasowa ścieżka `great` / `incorrect{correctText}`;
  zaznaczanie pojedynczych błędnych par — poza etapem (10.8 pkt 4).
- Nowe komunikaty w `messages.ts` (polecenia, etykiety puli, „Wybierz
  miejsce”, „Dodaj do grupy …”, etykiety dostępności); ikony z istniejącego
  zestawu.

### 10.6. Generowanie, edytor i publikacja

- Structured output: osobne ścisłe gałęzie `lesson_match` i `lesson_group`
  w schemacie puli (wzór gałęzi `lesson_keywords`/`lesson_calculation`),
  walidacja kształtu w szkicu (`lesson-drafts.ts`) i w puli.
- Prompt szkoły: pary, gdy materiał zawiera pojęcia z definicjami, miejsca
  z cechami, przyczyny ze skutkami; grupy, gdy materiał zawiera klasyfikację
  (np. ssaki/ptaki, niziny/wyżyny). Teksty wyłącznie z materiału rodzica.
  Dotyczy nowych generacji i dogenerowań; istniejące zestawy bez zmian.
- Minima puli i pokrycie etapów bez zmian: oba typy liczą się jako `guided`,
  ale publikacja ich nie wymaga.
- Deduplikacja puli (`exercise-identity`): bodziec = posortowane pary lub
  posortowane etykiety grup z elementami.
- Edytor rodzica: pola tekstowe par (lewe/prawe) i dystraktorów; dla grup
  pola etykiet i elementów z wyborem grupy (`NativeSelect`, Mantine);
  dodawanie i usuwanie wierszy w granicach limitów; `answer` wyliczany
  z pól (nie edytowany osobno, jak dziś przy `lesson_order`). Podgląd
  pokazuje odpowiedź w formacie `answer`.
- Fake generator: po jednym ćwiczeniu obu typów w etapie `guided`.

### 10.7. Prywatność, transakcje, integracje

- Kid DTO bez klucza: pary i przynależność do grup znane tylko serwerowi;
  identyfikatory UUID nadawane przy materializacji (inne w każdym zadaniu).
- Ocena bez modelu i bez danych dziecka poza przypisaniami; zapis próby,
  oceny i ekspozycji w jednej transakcji jak w `lesson_order`.
- API → MCP → skill: lekcje poza `learning-overview` — brak wpływu.

### 10.8. Decyzje do akceptacji właściciela

1. **Zmiana zakresu**: „dopasowywanie par” przestaje być wyłączeniem; dwa
   nowe typy `lesson_match` i `lesson_group` tylko w przedmiotach szkolnych
   (gramatyka bez nich).
2. **Limity**: pary 3–5 + 0–2 dystraktory; grupy 2–3, elementy 4–8, min. 2
   na grupę.
3. **Modalność `assignment`** wspólna dla obu typów + migracja `0026`.
4. **Ocena zero-jedynkowa** z poprawnymi parami/grupami w feedbacku; bez
   oceny częściowej i bez zaznaczania pojedynczych błędów (możliwe później).
5. **Etap `guided`**, dopuszczone w kartkówce, nie wymagane do publikacji.
6. **Interakcja tylko stukaniem** (bez przeciągania), układy compact/expanded
   jak w 10.5.
7. **Poprawka tasowania** (10.4) również dla istniejącego `lesson_order`.
8. **Poza etapem**: powiązanie z pomylonymi pojęciami z Etapu 6 (np. selektor
   wybierający „Pogrupuj” z grupami nazwanymi jak pomylona para) — do
   rozważenia po pilotażu, gdy będzie wiadomo, jak często generator tworzy
   takie grupy.

### 10.9. Korekty przy implementacji (2026-10-29)

- Krótsze limity tekstów (pary: lewa ≤40, prawa ≤100; grupy: etykieta ≤30,
  element ≤40) i zwięzła odpowiedź kanoniczna (lewe strony / etykiety grup):
  pełny zapis par przekraczał limit `answer` (300 znaków), a krótkie teksty
  lepiej mieszczą się na telefonie. Pełne pary i grupy dziecko widzi
  w feedbacku (`correctText` z klucza zadania: `lewe → prawe`, `grupa: elementy`).
- Pole elementów grup nazywa się `groupItems` (`items` należy do `lesson_order`
  i ma inny kształt).
- `LessonItemSchema` (elementy w Kid DTO) jest `.strict()` — nic z klucza nie
  przejdzie do dziecka.
- Fake generator nie tworzy par ani grup (jak słów kluczowych): zmiana
  rozkładu typów zmieniłaby przebiegi istniejących testów; testy budują pule
  z parami i grupami przez edycję rodzica.
- Edytor rodzica dodaje pola w idiomie istniejącego edytora lekcji (natywne
  `input`/`select`), nie Mantine — edytor lekcji jeszcze nie przeszedł na Mantine.
- Kryterium celu (`skill_version`) obejmuje przypisania: zmiana par lub grup
  tworzy nowe kryterium, więc stara próba nie awansuje nowego.
- Przełącznik grupy w Kid UI to nagłówek (bez obwódki, aktywny wypełniony rolą
  `secondary-container`), żeby nie wyglądał jak element do przeniesienia.
- Review przed PR: ziarno tasowania nie może dać się wyliczyć z publicznego
  `taskId` (klient odwróciłby tasowanie i odczytał pary, grupy, kolejność
  „Ułóż” i pozycję poprawnej opcji) — materializacja dokłada losowy składnik
  dla wszystkich typów lekcji; prompt zapisuje się przy wydaniu. Kontrola
  powtórzeń par i grup porównuje całe słowa („tlen” obok „dwutlenek węgla”
  jest poprawny). Sprawdzenie „Ułóż nie startuje ułożone” porównuje widoczne
  teksty (identyczne klocki). Odrzucenie przypisań (400) nie cofa leniwej
  finalizacji zawieszonej próby. Ocena aktywności sesji nie dostaje `answer`
  par/grup jako odpowiedzi wzorcowej. Usunięcie grupy w edytorze przenosi jej
  elementy do pierwszej pozostałej grupy. Odpowiedzi z tymi samymi lewymi
  stronami albo etykietami grup dzielą `targetKey` — dotyczy tylko flagi
  wcześniejszej ekspozycji typu zawsze wspomaganego (świadomie bez zmian).

## 11. „Posłuchaj pytania” — odsłuch treści zadania na żądanie (Etap 8) — kontrakt

Status: **zaakceptowany przez właściciela 2026-10-30** (decyzje 11.6 z dodaną
decyzją 8 — nagrania przez OpenRouter). Moduły: tekst do odczytu w domenie
(`domain/lessons/`, czysta funkcja nad payloadem ćwiczenia), zlecanie
i uzgadnianie nagrań w `materials/` (`media-reconciliation.ts`, ten sam
mechanizm co `target_audio`), dołączenie gotowego nagrania do zadania
w `learning/lessons/` (materializacja), przycisk w `packages/kid-ui`.
Gramatyka i słówka bez zmian.

Cel: dziecko, które jeszcze wolno czyta, może odsłuchać polecenie i pytanie
głosem lektora. Odsłuch jest **wyłącznie na żądanie** (przycisk), bez
automatycznego czytania. Nagranie zawiera tylko tekst, który dziecko już
widzi na ekranie — nie ujawnia nic nowego.

### 11.1. Co jest czytane

Tekst do odczytu buduje czysta funkcja `questionReadText(exercise)` z payloadu
zatwierdzonej rewizji. Zasada: tylko polecenie i bodziec w kolejności, która
**nie zależy od tasowania** przy wydaniu zadania. Nagranie powstaje przy
przygotowaniu materiału, a opcje, lewa kolumna par i klocki „Ułóż” są
tasowane przy każdym wydaniu — przeczytanie ich w kolejności z payloadu
zdradzałoby rozwiązanie albo rozjeżdżało się z ekranem.

| Typ | Treść nagrania |
| --- | --- |
| `lesson_card` | **brak** w tym etapie — karty nie są rewizjami ćwiczeń (11.7) |
| `lesson_choice` | polecenie + pytanie (`stem`); **bez opcji** |
| `lesson_gap` | polecenie + zdanie z luką; luka czytana jako „luka” |
| `lesson_open_answer` | polecenie + pytanie |
| `lesson_keywords` | samo polecenie (z payloadu albo stałe polecenie typu); **bez pytania i pojęć do wyboru** — pytanie pochodzi z zaplanowanej odpowiedzi otwartej (11.7) |
| `lesson_order` | samo polecenie |
| `lesson_match` | samo polecenie |
| `lesson_group` | polecenie + nazwy grup (kolejność materiału, nietasowana) |
| `lesson_calculation` | **brak** w tym etapie — zapis matematyczny (`3/4`, `x²`, `·`) bywa czytany błędnie |

Zadania tworzone w trakcie sesji (`lesson_shorten`, pytanie porównawcze
z Etapu 6) nie mają gotowego nagrania — przycisk się nie pojawia. Wskazówka
(`hint`) nigdy nie trafia do nagrania.

### 11.2. Przygotowanie nagrania

- Nowa flaga przedmiotu `ttsForPrompts: boolean` w `SubjectModule` (szkoła:
  `true`, gramatyka: `false`). Bez skonfigurowanego TTS (`services.media`)
  funkcja jest wyłączona.
- Nowa rola zasobu rewizji `prompt_audio` obok `target_audio`
  (**migracja `0027`** rozszerza `revision_assets_role_allowed`).
  `requiredAssetsForLessonExercise` dokłada ją, gdy `ttsForPrompts` i funkcja
  z 11.1 zwraca tekst. Locale `pl-PL`, głos i format jak w ustawieniach TTS;
  fingerprint pokrywa tekst, więc edycja treści rodzica uzgadnia nowe
  nagranie w tej samej transakcji co dziś `target_audio`.
- Nagranie powstaje w workerze (kolejka `media_assets`), nie przy kliknięciu
  dziecka — zgodnie z zasadą „TTS przy przygotowaniu materiału”.
- **Dostawca TTS: OpenRouter** (`/api/v1/audio/speech`, zgodny z OpenAI
  Audio Speech). Istniejący adapter `createOpenAiTtsProvider` dostaje adres
  i klucz z nowych zmiennych `UMIEM_TTS_BASE_URL` (poza test/development
  wymaga `https://`, jak `UMIEM_LLM_BASE_URL`) i `UMIEM_TTS_API_KEY` (fallback
  `OPENAI_API_KEY` wyłącznie bez własnego BASE_URL — własny endpoint wymaga
  własnego klucza), a model z `UMIEM_TTS_MODEL` (dotąd adapter go pomijał
  i zawsze wysyłał model domyślny). Wybrana konfiguracja (decyzja 9):
  `UMIEM_TTS_PROVIDER=openrouter`, `UMIEM_TTS_MODEL=microsoft/mai-voice-2.1-flash`,
  `UMIEM_TTS_VOICE=pl-PL-Harper:MAI-Voice-2.1-Flash` (głos z `supported_voices`
  modelu; `alloy` działa tylko z modelami OpenAI).
  To jedna konfiguracja TTS dla wszystkich nagrań (także słówek i komunikatów
  interfejsu): zmiana providera/modelu zmienia fingerprinty, więc gotowe
  nagrania zostają, a nowe powstają przy kolejnej edycji materiału; katalog
  komunikatów interfejsu przygotowuje się na nowo przy starcie workera.
- **Publikacja nie czeka** na nagrania pytań: brak gotowego nagrania oznacza
  tylko brak przycisku. Awaria TTS nie blokuje rodzica.
- Tylko nowe wersje lekcji: istniejące opublikowane lekcje dostaną nagrania
  przy następnej edycji i publikacji (bez migracji danych wstecz).

### 11.3. Zadanie i Kid DTO

- Przy wydaniu zadania materializacja dołącza `questionAudioAssetId`, jeśli
  istnieje gotowy zasób TTS (`media_assets.state='ready'`) o fingerprincie
  zgodnym z `expected_fingerprint` wiersza `prompt_audio` rewizji — najnowsza
  generacja, niezależnie od stanu powiązania w `revision_assets` (nagranie nie
  jest decyzją rodzica i może dojść po publikacji, 11.7). Pole opcjonalne
  w gałęziach `TaskPromptSchema` typów z 11.1; prompt wydanego zadania
  pozostaje niezmienny.
- Dołączane także w **kartkówce** — nagranie powtarza widoczną treść i nie
  zdradza odpowiedzi (w przeciwieństwie do `audioAssetId` odpowiedzi
  wzorcowej, który w kartkówce jest wyłączony).
- Odsłuch **nie jest ujawnieniem**: bez `authorizeDisclosure`, bez zdarzenia
  i ekspozycji, bez wpływu na samodzielność próby i na serię opanowania.
  Odczyt bajtów idzie istniejącym `/api/v1/media/:id` (tylko `ready`, cache
  niezmienne).

### 11.4. Kid UI

- Przycisk z głośnikiem w wierszu instrukcji (`ExerciseInstruction`, gniazdo
  `audio`) z nazwą „Posłuchaj pytania”; podczas odtwarzania `SoundRing`,
  ponowne dotknięcie zaczyna od początku. Cel dotykowy ≥48 px.
- Bez autoodtwarzania. Odtwarzanie zatrzymuje się przy wysłaniu odpowiedzi,
  zmianie zadania, „Pomiń”/„Nie pamiętam” i zakończeniu sesji.
- **Mikrofon**: rozpoczęcie nagrywania odpowiedzi (`lesson_open_answer` z mową)
  zatrzymuje odsłuch, a w trakcie nagrywania przycisk jest nieaktywny — STT
  nie może usłyszeć lektora.
- Błąd odtwarzania: istniejący komunikat `picture_guidance_unavailable`
  z „Spróbuj jeszcze raz”; nie blokuje zadania.
- Gdy przedmiot ma też `audioAssetId` odpowiedzi (dziś tylko gramatyka, która
  nie dostaje nagrań pytań), oba przyciski nie spotkają się w tym etapie.

### 11.5. Prywatność, koszty, integracje

- Do usługi TTS trafia wyłącznie tekst materiału zatwierdzony przez rodzica —
  bez danych dziecka; ta sama usługa co nagrania słówek. Nagranie dziecka nie
  powstaje.
- Koszt: jedno nagranie na ćwiczenie i wersję (typowo kilkadziesiąt krótkich
  tekstów na lekcję), współdzielone przez fingerprint; zero wywołań w trakcie
  sesji.
- API → MCP → skill: lekcje poza `learning-overview` — brak wpływu.
- Panel rodzica: bez nowych ustawień w tym etapie (stan nagrań widoczny jak
  dotychczas tylko przy problemach z mediami).

### 11.6. Decyzje do akceptacji właściciela

1. **Tylko na żądanie**, bez autoodtwarzania i bez ustawienia per dziecko.
2. **Zakres treści** wg tabeli 11.1: bez opcji wyboru, pojęć, klocków i par
   (kolejność tasowana); `lesson_calculation` bez nagrania.
3. **Publikacja nie czeka** na nagrania pytań; brak nagrania = brak przycisku.
4. **Dostępne w kartkówce.**
5. **Migracja `0027`** (rola `prompt_audio`) i flaga `ttsForPrompts`
   (szkoła tak, gramatyka nie).
6. **Bez wstecznego generowania** dla już opublikowanych lekcji.
7. **Poza etapem** (możliwe później): odsłuch pojedynczych opcji
   i elementów (osobne krótkie nagrania odtwarzane w kolejności z ekranu),
   odczyt zapisu matematycznego, nagrania pytań w gramatyce.
8. **Nagrania przez OpenRouter** (decyzja właściciela 2026-10-30) — jedna
   konfiguracja TTS z `UMIEM_TTS_BASE_URL`/`UMIEM_TTS_API_KEY`/`UMIEM_TTS_MODEL`
   (11.2). Obrazy nadal wymagają `OPENAI_API_KEY`.
9. **Model TTS: `microsoft/mai-voice-2.1-flash`, głos `pl-PL-Harper`**
   (decyzja właściciela 2026-10-30 po odsłuchu próbek: 4 polskie zdania z lekcji
   w 10 modelach OpenRouter). Ocenę 5/5 dostały też Gemini 3.8 Flash TTS,
   ElevenLabs v4 i v4 Turbo oraz MAI-Voice-2.1; MAI-Voice-2.1 Flash wybrano jako
   najtańszy z nich ($15 / 1 mln znaków) z natywnym polskim głosem i mp3
   zgodnym z adapterem. Gemini TTS zwraca na OpenRouter wyłącznie PCM
   (wymagałby zmiany adaptera). Pozostałe modele (Gemini Flash Lite, Fish
   Audio Drama 3 i S2.1 Pro, Grok Voice, Voxtral TTS 3) oceniono 1/5.
   Treść angielska (słówka) ma osobny głos tego samego modelu. Właściciel
   wybrał zestaw kobiecy dla całej aplikacji (2026-10-30, po odsłuchu zestawu
   kobiecego i męskiego): polska treść `pl-PL-Harper`, angielska
   `UMIEM_TTS_VOICE_EN_GB=en-GB-Emily:MAI-Voice-2.1-Flash`.

### 11.7. Korekty przy implementacji (2026-10-30)

- **Karty nauki (`lesson_card`) bez nagrania w tym etapie.** Karty należą do
  zagadnienia w `lesson_context` wersji, a nie do rewizji ćwiczenia, więc nie
  mają `revision_assets`; nagranie kart wymaga osobnego powiązania zasobu
  z wersją — do decyzji po pilotażu.
- **Polecenie w nagraniu tylko z payloadu** (albo stałe polecenie typu dla
  par, grup i słów kluczowych). Zastępczy tytuł celu, który ekran pokazuje
  przy braku polecenia, nie trafia do nagrania — „Ułóż” bez własnego polecenia
  nie ma nagrania. Słowa kluczowe czytają samo polecenie (pytanie pochodzi
  z zaplanowanej odpowiedzi otwartej, nie z payloadu).
- **Przycisk w gnieździe odsłuchu polecenia** (`guidance`, za tekstem
  instrukcji, obrysowany głośnik), nie z przodu wiersza — przednie gniazdo
  zostaje dla odsłuchu odpowiedzi wzorcowej, a widoki ćwiczeń nie wymagają
  zmian. Zniknie na czas feedbacku (jak odsłuch polecenia).
- **Nagranie gotowe po publikacji** liczy się przy kolejnym wydaniu zadania:
  `loadExercises` bierze najnowszy gotowy zasób TTS o oczekiwanym
  fingerprincie wiersza `prompt_audio` (`expected_fingerprint`), niezależnie
  od stanu decyzji i zasobu powiązanego przy edycji — wiersz opublikowanej
  rewizji jest niezmienny, więc porażka tamtego zasobu nie może na stałe
  odebrać przycisku. Zadanie już wydane ma niezmienny prompt. Lista zestawów
  dziecka nie czyta nagrań pytań.
- Review przed PR: luka w nagraniu jak w Kid UI (każdy ciąg 2+ podkreśleń),
  puste `UMIEM_TTS_PROVIDER`/`MODEL`/`VOICE` traktowane jak nieustawione także
  w fingerprincie (wcześniej `""` trafiało do fingerprintu, a adapter wysyłał
  model domyślny).
- **Worker nie unieważnia nagrań pytań** przedmiotu bez `ttsForAnswers`:
  wyłączenie zbędnego TTS lekcji sprawdza flagę właściwą dla roli
  (`prompt_audio` → `ttsForPrompts`).
- DTO rodzica (szkic lekcji i zestawu słówek) pomija `prompt_audio` — nie jest
  decyzją rodzica ani warunkiem publikacji.
- Review PR (CodeRabbit, gitar): komunikat błędu odsłuchu pytania jest stanem
  kontrolera (`questionAudioError`) i stoi w pasku statusu z przewijaniem ramy
  (`data-action-notice`), nie w wierszu instrukcji — przy 320×480 i długim
  poleceniu „Sprawdź” pozostaje osiągalne; „Nie pamiętam” w treningu zatrzymuje
  odsłuch; ponowne dotknięcie nie gasi wskaźnika nowego odsłuchu; worker
  syntetyzuje model zapisany w rekordzie zasobu (fingerprint), nie bieżący
  `UMIEM_TTS_MODEL`.
- Przełączenie dostawcy TTS: worker bierze wyłącznie zadania TTS zgodne z jego
  providerem i modelem; pozostałe czekają w kolejce bez zmiany stanu (nowy
  endpoint nie zna starego modelu, a stary worker w trakcie wdrożenia nie może
  trwale unieważnić nagrań zleconych już z nową konfiguracją). Nagranie
  z bieżącym fingerprintem zleca kolejna edycja szkicu, publikacja albo start
  workera (katalog komunikatów); stare zlecenia zostają jako nieużywane `pending`.
  Opublikowane lekcje bez gotowego nagrania pytań dostaną je po edycji
  i ponownej publikacji.
- Review przed wypchnięciem (2026-10-30): jeden głos dla wszystkich nagrań
  czytałby angielskie słówka polskim lektorem — głos zależy od locale treści
  (`UMIEM_TTS_VOICE_<JĘZYK>_<REGION>`, np. `en-GB` → `en-GB-Emily`, w fingerprincie;
  bez tych zmiennych fingerprinty bez zmian). Nieudane nagranie pytania
  publikacja zleca ponownie (`keepFailed` z #176 nie dotyczy `prompt_audio`,
  bo rodzic go nie regeneruje). Worker zgłasza przy starcie liczbę zadań TTS
  innej konfiguracji. Klucz innego dostawcy bez jego BASE_URL to błąd
  konfiguracji. Komunikat błędu odsłuchu znika po odpowiedzi i „Nie pamiętam”.

## 13. „Uzupełnij tekst” — luki z bankiem słów (Etap 10) — kontrakt

Status: **zaakceptowany przez właściciela 2026-10-30** (decyzje 13.9 bez
zmian; korekty przy implementacji w 13.10). Typ wybrany przez
właściciela 2026-10-30 spośród: „Uzupełnij tekst”, „Oś czasu”, „Podpisz
obrazek” (ten ostatni wymagałby obrazów wyłączonych w requirements, „Zakres
i świadome wyłączenia”). Numer sekcji: §12 zajmują równoległe kontrakty
odsłuchu kart i opcji — przy scalaniu numeracja może się przesunąć.

Moduły jak w Etapie 7 (§10): typ, walidacja puli i ocena w domenie
(`domain/lessons/types.ts`, `pool-validation.ts`, `evaluate.ts`,
`question-read-text.ts`, `subjects/school/`), materializacja i próby
w `learning/lessons/`, generowanie i szkic w `materials/lessons/`, widok
w `packages/kid-ui`, edytor w `apps/web/src/parent/lessons`. Gramatyka
i słówka bez zmian. Zasada bez zmian: model generuje wyłącznie dane, serwer
waliduje, rodzic zatwierdza, ocena deterministyczna bez modelu w sesji,
klucz zostaje na serwerze.

Cel: dziecko czyta krótki tekst z materiału (2–4 zdania) i do każdej luki
wybiera słowo z banku. Ćwiczy czytanie ze zrozumieniem i rozpoznanie pojęć
w kontekście — w każdym przedmiocie, nie tylko tam, gdzie są daty czy
klasyfikacje. Różnica wobec `lesson_gap`: tam jedna luka i odpowiedź
wpisywana (etap `productive`), tu kilka luk i wybór z widocznego banku
(etap `guided`).

### 13.1. Payload — typ `lesson_cloze`

Ćwiczenie w puli (tylko `school`):

| Pole | Kształt | Zasada |
| --- | --- | --- |
| `exerciseType` | `"lesson_cloze"` | etap `guided` |
| `clozeText` | string, ≤300 znaków | tekst z lukami; luka = ciąg 2+ podkreśleń (jak `splitGap` i `GAP_MARKER`) |
| `gapAnswers` | `string[]`, 2–4 | słowo do każdej luki w kolejności tekstu; 1–3 słowa, ≤30 znaków |
| `extraWords` | `string[]`, 1–2 | dystraktory w banku (ten sam rodzaj słów), ≤30 znaków; co najmniej jeden, żeby ostatniej luki nie dało się uzupełnić eliminacją |
| `answer` | string | `gapAnswers` złączone `", "` (`targetKey`, podgląd rodzica; wylicza kod) |
| `instructionPl`, `sourceRefs` | jak w innych typach | `sourceRefs` wymagane |

Walidacja puli (`validateCloze`):

- liczba luk w `clozeText` = liczba `gapAnswers`, 2–4; limity liczby
  i długości jak wyżej;
- między dwiema lukami stoi co najmniej jedno słowo (`___ ___` albo
  `___, ___` są nie do rozróżnienia);
- odpowiedzi i dystraktory unikalne po normalizacji (NFC, białe znaki,
  wielkość liter); kontrola powtórzeń całymi słowami jak w §10.9 („tlen” obok
  „dwutlenek węgla” jest poprawny);
- żadna odpowiedź ani dystraktor nie występuje w `clozeText` poza lukami
  (całymi słowami, po normalizacji) — tekst nie może podpowiadać ani
  wykluczać słowa z banku;
- tekst bez innych ciągów podkreśleń niż luki.

Czy dwa słowa nie pasują zamiennie do dwóch luk („Rośliny potrzebują ___
i ___”), walidacja nie rozstrzygnie: prompt tego zabrania (13.6), a podgląd
rodzica pokazuje uzupełniony tekst do sprawdzenia.

### 13.2. Kid DTO (`.strict()`, bez klucza)

```ts
{ kind: "lesson_cloze", instructionPl: string,
  segments: ({ text: string } | { gapId: Uuid })[] /* tekst pocięty na luki */,
  words: LessonItem[] /* odpowiedzi + dystraktory, UUID, tasowane */,
  questionAudioAssetId?: Uuid }
```

- Segmenty tekstu i luk przygotowuje serwer (`.strict()` dla obu kształtów),
  więc klient nie parsuje podkreśleń. `gapId` nadawane przy materializacji
  (inne w każdym zadaniu). Numer luki (1–4) wynika z kolejności — klient go
  wylicza, DTO go nie niesie.
- `superRefine`: 2–4 luki, unikalne `gapId`, `words.length` > liczby luk.
- Nic w DTO nie wskazuje, które słowo pasuje do której luki.

### 13.3. Odpowiedź i ocena

Modalność `assignment` z §10.3 — **bez migracji** (modalność jest w `0026`,
typy ćwiczeń nie mają CHECK w bazie):

- `itemId` = luka (`gapId`), `targetId` = słowo z banku. Każda luka dokładnie
  raz, każde słowo co najwyżej raz (dystraktory zostają nieużyte). Kształt
  niezgodny z zadaniem → `400` bez próby, jak w parach.
- `AttemptInputSchema`: dolna granica przypisań zmienia się z 3 na 2
  (dokładną liczbę dla zadania i tak sprawdza strażnik serwera). Zmiana
  rozluźnia schemat, więc starsze klienty dalej działają.
- Hash żądania z przypisań posortowanych po `itemId`, jak w §10.3.

Ocena deterministyczna bez modelu: `correct`, gdy każde słowo stoi w swojej
luce; inaczej `incorrect` z `correctText` = cały tekst z poprawnymi słowami
(dziecko czyta gotowe zdania). Bez oceny częściowej i bez „prawie” — spójnie
z decyzją 10.8 pkt 4. Pomoc `options` jak w `lesson_match` (bank widoczny),
więc poprawna odpowiedź nie jest samodzielnym przypomnieniem i nie wchodzi do
serii opanowania. Zadanie liczy się do budżetu sesji.

Kartkówka: dopuszczone (jak pary i grupy), z ekspozycją przy wydaniu;
omówienie pokazuje odpowiedź dziecka i uzupełniony tekst. Raport aktywności
sesji i karta pracy rodzica opisują odpowiedź jako `1 → słowo, 2 → słowo`.
Ocena aktywności sesji dostaje tekst z lukami, bank i odpowiedź dziecka
w tym samym formacie, a jako wariant poprawny uzupełniony tekst.

### 13.4. Tasowanie bez rozwiązanego układu

Bank tasowany jak elementy w §10.4 (ziarno z losowym składnikiem, §10.9).
Gdy odpowiedzi w banku (pomijając dystraktory) stoją w kolejności luk,
materializacja przesuwa bank cyklicznie o jedną pozycję, aż ta kolejność się
zmieni (deterministycznie, najwyżej tyle kroków, ile słów w banku).

### 13.5. Kid UI — `LessonClozeView`

Widok w `exercises/lesson/` z istniejących klocków: `ExerciseFrame`,
`LessonBlockButton`, `ActionButton` („Sprawdź”, aktywne przy wszystkich
lukach), `useRetryReset`. Stan stukania to istniejące czyste funkcje
`matchState`/`selectSlot`/`placeRight`/`matchAssignments`
z `assignment-state.ts` (luki = lewa kolumna, słowa = prawa) — bez nowych
reguł stanu, ewentualnie tylko alias nazwy.

- **Tekst** w akapicie; luka w tekście to **nieinteraktywny** znacznik
  z numerem i wstawionym słowem albo pustym miejscem (np. „①”, „① tlen”),
  z wyróżnieniem aktywnej luki. Klikalne luki wewnątrz tekstu nie spełnią
  celów ≥48 px bez rozsadzania wierszy na 320 px. Czytnik ekranu czyta
  „luka 1, pusta” / „luka 1: tlen”.
- **Miejsca** pod tekstem: dla każdej luki `LessonBlockButton` „1 · tlen”
  albo „1 · Wybierz słowo”. Stuknięcie czyni miejsce aktywnym (domyślnie
  pierwsze puste), stuknięcie zajętego oddaje słowo do banku.
- **Bank** pod miejscami: słowa jako `LessonBlockButton`; stuknięcie wstawia
  słowo do aktywnej luki, a aktywna staje się następna pusta.
- Układ: compact (<600) tekst, miejsca i bank jeden pod drugim; expanded
  (≥840) tekst z miejscami po lewej, bank po prawej; niska wysokość (<480)
  przewija treść w ramie, a „Sprawdź” pozostaje osiągalne. Cele ≥48 px,
  główna akcja ≥54 px, teksty się zawijają, brak przepełnienia poziomego.
  Bez surowych `<button>`; znaczniki luk w tekście to elementy tekstowe.
- Feedback: dotychczasowa ścieżka `great` / `incorrect{correctText}`.
- Komunikaty w `messages.ts`: polecenie domyślne („Uzupełnij tekst. Wybierz
  słowo do każdej luki.”), „Wybierz słowo”, etykiety dostępności luk
  i banku, nazwa typu „Uzupełnij tekst” w panelu rodzica.

### 13.6. Generowanie

- Structured output: osobna ścisła gałąź `lesson_cloze` w schemacie puli
  (`lesson-pool-schema.ts`, wzór `lesson_match`): `objectiveId`,
  `instructionPl?`, `clozeText`, `gapAnswers`, `extraWords`, `sourceRefs`.
  `materializeGeneratedAssignments` dopisuje polecenie domyślne i `answer`,
  potem wspólna walidacja kształtu (`lesson-drafts.ts`) i puli.
- Prompt szkoły: tekst to 2–4 krótkie zdania bliskie materiałowi rodzica
  (słownictwo dziecka ~8 lat); luki tylko na pojęciach z materiału
  (rzeczowniki, nazwy, liczby z materiału), nigdy na spójnikach, przyimkach
  i słowach, które da się odgadnąć z gramatyki zdania; do każdej luki pasuje
  dokładnie jedno słowo z banku; dystraktory z tego samego materiału i tej
  samej kategorii, ale błędne w danym zdaniu; słowa z banku nie występują
  w tekście poza lukami. Dotyczy nowych generacji i dogenerowań.
- Minima puli i pokrycie etapów bez zmian: typ liczy się jako `guided`,
  publikacja go nie wymaga.
- Deduplikacja (`exercise-identity`): bodziec = znormalizowany tekst
  z lukami + odpowiedzi w kolejności luk.
- Kryterium celu (`skill_version`) obejmuje tekst i odpowiedzi: zmiana luk
  tworzy nowe kryterium.
- Fake generator nie tworzy tego typu (jak par i grup, §10.9); testy budują
  pule przez edycję rodzica.

### 13.7. Edytor rodzica (Mantine) i „Posłuchaj pytania”

- Edytor (`ClozeFields.tsx` obok `AssignmentFields.tsx`): `Textarea` na
  tekst z podpowiedzią „Wpisz ___ w miejscu luki”; pola `TextInput`
  „Luka 1…4” — ich liczba podąża za liczbą luk w tekście; dystraktory 1–2
  z dodawaniem i usuwaniem; `answer` wyliczany z pól (bez osobnej edycji).
  Podgląd pokazuje uzupełniony tekst z wyróżnionymi słowami. Błędy walidacji
  z serwera (13.1) jak w innych typach.
- `questionReadText`: polecenie (z payloadu albo domyślne) + `clozeText`
  z „luka” w miejscu każdej luki; banku nie czyta (tasowany). Nagranie
  pokazuje tylko to, co dziecko widzi, więc w kartkówce też jest dostępne.

### 13.8. Prywatność, transakcje, integracje

- Kid DTO bez klucza: przypisanie słów do luk znane tylko serwerowi; UUID
  luk i słów inne w każdym zadaniu.
- Ocena bez modelu i bez danych dziecka poza przypisaniami; zapis próby,
  oceny i ekspozycji w jednej transakcji, jak w parach.
- Do generatora trafia wyłącznie materiał rodzica — bez danych dziecka.
- API → MCP → skill: lekcje poza `learning-overview` — brak wpływu; filtr
  i nota w `SKILL.md` bez zmian.
- Odsłuch słów banku: poza etapem. Jeśli kontrakt odsłuchu opcji (§12
  równoległy) doda nagrania do `LessonItem`, bank może je przejąć osobną
  zmianą.

### 13.9. Decyzje do akceptacji właściciela

1. **Nowy typ `lesson_cloze`** tylko w przedmiotach szkolnych, etap
   `guided`, dopuszczony w kartkówce, niewymagany do publikacji.
2. **Limity**: tekst ≤300 znaków, 2–4 luki, odpowiedź 1–3 słowa ≤30 znaków,
   1–2 dystraktory (co najmniej jeden obowiązkowo).
3. **Modalność `assignment` bez migracji**; dolna granica przypisań
   w schemacie 3 → 2.
4. **Ocena zero-jedynkowa** z uzupełnionym tekstem w feedbacku; bez oceny
   per luka (możliwe później).
5. **Luki w tekście nieinteraktywne**, stukanie w listę miejsc pod tekstem
   i w bank (13.5).
6. **Słowa z banku nie mogą występować w tekście poza lukami** (twarda
   walidacja).
7. **Nagranie pytania**: polecenie + tekst z „luka”; bez banku.
8. **Poza etapem**: wariant bez banku (wpisywanie, etap `productive`), ocena
   per luka, odsłuch słów banku, powiązanie z pomylonymi pojęciami z Etapu 6.

### 13.10. Korekty przy implementacji (2026-10-30)

- **Jedna kolumna na każdym ekranie** zamiast banku obok tekstu od 840 px:
  kontener materiału ma ok. 530 px także na desktopie, więc dwie kolumny
  ściskały tekst, a w niskim landscape bank lądował u góry, daleko od miejsc
  luk. Kolejność: tekst, miejsca luk, tuż pod nimi bank i podpowiedź „Które
  słowo pasuje do luki n?”. Spec geometrii sprawdza to na 320×640, 390×844,
  844×390, 768×1024 i 1280×800.
- **Omówienie kartkówki**: odpowiedź dziecka to tekst z jego słowami w lukach
  (pusta luka jako „___”), obok poprawnego tekstu — klucz zadania trzyma też
  `clozeText` (tylko serwer). Raport aktywności sesji i karta pracy rodzica
  opisują odpowiedź jako `1 → słowo; 2 → słowo`, a ocena aktywności sesji
  dostaje jako wariant poprawny ten sam zapis (nie uzupełniony tekst), żeby
  porównywała odpowiedzi w jednym formacie; bodźcem jest tekst z „[1]”, „[2]”.
- **Tasowanie**: `shuffleUnsolved` przesuwa układ cyklicznie aż do
  nierozwiązanego (najwyżej n − 1 kroków) — dla par, grup i „Ułóż” wynik bez
  zmian (wystarczał jeden krok), dla banku z dystraktorami na początku jeden
  krok nie zawsze zmienia kolejność słów luk.
- Luka w tekście ma dla czytnika ekranu ukryty opis („luka 1, pusta” /
  „luka 1: tlen”), a widoczny znacznik (numer i słowo albo „…”) jest
  `aria-hidden`; miejsca luk mają etykiety „Luka n: wybierz słowo” / „Luka n:
  słowo. Dotknij, aby wyjąć słowo”.
- Ocena aktywności, feedback i zapis próby nie wymagały nowych pól oprócz
  `filledText` i `clozeText` w kluczu zadania; `evaluateAssignment` bez zmian
  (luka = element, słowo = cel użyty co najwyżej raz).
- Fake generator nie tworzy luk z bankiem (jak par i grup); testy budują pule
  przez edycję rodzica.
