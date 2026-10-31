# Etap 3: lektor po odpowiedzi w rozdziale — plan wdrożenia (na mechanizmie #194)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lekcja „Angielski — rozdział” po ocenionej odpowiedzi czyta pełne poprawne zdanie po angielsku (`en-GB`) — tym samym mechanizmem, który `main` dostał w #194 dla gramatyki (`ttsForFeedbackSentence`, rola `feedback_audio`, nagranie zamrożone w prywatnym kluczu zadania, autoodtwarzanie raz + „Posłuchaj zdania”).

**Zmiana planu (2026-10-31):** pierwotny plan Etapu 3 (osobna flaga `ttsForFeedback`, własna migracja roli `feedback_audio`, wyszukanie nagrania przy ocenie, głośnik bez autoodtwarzania) nie trafił do repozytorium, bo właściciel scalił #194 z generycznym odczytem zdania. Ten plan dodaje tylko to, czego rozdział potrzebuje ponad #194. Zachowanie Kid UI (autoodtwarzanie raz, „Dalej” przerywa, „Nie pamiętam” zostaje na wyniku) przejmujemy z #194 — to decyzja właściciela dla lekcji i obowiązuje także rozdział.

**Architecture:** Bez nowej migracji, roli ani kontraktu. Domena: `feedbackSentenceText` obsługuje `lesson_cloze`. Przedmiot: `englishChapterSubject.ttsForFeedbackSentence = true`. Silnik prób: generyczna bramka w `withFeedbackSentenceAudio` — gdy omówienie pokazuje `correctText` inny niż kanoniczny tekst rozwiązania (najbliższy zatwierdzony wariant), nagrania nie ma (dziecko nie słyszy innego zdania niż widzi; design rozdziału §5.2).

