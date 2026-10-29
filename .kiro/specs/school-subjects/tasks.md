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

Po drugim review gałęzi (subagent; 2026-10-28) — rodziny w obrębie celu,
sufiks rodzin przy dogenerowaniu, puste tablice v3, pomijanie wadliwych
zagadnień, tytuł tematu dla gradera, kategoria i precyzja w cache, `lang`
pytania szkolnego:
- `eval:school-grader`: wiedza 20/20, brakujące elementy 19/20, precyzja
  19/20, 0 odrzuconych werdyktów, `BRAMKA: OK`.
- Trzy kolejne sondy generowania (pełny materiał ×2, zagadnienia 2–3 z pulą
  30) zakończyły się `provider_timeout`: pojedyncza partia przekroczyła limit
  90 s (`UMIEM_LESSON_GENERATION_REQUEST_TIMEOUT_MS`), przy innych partiach
  14–86 s. Zapytanie do modelu (prompt i schemat) jest identyczne jak w sondzie 3
  zakończonej publikacją, więc to zmienność czasu odpowiedzi providera; logika
  po odpowiedzi modelu w tej rundzie zweryfikowana testami jednostkowymi
  i integracyjnymi, nie sondą. Timeout partii kończy run bez automatycznego
  ponowienia (zachowanie z `main`); limit wymaga decyzji operacyjnej.

Wersja modelu (2026-10-28): alias OpenRouter `deepseek/deepseek-v4.1-flash`
wskazuje na `deepseek-v4.1-flash-20260910` — wszystkie wyniki powyżej dotyczą
tej wersji. Porównanie z `deepseek/deepseek-v4.1-flash-1017` (`20261017`,
oba `UMIEM_*_MODEL` w `.env` worktree):
- `eval:school-grader` ×3: wiedza 19/20, 18/20, 19/20; jeden przebieg
  z odrzuconym werdyktem (G15) i `BRAMKA: NIE SPEŁNIONA`, dwa `BRAMKA: OK`.
- Sonda generowania przy domyślnym limicie 90 s: `provider_timeout` na
  pierwszej partii. Z limitem 240 s (tylko w sondzie): run udany, partie
  7–160 s, run 468 s, ale z 57 surowych ćwiczeń 33 odrzucone (30 × `sourceRefs`)
  i szkic niepublikowalny (luki w 6 z 8 zagadnień); 3 rachunki zgodne z kodem.
  Trzy izolowane partie dla zagadnień z odrzuceniami dały 22 ćwiczenia
  z poprawnymi cytatami, więc normalizacja uziemienia nie jest przyczyną.

Przyczyna odrzuceń `sourceRefs` (diagnoza 2026-10-28): nie złe cytaty, tylko
ich BRAK. W ok. połowie odpowiedzi model zwracał `sourceRefs: []` dla
większości ćwiczeń (np. 9 z 10), a cytaty, które podawał, były zawsze dokładne
(0 złych na ~48). Schemat structured output gałęzi zwykłych ćwiczeń nie miał
`minItems`, więc pusta tablica była legalna. Poprawka: `minItems: 1,
maxItems: 3` przy `groundingRequired` (jak w gałęzi rachunków). Ta sama
konfiguracja (`-1017`, rozumowanie wyłączone, przypięty Nebius): przed — 3 z 6
odpowiedzi z masowym brakiem cytatów; po — 6 z 6 kompletnych, 65 cytatów,
0 złych. Partia „Skala mapy” (10 ćwiczeń) po poprawce, bez przypięcia
dostawcy, po 2 przebiegi:
- `-1017`, rozumowanie domyślne (~8 tys. tokenów rozumowania): 44–48 s, 10/10 ×2.
- `-1017`, rozumowanie wyłączone (`reasoning: {enabled: false}`): 11–13 s, 11/12, 9/11.
- wersja wrześniowa, rozumowanie wyłączone: 17–19 s, 9/10 ×2.
- `z-ai/glm-5.3-flash` (rozumowania nie da się wyłączyć): 14–24 s, 1/11, 2/10 —
  wypełnia pola v3 (`questionType`, `expectedForm` itd.) także w typach
  zamkniętych, co walidacja odrzuca.

Dostawcy OpenRouter: każdy z tych modeli ma ~40 endpointów (fp4/nvfp4/mxfp4/fp8),
ale przypięcie do jednego (Nebius) nie usunęło dwubiegunowych wyników przed
poprawką schematu — główną przyczyną był schemat, nie dostawca. Endpoint
samego DeepSeek i Z.AI odpada przez ustawienie konta „Paid model training
violation” (zakaz dostawców trenujących na danych) — zostawić, bo grader
dostaje odpowiedzi dzieci. Wyłączanie rozumowania i wybór dostawcy nie są
jeszcze opcją konfiguracji adaptera (testowano parametrami tylko w sondzie).

Bezpośredni producenci (2026-10-29; po zezwoleniu na koncie OpenRouter na
endpointy trenujące na danych, przypięcie `provider.order` bez fallbacku):
- `deepseek/deepseek-v4.1-flash-1017` @DeepSeek: endpoint nie obsługuje
  `json_schema`, tylko `json_object`; w tym trybie 0/10 ×4 (brak cytatów,
  złe formaty pól) — nieużywalny z naszym adapterem.
