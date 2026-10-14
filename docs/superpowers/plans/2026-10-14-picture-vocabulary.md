# Zestawy obrazkowe i nauka bez czytania — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rodzic generuje zestaw obrazkowy, a dziecko oznaczone jako nieczytające uczy się przez obrazki, słuchanie i mówienie; dzieci czytające korzystają z tego samego materiału również do czytania i pisowni.

**Architecture:** Wariant standard/picture jest właściwością niezmiennej wersji vocabulary, a canRead właściwością profilu przypinaną przy starcie sesji. Korzystamy z istniejących portów providerów, kolejki mediów, pięciu umiejętności i historii. Scheduler, rekomendacje, API prób i Kid UI współdzielą regułę dostępnych umiejętności; klient pozostaje przenośny.

**Tech Stack:** TypeScript strict, Zod, Drizzle/PostgreSQL, React/Next.js, pnpm, Vitest i Playwright; dotychczasowe porty LLM/TTS/images i MediaStore.

**Spec:** `docs/superpowers/specs/2026-10-14-picture-vocabulary-design.md`.

**Progress:** `docs/superpowers/progress/2026-10-14-picture-vocabulary.md`.

**Status:** Po dwóch rundach niezależnego review: Ready for weaker-model implementation: Yes. Pierwsze 9 Important i 3 Minor rozwiązano; po drugiej rundzie doprecyzowano drobny zapis o wspomaganym Recall. Brak pozostałych uwag blokujących i brak rozpoczętej implementacji. Projekt w rozmowie został zaakceptowany; zapisanych dokumentów nie należy utożsamiać z poleceniem wykonania. Wynik i obsługa uwag: `docs/superpowers/reviews/2026-10-14-picture-vocabulary-plan-review.md`.

## Global Constraints

- Interfejs i dokumentacja po polsku; UI `pl-PL`, materiał początkowo `pl-PL` → `en-GB`.
- Kid UI pozostaje przenośny: jawne Kid API, konfigurowalny baseUrl i istniejące adaptery mediów; bez importów Next.js lub serwera.
- Opublikowana treść, wydany prompt, klucz odpowiedzi i zakończona ocena pozostają niezmienne.
- Historia i projekcja umiejętności pozostają wspólne; sama zmiana sposobu prezentacji nie resetuje postępu.
- Nie zmieniamy reguły 300 sekund, progów wymowy ani zasad potwierdzania samodzielności.
- Nagrania dzieci pozostają krótkotrwale w pamięci, bez trwałego zapisu i bez logowania.
- Nie dodajemy offline, Androida, nowych mikroserwisów ani wywołań LLM/TTS przy kliknięciu dziecka.

## Review Focus

1. Brak option.text w opcjach obrazkowych nie może kwalifikować Listening jako zadania z jedną odpowiedzią (zadanie 5).
2. Ponowienie niepewnej generacji po zmianie formularza nie może zmienić formatu już zleconego zestawu (zadanie 2).
3. Pominięcie ilustracji przez bezpośredni endpoint, edycja lub stary worker nie mogą obejść gotowości publikacji picture (zadanie 3).
4. Zmiana profilu podczas sesji, niewykonywalne pisemne powtórki i starszy klient nie mogą zmieniać lub blokować przypiętego przebiegu (zadania 1 i 5).
5. Odmowa mikrofonu, trwająca analiza, utrata odpowiedzi HTTP i reload nie mogą tworzyć błędnej wiedzy ani zwiększać budżetu (zadania 5 i 6).

## Przygotowanie wykonawcy i zależności

- [ ] Przejrzeć zapisany projekt i plan; potwierdzić wymagane zatwierdzenia przed implementacją. Nie zastępować przeglądu plików wcześniejszą akceptacją samego pomysłu.
- [ ] Uruchomić using-superpowers, executing-plans i using-git-worktrees. Wykonuje bieżący agent; nie delegować implementacji bez zgody.
- [ ] Sprawdzić Git, worktree i aktualność bazy origin/main. Zachować niezwiązaną pracę. node_modules istnieje → bez instalacji; brak .env → setup-worktree. Baseline tylko `corepack pnpm test:unit -- packages/contracts/src/child-profile.test.ts`.
- [ ] Wznowić dziennik; dla każdego zadania zapisać polecenia, wyniki RED/GREEN, odstępstwa i commit. Adaptacje skryptów executing-plans do PowerShell zachowują te same artefakty i dowody.

Zależności: 1 → 2 → 3; 1 → 4; 1+3+4 → 5 → 6 → 7. Wspólny walidator reprezentacji i MeaningVisual powstają JUŻ w zadaniu 1; generacja w zadaniu 2 i publikacja w zadaniu 3 używają tej samej implementacji. Każdy etap ma własne testy. Nie wdrażać częściowego wariantu picture do rodziców przed końcowym odbiorem.

## Task 1: model, publiczne kontrakty i profil

**Files:** Modify `packages/contracts/src/decks.ts`, `generation.ts`, `kid.ts`, `index.ts`; `packages/server/src/db/schema.ts`, `modules/profiles.ts`, `modules/decks.ts`, `modules/version-ops.ts`, `modules/events.ts`, `modules/sessions.ts`; `apps/web/src/parent/ChildEditor.tsx`; wspólny katalog `packages/contracts/src/messages.ts`. Create przeglądana migracja w `packages/server/drizzle/` pod następnym wolnym numerem z aktualnej bazy (nie hard-code 0010). Test `packages/contracts/src/child-profile.test.ts`, `tests/integration/auth-profiles.test.ts`, `tests/integration/history.test.ts`, `tests/integration/picture-vocabulary.test.ts` (nowy).

