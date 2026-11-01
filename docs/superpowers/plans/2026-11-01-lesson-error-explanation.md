# Wyjaśnienie błędu dla dziecka w lekcjach — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Po błędnej odpowiedzi i po „Nie pamiętam” w lekcji angielskiego dziecko widzi zatwierdzone przez rodzica jedno polskie zdanie wyjaśniające regułę i może je odsłuchać (pl-PL).

**Architecture:** Pole `explanationPl` ćwiczenia powstaje w generatorze (za flagą przedmiotu `exerciseExplanations`), przechodzi walidację domeny i edycję rodzica. `materials` planuje nagranie w nowej roli `explanation_audio`. `learning/lessons` zamraża tekst i nagranie w prywatnym kluczu zadania, a czysta funkcja `withExerciseExplanation` dokleja je do feedbacku (`incorrect` / `lesson_hint`) w transakcji finalizacji próby, z jedną pieczęcią `audio_issued`. Kid UI pokazuje zdanie pod poprawną odpowiedzią i przycisk ręcznego odsłuchu.

**Tech Stack:** TypeScript strict, Zod (`packages/contracts`), Drizzle + PostgreSQL, Next.js + Mantine (panel rodzica), React (Kid UI), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-lesson-error-explanation-design.md`

## Global Constraints

- Flaga `SubjectModule.exerciseExplanations`: `english_grammar` i `english_chapter` = `true`, `school` i testowy przedmiot w `testing/` = `false`.
- `explanationPl`: zwykły tekst, po przycięciu niepusty, ≤ 120 znaków (`MAX_TEXT_LENGTH`), bez `\n`, `*`, `_`, dokładnie jedno zdanie wg `sentenceCount` (`domain/tts-style.ts`); nie zawiera tekstu ekspozycji innego ćwiczenia tej samej puli (§3.1 specu).
- Pole nie wpływa na `exercise-identity.ts`, `target_key`, `objectiveImpacted` ani `buildObjectiveCriteria`; nie jest polem v3.
- Generator: złe wyjaśnienie jest usuwane po cichu (ćwiczenie zostaje), liczba w logu przebiegu; zapis rodzica: błąd walidacji.
- Rola zasobu: dokładnie `explanation_audio`, migracja `0032_explanation_audio_role.sql` + ręczny wpis idx 32 w `drizzle/meta/_journal.json`; locale `pl-PL`, styl `lesson_explanation` o zdaniu: „Wyjaśnij spokojnie i życzliwie jak cierpliwy nauczyciel; angielskie słowa wymów po angielsku.”
- Publikacja nie czeka na `explanation_audio`; rola nie trafia do list zasobów rodzica; worker ma jawną gałąź `explanation_audio → !exerciseExplanations`.
- Feedback z wyjaśnieniem tylko w treningu, przy wyniku oceny `incorrect`, rodzaju `incorrect`/`lesson_hint`, `revealsAnswer`, zakończonym zadaniu; przy `lesson_hint` szablon kategorii ma pierwszeństwo. `model_incorrect` bez szablonu i bez wyjaśnienia → `{ kind: "incorrect", correctText }`.
- `audio_issued` raz na próbę, gdy feedback ma `correctAudioAssetId` lub `explanationAudioAssetId`; zmiana tylko w lekcyjnym `sealFeedbackSentenceAudio`, nie w `sealPostAnswerAudio`.
- Kid UI: tekst `messages.kid.listenExplanation` = „Posłuchaj wyjaśnienia”; przycisk ≥ 48 px na początku wiersza wyjaśnienia; brak autoodtwarzania wyjaśnienia; tokeny M3, bez surowych kontrolek i literałów koloru/rozmiaru.
- Panel rodzica: etykieta „Wyjaśnienie dla dziecka (po błędzie)”, licznik do 120; puste/same spacje → `undefined`.
- Brak zmian w MCP i `SKILL.md` — potwierdzić wyszukaniem i opisać w PR.
- Polecenia przez `corepack pnpm …`; nie instaluj zależności, gdy `node_modules` istnieje.

## Review Focus

1. **Dogenerowanie do szkicu z istniejącymi ćwiczeniami**: nowe wyjaśnienie cytuje odpowiedź ćwiczenia już obecnego w szkicu. Oczekiwanie: wyjaśnienie nowego ćwiczenia usunięte, ćwiczenie zostaje. Test w zadaniu 2.
2. **Rodzic czyści wyjaśnienie (pole puste lub same spacje)**. Oczekiwanie: payload bez pola, brak wymaganego `explanation_audio`, nowe zadania bez wyjaśnienia. Testy w zadaniach 3 i 4.
3. **Zadanie wydane przed edycją wyjaśnienia lub przed gotowym nagraniem**. Oczekiwanie: feedback ma tekst z klucza zadania (stary) i brak audio, jeśli nagranie nie było gotowe przy wydaniu. Test w zadaniu 5.
4. **Ponowny odczyt i idempotentne powtórzenie próby** (druga przeglądarka). Oczekiwanie: to samo `hintPl` i `explanationAudioAssetId`, bez drugiego `audio_issued`. Test w zadaniu 5.
5. **Telefon w poziomie 812×375 z lukami rozdziału** (długi `correctText`) + wyjaśnienie 120 znaków + dwa odsłuchy. Oczekiwanie: wyjaśnienie w całości osiągalne (przewijanie w karcie), „Dalej” osiągalne, brak przepełnienia poziomego. Test w zadaniu 6.

---

### Task 1: Pole `explanationPl`, flaga przedmiotu i reguły domeny

**Files:**
- Create: `packages/server/src/domain/lessons/exercise-explanation.ts`, test `exercise-explanation.test.ts` obok.
- Modify:
  - `packages/contracts/src/lessons.ts:336-393` (`explanationPl: text.optional()` z komentarzem; DTO szkicu dziedziczy);
  - `packages/server/src/domain/lessons/types.ts` (`LessonExerciseDraft.explanationPl?: string`; `SubjectModule.exerciseExplanations: boolean` z komentarzem obok `ttsForFeedbackSentence`);
  - `subjects/english-grammar/module.ts`, `subjects/english-chapter/module.ts` (`true`), `subjects/school/module.ts`, `testing/*` przedmiot testowy (`false`);
  - `packages/server/src/domain/lessons/pool-validation.ts` (`validateLessonExercise` i `validatePool`).
- Test: `exercise-explanation.test.ts`, `pool-validation.test.ts`, `exercise-identity.test.ts`, testy modułów przedmiotów, `packages/contracts` test lekcji.

**Interfaces:**
- Produces:
  - `explanationTextErrors(text: string): string[]` — komunikaty w stylu `pool-validation` z prefiksem `explanationPl:`;
  - `explanationRevealsOtherTarget(explanation: string, ownExposureText: string, otherExposureTexts: readonly string[], subject: Pick<SubjectModule, "normalizeExposureText">): boolean` — porównanie po `normalizeExposureText` (gdy jest) i `normalizeTargetText`, dopasowanie na granicach słów (`\p{L}\p{N}`), tekst równy własnemu pomijany;
  - `exerciseExposureText(subject, draft): string` — `subject.exposureText?.(draft) ?? draft.answer` (wydziel z `lessonExerciseTargetKey` w `exposure-key.ts` i użyj tam);
  - `validatePool` odrzuca ćwiczenie z błędem `explanationPl: zawiera odpowiedź innego ćwiczenia („…”)`.

- [ ] **Step 1: Failing tests:**
  - `explanationTextErrors`: `"Przy he, she, it dodajemy -s: he plays."` → `[]`; `"  "` → błąd; 121 znaków → błąd; `"a\nb"`, `"*he*"`, `"he_plays"` → błąd; `"Dodajemy -s. Tak mówimy."` → błąd (dwa zdania); `"Np. he plays."` → `[]`.
  - `explanationRevealsOtherTarget("Przy she dodajemy -s: she plays.", "works", ["plays"], grammar)` → `true`; `("…he works…", "works", ["works"], …)` → `false`; `"display"` nie pasuje do `"plays"`; wielkość liter bez znaczenia.
  - `validateLessonExercise`: wyjaśnienie przy przedmiocie z flagą `false` → błąd `explanationPl: …niedozwolone…`; poprawne przy gramatyce → brak błędu.
  - `validatePool`: dwa ćwiczenia, wyjaśnienie pierwszego cytuje odpowiedź drugiego → pierwsze odrzucone z błędem `explanationPl:`.
  - `lessonExerciseIdentity` identyczne z wyjaśnieniem i bez.
  - `englishGrammarSubject.exerciseExplanations === true`, chapter `true`, `schoolSubject` `false`.
  - Kontrakt: `LessonExerciseInputSchema` przyjmuje `explanationPl`, odrzuca 121 znaków.
- [ ] **Step 2:** Run `corepack pnpm vitest run packages/server/src/domain/lessons packages/contracts` → FAIL.
- [ ] **Step 3:** Implement. Walidacja w `validateLessonExercise` woła `explanationTextErrors` i sprawdza flagę; faza wycieku w `validatePool` po fazie 1 (przed deduplikacją), porównuje z `exerciseExposureText` pozostałych ćwiczeń z wejścia. Domena nie importuje niczego spoza `domain/` i `@learning/contracts`.
- [ ] **Step 4:** Run step 2 + `corepack pnpm vitest run packages/server/src/modules/module-boundaries.architecture.test.ts` → PASS; `corepack pnpm typecheck` → PASS (uzupełnij brakujące `exerciseExplanations` w literałach `SubjectModule` w testach).
- [ ] **Step 5:** Commit `feat(lessons): pole explanationPl ćwiczenia i reguły wyjaśnienia (#196)`.

### Task 2: Generator i przepływ payloadu

**Files:**
- Modify:
  - `packages/server/src/ports/ai.ts:66-96` (`LessonPoolInput.exerciseExplanations?: boolean`);
  - `packages/server/src/providers/openai/lesson-pool-schema.ts` (`withExplanation` jak `withVoiceTone`: pole w `required`, typ `["string","null"]`; wszystkie gałęzie typów);
  - `packages/server/src/providers/openai/llm.ts:305-325` (reguła promptu i opis pola przy fladze);
  - fake provider (`packages/server/src/providers/fake*.ts`: wyjaśnienie z własnej odpowiedzi, np. `Poprawnie: ${answer}.` przycięte do reguł);
  - `packages/server/src/modules/materials/lessons/lesson-drafts.ts`: `buildPoolInput` (flaga), `rawExerciseShapeSchema` (`explanationPl: z.string().nullish()`), `toExerciseDraft` (string → pole, `null` → brak), `buildLessonPayload`, nowa `withoutInvalidExplanation(draft, subject, otherExposureTexts)` w łańcuchu po `withoutVoiceToneUnlessAllowed` + log `porzucone wyjaśnienia=N` obok logu wariantów;
  - `lesson-api.ts:149-195` (`exerciseDtoFromPayload`);
  - `lesson-supervision.ts:587-601` (przebudowa payloadu przy akceptacji wariantu zachowuje pole).
- Test: `lesson-pool-schema.test.ts`, `llm.test.ts`, `fake.test.ts`, `lesson-drafts.test.ts`; integracja: `tests/integration/lesson-generation*.test.ts` i test nadzoru (akceptacja wariantu).

**Interfaces:**
- Consumes: `explanationTextErrors`, `explanationRevealsOtherTarget`, `exerciseExposureText` (zadanie 1).
- Produces: `withoutInvalidExplanation(draft: LessonExerciseDraft, subject: SubjectModule, otherExposureTexts: readonly string[]): LessonExerciseDraft`; payload rewizji i DTO szkicu niosą `explanationPl`.

- [ ] **Step 1: Failing unit tests:**
  - schemat przy `exerciseExplanations: true` ma `explanationPl` w `required` z typem `["string","null"]` w każdej gałęzi; przy `false`/braku — nie ma pola;
  - prompt przy fladze zawiera regułę (fragmenty: `explanationPl`, `jedno zdanie`, `dlaczego poprawna odpowiedź`, `120`), bez flagi nie zawiera;
  - `withoutInvalidExplanation`: 2 zdania → pole usunięte, reszta ćwiczenia bez zmian; cytat odpowiedzi z `otherExposureTexts` → usunięte; przedmiot bez flagi → usunięte; poprawne → bez zmian;
  - `toExerciseDraft` z `explanationPl: null` → brak pola; `buildLessonPayload` przenosi pole.
- [ ] **Step 2:** Run te pliki → FAIL.
- [ ] **Step 3:** Implement. `otherExposureTexts` dla przebiegu = teksty ekspozycji pozostałych ćwiczeń z tej partii + `existingExercises` szkicu (dogenerowanie).
- [ ] **Step 4: Failing integration tests:**
  - generacja gramatyki fake providerem → rewizje mają `explanationPl`; szkoła — nie;
  - dogenerowanie: wyjaśnienie nowego ćwiczenia cytujące odpowiedź istniejącego → zapisane bez wyjaśnienia (Review Focus 1);
  - akceptacja wariantu w nadzorze zachowuje `explanationPl`;
  - DTO szkicu (`getLessonDraft`) zwraca `explanationPl`.
- [ ] **Step 5:** Run → FAIL, implement → PASS (`corepack pnpm test:integration` z filtrem plików).
- [ ] **Step 6:** Commit `feat(lessons): generator i payload niosą wyjaśnienie ćwiczenia`.

### Task 3: Nagranie `explanation_audio` i API rodzica

**Files:**
- Create: `packages/server/drizzle/0032_explanation_audio_role.sql` (wzorem `0029_feedback_audio_role.sql`), wpis idx 32 w `drizzle/meta/_journal.json`.
- Modify:
  - `packages/server/src/db/schema.ts:404,410` (rola w typie i CHECK);
  - `docs/schema.sql:180-189` (CHECK z `target_audio`… + `prompt_audio`, `feedback_audio`, `explanation_audio`);
  - `packages/server/src/domain/tts-style.ts` (`TtsRoleStyle` + `"lesson_explanation"`), `providers/tts-style-profile.ts` (zdanie z Global Constraints);
  - `packages/server/src/modules/materials/media-reconciliation.ts` (`AssetRole`, `LessonTtsFlags.exerciseExplanations` i jej wypełnianie `:364-378`, `requiredAssetsForLessonExercise`, `keepFailed` `:425`);
  - `packages/server/src/modules/materials/media-generation.ts:94-96` (jawna gałąź);
  - `lesson-api.ts:263-268,308` i `decks.ts:162` (pominięcie roli w listach; `explanationAudio` w DTO ćwiczenia);
  - `lesson-prompt-audio.ts` (`readLessonAudioStates` dla roli; `regenerateLessonPromptAudio` z `role`);
  - `packages/contracts/src/lessons.ts:410-414` (`explanationAudio: LessonPromptAudioDtoSchema.optional()`);
  - eksporty `materials/index.ts`, `server/src/index.ts` (jeśli zmienia się typ wejścia).
- Test: `media-reconciliation.test.ts`, `tts-style-profile.test.ts`, `lesson-prompt-audio` testy jednostkowe (jeśli są); integracja: `publish-media-reconcile`, `lesson-schema`, `lesson-parent-api`, nowy `tests/integration/lesson-error-explanation.test.ts` (sekcja mediów; dopisz do najlżejszego kosza `tests/integration-buckets.ts`).

**Interfaces:**
- Consumes: `explanationPl` w payloadzie (zadanie 2), flaga (zadanie 1).
- Produces:
  - `AssetRole` zawiera `"explanation_audio"`; `LessonTtsFlags { ttsForAnswers; ttsForPrompts; ttsForFeedbackSentence; exerciseExplanations: boolean }`;
  - `regenerateLessonPromptAudio(services, input: { lessonDraftId: string; itemRevisionId: string; role?: "prompt_audio" | "explanation_audio" })` (domyślnie `prompt_audio`);
  - DTO ćwiczenia szkicu: `explanationAudio?: LessonPromptAudioDto`.

- [ ] **Step 1: Failing unit tests:**
  - gramatyka z `explanationPl` → `{ role: "explanation_audio", metadata.text: explanationPl, metadata.locale: "pl-PL" }`, instrukcje zawierają zdanie stylu `lesson_explanation` przy `tts.style === "instructions"`;
  - flaga `false` albo brak pola → brak roli; zmiana tekstu → inny fingerprint; `voiceTone` ćwiczenia nie zmienia fingerprintu wyjaśnienia;
  - `STYLE_SENTENCES_PL.lesson_explanation` równe tekstowi z Global Constraints; lista stylów w `tts-style-profile.test.ts` uzupełniona.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement reconciliation, styl, migrację, CHECK, gałąź workera, pominięcie w listach, stany audio i rolę w regeneracji.
- [ ] **Step 4: Failing integration tests:**
  - publikacja gramatyki przy `pending` `explanation_audio` → sukces;
  - worker (`processNextMediaJob`/odpowiednik z testów #194) tworzy gotowe `explanation_audio` dla `english_grammar` (nie `superseded`); dla przedmiotu z flagą `false` oczekujące → zastąpione;
  - INSERT roli przechodzi przez CHECK;
  - lista zasobów szkicu bez `explanation_audio`; `getLessonDraft` zwraca `explanationAudio`;
  - `regenerateLessonPromptAudio({ …, role: "explanation_audio" })` → nowa generacja, wiersz `pending`; bez `role` → zachowanie dla `prompt_audio` bez zmian;
  - wyczyszczenie wyjaśnienia w zapisie szkicu → brak wiersza `explanation_audio` (Review Focus 2);
  - publikacja → `createLessonDraftFromPublished` → edycja samego wyjaśnienia → publikacja: ta sama `skill_version`, nowe `explanation_audio` zlecone.
- [ ] **Step 5:** Run → FAIL, implement → PASS; `corepack pnpm vitest run packages/server/src/modules/module-boundaries.architecture.test.ts` → PASS.
- [ ] **Step 6:** Commit `feat(media): nagranie wyjaśnienia ćwiczenia (rola explanation_audio, migracja 0032)`.

### Task 4: Panel rodzica — pole, podgląd i nagranie

**Files:**
- Modify:
  - `apps/web/src/parent/**/lesson-editor-state.ts` (`:56-99,158-199,302-381`: pole w stanie, puste → `undefined`);
  - `LessonExerciseCard.tsx` (`Textarea` z licznikiem poza blokiem v3, wzorem `:451-456`; tryb tylko do odczytu `:114` pokazuje tekst; drugi `PromptAudioControls` z `testId="lesson-explanation-audio"` i etykietą „wyjaśnienia”; `sameCardProps` `:83-90` porównuje `explanationAudio`);
  - `PromptAudioControls.tsx` (prop `role`, przekazywana do mutacji);
  - `LessonEditor.tsx:723-741` (mutacja z `role`);
  - `apps/web/src/parent/orpc-contract.ts:166-169` (`LessonPromptAudioRegenerateInputSchema` + `role: z.enum(["prompt_audio","explanation_audio"]).optional()`), `apps/web/src/orpc/parent-router.ts:429-431`;
  - `packages/contracts/src/messages.ts` (`explanationLabel: "Wyjaśnienie dla dziecka (po błędzie)"` obok `commonErrorsLabel`, opis pomocniczy i etykieta nagrania).
- Test: `lesson-editor-state.test.ts`, `prompt-audio-controls.test.tsx`, `parent-router.test.ts`, test karty ćwiczenia (jeśli istnieje); E2E `mocked` `tests/e2e/parent-lesson-editor-layout.spec.ts`.

**Interfaces:**
- Consumes: `explanationPl` i `explanationAudio` w DTO szkicu (zadania 2–3), `role` w regeneracji (zadanie 3).

- [ ] **Step 1: Failing unit tests:** stan edytora — zmiana wyjaśnienia oznacza ćwiczenie jako zmienione; `"   "` → payload bez pola; router przekazuje `role`; kontrolki z `role="explanation_audio"` wołają mutację z tą rolą i mają odrębną nazwę dostępności.
- [ ] **Step 2:** Run `corepack pnpm vitest run apps/web` (te pliki) → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Failing E2E** w `parent-lesson-editor-layout.spec.ts`: pole z etykietą widoczne i edytowalne w szkicu, licznik `…/120`, kontrolki nagrania wyjaśnienia obok; podgląd opublikowanej lekcji pokazuje tekst i odsłuch bez pola edycji; geometria pola na telefonie 375×812 i desktopie bez przepełnienia poziomego.
- [ ] **Step 6:** Run `UMIEM_E2E_WEB_MODE=dev corepack pnpm exec playwright test tests/e2e/parent-lesson-editor-layout.spec.ts` → FAIL, potem PASS; `corepack pnpm vitest run tests/parent-mantine-scope.test.ts` → PASS.
- [ ] **Step 7:** Commit `feat(parent): wyjaśnienie ćwiczenia w edytorze i podglądzie lekcji`.

### Task 5: Sesja — klucz zadania, reguła feedbacku i kontrakt Kid DTO

**Files:**
- Modify:
  - `packages/contracts/src/kid.ts:660-725` (`hintPl` dozwolone przy `incorrect`; `explanationAudioAssetId: UuidSchema.optional()` + refine: wymaga `hintPl`, tylko `incorrect`/`lesson_hint`, nie przy `not_assessed`; komentarze pól);
  - `lesson-sessions.ts:256-343` (`loadExercises` opcja `explanationAudio`, zapytanie jak `feedbackAudioRows`, `LoadedExercise.explanationAudioAssetId`), wywołania `:852` i `lesson-mock-tests.ts:61` z `explanationAudio: false`;
  - `lesson-materialize.ts:62-73,207-222` (`explanationPl` i `explanationAudioAssetId` w `baseKey` tylko `subject.exerciseExplanations && !mockTest`);
  - `lesson-attempts.ts`: `LessonTaskAnswerKey` (`:95-129`), nowa `withExerciseExplanation`, `resultFromVerdict` (`model_incorrect` bez szablonu: wyjaśnienie z klucza albo `incorrect`), `sealFeedbackSentenceAudio` (`:1000`), wywołania w obu ścieżkach (`:1135/1148`, `:1616/1633`).
- Test: `lesson-attempts.test.ts`, `lesson-materialize.test.ts`, test kontraktu kid (`packages/contracts`); integracja `tests/integration/lesson-error-explanation.test.ts` (sekcja sesji).

**Interfaces:**
- Consumes: payload `explanationPl` (zadanie 2), `explanation_audio` (zadanie 3).
- Produces:
  - `LessonTaskAnswerKey.explanationPl?: string`, `explanationAudioAssetId?: string`;
  - `withExerciseExplanation(feedback: FeedbackDto | null, key: LessonTaskAnswerKey, outcome: ObjectiveGrade["outcome"], taskEnds: boolean): FeedbackDto | null` (czysta, w `lesson-attempts.ts`, wołana przed `withFeedbackSentenceAudio`);
  - `FeedbackDto.explanationAudioAssetId?: string`; `hintPl` przy `incorrect`.

- [ ] **Step 1: Failing unit tests:**
  - `withExerciseExplanation` — każdy wiersz tabeli §4.2 specu: `incorrect`+`correctText` → `hintPl` = wyjaśnienie (+ `explanationAudioAssetId`, gdy klucz ma); `lesson_hint` z `hintPl` szablonu → bez zmian i bez audio; `lesson_hint` bez `hintPl` → wyjaśnienie; `lesson_almost`, `great`, `not_assessed`, `lesson_precision_hint`, `null` → bez zmian; `taskEnds=false` → bez zmian; klucz bez wyjaśnienia → bez zmian;
  - `resultFromVerdict` z nadpisaniem rodzica `overridden_incorrect` bez kategorii i bez wyjaśnienia → `{ kind: "incorrect", correctText }` przechodzące `FeedbackDtoSchema`;
  - materializacja: trening + flaga → klucz ma oba pola, `JSON.stringify(prompt)` ich nie zawiera; kartkówka i flaga `false` → brak;
  - kontrakt: `incorrect` + `hintPl` przechodzi; `explanationAudioAssetId` bez `hintPl`, przy `great`, przy `not_assessed` → błąd; `lesson_hint` bez `hintPl` nadal błąd.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `taskEnds` = wyliczony już `taskState !== "issued"`. Pieczęć: warunek `feedback.correctAudioAssetId ?? feedback.explanationAudioAssetId`, jedno wywołanie.
- [ ] **Step 4: Failing integration tests** (gramatyka, wyjaśnienie i nagranie `ready` przed wydaniem):
  - błędny wybór → `incorrect`, `hintPl`, `explanationAudioAssetId`, `correctAudioAssetId`; dokładnie jedno `audio_issued` (`occurredAt > receivedAt`), ocena `independent` jak bez wyjaśnienia;
  - „Nie pamiętam” → `incorrect` z wyjaśnieniem;
  - fake grader `model_incorrect` z kategorią → szablon kategorii; z kategorią `other` → wyjaśnienie;
  - brak wyjaśnienia dla: dobrej odpowiedzi, „prawie” (`minor_typo`), `not_assessed`, „Pomiń”, kartkówki;
  - zadanie wydane przed gotowym nagraniem → wyjaśnienie bez audio; zadanie wydane przed edycją → stary tekst (Review Focus 3);
  - `readLessonAttempt` i idempotentne powtórzenie → ten sam feedback, bez nowego `audio_issued` (Review Focus 4);
  - szkoła → bez wyjaśnień; regresja `lesson-sentence-audio.test.ts` i `lesson-chapter-sentence-audio.test.ts` przechodzi.
- [ ] **Step 5:** Run → FAIL, implement → PASS.
- [ ] **Step 6:** Commit `feat(lessons): feedback po błędzie niesie wyjaśnienie ćwiczenia i jego nagranie`.

### Task 6: Kid UI — wyjaśnienie i „Posłuchaj wyjaśnienia”

**Files:**
- Modify:
  - `packages/kid-ui/src/screens/lesson-feedback-view.ts` (widok dla `incorrect` z `hintPl` w zadaniu lekcji; bez `correctRow`, bo tytuł pokazuje odpowiedź);
  - `packages/kid-ui/src/screens/AnswerFeedback.tsx` (wyjaśnienie w `.kid-lesson-feedback__hint` jako akapit pod tytułem; opcjonalny `ListenButton` na początku wiersza);
  - `ExerciseFeedbackDock.tsx` / `LearnScreen.tsx:119-124,277` (prop `explanationAudio?: { onPlay: () => void } | null`; `GuidanceButton icon="question"`, gdy `sentenceAudio ?? explanationAudio`);
  - `session-controller.ts` (`playExplanationAudio()` obok `playSentenceAudio`; `#showResult` `:1241`: wyjątek „Nie pamiętam” także gdy `attempt.feedback?.hintPl !== undefined` w zadaniu lekcji);
  - `packages/contracts/src/messages.ts` (`kid.listenExplanation`); style tylko przez tokeny.