- `openai/gpt-6-luna` @OpenAI: partia 9/10 (37 s) i raz błąd wyjścia po 240 s
  przy rozumowaniu domyślnym; bez rozumowania 9/10, 8/9 (17–20 s). Grader:
  wiedza 19/20, 18/20, `BRAMKA: OK` ×2 (72–75 s na 20 ocen).
- `google/gemini-3.8-flash` @Google AI Studio (rozumowania nie da się wyłączyć,
  `effort: low` działa): partia 10/10 ×2 (31–32 s), z `low` 10/10 ×2 (22–23 s).
  Grader: wiedza 20/20 ×2, 0 odrzuconych, `BRAMKA: OK` ×2 (83–92 s).
  Pełna sonda (`UMIEM_LLM_MODEL` nadpisany tylko w sondzie, domyślne limity):
  5 zagadnień, 60 ćwiczeń, 0 odrzuceń, 3 rachunki zgodne z kodem, szkic
  opublikowany; run 238 s, partie 37–46 s. Najlepszy wynik ze wszystkich
  testowanych modeli; cena wyjścia ok. 6× wyższa niż DeepSeek.
- Uwaga prywatności: zgoda na koncie na endpointy trenujące na danych dotyczy
  wszystkich zapytań klucza — routing bez przypięcia może wtedy trafić do
  takiego dostawcy także z odpowiedziami dzieci (grader).

Opcje pośrednika w `.env` (2026-10-29): `UMIEM_LLM_*` / `UMIEM_GRADER_*` —
`REASONING`, `PROVIDER_ORDER`, `PROVIDER_QUANTIZATIONS`,
`PROVIDER_ALLOW_FALLBACKS`, `PROVIDER_DATA_COLLECTION` (opis w `.env.example`).
Pełne sondy `deepseek/deepseek-v4.1-flash-1017` z `PROVIDER_QUANTIZATIONS=fp8`
i `PROVIDER_DATA_COLLECTION=deny`:
- Rozumowanie wyłączone, przed poprawką pustych tablic: 37/60, odrzucenia
  `noticeSegments`×22, `items`×22, `options`×14 — model zwracał `[]` w polach
  innych typów ćwiczeń, a kontrakt wymaga minimum elementów. Poprawka:
  `withoutEmptyOptionalArrays` traktuje pustą tablicę każdego opcjonalnego pola
  jak brak (prawdziwy brak, np. wybór bez opcji, nadal odrzuca walidacja typu).
- Rozumowanie wyłączone, po poprawce: run 123 s, partie 19–24 s, 58/65
  poprawnych, 6 rachunków zgodnych z kodem; 1 luka pokrycia (zagadnienie
  o kontynentach: 1/2 pytań otwartych — model wstawił tam rachunek wysokości).
- Rozumowanie domyślne: raz 55/60 i luka pokrycia (run 267 s, partia do 85 s),
  raz `provider_timeout` (partie 42–61 s, szósta ponad 90 s).
Wniosek: przy DeepSeek generator powinien działać z wyłączonym rozumowaniem;
Gemini 3.8 Flash pozostaje jedynym modelem z publikowalnym szkicem bez
odrzuceń w pełnej sondzie.

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

- [x] Dopisanie szczegółowych kontraktów DTO typów `lesson_keywords`
      i zadania „skróć odpowiedź” do `design.md` (przed kodem; akceptacja
      właściciela 2026-10-29).
- [x] Kontrakty, walidacja puli, silnik (plan sesji, ekspozycje, powiązanie
      oryginał–poprawka), edytor rodzica; migracja `0024` (modalność
      `selection`), generator (gałąź `lesson_keywords` w structured output),
      raport nadzoru `school.shortening`.
- [x] Kid UI: widoki przez wspólne komponenty; specyfikacje geometrii Playwright
      (portrait/landscape/tablet/desktop, cele ≥48 px), dopisanie speców
      do partycji w `tests/e2e/spec-projects.ts` (`lesson-precision-layout.spec.ts`,
      `AnswerGrid` z wyborem wielokrotnym, `AnswerTextArea`; bez odbioru na
      fizycznym urządzeniu).
- [x] Selektor: reguły doboru ćwiczeń trenera z wymiaru precyzji i braków
      (preferencja form zwięzłych, para słów kluczowych; pomyłka pojęć
      odłożona — design 6.5 pkt 5).

## Etap 5 — Domknięcie

- [ ] Raport kartkówki z wymiarem precyzji; przegląd API → MCP → skill
      (oczekiwany brak wpływu — odnotować w opisie PR).
- [ ] Dokumentacja: SPEC i architektura od „zaprojektowano” do stanu kodu.
- [ ] Pełny przebieg: `pnpm typecheck`, `pnpm test:unit`,
      `pnpm test:integration` (pliki lekcji), `pnpm build`,
      `pnpm test:e2e:shards`.