**Interfaces:** `VocabularyFormat = "standard" | "picture"`, `VocabularyFormatSchema`; `canRead` w profilu; `vocabularyFormat` w GenerationCommand, DraftDto, DeckSummaryDto i KidDeckDto. Kolumny can_read i vocabulary_format mają NOT NULL oraz odpowiednie DEFAULT/CHECK; trigger migracji odrzuca picture dla wersji deck o kind=lesson. SessionDto dodaje canRead/vocabularyFormat, SessionInput supportsPictureVocabulary default false. SessionContextShape przypina obie wartości, contextOf normalizuje legacy do true/standard. SourceVersion i createVersionFromPublished kopiują format; lekcje zachowują standard.

**Dodatkowe pliki i kontrakty:** Create `packages/server/src/domain/picture-vocabulary.ts` i `.test.ts` w tym zadaniu. Eksporty: `isPictureVocabularyItem(item: VocabularyItemInput): boolean` oraz `validateVocabularyFormatItems(format: VocabularyFormat, items: readonly VocabularyItemInput[]): void`; validation dla none/sequence/niepoprawnego visualData w picture, bez klasyfikacji semantycznej obrazu. Publiczny MeaningVisualSchema/type w contracts/kid: image+imageAssetId UUID, color+kanoniczny color, number+count integer 1–50. KidDeckDto dodaje coverVisual nullable i resumeOnly optional default false. TaskDto dodaje pendingAttemptId optional UUID; DisclosureDto audioAssetId optional UUID. KidValidationReasonSchema i KidValidationDetailsSchema walidują wyłącznie pięć reasons z projektu. SessionContextShape ma mutable microphoneDisabledTaskIds default []; assessmentSkills jest prywatnym polem context wydanego zadania/próby i nie trafia do Kid DTO.

**Testy kontraktów:** Create `packages/contracts/src/kid-picture.test.ts` dla nowych DTO i reasons. Pole canRead uzupełnić także w istniejącym mapperze toChildDto w contracts/decks.ts, nie tylko w query profilu.

- [ ] **Testy RED:** `profile_can_read_defaults_and_patch` sprawdza true dla nowego/legacy profilu, zapis false, pominięty PATCH zachowuje false i odrzucenie stringa. `picture_format_defaults_and_copy` sprawdza standard dla legacy, kopię picture do szkicu, SQL odrzucający niepoprawny format/zmianę publikacji. `session_reading_snapshot_is_stable` sprawdza, że sesja true nie zmienia się po PATCH false; historia drugiego dziecka i klucze postępu są takie same.
- [ ] **Testy RED interfejsów:** `picture_representation_validation` akceptuje image/color/number i odrzuca none/sequence oraz złe visualData. `picture_public_contracts` parsuje coverVisual, resumeOnly, pendingAttemptId, audioAssetId ujawnienia i pięć bezpiecznych reasons; odrzuca nieprawidłowe UUID/kolor/count i nie przenosi danych prywatnych. Dopisać te przypadki do testów kontraktu Kid API oraz nowego testu walidatora.
- [ ] **Potwierdzić RED:** `corepack pnpm test:unit -- packages/contracts/src/child-profile.test.ts packages/contracts/src/kid-picture.test.ts packages/server/src/domain/picture-vocabulary.test.ts`; `corepack pnpm test:integration -- tests/integration/auth-profiles.test.ts tests/integration/picture-vocabulary.test.ts tests/integration/history.test.ts`. Porażka musi dotyczyć nowych pól/reguł, nie środowiska.
- [ ] **Minimalny kod:** dodać kontrakty, migrację, serializację i checkbox „Dziecko jeszcze nie czyta”. Nie otwierać jeszcze generowania picture w formularzu. Sam input nie pozwala klientowi wymusić canRead w sesji. Na poziomie kontraktu nowy klient rozpoznaje format; egzekwowanie możliwości nastąpi w zadaniu 5.
- [ ] **GREEN:** te same komendy plus `corepack pnpm typecheck`; sprawdzić migrację na docelowym PostgreSQL. Nowe schematy mają testy jawnego parse output, nie tylko typowania.
- [ ] **Commit:** selektywnie pliki zadania, `feat: add reading capability and vocabulary format contracts`; dowody w dzienniku.

## Task 2: generacja i retry

**Files:** Modify `packages/server/src/ports/ai.ts`, `providers/openai/llm.ts`, `modules/generation.ts`; `apps/web/src/parent/DecksPanel.tsx`; `packages/contracts/src/messages.ts`. Test `packages/server/src/providers/openai/llm.test.ts`, `tests/integration/generation.test.ts`, `tests/e2e/generation-request-retry.spec.ts`.

**Interfaces:** LlmGenerateDeckInput konsumuje VocabularyFormat z zadania 1. Input generation_runs zawiera vocabularyFormat; enqueueDeckGeneration zapisuje tę samą wartość w wersji. Istniejąca funkcja `executeGeneration` waliduje wynik przez validateVocabularyFormatItems z zadania 1; `no_picture_material` jest bezpiecznym GenerationDto.errorCode, bez surowego output modelu. Empty items jest dozwolone do rozpoznania tego przypadku WYŁĄCZNIE dla picture.

**Fixture:** Modify `packages/server/src/providers/fake.ts`: dodać DEFAULT_FAKE_PICTURE_DECK_ITEMS z red/#ff0000, blue/#0000ff, one/count=1, two/count=2. FakeLlmProvider wybiera tę domyślną pulę dla picture TYLKO przy braku jawnego queue behavior; standard i jawne kolejki pozostają identyczne. E2E generuje temat „kolory i liczby”, nie polega na domyślnych dniach tygodnia. Test potwierdza precedence queued invalid output nad domyślną poprawną pulą picture.

