---
title: 'Dedykowany obraz zestawu na ekranie wyboru'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_revision: 'ced8cf420e2919d67cd45b60f95a11cd1dfa20ed'
baseline_commit: 'ced8cf420e2919d67cd45b60f95a11cd1dfa20ed'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/docs/SPEC.md', '{project-root}/docs/architecture.md', '{project-root}/docs/folder-structure.md']
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Karta zestawu dziecka pokazuje wizualizację pierwszego słowa, a rodzic nie może przypisać zestawowi własnego, rozpoznawalnego obrazu. Załączony ekran pokazuje kartę, na której obraz ma identyfikować cały materiał.

**Approach:** Dodaj rodzicielskie ustawienie obrazu okładkowego dla zestawu słownictwa. Po zapisaniu pokaż go na karcie dziecka; bez okładki zachowaj dotychczasowe zachowanie `coverVisual`.

## Boundaries & Constraints

**Always:** Polski interfejs rodzica i dziecka; obraz jest współdzielonym, kosmetycznym ustawieniem zestawu, niezależnym od wersji treści i postępu. Każda zmiana wymaga sesji rodzica i kontroli Origin/CSRF; przechowuj bajty w istniejącym prywatnym `MediaStore` jako niezmienny zasób, waliduj sygnaturę formatu i rozmiar po stronie serwera. Odpowiedź Kid API ujawnia wyłącznie nieprzejrzysty identyfikator zasobu.

**Never:** Nie zmieniaj ilustracji elementów, ocen, ekspozycji ani raportu MCP. Nie pobieraj obrazu z dowolnego zewnętrznego URL. Nie wymagaj okładki do publikacji ani rozpoczęcia nauki.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upload | Rodzic zapisuje obsługiwany plik obrazu dla zestawu | Okładka zostaje podpięta i widoczna w ustawieniach oraz na karcie przypisanego zestawu | Odrzuć plik nieobrazowy lub przekraczający limit; nie zmieniaj poprzedniej okładki |
| Clear | Rodzic usuwa ustawioną okładkę | Zestaw wraca do wcześniejszego `coverVisual` albo układu bez obrazu | Powtórne usunięcie jest bezpieczne |
| No cover | Zestaw nie ma ustawionej okładki | Dotychczasowa karta i start sesji działają bez zmian | Brak błędu |

</intent-contract>

## Code Map

- `packages/server/src/db/schema.ts` — `decks` przechowuje współdzielone dane zestawu; `mediaAssets` ma niezmienne zasoby i kontrolowany rodzaj.
- `packages/server/drizzle/` — migracje SQL są źródłem wdrożenia; aktualizuj schemat Drizzle i migrację razem.
- `packages/contracts/src/decks.ts` — `DeckDtoSchema`/`DeckSummaryDtoSchema` opisują odczyt rodzica; `DraftPatchSchema` jest wersjonowaną edycją treści i nie powinna przejąć ustawienia okładki.
- `packages/contracts/src/kid.ts` — `KidDeckDtoSchema.coverVisual` jest wizualizacją pierwszego elementu; dodaj osobne nullable pole okładki z zgodnością wsteczną.
- `packages/server/src/modules/decks.ts` — `readDeck` i `listDecks` składają DTO rodzica.
- `packages/server/src/modules/kid.ts:listKidDecks` — zbiorczo składa listę dziecka; obsłuż okładkę dla zwykłych, rekomendowanych i wznawianych zestawów.
- `packages/server/src/modules/media-reconciliation.ts:readReadyMedia` oraz `apps/web/src/app/api/v1/media/[id]/route.ts` — nieprzejrzyste ID i serwowanie wyłącznie gotowych bajtów z prywatnego magazynu.
- `apps/web/src/parent/DeckEditor.tsx` — istniejący rodzicielski edytor słówek, zapis szkicu, konflikty i miejsca na ustawienia zestawu.
- `apps/web/src/parent/parent-router.ts` — chronione endpointy rodzica i wspólny parser JSON; upload wymaga jawnego, ograniczonego wejścia binarnego.
- `packages/kid-ui/src/screens/DeckScreen.tsx` — karta używa `MeaningVisualView` dla `coverVisual`; renderuj dedykowaną okładkę z priorytetem i zachowaj fallback.
- `packages/kid-ui/src/styles.css` — układ kart mobilnych; obraz powinien mieć stabilny rozmiar i `object-fit`.
- `docs/SPEC.md`, `docs/architecture.md`, `docs/folder-structure.md` — dopisz decyzję o okładce, jej globalnym zakresie i fallbacku.

## Tasks & Acceptance

**Execution:**
- [x] `packages/server/src/db/schema.ts` and `packages/server/drizzle/0011_deck_cover_image.sql` — add nullable deck-to-cover asset reference and supported cover media kind — persist an optional immutable image without coupling it to learning revisions.
- [x] `packages/contracts/src/decks.ts`, `packages/contracts/src/kid.ts`, and `packages/contracts/src/deck-cover.test.ts` — expose nullable cover asset ID and validate parent setting commands — preserve older clients and distinguish covers from item visuals.
- [x] `packages/server/src/modules/decks.ts`, `packages/server/src/modules/deck-cover.ts`, `packages/server/src/modules/deck-cover.test.ts`, and `apps/web/src/parent/parent-router.ts` — implement authorized bounded upload, clear, and DTO reads — keep invalid uploads from replacing a working cover and use the existing private media path.
- [x] `apps/web/src/parent/DeckEditor.tsx`, `apps/web/src/parent/deck-cover.test.tsx`, and `packages/contracts/src/messages.ts` — add image setting, preview, removal, busy/error feedback — make cover management usable for published and draft vocabulary decks.
- [x] `packages/server/src/modules/kid.ts`, `tests/integration/deck-cover.test.ts`, `packages/kid-ui/src/screens/DeckScreen.tsx`, `packages/kid-ui/src/screens/deck-cover.test.tsx`, `packages/kid-ui/src/styles.css`, and `tests/e2e/deck-cover-image.spec.ts` — return and render dedicated cover before the legacy visual — display it on the actual child selection screen.
- [x] `docs/SPEC.md`, `docs/architecture.md`, and `docs/folder-structure.md` — record that covers are shared deck metadata and document upload/clear and fallback behavior — keep product and architecture references aligned.

