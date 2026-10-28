# Design — przedmioty szkolne i trener precyzji odpowiedzi

**Status:** Etapy 1–2 zaimplementowane na gałęzi `feature/school-subjects-source-material` (2026-10-28); ewaluacja gradera na złotym zestawie: wiedza 19/20 (95%), przypadki twarde 100% wiedzy, brakujące elementy 19/20 (model `deepseek/deepseek-v4.1-flash`, prompt `school-grader-v2`; zapis przebiegu: `grader-eval-2026-10-28.md`). Etapy 2b–5 według `tasks.md`.
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
   Konkretny brakujący element dokleja do feedbacku serwer przy ujawnieniu
   (z zapisem ekspozycji), nie szablon katalogu.
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
| `familyId` | string (slug w obrębie zestawu) | grupa sformułowań tego samego pytania |
| `sourceRefs` | `[{ quote }]`, 1–3 | `quote` = dokładny fragment źródła; pola `documentId`/`page` zarezerwowane na przyszły import, dziś nieużywane |

Walidacja (generowanie, edycja rodzica i publikacja — ta sama funkcja):

- każdy `sourceRefs[].quote` po normalizacji (NFC, białe znaki) jest podciągiem
  materiału źródłowego z kontekstu albo tekstu dodanego i oznaczonego przez
  rodzica; brak pokrycia = odrzucenie ćwiczenia (uziemienie, wym. 2.3);
- ćwiczenia otwarte mają 1–6 elementów wymaganych i odpowiedź wzorcową, która
  je wszystkie zawiera treściowo (sprawdza rodzic; automat sprawdza tylko
  obecność i limity — świadomie, bez kolejnego wywołania modelu);
- rodzina pytań: wspólny `objectiveId`, identyczny zbiór identyfikatorów
  elementów wymaganych i wspólna odpowiedź wzorcowa; różny tekst pytania;
- typy zamknięte (`lesson_choice`, `lesson_gap`, `lesson_order`) używają
  istniejących pól i walidacji puli; `sourceRefs` wymagane także dla nich.

Zadania rachunkowe (etap 2b, decyzja właściciela 2026-10-28): nowy typ
`lesson_calculation` z polem payloadu
`calculation: { kind, params, unit, tolerance?, templateFamilyId }`, gdzie
`kind` należy do zamkniętego enuma implementowanego w domenie — na start:
`scale_distance` (skala mapy: mianownik skali × odległość na mapie, z wyborem
jednostki wyniku), `height_difference` (wysokość względna: różnica wysokości
bezwzględnych), `unit_conversion` (cm↔m↔km). Czysta funkcja domenowa
`computeCalculationAnswer(kind, params)` jest jedynym źródłem poprawnej
odpowiedzi: walidacja puli przelicza każde ćwiczenie i odrzuca niezgodne
(model proponuje szablon i parametry, nie wynik), a ocena próby parsuje polski
zapis liczby (spacje tysięcy, przecinek dziesiętny), opcjonalną jednostkę
i porównuje z tolerancją szablonu — bez gradera. Warianty liczbowe szablonu
to osobne ćwiczenia w puli o wspólnym `templateFamilyId`, w edytorze
pokazywane razem z policzonymi odpowiedziami; Kid UI używa istniejącego
pola odpowiedzi z przyciskiem „Sprawdź” (odpowiedź pisemna). Przykłady
z pilotażu: skala 1:25 000 i 3 cm → 750 m; 400 m n.p.m. − 150 m n.p.m. → 250 m.

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

## 6. Trener precyzji (Etap 4) — szkic kontraktów

- **Słowa kluczowe:** osobny typ `lesson_keywords` (payload: `items` z flagą
  kluczowości po stronie serwera; dziecko wybiera 2–3). Wynik wyboru jest
  deterministyczny. W planie sesji zadanie `lesson_keywords` bezpośrednio
  poprzedza powiązaną odpowiedź otwartą i oznacza ją jako wspomaganą
  (ekspozycja zapisywana przed ujawnieniem listy pojęć).
- **Skróć odpowiedź:** zadanie następcze w tej samej sesji, tworzone po
  ukończonej odpowiedzi otwartej z precyzją `verbose`/`unfocused`: dziecko
  widzi własny tekst i wskazanie kategorii fragmentów (z werdyktu), pisze
  wersję krótszą. Poprawka to osobna próba z powiązaniem do oryginału,
  oceniana tylko pod kątem zachowania elementów wymaganych (ten sam grader,
  `expectedForm` oryginału); nigdy nie jest samodzielnym sukcesem.
- Oba typy przechodzą pełną ścieżkę nowej mechaniki: kontrakty, walidacja puli,
  silnik, edytor rodzica, widok Kid UI przez wspólne komponenty, testy geometrii.

Szczegółowe kontrakty DTO tych dwóch typów dopisuje Etap 4 przed implementacją;
ten projekt ustala tylko ich semantykę samodzielności i zapisu.

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