- [ ] **Testy RED:** `picture_prompt_requires_text_free_meanings` przechwytuje request do fake transportu: prompt dopuszcza image/color/number i wyklucza none/sequence oraz abstrakcyjne pojęcia. `picture_result_validation` sprawdza poprawne 3 słowa przy maxItems=10, odrzucenie none/sequence i failed/no_picture_material dla items=[]. `picture_generation_retry_keeps_format` symuluje utraconą odpowiedź: ten sam klucz/payload/format, jeden deck i run także po próbie zmiany formularza. Standardowe fixture zachowują dotychczasowy wynik.
- [ ] **Potwierdzić RED:** `corepack pnpm test:unit -- packages/server/src/providers/openai/llm.test.ts`; `corepack pnpm test:integration -- tests/integration/generation.test.ts`; `corepack pnpm test:e2e -- tests/e2e/generation-request-retry.spec.ts`.
- [ ] **Minimalny kod:** warunkowy fragment promptu i walidacja; wybór standard/picture w formularzu z blokadą edycji podczas niepewnego żądania. Nie dodawać drugiego klasyfikatora LLM, listy odrzuconych słów ani zmiany istniejącej idempotencji poza zachowaniem nowego pola.
- [ ] **GREEN:** powtórzyć komendy, odczytać zapisany input i format wersji z testowego PostgreSQL. Brak błędów i duplikatów.
- [ ] **Commit:** `feat: generate picture vocabulary with stable retry options`; zapisać dowody.

## Task 3: reguły reprezentacji, edytor i publikacja

**Files:** Consume istniejące po zadaniu 1 `packages/server/src/domain/picture-vocabulary.ts` i `.test.ts`. Modify `packages/server/src/modules/decks.ts`, `modules/media-reconciliation.ts`; `apps/web/src/parent/DeckEditor.tsx`, `deck-editor-state.ts`; `packages/contracts/src/messages.ts`. Test `tests/integration/picture-vocabulary.test.ts`, `tests/integration/media.test.ts`, `tests/integration/decks-management.test.ts`.

**Interfaces:** `isPictureVocabularyItem(item: VocabularyItemInput): boolean` jest czystą funkcją strukturalną: image lub poprawny color/number. `validateVocabularyFormatItems(format: VocabularyFormat, items: readonly VocabularyItemInput[]): void` rzuca validation dla niezgodnej karty; nie wnioskuje o semantyce obrazu. Wykorzystują ją zapis wyniku generacji, edycja i publikacja. Zasad gotowości blobów nie umieszczać w domenie: publishDraft używa obecnego assertAssetPublishable.

- [ ] **Testy RED:** `picture_representation_validation` akceptuje image/color/number, odrzuca none/sequence i niepoprawny visualData. `picture_publish_requires_every_asset` sprawdza ready audio/obraz, blokadę omitted/pending/failed/mismatched fingerprint; poprawne kolory/liczby publikują się bez asset illustration. `picture_omit_endpoint_is_rejected` sprawdza bezpośredni request. `picture_media_edits_preserve_other_cards` pokrywa starego workera, zmianę jednej ilustracji i ponowne wykorzystanie zgodnego audio.
- [ ] **Potwierdzić RED:** `corepack pnpm test:unit -- packages/server/src/domain/picture-vocabulary.test.ts`; `corepack pnpm test:integration -- tests/integration/picture-vocabulary.test.ts tests/integration/media.test.ts tests/integration/decks-management.test.ts`.
- [ ] **Minimalny kod:** walidacja pełnego zestawu, format w podglądzie, ograniczenie wyboru wizualizacji oraz akcji pomijania. Publikacja całej wersji jest potwierdzeniem rodzica; bez nonReaderApproved per karta. Wszelkie późniejsze poprawki przechodzą przez szkic.
- [ ] **GREEN:** te same komendy oraz regresje media fingerprint/revision impact. Zmiana wyłącznie sposobu prezentacji zachowuje odpowiadające kryteria i historię.
- [ ] **Commit:** `feat: validate and publish complete picture vocabulary sets`; zapisać dowody R02/R03/R06.

## Task 4: katalog polskich wskazówek audio

**Files:** Create `packages/contracts/src/ui-audio.ts`, `packages/server/src/domain/ui-audio-catalog.ts`, `packages/server/src/modules/ui-audio.ts` oraz test domenowy. Modify eksporty obu pakietów, `packages/server/src/modules/generation.ts` (supersedeDisabledLessonTts/executeMediaAsset), `apps/worker/src/main.ts`, `apps/web/src/kid/kid-router.ts`, katalog messages. Test `tests/integration/ui-audio.test.ts` (nowy), `tests/integration/media.test.ts`, `tests/integration/lesson-generation.test.ts`.

**Interfaces:** UiAudioKey i katalog 17 stałych kluczy z projektu; `UiAudioCatalogDto = { ready: boolean; assets: Partial<Record<UiAudioKey,string>> }`, asset_id walidowane jako UUID. `prepareUiAudio(s: Services): Promise<void>` zakłada w workerze brakujące zasoby/jobs poprzez obecne media_assets/generation_runs i fingerprint; nie woła TTS synchronicznie w web. `readUiAudio(s: Services): Promise<UiAudioCatalogDto>` obsługuje `GET /api/v1/kid/ui-audio`, bez side effects. prepare wywołać przy starcie workera; nowy fingerprint konfiguracji automatycznie przygotuje nowy katalog. Nie ma nowej tabeli ani revision_assets dla wskazówek.

