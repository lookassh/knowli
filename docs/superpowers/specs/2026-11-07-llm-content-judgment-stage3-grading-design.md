# Etap 3: ocena odpowiedzi dziecka w lekcjach — design

Wersja 2, 2026-11-07, po przeglądzie trzech krytyków (prostota, poprawność danych, sprawiedliwość oceny). Zatwierdzona przez właściciela 2026-11-07 („tak na 1–3”): progi §12, odstępstwo §6 (bez `usesTargetForm` w DTO rodzica) i płatny przebieg próbek z limitem 0,20 USD. Issue #360, epik #358. Spec zbiorczy: `2026-11-07-llm-content-judgment-design.md` w wersji 4 (§6, §7, §12.3, §13, §16). Stan kodu: `origin/main` c1e0620b.

Ten dokument przekłada §6–§7 specu zbiorczego na konkretne zmiany w kodzie. Nie dodaje nowych zasad: tam, gdzie spec zbiorczy coś rozstrzyga, ten dokument tylko wskazuje miejsce w kodzie. Kryterium prostoty (§10 zbiorczego) obowiązuje: każda zmiana ma albo usuwać kod rozumiejący język, albo realizować wynik „bez ćwiczonej formy” i rozsypankę przez model. Jedno świadome odstępstwo od specu zbiorczego, do zatwierdzenia przez właściciela, opisuje §6 (flaga w DTO rodzica).

## 1. Zakres i granice

**Moduł:** `learning/lessons` (ocena prób) i `domain/lessons/evaluate.ts` (czyste funkcje dopasowania i mapowania werdyktu). Do tego adapter gradera (`providers/openai-compatible/grader.ts`) i fake grader, rola oceniającego gramatyki (`subjects/english-grammar/prompts.ts`), nadzór rodzica (`materials/lessons/lesson-supervision.ts`), walidacja wariantów i focus (`domain/lessons/pool-validation.ts`), konfiguracja (`config.ts`, `config-defaults.ts`) i migracja `lesson_verdicts`.

**Zależności:** bez nowych pakietów i bez nowych kierunków między obszarami. `learning` korzysta z `materials` przez barrel jak dziś (`lessonGraderInput`).

**Granica transakcji:** bez zmian. Faza 1 (dopasowanie, cache, rezerwacja wywołania) i faza 2 (zapis werdyktu do cache `ON CONFLICT DO NOTHING`, ocena, projekcja, ekspozycje, stan zadania) zostają dwiema transakcjami pod blokadą sesji; wywołanie modelu poza transakcją. Rozsypanka wchodzi do tej samej ścieżki.

**Poza zakresem** (jak w issue): przebieg generowania (etapy 2, 4, 5), usuwanie heurystyk generowania, ocena słówek, samodzielność po awarii gradera, podział walidatorów ręcznej edycji szkicu. Przyjęcie i ślepe rozwiązanie agenta (`agent/admission.ts`, `agent/solver.ts`) porównują dalej z rozwijaniem skrótów, więc jedynym źródłem wariantów ze skrótem w nowych lekcjach jest zmieniony dopisek promptu (§4); agent znika w etapach 4–5.

## 2. Dopasowanie i klucz cache na neutralnej normalizacji

Dziś `lesson-attempts.ts` bierze normalizator przedmiotu (`normalizerFor`) do trzech rzeczy: `matchLessonAnswer`, `closestApprovedVariant` i `normalizedAnswerKey`. Dla angielskiego to `englishNormalizer`, który rozwija skróty po obu stronach.

**Zmiana:** wszystkie trzy używają neutralnej normalizacji (`normalizeTokens` z `domain/lessons/normalize.ts`): NFC, apostrofy, wielkość liter, interpunkcja, spacje. `normalizerFor` znika. `englishNormalizer`, `contractions.ts` i `SubjectModule.normalizer` zostają bez zmian (słówka, ujawnienia, duplikaty między ćwiczeniami i opcjami, `lesson_notice` w materializacji).

Parametr `normalizer` w `matchLessonAnswer` i `closestApprovedVariant` znika — obie funkcje wołają `normalizeTokens` bezpośrednio. Silnik zostaje niezależny od przedmiotu, a testy przestają podawać normalizator.

**Klucz cache:** `normalizeTokens(text).join(" ")`; pusta lista tokenów → dotychczasowa rezerwa `text.trim().toLowerCase()`. Różnice w pisowni i skrótach dają różne klucze, więc „Yes, she's.” i „Yes, she is.” nie dzielą werdyktu.

**Szkoła** ma już `baseNormalizer` (`subjects/school/module.ts`), więc jej klucze i dopasowania się nie zmieniają.

**Skutki dla istniejących danych** (§13 zbiorczego): opublikowane rewizje nie mają wariantów ze skrótem (dawne porównanie je usuwało), więc odpowiedź ze skrótem wobec klucza bez skrótu idzie teraz do modelu. Werdykty starego promptu nie są czytane (nowa wersja promptu, §5), więc zmiana klucza cache nie wymaga przeliczenia wierszy.

