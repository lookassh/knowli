# Głębokie review generowania lekcji — Present Simple

Data: 2026-10-14. Snapshot: `e079c6cdcb309b61d078e03a35f80cf165c7abbe`. Zakres historyczny: `8b01cad..e079c6c` — silnik lekcji i późniejsze poprawki generacji (#51–#56), ocenione w aktualnej całości. Coolify potwierdził ostatnie zakończone wdrożenie tego samego SHA. Odczyt logów przez dostępne MCP zwrócił tylko proces web.

Generacja wymaga poprawek. Podejrzenie dotyczące promptu jest trafne: zawiera sprzeczne wymagania, a structured output gwarantuje znacznie mniej niż zakłada dalsza walidacja. Osobne problemy workera powiększają czas i liczbę ponowień. Nie ustalono częstości poszczególnych błędów ani rzeczywistego czasu produkcyjnego LLM.

Review obejmuje specyfikację gramatyki, prompt i żądanie HTTP, schemat odpowiedzi, konwersję i walidację, worker, ponowienia, zapis szkicu, dogenerowanie, edytor oraz warunki publikacji i przygotowanie audio. Analiza koordynatora została uzupełniona niezależnym review przez dedykowanego recenzenta `gpt-6.1-sol`, `xhigh`. Uwagi recenzenta dotyczące utraty treści, duplikatów i opcji zostały ponownie odtworzone przez koordynatora. Kod aplikacji nie został zmieniony.

**Checklista wykonania**

- [x] Aktualny Git, zakres i instrukcje repozytorium; czysty checkout przed review.
- [x] `using-superpowers`, `systematic-debugging`, `requesting-code-review`; techniczna weryfikacja otrzymanych uwag według `receiving-code-review`.
- [x] SPEC, architektura, granice pakietów, początkowy schemat i plan oraz `.kiro/specs/grammar-module` i autorytatywny kod kontraktów.
- [x] Porównanie structured output z aktualną oficjalną dokumentacją przez `openai-docs`.
- [x] Reprodukcje czystej domeny i adaptera oraz reprodukcje z izolowanym PostgreSQL 17 i fikcyjnymi danymi.
- [x] Wybrane istniejące testy i aktualna weryfikacja wyników według `verification-before-completion`.
- [x] Niezależne review, klasyfikacja uwag i zapis ograniczeń.
- [ ] Benchmark aktualnego produkcyjnego modelu i korelacja z logami workera — dowody niedostępne w tym przebiegu; brak rzeczywistych wywołań LLM.

**1. P1 — globalna unikalność odpowiedzi odrzuca potrzebne, poprawne zadania**

Źródła: `packages/server/src/providers/openai/llm.ts:92`, `packages/server/src/domain/lessons/pool-validation.ts:522`, `packages/server/src/modules/lessons/lesson-drafts.ts:519`.

Deduplicacja porównuje samą znormalizowaną odpowiedź, bez zdania, typu i celu. Poprawne pytanie `___ she read books?` i krótka odpowiedź `Yes, he ___.` mają odpowiedź `does`, więc drugie ćwiczenie odpada. Cele question/negative poprzedzają short_answers w katalogu, a kolejne partie otrzymują zakaz wykorzystania ich odpowiedzi.

Reprodukcja: osiem indywidualnie poprawnych luk z odpowiedziami do/does/don't/doesn't w question, negative i short_answers → cztery zachowane, cztery odrzucone; wszystkie ćwiczenia produktywne short_answers z tej próbki tracą pokrycie. Jedna wybrana reguła domyślnie żąda 60 zadań, w tym 27 produktywnych. Short_answers ma na tym etapie wyłącznie lesson_gap; wymuszenie tylu różnych odpowiedzi przy naturalnych lukach operatora jest źle dopasowane do materiału. Wskazówka „vary full-sentence answers” konkuruje z limitem trzech słów odpowiedzi luki i jej walidacją.

To konflikt obecnej polityki projektowej z poprawnym materiałem, a nie tylko model łamiący prompt. Kierunek: ustalić deduplicację całych ćwiczeń i zasady powtarzania krótkich odpowiedzi dla etapów wspieranych. Zachować ochronę samodzielności i rejestr ekspozycji; zmiany tej semantyki wymagają projektu przed implementacją.

**2. P1 — prompt wymusza angielski bodziec w zadaniu tłumaczenia z polskiego**

Źródła: `packages/server/src/providers/openai/llm.ts:122`, `packages/server/src/modules/lessons/lesson-materialize.ts:235`; wymaganie 4.1 i 3.4 modułu gramatyki.

Reguła językowa wymaga answerLocale dla każdego pola poza instructionPl, w tym prompt. Nie opisuje wyjątku lesson_open_answer dla tłumaczenia PL→EN. Model może wykonać instrukcję i zwrócić angielski tekst równy rozwiązaniu.

Reprodukcja: instructionPl=`Przetłumacz na angielski.`, prompt i answer=`She plays football every day.` → brak błędów domeny; Kid DTO pokazuje angielską odpowiedź jako bodziec. Dla open_answer materializacja nie zapisuje tego jako ujawnienie odpowiedzi. Może to podważyć znaczenie samodzielnego sprawdzenia po publikacji materiału.

Kierunek: w profilu przedmiotu jawnie określić język i znaczenie bodźca dla każdego typu, pokazać poprawny przykład tłumaczenia i dodać znaczącą regresję generation→materialization.

**3. P1 — brak kontrolowanego deadline'u blokuje cały proces wykonawczy**

Źródła: `packages/server/src/modules/lessons/lesson-drafts.ts:520`, `packages/server/src/providers/openai/llm.ts:344`, `packages/server/src/modules/generation.ts:568`, `apps/worker/src/main.ts:28`.

Port przyjmuje AbortSignal, lecz executeLessonGeneration go nie przekazuje, a adapter nie zakłada własnego timeoutu. Poller czeka na zakończenie całego runu, zanim wykona kolejną lekcję i media. Ręczny retry odcina spóźniony zapis, ale nie przerywa HTTP ani kolejnych partii starego wykonania. Health endpoint zwraca 200 bez oceny wieku lastPassAt.

Dowód: przechwycenie wszystkich argumentów trzech syntetycznych wywołań wykazało brak sygnału; analiza pętli potwierdza sekwencyjne oczekiwanie. Reprodukcja retry zatrzymanego pierwszego celu wykazała, że po zwolnieniu wywołania stary worker nadal generuje pozostałe dwa cele. Nie zmierzono czasu, po którym rzeczywisty transport sam przerwie wiszące żądanie.

Kierunek: konfigurowalny deadline partii i całego runu, sygnał anulowania oraz sprawdzenie aktualności wykonania między partiami. Health powinien odróżniać działający proces od zatrzymanej pętli.

**4. P1 — stary formularz może usunąć świeżo dogenerowaną treść**

Źródła: `packages/server/src/modules/lessons/lesson-drafts.ts:628`, `packages/server/src/modules/lessons/lesson-api.ts:426`.

Worker zapisuje ćwiczenia i przykłady bez podbicia editNumber. PATCH edytora zastępuje pełną listę; stara migawka nadal spełnia optimistic locking. Jest to osiągalne podczas edycji w trakcie generacji lub z drugiej przeglądarki.

Reprodukcja PostgreSQL: przed generacją editNumber=1; po top-up nadal 1, odpowiedzi [plays,runs]; zapis starego formularza zostaje zaakceptowany i pozostawia [plays]. Kierunek: każda zmiana treści przez worker musi aktualizować numer edycji atomowo; równocześnie ustalić sposób rozliczania innych runów przypiętych do starej edycji.

**5. P2 — dwa top-upy zapisują duplikaty mimo blokady finalizacji**

Źródła: `packages/server/src/modules/lessons/lesson-drafts.ts:565`, `packages/server/src/modules/lessons/lesson-drafts.ts:697`, `apps/web/src/parent/lessons/LessonEditor.tsx:292`.

existingAnswers jest migawką z chwili enqueue. Po uzyskaniu blokady finalizacja nie porównuje odpowiedzi z aktualną pulą. Edytor umożliwia kolejne zlecenie po zakończeniu POST, bez oczekiwania na koniec generacji.

Reprodukcja PostgreSQL: dwa runy zlecone przed wykonaniem pierwszego, potem wykonane sekwencyjnie → [plays,runs,runs], oba succeeded. Publikacja później odrzuca duplikaty. Kierunek: walidacja wobec bieżącej treści pod blokadą i spójna polityka równoległych zleceń; sam disabled w UI nie zabezpieczy API.

**6. P2 — pojedynczy null wywraca całą poprawną partię przed strażnikiem kształtu**

Źródło: `packages/server/src/modules/lessons/lesson-drafts.ts:523`.

Zbieranie wcześniejszych odpowiedzi dereferencjonuje raw.answer przed isWellShapedRawExercise. Dla providerów nieegzekwujących schematu lub wadliwego portu zapis exercises=[poprawne ćwiczenie,null] daje `Cannot read properties of null (reading 'answer')`, klasyfikację provider i ponowienie całego runu.

Reprodukcja PostgreSQL: state=queued i zero zapisanych ćwiczeń. Kierunek: bezpiecznie rozpoznawać rekord przed dereferencją oraz walidować obwiednię odpowiedzi. Poprawne rekordy powinny przetrwać pojedynczą wadę.

**7. P2 — strict schema dopuszcza typy i cele niezgodne z konkretną partią**

Źródła: `packages/server/src/providers/openai/llm.ts:211`, `packages/server/src/providers/openai/llm.ts:212`, `packages/server/src/modules/lessons/lesson-drafts.ts:559`.

Każda partia dotyczy jednego celu, lecz enum zawiera typy całego przedmiotu, a objectiveId jest dowolnym stringiem. Np. przy third_person_s schema dopuszcza lesson_transform, chociaż lista celu tego zabrania. Required niepuste bodźce właściwe typowi, ograniczenia długości i liczności pozostają jedynie instrukcją promptu/domeny. Strict zapewnia zgodność z tym luźnym schematem; nadal pozwala na wiele wyników odrzuconych później.

Reprodukcja przechwyciła pełny request: osiem typów puli w enum, piętnaście wymaganych pól każdego ćwiczenia, objectiveId bez enum. Walidator odrzucił dopuszczony schematem lesson_transform dla third_person_s. Kierunek: zawęzić cel i typy do partii, użyć kształtów zależnych od typu oraz obsługiwanych przez danego providera ograniczeń. Zwalidować także, że otrzymany cel należy do zleconej partii. Utrzymać walidację domenową.

**8. P2 — trwałe błędy HTTP oraz niepełne odpowiedzi trafiają do jednego ślepego retry**

Źródła: `packages/server/src/providers/openai/llm.ts:346`, `packages/server/src/providers/openai/llm.ts:349`, `packages/server/src/modules/generation.ts:102`, `packages/server/src/modules/lessons/lesson-drafts.ts:536`.

Adapter zamienia HTTP 400/401/403/429/5xx na zwykły Error; errorCodeOf rozpoznaje tylko validation albo provider. Brak odrębnej obsługi refusal, finish_reason i limitu generowanych tokenów. JSON.parse nie odzyskuje fenced JSON od zgodnego tylko częściowo endpointu. Błędy parsowania również stają się retry bez zmiany żądania.

Reprodukcje: syntetyczny HTTP 400 o nieobsługiwanym json_schema → trzy identyczne requesty → failed/attempts_exhausted; refusal → komunikat „returned no content”; finish_reason=length z parsowalnym JSON → wynik przyjęty bez wykrycia niepełności; fenced JSON → SyntaxError. Nie oznacza to, że produkcyjny provider nie wspiera json_schema — jego aktualnej zgodności nie sprawdzono.

Kierunek: typowane błędy, terminalna obsługa błędów konfiguracji, ograniczone retry z backoff/Retry-After dla błędów przejściowych, jawne rozliczenie niepełnej odpowiedzi. Ewentualny tryb zgodności musi być świadomie skonfigurowany i testowany dla danego endpointu.

**9. P2 — opcje mogą mieć sprzeczny lub losowy klucz odpowiedzi**

Źródła: `packages/server/src/domain/lessons/pool-validation.ts:276`, `packages/server/src/modules/lessons/lesson-materialize.ts:180`.

Walidacja wymaga różnych tekstów opcji, lecz nie różnych ID ani zgodności tekstu poprawnej opcji z answer. Reprodukcja: answer=plays, a=play, b=plays, correctOption=a przechodzi. Drugi przykład ma oba ID=same: walidacja przechodzi, a tasowanie dla dziesięciu ziaren wskazuje jako poprawne naprzemiennie play i plays.

Kierunek: unikalne ID, dokładnie jedna wskazana opcja i zgodność jej treści z odpowiedzią kanoniczną. Należy uwzględnić odpowiedź kanoniczną w feedbacku i TTS.

**10. P2 — poprawna luka przeczenia odpada tylko dlatego, że posiada hint**

Źródło: `packages/server/src/domain/lessons/subjects/english-grammar/validators.ts:70`.

stem=`She ___ play tennis.`, answer=`does not`, hint=`do` zostaje odrzucone. Bez hint ten sam rekord przechodzi. Walidator wymaga czasownika głównego po operatorze, mimo że w tym ćwiczeniu czasownik główny jest już w stem. Analogicznie dotyczy doesn't. Kierunek: rozróżnić rolę uzupełnianego fragmentu i walidować całe ćwiczenie w module przedmiotu; dopasować przykłady promptu do reguł walidatora.

**11. P2 — błąd późnej partii niszczy wcześniejszą pracę i mnoży czas ponowień**

Źródło: `packages/server/src/modules/lessons/lesson-drafts.ts:509` i `packages/server/src/modules/lessons/lesson-drafts.ts:536`.

Wyniki są wyłącznie w pamięci do ukończenia wszystkich celów. Reprodukcja z trzema celami i błędem ostatniego: zero zapisanych ćwiczeń, po dwóch próbach kolejność wywołań [A,B,C,A,B,C]. Przy siedmiu celach i trzech próbach możliwe jest 21 wywołań generujących, mimo że zawodzi jeden cel. Zakaz publikacji częściowej lekcji nie wymaga usuwania poprawnych wyników z nieopublikowanego szkicu.

Kierunek: trwałe wyniki/checkpointy partii, niezależna walidacja i ponawianie brakujących partii. Projekt powinien zachować fencing, ochronę edycji i niezmienność treści opublikowanej.

**Co wydłuża oczekiwanie**

- Domyślne siedem celów daje pulę 84 ćwiczeń i siedem kolejnych requestów. Przejście do następnego celu czeka na pełną odpowiedź poprzedniego. Kontrolowany eksperyment trzech wywołań z opóźnieniem 40 ms każde trwał około 150 ms; maksymalna liczba aktywnych wywołań wyniosła 1. To pomiar syntetyczny, nie benchmark modelu.
- Schemat wymaga wszystkich piętnastu pól także wtedy, gdy większość nie dotyczy typu i ma null. Przykładowy request miał 5885 znaków promptu systemowego i 1685 znaków schematu; nie oszacowano z tego produkcyjnej liczby tokenów. Kształty zależne od typu mogą ograniczyć ilość generowanego JSON i niejednoznaczność.
- Publikacja wymaga gotowego target_audio, gdy skonfigurowane media i przedmiot tego wymagają (`lesson-api.ts:609`). Nowa pula bez cache może zlecić do 84 zasobów audio. `runDueGenerationWork` wykonuje domyślnie dwa TTS na przelot, każdy kolejno, po generacjach lekcji. UI może czekać na audio jeszcze po succeeded tekstu. Nie zmierzono czasu TTS.
- Obecne logi nie zawierają czasu/usage/statusu HTTP każdej partii. Brakuje dowodu pozwalającego rozdzielić oczekiwanie w kolejce, generowanie JSON, ponowienia i przygotowanie audio.

Kierunek optymalizacji: najpierw usunąć sprzeczności i niepotrzebne powtórzenia; potem mierzyć duration/usage i wprowadzić ograniczoną współbieżność LLM/TTS z poszanowaniem rate limitów i checkpointów. Prompt musi przestać zależeć od kompletnego, surowego wyniku poprzedniej partii, zanim cele będzie można bezpiecznie uruchamiać równolegle.

**Ograniczenia i hipotezy odłożone**

Automatyczne wznowienie runu w running po restarcie nie jest zaimplementowane; potwierdzono running→running i zero wywołań dla danego runu. `docs/architecture.md:417` opisuje ten wybór jako jawne ponowienie rodzica. Traktujemy to jako udokumentowane ograniczenie wyjaśniające „utkniętą generację”, a nie nowy błąd niezgodności.

Dozwolona pula 20 przy siedmiu celach nie zapewnia minimalnego pokrycia publikacji 3+4+2 na cel. Idealny fake wygenerował 21 poprawnych rekordów, run był succeeded, lecz wszystkie 21 par cel–etap miało braki. Jest to napięcie obecnych wymagań zakresu 20–120 i publikacyjnych minimów; warto pokazać wykonalność w formularzu oraz dogenerować konkretny brakujący etap zamiast kolejnego rozkładu ogólnego. Sam status succeeded oznacza ukończenie generacji szkicu, nie gotowość publikacji.

Nie zgłaszamy ogólnego parsera angielskiej gramatyki jako brakującej obowiązkowej funkcji. Przykłady `She … play` lub błędnego acceptedAnswers mogą przejść walidację; za merytoryczne zatwierdzenie odpowiada rodzic. Szczegółowe, deterministyczne relacje opcji i typów pozostają jednak wymaganiami wykonawczymi.

Nie znaleziono oczywistego naruszenia podstawowych wymogów OpenAI strict w budowie schematu: required zawiera wszystkie pola obiektów, additionalProperties=false, pola opcjonalne są nullable. Brak live contract-test nie pozwala potwierdzić zgodności aktualnego alternatywnego endpointu/modelu. Oficjalna dokumentacja wymaga obsługi refusal i niepełnej odpowiedzi: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Ograniczenie generowanych tokenów jest uzasadnionym kierunkiem optymalizacji, ale wielkość efektu trzeba zmierzyć: [Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization).

Nie sprawdzano ponownie całego modułu oceniania odpowiedzi dziecka, STT ani pronunciation; weryfikowano ich związki z generowanym materiałem. Nie uruchamiano rzeczywistego LLM/TTS, pełnego E2E, całej regresji, build ani typecheck. Nie zmieniono API, MCP ani skilla Hermesa; review nie wprowadza kontraktu i nie wymaga wdrożenia. Ewentualna poprawka semantyki samodzielności wymaga ponownej oceny wpływu zgodnie z AGENTS.md.

**Wykonane sprawdzenia**

Instalacja: domyślny pnpm zgłosił mismatch konfiguracji overrides/lockfile. Użyto przypiętej w repo wersji `npx --yes pnpm@10.34.6 install --frozen-lockfile`, bez zmiany lockfile.

```text
npx --yes pnpm@10.34.6 exec vitest run --config vitest.unit.config.ts \
  packages/server/src/providers/openai/llm.test.ts \
  packages/server/src/domain/lessons/pool-validation.test.ts \
  packages/server/src/domain/lessons/subjects/english-grammar/module.test.ts \
  packages/server/src/modules/lessons/lesson-drafts.test.ts
4 pliki, 84 testy: PASS

UMIEM_TEST_RUN_ID=generation-review-de40
npx --yes pnpm@10.34.6 exec vitest run --config vitest.integration.config.ts \
  tests/integration/lesson-generation.test.ts tests/integration/lesson-shape.test.ts
2 pliki, 27 testów, PostgreSQL: PASS
```

Oddzielne reprodukcje poza repo, wszystkie zakończone exit 0 z asercjami:

- `C:/Users/looka/AppData/Local/Temp/knowli-generation-pure-review-de40.ts` — prompt/schema, błędny bodziec tłumaczenia, globalna deduplicacja, finish_reason/refusal/markdown, hint i opcje.
- `C:/Users/looka/AppData/Local/Temp/knowli-generation-pipeline-review-de40.ts` — HTTP 400, null, sekwencyjny czas, niepublikowalna mała pula i brak automatycznego recovery.
- `C:/Users/looka/AppData/Local/Temp/knowli-lesson-generation-review.ts` — utrata top-up przez stary PATCH, duplikaty top-up, ponowienie wszystkich partii i dalsze wywołania starego wykonania po retry; wykonane przez recenzenta oraz ponownie przez koordynatora na osobnych bazach.
- `C:/Users/looka/AppData/Local/Temp/knowli-lesson-generation-restart-review.ts` — udokumentowany brak automatycznego odzyskania running po zamknięciu i ponownym otwarciu połączenia.

Testy istniejące są zielone, ale nie pokrywają wymienionych scenariuszy. Aktualna weryfikacja dotyczy review i odtworzenia usterek; nie oznacza naprawy. Zakres pozostaje lokalnym raportem bez commita, push i PR.