**Integracja i odzyskiwanie:** nowe metadata mają purpose=kid_ui_guidance i walidowany uiAudioKey. supersedeDisabledLessonTts jawnie zachowuje takie zasoby mimo braku revision_assets; pozostałe orphan/disabled lesson TTS zachowują obecną ochronę. prepare pod advisory lock fingerprintu wybiera ready, potem oznaczony UI pending, inaczej tworzy następną generationNumber; nie przejmuje nieoznaczonego pending TTS lekcji i nie zmienia ready metadata. Po failed ponowny start workera po naprawie konfiguracji tworzy nową generację. Katalog gotowy oznacza 17 gotowych kluczy, nie koniecznie 17 różnych blobów. read tylko odczytuje.

- [ ] **Testy RED:** `ui_audio_is_cached_and_immutable` po dwóch prepare ma jeden aktywny zasób/job per fingerprint; po wykonaniu fake TTS ready=true i wszystkie keys mają asset. Zmiana tekstu/voice tworzy nowy zasób, nie nadpisuje starych bajtów. `ui_audio_read_never_enqueues_or_synthesizes` sprawdza brak pracy i brak wywołań providera podczas GET; pending/failed daje ready=false. Żądania TTS zawierają wyłącznie stałe polskie teksty, bez informacji o dzieciach.
- [ ] **Testy RED rzeczywistego executora:** `ui_audio_runs_through_media_executor` wywołuje istniejące executeMediaAsset dla zleconych zasobów z fake TTS, nie ręcznie ustawia ready; wszystkie 17 kluczy przechodzi readUiAudio. `disabled_lesson_tts_stays_superseded` zachowuje obecną regresję audio gramatyki i orphan bez markera UI. `ui_audio_failed_generation_recovers_on_prepare` oraz `two_workers_prepare_one_pending_per_fingerprint` pokrywają recovery i współbieżność.
- [ ] **Potwierdzić RED:** `corepack pnpm test:unit -- packages/server/src/domain/ui-audio-catalog.test.ts`; `corepack pnpm test:integration -- tests/integration/ui-audio.test.ts tests/integration/media.test.ts tests/integration/lesson-generation.test.ts`.
- [ ] **Minimalny kod:** użyć istniejącego lease, putImmutable, worker media execution i biblioteki fingerprintów. Stałe teksty: krótkie polskie instrukcje i feedback zgodny z grade; summary neutralne „Na dziś koniec”. Brak dynamicznego TTS tytułów, imion czy wyników dziecka.
- [ ] **GREEN:** powtórzyć komendy; test zasobu audio i MIME przez istniejącą route media. Nie deklarować realnej jakości głosu na podstawie fake providera.
- [ ] **Commit:** `feat: prepare cached Polish guidance audio for Kid UI`; zapisać dowody.

## Task 5: scheduler, Kid API i przerwanie nagrywania

**Files:** Create `packages/server/src/domain/vocabulary-capabilities.ts` i `.test.ts`, `picture-recognition-options.ts` i `.test.ts`. Modify `packages/contracts/src/kid.ts`; `packages/server/src/domain/scheduler.ts`, `modules/sessions.ts`, `modules/kid.ts`, `modules/attempts.ts`, `modules/speech.ts`, `modules/events.ts`; eksporty i `apps/web/src/kid/kid-router.ts`. Test `packages/server/src/modules/sessions.test.ts`, `tests/integration/picture-vocabulary.test.ts`, `tests/integration/sessions.test.ts`, `tests/integration/learning-algorithm.test.ts`.

**Interfaces:** `getVocabularyCapabilities(input: { canRead: boolean; microphoneEnabled: boolean }): { skills: readonly VocabularySkill[]; exerciseTypes: readonly ExerciseType[] }`: true zachowuje dotychczasowe możliwości; false pozwala exposure/listening i z mikrofonem recall/speech. `MeaningVisual` to discriminated union image/color/number bez angielskiego rozwiązania; `PictureChoiceOption = { id, labelPl, visual }`. Prompt kinds picture_listening/picture_recall są dodatkowymi gałęziami TaskPrompt, przy istniejących exerciseType listening/recall. `buildPictureRecognitionOptions` konsumuje target/peers z reprezentacją oraz reservedTargetKeys; produkuje opcje z prywatną poprawnością, ujawnienia i null przy braku dwóch rozróżnialnych odpowiedzi. `disableSessionMicrophone(s: Services, sessionId: string): Promise<SessionDto>` obsługuje POST sessions/:id/disable-microphone według projektu.

**Dodatkowe pliki:** Modify `packages/server/src/domain/evaluate.ts`, `evaluate.test.ts`, `domain/support-cycle.ts`, `modules/attempt-shared.ts`, `modules/reporting.ts` w zakresie ograniczenia ocen i tekstów opcji; Create `modules/voice-task-lifecycle.ts`. Modify `packages/kid-ui/src/api/KidApi.ts` i `api/client.ts` dla listy z możliwościami; testy client/error transport w zadaniu 6. Nie rozluźniać guard_task_snapshot ani nie dopisywać danych do context wydanego zadania.

Test pomyłek i parsowania ProgressDto dopisać do `tests/integration/reporting.test.ts`. Test HTTP disclosure/errors/recommendation w nowym `tests/integration/picture-vocabulary.test.ts` używa rzeczywistego handleKidApi opakowanego withApi, wzorując się na fixture API z auth-profiles/manual-decks-api, nie ręcznie skonstruowanego DTO.

