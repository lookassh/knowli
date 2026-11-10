# Odporność adaptera i przebiegu bazowego generowania lekcji — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wadliwa odpowiedź modelu w jednej paczce (pusta treść, zła liczba wyników kontroli, awaria kontroli) nie przerywa runu ani nie kasuje zagadnienia, a kody błędów terminu są spójne.

**Architecture:** Zmiany w adapterze `providers/openai/lesson-pool-agent.ts` (odczyt wyniku wewnątrz `tracked`, numer `n` w pozycjach i wynikach kontroli) i w przebiegu `modules/materials/lessons/lesson-baseline-pool.ts` (nieponawialna awaria kontroli = `check_unknown` paczki). Kontrakt portu `ClosedExerciseChecker` zostaje pozycyjny — numerację zna tylko adapter, więc fake'i się nie zmieniają. Bez zmian w bazie, DTO, API, MCP i skillu.

**Tech Stack:** TypeScript strict, AI SDK `ai@7.0.162` (`generateText` + `Output.object`), zod 4, Vitest, PostgreSQL w testach integracyjnych.

**Spec:** ustalenia przeglądu modułu generowania lekcji, pakiet C (treść w zleceniu; streszczone w zadaniach poniżej). Kontekst: `docs/architecture.md` §19.17, `docs/agents/lessons.md`, `docs/agents/providers-privacy.md`.

## Global Constraints

- Koszt: jeden zapis na żądanie HTTP, przed walidacją wyniku; `withUsageScope` tylko w przypadkach użycia.
- Kontrola zamkniętych nie widzi klucza ani celu; werdykt liczy domena (`closedCheckVerdict`). Wadliwa odpowiedź kontroli nigdy nie przepuszcza ćwiczenia.
- Przerwania: `untilAborted`, `crash`, `allSettledOrThrow` — żadnych wywołań w tle.
- `ai` i `@openrouter/*` tylko w `providers/openai/lesson-pool-agent.ts` i jego teście (`tests/ai-sdk-scope.test.ts`).
- Poza zakresem: `packetInstructions`, `providers/openai/llm.ts`, `lesson-pool-schema.ts`, `temperature` kontroli, `modules/materials/generation.ts`, `generation-worker.ts`, `apps/web`, `domain/lessons/pool-validation.ts`, `rules/`.
- Żadnych nowych kodów błędów w kontrakcie; żadnych płatnych wywołań modelu.
- Błędy generatora paczki zachowują dzisiejsze zachowanie (zagadnienie `failed`).

## Wynik weryfikacji ustaleń (stan `origin/main` b0f97190)

1. **Potwierdzone w SDK.** `ai@7.0.162` `dist/index.js`: `generateText` liczy wynik tylko gdy `finishReason === "stop"` albo tekst niepusty (linia ~5900), a getter `output` rzuca `NoOutputGeneratedError`, gdy wyniku nie ma (linia 3095). Oba odczyty `result.output` są poza lambdą `tracked`, więc błąd omija `toGenerationProviderError` i `callModel` robi `crash.abort`.
2. **Potwierdzone.** `sameLength` → wszystkie `undefined` → `check_unknown` całej paczki, bez ponowienia.
3. **Potwierdzone.** `catch` kontroli rzuca dalej przy `unchecked.length === 0`; `runObjective` zwraca wtedy `packets: []`.
4. **(a) Potwierdzone częściowo:** termin przebiegu w trakcie pracy z zerem przyjętych daje `validation` (wiersz 7), a brak czasu przed startem `provider_timeout`. Wyczerpany budżet → `validation` jest udokumentowany w §19.17 („kody wyczerpanego budżetu zostają”) i zostaje — nie ma pasującego istniejącego kodu. **(b) Potwierdzone, bez zmiany kodu:** ponowienie po błędzie bazy w finalizacji jest udokumentowaną gwarancją (§19.17: postęp z punktu kontrolnego trafia do szkicu przy następnym przejęciu); próba „tylko zapis” wymagałaby znacznika w punkcie kontrolnym. Opis w PR jako decyzja właściciela.
5. **Potwierdzone.** `maxTokens` nie ma żadnego wołającego (grep). Dla `<MATERIAL>` zamiana każdego „<” zepsułaby materiał szkolny z nierównościami („3 < 5”), więc ucieczka obejmuje tylko „<” otwierające znacznik `MATERIAL`/`ITEMS`.
6. **Potwierdzone.** :245 przechodzi przy zerze wywołań (budżet 0,001 wyczerpuje już pierwsza paczka).

