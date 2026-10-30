# Ton TTS — etap A (styl według roli) — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Komunikaty Kid UI, nagrania pytań i kart lekcji dostają stały styl wypowiedzi według roli (instrukcja stylu Gemini), z wyłącznikiem `UMIEM_TTS_STYLE`, odczytem zapasowym komunikatów i poleceniem ponownego nagrania.

**Architecture:** Domena zna klucz stylu (`TtsRoleStyle`); czysta funkcja profilu przy adapterze (`providers/tts-style-profile.ts`) składa `instructions` = instrukcja języka z etapu 1 + zdanie stylu. Wynik idzie istniejącym polem `instructions` z etapu 1 do fingerprintu, metadanych i żądania. Bez migracji i zmian kontraktów.

**Tech Stack:** TypeScript strict, Drizzle/PostgreSQL, Vitest (unit + integracja), pnpm.

**Spec:** `docs/superpowers/specs/2026-10-30-tts-voice-style-design.md` (§1–3, §5–8).

**Warunek startu:** PR #188 (etap 1) scalony do `main`; gałąź zsynchronizowana z bazą (`sync_with_base_branch`). Plan zakłada jego API: `ttsInstructionsFor(tts, locale)`, `MediaSettings.tts.instructions`, `TtsFingerprintInput.instructions?`, `TtsSynthesizeInput.instructions?`, `metadata.instructions` w `ui-audio.ts`/`media-reconciliation.ts`/`media-generation.ts`.

## Global Constraints

- Niezmiennik: bez stylu, przy locale ≠ `pl-PL` lub `tts.style` ≠ `"instructions"` wynik profilu === `ttsInstructionsFor(tts, locale)` (fingerprinty słówek bez zmian).
- Profil nigdy nie zwraca `""`; łączenie: niepuste elementy `[instrukcjaJęzyka, zdanieStylu]` złączone jedną spacją.
- Zdania stylu ≤ 120 znaków; brzmienie dokładnie z tabeli spec §3.2.
- `UMIEM_TTS_STYLE`: `instructions` | `none`; brak/pusty = `none`; inna wartość = `Error("UMIEM_TTS_STYLE must be instructions or none")`.
- Klucz stylu nie trafia do metadanych zasobu; `isUiAudioAssetMetadata` bez zmian.
- Kid UI: bez zmian. Kontrakty `@learning/contracts`: bez zmian. MCP/`SKILL.md`: bez zmian (uzasadnienie w PR, spec §6).
- Teksty i dokumentacja po polsku; identyfikatory po angielsku. Nie wypychaj do `main`, nie scalaj PR.

## Review Focus

- Wdrożenie z `UMIEM_TTS_STYLE=instructions` przy już gotowych neutralnych komunikatach: dziecko musi słyszeć stare nagrania do czasu nowych (Task 3, test „fallback po zmianie stylu”).
- Komunikat, którego tekst zmieniono w `messages.uiAudio`: odczyt zapasowy nie może odtworzyć starego tekstu (Task 3, test „fallback ignoruje inny tekst”).
- Locale `en-GB` z przypadkowo podanym stylem (np. przyszły wywołujący): wynik = sama instrukcja języka (Task 2).
- Ponowne nagranie komunikatu, którego bieżące nagranie jeszcze nie istnieje albo jest `pending`: polecenie nie mnoży oczekujących generacji (Task 5, test idempotencji pending).
- `UMIEM_TTS_STYLE=none` po okresie `instructions`: odczyt od razu wraca do nagrań etapu 1 (Task 3, test wyłącznika).

---

### Task 1: Konfiguracja `UMIEM_TTS_STYLE`

**Files:**
- Modify: `packages/server/src/config.ts` (`MediaSettings.tts`, `mediaSettingsFromEnv`)
- Modify: `.env.example`, `docs/provider-config.md`
- Test: `packages/server/src/config.test.ts`

**Interfaces:**
- Produces: `MediaSettings["tts"]["style"]?: TtsStyleMode`, `export type TtsStyleMode = "instructions" | "none"` w `config.ts`.

- [ ] **Step 1: Testy** w `config.test.ts`:
  - `mediaSettingsFromEnv({})` → `tts.style` undefined;
  - `{ UMIEM_TTS_STYLE: "instructions" }` → `tts.style === "instructions"`;
  - `{ UMIEM_TTS_STYLE: "" }` → undefined;
  - `{ UMIEM_TTS_STYLE: "loud" }` → `toThrow("UMIEM_TTS_STYLE must be instructions or none")`.
