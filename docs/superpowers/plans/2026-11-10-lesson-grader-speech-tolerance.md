# Tolerancja mowy w ocenie podyktowanej odpowiedzi (story 2) — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Kroki mają pola wyboru (`- [ ]`).

**Cel:** niepoprawiona podyktowana odpowiedź otwarta jest oceniana przez model, który wie, że to mowa, toleruje jej cechy i nie dostaje wymogu jednego zdania; cache werdyktów nie miesza mowy z klawiaturą.

**Spec:** `_bmad-output/specs/spec-dyktowana-odpowiedz-sciezka-dziecka/` — CAP-2, AC-04–10, AC-32, AC-34. Właściciel polecił realizację 2026-11-10 mimo braku dowodu potrzeby w pomiarze syntetycznym (`speech-baseline.md`).

**Architektura:** znacznik `school.spoken` w `GraderInput` ustawia przypadek użycia `learning` (ten sam warunek co pomijanie liczenia zdań: mowa niepoprawiona ręcznie). Adapter gradera dla `spoken` składa wariant promptu szkolnego i zwraca osobną wersję promptu. Wersja promptu już jest częścią klucza `lesson_verdicts`, więc cache rozdziela się bez migracji. Prompt i wersja dla klawiatury (`school-grader-v3`) nie zmieniają się ani o znak — stare werdykty pisane zostają ważne (AC-07).

**Moduły i granice:** `packages/server/src/ports/ai.ts` (kontrakt portu), `providers/openai-compatible/grader.ts` i `providers/fake.ts` (adaptery), `modules/learning/lessons/lesson-attempts.ts` (ustawienie znacznika), `scripts/evaluate-school-grader.mts` + `tests/probes/` (pomiar). Bez zmian: schemat bazy, Kid DTO, API, MCP, domena (`validateSchoolVerdict`), wspólny `lessonGraderInput` z `materials`. Transakcje bez zmian. Żadnej reguły językowej w kodzie — tolerancja wyłącznie w tekście promptu.

**Prywatność:** do modelu dochodzi jedno nowe pole danych `inputMethod: "speech"`; znika `expectedForm`. Bez danych dziecka i nagrań.

## Decyzje

1. **Wersje.** `school-grader-v3` (klawiatura i mowa poprawiona — bez zmian), nowa `school-grader-v3-speech`. Fake: `fake-school-grader-v3-speech`. `promptVersions` adaptera zawiera wszystkie trzy, żeby nadzór rodzica (`lesson-supervision.ts`) widział werdykty mówione.
2. **AC-09** spełnia sam klucz: odpowiedź mówiona oceniona wcześniej leży pod `school-grader-v3`, po zmianie szuka pod `-speech`.
3. **Wymóg jednego zdania** dla `spoken`: wiersz „Oczekiwana forma odpowiedzi” znika z promptu systemowego, pole `expectedForm` z danych (AC-06).
4. **Tekst dopisany do promptu systemowego dla `spoken`** (w miejscu wiersza o formie):

   > Odpowiedź została podyktowana na głos i zapisana automatycznie; dziecko jej nie poprawiało. Oceniaj to, co dziecko chciało powiedzieć. Wypełniacze („yyy”, „no”, „znaczy”), powtórzenia, urwane i zaczęte od nowa zdania, brak albo nadmiar kropek i podział na zdania to cechy mowy: nie obniżają precyzji i nie wpisuj ich do redundantFragments ani offTopicFragments. Gdy dziecko poprawia się w trakcie wypowiedzi, oceniaj wersję ostateczną; wycofanego stwierdzenia nie wpisuj do incorrectStatements ani confusedConcepts. Słowo zapisane z błędem rozpoznawania, które brzmi jak właściwy termin, traktuj jak ten termin; użycie innego pojęcia z tematu to nadal pomylenie pojęć. Braki, błędy rzeczowe i dygresje na inny temat oceniaj tak samo jak w odpowiedzi pisanej.