- Test: `session-controller.test.ts`, `ExerciseFeedbackDock.test.tsx`, test `lesson-feedback-view` / `AnswerFeedback`; E2E `mocked` `tests/e2e/lesson-sentence-audio.spec.ts`, `kid-answer-contrast.spec.ts`.

**Interfaces:**
- Consumes: `FeedbackDto.hintPl` przy `incorrect`, `explanationAudioAssetId` (zadanie 5).
- Produces: `controller.playExplanationAudio(): Promise<void>`.

- [ ] **Step 1: Failing unit tests:**
  - widok: `incorrect` + `hintPl` w lekcji → wyjaśnienie pod tytułem; `incorrect` bez `hintPl` (słówka) → render jak dziś (snapshot struktury/tekstów);
  - kontroler: wynik z `explanationAudioAssetId` nie odtwarza go automatycznie, `correctAudioAssetId` gra raz; `playExplanationAudio` gra `mediaUrl(id)` i przerywa odczyt zdania; „Dalej” przerywa; odrzucone `play()` → bez stanu błędu; „Nie pamiętam” z `hintPl` bez nagrania zdania zostaje na wyniku;
  - dok: przy `explanationAudio` przycisk z nazwą „Posłuchaj wyjaśnienia”, klik woła `onPlay`; „?” zamiast głośnika komunikatu także przy samym `explanationAudio`.
