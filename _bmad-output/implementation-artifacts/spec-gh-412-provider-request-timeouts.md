---
title: 'gh-412: timeouty żądań w adapterach LLM (zestaw), TTS i obrazów'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_revision: '39204eab9fa4d79ae1a1cfb95eb547216b2e3b2e'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/agents/providers-privacy.md'
warnings: []
deferred:
  - summary: >-
      Timeout podczas czytania ciała odpowiedzi nie ma testu, a w ścieżce zestawu kończy się kodem `output` zamiast `timeout`.
    evidence: |-
      lesson-json-request.ts łapie błąd response.json() jako output (zachowanie sprzed zmiany, wspólne z lekcjami); worker ponawia oba kody, różni się tylko zapisany kod.
    location: >-
      packages/server/src/providers/openai/lesson-json-request.ts:119
    severity: low
  - summary: >-
      Okładka zestawu w web po 180 s zwraca rodzicowi ogólny błąd 500, bez polskiego komunikatu o przekroczeniu czasu.
    evidence: |-
      deck-cover.ts:94 nie mapuje błędów providera na AppError; tak samo było z provider_http_* przed zmianą, wcześniej żądanie mogło wisieć bez końca.
    location: >-
      packages/server/src/modules/materials/deck-cover.ts:94
    severity: low
---

<intent-contract>

## Intent

**Problem:** Żądania HTTP generowania zestawu (`generateDeck`), TTS i ilustracji nie mają limitu czasu; zawieszony provider blokuje slot workera dłużej niż lease mediów (5 min).

**Approach:** Każde z trzech żądań dostaje `AbortSignal.timeout(ms)` złączony z sygnałem wywołującego (`AbortSignal.any`); limit z `config-defaults.ts` przez `generation-env.ts`. Upływ limitu → `GenerationProviderError("timeout")` (worker ponawia: zestaw i media kolejkują każdy błąd poza `validation`/`media_storage`).

## Boundaries & Constraints

**Always:** `usage.record` raz na żądanie HTTP (transport failure przy timeoucie); komunikat błędu to sam kod (`provider_timeout`), bez treści; przerwanie sygnałem wywołującego (zamknięcie workera) zostaje zwykłym AbortError; limity poniżej lease 5 min.

**Never:** nowy płatny adapter, zmiana inwentarza `PAID_ADAPTERS`, zmiana ścieżki lekcji, zmiana API/MCP/skill, zmiana klasyfikacji ponowień w module `materials`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Zawieszony fetch | fetch nie odpowiada dłużej niż limit | odrzucenie po limicie | `GenerationProviderError` kind `timeout`, jeden zapis kosztu `transport` |
| Sygnał wywołującego | caller abortuje przed limitem | odrzucenie AbortError | bez mapowania na timeout |
| Szybka odpowiedź | odpowiedź przed limitem | wynik jak dotąd | brak |

</intent-contract>

## Code Map

- `packages/server/src/providers/openai/lesson-json-request.ts:104` -- wzorzec: `AbortSignal.timeout` + `AbortSignal.any`, mapowanie `TimeoutError` → `timeout`.
- `packages/server/src/providers/openai/llm.ts:405-421` -- `deckJson` bez `timeoutMs`; dodać opcję `deckRequestTimeoutMs`.
- `packages/server/src/providers/openai/tts.ts:67-90`, `images/openai.ts:36-58` -- surowy `fetch(..., { signal })`; catch woła `recordTransportFailure`.
- `packages/server/src/providers/generation-env.ts:120,176-186` -- składanie adapterów z env.
- `packages/server/src/config-defaults.ts:61` -- sekcja limitów generacji.
- `packages/server/src/modules/materials/generation.ts:528-539`, `media-generation.ts:265-298` -- ponawiają błędy providera (read-only).

## Tasks & Acceptance

**Execution:**
- `providers/openai/llm.test.ts`, `tts.test.ts`, `images/openai.test.ts` -- testy zawieszonego fetch z fake timerami; RED: uruchom je PRZED zmianą kodu adapterów i w raporcie zacytuj wynik padający, dopiero potem GREEN. Test zestawu „nie ma timeoutu adaptera” (llm.test.ts ~616) zastąp testem limitu.
- `providers/openai/llm.ts` -- `deckRequestTimeoutMs` (domyślnie 120 s) w `deckJson.timeoutMs`.
- `providers/openai/tts.ts`, `providers/images/openai.ts` -- `requestTimeoutMs` (60 s / 180 s), sygnał złączony, `TimeoutError` → `GenerationProviderError("timeout")`.
- `config-defaults.ts`, `generation-env.ts`, `.env.example`, `docs/provider-config.md` -- nowe `UMIEM_DECK_GENERATION_REQUEST_TIMEOUT_MS`, `UMIEM_TTS_REQUEST_TIMEOUT_MS`, `UMIEM_IMAGE_REQUEST_TIMEOUT_MS`.