## 3. Literówka tylko przy dosłownym `focus`

Reguła w `matchLessonAnswer` (krok 3, `minor_typo`) dostaje jeden warunek per wariant: tolerancja działa wobec wariantu tylko wtedy, gdy tokeny `focus` po neutralnej normalizacji tworzą ciągłą podsekwencję tokenów tego wariantu. Inaczej wobec tego wariantu tolerancji nie ma (istniejąca reguła „pusty focus = bez tolerancji”). Tokeny chronione to tokeny `focus` po neutralnej normalizacji.

Przykład ze specu: stara rewizja z kluczem „She doesn't like tea.” i focus `["does", "not"]`. Tokeny `does not` nie występują w `she doesn't like tea`, więc „She don't like tea.” nie jest literówką (dziś jest: OSA(doesn't, don't) = 2 mieści się w progu) i idzie do modelu.

Tolerancja nie wchodzi do klucza cache (klucz to sama neutralna normalizacja). Literówka w słowie spoza focus dalej zalicza bez modelu — także gdy to słowo należy do ćwiczonej formy, a autor ćwiczenia nie wpisał go do focus (istniejące zachowanie; np. focus `doesn't` przy kluczu „She doesn't like tea.” zalicza „She doesn't likes tea.”). Focus wyznacza autor ćwiczenia, kod tego nie zgaduje.

**Walidacja focus przy generowaniu** (`validateFocus` → `focusCoversAnswer`) też przechodzi na neutralną normalizację (§18 zbiorczego: warianty i focus na tej samej normalizacji). Dziś rozwijanie skrótów przepuszcza focus „does not” przy kluczu „doesn't”, który po tej zmianie tracił po cichu tolerancję literówek; teraz agent dostaje odrzucenie z istniejącą regułą i poprawia focus. To jedna zmiana argumentu.

## 4. Warianty na neutralnej normalizacji

Trzy miejsca porównują wariant z kluczem przez `answersEquivalent(…, subject.normalizer)`:

- `validateAcceptedAnswers` (reguła `variants.duplicate`) w `pool-validation.ts`,
- `withoutRedundantAcceptedVariants` (przyjęcie puli w `lesson-pool-acceptance.ts`, zapis i publikacja szkicu w `lesson-api.ts`),
- „uznaj jako wariant” (`acceptVerdictAsVariant` w `lesson-supervision.ts`).

**Zmiana:** wszystkie trzy porównują przez `baseNormalizer`. Wariant „She isn't at home.” przy kluczu „She is not at home.” zostaje. Duplikat dosłowny (po neutralnej normalizacji) dalej jest odrzucany albo porzucany.

**Prompt agenta:** `CONTRACTIONS_NOTE` w `english-grammar/agent-policy.ts` i `english-chapter/agent-policy.ts` zmienia się na: „Write contracted and full forms as separate accepted answers: doesn't and does not are different variants.” Migawki promptu agenta aktualizujemy. Opis reguły `listen.options_equivalent` („doesn't and does not count as the same”) zostaje — to porównanie opcji, gdzie rozwijanie zostaje (§6 zbiorczego).

## 5. Model oceniający: prompt `grader-v2` i `usesTargetForm`

**Nowa wersja promptu lekcji:** `PROMPT_VERSION = "grader-v2"` w adapterze (nowy klucz cache). Prompt szkolny `school-grader-v3` bez zmian (§6 zbiorczego: ocena szkolna bez zmian). Fake grader: `fake-grader-v2`.

Zmiany w prompcie systemowym (`systemPrompt`):