**Oceny:** context zadania false ma assessmentSkills według specyfikacji; startAttempt kopiuje do FrozenContext. `evaluateNonAnswer(kind: NonAnswerKind, key: AnswerKey, ctx: EvaluationContext, assessmentSkills?: readonly Skill[]): Grade` przecina dotychczasowe umiejętności z listą, a brak listy zachowuje legacy. Timeout wykorzystuje tę samą zamrożoną listę, nie sam exerciseType. Finalizacja ogranicza grade.skills przed zapisem ocen/feedbacku do FrozenContext.assessmentSkills. W picture Recall dopuszczona jest rzeczywista ocena pronunciation z analizy mowy, ale dont_remember/timeout nie ocenia jej ani spelling. Wsparcie nie przechodzi na tekstowe retry.

**Odczyty opcji:** optionTextOf i correctTextOf rozróżniają kind picture_listening i odczytują jego niepuste labelPl; dla standard pozostaje text. Właściwy opis poprawnej opcji nie spada do key.target. Persistowane optionText, confusion i feedback używają polskich etykiet; prywatna mapa rewizji pozostaje. Test obejmuje również parsowanie raportu, nie tylko wybór/assessment.

**Resume, okładka i rekomendacje:** `listKidDecks(s: Services, childId: string, options?: { microphoneEnabled?: boolean }): Promise<KidDeckDto[]>` i `KidApi.listDecks(childId: string, options?: { microphoneEnabled?: boolean }): Promise<KidDeckDto[]>` korzystają z GET decks?childId=...&microphoneEnabled=true|false; brak default true. Dla false lista filtruje nowe starty, ale zawsze dołącza aktywną sesję: standard/lesson/mock, także archived lub assignment inactive, jako resumeOnly=true. coverVisual pochodzi z pierwszej karty publikacji lub przypiętej wersji dla resume. StartSession rozstrzyga aktywną sesję PRZED walidacją aktualnej zgodności przypisania/formatu: dokładne deckId/mode można wznowić, inne dają conflict. Picture-capability client guard nadal dotyczy startu i resume. hasScheduledWork i przygotowanie pendingCheckAt/recallIntroductionNeeded filtrują dostępne umiejętności, zachowując fakt poznania z pełnej historii. Klient odświeża listę po zmianie mikrofonu.

**Disable:** `completeDisabledVoiceTask(tx: Tx, sessionId: string, taskId: string): Promise<"waiting" | "skipped" | "unchanged">` zakłada wspólną blokadę sesji i odczytuje jej microphoneDisabledTaskIds. Endpoint zapisuje marker w context SESJI, ustawia microphoneEnabled=false, zwalnia niewykonywalne rezerwacje Recall, bez zmiany przyszłych należności. Helper dla oznaczonego issued voice task: przy processing waiting; bez processing zmienia WYŁĄCZNIE state=skipped, zwalnia cel i rozlicza go w settledChecks bieżącej sesji; dla terminal unchanged. FinalizeAttemptRow i leniwy timeout wywołują helper PO zapisie właściwej oceny/feedbacku; nextTask wywołuje go PRZED wydaniem istniejącego promptu. TaskDto.pendingAttemptId wskazuje przyjętą processing próbę; reload kontynuuje readAttempt/poll, bez nowego nagrania. Najpierw obsłużyć duplikat już przyjętego clientAttemptId, następnie odrzucać nowe audio po disable. Zero zmian answer_key/public_prompt/task.context, zero ocen za techniczny skip, brak dodatkowego budżetu.

**Błędy:** rzucać `new AppError("validation", { details: { reason } })` z enum projektu. Nie transportować powodu w message. W istniejącym errorResponse serializacja details już działa; nowy klient dopiero w zadaniu 6 waliduje i mapuje reason.

Dokładny kontrakt reprezentacji i budowania opcji (typy publiczne w contracts/kid, wewnętrzne w picture-recognition-options):

```ts
type MeaningVisual =
  | { kind: "image"; imageAssetId: string }
  | { kind: "color"; color: string }
  | { kind: "number"; count: number };
interface PictureRecognitionItem {
  itemRevisionId: string;
  position: number;
  source: string;
  target: string;
  targetLocale: string;
  acceptedAnswers: readonly string[];
  visual: MeaningVisual;
}
function buildPictureRecognitionOptions(input: {
  target: PictureRecognitionItem;
  peers: readonly PictureRecognitionItem[];
  reservedTargetKeys: readonly string[];
  rotateBy: number;
}): {
  options: Array<PlannedOption & { visual: MeaningVisual }>;
  revealsTargetKeys: string[];
} | null;
```

Zod: imageAssetId UUID, color kanoniczny kolor z obecnego walidatora, count integer 1–50. Wewnątrz PlannedOption.text pozostaje source; publiczne labelPl otrzymuje ten tekst bez correct. Funkcja nie tasuje losowo — używa position/rotateBy; materializacja tasuje tylko raz. W picture_recall labelPl to source własnej karty, a nie target.

