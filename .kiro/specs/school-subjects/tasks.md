# Tasks — przedmioty szkolne i trener precyzji odpowiedzi

Etap 0 (specyfikacja i projekt) jest przedmiotem tego katalogu. Poniższe etapy
wykonuje się po akceptacji `design.md`, każdy jako osobny, działający przyrost.
Zależności: 1 → 2 → 3 oraz 1 → 2 → 4 → 5 (etapy 3 i 4 niezależne od siebie);
etap 2b zależy tylko od etapu 1 i może iść równolegle z etapem 2.

## Etap 1 — Przedmiot szkolny z tekstu wklejonego

- [x] Kontrakty: payload v3 i `dynamicTopic` w `packages/contracts/src/lessons.ts`;
      limit materiału dla `school` 16 000 znaków (gramatyka bez zmian)
      (+ testy schematów).
- [x] Domena: `buildDynamicTopic` i `resolveTopic` w `domain/lessons/`;
      przedmiot `subjects/school/` (kategorie, prompty, walidator, normalizator
      bazowy); wpis w rejestrze.
- [x] Walidacja puli: pokrycie `sourceRefs` cytatem z materiału, reguły rodzin
      pytań, limity elementów wymaganych (testy jednostkowe).
- [x] Generowanie: etap zagadnień + partie per cel w istniejącym runie lekcji
      (worker/`materials/lessons/`), fake provider dla testów.
- [x] Panel rodzica: formularz tworzenia (przedmiot, temat, tekst, instrukcja
      NotebookLM), edytor zagadnień/elementów/rodzin z podglądem cytatu,
      publikacja z progami pokrycia.
- [x] Walidacja etapu: test architektoniczny silnika, testy jednostkowe domeny,
      integracyjne szkiców lekcji, ręczny pilotaż na materiale właściciela
      (`pilot-material.md` w tym katalogu: geografia „Posługuję się mapą”,
      5 zagadnień, 9208 znaków; decyzja właściciela 2026-10-28: limit
      materiału dla `school` = 16 000 znaków).

## Etap 2 — Odpowiedź otwarta i ocena dwuwymiarowa

- [x] Grader: wejście/wyjście v2 w porcie i adapterze, `promptVersion`
      `school-grader-v1` (od poprawek po review: `school-grader-v2` — pełna partycja elementów), limit 600 znaków dla `school`.
- [x] Domena: `validateVerdict` 2D, mapowanie `partial → almost`, licznik zdań
      dla `one_sentence`, test „precyzja nie zmienia wiedzy”.
- [x] `lesson-attempts`: zapis wymiaru precyzji i elementów w szczegółach oceny;
      feedback z szablonów (dobre → jeden brak → popraw).
- [x] Raport rodzica: rozdzielenie wiedzy i precyzji, podgląd odpowiedzi.
- [x] Ewaluacja: harness na `grader-golden-set.json` (fake + skonfigurowany
      model); bramka: przypadki twarde 100%, zgodność wiedzy ≥90%.
- [ ] Kalibracja limitu wywołań gradera na pilotażu (limit nadal domyślny 20/sesję; kalibracja dopiero z danymi pilotażu — odhaczenie wycofane po review Etapu 2); regresja gramatyki zweryfikowana.

## Etap 2b — Zadania rachunkowe (`lesson_calculation`)

- [x] Domena: `computeCalculationAnswer` dla `scale_distance`,
      `height_difference`, `unit_conversion`; parser polskiego zapisu liczb
      i jednostek (testy jednostkowe, w tym przykłady z `pilot-material.md`).
- [x] Kontrakty i payload: pole `calculation`, warianty liczbowe w puli
      (`templateFamilyId`); walidacja przelicza odpowiedzi i odrzuca niezgodne.
- [x] Generowanie i edytor rodzica: szablony z policzonymi odpowiedziami
      (podgląd przez serwerową operację `lessons.previewCalculation`, bez
      liczenia w przeglądarce; zapis zablokowany do aktualnego podglądu).
- [x] Kid UI: widok zadania rachunkowego na istniejącym polu odpowiedzi
      (`LessonSentenceView`, `lang="pl-PL"`, bez audio); ocena deterministyczna
      w `lesson-attempts` bez gradera, także w kartkówce.