1. Definicja poprawności: „The answer is correct when it does what the instruction asks, in the context the child saw. Leaving out a form the instruction requires (for example repeating the sentence to transform without changing it, or a full form when the instruction asks for a contraction) is incorrect; use the objective's error category for it.”
2. Nowe pole: „`usesTargetForm` is true when the answer uses the form practised by the learning objective, false when it is a correct answer in another form that the instruction and context also allow. Contracted and full forms (doesn't / does not) and British and American spellings are the same form unless the instruction asks for one of them. When the objective practises no grammatical form, set true.”
3. Kształt JSON: `{"verdict", "errorCategory", "fragments", "note", "usesTargetForm": boolean}`.
4. Dla rozsypanki jedna dodatkowa linia, tylko gdy wejście ją niesie (§7).

**Rola oceniającego gramatyki** (`english-grammar/prompts.ts`, `gradingRole`) zaczyna się dziś od „You grade ONLY whether the child correctly applied the given grammar rule”, co stoi przed definicją poprawności i jej przeczy (model oceniłby „She is reading a book.” w lekcji Present Simple jako błąd czasu). Pierwsze zdanie zmienia się na: „You grade whether the answer correctly does what the instruction asks; usesTargetForm says separately whether it uses the given grammar rule.” Reszta roli bez zmian. Rozdział: jego `almostDefinition` każe dawać „almost” za poprawny synonim spoza rozdziału; pod `grader-v2` taki synonim może wrócić z `usesTargetForm: false`, czyli bez sukcesu celu zamiast z sukcesem — świadomie, bo słowo z rozdziału nie zostało użyte.

**Walidacja** (`validateVerdict`): `usesTargetForm: z.boolean()` wymagane. Brak pola albo zły typ → werdykt odrzucony → nieocenione bez kary (jak każdy wadliwy werdykt). `GraderVerdict` dostaje pole `usesTargetForm: boolean`. Fake grader (domyślny werdykt i routing po słowach kluczowych) zwraca `usesTargetForm: true`; zaprogramowane surowe werdykty w testach dostają to pole.

**Mapowanie** (`gradeFromVerdict`), nowa gałąź przed dotychczasowym zaliczeniem:

| Werdykt | `usesTargetForm` | Ocena |
|---|---|---|
| `correct` | `true` | `model_correct` (bez zmian) |
| `correct` | `false` | **`model_off_target`**: `unevaluated`, bez powodu |
| `almost` + kategoria `null`/`other` | `true` | `model_almost`, sukces (bez zmian) |
| `almost` + kategoria `null`/`other` | `false` | **`model_off_target`** |
| `almost`/`incorrect` z kategorią celu | dowolne | `model_incorrect` (bez zmian) |
| `incorrect` + `other` | dowolne | `model_other` (bez zmian) |

`ObjectiveGrade.verdict` dostaje wartość `model_off_target`; trafia do `assessments.details.verdict`, więc wyzwalacz z §8 zbiorczego liczy ręczne zapytanie po tej wartości.

**Cache:** migracja dodaje do `lesson_verdicts` kolumnę `uses_target_form boolean null` (null = wiersze sprzed migracji i werdykty szkolne). Faza 2 zapisuje ją razem z werdyktem; `verdictFromCacheRow` ją czyta, więc trafienie w cache daje ten sam wynik co żywe wywołanie.

**Decyzja rodzica** (pod `grader-v2`) ma pierwszeństwo: `overridden_correct` → `correct` z `usesTargetForm: true` (sukces celu), `overridden_incorrect` → błąd jak dziś. Działa na kolejne identyczne odpowiedzi, nie przepisuje zakończonych ocen ani projekcji.

## 6. Wynik „bez ćwiczonej formy”

**Stan zadania:** `nextLessonTaskState` dostaje ocenę zamiast samego `outcome`. Nowa gałąź: `verdict === "model_off_target"` → `answered` (zadanie zamknięte, bez ponowienia). Pozostałe przejścia bez zmian.

**Ocena i postęp:** `outcome = unassessed`, `confirmation_eligible = false` (istniejący CHECK), bez projekcji celu (jak każde nieocenione). Seria i postęp się nie zmieniają.

**Feedback dziecka:** istniejący rodzaj `lesson_precision_hint` (tytuł „Świetnie!”, ton sukcesu, jedna linia podpowiedzi) z `hintPl` z nowego komunikatu `messages.kid.lessonPracticedForm`: „To też dobrze! W tej lekcji ćwiczymy tak: {text}”, gdzie `{text}` to najbliższy zatwierdzony wariant (forma ćwiczona). Bez nowego rodzaju feedbacku, bez zmian schematu Kid DTO i bez zmian w Kid UI poza komentarzami. Ekspozycja `target_key` zapisuje się przed wysłaniem — `revealsAnswer` zwraca `true` dla tego rodzaju. Nagranie zdania i wyjaśnienie ćwiczenia nie są doklejane (istniejące reguły dla `lesson_precision_hint` i dla wyniku innego niż błąd). Oferta skrócenia (trener precyzji) nie powstaje — dotyczy tylko szkolnej odpowiedzi otwartej z `great`.

**Rodzic:** komentarz modelu (`note`) w istniejącym miejscu panelu werdyktów, bez osobnego oznaczenia w UI.

**Odstępstwo do zatwierdzenia:** spec zbiorczy mówi „flaga trafia do DTO rodzica”. Bez oznaczenia w UI pole `usesTargetForm` w `LessonVerdictDto` nie ma czytelnika, a dodaje zmianę kontraktu i testów. Proponujemy go nie dodawać: flaga żyje w cache (`uses_target_form`) i w szczegółach oceny (`model_off_target`), rodzic widzi komentarz modelu. Kid DTO, MCP i `learning-overview` bez zmian w obu wariantach.

**Kartkówka:** odpowiedź „bez ćwiczonej formy” liczy się w raporcie jako nieoceniona (istniejąca reguła dla nieznanych werdyktów), bez punktu i bez kary.

## 7. Rozsypanka przez model oceniający

Dziś `gradeLessonAnswer` ocenia `sequence` przez `evaluateSequence`: zgodność z kluczem → `closed_correct`, inaczej `closed_incorrect`.

**Zmiana:**

- odpowiedź, która nie jest permutacją wydanych klocków, odrzuca przyjęcie próby błędem walidacji (400), jak przypisania o złym kształcie — UI składa odpowiedź tylko z wydanych klocków, więc to błąd klienta, a nie wiedzy;
- zgodność z kluczem (z zamiennością identycznych klocków, #298) → `closed_correct`, bez zmian;
- inna permutacja → wynik `unavailable` w fazie 1, czyli ta sama eskalacja co dla tekstu: cache → model → nieocenione.

`needsModel` obejmuje `text` (poza rachunkami) i `sequence`. Miejsca w fazach 1 i 2 przywiązane dziś do tekstu biorą modalność i odpowiedź z próby: typ i zapis odpowiedzi w `reserveProcessingAttempt` (`{ itemIds }` zamiast `textAnswerOf`), `nextLessonTaskState` w `finalizeGradedAttempt`, `modality` w zwracanym DTO, tekst odpowiedzi do `buildGraderInput`.

**Wejście gradera dla rozsypanki:** `childAnswer` = teksty klocków w kolejności dziecka złączone spacją, `acceptedAnswers` = tylko klucz ułożony z klocków (`correctTextFor`; `acceptedAnswers` rozsypanki nie są używane w ocenie), `instruction` = polecenie, `stimulus` = null. `GraderInput` dostaje opcjonalne pole `blocks?: readonly string[]` (klocki w kolejności dziecka); przy nim prompt dodaje linię: „The child did not type: they put the given blocks in this order. Judge whether this order is a correct answer to the instruction; another correct order is correct. For an arranged order there is no 'almost': it is either correct or incorrect.” Dozwolone kategorie werdyktu rozsypanki to kategorie celu plus bazowa `wrong_order` (dziś cele gramatyki i szkoły jej nie deklarują, więc zła kolejność wracałaby jako `other`, czyli nieoceniona zamiast błędu). Limit długości `childAnswer` przy `blocks` to 600 znaków jak w szkole — tekst składa się wyłącznie z klocków ćwiczenia (najwyżej `MAX_ORDER_ITEMS`), a obcięcie zepsułoby ocenę kroków procesu.

**Klucz cache:** neutralna normalizacja złączonego tekstu (§2). Dwie kolejności dające ten sam ciąg tokenów czytają się identycznie, więc wspólny werdykt jest poprawny.

**Wynik i feedback:** ten sam `resultFromVerdict` co dla tekstu, z dwiema różnicami: `correctText` to `correctTextFor(key)` (klucz ułożony z klocków — zgodny z nagraniem zdania), a `usesTargetForm` jest dla rozsypanki traktowane jako `true` (klocki są dane, inny szyk tych samych słów nie zmienia formy; w szkole „forma” nie istnieje). Zła kolejność daje więc `model_incorrect` z kategorią `wrong_order`, a brak szablonu podpowiedzi tej kategorii kończy się istniejącą naprawą do `incorrect` z poprawną kolejnością.

**Bez gradera albo po limicie:** inna kolejność → `not_assessed`, zadanie do ponowienia (dziś: błąd). Rozsypanka zostaje typem dostępnym bez gradera (klucz ocenia kod).

**Szkoła:** szkolna rozsypanka (kroki procesu) nie ma kryteriów szkolnych, więc idzie promptem lekcji `grader-v2` z rolą przedmiotu szkolnego.

**„Uznaj jako wariant”** dla werdyktu rozsypanki: serwer zwraca błąd walidacji (wariant rozsypanki nie jest używany w ocenie); panel bez zmian — pokazuje błąd jak dziś. Decyzje „uznaj” i „odrzuć” działają przez cache jak dla tekstu.

## 8. Panel decyzji: tylko bieżące wersje

`listLessonVerdicts` zwraca tylko wiersze, których `prompt_version` należy do bieżących wersji promptu gradera. Port `AnswerGraderProvider` dostaje pole `promptVersions: readonly string[]` (adapter: `["grader-v2", "school-grader-v3"]`; fake odpowiednio). Bez skonfigurowanego gradera cache nie jest czytany, więc lista jest pusta. Stare wiersze zostają w bazie jako historia; decyzje na nich nie działają pod nową wersją (nie są przenoszone).

## 9. Dostępność generowania i limit

**Dostępność:** `lessonAgentPublicFromEnv` wymaga gradera tym samym nierzucającym sprawdzeniem, które już liczy `openCheckService` (`openCheckServiceLabel`): bez niego zwraca `undefined`, a `openCheckService` staje się polem zawsze obecnym. Panel pokazuje istniejący stan „generowanie niedostępne” (`lessonGenerationAvailable: false`). Komunikat `lesson_agent_unavailable` („wymaga klucza OpenRouter”) dostaje dopisek o modelu oceniającym. Bramka jest w panelu jak dziś; worker generuje, gdy ma agenta (bez zmian — w praktyce web i worker mają tę samą konfigurację). Opublikowane lekcje działają jak dziś.

**Jedna stała typów zależnych od gradera:** `GRADER_DEPENDENT_TYPES` w `domain/lessons/scheduler.ts` (error_fix, transform, open_answer) eksportowana i używana w `lesson-sessions.ts` (rezerwacja z planu) i `lesson-shorten.ts` (zamiast `GRADER_TYPES`). Luka i rozsypanka zostają poza zbiorem.

**Jedna wartość domyślna limitu:** `CONFIG_DEFAULTS.UMIEM_GRADER_MAX_CALLS_PER_SESSION` w `config-defaults.ts`; `DEFAULT_GRADER_MAX_CALLS_PER_SESSION` w `config.ts` jest z niej wyprowadzona (albo, jeśli import tworzy cykl, zostaje stałą pilnowaną istniejącym testem równości w `config-defaults.test.ts`), a `GRADER_CALLS_PER_SESSION_FALLBACK` w `lesson-sessions.ts` znika (bez gradera liczba nie ma znaczenia — selektor i tak widzi `graderAvailable: false`). `fakeGraderDeps` bierze tę samą wartość. Nowa wartość: **150** — największy budżet sesji to 100 zadań, a zapas 50 pokrywa ponowienia po nieocenionych. Rezerwacja wywołań z planu sesji zostaje. Dokumentacja z liczbą 20 (`docs/architecture.md`, `docs/provider-config.md`, `.env.example`) dostaje 150.

## 10. Dokumentacja

- `docs/architecture.md` §19: ocena rozsypanki przez model, wynik „bez ćwiczonej formy”, neutralna normalizacja dopasowania, klucza cache, wariantów i focus, literówka przy dosłownym focus, limit 150, panel bieżących wersji.
- AGENTS.md: model oceniający w lekcjach (rozsypanka, ≤600 znaków dla ułożonych klocków), warunek dostępności generowania (pełna konfiguracja `UMIEM_GRADER_*`).
- `messages.ts`: `lessonPracticedForm`, dopisek w `lesson_agent_unavailable`.
- Migracja Drizzle `lesson_verdicts.uses_target_form` ze schematem TypeScript.
- PR: wpływ API → MCP → skill (oczekiwany brak: `learning-overview` nie obejmuje lekcji) i liczby linii z §10 zbiorczego (bazowo: `evaluate.ts` 736, `modules/learning/lessons/` 4679).

## 11. Testy

**Jednostkowe** (`evaluate.test.ts`, `scheduler.test.ts`, `pool-validation.test.ts`, adapter gradera, `config` / `config-defaults`, migawki promptu agenta i roli):

- dopasowanie bez rozwijania: „Yes, she's.”, „Yes, I'm.”, „Yes, they're.” wobec pełnych kluczy i „He has running.” wobec „He's running.” → `no_match`; skrót obecny w wariantach → `exact`;
- literówka: focus dosłowny w wariancie → `minor_typo`; stara rewizja (klucz „She doesn't like tea.”, focus „does not”) i „She don't like tea.” → `no_match`;
- `validateVerdict` z `usesTargetForm` (brak pola → `null`) i tabela mapowania §5;
- `nextLessonTaskState` dla `model_off_target`;
- warianty ze skrótem zostają w `withoutRedundantAcceptedVariants` i nie łamią `variants.duplicate`; focus nie-dosłowny odrzucany przy walidacji;
- prompt `grader-v2`: definicja poprawności, pole, linia rozsypanki tylko przy `blocks`, limit 600 przy `blocks`;
- `lessonAgentPublicFromEnv` bez gradera i z częściową konfiguracją gradera → `undefined` bez wyjątku; domyślny limit 150 w jednym miejscu.

**Integracyjne** (`tests/integration/`, fake grader ze sterowanymi werdyktami):

- pełna ścieżka: dopasowanie → cache → model, w tym „bez ćwiczonej formy” (zadanie `answered`, ocena `unassessed`, brak projekcji, feedback `lesson_precision_hint`, ekspozycja zapisana);
- cache: para różniąca się tylko skrótem w obu kolejnościach daje dwa wiersze i dwa wywołania; powtórzona odpowiedź „bez ćwiczonej formy” bierze wynik z cache bez wywołania;
- stara rewizja z focus w formie rozwiniętej;
- wariant ze skrótem dopisany przez rodzica zalicza bez modelu;
- decyzja rodzica pod `grader-v2` („uznaj” = sukces, „odrzuć” = błąd) na kolejnej identycznej odpowiedzi; panel nie pokazuje wierszy `grader-v1`;
- rozsypanka: klucz → zaliczenie bez modelu; inna kolejność → model (z `wrong_order` → błąd); nie-permutacja → 400; bez gradera i po limicie → nieocenione, zadanie `issued`; „uznaj jako wariant” → błąd walidacji;
- limit: po wyczerpaniu nieocenione.

Testy, których znaczenie się zmienia: `tests/integration/lesson-attempts.test.ts` (odwrócona kolejność oczekuje dziś błędu), `finishLessonTask(correct: false)` w `tests/integration/helpers.ts` (odwraca kolejność) i testy z zaprogramowanymi surowymi werdyktami (bez `usesTargetForm`). Speki E2E nie wysyłają złej kolejności (sprawdzone przez krytyka), więc oczekujemy ich przejścia bez zmian.

## 12. Odbiór na próbkach (§12.3 zbiorczego)

**Przebieg:** sonda `tests/probes/grading.probe.test.ts` (`pnpm probe:grading`) na bazie testów integracyjnych i prawdziwym graderze z `UMIEM_GRADER_*` / `OPENROUTER_API_KEY`. Bez własnych reguł: zakłada lekcje z ćwiczeniami z tabeli, wydaje zadania i wysyła odpowiedzi przez `submitAttempt`, czyli pełną ścieżkę (dopasowanie → cache → model). Każda odpowiedź idzie dwa razy (drugi raz z wypełnionego cache); pary w obu kolejnościach na osobnych rewizjach. Wynik: tabela etykieta → werdykt → zgodność z progami, bez danych dziecka. Rejestr kosztów jak w `probe:agent` (`UMIEM_PROBE_COSTS`). Etykiety mają jedno źródło: plik `tests/probes/fixtures/grading-samples.ts`, zapisany z tabeli poniżej przed przebiegiem.

**Etykiety.** Oczekiwanie: ✓ zaliczone (sukces celu), ✗ nie zaliczone, ◐ „bez ćwiczonej formy”. „Bez modelu” = rozstrzyga dopasowanie (dokładne albo literówka).

| # | Przedmiot / typ | Klucz (focus) i warianty | Odpowiedź | Klasa | Oczekiwanie |
|---|---|---|---|---|---|
| 1 | gramatyka, transform „Zaprzecz” z „She likes tea.” | „She doesn't like tea.” (doesn't like) | „She does not like tea.” | inne poprawne sformułowanie | ✓ |
| 2 | j.w. | j.w. | „She likes tea.” | polecenie niewykonane | ✗ |
| 3 | j.w. | j.w. | „She don't like tea.” | błąd w ćwiczonej formie | ✗ |
| 4 | j.w. | j.w. | „She doesn't likes tea.” | błąd w ćwiczonej formie | ✗ |
| 5 | j.w. | j.w. | „She doesn't like tee.” | literówka poza focus | ✓ bez modelu |
| 6 | j.w. | j.w. | „She doesnt like tea.” | literówka w focus | ✗ |
| 7 | gramatyka, stara rewizja, ten sam transform | „She doesn't like tea.” (does not), bez wariantów | „She don't like tea.” | błąd w ćwiczonej formie (stara rewizja) | ✗ |
| 8 | j.w. | j.w. | „She does not like tea.” | inne poprawne sformułowanie (stara rewizja) | ✓ |
| 9 | j.w. | j.w. | „She doesn't like tee.” | literówka poza focus (stara rewizja) | ✓ |
| 10 | „to be”, odpowiedź krótka na „Is Anna happy?” | „Yes, she is.” (is) | „Yes, she's.” | skrót niegramatyczny | ✗ |
| 11 | „to be”, „Are you ready?” | „Yes, I am.” (am) | „Yes, I'm.” | skrót niegramatyczny | ✗ |
| 12 | „to be”, „Are they at school?” | „Yes, they are.” (are) | „Yes, they're.” | skrót niegramatyczny | ✗ |
| 13 | „to be”, „Is Anna happy?” | „Yes, Anna is.” (is) | „Yes, she is.” | inne poprawne sformułowanie (para A) | ✓ |
| 14 | j.w. | j.w. | „Yes, she's.” | skrót niegramatyczny (para A) | ✗ |
| 15 | Present Continuous, transform „Zrób zdanie w Present Continuous: He runs.” | „He's running.” (running) | „He has running.” | błąd w ćwiczonej formie: fałszywe rozwinięcie He's (para B) | ✗ |
| 16 | j.w. | j.w. | „He is running.” | inne poprawne sformułowanie (para B) | ✓ |
| 17 | Present Continuous, tłumaczenie „Ona teraz czyta książkę.” | „She is reading a book now.” (is reading) | „She's reading a book now.” | poprawny skrót | ✓ |
| 18 | j.w. | j.w. | „She reads a book now.” | błąd w ćwiczonej formie | ✗ |
| 19 | j.w. | j.w. | „She isn't reading a book now.” | negacja zmieniająca sens | ✗ |
| 20 | „to be”, tłumaczenie „Ona nie jest w domu.” | „She is not at home.” (is not), wariant rodzica „She isn't at home.” | „She isn't at home.” | wariant ze skrótem dopisany przez rodzica | ✓ bez modelu |
| 21 | j.w. | j.w. | „She's not at home.” | poprawny skrót | ✓ |
| 22 | j.w. | j.w. | „She is at home.” | negacja zmieniająca sens | ✗ |
| 23 | Present Simple, tłumaczenie „Ona czyta książkę.” (bez wskaźnika) | „She reads a book.” (reads) | „She is reading a book.” | poprawna inną formą | ◐ |
| 24 | Present Simple, tłumaczenie „Ona zawsze czyta wieczorem.” | „She always reads in the evening.” (reads) | „She always read in the evening.” | błąd w ćwiczonej formie | ✗ |
| 25 | Present Simple, transform „Zrób pytanie: She plays tennis.” | „Does she play tennis?” (Does, play) | „Does she play?” | odpowiedź częściowa | ✗ |
| 26 | gramatyka, tłumaczenie „Mój ulubiony kolor to niebieski.” | „My favourite colour is blue.” (is) | „My favorite color is blue.” | pisownia amerykańska | ✓ |
| 27 | gramatyka, rozsypanka „Ułóż zdanie” z [Tom, is, reading, now] | „Tom is reading now” | „Now Tom is reading” | alternatywny szyk | ✓ |
| 28 | j.w. | j.w. | „Tom reading is now” | zła kolejność | ✗ (błąd) |
| 29 | rozdział, tłumaczenie „Pingwin je ryby.” | „The penguin eats fish.” (eats) | „A penguin eats fish.” | inne poprawne sformułowanie | ✓ |
| 30 | j.w. | j.w. | „The penguin doesn't eat fish.” | negacja zmieniająca sens | ✗ |
| 31 | rozdział, luka „The penguin ___ fish.” | „eats” (eats) | „eat” | błąd w ćwiczonej formie | ✗ |
| 32 | rozdział, tłumaczenie „Pingwin lubi kolorowe ryby.” | „The penguin likes colourful fish.” (likes) | „The penguin likes colorful fish.” | pisownia amerykańska | ✓ bez modelu |
| 33 | szkoła, rozsypanka „Ułóż kroki parzenia herbaty” | [Nalej wody do czajnika, Włącz czajnik, Włóż torebkę do kubka, Zalej torebkę wrzątkiem] | Włóż torebkę → Nalej → Włącz → Zalej | alternatywny szyk w krokach procesu | ✓ |
| 34 | j.w. | j.w. | Nalej → Zalej → Włącz → Włóż torebkę | zła kolejność | ✗ (błąd) |
| 35 | szkoła, rozsypanka „Ułóż etapy rozwoju motyla” | [jajo, gąsienica, poczwarka, motyl] | gąsienica → jajo → poczwarka → motyl | zła kolejność | ✗ (błąd) |
| 36 | „to be”, tłumaczenie „Przetłumacz, używając skrótu: Jestem w szkole.” | „I'm at school.” (I'm) | „I am at school.” | polecenie niewykonane (pełna forma zamiast skrótu) | ✗ |

Pary w obu kolejnościach: A (13/14 — różnią się tylko skrótem) i B (15/16 — dwa rozwinięcia „He's”, które dzieliły jeden klucz cache). Każda odpowiedź powtórzona (cache); #23 powtórzona musi dać ◐ z cache bez wywołania.

**Progi do zatwierdzenia przez właściciela** (§12.3 zbiorczego):

1. zero poprawnych odpowiedzi (✓ i ◐) ocenionych jako błąd (`incorrect`); poprawna odpowiedź nieoceniona jest raportowana;
2. zero zaliczonych (✓) ani „bez ćwiczonej formy” (◐) odpowiedzi z klas „negacja zmieniająca sens”, „błąd w ćwiczonej formie” i „skrót niegramatyczny”;
3. zero feedbacku sukcesu („Świetnie!” — zaliczenie albo „bez ćwiczonej formy”) przy niewykonanym poleceniu (#2, #36);
4. zero odpowiedzi ćwiczoną formą (✓) ocenionych jako „bez ćwiczonej formy” i zero próbek ◐ ocenionych jako zaliczone;
5. pary A i B mają po dwa osobne wiersze cache w obu kolejnościach; powtórzenie każdej odpowiedzi daje ten sam wynik z cache bez wywołania.

Pozostałe klasy (odpowiedź częściowa, zła kolejność, literówka w focus) raportujemy z wynikiem; nieocenione zamiast błędu nie łamie progu.

Przekroczony próg: najpierw zmieniamy prompt `grader-v2` albo model gradera i powtarzamy przebieg (wynik każdego przebiegu w PR); dopiero potem wracamy do właściciela.

**Koszt:** ok. 30 wywołań gradera w pierwszym przejściu (dopasowania bez modelu i powtórzenia z cache nie wołają modelu), Gemini 3.8 Flash przez OpenRouter: szacunek ≤ 0,05 USD na przebieg; limit rejestru kosztów 0,20 USD (do trzech przebiegów przy poprawkach promptu). **Płatny przebieg wymaga zgody właściciela.**

## 12a. Wynik odbioru (2026-11-07)

Przebieg `pnpm probe:grading` na `google/gemini-3.8-flash` przez OpenRouter: **0 naruszeń progów 1–5**, 35 wywołań gradera, koszt 0,044 USD (rejestr: 0,097 z 0,20 USD — dwa wcześniejsze przebiegi przerwał błąd harnessu sondy, nie oceny). Wszystkie powtórki przyszły z cache z tym samym wynikiem; para A ma cztery osobne wiersze cache.

Obserwacja: #18 („She reads a book now.”), #19 („She isn't reading a book now.”) i #25 („Does she play?”) model ocenił jako błąd poza celem (`other`), czyli nieocenione z pokazaniem poprawnej odpowiedzi i ponowieniem — bez sukcesu, więc zgodnie z progami, ale to słabszy dowód niż błąd celu. Nie zmieniamy promptu bez dowodu z produkcji (§8 zbiorczego); wyzwalacz można policzyć ręcznym zapytaniem po `model_other`.

| # | klasa | oczekiwanie | wynik (werdykt, ocena, feedback) | wywołania | powtórka |
|---|---|---|---|---|---|
| 1 | inne poprawne sformułowanie | pass | pass (model_correct, correct, great) | 1 | cache pass |
| 2 | polecenie niewykonane | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 3 | błąd w ćwiczonej formie | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 4 | błąd w ćwiczonej formie | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 5 | literówka poza focus | pass | pass (minor_typo, correct, lesson_almost) | 0 | cache pass |
| 6 | literówka w focus | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 7 | błąd w ćwiczonej formie (stara rewizja) | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 8 | inne poprawne sformułowanie (stara rewizja) | pass | pass (model_correct, correct, great) | 1 | cache pass |
| 9 | literówka poza focus (stara rewizja) | pass | pass (model_almost, correct, lesson_almost) | 1 | cache pass |
| 10 | skrót niegramatyczny | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 11 | skrót niegramatyczny | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 12 | skrót niegramatyczny | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 13 | inne poprawne sformułowanie (para A) | pass | pass (model_correct, correct, great) | 1 | cache pass |
| 14 | skrót niegramatyczny (para A) | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 14r | skrót niegramatyczny (para A, odwrotna kolejność) | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 13r | inne poprawne sformułowanie (para A, odwrotna kolejność) | pass | pass (model_correct, correct, great) | 1 | cache pass |
| 15 | błąd w ćwiczonej formie: fałszywe rozwinięcie He's (para B) | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 16 | inne poprawne sformułowanie (para B) | pass | pass (model_correct, correct, great) | 1 | cache pass |
| 17 | poprawny skrót | pass | pass (model_correct, correct, great) | 1 | cache pass |
| 18 | błąd w ćwiczonej formie | fail | fail (model_other, unassessed, incorrect) | 1 | cache fail |
| 19 | negacja zmieniająca sens | fail | fail (model_other, unassessed, incorrect) | 1 | cache fail |
| 20 | wariant ze skrótem dopisany przez rodzica | pass | pass (exact, correct, great) | 0 | cache pass |
| 21 | poprawny skrót | pass | pass (model_correct, correct, great) | 1 | cache pass |
| 22 | negacja zmieniająca sens | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 23 | poprawna inną formą | off_target | off_target (model_off_target, unassessed, lesson_precision_hint) | 1 | cache off_target |
| 24 | błąd w ćwiczonej formie | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 25 | odpowiedź częściowa | fail | fail (model_other, unassessed, incorrect) | 1 | cache fail |
| 26 | pisownia amerykańska | pass | pass (model_correct, correct, great) | 1 | cache pass |
| 27 | alternatywny szyk | pass | pass (model_correct, correct, great) | 1 | cache pass |
| 28 | zła kolejność | fail | fail (model_incorrect, incorrect, incorrect) | 1 | cache fail |
| 29 | inne poprawne sformułowanie | pass | pass (model_correct, correct, great) | 1 | cache pass |
| 30 | negacja zmieniająca sens | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 31 | błąd w ćwiczonej formie | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |
| 32 | pisownia amerykańska | pass | pass (minor_typo, correct, lesson_almost) | 0 | cache pass |
| 33 | alternatywny szyk w krokach procesu | pass | pass (model_correct, correct, great) | 1 | cache pass |
| 34 | zła kolejność | fail | fail (model_incorrect, incorrect, incorrect) | 1 | cache fail |
| 35 | zła kolejność | fail | fail (model_incorrect, incorrect, incorrect) | 1 | cache fail |
| 36 | polecenie niewykonane (pełna forma zamiast skrótu) | fail | fail (model_incorrect, incorrect, lesson_hint) | 1 | cache fail |

## 13. Ryzyka

- **Więcej wywołań modelu:** odpowiedzi ze skrótem wobec opublikowanych kluczy bez wariantów skrótowych idą teraz do gradera. Koszt mały (limit 150), cache dzieli werdykt na identyczne odpowiedzi.
- **Model zwraca bez `usesTargetForm`:** werdykt odrzucony, odpowiedź nieoceniona bez kary. Sonda pokaże częstość.
- **Rozsypanka bez gradera:** inny szyk jest nieoceniony zamiast błędny — mniej dowodów, bez fałszywego sukcesu (§15 zbiorczego).
- **Focus wyznacza autor:** literówka w słowie formy ćwiczonej spoza focus zalicza bez modelu (§3) — istniejące zachowanie, poza zakresem.
- **Synonim spoza rozdziału:** pod `grader-v2` bez sukcesu celu zamiast z sukcesem (§5) — świadomie.