- [ ] **Testy RED:** `non_reader_capabilities` sprawdza brak reading/spelling/textual recognition, brak Recall/pronunciation bez mikrofonu i zachowanie standardowych możliwości dla true. `picture_options_are_distinct_and_private` sprawdza 2–3 opcje, kolizje obraz/kolor/liczba/znaczenie/warianty, rezerwacje oraz brak answerKey/target w publicznym picture_recall. `picture_listening_qualifies_without_option_text` sprawdza kwalifikację Listening. `non_reader_due_spelling_does_not_block` sprawdza scheduler i recommended. `non_reader_one_item_terminates` sprawdza skończony przebieg bez mikrofonu. `picture_client_and_assignment_guards` sprawdza starszego klienta, standardowe przypisanie/lekcję/mock_test, brak UI audio i wznowienie starej aktywnej sesji.
- [ ] **Testy RED awarii:** `disable_microphone_is_idempotent` pomija voice task bez oceny, zachowuje budżet/klucz/prompt i po reload wybiera listening. `disable_microphone_during_processing_preserves_result` pozwala zakończyć już przyjętą analizę bez zmiany received_at; kolejna próba audio jest odrzucana po disable, ale odczyt istniejącej próby działa. `picture_recall_disclosure_spoils_independence` potwierdza ekspozycję przed response i niesamodzielność przed upływem 300 sekund; replay po reload także wymaga autoryzacji.
- [ ] **Testy RED po review:** `picture_recall_nonanswer_and_timeout_do_not_assess_spelling` sprawdza brak nowej oceny/pomyłki/projekcji spelling i brak letter_completion, zachowując standardowe pisemne Recall. `picture_wrong_choice_report_parses` sprawdza niepuste polskie optionText/confusion/feedback oraz ProgressDtoSchema. `active_standard_lesson_mock_session_survives_profile_change` prowadzi prawdziwy reload po PATCH canRead=false, wznowienie dokładnego trybu lub zakończenie blokującej sesji; obejmuje archived/assignment inactive i blokadę nowych startów. `only_recall_due_without_microphone_is_not_recommended` weryfikuje query, API i recommended. `picture_cover_comes_from_version` parsuje coverVisual i sprawdza pierwszą kartę przypiętej wersji. `disable_processing_first_error_uncertain_timeout_never_strands_task` obejmuje sukces, pierwszy błąd, niepewne STT i timeout; trigger SQL działa bez zmian, stan terminalny nie jest przepisany, rezerwacje znikają, drugi klient/utracony response/reload pollują pendingAttemptId i dostają zadanie niegłosowe.
- [ ] **Disclosure:** dla picture_recall authorizeDisclosure(audio/hint) po ready check i sealed exposure zwraca opcjonalny audioAssetId z przypiętej rewizji. `picture_recall_disclosure_transports_audio` sprawdza rzeczywisty HTTP response → DisclosureDtoSchema.parse → ID; początkowy prompt nie ma ID/target. Brak ready daje details.reason=picture_audio_unavailable bez oceny. Każdy replay/autoryzacja po reload zapisuje nową ekspozycję. Kontroler używa tej ścieżki przed audioAssetOf early return (zadanie 6).
- [ ] **Recall ze wsparciem:** w picture_recall po odsłuchu i wiarygodnie poprawnej odpowiedzi zachować assessment recall=correct z independent=false; nie zwiększać independentSuccesses ani kwalifikującej serii. W speech nadal wyłącznie pronunciation. Dopisać tę asercję do picture_recall_disclosure_spoils_independence, aby wykonawca nie usuwał historii wspomaganego Recall.
- [ ] **Potwierdzić RED:** `corepack pnpm test:unit -- packages/server/src/domain/vocabulary-capabilities.test.ts packages/server/src/domain/picture-recognition-options.test.ts packages/server/src/domain/evaluate.test.ts packages/server/src/modules/sessions.test.ts`; `corepack pnpm test:integration -- tests/integration/picture-vocabulary.test.ts tests/integration/sessions.test.ts tests/integration/learning-algorithm.test.ts tests/integration/reporting.test.ts`.
- [ ] **Minimalny kod:** wspólna reguła możliwości dla rezerwacji/wyboru/recommended/submit; materializować pełne wizualizacje opcji z przypiętej wersji, tasować raz, nie dodawać ćwiczeń do budżetu. picture dla true zmienia listening na obrazkowe, resztę zachowuje. Kontroler API odrzuca nowe tekstowe odpowiedzi w sesji false. W start/wznowieniu pilnować supportsPictureVocabulary; stara aktywna sesja używa własnej migawki. Wszystkie mutacje zachowują wspólną blokadę sesji i politykę Origin.
- [ ] **GREEN:** powtórzyć komendy. Fixture dwóch dzieci, dwóch klientów, utraconego response i jednego słowa. Zaktualizować mock test/workload tylko w zakresie wyłączenia ich dla nowych sesji false; żadnych zmian historii.
- [ ] **Commit:** `feat: run safe picture vocabulary sessions without reading`; dowody R01/R03/R04/R05/R07.

## Task 6: przenośny Kid UI i pełny przebieg mobilny

**Files:** Modify `packages/kid-ui/src/api/KidApi.ts`, `api/client.ts`, `session/session-controller.ts`, `session/useLearningSession.ts`, `KidApp.tsx`, `exercises/ExerciseView.tsx`, `exercises/exercise-presentation.ts`, `exercises/ListeningView.tsx`, `exercises/ExposureView.tsx`, `exercises/SpeechView.tsx`, `screens/ProfileScreen.tsx`, `screens/DeckScreen.tsx`, `screens/LearnScreen.tsx`, `screens/SummaryScreen.tsx`, `styles.css`; `tests/e2e/helpers/kid-ui-fixture.ts`. Create `exercises/PictureRecallView.tsx`, `exercises/MeaningVisual.tsx`, `session/guidance-audio.ts`, `api/client.test.ts`, `tests/e2e/helpers/picture-fixtures.ts` i testy. Test `session/session-controller.test.ts`, nowy `tests/e2e/picture-vocabulary.spec.ts` i istniejące testy layout/speech.