## Review Focus

- Odpowiedź kontroli z powtórzonym numerem `n` albo numerem spoza 1..N → błąd `output`, nigdy dopasowanie „najbliższe” (test w zadaniu 2).
- Odpowiedź z dobrą liczbą wyników w innej kolejności → wyniki trafiają do właściwych pozycji (test w zadaniu 2).
- Pusta treść przy `finishReason` ≠ stop: koszt zapisany dokładnie raz, zdarzenie `ok` (test w zadaniu 1).
- Awaria kontroli po ponowieniu w paczce samych zamkniętych: pozostałe paczki zagadnienia zostają, a `rate_limit`/`transient`/`configuration` nadal dają `failed` (test w zadaniu 3).
- Materiał z tekstem `</MATERIAL>` nie zamyka bloku, a „3 < 5” zostaje bez zmian (test w zadaniu 2).

---

## Kolejność wykonania

Zadania 1 → 3 → 2 → 4 → 5 → 6 (zadanie 3 przed 2: inaczej na commicie pośrednim zła liczba wyników kasowałaby całe zagadnienie zamiast paczki).

## Poprawki po przeglądzie trzech krytyków (2026-11-10)

- Zadanie 2: `n` całkowite sprawdzane jawnie, bo `z.number()` przepuszcza 1.5; `n` zostaje w wynikach (domena parsuje nieścisłym `z.object`, więc nie trzeba go zdejmować); test ucieczki bez sprzeczności; regex toleruje odstępy w znaczniku. Odrzucone: „brakujące numery jako `undefined` bez błędu” — zlecenie wymaga błędu `output` i ponowienia przy każdym niezgodnym zbiorze, a typowa pomyłka (jeden wynik na ćwiczenie) daje właśnie numery 1..K z brakami. Odrzucone: „sam rzut przy złej długości, bez `n`” — numer pozycji jest wprost w zleceniu. Skutki do opisania w §19.17 i PR: pozycja `null`/bez `n` odrzuca całe wywołanie (dziś tylko tę pozycję), wadliwa odpowiedź kosztuje do 2 żądań kontroli na paczkę, wyniki sondy `closed-check-gold` sprzed zmiany nie są porównywalne.
- Zadanie 3: przy wyczerpanym budżecie awaria kontroli zawsze daje `check_unknown` (ponowienia runu i tak nie będzie — wiersz 1 tabeli wyniku), więc opłacone paczki zostają. Zmiana kodu dla rodzica (zagadnienia samych zamkniętych: `provider_timeout`/`provider_output` → `validation` z powodem `check_unknown`) do §19.17 i PR.
- Zadanie 4: funkcja kodu terminu dostaje wydatek jawnie (`begin.budgetSpentUsd` przed startem, `result.spentUsd` po przebiegu); `timedOut` z `runDeadline.signal.reason === RUN_TIMEOUT_REASON` po `signal.throwIfAborted()`; test integracyjny sprawdza, że paczki były wołane.
- 4b: jedno ponowienie `settle` w miejscu odrzucone w tym pakiecie (zapis do szkicu nie jest wprost idempotentny: domknięcia `extendContext`, „commit bez potwierdzenia”) — opis w PR jako decyzja właściciela.

### Task 1: Odczyt wyniku modelu wewnątrz `tracked` (ustalenie 1, martwe `?? {}`)

**Files:**
- Modify: `packages/server/src/providers/openai/lesson-pool-agent.ts` (`generatePacket`, `checkClosed`)
- Test: `packages/server/src/providers/openai/lesson-pool-agent.test.ts`

