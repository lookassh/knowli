---
title: 'Generowanie obrazu okładkowego zestawu'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_revision: '11e6878ae2dd5487b397ade29c29041b912c5047'
baseline_commit: '11e6878ae2dd5487b397ade29c29041b912c5047'
review_loop_iteration: 0
followup_review_recommended: true
context: ['{project-root}/docs/SPEC.md', '{project-root}/docs/architecture.md']
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Rodzic może ustawić okładkę zestawu tylko przez przesłanie pliku, mimo że aplikacja ma już provider generowania obrazów.

**Approach:** Dodaj chronioną akcję generowania propozycji okładki na podstawie nazwy zestawu i jego słownictwa. Pokaż wynik rodzicowi jako tymczasowy podgląd; zapisuj go jako okładkę dopiero po jawnym zaakceptowaniu.

## Boundaries & Constraints

**Always:** Generowanie odbywa się po stronie serwera, pod sesją rodzica i kontrolą Origin/CSRF. Użyj skonfigurowanego `ImageProvider` i ustawień mediów; nie ujawniaj klucza. Prompt zawiera wyłącznie tytuł zestawu i ograniczoną próbkę par słówek, bez profilu ani danych dziecka. Błąd lub odrzucenie propozycji nie zmienia bieżącej okładki. Akceptacja używa istniejącej walidacji i niezmiennego prywatnego MediaStore.

**Never:** Nie zapisuj wygenerowanego obrazu przed akceptacją, nie uruchamiaj generowania automatycznie przy wejściu do edytora, nie zmieniaj ilustracji słówek ani wersji materiału. Nie pozwalaj dziecku ani niezalogowanemu klientowi generować obrazów.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Generate | Rodzic żąda propozycji dla zestawu słownictwa z materiałem | Serwer zwraca walidowany obraz tymczasowy, UI pokazuje podgląd i akcje akceptacji/odrzucenia | Obecna okładka bez zmian przy awarii |
| Accept | Rodzic akceptuje widoczny podgląd | Bajty trafiają do istniejącej ścieżki uploadu i stają się okładką zestawu | Zachowaj poprzednią okładkę przy błędzie zapisu |
| No provider/material | Provider nie skonfigurowany albo brak wersji z pozycjami | Generowanie niedostępne lub zwraca jasny komunikat | Bez ujawnienia szczegółów providera |

</intent-contract>

## Code Map

- `packages/server/src/ports/ai.ts:ImageProvider` and `packages/server/src/providers/images/openai.ts:createOpenAiImageProvider` — istniejący port i adapter; implementacja requestu oraz sekret pozostają po stronie serwera.
- `packages/server/src/providers/generation-env.ts:createGenerationDepsFromEnv` — konfiguracja providerów z `OPENAI_API_KEY`; rozważ wyodrębnienie samego image provider dla procesu web bez uruchamiania LLM/TTS.
- `packages/server/src/config.ts:Services` and `apps/web/src/composition.ts:initialize` — web composition ma ustawienia mediów i MediaStore, ale obecnie nie udostępnia generatora obrazów.
- `packages/server/src/modules/deck-cover.ts:setDeckCover` — waliduje rozmiar, MIME, dekodowanie i wymiary oraz dopiero potem podmienia referencję okładki; zaakceptowane bajty mogą przejść tą ścieżką.
- `packages/server/src/db/schema.ts:decks`, `deckVersions`, `itemRevisions` — wybierz edytowalną wersję draft/review, a jeśli jej nie ma, opublikowaną; pozycje mają pary `source`/`target` w payload.
- `apps/web/src/parent/parent-router.ts:handleParentApi` — chroni endpointy rodzica; dodaj osobną akcję `/decks/:id/cover/generate` zwracającą zwalidowane bajty, nie DTO dziecka.
- `apps/web/src/parent/DeckEditor.tsx` and `DeckCoverSettings.tsx` — aktualny panel uploadu; dodaj stan podglądu, generowanie, zaakceptowanie oraz odrzucenie.
- `packages/contracts/src/messages.ts` — wspólny katalog polskich etykiet i błędów panelu.
- `tests/integration/deck-cover.test.ts`, `apps/web/src/parent/deck-cover.test.tsx`, `tests/e2e/deck-cover-image.spec.ts` — rozszerz testy serwera, kontroli rodzica i karty/ustawień; użyj fake providera z prawidłowymi bajtami obrazu.
- `docs/SPEC.md`, `docs/architecture.md` — opisz jawny podgląd i zgodę rodzica; endpoint rodzica nie jest zmianą kontraktu MCP.

