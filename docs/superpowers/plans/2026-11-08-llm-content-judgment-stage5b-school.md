# Etap 5b: szkoła na przebiegu bazowym — plan implementacji

Wersja 1, 2026-11-08, przed krytykami planu. Gałąź `feature/stage5b-school` stoi na PR 5a (`feature/stage5-chapter-school-d94618`, #376, jeszcze nie w `main`); po scaleniu 5a — rebase na `main` i przestawienie bazy PR.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `school` generuje się w workerze przebiegiem bazowym (paczki cel × typ, keywords razem z pytaniem otwartym → oczyszczenie i struktura → kontrola zamkniętych z materiałem → walidacja puli); znikają `hint-gate.ts`, `termOccursIn`, reguły `school.keyword_not_in_answer`, `school.keywords_family_rejected`, `hint.reveals_words` oraz kontrole 2b (sędzia podpowiedzi, rozwiązujący pytania otwarte, grader w workerze, `openCheckService` w DTO); narzędzia sondy, materiały i ćwiczenia wzorcowe szkoły są gotowe do bramki §7.6.

**Architecture:** W istniejących granicach: domena (`closed-check.ts`, `packet-plan.ts`, moduł szkoły, `agent/admission.ts`, `rules/lesson-rules.ts`), `modules/materials/lessons` (przebieg bazowy, agent bez 2b, katalog), porty i adaptery (`ports/ai.ts`, `providers/openai/lesson-pool-agent.ts`, `providers/openai-compatible/grader.ts`, `providers/lesson-agent-env.ts`, `config.ts`), fake'i, kontrakt katalogu i panel rodzica. Transakcje, punkt kontrolny (bez migracji), zapis szkicu, `withoutOrphanKeywords` / `ORPHAN_KEYWORDS_REASON` — bez zmian. Gramatyka i rozdział bez zmian zachowania.

**Tech Stack:** TypeScript strict, Vitest, Playwright, Drizzle (bez migracji), AI SDK w adapterze, Zod.

**Spec:** `docs/superpowers/specs/2026-11-08-llm-content-judgment-stage5-chapter-school-design.md` (v2.2, zatwierdzony; keywords w wariancie A) — §3, §4.4, §5, §7.1–§7.3, §7.6, §7.7 z §14 v2.2, §9, §10, §11, §12.

## Global Constraints

- Kod nie rozumie języka: `hint-gate.ts` i `termOccursIn` znikają bez warunku; bez nowych reguł tekstowych; `snapQuote` to normalizacja białych znaków i cudzysłowów oraz porównanie napisów. Reguły strukturalne szkoły zostają (cytaty, rodziny, rachunki, `school.hint_open_answer_only` jako oczyszczenie, `school.keywords_family_missing`).
- Do generatora paczki i kontroli żadnych danych dziecka; kontrola zamkniętych dostaje materiał lekcji wyłącznie przy `agentPolicy.checkerNeedsMaterial` (dziś tylko szkoła), keywords dodatkowo prompt pytania otwartego swojej rodziny; dziennik `[lesson-baseline]` bez treści.
- Wspólne prompty bez zmian bajt w bajt dla gramatyki i rozdziału: `closedCheckPrompt` i `packetInstructions` (migawki `lesson-closed-check-prompt.txt`, `lesson-packet-prompt.english_grammar_present_continuous.txt`, `lesson-packet-prompt.english_chapter_words_cloze.txt` nietknięte); nowy tekst tylko w gałęziach występujących wyłącznie z `material` albo z keywords dołączonymi do paczki pytań otwartych. `PACKET_RESERVE` = 3.
- `lessonAgentPublicFromEnv` nadal wymaga pełnego `UMIEM_GRADER_*` (grader ocenia dziecko); z DTO znika tylko etykieta.
- Usunięcie kontroli 2b (Task 4–5) w osobnych commitach — wariant awaryjny (§8, §5.3) cofa je jednym `git revert`.
- Bez migracji. API → MCP → skill: znika tylko opcjonalne pole panelu rodzica; `learning-overview` nie obejmuje lekcji, `integrations/umiem-mcp` nie zna katalogu lekcji (grep), MCP i `SKILL.md` bez zmian — uzasadnienie w PR. `OPENROUTER_API_KEY` tylko po https; bez identyfikatorów modeli w commitach i PR.

## Rozstrzygnięcia (rutynowe, przed krytykami)

1. **Prompt kontroli z materiałem.** `closedCheckPrompt` mówi „for a Polish child learning English”. Bez `material` tekst zostaje bajt w bajt; z `material` (tylko szkoła) pierwsze zdanie bez „learning English” i blok materiału przed pozycjami. To nowa gałąź, nie zmiana wspólnego tekstu.
2. **Dydaktyka z sekcji `checks` księgi reguł** (przebieg bazowy jej nie czyta): oprócz instrukcji podpowiedzi (§5.3) do `typeRules` szkoły przechodzą zdanie z `check.open_answer` (elementy wymagane spełnia każda poprawna wersja, przykłady do `supplementaryElements`) i nota szkoły do `check.blind_solve` (jedna poprawna opcja, żadne dwie zamienne luki).
3. **Ramię agenta:** przypięty `main` po scaleniu 5a (szkoła tam na agencie bez zmian) + wyłącznie commit narzędzi sondy z Task 7, SHA obu w zrzucie. Tytuł przedmiotu i temat z env sondy, równe w obu ramionach.
4. **Wzorcowe szkoły:** osobny komplet sześciu typów z materiałem (24 poprawne / 24 błędny klucz / 15 druga poprawna), jeden materiał na fixture.
5. **Keywords w „dodaj N”:** nie generujemy (limit kubełka liczy tylko bieżący run, więc „+N” mógłby przekroczyć „at most one per objective”).
6. **Cloze bez paczki** przy małym udziale guided: bez zmiany kodu, sonda raportuje liczby per typ; decyzja po rundzie 0.
7. **2b usunięte przed sędzią 2:** zgodnie z v2.2 decyzja o 2b zapada we wspólnym biegu końcowym; osobne commity pozwalają cofnąć.
8. **`quotesSnapped`:** przebieg bazowy dolicza wyrównane cytaty przyjętych ćwiczeń (rodzic nie traci informacji); `hintsRemoved` = 0 do 5c.
9. **Tekst panelu o kontroli** (`checkServiceInfoWithMaterial`) przestaje obiecywać sprawdzanie podpowiedzi i próbne odpowiedzi.
10. Migawka promptu agenta szkoły znika w 5b (jak rozdziału w 5a). Gałąź keywords w `objectiveInstructions` agenta zostaje do 5c.
11. Punkty 4–5 bramki §7.5 (materiał wstrzymany, „5 z 6”) dają werdykt dopiero we wspólnym biegu potwierdzającym (v2.2).

## Review Focus

1. Keywords, których pytanie otwarte jest w zapasie paczki albo odpadło: keywords przyjmowane po wszystkich innych ćwiczeniach zagadnienia, także po zapasach; keywords rodziny, której pytanie odpadło na strukturze, odpadają bez pozycji kontroli i bez osierocenia w puli (Task 2).
2. Paczka zwraca 2 keywords → przyjęte jedno, drugie `over_count`; keywords nie zajmują kubełka `independent` ani słuchania (Task 2).
3. Kontrola bez materiału ma prompt bajt w bajt jak dziś; kontrola szkoły dostaje materiał; uogólnienie werdyktu na zbiór kluczy nie zmienia wyniku typów jednego klucza (Task 1).
4. Run szkoły w toku przy wdrożeniu z punktem kontrolnym agenta (`dynamicTopic`, część zagadnień `complete`, stare `checkCounters`, kody `hint_*` / `open_not_accepted` w `rejectionCodes`) wznawia się przebiegiem bazowym; stare kody mają polskie etykiety w `rejectedReasons` (Task 4, Task 6).
5. Brak `UMIEM_GRADER_*` po usunięciu `openCheckService` dalej oznacza „generowanie niedostępne”; z pełną konfiguracją katalog nie ma `openCheckService`, panel nie obiecuje sprawdzania podpowiedzi (Task 5).

---

### Task 1: Kontrola keywords i materiał w kontroli zamkniętych

**Files:**
- Modify: `packages/server/src/domain/lessons/closed-check.ts`, `packages/server/src/ports/ai.ts` (`ClosedCheckInput.material?: string`), `packages/server/src/providers/openai/lesson-pool-agent.ts` (`closedCheckPrompt`, `checkClosed`), `packages/server/src/modules/materials/lessons/lesson-baseline-pool.ts`, `packages/server/src/providers/fake-lesson-pool.ts` (`fakeClosedAnswer` dla keywords)
- Test: `closed-check.test.ts`, `providers/openai/lesson-pool-prompt.test.ts` (nowa migawka `__snapshots__/lesson-closed-check-prompt.school.txt`), `providers/openai/lesson-pool-agent.test.ts`, `lesson-baseline-pool.test.ts`, `providers/fake-lesson-pool.test.ts`

**Interfaces:**
- `closedCheckContract("lesson_keywords") === "choice"`.
- `closedCheckItems(draft, topic, context?: { readonly familyPrompt?: string }): string[] | null` — keywords → `[solverView(draft, untitled) + "\nQuestion: " + familyPrompt]` (jedno pole: opcje = pojęcia, klucz = komplet `keyOptionIds`); keywords bez `familyPrompt` → `null`; pozostałe typy bez zmian.
- `fieldVerdict` przechodzi, gdy zbiór przypisanych kandydatów = zbiór klucza pola (niepusty); dla klucza jednoelementowego to dzisiejsza reguła.
- `closedCheckPrompt(input: Pick<ClosedCheckInput, "contract" | "items" | "material">)`: bez `material` tekst bez zmian; z `material` — pierwsze zdanie obu kontraktów bez „learning English”, `materialBlock(material)` przed `<ITEMS>`.
- Przebieg: `checkClosed({ contract, items, timeoutMs, ...(subject.agentPolicy.checkerNeedsMaterial ? { material: input.material } : {}) })`.

- [ ] **Step 1: Testy domeny** — `keywords: one item with the family question, concepts as options, no key` (1 pozycja z `Question: <prompt>` i posortowanymi pojęciami, bez tytułu celu, id opcji i wiersza `Field:`); `keywords without the family question has no item` (`null`); `keywords verdict: only the full key set passes` (komplet w innej wielkości liter → pass; podzbiór, komplet + dystraktor, `[]` → `check_wrong_set`; `null` → `check_unknown`); `single-key verdicts unchanged` (istniejące przypadki bez zmian oczekiwań).
- [ ] **Step 2: Testy adaptera i przebiegu** — `closed check prompt without material is unchanged` (istniejąca migawka); `closed check prompt with material` (nowa migawka: `<MATERIAL>` przed `<ITEMS>`, bez „learning English”); `school check carries the material, grammar check does not`; `fake closed answer reads the keywords key`.
- [ ] **Step 3:** `pnpm vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/closed-check.test.ts packages/server/src/providers/openai/lesson-pool-prompt.test.ts packages/server/src/modules/materials/lessons/lesson-baseline-pool.test.ts` — FAIL.
- [ ] **Step 4:** Implementacja według Interfaces (`multiFields` z gałęzią keywords; wiersz `Question:` w `closedCheckItems`, `solverView` agenta bez zmian).
- [ ] **Step 5:** testy z kroków 1–2 i `pnpm typecheck` — PASS.
- [ ] **Step 6: Commit** `Etap 5b: kontrola keywords i materiał w kontroli zamkniętych szkoły`.

### Task 2: Keywords w paczce pytań otwartych (wariant A)

**Files:**
- Modify: `packages/server/src/domain/lessons/packet-plan.ts`, `lesson-baseline-pool.ts`, `ports/ai.ts` (`LessonPacketInput.companion`), `providers/openai/lesson-pool-agent.ts` (`packetInstructions`, `packetSchema`), `providers/fake-lesson-pool.ts`
- Test: `packet-plan.test.ts`, `lesson-baseline-pool.test.ts`, `lesson-pool-prompt.test.ts` (migawka `lesson-packet-prompt.school_open_answer.txt`), `fake-lesson-pool.test.ts`

**Interfaces:**
- `PacketBucket` = `keyof StageCounts | "intro" | "listen" | "keywords"`; `bucketOf("lesson_keywords") → "keywords"`.
- `export const KEYWORDS_PER_OBJECTIVE = 1`; paczka planu ma `companion?: "lesson_keywords"`, `PacketPlan.caps.keywords: number`.
- `packetPlanForTargets(objective, targets, withNotice, listenAllowance, withKeywords = false)`: `withKeywords` → paczka `lesson_open_answer` z `companion`, `caps.keywords = KEYWORDS_PER_OBJECTIVE`; paczki typu keywords nie ma. `packetPlan` przekazuje `objective.exerciseTypes.includes("lesson_keywords")`; „dodaj N” — `false`.
- `LessonPacketInput.companion?: { readonly type: "lesson_keywords"; readonly max: number }`; `packetInput`: cel z `exerciseTypes: [type, companion]` (blok reguł keywords, enum schematu z oboma typami); `packetInstructions` dokłada jedno zdanie tylko przy `companion`.
- Przebieg (paczka z `companion`): rekord `companion` przyjmowany obok typu paczki, poza `packet.count`, ponad `max` → `over_count`; pozycja kontroli keywords z `familyPrompt` pierwszego strukturalnie poprawnego pytania otwartego tej paczki z tym samym `familyId`, bez takiego pytania `null` → `check_unknown` bez płatnej pozycji; walidacja puli: `[...udziały, ...zapasy]`, potem keywords zagadnienia, z limitem kubełka `keywords`.

- [ ] **Step 1: Testy planu** — `open answer packet carries the keywords companion`; `no companion without the keywords type or in the add plan`; `keywords have their own bucket`.
- [ ] **Step 2: Testy przebiegu** — `keywords are checked with the family question and admitted after the objective's other exercises` (pytanie rodziny w zapasie, keywords pierwsze w odpowiedzi → przyjęte, ostatnie w zagadnieniu, pozycja z `Question:`); `keywords whose family failed structure are dropped without a check item`; `at most one keywords per objective`; `keywords do not take an independent slot`; `keywords familyId matches its family after run scoping`.
- [ ] **Step 3: Testy adaptera i fake'a** — `packet prompt with the keywords companion` (migawka, enum `["lesson_open_answer", "lesson_keywords"]`, migawki gramatyki i rozdziału bez zmian); `fake open-answer packet with companion passes structure and check`.
- [ ] **Step 4:** testy z kroków 1–3 — FAIL → implementacja → PASS; `pnpm typecheck`.
- [ ] **Step 5: Commit** `Etap 5b: keywords w paczce pytań otwartych, kubełek z limitem 1, przyjmowanie po innych ćwiczeniach zagadnienia`.

### Task 3: Szkoła na przebiegu bazowym — oczyszczenie, prompt, usunięcie heurystyk

**Files:**
- Modify: `subjects/school/module.ts` (`baselinePool: true`), `agent-policy.ts` (`sanitize` bez `hintRevealing`: podpowiedź poza `lesson_open_answer` usunięta z notą `school.hint_open_answer_only`, cytaty przez `snapQuote`), `validators.ts` (bez `termOccursIn`, `wordsOf`, `keyword_not_in_answer`, `keywords_family_rejected`; ctx bez `rejectedFamilies`), `rules.ts` (bez `school.keyword_not_in_answer`, `school.keywords_family_rejected`, `hint.reveals_words`), `school.rule-cases.ts`, `prompts.ts`
- Modify: `domain/lessons/types.ts` (`validatePoolExtra` ctx bez `rejectedFamilies`), `agent/admission.ts` (bez `rejectedFamilies`), `lesson-pool-agent-tools.ts` (bez `HINT_REMOVED_RULE`; `hintsRemoved` = 0 do 5c), `lesson-baseline-pool.ts` (`quotesSnapped`)
- Delete: `subjects/school/hint-gate.ts` (+ test); migawka `providers/openai/__snapshots__/lesson-pool-prompt.school.txt` i `school` z `SUBJECT_IDS` w `lesson-pool-prompt.test.ts`
- Testy: `school/module.test.ts`, `school/agent-policy.test.ts`, `rules/rule-book.test.ts`, `rules/rule-cases.test.ts`, `rules/catalog.test.ts`, `rules/rules.architecture.test.ts` (`SUBJECT_HOOK_FILE` bez `hint-gate`), `agent/admission.test.ts`

- [ ] **Step 1: Testy** — `school module: baseline, no hint gate and no keyword heuristic`; `sanitize keeps an open-answer hint that shares words with the answer`; `sanitize removes a hint outside the open answer with the school.hint_open_answer_only note`; `key term outside the model answer and the material is accepted` (`school.keywords_family_missing` dalej działa); `school sanitize runs before validation in the baseline` (`stats.quotesSnapped === 1`); `hint instruction lives in the open-answer type rules` (bez „fewer than half”).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Prompt przed rundą 0** (`school/prompts.ts`): `typeRules.lesson_open_answer` — instrukcja podpowiedzi z `hint.reveals_words` bez liczenia słów + zdanie z `check.open_answer`; `typeRules.lesson_keywords` — wariant A („at most one in this response, for a family of the open questions you write now, with its familyId”); `typeRules.lesson_choice` / `lesson_cloze` — nota szkoły z `check.blind_solve`.
- [ ] **Step 4:** Implementacja.
- [ ] **Step 5:** `pnpm typecheck`, `pnpm test:unit` (z testami architektury) — PASS.
- [ ] **Step 6: Commit** `Etap 5b: szkoła na przebiegu bazowym, usunięcie bramki podpowiedzi i heurystyki pojęć kluczowych`.

### Task 4: Usunięcie kontroli 2b (serwer)

**Files:**
- Domena: `agent/admission.ts` (`CandidateChecks` bez `hint`/`open`, `AgentHintVerdict`, `OpenGraded`, `OpenCheckOutcome`, `hintFinding`, `openFinding`; `Rejection.kind` bez `"hint" | "open"`), `rules/lesson-rules.ts` (bez `check.hint_judge`, `check.open_answer`), `rules/lesson.rule-cases.ts`, `types.ts` (`SubjectAgentPolicy` bez `hintJudgeTypes`, `openAnswerCheckTypes`), `testing/test-agent-policy.ts`, `subjects/school/agent-policy.ts` (bez tych pól i not `check.hint_judge` / `check.open_answer`)
- Moduł: Delete `lesson-agent-check-run.ts` (+ test); `lesson-pool-agent-tools.ts`, `lesson-pool-agent.ts`, `lesson-pool-agent-policy.ts`, `lesson-agent-outcome.ts` (`agentCheckStartLine`, `checkCounters`), `lesson-agent-checkpoint.ts` (`checkCounters` poza schematem — `z.object` pomija klucz starych punktów), `lesson-agent-generation.ts`
- Porty i adaptery: `ports/ai.ts` (`judgeHints`, `solveOpen`, `HintVerdict`), `providers/openai/lesson-pool-agent.ts`, `providers/fake-lesson-agent.ts`, `providers/lesson-agent-env.ts` (bez gradera), `config.ts` (`agentGraderFromEnv`, `AgentGraderDeps`, `LessonAgentDeps.grader`), `providers/openai-compatible/grader.ts` (`usageLabel`, `cost` bez wołających)
- Testy do zmiany: `admission.checks.test.ts`, `lesson-pool-agent-tools.test.ts`, `lesson-pool-agent.test.ts`, `lesson-agent-outcome.test.ts`, `lesson-agent-checkpoint.test.ts`, `fake-lesson-agent.test.ts`, `openai/lesson-pool-agent.test.ts`, `config.test.ts`, `grader.test.ts`, `lesson-agent-env.test.ts`, `usage-recording.architecture.test.ts`, `grammar/agent-policy.test.ts`, `english-chapter/agent-policy.test.ts`, `rule-book.test.ts`

**Interfaces:** checker agenta: `solve`, `judgeVariants`, `checkClosed`. `AnswerGraderProvider.grade(input, signal)`. Etykiety `agentRejectionReasons` dla `hint_*` i `open_not_accepted` zostają do 5c.

- [ ] **Step 1: Testy** — `lessonAgentDepsFromEnv builds no grader`; `progress parser drops checkCounters of an old checkpoint`; `rejection labels of removed checks still map`; `grader records answer_grading only`.
- [ ] **Step 2:** FAIL → implementacja → `pnpm typecheck`, `pnpm test:unit` — PASS; `grep -rn "judgeHints\|solveOpen\|check_hints\|check_open\|check_grade\|AgentCheckRun\|hintJudgeTypes" packages apps` — tylko historia i etykiety.
- [ ] **Step 3: Commit** `Etap 5b: usunięcie kontroli 2b (sędzia podpowiedzi, rozwiązujący otwarte, grader w workerze)`.

### Task 5: `openCheckService` z katalogu i panelu

**Files:** `packages/contracts/src/lessons.ts`, `packages/contracts/src/messages.ts` (bez `openCheckServiceInfo`; nowy `checkServiceInfoWithMaterial`), `packages/server/src/config.ts`, `modules/materials/lessons/lesson-api.ts`, `apps/web/src/parent/lessons/lesson-service-info.ts`, `NewLessonForm.tsx`; testy: `contracts/src/lessons.test.ts`, `config.test.ts`, `lesson-api.test.ts`, `lesson-service-info.test.ts`, `new-lesson-form.test.tsx`, `sources-panel.test.tsx`.

- [ ] **Step 1: Testy** — `lessonAgentPublicFromEnv without UMIEM_GRADER_* is undefined`; `with the grader it has no openCheckService`; `catalog: school check service with material, no open-check service`; `service info has no open-check line`; schemat katalogu pomija dawne pole.
- [ ] **Step 2:** FAIL → implementacja → `pnpm typecheck`, `pnpm vitest run packages/contracts apps/web/src/parent` — PASS; `grep -rn "openCheckService\|checkService" integrations apps/web/src/integrations` pusty (do PR).
- [ ] **Step 3: Commit** `Etap 5b: bez usługi oceny odpowiedzi próbnych w katalogu lekcji i panelu`.

### Task 6: Fake'i, testy integracyjne i E2E szkoły

**Files:** `providers/fake-lesson-pool.ts` (`lesson_calculation` → `[]`, cytaty przechodzą `school.quote_*`); `tests/integration/lesson-agent-generation.test.ts` (przypadki szkoły → fake paczek; blok kontroli 2b usunięty), `tests/integration/lesson-generation.test.ts`, `lesson-error-explanation.test.ts`, `lesson-parent-api.test.ts` (jeśli skryptują agenta szkoły); E2E `real`: `grep -l school tests/e2e`.

- [ ] **Step 1:** Mechanika agenta szkoły i 2b usunięta; dodać `school lesson generates through the baseline` (etap zagadnień, paczki, keywords z rodziną, kontrola dostała `material`, szkic publikowalny), `school run resumes from an agent checkpoint` (Review Focus 4), `add N on a school objective` (bez keywords, `familyId` z sufiksem runu).
- [ ] **Step 2:** `pnpm test:integration` — PASS.
- [ ] **Step 3:** speki E2E szkoły — PASS; zmiana oczekiwań tylko z uzasadnieniem w commicie.
- [ ] **Step 4: Commit** `Etap 5b: testy integracyjne i E2E szkoły na przebiegu bazowym`.

### Task 7: Narzędzia sondy, materiały i wzorcowe szkoły (§7.1–§7.3)

**Files:**
- `tests/probes/blind/score.cjs`: `lesson_keywords` w W1 i W3; `W6h: (row) => row.type === "lesson_open_answer" && row.hasHint === true`; `lesson_calculation` tylko w W5, W6, W9; `heldOutClassPasses(defects, n)` (n < 34 → `defects <= 1`, inaczej `defects / n <= 0.03`) i flaga `--held-out`.
- `tests/probes/blind/gen-blind-sheet.cjs`: `hasHint` w kluczu; `graderAvailable` poza polami równymi w ramionach.
- `tests/probes/probe-preflight.ts`: szkoła bez wymogu gradera (2b usunięte). `tests/probes/probe-costs.ts`: bez szacunku `check_grade`.
- `tests/probes/chapter-generation.probe.test.ts`: `variantOf` z `baselinePool` rejestru; `UMIEM_PROBE_SCHOOL_SUBJECT` / `UMIEM_PROBE_TOPIC`, w zrzucie `subjectTitlePl` i `topicTitlePl`; bez gradera agenta; koszt lekcji = `agentUsd + lessonObjectivesUsd`.
- `tests/probes/closed-check-gold.probe.test.ts`: `GoldFixture.subject` `"english_chapter" | "school"`, `material?`, keywords z `familyPrompt`; oczyszczenie i `school.quote_*`; `checkClosed` z `material`; `closed-check-gold-school.json` = `[24, 24, 15]`.
- Create: `tests/probes/fixtures/closed-check-gold-school.json`; `school-water-cycle.txt`, `school-baptism-poland.txt` (strojenie), `school-polish-landscapes.txt` (wstrzymany) — tekst własny, fikcyjny, nagłówki z „:”, fakty, proces 4–6 kroków, klasyfikacja, pary pojęcie–definicja, para łatwo mylonych pojęć, pojęcia do keywords, bez metody obliczeń.
- Test: `tests/probes/blind/score.test.ts`, `tests/probes/probe-preflight.test.ts`, `tests/probes/probe-costs.test.ts`; część bez sieci złota w `pnpm check`. Rubryka `rubric-stage5.md` zamrożona, bez zmian.

- [ ] **Step 1: Testy** — `score: W1 and W3 apply to lesson_keywords`; `score: W6h only on open answers with a hint`; `score: lesson_calculation only in W5, W6, W9`; `held-out: below 34 one defect passes, two fail`; `held-out: from 34 the 3% threshold`; `school preflight needs no UMIEM_GRADER_*`; `gold school: counts, structure, quote grounding and ideal check pass`.
- [ ] **Step 2:** FAIL → implementacja → PASS.
- [ ] **Step 3:** SHA-256 materiałów, fixture'u wzorcowego i rubryki do opisu PR przed pierwszym płatnym biegiem.
- [ ] **Step 4: Commit** `Etap 5b: narzędzia sondy, materiały i ćwiczenia wzorcowe bramki szkoły`.

### Task 8: Dokumentacja

`docs/architecture.md` (§19.17, §19.3, §19.5, §23), `AGENTS.md` (heurystyki szkoły usunięte, agent puli tylko przedmiotu testowego, grader bez składania w workerze, przebieg bazowy wszystkich przedmiotów, bez 2b i `openCheckService`), `docs/provider-config.md`, spec kosztów `2026-11-02-llm-cost-tracking-design.md` (§2), spec zbiorczy (§3, §11) i spec etapu 5 (status 5b).

- [ ] **Step 1:** aktualizacja; **Step 2: Commit** `Etap 5b: dokumentacja`.

### Task 9: Sprawdzenia, bilans i PR

- [ ] `pnpm check`, `pnpm test:integration`, `pnpm test:e2e:shards` (w tle), testy `*.architecture.test.ts` — PASS.
- [ ] Bilans §10 (ta sama metoda co w PR 5a: ścieżki §9.2, bez testów i `*.rule-cases.ts`) — porównanie z „po 5a” i szacunkiem „po 5b”; znaki migawek promptów szkoły.
- [ ] Zapytanie tylko do odczytu o runy szkoły w toku — za zgodą właściciela.
- [ ] Trzech krytyków na całej gałęzi, potem `ponytail:ponytail-review`; wynik w PR. Opis PR: API → MCP → skill, tekst panelu, 2b w osobnych commitach.

### Task 10: Płatna bramka szkoły (bez kodu; §7.6, §7.7 z v2.2)

Każdy płatny krok za zgodą właściciela; rejestr szkoły osobny, `UMIEM_PROBE_COSTS_CAP_USD=14`.

- [ ] **0. Notatka biegu** (poza repo): SHA obu ramion (Rozstrzygnięcie 3), modele i reasoning (§7.1), `UMIEM_GRADER_*` w obu ramionach, ten sam `UMIEM_PROBE_POOL_SIZE`, przedmiot i temat per materiał.
- [ ] **1. Darmowy przegląd** przed jakimkolwiek wywołaniem OpenRouter: subagent sesji czyta migawki promptów szkoły (paczki wszystkich typów lokalnie, bez sieci), prompt kontroli z materiałem i istniejące zrzuty agenta szkoły; poprawki tylko w `schoolPrompts`.
- [ ] **2. Wzorcowe** (`pnpm probe:gold`, `UMIEM_PROBE_GOLD_FIXTURE=closed-check-gold-school.json`, 3 powtórzenia).
- [ ] **3. Runda 0:** 2 materiały strojenia × 2 ramiona × 2 biegi, sędzia 1; po pierwszym biegu bazowym koszt wobec 0,80 USD — przekroczony → stop i decyzja właściciela.
- [ ] **4. Strojenie** — najwyżej 2 rundy × 4 biegi bazowe, sędzia 1, wyłącznie `schoolPrompts` i część kontroli wielu pól / keywords / materiału; po każdej rundzie najpierw darmowy przegląd zrzutów.
- [ ] **5. Raport w PR** (§7.8 w zakresie sędziego 1): per klasa, ramię i materiał; W6h i W2 pytań otwartych osobno; minimum publikacji i „+N” per bieg; koszt i czas na lekcję; liczby per typ; status decyzji właściciela.
- [ ] Poza tym PR: wspólne strojenie końcowe i bieg potwierdzający z sędzią 2 dla obu przedmiotów (v2.2) — przed scaleniem 5c.