- [ ] **Step 1: test czerwony** w `describe("mapowanie błędów …")`: „pusta treść i finishReason inny niż stop → output, koszt raz”. Model: `{ ...textResult(""), content: [], finishReason: { unified: "content-filter", raw: "content_filter" } }`; drugi przypadek `{ unified: "length", raw: "length" }`. Dla `generatePacket` i `checkClosed`: `rejects.toMatchObject({ name: "GenerationProviderError", kind: "output" })`, `cost.values` ma długość 1 (`[0.002]`), `usage.events` — dokładnie jedno zdarzenie `outcome: "ok"`.
- [ ] **Step 2:** `corepack pnpm vitest run packages/server/src/providers/openai/lesson-pool-agent.test.ts` → FAIL (`AI_NoOutputGeneratedError` zamiast `GenerationProviderError`).
- [ ] **Step 3:** w obu metodach lambda `tracked` zwraca `generateText({...}).then((result) => result.output)`; poza lambdą kod pracuje na gotowym wyniku. Usuń `?? {}`. Wyjątek gettera przechodzi przez `tracker.fail` (0 otwartych żądań = bez drugiego zapisu) i `toGenerationProviderError`.
- [ ] **Step 4:** ten sam plik testu → PASS.
- [ ] **Step 5:** commit „Lekcje: pusta odpowiedź modelu paczki jako błąd output zamiast przerwania runu”.

### Task 2: Numer `n` w kontroli zamkniętych i ucieczka `<MATERIAL>` (ustalenia 2 i 5)

**Files:**
- Modify: `packages/server/src/providers/openai/lesson-pool-agent.ts` (`checkClosed`, `closedCheckPrompt`, `materialBlock`, `sameLength` → `resultsByNumber`, `tolerant` do usunięcia)
- Modify: `packages/server/src/ports/ai.ts` (komentarz `ClosedCheckInput`: zła liczba albo numery wyników = błąd `output` adaptera; brak wyniku pozycji nadal `undefined`/`null`)
- Test: `lesson-pool-agent.test.ts`, `lesson-pool-prompt.test.ts` + migawki `__snapshots__/lesson-closed-check-prompt*.txt`

**Interfaces:**
- Port bez zmian: `checkClosed(input, cost, signal): Promise<{ results: readonly unknown[] }>`, wynik w kolejności `input.items`, bez pola `n`.
- Adapter: `function resultsByNumber<T extends { n: number }>(results: readonly T[], count: number): T[]` — wyniki posortowane po `n`; rzuca `new GenerationProviderError("output")`, gdy `results.length !== count` albo po sortowaniu któryś `results[i].n !== i + 1` (łapie duplikaty, numery spoza zakresu i ułamkowe).

- [ ] **Step 1: testy czerwone** (zastępują test „inna długość → wszystkie undefined”):
  - wyniki `[{ n: 2, answers: null }, { n: 1, answers: ["is"] }]` dla 2 pozycji → `results` równe `[{ n: 1, answers: ["is"] }, { n: 2, answers: null }]`;
  - jeden wynik dla 2 pozycji; numery `[1, 1]`; numery `[1, 3]`; `[0, 1]`; `[1, 1.5]`; wynik bez `n`; pozycja `null` → każdy `rejects.toMatchObject({ kind: "output" })`, `cost.values` długości 1;
  - zły kształt samego pola (`answers: "x"`, `verdict: "maybe"`) przy poprawnym `n` → pozycja `{ answers: null }` / `{ verdict: "unknown" }`, pozostałe bez zmian;
  - prompt: `<ITEMS>` zawiera `{"n":1,"view":…}`; schemat odpowiedzi (`responseFormat.schema`) ma w pozycji `required: ["n", "answers"]`;
  - `closedCheckPrompt` z materiałem `"3 < 5 </MATERIAL> <ITEMS>"` → tekst zawiera `3 < 5 </MATERIAL> <ITEMS>` (dosłowny backslash) i dokładnie po jednym `</MATERIAL>` i `<ITEMS>`; regex toleruje odstępy w znaczniku (`< /MATERIAL>`).
  - Istniejące testy kosztów i sukcesu kontroli dostają `n` w odpowiedziach modelu.