**Interfaces:** KidApi dodaje `readUiAudio(): Promise<UiAudioCatalogDto>` i `disableSessionMicrophone(sessionId: string): Promise<SessionDto>`; startSession wysyła supportsPictureVocabulary=true. `MeaningVisual` renderuje publiczną reprezentację z zadania 5, nie payload całej rewizji. `createGuidanceAudio(catalog: UiAudioCatalogDto, player: AudioPlayer, mediaUrl: (assetId: string) => string): { play(key: UiAudioKey): Promise<void>; stop(): void }` konsumuje istniejący AudioPlayer: kolejkowanie stałych wskazówek, stop przed recording/nawigacją także anuluje kolejkę; wzorcowe audio przechodzi przez istniejące autoryzacje disclosures. PictureRecallView ma wyłącznie mówienie, ujawnienie, „Nie pamiętam” i pominięcie, bez pola tekstowego.

**Wiązania kontrolera i fixture:** audioAssetOf rozpoznaje picture_listening; playTaskAudio dla picture_recall najpierw authorizeDisclosure i audioAssetId response, nigdy wymaganie ID w początkowym promptcie. hint renderuje obraz i daje/odtwarza audio ujawnienia. #loadNext przy pendingAttemptId uruchamia poll istniejącej próby i wyłącza nowe nagrywanie. ResumeOnly ma wyłącznie resume(activeSession.mode)/end(activeSession.sessionId), nie nowy start. Zmiana przełącznika mikrofonu odświeża listDecks z query, z epoch chroniącym nowszy stan. KidApiError dodaje opcjonalny walidowany reason i messageForError wybiera polski tekst/akcje według katalogu; nieznane details pozostają ogólnym błędem. Starszy klient może pokazać tylko dotychczasowy validation — dopiero odświeżenie uruchamia nowe mapowanie.

E2E API/DB używa FakeLlmProvider picture z zadania 2 i rzeczywistych route/migracji. UI fixture rozszerzyć o uiAudio, disable, pending i disclosures.audioAssetId; dotychczasowe fixture standardowe domyślnie zwracają ready=false/{} dla katalogu, bez zmiany starych przebiegów. Do sprawdzenia odtwarzania i ended dostarczać w picture-fixtures poprawny krótki syntetyczny WAV bez głosu dziecka przez przechwyconą route mediów (fake TTS ma obecnie niedekodowalne bajty). Kolory/liczby dają prawdziwe wizualizacje bez niedekodowalnych fake obrazów. Test nie deklaruje, że syntetyczny dźwięk dowodzi jakości polskiego TTS; realny głos pozostaje osobnym odbiorem.

- [ ] **Testy RED:** `picture_ui_uses_server_snapshot` sprawdza, że ustawienie aktualnego profilu nie nadpisuje sesji. `guidance_audio_does_not_overlap_recording` sprawdza kolejkę, stop i teardown. `non_reader_flow_needs_no_text_answer` prowadzi użytkownika przez profile/okładkę/start/exposure/listening/speech/recall/feedback/summary z ikonami i audio. `mic_denial_continues_same_session` sprawdza cancel, disable API, następne słuchanie i brak resetu budżetu. `guidance_failure_offers_retry_or_end` oraz `uncertain_stt_is_not_praised` sprawdzają awarie bez fałszywego wyniku.
- [ ] **Testy RED transportu i reload:** `kid_validation_reason_survives_http` parsuje pięć details.reason i mapuje właściwe komunikaty; nieznany reason i legacy error pozostają ogólne. `picture_recall_hint_audio_after_reload` prowadzi HTTP disclosure → parsowanie → fetch mediów/play/ended, drugi odsłuch ponawia autoryzację. `resume_only_card_uses_active_mode_and_version` sprawdza aktywną standardową sesję/lekcję/mock po zmianie profilu. `pending_attempt_after_mic_disable_is_polled` sprawdza reload między disable a wynikiem oraz brak ponownego nagrania. `two_picture_decks_have_cover_visuals` pokazuje dwa różne zestawy (kolory i liczby) bez polegania na tytułach.
- [ ] **Potwierdzić RED:** `corepack pnpm test:unit -- packages/kid-ui/src/session/session-controller.test.ts packages/kid-ui/src/session/guidance-audio.test.ts packages/kid-ui/src/api/client.test.ts`; `corepack pnpm test:e2e -- tests/e2e/picture-vocabulary.spec.ts`.
- [ ] **Minimalny kod:** ikony i mówione instrukcje; podpisy pozostają pomocnicze/a11y. Obrazkowe wybory nie pokazują angielskich odpowiedzi. Recall nie odtwarza automatycznie wzorca. Okładka to pierwsza reprezentacja publikacji, bez automatycznego czytania tytułu. Przy duplikatach awatarów ostrzeżenie rodzica i istniejący link profilu, bez wysyłania imion do TTS. Odtwarzanie zaczyna się po świadomym działaniu; blokada autoplay ma przycisk odsłuchu. Na awarię audio ikonowe retry/end.
- [ ] **GREEN:** powtórzyć komendy oraz `corepack pnpm test:e2e -- tests/e2e/kid-ui-layout.spec.ts tests/e2e/kid-layout-stability.spec.ts tests/e2e/speech-recording-ux.spec.ts`. Obejrzeć screenshoty zadania/feedbacku/summary przy 360×800, 390×844 i 768×1024. Dla rzeczywistego telefonu użyć jego viewportu; kluczowe akcje nie wymagają przewijania. Oddzielnie zapisać wynik próby z dzieckiem lub brak tego dowodu.
- [ ] **Commit:** `feat: add picture exercises and spoken guidance to Kid UI`; dowody w dzienniku.

## Task 7: rodzic, MCP, dokumentacja, review i PR