**Acceptance Criteria:**
- Given a parent edits a vocabulary deck, when they upload a valid image and save, then the image is previewed in settings and is returned for assigned child deck cards.
- Given a deck has a dedicated cover and a first-item illustration, when the child opens deck selection, then the dedicated cover is displayed and the title, progress stars, test date, and actions remain available.
- Given a deck has no dedicated cover, when the child opens selection, then the existing `coverVisual` behavior remains intact.
- Given a parent clears a cover, when the child reloads deck selection, then the dedicated cover is gone and the existing fallback is used.
- Given a malformed, unsupported, or over-limit upload, when the parent saves it, then the API returns a clear validation error and preserves the current cover.
- Given an older Kid client reads a deck DTO without a cover ID, when it parses the response, then existing behavior remains valid.

## Design Notes

The cover belongs to the shared `decks` record, not `deck_versions`: it labels the whole set and is not learning content. Updating it must not create a draft, alter pinned session content, or reset progress. Keep existing `coverVisual` as a fallback for decks that have not been configured.

## Verification

**Commands and results (2026-10-15):**
- `corepack pnpm install --prefer-offline --frozen-lockfile` — passed; lockfile is current.
- `corepack pnpm vitest run --config vitest.unit.config.ts packages/contracts/src/deck-cover.test.ts packages/server/src/modules/deck-cover.test.ts apps/web/src/parent/deck-cover.test.tsx packages/kid-ui/src/screens/deck-cover.test.tsx` — passed, 4 files / 10 tests.
- `corepack pnpm vitest run --config vitest.integration.config.ts tests/integration/deck-cover.test.ts` — passed, 1 file / 2 PostgreSQL integration tests.
- `corepack pnpm typecheck` — passed for all workspaces.
- `corepack pnpm exec playwright test tests/e2e/deck-cover-image.spec.ts` — passed, 1 browser test. It verifies display precedence and card information with a fixture; the upload/clear HTTP path is covered by integration tests, while the parent control behavior is covered by component tests.
- `git diff --check` — passed; only Git line-ending conversion notices were printed.

The initial combined Vitest invocation used the default config for the integration file and failed to resolve the web `@/` alias. Re-running suites with their repository-specific configs passed. No physical-device check was performed.

## Review Triage Log

| # | Layer | Finding | Verdict | Route and rationale |
|---|---|---|---|---|
| 1 | Blind hunter | Header signatures alone can accept corrupt image data. | medium / patch | Added full decode validation with `sharp`; malformed images fail before storage. |
| 2 | Blind hunter | No fallback if a stored cover later fails to load. | low / reject | A media read failure is outside the upload contract and would add a second image-state branch; current serving path returns only ready assets. |
| 3 | Blind hunter | No decoded pixel-dimension limit. | medium / patch | Added a 20-megapixel ceiling during full decode to limit decompression work. |
| 4 | Blind hunter | Cover asset FK has no delete behavior. | false / reject | There is no media-asset deletion path; restrictive FK behavior protects referential integrity. |
| 5 | Blind hunter | A blob could be orphaned if the DB write fails after immutable storage succeeds. | low / reject | This is the existing immutable media write pattern and requires a DB failure in the narrow post-write window; adding cross-store garbage collection is outside this feature. |
| 6 | Blind hunter | Missing backward-compatibility test for `DeckSummaryDtoSchema`. | low / patch | Added a contract test parsing the legacy DTO without `coverAssetId`. |
| 7 | Blind hunter | Parent/Kid UI tests did not exercise file selection or busy controls. | low / patch | Parent component test now invokes file selection and checks upload/removal disabled state while busy. |
| 8 | Blind hunter | Unit Vitest config expands TSX discovery under Node environment. | false / reject | The repository currently has only the two new TSX tests in the unit suite; both are intentionally Node-rendered and pass under that config. |
| 9 | Edge hunter | Malformed image payload may pass signature validation. | medium / patch | Same root cause as #1; the independent report is retained here and addressed by full decoding. |
| 10 | Edge hunter | Deck deletion could race the cover update. | false / reject | Application deck removal archives rather than hard-deletes; this race is not reachable through current operations. |
| 11 | Verification gap | Active-session branch of `listKidDecks` lacked cover coverage. | low / patch | Integration test now creates an active session and asserts the shared cover is present. |

Intent alignment check found no scope divergence: the implementation adds parent set settings and displays a dedicated set image on the child selection card; the image is stored at deck scope, independently of item visuals and revisions. The E2E uses a fixture for rendering, with upload/clear verified through HTTP integration and parent file-selection behavior through component tests.

## Auto Run Result

- Implemented and verified the requested shared deck cover for vocabulary sets, with parent upload/removal, private immutable media, MIME/signature/decode/size/pixel validation, Kid DTO delivery, and fallback to the existing item visual.
- Review: 11 findings triaged; 4 patch entries (1 grouped medium root cause plus 3 low findings), 0 high findings, 5 rejected findings, 0 deferred. `followup_review_recommended: false` because the patch entries are addressed and all verification commands passed.
- Residual validation limit: E2E confirms card rendering with a fixture; the complete parent-upload-to-child-display journey is covered across focused integration/component/E2E checks rather than one browser scenario. Physical devices were not tested.