5. **Pomiar.** Skrypt przekazuje `spoken: true` dla przypadków `input: "speech"`. Cztery nowe przypadki mówione (AC-34) dostają `holdout: true`, są dopisane PO zamrożeniu tekstu z pkt 4, mają własny wiersz raportu „mówione-nowe” i nie wchodzą do reguły decyzyjnej ani do bramki. Przebieg na prawdziwym modelu (`--runs=3`, ok. 130 wywołań) tylko po zgodzie właściciela na koszt; bez niego AC-04, AC-05, AC-08 zostają niezweryfikowane i tak trafią do PR.

## Zadania

### 1. Port i adapter OpenAI-compatible

Pliki: `packages/server/src/ports/ai.ts`, `packages/server/src/providers/openai-compatible/grader.ts`, `grader.test.ts`.

- [ ] Test (czerwony) w `grader.test.ts`: dla `school.spoken === true` — `promptVersionForInput` zwraca `school-grader-v3-speech`; treść żądania: prompt systemowy zawiera „podyktowana na głos” i nie zawiera „Oczekiwana forma odpowiedzi”; JSON danych ma `inputMethod: "speech"` i nie ma `expectedForm`; cały korpus żądania nie zawiera pól spoza listy dozwolonych (AC-10: klucze danych dokładnie `question, modelAnswer, requiredElements, supplementaryElements, commonErrors, sourceQuotes, childAnswer, inputMethod`).
- [ ] Test (zielony od razu, chroni AC-07): dla wejścia bez `spoken` prompt systemowy i dane są bajt w bajt takie jak dziś (snapshot wpisany w teście jako porównanie z wejściem bez pola: wynik dla `{...school}` równy wynikowi dla `{...school, spoken: undefined}`, a wiersz „Oczekiwana forma odpowiedzi: one_sentence.” obecny) i wersja `school-grader-v3`.
- [ ] `ports/ai.ts`: `readonly spoken?: boolean` w `school` z komentarzem: niepoprawiona odpowiedź z dyktowania; przełącza wariant promptu i wersję.
- [ ] `grader.ts`: stała `SCHOOL_SPEECH_PROMPT_VERSION`; w `schoolSystemPrompt` wiersz formy zastąpiony tekstem z decyzji 4, gdy `school.spoken`; w `schoolUserMessage` `expectedForm` pominięte i dodane `inputMethod: "speech"`; `promptVersions` i `promptVersionForInput` jak w decyzji 1. Uaktualnić asercję `promptVersions` w istniejącym teście.
- [ ] `corepack pnpm vitest run --config vitest.unit.config.ts packages/server/src/providers/openai-compatible/grader.test.ts` — PASS.

### 2. Fake i przypadek użycia

Pliki: `packages/server/src/providers/fake.ts`, `packages/server/src/modules/learning/lessons/lesson-attempts.ts`, `tests/integration/lesson-grader-school.test.ts`.

- [ ] Test integracyjny (czerwony), AC-32: ta sama treść raz wysłana z `inputMethod: "speech"` po `dictateLessonAnswer` (niepoprawiona), raz z klawiatury przez drugie dziecko przypisane do tej samej talii → `grader.callCount` rośnie o 2, w `lesson_verdicts` dwa wiersze o wersjach `fake-school-grader-v3` i `fake-school-grader-v3-speech`; żądanie mówione ma `school.spoken === true`, pisane nie ma pola. Trzecia próba (mowa, ta sama treść, nowa sesja) trafia w cache mówiony bez wywołania.
- [ ] Test integracyjny, AC-07: mowa poprawiona ręcznie (tekst inny niż podyktowany) → żądanie bez `spoken`, wersja `fake-school-grader-v3`.
- [ ] `fake.ts`: oba `promptVersionForInput` (FakeAnswerGrader i drugi fake z l. ~621) zwracają wersję `-speech` dla `school.spoken`; `promptVersions` FakeAnswerGrader zawiera ją.
- [ ] `lesson-attempts.ts`: `buildGraderInput(..., blocks?, spoken = false)` — po `lessonGraderInput` dokłada `spoken: true` do `school`, gdy `spoken` i `school` istnieje; wywołanie w fazie 1 przekazuje `skipsFormCheck(started.answerSource)`. Test zgodności `lesson-grader-input.parity.test.ts` zostaje bez zmian (domyślne `false`).
- [ ] `corepack pnpm test:integration tests/integration/lesson-grader-school.test.ts` — PASS; `*.architecture.test.ts` — PASS.