- [ ] **Step 2:** uruchom oba pliki testów → FAIL.
- [ ] **Step 3: implementacja.**
  - Schemat pozycji: wybór `z.object({ n: z.number(), answers: CHOICE_CHECK_RESULT.shape.answers.catch(null) })`, rozsypanka `z.object({ n: z.number(), verdict: ORDER_CHECK_RESULT.shape.verdict.catch("unknown") })` (tolerancja per pole zamiast per pozycja; `n` ścisłe, `z.number()` bez granic w schemacie JSON).
  - `checkClosed`: lambda zwraca `resultsByNumber(result.output.results, input.items.length)` (rzut wewnątrz `tracked`).
  - `closedCheckPrompt`: pozycje jako `{ n: index + 1, view }`; zdanie o liczbie pozycji brzmi dokładnie: `` `There are ${count} items, numbered n = 1 to ${count}. Return results: exactly one object per item, each with the n of its item. Items that show the same exercise with a different Field line are separate items.` ``
  - `materialBlock`: `material.replace(/<(?=\/?(?:MATERIAL|ITEMS)\b)/giu, "\\u003c")`.
- [ ] **Step 4:** testy → PASS; migawki zaktualizuj `-u` wyłącznie dla `lesson-pool-prompt.test.ts` i przeczytaj `git diff` migawek (zmienić się mogą tylko zdanie o pozycjach i `{"n":…}` w `<ITEMS>`; migawki promptu paczki bez zmian).
- [ ] **Step 5:** commit „Lekcje: kontrola zamkniętych dopasowuje wyniki po numerze pozycji”.

### Task 3: Awaria kontroli jednej paczki nie kasuje zagadnienia (ustalenie 3) i ostrzejsze asercje (ustalenie 6)

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-baseline-pool.ts` (blok `catch` wokół `deps.checker.checkClosed`, ~320)
- Test: `packages/server/src/modules/materials/lessons/lesson-baseline-pool.test.ts`

- [ ] **Step 1: testy czerwone.**
  - „a non-retryable checker failure rejects only that packet's closed exercises”: kontrola rzuca `GenerationProviderError(kind)` dla `kind` z `["output", "timeout", "refusal"]` → oba zagadnienia bez `failure`, status `incomplete`, w ćwiczeniach są `lesson_gap` i `lesson_open_answer`, nie ma `lesson_choice`; 14 odrzuceń `check_unknown`; dla `output` i `timeout` kontrola wołana 4 razy (2 paczki × ponowienie), dla `refusal` 2 razy.
  - „a retryable or configuration checker failure still fails the objective”: `transient`, `rate_limit` (z `retryAfterMs: 1`), `configuration` → oba zagadnienia `failed`, `exercises: []`, `failure.errorCode` odpowiednio `provider`, `provider_rate_limit`, `provider_configuration`.
- [ ] **Step 2:** uruchom plik → pierwszy test FAIL (dziś `failed`); drugi jest strażnikiem i przechodzi już dziś. Trzeci test (czerwony): kontrola rzuca `transient` przy budżecie wyczerpanym przez tę paczkę → zagadnienie bez `failure`, ćwiczenia paczki `check_unknown`.
- [ ] **Step 3: implementacja.** W `catch` kontroli: rzuć dalej, gdy `signal.aborted`, błąd nie jest `GenerationProviderError`, albo (`unchecked.length === 0`, `!cost.exhausted()` i rodzaj błędu należy do stałego zbioru `CHECK_FAILS_OBJECTIVE = rate_limit | transient | configuration` obok `RETRIED`); w pozostałych przypadkach dzisiejsza gałąź keywords (`check_unknown` dla `checkable`, `done` z `unchecked`). Paczka z pytaniami otwartymi zachowuje dzisiejsze zachowanie dla każdego rodzaju błędu.
- [ ] **Step 4: asercje (ustalenie 6).**
  - :256 → `expect(twice.objectives[0]!.failure).toEqual({ errorCode: "provider", retryable: true })`.
  - :245 → budżet `0.0018` (wybór 0,001 + kontrola 0,0005 mieści się, luka go przekracza), asercja `toHaveLength(1)`.
  - :276 → `vi.useFakeTimers()` przed uruchomieniem, po odrzuceniu `await vi.advanceTimersByTimeAsync(60_000)` zamiast 20 ms prawdziwego zegara, potem `toHaveLength(1)`.
  - test :328 dostaje nazwę „rejects a whole closed packet when the check returns no result for its items”.
- [ ] **Step 5:** plik testu → PASS; `corepack pnpm vitest run packages/server/src/modules/materials` (w tym `*.architecture.test.ts`).
- [ ] **Step 6:** commit „Lekcje: nieudana kontrola paczki odrzuca jej ćwiczenia zamiast całego zagadnienia”.

### Task 4: Termin przebiegu bez przyjętych ćwiczeń = `provider_timeout` (ustalenie 4a)

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-pool-agent.ts` (`LessonPoolAgentResult.timedOut?: true`)
- Modify: `lesson-baseline-pool.ts` (ustawienie pola), `lesson-agent-generation.ts` (`attempt`)
- Test: `lesson-baseline-pool.test.ts`, `tests/integration/lesson-agent-generation.test.ts`