**Spec:** `docs/superpowers/specs/2026-10-30-english-chapter-design.md` §5 (zaktualizowany w Task 3), `docs/superpowers/specs/2026-10-30-lesson-sentence-readback-design.md` (#194).

## Global Constraints

- Gałąź `claude/english-chapter-3-readback` od głowy `claude/english-chapter-2-sources` po scaleniu `main` (PR #193); PR z bazą `claude/english-chapter-2-sources`, po scaleniu #193 — `main`.
- Silnik lekcji bez gałęzi po identyfikatorze przedmiotu (`architecture.test.ts`, skan literałów id). Zmiana bramki jest generyczna — obejmuje też gramatykę; szkoła ma flagę `false`.
- Kid DTO bez klucza odpowiedzi; identyfikator nagrania wyłącznie w `FeedbackDto` po ocenie (bez zmian względem #194).
- Bez nowej migracji. Bez zmian kontraktów `packages/contracts` (poza komentarzem, jeśli potrzebny). API → MCP → skill: brak wpływu.
- Nigdy `npm install`; commity po polsku z linią `Co-Authored-By` zgodną z wytycznymi sesji.

## Review Focus

1. Tekst nagrania luk z bankiem słów równy `filledText` z klucza zadania (to, co omówienie pokazuje) po ujednoliceniu białych znaków (nagranie jest przycięte i ma scalone białe znaki, bez spacji przed `.,!?`, a klucz trzyma surowy wynik `fillCloze`); niepełne luki → brak nagrania.
2. Bramka wariantu: `lesson_almost` z najbliższym wariantem ≠ kanoniczna odpowiedź → brak `correctAudioAssetId` i brak `audio_issued`; z wariantem równym kanonicznej → nagranie. Gramatyka: to samo.
3. Rozdział: ekspozycja pieczęci `audio_issued` = `targetKey` zadania (rozwiązane zdanie, kontrakt Etapu 1).
4. Dok omówienia z „Posłuchaj zdania” przy tekście z lukami (dłuższy bodziec) na telefonie w poziomie i przy niskiej wysokości.

---

### Task 1: Rozdział z odczytem zdania (serwer)

**Files:** Modify `packages/server/src/domain/lessons/feedback-sentence-text.ts` (+ test), `packages/server/src/modules/materials/media-reconciliation.ts` (`feedbackSourceOf`: `clozeText`, `gapAnswers`) i inne miejsca budujące `FeedbackSentenceSource` (grep), `packages/server/src/domain/lessons/subjects/english-chapter/module.ts` (+ `module.test.ts`), `packages/server/src/modules/learning/lessons/lesson-attempts.ts` (`withFeedbackSentenceAudio`; + `lesson-attempts.test.ts`); tests: integracja rozdziału (nowy plik `tests/integration/lesson-chapter-sentence-audio.test.ts` w najlżejszym koszu `tests/integration-buckets.ts` albo `describe` w `lesson-sentence-audio.test.ts`).

**Interfaces:**
- `feedbackSentenceText({ exerciseType: "lesson_cloze", clozeText, gapAnswers })` = `fillCloze(clozeText, gapAnswers)` (`domain/lessons/cloze.ts`), gdy liczba luk = liczba niepustych odpowiedzi; inaczej `null`; dalej wspólne zasady (białe znaki, ≤ 200 znaków).
- `englishChapterSubject.ttsForFeedbackSentence = true`.
- `withFeedbackSentenceAudio(feedback, key)` (lub z `task`, jeśli `correctTextFor` tego wymaga): dodatkowo brak nagrania, gdy `feedback.correctText !== undefined` i różni się od kanonicznego `correctTextFor(task, key)`.

- [ ] Testy (failing): unit — cloze (pełne, za mało odpowiedzi, za dużo, bez luk, > 200 znaków); flaga rozdziału; bramka wariantu (wariant ≠ kanoniczna → bez nagrania; równy → z nagraniem; `great` bez `correctText` → z nagraniem). Integracja (PostgreSQL, wzór `lesson-sentence-audio.test.ts`): szkic rozdziału zleca `feedback_audio` `en-GB` bez stylu dla wyboru z luką, luki, luk z bankiem, układanki i tłumaczenia, nie dla par, grup, karty i wyboru bez luki; po publikacji i workerze feedback próby niesie `correctAudioAssetId`, `audio_issued` raz, `occurredAt > receivedAt`, ekspozycja = `targetKey`; tłumaczenie z „prawie” i pokazanym innym wariantem — bez nagrania i bez pieczęci. → implementacja → PASS (`corepack pnpm exec vitest run --config vitest.unit.config.ts packages/server`; integracja: nowy plik + `lesson-sentence-audio`, `lesson-chapter`, `lesson-attempts`, `lesson-grader`, `grammar-without-tts`; `corepack pnpm typecheck`) → commit `Rozdział: odczyt zdania po odpowiedzi`.

### Task 2: Geometria doku z tekstem z lukami (E2E)

**Files:** Modify `tests/e2e/lesson-sentence-audio.spec.ts` (albo nowy mockowany spec + `tests/e2e/spec-projects.ts`), fixture lekcji w `tests/fixtures/` jeśli potrzebny.

- [ ] Mockowany przypadek: zadanie `lesson_cloze` z bankiem słów, feedback z `correctAudioAssetId`; 360×800, 812×375 (landscape), wysokość < 480, 768×1024: dok z „Posłuchaj zdania” i „Dalej” w viewporcie, brak przepełnienia poziomego, cele ≥ 48 px, odtworzenie `mediaUrl` raz po odpowiedzi. → PASS (`corepack pnpm build`; `UMIEM_E2E_SKIP_BUILD=1 corepack pnpm exec playwright test tests/e2e/lesson-sentence-audio.spec.ts`) → commit `Rozdział: geometria odczytu zdania przy lukach z bankiem`.

### Task 3: Dokumentacja

**Files:** `docs/superpowers/specs/2026-10-30-english-chapter-design.md` (§4.1 opcje przedmiotu, §5 — zrealizowane na mechanizmie #194 z różnicami, §10 „Stan Etapu 3”, §11 błąd obrazka naprawiony w #187/#189), `docs/superpowers/specs/2026-10-30-lesson-sentence-readback-design.md` (§2 rozdział włączony, §4 `lesson_cloze`, §6 bramka wariantu), `docs/SPEC.md` §37, `docs/architecture.md` §19.9.

- [ ] Commit `Rozdział: dokumentacja odczytu zdania (Etap 3)`.

### Task 4: Weryfikacja i PR

- [ ] `corepack pnpm typecheck`, `test:unit`, `test:integration`, `test:e2e:shards` — PASS.
- [ ] Niezależny przegląd kilkoma subagentami; jedna fala poprawek; ponowna weryfikacja.
- [ ] Push i PR (baza wg Global Constraints): zakres, brak migracji, wpływ API → MCP → skill (brak), wdrożenie (opublikowane lekcje rozdziału dostają nagrania po nowej wersji, jak w #194), nota o zmianie zachowania gramatyki — „Prawie!” z wariantem innym niż kanoniczna odpowiedź nie dostaje już odczytu zdania (bramka wariantu); #194 może być już wdrożony, więc zmiana jest widoczna także poza rozdziałem, sprawdzenia, niezweryfikowane (wymowa `en-GB` i autoodtwarzanie na urządzeniu, pilotaż).
