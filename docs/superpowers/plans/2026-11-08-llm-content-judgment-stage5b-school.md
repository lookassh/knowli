# Etap 5b: szkoła na przebiegu bazowym — plan implementacji

Wersja 2, 2026-11-08, po przeglądzie trzech krytyków planu (prostota, poprawność kodu i danych, dydaktyka i pomiar) i decyzjach właściciela (spec v2.3). Gałąź `feature/stage5b-school` stoi na PR 5a (#376, jeszcze nie w `main`); po scaleniu 5a — rebase na `main` i przestawienie bazy PR.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `school` generuje się w workerze przebiegiem bazowym (paczki cel × typ, keywords razem z pytaniem otwartym → oczyszczenie i struktura → kontrola zamkniętych z materiałem → walidacja puli), bez podpowiedzi w świeżym wyjściu modelu; znikają `hint-gate.ts`, `termOccursIn`, reguły `school.keyword_not_in_answer`, `school.keywords_family_rejected`, `hint.reveals_words`; szkoła przestaje deklarować kontrole 2b (kod 2b znika w 5c); narzędzia sondy, materiały i ćwiczenia wzorcowe szkoły są gotowe do rundy 0.

**Architecture:** W istniejących granicach: domena (`closed-check.ts`, `packet-plan.ts`, moduł szkoły, `agent/admission.ts`), `modules/materials/lessons/lesson-baseline-pool.ts`, fake paczek, tekst panelu. Port, adapter (`packetInstructions`, `closedCheckPrompt` bez materiału), punkt kontrolny, transakcje, zapis szkicu, `withoutOrphanKeywords` — bez zmian. Gramatyka i rozdział bez zmian zachowania.

**Tech Stack:** TypeScript strict, Vitest, Playwright, Drizzle (bez migracji), Zod.

**Spec:** `docs/superpowers/specs/2026-11-08-llm-content-judgment-stage5-chapter-school-design.md` (v2.3) — §3, §4.4, §5, §7.1–§7.3, §7.6, §7.7, §14.

## Global Constraints

- Kod nie rozumie języka: `hint-gate.ts` i `termOccursIn` znikają bez warunku; bez nowych reguł tekstowych; `snapQuote` to normalizacja białych znaków i cudzysłowów oraz porównanie napisów.
- Do generatora i kontroli żadnych danych dziecka; kontrola zamkniętych dostaje materiał wyłącznie przy `agentPolicy.checkerNeedsMaterial` (szkoła), keywords dodatkowo prompt pytania otwartego swojej rodziny; dziennik `[lesson-baseline]` bez treści.
- Wspólne prompty adaptera bez zmian bajt w bajt (`packetInstructions`; `closedCheckPrompt` bez materiału — migawki gramatyki i rozdziału nietknięte). Instrukcje keywords i rachunków tylko w polach przedmiotu (`schoolPrompts`), które wolno stroić.
- `fieldVerdict`: porównanie zbiorów wyłącznie dla keywords; dla pozostałych typów `key.length === 1` bez zmian (`lesson_notice` odrzuca słowo w dwóch segmentach).
- Kontrole 2b zostają w kodzie do 5c (ramię agenta w sondzie biegnie z nimi na `main`); szkoła ich nie deklaruje. `lessonAgentPublicFromEnv` nadal wymaga pełnego `UMIEM_GRADER_*`.
- Bez migracji. API → MCP → skill: zmienia się tylko tekst panelu i to, że katalog szkoły nie niesie już `openCheckService` (pole opcjonalne panelu rodzica); `learning-overview` nie obejmuje lekcji, `integrations/umiem-mcp` nie zna katalogu lekcji — MCP i `SKILL.md` bez zmian (uzasadnienie w PR). Bez identyfikatorów modeli w commitach i PR.

## Decyzje (właściciel 2026-11-08, spec v2.3; rutynowe po krytykach)

1. Kontrole 2b — kod usuwa 5c; w 5b szkoła nie deklaruje `hintJudgeTypes` / `openAnswerCheckTypes`.
2. Szkoła nie generuje podpowiedzi (dziecko nie widzi `hint` pytania otwartego — `lesson-materialize.ts:519`; inne typy szkoły i tak go nie mają): bez instrukcji podpowiedzi w prompcie, oczyszczenie świeżego wyjścia zdejmuje `hint` ze wszystkich ćwiczeń szkoły. Ręczna edycja rodzica bez zmian (`school.hint_open_answer_only`). W6h tylko raportowana.
3. Powrót 2b zależy od W2 + W4 pytań otwartych: przebieg bazowy gorszy od agenta o ≥ 3 wiersze i ≥ 5 pp, łącznie ze wszystkich biegów tej samej konfiguracji, u obu sędziów (decyzja we wspólnym biegu końcowym).
4. Runda 0: 1 bieg agenta na materiał strojenia.
5. Prompt kontroli z materiałem: nowa gałąź tylko przy `material` (pierwsze zdanie bez „learning English”, blok materiału przed pozycjami); bez materiału bajt w bajt.
6. Keywords w „dodaj N” nie są generowane. Brak paczki cloze przy małym udziale guided — bez zmiany kodu, raport per typ.
7. Materiały i wzorcowe rozłączne tematycznie z przykładami promptu szkoły (geografia Polski, obieg wody): strojenie — przyroda „części rośliny i ich zadania”, historia „chrzest Polski” (z prostą metodą obliczeń upływu lat); wstrzymany — przyroda „warstwy lasu”.
8. Bez `quotesSnapped` w przebiegu bazowym (rozdział też nie liczy); `hintsRemoved` = 0 do 5c.

## Review Focus

1. Keywords z pytaniem rodziny w zapasie paczki: przyjęte po wszystkich innych ćwiczeniach zagadnienia; pytania otwarte paczki przyjęte także, gdy keywords odpadną (Task 2).
2. Keywords bez strukturalnie poprawnego pytania rodziny: odrzucone `rule_exercise` z `school.keywords_family_missing`, bez pozycji kontroli; pytania otwarte paczki zostają (Task 2).
3. Dwa keywords w paczce: oba kontrolowane, przyjęte pierwsze, które przejdzie; drugie odpada `over_count`; keywords nie zajmują kubełka `independent` ani słuchania (Task 2).
4. `lesson_notice` ze słowem w dwóch segmentach dalej odpada w kontroli; prompt kontroli bez materiału bajt w bajt (Task 1).
5. Run szkoły w toku z punktem kontrolnym agenta (`dynamicTopic`, część zagadnień `complete`, `checkCounters`, kody `hint_*` w `rejectionCodes`) wznawia się przebiegiem bazowym z polskimi etykietami starych kodów (Task 4).

---

### Task 1: Kontrola keywords i materiał w kontroli zamkniętych

**Files:** `domain/lessons/closed-check.ts`, `ports/ai.ts` (`ClosedCheckInput.material?: string`), `providers/openai/lesson-pool-agent.ts` (`closedCheckPrompt`, `checkClosed`), `modules/materials/lessons/lesson-baseline-pool.ts`, `providers/fake-lesson-pool.ts`; testy: `closed-check.test.ts`, `providers/openai/lesson-pool-prompt.test.ts` (migawka `lesson-closed-check-prompt.school.txt`), `lesson-baseline-pool.test.ts`, `fake-lesson-pool.test.ts`. (Ścieżki względem `packages/server/src/`.)

**Interfaces:**
- `closedCheckContract("lesson_keywords") === "choice"`; keywords idą ścieżką jednego pola: `choicesOf` → pojęcia (`{ key: option.id, text }`), `keyChoices` → `keyOptionIds`; `closedCheckItems(draft, topic, familyPrompt?: string)` dokłada wiersz `Question: <familyPrompt>` (jak wiersze słuchania i rozsypanki); keywords bez `familyPrompt` → `null`.
- `fieldVerdict(result, choices, key, normalizer, wholeSet = false)`: `wholeSet` (tylko keywords) → przechodzi, gdy zbiór przypisań = zbiór klucza (niepusty); inaczej dzisiejsze `key.length === 1`.
- `closedCheckPrompt({ contract, items, material? })`; przebieg przekazuje `material` przy `checkerNeedsMaterial`.

- [ ] **Step 1: Testy** — `keywords: one item with the family question, concepts as options, no key`; `keywords without the family question has no item`; `keywords verdict: only the full key set passes` (komplet → pass; podzbiór, nadzbiór, `[]` → `check_wrong_set`; `null` → `check_unknown`); `notice with the key word in two segments still fails` (istniejący test bez zmian); `closed check prompt without material is unchanged` (migawka); `closed check prompt with material` (nowa migawka); `school check carries the material, grammar check does not`; `fake closed answer reads the keywords key`.
- [ ] **Step 2:** `pnpm vitest run --config vitest.unit.config.ts <pliki testów>` — FAIL → implementacja → PASS; `pnpm typecheck`.
- [ ] **Step 3: Commit** `Etap 5b: kontrola keywords i materiał w kontroli zamkniętych szkoły`.

### Task 2: Keywords w paczce pytań otwartych (wariant A)

**Files:** `domain/lessons/packet-plan.ts`, `lesson-baseline-pool.ts`, `providers/fake-lesson-pool.ts`, `subjects/school/rules.ts` i `validators.ts` (bez `school.keywords_family_rejected` i `rejectedFamilies` w ctx, także w `agent/admission.ts` i `types.ts`), `subjects/school/prompts.ts` (`typeRules.lesson_keywords`); testy: `packet-plan.test.ts`, `lesson-baseline-pool.test.ts`, `lesson-pool-prompt.test.ts` (migawka `lesson-packet-prompt.school_open_answer.txt`), `fake-lesson-pool.test.ts`, testy reguł szkoły.

**Interfaces:**
- `export const KEYWORDS_PER_OBJECTIVE = 1` (jedyne miejsce limitu); `bucketOf("lesson_keywords") → "keywords"`; `PacketPlan.caps.keywords`.
- Paczka planu: `companion?: "lesson_keywords"` na paczce `lesson_open_answer`, gdy zagadnienie ma typ `lesson_keywords` (nie w „dodaj N”); paczki typu keywords nie ma.
- `packetInput`: `exerciseTypes: [type, companion]` — gałąź schematu keywords (`DEDICATED_BRANCH_TYPES`) i blok reguł keywords pojawiają się same; adapter bez zmian.
- Przebieg, paczka z `companion`: kontrakt kontroli per ćwiczenie (pytania otwarte bez kontraktu przechodzą bez zmian); keywords bez strukturalnie poprawnego pytania rodziny w paczce → `reject(…, "rule", "rule_exercise", ["school.keywords_family_missing"])`; wszystkie keywords kontrolowane, przyjęte pierwsze, które przejdzie, reszta `over_count`; przyjęte keywords doklejone za pytaniami otwartymi, a w walidacji puli zagadnienia stabilnie na końcu (`[...bez keywords, ...keywords]`, po udziałach i zapasach), więc nie wypychają pytania z udziału.
- `typeRules.lesson_keywords` (tekst, bez przykładowego zdania): oprócz pytań otwartych najwyżej jedno keywords dla jednej ich rodziny (ten sam `objectiveId` i `familyId`); pojęcia kluczowe z `requiredElements` tej rodziny, nigdy pojęcie podane w pytaniu.

- [ ] **Step 1: Testy** — `open answer packet carries the keywords companion`; `no companion without the keywords type or in the add plan`; `keywords have their own bucket`; `keywords are checked with the family question and admitted after the objective's other exercises` (pytanie rodziny w zapasie; pytania otwarte przyjęte); `keywords without a valid family question are rejected by the family rule and the open questions stay`; `two keywords: both checked, the first passing one admitted`; `keywords do not take an independent slot`; `keywords familyId matches its family after run scoping`; `packet prompt with the keywords companion` (migawka; gałąź keywords w `anyOf`; migawki gramatyki i rozdziału bez zmian); `fake open-answer packet with companion passes structure and check`.
- [ ] **Step 2:** FAIL → implementacja → PASS; `pnpm typecheck`.
- [ ] **Step 3: Commit** `Etap 5b: keywords w paczce pytań otwartych, kubełek z limitem 1, przyjmowanie po innych ćwiczeniach zagadnienia`.

### Task 3: Szkoła na przebiegu bazowym — bez podpowiedzi, prompt, usunięcie heurystyk

**Files:** `subjects/school/module.ts` (`baselinePool: true`), `agent-policy.ts` (`sanitize`: zdejmuje `hint` ze wszystkich ćwiczeń z notą `school.hint_open_answer_only`, cytaty przez `snapQuote`; bez `hintRevealing`, `hintJudgeTypes`, `openAnswerCheckTypes` i ich not), `validators.ts` (bez `termOccursIn`, `wordsOf`, `keyword_not_in_answer`), `rules.ts` (bez `school.keyword_not_in_answer`, `hint.reveals_words`; opis `school.hint_open_answer_only` dla modelu: szkoła nie pisze podpowiedzi), `school.rule-cases.ts`, `prompts.ts`; `lesson-pool-agent-tools.ts` tylko jeśli odwołuje się do usuniętej reguły; Delete `subjects/school/hint-gate.ts` (+ test), migawka agenta `lesson-pool-prompt.school.txt` i `school` z `SUBJECT_IDS`; testy: `school/*.test.ts`, `rules/{rule-book,rule-cases,catalog,rules.architecture}.test.ts`, `agent/admission.test.ts`, `contracts/src/messages.ts` (tekst `checkServiceInfoWithMaterial` bez sprawdzania podpowiedzi i próbnych odpowiedzi) z testami panelu.

- [ ] **Step 1: Testy** — `school module: baseline, no hint gate, no keyword heuristic, no 2b checks declared`; `sanitize removes hints from every fresh school exercise`; `parent edit keeps an open-answer hint`; `key term outside the model answer and the material is accepted` (`school.keywords_family_missing` dalej działa); `school sanitize runs before validation in the baseline`; `catalog: school without openCheckService, check service with material`.
- [ ] **Step 2: Prompt przed rundą 0** (`school/prompts.ts`, tekst bez konkretnych zdań przykładowych): `lesson_open_answer` — zdanie z `check.open_answer` (elementy wymagane spełnia każda poprawna wersja, przykłady do `supplementaryElements`) i przeciwwaga (nie usuwaj elementów, których pytanie naprawdę wymaga); pytanie zrozumiałe bez tekstu („według tekstu”, „w akapicie” — nie); bez podpowiedzi; `lesson_choice` / `lesson_cloze` — nota `check.blind_solve` szkoły (jedna poprawna opcja, żadne dwie zamienne luki); `lesson_calculation` — gdy materiał nie podaje metody, pusta lista wygrywa z zamówioną liczbą; przykład typu keywords w polityce szkoły bez klucza podanego w pytaniu.
- [ ] **Step 3:** FAIL → implementacja → `pnpm typecheck`, `pnpm test:unit` (z testami architektury) — PASS.
- [ ] **Step 4: Commit** `Etap 5b: szkoła na przebiegu bazowym bez podpowiedzi, usunięcie bramki podpowiedzi i heurystyki pojęć kluczowych`.

### Task 4: Fake'i, testy integracyjne i E2E szkoły

**Files:** `providers/fake-lesson-pool.ts` (`lesson_calculation` bez metody → `[]`; cytaty przechodzą `school.quote_*`); `tests/integration/lesson-agent-generation.test.ts`, `lesson-generation.test.ts` i inne skryptujące agenta szkoły (grep `school`) → fake paczek; blok 2b szkoły w integracji zostaje przepięty na przedmiot testowy albo czeka do 5c (decyzja przy implementacji, bez osłabiania asercji); E2E `real` z `grep -l school tests/e2e`.

- [ ] **Step 1:** Dodać `school lesson generates through the baseline` (etap zagadnień, paczki, keywords z rodziną, kontrola dostała `material`, brak podpowiedzi, szkic publikowalny), `school run resumes from an agent checkpoint` (Review Focus 5), `add N on a school objective` (bez keywords, `familyId` z sufiksem runu).
- [ ] **Step 2:** `pnpm test:integration` — PASS; speki E2E szkoły — PASS (zmiana oczekiwań tylko z uzasadnieniem w commicie).
- [ ] **Step 3: Commit** `Etap 5b: testy integracyjne i E2E szkoły na przebiegu bazowym`.

### Task 5: Narzędzia sondy (commit A, neutralny dla ramion)

**Files:** `tests/probes/blind/score.cjs` (`lesson_keywords` w W1 i W3; `W6h: (row) => row.type === "lesson_open_answer" && row.hasHint === true` — rubryka ją definiuje, werdykt nie może wywracać partii), `gen-blind-sheet.cjs` (`hasHint` w kluczu; `graderAvailable` poza polami równymi w ramionach; wiersz keywords z promptem pytania otwartego tej samej rodziny w kolumnie kontekstu), `chapter-generation.probe.test.ts` (`variantOf` z `baselinePool` rejestru; `UMIEM_PROBE_SCHOOL_SUBJECT` / `UMIEM_PROBE_TOPIC`, w zrzucie `subjectTitlePl`, `topicTitlePl`; koszt lekcji = `agentUsd + lessonObjectivesUsd`), materiały `tests/probes/fixtures/school-plant-parts.txt`, `school-baptism-poland.txt` (strojenie), `school-forest-layers.txt` (wstrzymany). Preflight i `probe-costs` bez zmian (ramię agenta dalej woła grader). Działa na `main` po 5a.

Materiał (każdy, tekst własny, fikcyjny, 1500–3000 znaków, format wklejki rodzica): 6–8 faktów z nazwami i datami; proces 4–6 kroków ściśle po kolei; ≥ 5 par pojęcie–definicja; klasyfikacja ≥ 2 grupy po ≥ 3 elementy; para łatwo mylonych pojęć; wyliczenie ≥ 3 przykładów; druga nazwa jednej rzeczy („X, czyli Y”); 2–3 związki przyczyna → skutek; pojęcia jednej kategorii; w jednym materiale strojenia prosta metoda obliczeń.

- [ ] **Step 1: Testy** — `score: W1 and W3 apply to lesson_keywords`; `score: W6h only on open answers with a hint`; `sheet: keywords row carries its family question`; `sheet: graderAvailable may differ between arms`.
- [ ] **Step 2:** FAIL → implementacja → PASS. SHA-256 materiałów i rubryki do PR.
- [ ] **Step 3: Commit** `Etap 5b: narzędzia sondy i materiały bramki szkoły`.

### Task 6: Wzorcowe szkoły (commit B, tylko gałąź 5b)

**Files:** `tests/probes/closed-check-gold.probe.test.ts` (`GoldFixture.subject` `"english_chapter" | "school"`, `material?`, keywords z `familyPrompt`; oczyszczenie i `school.quote_*`; `checkClosed` z `material`; raport per przypadek k/3), `tests/probes/fixtures/closed-check-gold-school.json` na materiale strojenia: poprawne po 4 keywords (2 z bliskimi dystraktorami), szkolny choice i order, po 2 match, group, cloze; błędny klucz mechanicznie z każdego poprawnego (§7.3); druga poprawna po 4 keywords i choice, po 2 match, group, cloze — każda z polem uzasadnienia z cytatem materiału, który czyni drugą odpowiedź poprawną.

- [ ] **Step 1: Test** `gold school: counts, structure, quote grounding and ideal check pass` (część bez sieci w `pnpm check`).
- [ ] **Step 2:** FAIL → implementacja → PASS.
- [ ] **Step 3: Commit** `Etap 5b: ćwiczenia wzorcowe kontroli szkoły`.

### Task 7: Dokumentacja

`docs/architecture.md` (§19.17: szkoła na przebiegu bazowym, keywords z pytaniem otwartym, materiał w kontroli, bez podpowiedzi; §23 bez zmian operacji), `AGENTS.md` (heurystyki szkoły usunięte; przebieg bazowy wszystkich przedmiotów; kontrola zamkniętych szkoły dostaje materiał i pytanie rodziny w keywords; szkoła bez kontroli 2b — kod do 5c), `docs/provider-config.md`, spec etapu 5 (status 5b). 

- [ ] **Commit** `Etap 5b: dokumentacja`.

### Task 8: Sprawdzenia, bilans i PR

- [ ] `pnpm check`, `pnpm test:integration`, `pnpm test:e2e:shards` (w tle), testy `*.architecture.test.ts` — PASS.
- [ ] Bilans §10 (metoda PR 5a) i znaki migawek promptów szkoły.
- [ ] Zapytanie tylko do odczytu o runy szkoły w toku — za zgodą właściciela.
- [ ] Trzech krytyków na całej gałęzi, potem `ponytail:ponytail-review`; wynik w PR.

### Task 9: Płatna bramka szkoły — runda 0 (bez kodu; §7.6, §7.7, v2.3)

Każdy płatny krok za zgodą właściciela; rejestr szkoły osobny, `UMIEM_PROBE_COSTS_CAP_USD=14`.

- [ ] **0. Notatka biegu** (poza repo): SHA ramion (agent: `main` po 5a + commit A; przebieg bazowy: commit gałęzi), modele (§7.1), `UMIEM_GRADER_*` w obu ramionach, ten sam rozmiar puli, przedmiot i temat per materiał.
- [ ] **1. Darmowy przegląd** przed wywołaniem OpenRouter: subagent sesji czyta migawki promptów szkoły (paczki wszystkich typów, lokalnie), prompt kontroli z materiałem i istniejące zrzuty agenta szkoły; poprawki tylko w `schoolPrompts`.
- [ ] **2. Wzorcowe** (`pnpm probe:gold`, `UMIEM_PROBE_GOLD_FIXTURE=closed-check-gold-school.json`, 3 powtórzenia).
- [ ] **3. Runda 0:** 2 materiały strojenia × (2 biegi bazowe + 1 bieg agenta), sędzia 1; po pierwszym biegu bazowym koszt wobec 0,80 USD — przekroczony → stop.
- [ ] **4. Darmowy przegląd zrzutów** obu ramion, liczby per wzorzec i ramię: powtarzane szablony i słowa z przykładów promptu; pytania otwarte — dwie różne odpowiedzi dziecka oparte na materiale vs `requiredElements` (zastępstwo W4); „podaj dwa / wymień” przy konkretnych przykładach w `requiredElements`; keywords (klucz w pytaniu, klucz spoza `requiredElements`, potrzebny dystraktor); audyt pole po polu match / group / cloze; fakt spoza cytatu; powtarzalne błędy polszczyzny; pytanie bez odpowiedzi bez materiału.
- [ ] **5. Strojenie** (gdy trzeba) — najwyżej 2 rundy × 4 biegi bazowe, sędzia 1 i darmowy przegląd, wyłącznie `schoolPrompts` i gałąź kontroli z materiałem.
- [ ] **6. Raport w PR** (§7.8 w zakresie sędziego 1): per klasa, ramię i materiał; W2 i W4 pytań otwartych (liczby wierszy), W2 i W4 luk osobno; minimum publikacji i „+N” per bieg; koszt i czas na lekcję; liczby per typ (cloze, group, rachunki); górna granica Wilsona W1; status decyzji właściciela.
- [ ] Poza tym PR: wspólne strojenie i bieg potwierdzający z sędzią 2 dla obu przedmiotów, przed scaleniem 5c (sędzia 2 na próbce warstwowej: wszystkie pytania otwarte, keywords, match, group, cloze i wiersze oznaczone przez sędziego 1 lub przegląd, ok. 25% pozostałych — decyzja właściciela).