- [ ] **Step 2:** Run `corepack pnpm vitest run packages/kid-ui` (te pliki) → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `corepack pnpm vitest run tests/kid-design-tokens.test.ts tests/kid-no-mantine.test.ts` → PASS.
- [ ] **Step 5: Failing E2E** (`lesson-sentence-audio.spec.ts`, fixture `installKidUiFixture`, spy `HTMLMediaElement.prototype.play`):
  - błędny wybór → wyjaśnienie widoczne pod „Poprawna odpowiedź”, `play` raz z URL zdania (nie wyjaśnienia); klik „Posłuchaj wyjaśnienia” → `play` z URL wyjaśnienia i `pause` zdania;
  - „Nie pamiętam” → „Rozumiem” → wynik z wyjaśnieniem zostaje do „Dalej”;
  - feedback z `hintPl` bez audio → brak przycisku; bez nagrania zdania, z nagraniem wyjaśnienia → komunikat ma ikonę „?”;
  - geometria: wyjaśnienie 120 znaków, tekst ≥ 200 px szerokości w 375×812, przycisk ≥ 48×48 w viewporcie, „Dalej” osiągalne, brak przepełnienia poziomego w 375×812, 812×375, 768×1024, 1280×800; luki rozdziału z pełnym `correctText` w 812×375 — wyjaśnienie osiągalne przewinięciem karty (Review Focus 5);
  - `kid-answer-contrast.spec.ts`: kontrast tekstu wyjaśnienia w doku `incorrect`.