## Tasks & Acceptance

**Execution:**
- [x] `packages/server/src/config.ts`, `packages/server/src/providers/generation-env.ts`, and `apps/web/src/composition.ts` — udostępnij opcjonalny provider obrazu w web — pozwól użyć istniejącej konfiguracji serwerowej bez ujawniania klucza.
- [x] `packages/server/src/modules/deck-cover.ts` and `apps/web/src/parent/parent-router.ts` — zbuduj prompt z wybranej wersji słownictwa, wygeneruj i zwaliduj tymczasowe bajty — nie zapisuj ani nie podmieniaj okładki przed akceptacją.
- [x] `apps/web/src/parent/DeckCoverSettings.tsx`, `apps/web/src/parent/DeckEditor.tsx`, and `packages/contracts/src/messages.ts` — dodaj generowanie, podgląd, akceptację i odrzucenie — zachowaj poprzednią okładkę i dostępność uploadu.
- [x] `packages/server/src/providers/fake.ts`, `tests/integration/deck-cover.test.ts`, `apps/web/src/parent/deck-cover.test.tsx`, and `tests/e2e/deck-cover-image.spec.ts` — pokryj provider, błąd, brak zapisu przed akceptacją, akceptację i widok — utrzymaj powtarzalne testy bez zewnętrznej usługi.
- [x] `docs/SPEC.md` and `docs/architecture.md` — zapisz zachowanie preview/accept i wpływ integracji — utrzymaj dokumentację zgodną z przepływem.

**Acceptance Criteria:**
- Given rodzic edytuje zestaw z materiałem i provider jest skonfigurowany, when wybiera generowanie, then widzi obraz oparty na nazwie i słownictwie zestawu oraz akcje „Ustaw jako okładkę” i „Odrzuć”.
- Given rodzic ma wygenerowany podgląd, when go odrzuca lub generowanie kończy się błędem, then bieżąca okładka i karta dziecka pozostają bez zmian.
- Given rodzic akceptuje podgląd, when zapis okładki powiedzie się, then nowy obraz pojawia się w ustawieniach i na karcie dziecka.
- Given provider lub materiał nie jest dostępny, when rodzic próbuje generować, then otrzymuje polski komunikat, a upload pliku i istniejąca okładka nadal działają.
- Given klient bez sesji rodzica albo z obcym Origin wywołuje generowanie, when serwer obsługuje żądanie, then odrzuca je bez wywołania providera.

## Design Notes

Generowanie jest akcją kosztową, dlatego nie uruchamia się automatycznie. Podgląd pozostaje wyłącznie w stanie UI i pamięci żądania; przyjęcie ponownie wysyła jego bajty do już istniejącego endpointu uploadu, który waliduje je i zapisuje immutable asset. Używaj krótkiej próbki słówek, aby ograniczyć prompt i nie wysyłać danych profilu dziecka.

## Verification

**Commands:**
- `corepack pnpm vitest run --config vitest.unit.config.ts packages/server/src/modules/deck-cover.test.ts apps/web/src/parent/deck-cover.test.tsx` — passed, 2 files / 7 tests.
- `corepack pnpm vitest run --config vitest.integration.config.ts tests/integration/deck-cover.test.ts` — passed, 1 file / 3 tests.
- `corepack pnpm typecheck` — passed for all workspaces.
- `UMIEM_TEST_RUN_ID=cover-generation-final UMIEM_E2E_PORT=24574 corepack pnpm exec playwright test tests/e2e/deck-cover-image.spec.ts` — passed, 2 browser tests; parent can generate, reject, and accept a proposal, and child card rendering remains covered.
- `git diff --check` — passed; Git printed only line-ending conversion notices.