### 3. Skrypt pomiaru i przypadki AC-34

Pliki: `scripts/evaluate-school-grader.mts`, `tests/probes/school-grader-report.ts`, test raportu `tests/school-grader-*.test.ts`, `tests/probes/fixtures/school-grader-golden-set.json`.

- [ ] `inputFor(question, childAnswer, spoken)` dokłada `spoken: true`; nagłówek skryptu wypisuje obie wersje promptu.
- [ ] `CaseOutcome.holdout: boolean`; `groupReportLines` zwraca trzeci wiersz „mówione-nowe” (tylko holdout), wiersz „mówione” liczy przypadki bez holdout; `decisionLines` pomija holdout. Test jednostkowy raportu na trzy wiersze i pominięcie.
- [ ] Po zamrożeniu promptu (commit zadania 1): 4 przypadki `input: "speech", holdout: true` na istniejących pytaniach zestawu — bez interpunkcji i wielkich liter z wypełniaczami (correct/concise), autokorekta faktu na końcu (correct), częściowa z restartem zdania (partial), błędna zależność z wypełniaczami (incorrect). Treści fikcyjne.
- [ ] `corepack pnpm eval:school-grader -- --fake` przechodzi bez błędu konfiguracji; testy raportu PASS.

### 4. Dokumentacja

- [ ] `docs/agents/providers-privacy.md`: do opisu gradera — znacznik `inputMethod: "speech"` dla niepoprawionej dyktowanej odpowiedzi, wtedy bez oczekiwanej formy; wersja `school-grader-v3-speech`.
- [ ] `docs/agents/lessons.md` / `docs/architecture.md` §19: jedno zdanie o wariancie promptu i rozdzieleniu cache, jeśli sekcja o cache werdyktów istnieje.
- [ ] Spec: `stories.yaml` (stan story 2), `SPEC.md` (ograniczenie o wstrzymaniu CAP-2 → realizacja na polecenie właściciela), `brownfield.md` (znacznik „stan sprzed story 2”).

### 5. Weryfikacja

- [ ] `corepack pnpm check` — PASS.
- [ ] `corepack pnpm test:integration` dla zmienionego pliku; `corepack pnpm test:e2e:shards` (zmiana serwera na ścieżce lekcji).
- [ ] Pomiar na prawdziwym modelu: zapytać właściciela o zgodę na koszt; wynik dopisać do `speech-baseline.md` jako „po zmianie”. Bez zgody — jawnie niezweryfikowane w PR.

## Poprawki po przeglądzie trzech krytyków (obowiązują przed treścią wyżej)

1. **Tekst promptu (zastępuje decyzję 4), wstawiony PO wierszu „Pomylone pojęcia”, nie w miejscu wiersza formy:**

   > Odpowiedź została podyktowana na głos i zapisana automatycznie; dziecko nie poprawiało zapisu. Oceniaj treść, którą dziecko wypowiedziało; niczego za nie nie dopowiadaj. Wypełniacze („yyy”, „no”, „znaczy”), powtórzenia, urwane i zaczęte od nowa zdania, interpunkcja i podział na zdania (także gdy pytanie prosi o jedno zdanie) to cechy mowy: nie wpływają na precyzję i nie trafiają do żadnej listy fragmentów. Gdy dziecko poprawia się w trakcie, liczy się wersja ostateczna, także błędna; wycofanej wersji nie wpisuj do żadnej listy. Zniekształcony zapis, który sam nie jest innym pojęciem z tematu (np. „foto synteza”), traktuj jak właściwy termin; gdy zapisane słowo jest innym pojęciem z tematu albo typowym błędem, to pomylenie pojęć, nawet jeśli brzmi podobnie. Fragmenty i „said” cytuj dosłownie z zapisu. Braki, błędy rzeczowe, zbędne informacje i dygresje oceniaj jak w odpowiedzi pisanej.