- [ ] **Step 6:** Run `UMIEM_E2E_WEB_MODE=dev corepack pnpm exec playwright test tests/e2e/lesson-sentence-audio.spec.ts tests/e2e/kid-answer-contrast.spec.ts` → FAIL, potem PASS.
- [ ] **Step 7:** Commit `feat(kid-ui): wyjaśnienie błędu i „Posłuchaj wyjaśnienia” w feedbacku lekcji`.

### Task 7: Przebieg `real`, dokumentacja i bramki

**Files:**
- Modify:
  - `tests/e2e/lesson-real-flow.spec.ts` (kosz 4 `REAL_BUCKETS`): test generowanie fake providerem → publikacja → sesja dziecka → błędny wybór pokazuje wyjaśnienie;
  - `docs/architecture.md` §19 (feedback lekcji: `hintPl` przy `incorrect`, `explanationAudioAssetId`, kolejność szablon → wyjaśnienie) i §22 (rola `explanation_audio`);
  - `docs/SPEC.md` §22/§37, nowe kryterium akceptacji w §32, nota przy A58;
  - `.kiro/specs/grammar-module/requirements.md` (nowe wymaganie o wyjaśnieniu);
  - `docs/superpowers/specs/2026-10-30-lesson-sentence-readback-design.md` §11 (punkt 5 zrealizowany), `docs/superpowers/specs/2026-10-30-tts-voice-style-design.md` (rola stylu `lesson_explanation`).

- [ ] **Step 1:** Dopisz test `real`; run `corepack pnpm exec playwright test tests/e2e/lesson-real-flow.spec.ts --project=real` → PASS.
- [ ] **Step 2:** Zaktualizuj dokumentację. Wyszukaj `FeedbackDto|explanation|LessonExerciseInput|hintPl` w `apps/web/src/integrations` i `integrations/` — oczekiwanie: brak trafień dotyczących lekcji; zapisz to do opisu PR.
- [ ] **Step 3:** Scal `origin/main` (ccd `sync_with_base_branch`, jeśli dostępne), potem run i oczekuj PASS: `corepack pnpm typecheck`, `corepack pnpm test:unit`, `corepack pnpm test:integration`, `corepack pnpm build`, `corepack pnpm test:e2e:shards`.
- [ ] **Step 4:** Commit `docs(lessons): wyjaśnienie błędu — architektura, SPEC, wymagania gramatyki`.
