# Odczyt pełnego zdania po odpowiedzi — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Po każdej ocenionej odpowiedzi w ćwiczeniu gramatyki dziecko automatycznie słyszy pełne poprawne zdanie (en-GB) i może je powtórzyć przyciskiem.

**Architecture:** Czysta funkcja domenowa składa zdanie z zatwierdzonego payloadu. `materials` planuje nagranie w nowej roli `feedback_audio`; worker generuje je jak inne TTS. `learning/lessons` zamraża identyfikator nagrania w prywatnym kluczu zadania i ujawnia go w feedbacku (`correctAudioAssetId`). Ujawnienie odbywa się razem z zapieczętowanym `audio_issued` w transakcji finalizacji próby (wzorzec #187). Kid UI odtwarza nagranie automatycznie i pokazuje przycisk powtórki w doku feedbacku.

**Tech Stack:** TypeScript strict, Drizzle + PostgreSQL, Zod (`packages/contracts`), React (Kid UI), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-lesson-sentence-readback-design.md`

## Global Constraints

- Tylko przedmiot `english_grammar`: `ttsForFeedbackSentence: true`. `school` i testowy `history-like-subject` mają `false`. `ttsForAnswers` gramatyki pozostaje `false`.
- Nowa rola zasobu: dokładnie `feedback_audio`, migracja `0029`. Schemat Drizzle, CHECK i `AssetRole` zmieniają się razem.
- Nagranie: locale `answerLocale` (en-GB), **bez stylu wypowiedzi**.
- Publikacja nigdy nie czeka na `feedback_audio`. Rola nie trafia do DTO zasobów rodzica.
- Zdanie: dłuższe niż 200 znaków albo puste → brak nagrania.
- Feedback niesie `correctAudioAssetId` tylko w treningu (nigdy w kartkówce). Wymaga feedbacku ≠ `null`, `revealsAnswer(feedback)` i `kind !== "lesson_precision_hint"`. Nie dotyczy ofert trenera precyzji.
- `audio_issued`: ekspozycja `[targetKey]`, `occurredAt = max(now, receivedAt + 1 ms)`, w tej samej transakcji co feedback.
- Kid UI: tekst przycisku `messages.kid.listenExample` („Posłuchaj zdania”), cel ≥ 48 px, bez surowych `<button>`, bez literałów koloru i rozmiaru poza blokiem tokenów.
- Brak zmian w MCP i `SKILL.md` — potwierdzić wyszukaniem i opisać w PR.

## Review Focus

1. **Ponowny odczyt tej samej próby**, np. druga przeglądarka albo reconnect. Oczekiwanie: ten sam `correctAudioAssetId`, bez drugiego `audio_issued`. Test w zadaniu 4.
2. **Zadanie wydane, zanim nagranie było gotowe.** Oczekiwanie: feedback bez audio i bez przycisku, mimo że nagranie stało się gotowe później. Test w zadaniu 4.
3. **„Dalej” w trakcie odczytu.** Oczekiwanie: dźwięk cichnie natychmiast, a kolejne zadanie nie dostaje „starego” odtwarzania. Test w zadaniu 5.
4. **Przeglądarka blokuje `play()`** (`NotAllowedError`). Oczekiwanie: brak komunikatu błędu, przycisk działa. Test w zadaniu 5.
5. **Ponowna publikacja kopii lekcji bez zmian treści.** Oczekiwanie: zlecone `feedback_audio`, a stare zgodne nagrania nie są generowane drugi raz. Test w zadaniu 2.

---

### Task 1: Pełne zdanie ćwiczenia (domena)

**Files:**
- Create: `packages/server/src/domain/lessons/feedback-sentence-text.ts`
- Test: `packages/server/src/domain/lessons/feedback-sentence-text.test.ts`

**Interfaces:**
- Produces:
  - `interface FeedbackSentenceSource { exerciseType: string; stem?: string; answer?: string; options?: readonly { id: string; text: string }[]; correctOption?: string; items?: readonly { id: string; text: string }[] }`
  - `feedbackSentenceText(source: FeedbackSentenceSource): string | null`
  - `FEEDBACK_SENTENCE_MAX_LENGTH = 200`

- [ ] **Step 1: Write failing tests** (`describe("feedbackSentenceText")`):
  - `lesson_gap`: `{stem:"She ___ football.", answer:"plays"}` → `"She plays football."`; `stem:"She ____ football."` (4 podkreślenia) → to samo; dwie luki → `null`; brak luki → `null`.
  - `lesson_choice`: `{stem:"___ is happy.", options:[{id:"a",text:"He"},{id:"b",text:"She"}], correctOption:"b"}` → `"She is happy."`; stem bez luki → `null`; nieznane `correctOption` → `null`.
  - `lesson_order`: items `["She","plays","football","."]` → `"She plays football."`; `["Yes", ",", "I", "am", "."]` → `"Yes, I am."`.
  - `lesson_error_fix` / `lesson_transform` / `lesson_open_answer`: `answer:"  She  plays football every day. "` → `"She plays football every day."`.
  - `lesson_card`, `lesson_notice`, `lesson_short_answer`, `lesson_match`, `lesson_group`, `lesson_cloze`, `lesson_calculation`, `lesson_keywords` → `null`.
  - `answer` o długości 201 znaków → `null`; o długości 200 → tekst.
- [ ] **Step 2:** Run `corepack pnpm vitest run packages/server/src/domain/lessons/feedback-sentence-text.test.ts` → FAIL (moduł nie istnieje).
- [ ] **Step 3:** Implement. Lukę rozpoznaje regex `/_{2,}/g`, jak w `question-read-text.ts`. Białe znaki są scalane, a przed `.,!?` usuwana jest spacja. Domena nie importuje niczego spoza `domain/`.
- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit `feat(lessons): pełne zdanie ćwiczenia do odczytu po odpowiedzi`.

### Task 2: Flaga przedmiotu, rola `feedback_audio` i planowanie nagrań

**Files:**
- Modify:
  - `packages/server/src/domain/lessons/types.ts` (`SubjectModule.ttsForFeedbackSentence: boolean` z komentarzem);
  - `subjects/english-grammar/module.ts` (`true`), `subjects/school/module.ts` (`false`), `testing/history-like-subject.ts` (`false`);
  - `packages/server/src/db/schema.ts:367` (CHECK roli);
  - `packages/server/src/modules/materials/media-reconciliation.ts`;
  - `packages/server/src/modules/materials/media-generation.ts:87-93`;
  - `packages/server/src/modules/materials/lessons/lesson-api.ts:248,286` (pominięcie roli w DTO rodzica);
  - miejsca, które budują `LessonTtsFlags` z przedmiotu.
- Create: `packages/server/drizzle/0029_feedback_audio_role.sql` (wzorem `0027`) + wpis w journalu Drizzle (`pnpm drizzle-kit generate` albo ręcznie, zgodnie z konwencją repo).
- Test: `media-reconciliation.test.ts`, `subjects/english-grammar/module.test.ts`, `subjects/school/module.test.ts`; integracyjny test publikacji lekcji (istniejący plik od publikacji/mediów lekcji).

**Interfaces:**
- Consumes: `feedbackSentenceText` (zadanie 1).
- Produces:
  - `AssetRole` zawiera `"feedback_audio"`;
  - `LessonTtsFlags { ttsForAnswers; ttsForPrompts; ttsForFeedbackSentence: boolean }`;
  - `requiredAssetsForLessonExercise` dodaje `ttsAsset("feedback_audio", text, answerLocale, settings)` bez stylu.

- [ ] **Step 1: Failing unit tests:**
  - gramatyczna luka z flagą → wśród wymaganych jest `{role:"feedback_audio", metadata.text:"She plays football.", metadata.locale:"en-GB"}` bez `instructions` stylu, a ich `instructions` są równe instrukcjom języka dla en-GB;
  - flaga `false` → brak `feedback_audio`;
  - `lesson_match` → brak;
  - zmiana `answer` → inny fingerprint;
  - `englishGrammarSubject.ttsForFeedbackSentence === true`, `schoolSubject.ttsForFeedbackSentence === false`.
- [ ] **Step 2:** Run the three unit files → FAIL.
- [ ] **Step 3:** Implement:
  - flagę i planowanie;
  - migrację `0029`: DROP + ADD `revision_assets_role_allowed` z `'feedback_audio'`;
  - przy `keepFailed` warunek `req.role !== "prompt_audio"` rozszerzony o `feedback_audio`;
  - w `supersedeDisabledLessonTts` rola `feedback_audio` → `!subject.ttsForFeedbackSentence`;
  - DTO rodzica pomija `feedback_audio` tak jak `prompt_audio`;
  - walidacja publikacji nie sprawdza `feedback_audio` (dziś sprawdza tylko `target_audio` — upewnij się, że tak zostaje).
- [ ] **Step 4: Failing integration tests** (PostgreSQL), w pliku testów publikacji lekcji:
  - publikacja lekcji gramatyki przy `pending` `feedback_audio` → sukces;
  - `createLessonDraftFromPublished` + `publishLessonDraft` lekcji opublikowanej przed zmianą (wiersze `revision_assets` bez `feedback_audio`) → po publikacji istnieją `revision_assets` roli `feedback_audio` i zlecone `media_assets` `pending`; drugie takie przejście nie tworzy nowych `media_assets` dla tych samych fingerprintów;
  - INSERT roli `feedback_audio` przechodzi przez CHECK.
- [ ] **Step 5:** Run `corepack pnpm test:integration` z filtrem pliku (`UMIEM_INTEGRATION_BUCKET` albo ścieżka) → FAIL, potem implementacja/poprawki → PASS. Jeśli `LessonEditor` blokuje publikację kopii bez zmian (`isDirty`/`publishDisabled`), dodaj minimalną poprawkę i test komponentu; jeśli nie blokuje, zanotuj to w dzienniku PR.
- [ ] **Step 6:** Run `corepack pnpm vitest run packages/server/src/modules/module-boundaries.architecture.test.ts` → PASS.
- [ ] **Step 7:** Commit `feat(media): nagranie zdania feedbacku lekcji (rola feedback_audio, migracja 0029)`.

### Task 3: Klucz zadania niesie nagranie zdania

**Files:**
- Modify:
  - `packages/server/src/modules/learning/lessons/lesson-sessions.ts:259-320,830`;
  - `lesson-materialize.ts:176-200` (oraz typ `LoadedExercise`);
  - `lesson-attempts.ts:95` (`LessonTaskAnswerKey.feedbackAudioAssetId?: string`);
  - `lesson-mock-tests.ts` (loader kartkówki z `feedbackAudio: false`).
- Test: `lesson-materialize.test.ts`.

**Interfaces:**
- Produces:
  - `LoadedExercise.feedbackAudioAssetId: string | null`;
  - `loadExercises(exec, deckVersionId, options: { questionAudio?: boolean; feedbackAudio?: boolean })`;
  - prywatny klucz zadania z `feedbackAudioAssetId` tylko gdy `subject.ttsForFeedbackSentence && !mockTest && exercise.feedbackAudioAssetId`.

- [ ] **Step 1: Failing unit tests** w `lesson-materialize.test.ts`:
  - trening + flaga + id → `key.feedbackAudioAssetId === id`, a prompt (Kid DTO) nie zawiera tego id w żadnym polu (`JSON.stringify(prompt)` bez id);
  - `mockTest: true` → brak w kluczu;
  - przedmiot z flagą `false` → brak.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Rozwiązywanie nagrania jest takie jak `prompt_audio`: join po `expectedFingerprint`, `kind='tts'`, `state='ready'`, najnowsza `generationNumber`, rola `feedback_audio`. Loader kartkówki wyłącza je opcją.
- [ ] **Step 4:** Run → PASS; `corepack pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(lessons): zadanie zamraża nagranie zdania w prywatnym kluczu`.

### Task 4: Feedback ujawnia nagranie z zapieczętowanym `audio_issued`

**Files:**
- Modify:
  - `packages/server/src/modules/learning/events.ts` (nowy helper);
  - `packages/server/src/modules/learning/attempts.ts:398-419` (słówka przechodzą na helper);
  - `lesson-attempts.ts`: `finalizeLessonAttempt` ok. `:1095`, `finalizeGradedAttempt` ok. `:1573`, ścieżka leniwej finalizacji, jeśli buduje feedback;
  - `packages/contracts/src/kid.ts:648-654` (komentarz pola uogólniony; schemat bez zmian).
- Test: integracyjny plik prób lekcji (istniejący od `submitLessonAttempt`) oraz istniejący test słówek z #187 jako regresja.

**Interfaces:**
- Consumes: `LessonTaskAnswerKey.feedbackAudioAssetId` (zadanie 3), `revealsAnswer` (już w `lesson-attempts.ts`).
- Produces:
  - `sealPostAnswerAudio(tx: Tx, input: { childId: string; taskId: string; itemId: string; targetKey: string; receivedAt: Date; now: Date }): Promise<void>` w `learning/events.ts`;
  - `withFeedbackSentenceAudio(feedback: FeedbackDto | null, key: LessonTaskAnswerKey): FeedbackDto | null` w `lesson-attempts.ts` (czysta: dokleja `correctAudioAssetId` według reguł z Global Constraints).

- [ ] **Step 1: Failing integration tests** (gramatyka, nagranie `ready` przed wydaniem zadania):
  - feedback zawiera `correctAudioAssetId` dla: wyboru poprawnego (`great`), wyboru błędnego (`incorrect`), luki „prawie” (`lesson_almost`), „Nie pamiętam”, werdyktu modelu `model_incorrect` (fake grader);
  - brak `correctAudioAssetId` dla: „Pomiń”, `not_assessed` (brak modelu przy `no_match`), kartkówki (feedback `null`), nagrania jeszcze `pending` przy wydaniu i `ready` przy odpowiedzi;
  - dla każdego przypadku z audio istnieje dokładnie jedno zapieczętowane `audio_issued` z `occurredAt > attempt.receivedAt` i ekspozycją `targetKey`, a ocena próby ma `independent` jak bez nagrania;
  - `readLessonAttempt` (ponowny odczyt) zwraca ten sam `correctAudioAssetId` i nie dodaje zdarzenia;
  - regresja słówek `picture_recognition` (#187) przechodzi bez zmian.
- [ ] **Step 2:** Run plik integracyjny → FAIL.
- [ ] **Step 3:** Implement. W obu ścieżkach `withFeedbackSentenceAudio` stosuje się przed zapisem `attempts.feedback`. Po `discloseLessonFeedback`, gdy feedback ma `correctAudioAssetId`, wywołaj `sealPostAnswerAudio`. `stepId` liczony jak w `attempts.ts` (`${taskId}:d${prior+1}` po `audio_issued`/`hint_issued`). Słówka używają tego samego helpera.
- [ ] **Step 4:** Run test integracyjny + `corepack pnpm vitest run packages/contracts` → PASS.
- [ ] **Step 5:** Commit `feat(lessons): feedback ujawnia nagranie zdania z pieczęcią audio_issued`.

### Task 5: Kid UI — automatyczny odczyt i przycisk „Posłuchaj zdania”

**Files:**
- Modify:
  - `packages/kid-ui/src/session/session-controller.ts` (po przyjęciu wyniku próby ok. `:1250`; nowa metoda obok `playCorrectOptionAudio` `:1305`);
  - `packages/kid-ui/src/screens/ExerciseFeedbackDock.tsx` (+ `.module.css` tylko przez tokeny);
  - `packages/kid-ui/src/screens/LearnScreen.tsx` (przekazanie do doku dla zadań `lesson_*`).
- Test:
  - `session-controller` test (istniejący plik kontrolera);
  - `ExerciseFeedbackDock.test.tsx`;
  - nowy `tests/e2e/lesson-sentence-audio.spec.ts` (projekt `mocked`, wpis w `tests/e2e/spec-projects.ts`);
  - przypadek geometrii w istniejącym specu layoutu lekcji (`lesson-question-audio-layout.spec.ts` jako wzór).

**Interfaces:**
- Consumes: `FeedbackDto.correctAudioAssetId` w odpowiedzi próby lekcji (zadanie 4).
- Produces:
  - `controller.playSentenceAudio(): Promise<void>` (ręczna powtórka);
  - automatyczne wywołanie tego samego kanału po wyniku próby;
  - `ExerciseFeedbackDock` prop `sentenceAudio?: { onPlay: () => void } | null`.

- [ ] **Step 1: Failing unit tests:**
  - kontroler: wynik próby lekcji z `correctAudioAssetId` → jedno odtworzenie `mediaUrl(id)` bez akcji użytkownika;
  - wynik bez id → brak odtworzenia;
  - odrzucone `play()` (`NotAllowedError`) → stan bez `audioError`/komunikatu;
  - przejście do następnego zadania w trakcie → `#stopPlayback` wywołane, a spóźnione zakończenie nie zmienia stanu nowego zadania;
  - `picture_recognition` nie odtwarza automatycznie (bez regresji);
  - dok: przy `sentenceAudio` renderuje `ListenButton` z `aria-label="Posłuchaj zdania"`, klik woła `onPlay`; bez propsa brak przycisku.
- [ ] **Step 2:** Run `corepack pnpm vitest run packages/kid-ui` (pliki kontrolera i doku) → FAIL.
- [ ] **Step 3:** Implement. Automatyczny odczyt tylko dla zadań `lesson_*` w treningu, przez `#beginPlayback`/`#playCountedAudio` jak `playCorrectOptionAudio`. Prefetch następnego zadania bez zmian. Bez nowych surowych kontrolek; przycisk to `ListenButton`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Failing E2E** `lesson-sentence-audio.spec.ts` (fixture `installKidUiFixture`, spy na `HTMLMediaElement.prototype.play`):
  - odpowiedź w luce → `play` wywołane raz z URL nagrania, widoczny przycisk „Posłuchaj zdania”;
  - klik przycisku → drugie odtworzenie;
  - klik „Dalej” w trakcie → `pause` wywołane, następne zadanie bez przycisku;
  - `play` odrzucane → brak komunikatu błędu, przycisk widoczny;
  - feedback bez id → brak przycisku.
  - Geometria: przycisk ≥ 48×48 px w całości w viewporcie i w doku, brak przepełnienia poziomego. Rozmiary: 375×812, 812×375, 768×1024, 1280×800.
- [ ] **Step 6:** Run `UMIEM_E2E_WEB_MODE=dev corepack pnpm exec playwright test tests/e2e/lesson-sentence-audio.spec.ts` → FAIL, potem PASS po poprawkach. `corepack pnpm vitest run tests/e2e/spec-projects.test.ts tests/kid-design-tokens.test.ts` → PASS.
- [ ] **Step 7:** Commit `feat(kid-ui): automatyczny odczyt zdania po odpowiedzi w lekcji i „Posłuchaj zdania”`.

### Task 6: Dokumentacja i pełne bramki

**Files:**
- Modify:
  - `.kiro/specs/grammar-module/requirements.md:53` (nowe brzmienie 2.13 z §3 specu);
  - `docs/SPEC.md` §22;
  - `docs/architecture.md` (media lekcji: rola `feedback_audio`, ujawnienie w feedbacku);
  - `docs/superpowers/specs/2026-10-30-tts-voice-style-design.md` (nota: nagranie zdania feedbacku bez stylu).

- [ ] **Step 1:** Wprowadź zmiany w dokumentacji. Wyszukaj `correctAudioAssetId|FeedbackDto` w `apps/web/src/integrations` i `integrations/` — oczekiwanie: brak trafień. Zapisz to w opisie PR jako uzasadnienie braku zmian MCP/`SKILL.md`.
- [ ] **Step 2:** Run i oczekuj PASS dla: `corepack pnpm typecheck`, `corepack pnpm test:unit`, `corepack pnpm test:integration`, `corepack pnpm build`, `corepack pnpm test:e2e:shards`.
- [ ] **Step 3:** Commit `docs(lessons): odczyt zdania po odpowiedzi — wymagania, SPEC, architektura`, push gałęzi i PR do `main` (bez scalania). Opis PR zawiera:
  - wpływ API → MCP → skill;
  - wykonane bramki;
  - niezweryfikowane: autoodtwarzanie na fizycznym iPhonie/iPadzie;
  - instrukcję dla rodzica: stare lekcje dostają odczyt po „Nowa wersja” → „Opublikuj”.