- [ ] **Step 2:** `pnpm vitest run packages/server/src/config.test.ts` → FAIL.
- [ ] **Step 3:** Pole opcjonalne `style?: TtsStyleMode` (komentarz: wyłącznik operatora, spec §2.2); parser `ttsStyleFromEnv` obok `ttsFormatFromEnv`; `"none"` zapisuj jako brak pola (fingerprinty i `defaultMediaSettings` bez zmian).
- [ ] **Step 4:** test → PASS.
- [ ] **Step 5:** `.env.example` — wpis `UMIEM_TTS_STYLE=instructions` przy konfiguracji Gemini z komentarzem po polsku („styl wypowiedzi komunikatów i lekcji; none = wyłącznik”); `docs/provider-config.md` — jedno zdanie o zmiennej.
- [ ] **Step 6: Commit** `Konfiguracja: UMIEM_TTS_STYLE (styl wypowiedzi TTS)`.

### Task 2: Styl w domenie i profil stylu

**Files:**
- Create: `packages/server/src/domain/tts-style.ts`
- Create: `packages/server/src/providers/tts-style-profile.ts`
- Modify: `packages/server/src/domain/ui-audio-catalog.ts`
- Test: `packages/server/src/providers/tts-style-profile.test.ts`, `packages/server/src/domain/ui-audio-catalog.test.ts`

**Interfaces:**
- Produces:
  - `domain/tts-style.ts`: `export type TtsRoleStyle = "ui_praise" | "ui_gentle" | "ui_guidance" | "ui_closing" | "lesson_question" | "lesson_card"`; `export type TtsStyle = TtsRoleStyle` (etap B rozszerzy o tony).
  - `domain/ui-audio-catalog.ts`: `export const UI_AUDIO_STYLES = {...} satisfies Record<UiAudioKey, TtsRoleStyle>` wg spec §3.1.
  - `providers/tts-style-profile.ts`: `export function ttsRequestInstructions(tts: MediaSettings["tts"], locale: string, style?: TtsStyle): string | undefined`; `export const STYLE_SENTENCES_PL: Readonly<Record<TtsStyle, string>>` (tekst z spec §3.2).

- [ ] **Step 1: Testy profilu:**
  - `tts = { ...fakeMediaSettings.tts, style: "instructions", instructions: { "pl-PL": "Mów po polsku, z polską wymową." } }`:
    - `ttsRequestInstructions(tts, "pl-PL", "ui_praise")` === `"Mów po polsku, z polską wymową. Powiedz radośnie, z uśmiechem w głosie, jak do ośmiolatka."`;
    - bez stylu === `"Mów po polsku, z polską wymową."`;
    - `"en-GB"` ze stylem === `ttsInstructionsFor(tts, "en-GB")` (undefined).
  - `tts.style` undefined, ze stylem === `ttsInstructionsFor(tts, "pl-PL")`.
  - Brak `instructions` w env, `style: "instructions"` → samo zdanie stylu; brak obu → `undefined` (nigdy `""`).
  - `inline snapshot` złączonego tekstu dla każdego `TtsRoleStyle`.
  - Każde zdanie w `STYLE_SENTENCES_PL` ma długość ≤ 120.
- [ ] **Step 2: Test katalogu:** `Object.keys(UI_AUDIO_STYLES).sort()` równa `UiAudioKeySchema.options` posortowanym; `UI_AUDIO_STYLES.correct === "ui_praise"`, `UI_AUDIO_STYLES.summary === "ui_closing"`.
- [ ] **Step 3:** `pnpm vitest run packages/server/src/providers/tts-style-profile.test.ts packages/server/src/domain/ui-audio-catalog.test.ts` → FAIL.
- [ ] **Step 4:** Implementacja wg Interfaces; `domain/tts-style.ts` bez importów infrastruktury; profil importuje `ttsInstructionsFor` z `config.ts` i typ z domeny.
- [ ] **Step 5:** testy → PASS; `pnpm vitest run packages/server/src/modules/module-boundaries.architecture.test.ts packages/server/src/domain/lessons/architecture.test.ts` → PASS.
- [ ] **Step 6: Commit** `TTS: styl wypowiedzi według roli — domena i profil instrukcyjny`.

### Task 3: Komunikaty Kid UI — styl, odczyt zapasowy, fake

**Files:**
- Modify: `packages/server/src/modules/materials/ui-audio.ts` (`requestOf`, `readUiAudio`)
- Modify: `packages/server/src/providers/fake.ts` (`FakeTtsProvider.synthesize`)
- Test: `tests/integration/ui-audio.test.ts`, `packages/server/src/providers/fake.test.ts`

**Interfaces:**
- Consumes: `ttsRequestInstructions`, `UI_AUDIO_STYLES` (Task 2).
- Produces: bez nowych eksportów; `readUiAudio` zachowuje sygnaturę i DTO.