## Spec Change Log

- 2026-10-15: Wdrożono generowanie tymczasowej propozycji okładki z autoryzacją rodzica, podglądem i jawną akceptacją przez istniejący upload.

## Review Triage Log

### 2026-10-15 — Review pass
- verdicts: 10 findings — high 0, medium 3, low 6, false 1, maybe-false 0
- findings:
  - `[medium]` `[patch]` Late generation response can attach to the newly selected deck — captured deck ID and generation token now reject stale responses; covered by request guards and deck-switch cleanup.
  - `[medium]` `[patch]` A pending proposal could overwrite a later upload or removal — upload/removal invalidates and revokes the proposal before starting.
  - `[low]` `[patch]` Generation status text was unused and busy state looked like a save — separate generating state now displays the Polish progress status; unused availability text was removed, and the unavailable-provider response remains localized by the server.
  - `[low]` `[reject]` Repeated authenticated requests have no server-side cost throttle — only a parent can invoke this explicit action and the UI disables it while running; cross-session rate limiting adds state beyond this low-likelihood case.
  - `[low]` `[patch]` Editable vocabulary values could be read as prompt instructions — values are JSON-encoded as literal subject data with an explicit instruction to ignore embedded instructions.
  - `[false]` `[reject]` Integration test did not upload accepted generated bytes — Playwright generates, accepts, and verifies the saved cover through the real upload endpoint; integration separately verifies generation and upload endpoint behavior.
  - `[low]` `[patch]` Base64 and data URL duplicated generated image in client state — endpoint now returns binary image bytes and UI uses a Blob-backed object URL, revoked when replaced, rejected, switched, or unmounted.
  - `[medium]` `[patch]` Edge review repeated the stale response across deck switch — same verified defect and fix as the first finding; generation token and deck identity guard late responses.
  - `[low]` `[patch]` Truncating the combined source/target pair could remove its translation — source and target are now truncated independently, preserving each side.
  - `[low]` `[patch]` Invalid generated provider output lacked regression coverage — integration checks wrong MIME/signature, malformed data, and oversize output; each is rejected without replacing the saved cover.

Intent alignment: the one-word “Dodaj” accepted the immediately preceding offer to add generation from set title/vocabulary with parent preview and acceptance; the implementation and tests cover that parent flow and retain child selection cover rendering.

## Auto Run Result

- Added parent-only generated cover proposals from a set title and up to eight saved vocabulary pairs. The proposal is validated and previewed without persistence; explicit acceptance uses the existing upload and immutable media path.
- Files changed: `apps/web/src/composition.ts` exposes the optional server-side provider; `apps/web/src/parent/parent-router.ts` adds the protected preview endpoint; `apps/web/src/parent/DeckEditor.tsx` and `DeckCoverSettings.tsx` implement temporary preview, acceptance, rejection, and cleanup; `packages/server/src/modules/deck-cover.ts` builds the prompt and validates provider output; `packages/server/src/providers/generation-env.ts`, `config.ts`, `fake.ts`, and `index.ts` wire real/fake image providers; integration, component, unit, and E2E specs cover the flow; `docs/SPEC.md` and `docs/architecture.md` document it.
- Review triage: 7 patch entries (2 medium, 5 low), 0 deferred, and 2 rejected (no cost throttle; integration-only acceptance gap already covered by E2E). `followup_review_recommended: true` because two medium patch entries were addressed; a real provider request remains unverified here.
- Verification: 7 focused unit/component tests, 3 PostgreSQL integration tests, all workspace typechecks, and 2 Playwright E2E tests passed. `git diff --check` passed.
- Residual risk: E2E used the deterministic fake provider; real provider latency, response variability, and billing were not exercised.