**Interfaces:**
- `LessonPoolAgentResult.timedOut?: true` — termin przebiegu (`runTimeoutMs`) minął, zanim skończyły się wywołania modelu.

- [ ] **Step 1: testy czerwone.** Jednostkowy: w teście „run deadline with hung packets” `expect(result.timedOut).toBe(true)`, a w teście zwykłego sukcesu `expect(result.timedOut).toBeUndefined()`. Integracyjny (obok „termin runu → succeeded z częścią”): wszystkie paczki obu zagadnień `never`, `finalizationReserveMs: 1000`, `execution: { requestTimeoutMs: 3000, runTimeoutMs: 3000 }` → `state === "failed"`, `error_code === "provider_timeout"`, a generator był wołany (inaczej test przeszedłby starą gałęzią `remainingMs <= 0`); przypadek wyczerpanego budżetu zostaje `validation` (istniejący test).
- [ ] **Step 2:** FAIL (`validation`).
- [ ] **Step 3: implementacja.** Przebieg: `const timedOut = runDeadline.signal.reason === RUN_TIMEOUT_REASON` zaraz po `signal.throwIfAborted()` za `allSettledOrThrow` zagadnień, w wyniku `...(timedOut ? { timedOut: true } : {})`. `attempt`: jedna funkcja lokalna `(outcome, spentUsd)` zamieniająca wynik `failed`/`validation` na `failed`/`provider_timeout`, gdy `spentUsd < budgetUsd` — użyta w gałęzi `remainingMs <= 0` (dziś inline) i po przebiegu, gdy `result.timedOut`.
- [ ] **Step 4:** `corepack pnpm vitest run packages/server/src/modules/materials/lessons` i `pnpm test:integration tests/integration/lesson-agent-generation.test.ts` → PASS.
- [ ] **Step 5:** commit „Lekcje: termin przebiegu bez przyjętych ćwiczeń kończy run kodem provider_timeout”.

### Task 5: Sprzątanie i dokumentacja

**Files:**
- Modify: `packages/server/src/providers/openai/lesson-json-request.ts` (usuń `maxTokens` z argumentów, ciała i komentarza)
- Modify: `docs/architecture.md` §19.17 (numer `n` i błąd `output` przy złym zbiorze wyników; nieponawialna awaria kontroli = `check_unknown` paczki; termin przebiegu = `provider_timeout`), `docs/agents/providers-privacy.md` tylko jeśli zmienia się opis danych (nie zmienia się — numer pozycji to nie dane)

- [ ] **Step 1:** grep `maxTokens|max_tokens` w `packages apps tests` → po zmianie brak trafień poza testami, które sprawdzają brak pola.
- [ ] **Step 2:** `pnpm check` → typecheck, unit, build zielone.
- [ ] **Step 3:** commit „Lekcje: usunięty nieużywany maxTokens, opis odporności kontroli w architekturze”.

### Task 6: Weryfikacja końcowa

- [ ] `pnpm check`
- [ ] `corepack pnpm vitest run tests/ai-sdk-scope.test.ts packages/server/src/providers/lesson-agent-imports.architecture.test.ts packages/server/src/providers/usage-recording.architecture.test.ts`
- [ ] `pnpm test:integration tests/integration/lesson-agent-generation.test.ts`
- [ ] Bez `pnpm test:e2e:shards` (robi CI) i bez płatnych wywołań. W PR wprost: nowy tekst promptu kontroli i schemat z `n` nie były sprawdzone na prawdziwym modelu.