**Files:** Modify `apps/web/src/parent/ProgressPanel.tsx`, `ProgressItems.tsx`, `DeckEditor.tsx`, `ChildEditor.tsx` oraz katalog messages; `integrations/umiem-mcp/skills/umiem-learning/SKILL.md`, `docs/SPEC.md`, `docs/architecture.md`, `docs/folder-structure.md`, `docs/implementation-plan.md`. Test `tests/integration/learning-overview.test.ts`, `tests/integration/learning-mcp.test.ts`, `tests/e2e/progress-panel.spec.ts`. Nie zmieniać kontraktu learning-overview ani mianownika na potrzeby nowego wariantu.

**Interfaces:** nie ma nowego narzędzia MCP. Panel rodzica używa canRead do noty o niećwiczonych umiejętnościach, ale zachowuje poprzednie wyniki. Learning-overview zachowuje pięć umiejętności/schemaVersion/pełną liczbę słów; skill wyjaśnia, że brak ocen nie oznacza zaległości, a raport nie dostarcza informacji, kto korzysta z trybu bez czytania.

- [ ] **Testy RED:** `picture_report_keeps_full_denominators` daje obu dzieciom ten sam zestaw: false ma wyniki listening/recall/pronunciation i reading/spelling notAssessed, bez zmniejszenia totalItems; true ma także oceny pisemne. `parent_non_reader_note_preserves_history` zachowuje stare oceny reading/spelling przy zmianie flagi. Odpowiedni tekst skilla nie twierdzi, że raport ujawnia canRead. Zestawy lesson nadal nie wchodzą do overview.
- [ ] **Potwierdzić RED:** `corepack pnpm test:integration -- tests/integration/learning-overview.test.ts tests/integration/learning-mcp.test.ts`; `corepack pnpm test:e2e -- tests/e2e/progress-panel.spec.ts`.
- [ ] **Minimalny kod/dokumentacja:** ostrzeżenia niezgodnych przypisań i nota o niećwiczonych umiejętnościach; update API → MCP → skill, tabeli ścieżek, reguł publikacji i kolejności wdrożenia. Aktualizacja repo nie jest aktualizacją skilla Hermesa.
- [ ] **GREEN kontraktu:** te same komendy, `corepack pnpm contracts:export-learning-overview`, `corepack pnpm test:mcp`; odczytać diff schematu i potwierdzić brak zmiany wire shape oraz zgodność standardowego Streamable HTTP. Używać fikcyjnych danych.
- [ ] **Pełna weryfikacja:** `corepack pnpm test:unit`, `corepack pnpm test:integration`, `corepack pnpm test:e2e`, `corepack pnpm typecheck`, `corepack pnpm build`, `git diff --check`. Wszystkie wyniki aktualne i zapisane; nie zamieniać selected green w twierdzenie o całym suite.
- [ ] **Niezależny review:** requesting-code-review, pakiet celu/projektu/planu/Review Focus, całe BASE_SHA..HEAD_SHA i uncommitted diff, wyniki oraz odstępstwa. W aktywnym środowisku wybrać najmocniejszy dostępny model z wyłączeniem GPT Astra i podać go jawnie; nie hard-code modelu dla innych klientów. receiving-code-review: zweryfikować i rozwiązać Critical/Important, Minor zapisać. Poprawki zachowania wymagają RED→GREEN i adekwatnej regresji.
- [ ] **Commit końcowy:** selektywne pliki raportów/dokumentacji, `feat: report picture vocabulary practice and document integration`.
- [ ] **Dostarczenie:** verification-before-completion i finishing-a-development-branch; push gałęzi roboczej i PR do main dopiero po review/sprawdzeniach. Dołączyć PR do zadania w aplikacji. Opis: rezultat, testy, wynik review, API → MCP → skill oraz wymagane wdrożenia. Nie scalać ani nie pushować main; właściciel wykonuje Squash and merge. Nie włączać flag rodzinnych profili bez odbioru.

## Mapowanie regresji i odbiór

| Regresja | Zadania | Dowód |
| --- | --- | --- |
| R01 | 5–6 | Ekspozycje przed odpowiedzią, reload, utrata ACK/response, dwóch klientów |
| R02 | 3–4 | Niezmienne audio/obraz/UI audio, regeneracja, stary worker |
| R03 | 1, 3, 5, 7 | SQL i snapshot, brak zmian historii, istniejące CASCADE profilu |
| R04 | 5–6 | Idempotentne complete-presentation bez oceny/budżetu, pojedyncza karta |
| R05 | 5 | Rezerwacje Recall, dystraktory i wyłączenie niećwiczonych umiejętności |
| R06 | 3 | Zmiana jednej karty nie zmienia zgodnych mediów innych kart |
| R07 | 5–6 | Zatwierdzone warianty mowy, oddzielna wymowa, niepewne STT/awaria |

Wdrożenie po osobnym poleceniu: migracja → worker i gotowy katalog UI audio → web/Kid UI. Przed udostępnieniem picture upewnić się, że starszy worker nie odbierze nowych jobów. Stare runy pozostają standardowe. Odbiór na rzeczywistym urządzeniu oraz z dzieckiem zapisać osobno od E2E. Nie deklarować gotowej rodzinnej konfiguracji ani realnej jakości mowy bez tych dowodów.

## Przegląd własny planu

- [x] Wymagania projektu mają zadania i testy; cztery ćwiczenia, standardowe dzieci i no-mic są objęte.
- [x] Wspólne nazwy typów, pól, gałęzi promptu i endpointów są spójne między zadaniami.
- [x] Każdy Review Focus ma wskazany test właściciela kodu.
- [x] Plan opisuje decyzje i interfejsy, nie gotowe ciała funkcji; nie ma etapów implementacyjnych wykonanych podczas planowania.
- [x] Rozdzielono zgodę na koncept, przegląd zapisanych artefaktów, implementację, PR i wdrożenie.