- [ ] **Step 1: Test fake:** dwa wywołania `synthesize` różniące się tylko `instructions` dają różne `bytes`.
- [ ] **Step 2: Testy integracyjne** (`ui-audio.test.ts`, usługi z `style: "instructions"`, `instructions: { "pl-PL": "PL." }`):
  - „styl roli w żądaniu”: po `prepareUiAudio` + wykonaniu `fakes.tts.requests.find(r => r.text === messages.uiAudio.correct)?.instructions` === `"PL. " + STYLE_SENTENCES_PL.ui_praise`.
  - „fallback po zmianie stylu”: komplet gotowych nagrań bez stylu → usługi ze stylem → `prepareUiAudio` (17 pending) → `readUiAudio` daje `ready: true` i te same `assetId` co przed zmianą; po wykonaniu nowych — nowe `assetId`.
  - „fallback ignoruje inny tekst”: gotowe nagranie z `uiAudioKey: "summary"` i innym `text` (wstaw wiersz SQL jak w teście „osierocony TTS”) → nie jest użyte (`ready: false` gdy brak innych).
  - „wyłącznik”: po gotowych nagraniach ze stylem usługi z `style` undefined → `readUiAudio` zwraca nagrania etapu 1 (pierwotne `assetId`).
  - Zaktualizuj istniejący test „zmiana głosu zachowuje stare bajty”: po zmianie głosu `readUiAudio(changedServices)` → `ready: true`, `assets.summary === oldId` (fallback) — zamiast `ready: false`.
  - Zaktualizuj „po awarii TTS read pozostaje niegotowy”: gdy wcześniej nie było żadnego gotowego nagrania, nadal `ready: false`.
- [ ] **Step 3:** `UMIEM_INTEGRATION_BUCKET=<kosz ui-audio> pnpm test:integration` (kosz z `tests/integration-buckets.ts`) → FAIL na nowych testach.
- [ ] **Step 4:** `requestOf`: `instructions = ttsRequestInstructions(settings, "pl-PL", UI_AUDIO_STYLES[key])`. `readUiAudio`: po pętli po fingerprintach, dla każdego brakującego klucza jedno zapytanie o najnowszy (`created_at desc`) gotowy TTS z `metadata->>'purpose' = 'kid_ui_guidance'`, `metadata->>'uiAudioKey' = key`, `metadata->>'text' = UI_AUDIO_TEXTS[key]`, przefiltrowany `isUiAudioAssetMetadata`. Komentarz z odwołaniem do spec §3.4. `FakeTtsProvider`: dołącz `input.instructions ?? ""` do ziarna `deterministicBytes`.
- [ ] **Step 5:** testy → PASS; `pnpm vitest run packages/server/src/providers/fake.test.ts` → PASS.
- [ ] **Step 6: Commit** `Kid UI audio: styl roli i odczyt zapasowy poprzedniego nagrania`.

### Task 4: Pytania i karty lekcji ze stylem roli

**Files:**
- Modify: `packages/server/src/modules/materials/media-reconciliation.ts` (`ttsAsset`, `requiredAssetsForLessonExercise`, `requiredAssetsForLessonCards`)
- Test: `tests/integration/lesson-question-audio.test.ts`, `tests/integration/lesson-card-audio.test.ts` (helpery: `tests/integration/school-lesson-audio-helpers.ts`)

**Interfaces:**
- Consumes: `ttsRequestInstructions`, `TtsRoleStyle`.
- Produces: `ttsAsset(role, text, locale, settings, style?: TtsStyle)` (prywatna).

- [ ] **Step 1: Testy integracyjne** z ustawieniami `style: "instructions"` i `instructions` dla `pl-PL` i `en-GB`:
  - `lesson-question-audio`: metadane zasobu `prompt_audio` mają `instructions` kończące się `STYLE_SENTENCES_PL.lesson_question`; `target_audio` odpowiedzi (`en-GB`, jeśli przedmiot ma `ttsForAnswers`) — `instructions` === instrukcja `en-GB`.
  - `lesson-card-audio`: zasób karty ma `instructions` kończące się `STYLE_SENTENCES_PL.lesson_card`.
  - Bez `style` w ustawieniach: fingerprinty `prompt_audio` równe tym z etapu 1 (porównaj z `ttsFingerprint` liczonym z `ttsInstructionsFor`).
- [ ] **Step 2:** odpowiednie kosze integracji → FAIL.
- [ ] **Step 3:** `ttsAsset` liczy `instructions` przez `ttsRequestInstructions(settings.tts, locale, style)`; pytania przekazują `"lesson_question"`, karty `"lesson_card"`; `target_audio`/`example_audio` bez stylu.
- [ ] **Step 4:** testy → PASS; dodatkowo `tests/integration/publish-media-reconcile.test.ts` i `media.test.ts` → PASS (słówka bez zmian).
- [ ] **Step 5: Commit** `Lekcje: styl roli w nagraniach pytań i kart`.