2. **Forma.** Wiersz „Oczekiwana forma odpowiedzi” i pole `expectedForm` znikają tylko dla `spoken` z formą `one_sentence`; pozostałe formy (`short`, `explanation`, `list`) model dostaje jak dotąd. Treść pytania może sama prosić o jedno zdanie — to pokrywa akapit z pkt 1 (AC-06 dotyczy wymogu z pola formy).
3. **Test AC-07.** Przed zmianą `grader.ts` powstaje migawka (`toMatchSnapshot`) obecnych wiadomości systemowej i użytkownika dla ścieżki szkolnej; musi zostać zielona po zmianie, także dla `spoken: false`. Porównanie „z samym sobą” odpada.
4. **Test AC-32/AC-09.** Jedno dziecko, kolejne sesje (`endSession` + `clock.advanceHours(48)`): najpierw klawiatura, potem na wierszu klawiatury `parent_decision = 'overridden_incorrect'`, potem ta sama treść podyktowana na nowo i niepoprawiona → wywołanie modelu +1, wynik poprawny (nie odziedziczył decyzji z wiersza pisanego), dwa wiersze o tym samym `item_revision_id` i różnych wersjach, `attempts.answer = {inputMethod: "speech", edited: false}`. Kolejna sesja z ponownym dyktowaniem trafia w wiersz mówiony bez wywołania.
5. **`fake.ts`:** tylko `FakeAnswerGrader`; metoda przy `FakeSessionActivityReviewer` zostaje nietknięta.
6. **Raport.** `holdout` wpływa tylko na wiersze raportu (trzeci wiersz „mówione-nowe”); reguła decyzyjna liczy przypadki nowe jak pozostałe mówione — to jedyne przypadki nieużyte przy pisaniu promptu. `tests/school-grader-golden-set.test.ts` dostaje asercję: co najmniej 4 przypadki mówione `holdout`, kategorie „mowa — …”.
7. **Przypadki nowe (zastępują listę z zadania 3):** poprawna bez interpunkcji i wielkich liter z wypełniaczami; autokorekta z dobrej wersji na złą (oczekiwana wiedza inna niż `correct`); „bezwzględna” w pytaniu o wysokość względną (pomylenie pojęć, wiedza jak w pisanym odpowiedniku); częściowa bez interpunkcji. Po pierwszym przebiegu na prawdziwym modelu i jakiejkolwiek zmianie promptu przestają być „nieużyte”.
8. **Jak czytać pomiar po zmianie.** CAP-2 spełnione, gdy skrypt wypisze „REGUŁA: story 2 niepotrzebne” (zero stabilnych błędów mowy), a dodatkowo ręcznie: S06 ma fragment nie na temat, przypadki mówione częściowy i błędny oraz cztery nowe mają oczekiwaną wiedzę w 3/3 przebiegach. Bramka pisanych: prompt pisany się nie zmienia, więc porównujemy z pomiarem bazowym — brak nowych porażek pisanych względem `speech-baseline.md` (tam bramka już nie przechodziła przez G05/G06/G27).
9. **Znane ograniczenia do zapisania w specu i `docs/agents/lessons.md`:** (a) rodzic zobaczy tę samą odpowiedź w dwóch wierszach nadzoru (mówiony i pisany), a decyzja na jednym nie przenosi się na drugi — bez nowego pola DTO; (b) poprawka wpisana z klawiatury po podyktowanym oryginale jest oceniana promptem pisanym, więc porównanie „zgubionej informacji” zestawia werdykty dwóch wariantów promptu.
10. **Dokumentacja bezwarunkowo:** `docs/agents/providers-privacy.md:7`, `docs/agents/lessons.md:5`, `docs/architecture.md` (ok. l. 488, 785, 942), komentarz `ports/ai.ts:392`; spec: `stories.yaml` (stan i `invoke_dev_with` — polecenie właściciela 2026-11-10), `SPEC.md:58`, `brownfield.md`. W opisie PR: brak wpływu na MCP/skill, bo `GraderInput` i wersje promptu nie występują w `packages/contracts` ani integracjach.

## Poza zakresem

- Zmiana promptu dla klawiatury i mowy poprawionej ręcznie.
- Migracja `lesson_verdicts`, kolumna sposobu wprowadzenia.
- Wejście przypadków mówionych do bramki zestawu (decyzja po pomiarze).
- Zadanie następcze „Skróć odpowiedź”: korzysta z tej samej ścieżki, więc dostaje ten sam znacznik; osobnych reguł nie dodajemy.