**Acceptance Criteria:**
- Given zawieszony fetch, when upłynie limit adaptera, then każde z trzech wywołań kończy się `kind: "timeout"` i jednym zapisem kosztu.
- Given `pnpm check`, then przechodzi; inwentarz `usage-recording.architecture.test.ts` bez zmian.

## Spec Change Log

## Review Triage Log

### 2026-11-26 — Review pass
- verdicts: 24 findings — high 0, medium 1, low 13, false 6, maybe-false 4
- findings:
  - `[low]` `[patch]` (blind/edge/gap/intent) dokumentacja i matryca twierdzą, że przerwanie wywołującego zostaje AbortError także dla zestawu — poprawiono akapit w docs/provider-config.md (zestaw: wspólna koperta mapuje każde przerwanie na timeout, worker rozpoznaje zamknięcie po signal.aborted).
  - `[medium]` `[patch]` (gap/blind) brak testu, że wartość z env dociera do adaptera — dodano test tabelaryczny w generation-env.test.ts (zestaw, TTS, obraz, imageProviderFromEnv); mutacja usuwająca spread TTS daje RED.
  - `[low]` `[defer]` (gap/blind/edge) timeout przy czytaniu ciała bez testu; w zestawie kod output — zachowanie wspólnej koperty sprzed zmiany, worker ponawia.
  - `[low]` `[defer]` (edge/blind) okładka w web: ogólny 500 po 180 s — sprzed zmiany dla błędów providera; wcześniej wisiało bez limitu.
  - `[low]` `[reject]` (edge/blind) zła wartość UMIEM_IMAGE_REQUEST_TIMEOUT_MS zatrzymuje start web — świadomy fail-fast przy jawnie błędnej konfiguracji; komentarz composition.ts dotyczy agenta lekcji.
  - `[low]` `[reject]` (edge) `1e5`/`0x1F4` przechodzą Number() — ten sam wzorzec co positiveIntEnv w config.ts, wartość nadal jest dodatnią liczbą całkowitą.
  - `[low]` `[reject]` (edge/blind) przy fake/bez klucza walidacja pomijana — adaptery nie powstają, wartość nie jest używana.
  - `[low]` `[reject]` (blind) literał 300000 zamiast MEDIA_LEASE_MS — import z modules/materials do providers złamałby kierunek zależności; dla 2 miejsc nie warto.
  - `[low]` `[reject]` (blind) brak marginesu przy 299999 — domyślne wartości mają duży margines; granica to bezpiecznik przed oczywistym błędem.
  - `[low]` `[reject]` (blind) domyślne wartości w trzech miejscach — istniejący wzorzec (lessonRequestTimeoutMs ?? 90_000).
  - `[false]` `[reject]` (blind) spec niedokończony — log i wynik uzupełniane w tym kroku.
  - `[low]` `[reject]` (blind) komentarz .env.example niepełny — pełny opis w docs/provider-config.md.
  - `[maybe-false]` `[reject]` (intent) ponowienie przez worker niesprawdzone testem modułu — generation.ts:482 i media-generation.ts:283-297 kolejkują każdy błąd poza validation/media_storage; brak zmiany w tych modułach.
  - pozostałe wiersze: powtórzenia powyższych z różnych warstw (deck caller-abort brak testu, rozbieżny kod output, web bez retry, RED niewidoczny w diffie — RED pokazany w raporcie implementacji: 4 testy padły przed zmianą).

## Verification

**Commands:**
- `corepack pnpm vitest run packages/server/src/providers` -- expected: zielone
- `corepack pnpm check` -- expected: zielone

## Auto Run Result

Status: done

- Zmiana: limit jednego żądania HTTP dla zestawu słówek (120 s), TTS (60 s) i obrazów (180 s) przez `AbortSignal.timeout` złączony z sygnałem wywołującego; upływ → `GenerationProviderError("timeout")` (`provider_timeout`), jeden zapis kosztu `failed`.
- Pliki: `openai/llm.ts`, `openai/tts.ts`, `images/openai.ts` (limity), `ports/generation-error.ts` (`timeoutAsProviderError`), `generation-env.ts` (env + walidacja < 300000), `config-defaults.ts`, `.env.example`, `docs/provider-config.md`, testy adapterów i `generation-env.test.ts`.
- Review: 2 poprawki (docs, test przekazania env), 2 odłożone, reszta odrzucona z powodem w logu.
- Weryfikacja: RED — 4 nowe testy padły przed zmianą; GREEN — vitest providers zielony; `pnpm check` PASS (pierwszy przebieg build zatrzymał jednorazowy komunikat Next.js SecurityFatalError, ponowienie PASS).
- Ryzyka: brak próby z prawdziwym providerem; Next.js 16.4.3 zgłasza znaną podatność (decyzja właściciela).
- followup_review_recommended: false (patched: medium 1, low 1).