Weryfikacja Etapu 2b (2026-10-28, lokalnie): `typecheck` czysto; `test:unit`
2237/2237; `test:integration` 533 zaliczone, 2 pominięte (opcjonalny benchmark
nawigacji profili); `build` OK; `test:e2e:shards` 270/270 (mocked 156, real
114), w tym `lesson-calculation.spec.ts` (edytor + przebieg dziecka)
i `lesson-calculation-layout.spec.ts` (390×844, 844×390, 768×1024, 1280×800).
Bez odbioru na fizycznym urządzeniu.

Sondy na prawdziwych modelach z `.env` (2026-10-28, po poprawkach z review):
pełny `createSchoolLesson` → `executeLessonGeneration` na materiale
`pilot-material.md` (pula 60) i testowym PostgreSQL, z produkcyjną fabryką
`createGenerationDepsFromEnv`.
- Sonda 1 (przed poprawką etapu samodzielnego): 6 zagadnień, 59 ćwiczeń,
  3 rachunki zgodne z kodem i uziemione, ale szkic niepublikowalny — w obu
  zagadnieniach z rachunkiem rachunek zajął miejsce drugiego pytania
  otwartego. Naprawione: `poolStageCounts` przesuwa jedno miejsce
  z produktywnego do samodzielnego, gdy cel dopuszcza rachunki, a prompt
  rezerwuje pierwsze 2 miejsca samodzielne na różne pytania otwarte.
- Sonda 2: zagadnienia z rachunkami miały już po 2 różne pytania otwarte;
  szkic niepublikowalny z innego powodu — ósme zagadnienie (limit 8) dostało
  0 ćwiczeń przy 10 odrzuceniach walidacji. Przyczyny nie ustalono (logi
  workera nie zostały przechwycone); rodzic może dogenerować zagadnienie.
- Sonda 3: 5 zagadnień, 60 ćwiczeń, 0 odrzuceń, 4 rachunki zgodne z kodem,
  szkic opublikowany. Jeden rachunek wysokości trafił do zagadnienia
  o kontynentach — przypisanie celu wymaga przeglądu rodzica.
- Grader `school-grader-v2` (`eval:school-grader`): wiedza 19/20, brakujące
  elementy 19/20, 0 odrzuconych werdyktów, `BRAMKA: OK`.

## Etap 3 — Odpowiedź mówiona

- [ ] Spike: polski STT (`pl-PL`) obecnego providera na głosie dziecka; decyzja
      o adapterze zapisana w tym pliku lub w `design.md`.
- [ ] Serwer: modalność audio dla `lesson_open_answer` przedmiotu `school`
      (transkrypcja → wspólna finalizacja), „nieocenione” przy niskiej pewności.
- [ ] Kid UI: `SpeechRecordButton` w widoku odpowiedzi otwartej lekcji; raport
      rodzica rozdziela modalności.
- [ ] Walidacja: testy ścieżki audio z fake STT; jawny raport braku odbioru
      na fizycznym urządzeniu, jeśli niewykonany.

## Etap 4 — Trener precyzji

- [ ] Dopisanie szczegółowych kontraktów DTO typów `lesson_keywords`
      i zadania „skróć odpowiedź” do `design.md` (przed kodem).
- [ ] Kontrakty, walidacja puli, silnik (plan sesji, ekspozycje, powiązanie
      oryginał–poprawka), edytor rodzica.
- [ ] Kid UI: widoki przez wspólne komponenty; specyfikacje geometrii Playwright
      (portrait/landscape/tablet/desktop, cele ≥48 px), dopisanie speców
      do partycji w `tests/e2e/spec-projects.ts`.
- [ ] Selektor: reguły doboru ćwiczeń trenera z wymiaru precyzji i braków.

## Etap 5 — Domknięcie

- [ ] Raport kartkówki z wymiarem precyzji; przegląd API → MCP → skill
      (oczekiwany brak wpływu — odnotować w opisie PR).
- [ ] Dokumentacja: SPEC i architektura od „zaprojektowano” do stanu kodu.
- [ ] Pełny przebieg: `pnpm typecheck`, `pnpm test:unit`,
      `pnpm test:integration` (pliki lekcji), `pnpm build`,
      `pnpm test:e2e:shards`.
