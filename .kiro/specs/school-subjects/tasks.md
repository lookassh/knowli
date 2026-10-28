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

- [ ] Domena: `computeCalculationAnswer` dla `scale_distance`,
      `height_difference`, `unit_conversion`; parser polskiego zapisu liczb
      i jednostek (testy jednostkowe, w tym przykłady z `pilot-material.md`).
- [ ] Kontrakty i payload: pole `calculation`, warianty liczbowe w puli
      (`templateFamilyId`); walidacja przelicza odpowiedzi i odrzuca niezgodne.
- [ ] Generowanie i edytor rodzica: szablony z policzonymi odpowiedziami.
- [ ] Kid UI: widok zadania rachunkowego na istniejącym polu odpowiedzi;
      ocena deterministyczna w `lesson-attempts` bez gradera.

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