### Task 5: Ponowne nagranie komunikatu (polecenie serwisowe)

**Files:**
- Modify: `packages/server/src/modules/materials/ui-audio.ts` (nowa funkcja), `packages/server/src/modules/materials/index.ts`, `packages/server/src/index.ts`
- Create: `apps/worker/src/regenerate-ui-audio.ts`
- Modify: `apps/worker/package.json` (`"ui-audio:regenerate": "tsx src/regenerate-ui-audio.ts"`), root `package.json` (`"media:regenerate-ui-audio"` delegujące do workera, wzór `progress:rebuild`)
- Test: `tests/integration/ui-audio.test.ts`

**Interfaces:**
- Produces: `export async function regenerateUiAudio(services: Services, keys: readonly UiAudioKey[]): Promise<{ queued: UiAudioKey[]; skipped: UiAudioKey[] }>` — eksport przez barrel `materials` i `@learning/server`.

- [ ] **Step 1: Testy:**
  - po gotowym komplecie `regenerateUiAudio(services, ["correct"])` → `{ queued: ["correct"], skipped: [] }`, nowy wiersz pending z tym samym fingerprintem i `generation_number = 2`; `readUiAudio` dalej zwraca stare `assetId` do wykonania, po wykonaniu — nowe.
  - wywołanie przy istniejącej pending generacji tego fingerprintu → `skipped: ["correct"]`, brak nowego wiersza.
  - pusta lista → `Error`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementacja: dla każdego klucza `requestOf`, w transakcji z `pg_advisory_xact_lock(hashtext(fingerprint))` jak `prepareUiAudio`; pending → `skipped`; inaczej insert `media_assets` (`generationNumber` = max + 1) i `generation_runs` jak w `prepareUiAudio` (wydziel wspólny prywatny `enqueueUiAudioTx`). Skrypt workera: argumenty = klucze walidowane `UiAudioKeySchema` (nieznany → `Usage: media:regenerate-ui-audio <klucz…>`), usługi `createServices({ db, media: mediaSettingsFromEnv(process.env) })`, wypisanie wyniku JSON; wzór obsługi błędów z `rebuild-progress.ts`.
- [ ] **Step 4:** testy → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `Kid UI audio: polecenie ponownego nagrania komunikatu`.

### Task 6: Próbki do odsłuchu i dokumentacja

**Files:**
- Create: `scripts/sample-tts-styles.mts`; root `package.json` `"eval:tts-styles"` (wzór `eval:school-grader`)
- Modify: `.kiro/specs/school-subjects/design.md` (§11.2 i §12.2: jedno zdanie odsyłające do spec tonu), `docs/architecture.md` (§8 mediów: fingerprint zawiera instrukcję stylu — jedno zdanie)

**Interfaces:**
- Consumes: `createGenerationDepsFromEnv`, `mediaSettingsFromEnv`, `ttsRequestInstructions`, `UI_AUDIO_STYLES`, `UI_AUDIO_TEXTS`.

- [ ] **Step 1:** Skrypt: wymaga `--out <katalog>` spoza repo (odmowa, gdy ścieżka leży w `git rev-parse --show-toplevel`); generuje 17 komunikatów oraz po jednym przykładowym pytaniu i karcie (stałe przykładowe teksty w skrypcie) z bieżącą konfiguracją; zapisuje `<rola>-<klucz>.wav|mp3` i `index.txt` (tekst + instrukcja). Nie dotyka bazy.
- [ ] **Step 2:** `pnpm eval:tts-styles -- --out <katalog w scratchpad>` z fake providerami (`UMIEM_FAKE_PROVIDERS=1`) → pliki powstają, kod wyjścia 0.
- [ ] **Step 3:** Dokumentacja wg Files.
- [ ] **Step 4: Commit** `TTS: skrypt próbek stylów i dokumentacja`.

### Task 7: Weryfikacja i PR

- [ ] **Step 1:** `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration` → PASS.
- [ ] **Step 2:** `pnpm test:e2e:shards` → PASS (Kid UI audio fixture’y; brak zmian Kid UI, ale katalog komunikatów jest używany w E2E).
- [ ] **Step 3:** Odsłuch właściciela: uruchom `pnpm eval:tts-styles -- --out <katalog>` z prawdziwym kluczem (tylko gdy właściciel udostępni środowisko), przekaż pliki (`SendUserFile`), zapisz decyzję i ewentualne poprawki brzmienia (`STYLE_SENTENCES_PL` + snapshot).
- [ ] **Step 4:** Push gałęzi, PR do `main` z opisem: zakres A, niezmiennik słówek, wdrożenie (`UMIEM_TTS_STYLE=instructions`, web+worker razem), API → MCP → skill: brak wpływu (spec §6), wykonane sprawdzenia, brak testu na fizycznym urządzeniu. Nie scalaj.
