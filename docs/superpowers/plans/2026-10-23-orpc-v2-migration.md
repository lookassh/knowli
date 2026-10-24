# Migracja pełnej warstwy API Knowli na oRPC v2 — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cel:** Cała powierzchnia HTTP API `apps/web` (kid, parent, integracje) serwowana przez `OpenAPIHandler` oRPC v2 z kontraktami contract-first, z **niezmienionym formatem transmisji** (ścieżki, metody, statusy, nagłówki, koperta błędów), a klienci (panel rodzica, kid-ui) korzystają z typowanych klientów oRPC zamiast ręcznych wrapperów fetch.

**Architektura:** Strategia strangler — catch-all `route.ts` najpierw próbuje handlera oRPC, a przy braku dopasowania wraca do starego routera; grupy endpointów migrowane po kolei z e2e po każdej; ostatni krok dekomisjonuje ręczne routery. Kontrakt kid w `@learning/contracts` (dzielimy go z kid-ui bez kodu serwerowego), kontrakt parent w `apps/web` (klient wyłącznie wewnętrzny). Błędy `AppError` są konwertowane do `ORPCError` middlewarem, a **`customErrorResponseBodyEncoder` na `OpenAPIHandler` jest jedynym autorytatywnym źródłem koperty** `{code, message, retryable, requestId, details?}` na wire (dokładny port serializacji z `withApi` — Task 2); wrapper `route.ts` robi wyłącznie fallthrough do legacy, bez przepisywania błędów.

**Stack:** oRPC `2.0.0-beta.45` (`@orpc/server`, `@orpc/contract`, `@orpc/client`, `@orpc/openapi`), Zod 4.6.5 (Standard Schema), Next.js 15.5 App Router, Vitest, Playwright.

**Spec:** `docs/research/2026-10-23-orpc-evaluation.md` (ocena i mapa API w tym worktree) + `docs/architecture.md` §12–13 + `AGENTS.md` (sekcje o MCP, danych i stylu).

## Global Constraints

- Wersje oRPC przypięte **dokładnie**: `@orpc/*@2.0.0-beta.45` (bez `^`/`~`) we wszystkich pakietach; podbicie wersji beta = osobny, świadomy commit.
- **Zakaz pakietów React-zależnych oRPC** (`@orpc/next`, `@orpc/tanstack-query`, `@orpc/swr`): Next 15.5 vendoryje Reacta 19.1 (wniosek z PoC Mantine) — używamy wyłącznie klienta fetch i linków.
- **Format transmisji niezmienny**: każda ścieżka, metoda, kod statusu (201/202/204), nagłówek (`Cache-Control: no-store`, `Set-Cookie`, `Content-Type` binariów) i kształt błędu `{code, message, retryable, requestId, details?}` (`ApiErrorSchema`) muszą być identyczne jak dziś — e2e i testy integracyjne są bramką.
- Bez zmian w: `/api/mcp` (ręczny serwer MCP — kontrakt Hermesa), `/api/v1/media/:id` i `/api/v1/health` (zostają zwykłymi route handlers; media to endpoint zasobu używany przez `<audio>`/`<img>` bez klienta typowanego).
- Reguła AGENTS.md: zmiany API → analiza wpływu na MCP i `SKILL.md`. Tu: ścieżki i DTO bez zmian → `SKILL.md` bez zmian; uzasadnienie musi trafić do opisu PR.
- Middleware autoryzacyjne zachowuje semantykę: kid = `assertSameOrigin` na mutacjach bez sesji; parent = `requireParentSession` + `assertSameOrigin` na mutacjach; integracje = Bearer + rate limit.
- Limity rozmiaru ciała zachowane: audio multipart (`MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES`), raport aktywności (`SESSION_ACTIVITY_REPORT_MAX_BYTES`, z górnym odrzuceniem po `content-length` przed buforowaniem), cover 5 MB (streaming z anulowaniem czytnika).
- Testy: jednostkowe na fake-services (Vitest), pełne e2e po kamieniach milowych; komendy przez `corepack pnpm …` (pełna ścieżka do pnpm przy awarii corepack — znany quirk maszyny).
- Commity konwencjonalne po polsku (`feat(web): …`), push/PR/scalanie wyłącznie przez właściciela.

## Review Focus

1. **Nadmiarowy payload (audio/raport/cover) buforowany w całości zanim limit odrzuci** — test: żądanie z `content-length` ponad limit oraz strumień bez nagłówka ponad limit → `validation` bez wyczerpania pamięci (Task 7, 10).
2. **Koperta błędu zmienia kształt po migracji** — test jednostkowy: każdy kod `AppError` (`validation`, `not_found`, `conflict`, `unauthorized`, `immutable`, `internal`) serializowany przez `customErrorResponseBodyEncoder` OpenAPIHandler do bajtowo identycznego JSON jak `withApi` (Task 2).
3. **Mutacja bez Origin przechodzi** (CSRF) — test negatywny: POST bez nagłówka `Origin`/`Sec-Fetch-Site` na ścieżce kid i parent → odrzucony (Task 5, 10).
4. **Gubi się `Cache-Control: no-store`** na odczytach danych dziecka/rodzica — test asercji nagłówka odpowiedzi (Task 5, 10).
5. **Statusy 202/204 spłaszczają się do 200** (`next` bez zadania, `events`, `attempts` w stanie `processing`) — testy asercji kodu odpowiedzi (Task 6, 7).

---

### Task 1: Spike — weryfikacja założeń oRPC v2, które plan przyjmuje

**Files:**
- Modify: `docs/research/2026-10-23-orpc-evaluation.md` (dopisek „Spike v2 — wyniki")
- Scratch (niecommitowany katalog roboczy `spike-scratch/`, usunięty po zadaniu)

**Interfaces:**
- Consumes: obecny `package.json` workspace.
- Produces: potwierdzone/skorygowane nazwy opcji użyte w dalszych zadaniach; lista „co zadziałało inaczej niż w docs".

Kroki:

- [ ] **Step 1: Zainstaluj zależności w scratch i zweryfikuj 7 zagadnień**

`corepack pnpm add -E @orpc/server@2.0.0-beta.45 @orpc/contract@2.0.0-beta.45 @orpc/client@2.0.0-beta.45 @orpc/openapi@2.0.0-beta.45` w apps/web (tymczasowo). W pliku scratch (np. `apps/web/src/orpc/spike.test.ts`, usuniętym przed commit) sprawdź minimalnymi testami Vitest:
1. `OpenAPIHandler` + `openapi({method, path, prefix, successStatus})` — GET z prostymi (prymitywnymi) query params `?childId=…` bez bracket notation;
2. `outputStructure: 'detailed'` — zwrócenie `{status: 204, body: undefined}` oraz `{status: 202, headers, body}`; nagłówek `cache-control` małym drukiem;
3. `errorStatusMap` na handlerze + własna treść błędu: czy da się wymusić body `{code, message, retryable, requestId}` (opcja/nazwa wg zainstalowanej wersji); jeśli nie — potwierdź obejście: wrapper route.ts przepisuje body odpowiedzi błędu;
4. `RequestLimitHandlerPlugin` (nazwa wg v2) — odrzucenie ciała ponad limit przed pełnym buforowaniem;
5. `requestBodyHint: 'octet-stream'` + `input: z.instanceof(ReadableStream)` — odczyt strumienia z limitem bajtów i anulowaniem (wzór: cover 5 MB);
6. multipart `requestBodyHint: 'form-data'` z `z.instanceof(File)` w wejściu;
7. `OpenAPILink(contract, {origin, url, fetch})` z własnym `fetch` — wstrzyknięcie `AbortController` timeout; typ `JsonifiedClient<RouterContractClient<typeof contract>>`;
8. kompozycja `implement(contract)` z builderem bazowym (`$context` + middleware): jakie opcje przyjmuje `implement`, i czy można implementować oraz montować **poddrzewa** kontraktu osobno (wymóg stranglera — Taski 5–7 montują grupy endpointów, zanim cały kontrakt ma implementacje); jeśli nie — sprawdzić montaż kilku mniejszych kontraktów/ROUTERÓW pod wspólnym prefixem w jednym `OpenAPIHandler`.

- [ ] **Step 2: Uruchom testy spike i zapisz wyniki**

Run: `corepack pnpm vitest run apps/web/src/orpc/spike.test.ts`
Expected: PASS albo jawna lista niezgodności docs↔beta.45.

- [ ] **Step 3: Zaktualizuj notatkę research i skoryguj ten plan**

Dopisz sekcję „Spike v2 — wyniki" (co potwierdzone, jakie dokładnie nazwy opcji). Jeśli któraś opcja działa inaczej — popraw odpowiednie kroki w tym pliku (Task 5–11) przed implementacją. Usuń pliki scratch i odinstaluj zależności tymczasowe, jeśli Task 2 ma je dodać na nowo w czystej formie.

- [ ] **Step 4: Commit**

```bash
git add docs/research/2026-10-23-orpc-evaluation.md docs/superpowers/plans/2026-10-23-orpc-v2-migration.md
git commit -m "docs(orpc): wyniki spike'u v2 i korekty planu migracji"
```

### Task 2: Fundament oRPC — zależności, builder bazowy, middleware, konwersja błędów

**Files:**
- Modify: `apps/web/package.json`, `packages/contracts/package.json` (deps), `pnpm-lock.yaml`
- Create: `apps/web/src/orpc/base.ts`, `apps/web/src/http/orpc-fallback.ts`
- Test: `apps/web/src/orpc/base.test.ts`, `apps/web/src/http/orpc-fallback.test.ts`

**Interfaces:**
- Consumes: `Services` z `@learning/server`; `requireParentSession`, `assertSameOrigin` z `@/http/security`; `AppError`, mapowanie kod→status **oraz serializacja koperty** z `@/http/errors` (`withApi`) — źródło portu do `errorStatusMap` + `customErrorResponseBodyEncoder`.
- Produces:
  - `export const baseOs = os.$context<{ services: Services; headers: Headers }>()` — każdy builder procedur pochodzi od `baseOs`; **kontrakt-first nie przechodzi przez baseOs**: `implement(contract).$context<Ctx>().use(...)` (spike A: `implement()` nie przyjmuje buildera, a middlewares z `.use()` na implementerze są doklejane przed handlerami procedur); `baseOs` zostaje źródłem współdzielonych middleware i procedur code-first;
  - `appErrorMiddleware` — konwertuje wyrzucony `AppError` na `ORPCError` o kodzie `AppError.code.toUpperCase()` z `message`/`details`, `cause` zachowane;
  - `appErrorEncoder` (`customErrorResponseBodyEncoder` w opcjach `OpenAPIHandler`) — **jedyne autorytatywne źródło koperty** `{code, message, retryable, requestId, details?}` na wire: dokładny port serializacji z `apps/web/src/http/errors.ts` (`withApi`), w tym sourcing `retryable` i `requestId`; statusy przez `errorStatusMap` odwzorowujący obecne mapowanie (spike 3: mechanizm zweryfikowany);
  - `parentSessionMiddleware` — wywołuje `requireParentSession(request, services)`, dodaje `context.parent`;
  - `sameOriginMiddleware` — odczytuje Origin/`Sec-Fetch-Site` z `context.headers`, rzuca `AppError("forbidden")` gdy zgodnie z obecną logiką `assertSameOrigin`;
  - `withORpcFallback(handler: OpenAPIHandler, prefix: string, legacy: (request, services, segments) => Promise<Response>)` w `orpc-fallback.ts`: woła `handler.handle(request, {prefix, context: {services, headers: request.headers}})`; `matched === false` → `legacy` (brak dopasowania po stronie legacy → `not_found`, jak dziś); **bez ścieżki re-throw błędów** — odpowiedzi błędowe oRPC przechodzą 1:1, bo kopertę generuje encoder; **guard deduplikacji middleware v2** (flaga kontekstowa `authLoaded` — migracja v1→v2 usuwa deduplikację).

- [ ] **Step 1: Napisz testy failujące**

`base.test.ts`: (a) `AppError("not_found")` wyrzucony w handlerze → przechwycony przez middleware jako `ORPCError` z kodem `NOT_FOUND` i `cause`; (b) middleware sesji rodzica bez ciasteczka → `AppError("unauthorized")`; (c) POST z `sec-fetch-site: cross-site` → `AppError` odmowy. `orpc-fallback.test.ts`: (d) handler niepasującej ścieżki → wywołuje legacy; (e) procedura rzuca `AppError` → odpowiedź błędowa oRPC (koperta z encodera, przepuszczona przez wrapper 1:1) ma body `{code, message, retryable, requestId}` zgodne z `ApiErrorSchema.parse`.

- [ ] **Step 2: Uruchom testy — oczekiwane FAIL** (`corepack pnpm vitest run apps/web/src/orpc apps/web/src/http/orpc-fallback.test.ts`)

- [ ] **Step 3: Zaimplementuj**

Deps: `apps/web` — `@orpc/server`, `@orpc/client`, `@orpc/openapi` (client potrzebny od razu dla testów fallback z OpenAPILink); `packages/contracts` — `@orpc/contract`; wszystkie `-E @2.0.0-beta.45`. Implementacja wg bloku Interfaces; statusy błędów przez `errorStatusMap` odwzorowujący obecne mapowanie z `withApi`, a kształt koperty przez `appErrorEncoder` — dokładny port serializacji z `apps/web/src/http/errors.ts` (w tym `retryable`, `requestId`, `details?`).

- [ ] **Step 4: Testy zielone**, **Step 5: Commit** `feat(web): fundament oRPC v2 — builder, middleware, fallback, koperta błędów z encodera`

### Task 3: Montowanie fallthrough w catch-all (zero endpointów oRPC)

**Files:**
- Modify: `apps/web/src/app/api/v1/kid/[...path]/route.ts`, `apps/web/src/app/api/v1/parent/[...path]/route.ts`
- Test: istniejące e2e (brak nowych plików)

**Interfaces:**
- Consumes: `withORpcFallback` z Task 2.
- Produces: puste routery `emptyKidORpcRouter`/`emptyParentORpcRouter` w `apps/web/src/orpc/` (procedury dopisują kolejne zadania) zamontowane z priorytetem nad legacy.

- [ ] **Step 1:** Zamontuj `withORpcFallback` w obu catch-all (handler oRPC z pustym routerem → zawsze fallthrough do legacy). **Step 2:** Sanity: `corepack pnpm test:e2e` (filtr kid + parent) — pełny zielony (żadna ścieżka nie mogła się zmienić). **Step 3:** Commit `feat(web): montaż oRPC z fallthrough w catch-all (bez endpointów)`.

### Task 4: Kontrakt kid API w @learning/contracts

**Files:**
- Create: `packages/contracts/src/kid-api-contract.ts`
- Modify: `packages/contracts/src/index.ts` (re-eksport)
- Test: `packages/contracts/src/kid-api-contract.test.ts`

**Interfaces:**
- Consumes: istniejące schematy (`TaskDtoSchema`, `AttemptDtoSchema`, `SessionActivityResultDtoSchema`, `SessionEndInputSchema`, `AttemptInputSchema`, `EventInputSchema`, `SessionInputSchema`, `UuidSchema`, `KidProfileDtoSchema`, `KidDeckDtoSchema`, `UiAudioDtoSchema`, `MockTestSummaryDtoSchema`… — wg `kid-router.ts`).
- Produces: `export const kidApiContract` — obiekt routerowy (zagnieżdżenie odzwierciedla segmenty URL: `uiAudio`, `profiles`, `decks`, `sessions.{create, next, end, disableMicrophone, activityResult, mockTestSummary}`, `tasks.{events, disclosures, completePresentation, attempts}`, `attempts.{get, feedbackAudio}`), każda procedura `oc.input(...).output(...).meta(openapi({...}))`; oraz nowe schematy wejściowe: `KidDecksQuerySchema {childId: UuidSchema, microphoneEnabled?: z.stringbool()}` (spike: query przychodzi jako string — `z.boolean()` odrzuciłby `microphoneEnabled=true`), `DisclosureKindSchema = z.enum(["hint","audio"])`, `CompletePresentationInputSchema {clientCommandId?: UuidSchema}`, `FeedbackAudioPathSchema` (albo inline w meta path `{id}`).

Meta openapi per procedura (statusy i nagłówki **dokładnie jak dziś**): GET `ui-audio`/`profiles`/`decks`/`sessions/{id}/activity-result`/`sessions/{id}/mock-test-summary`/`attempts/{id}`/`attempts/{id}/feedback-audio` → 200 (+`outputStructure: 'detailed'` z `cache-control: no-store` tam, gdzie router today ustawia); POST `sessions` → 200; `sessions/{id}/next` → detailed output `{status: 200|204, body: TaskDtoSchema.nullish()}` (rewizja po T4: czysty void odrzuciłby walidację outputu przy każdym wydanym zadaniu — router zwraca 200+TaskDto albo 204-puste); `sessions/{id}/end` → 200; `sessions/{id}/disable-microphone` → 200; `tasks/{id}/events` → 204/void; `tasks/{id}/disclosures` → 200; `tasks/{id}/complete-presentation` → 200; `tasks/{id}/attempts` → dynamiczny 200/202 przez detailed output; `attempts/{id}/feedback-audio` → 200 no-store.

- [ ] **Step 1: Testy failujące kontraktu** — dla każdej procedury: ścieżka+metoda w meta, parse przykładu wejścia/wyjścia przez schematy (w tym `KidDecksQuerySchema` odrzuca `microphoneEnabled=abc`). **Step 2:** FAIL. **Step 3:** Implementacja `kidApiContract` (+ nowe schematy — po angielsku, komunikaty wg `messages.ts`). **Step 4:** PASS + `corepack pnpm typecheck`. **Step 5:** Commit `feat(contracts): kontrakt kid API dla oRPC (oc + openapi meta)`.

### Task 5: Serwer kid — operacje odczytu (GET)

**Files:**
- Create: `apps/web/src/orpc/kid-router.ts` (implementacja `kidApiContract`; kolejne zadania dopisują tu procedury)
- Modify: `apps/web/src/app/api/v1/kid/[...path]/route.ts` (montaż routera z Task 3)
- Modify: `apps/web/src/kid/kid-router.ts` (usunięcie zmigrowanych gałęzi)
- Test: `apps/web/src/orpc/kid-router.test.ts`

**Interfaces:**
- Consumes: `kidApiContract`, use-cases `readUiAudio`, `listKidProfiles`, `listKidDecks`, `readSessionActivityResult`, `readMockTestSummary`, `readLessonMockTestSummary`, `mockTestKindOfSession`, `readAttempt`, `authorizeFeedbackAudio`.
- Produces: `kidRouter` (częściowy; kolejne zadania dopisują procedury), budowany jako `implement(kidApiContract).$context<Ctx>().use(appErrorMiddleware).use(sameOriginMiddleware)` (spike A: `implement()` nie przyjmuje buildera bazowego; middlewares z `.use()` na implementerze działają jak base) — origin tylko dla mutacji, więc GET bez; montaż w catch-all kid z prefix `/api/v1/kid`: `OpenAPIHandler` dostaje **tylko zaimplementowane poddrzewa** scalone w jeden router (`{...grupaA, grupaB}` — dopasowanie po `meta.path`, klucze nieistotne; niezaimplementowane → `matched:false` → fallback legacy; spike B).

- [ ] **Step 1: Testy failujące** (fake `Services`): (a) `decks` z query → wywołuje `listKidDecks` z przeparsowanym `childId`/`microphoneEnabled`; (b) `activity-result` bez trwałego wyniku → domyślny DTO `{status: "already_started", pointsAwarded: 0, errorCode: null}` przepuszczony przez `SessionActivityResultDtoSchema`; (c) `mock-test-summary` dispatch lekcja/słówka wg `mockTestKindOfSession`; (d) nagłówek `cache-control: no-store` na `ui-audio`/`profiles`/`decks`/`activity-result`/`mock-test-summary`/`feedback-audio`; (e) 404 przez `errorStatusMap` dla nieistniejącego zasobu.
- [ ] **Step 2:** FAIL. **Step 3:** Implementuj procedury GET (bez logiki biznesowej — tylko wywołania use-case'ów i shaping detailed output). Usuń odpowiednie gałęzie z `kid-router.ts` (legacy). **Step 4:** `corepack pnpm vitest run apps/web/src/orpc` + e2e kid. **Step 5:** Commit `feat(web): kid GET na oRPC (ui-audio, profiles, decks, podsumowania, attempts)`.

### Task 6: Serwer kid — sesje (POST sessions, next, end, disable-microphone)

**Files:**
- Modify: `apps/web/src/orpc/kid-router.ts`, `apps/web/src/kid/kid-router.ts`
- Test: `apps/web/src/orpc/kid-router.test.ts` (rozszerzenie)

**Interfaces:**
- Consumes: `startSession`, `nextTask`, `endSession`, `disableSessionMicrophone`, `SESSION_ACTIVITY_REPORT_*` z `@learning/contracts`.
- Produces: procedury `sessions.*`; limity rozmiaru raportu aktywności: **pre-check `content-length` w middleware** (nagłówki w context) + capped reader — odrzucenie **przed** parsingiem (spike C: `RequestLimitHandlerPlugin` ma wyłącznie globalne `{maxBodySize}`, bez konfiguracji per-route — użyty tylko jako zabezpieczenie catch-all całego routera, z remapem `PAYLOAD_TOO_LARGE`→400 i kopertą `validation` przez `errorStatusMap` + `customErrorResponseBodyEncoder`); walidacja wersji raportu → `AppError("validation", {reason: "activity_report_update_required"})`.

- [ ] **Step 1: Testy failujące:** (a) `next` bez zadania → status 204, puste body; z zadaniem → 200 + `TaskDtoSchema`; (b) `end` z raportem w złej wersji → `validation` z `details.reason`; (c) `end` z ciałem ponad `SESSION_ACTIVITY_REPORT_MAX_BYTES` → `validation` **zanim** body zostanie sparsowane; (d) `end` bez ciała = koniec bez raportu; (e) mutacja z `origin` obcym → odrzucona (CSRF, Review Focus #3).
- [ ] **Step 2:** FAIL. **Step 3:** Implementacja; usunięcie gałęzi legacy; `readCappedJson` przeniesiony do `apps/web/src/orpc/request-limits.ts` (zachowany test jednostkowy limity→błąd). **Step 4:** Vitest + e2e kid. **Step 5:** Commit `feat(web): kid sesje na oRPC (start/next/end/disable-mic z limitami raportu)`.

### Task 7: Serwer kid — zadania (events, disclosures, complete-presentation, attempts)

**Files:**
- Modify: `apps/web/src/orpc/kid-router.ts`, `apps/web/src/orpc/request-limits.ts`, `apps/web/src/kid/kid-router.ts`
- Test: `apps/web/src/orpc/kid-router.test.ts` (rozszerzenie)

**Interfaces:**
- Consumes: `recordEvent`, `authorizeDisclosure`, `completePresentation`, `submitAttempt`, `submitSpeechAttempt`, `MAX_AUDIO_BYTES`, `MULTIPART_OVERHEAD_BYTES` (`readCappedFormData` — tylko jeśli zostaną ścieżki własnego odczytu surowego strumienia; multipart parsuje oRPC).
- Produces: procedury `tasks.*`; `attempts` przyjmuje JSON **lub** multipart (`requestBodyHint: 'form-data'`, pole `audio: z.instanceof(File)`, `clientAttemptId: UuidSchema`) — **multipart parsuje oRPC** (FormData → `File` w input), więc limit bajtów nagrań egzekwują: pre-check `content-length` w middleware (`MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES`) oraz globalny `RequestLimitHandlerPlugin` jako safety-net strumieni bez nagłówka (spike C: plugin bez konfiguracji per-route); `readCappedFormData` zostaje wyłącznie dla ścieżek, gdzie sami konsumujemy surowy strumień (wzorzec cover z Task 10); dynamiczny status `attempt.state === "processing" ? 202 : 200` przez detailed output; `request.signal` przekazywany do `submitSpeechAttempt` przez context (`signal: req.signal` w funkcji context `handle`).

- [ ] **Step 1: Testy failujące:** (a) `events` → 204 puste; (b) `disclosures` z `kind: "hint"` → 200, z `kind: "video"` → `validation`; (c) `complete-presentation` bez ciała i z `clientCommandId`; (d) `attempts` multipart z nagraniem > limit → `validation` bez pełnego buforowania (Review Focus #1); (e) `attempts` JSON i multipart → `processing` daje 202 (Review Focus #5); (f) multipart bez pola `audio`/`clientAttemptId` → `validation` z komunikatem jak dziś.
- [ ] **Step 2:** FAIL. **Step 3:** Implementacja + usunięcie gałęzi legacy. **Step 4:** Vitest + e2e kid (ścieżki mowy!). **Step 5:** Commit `feat(web): kid zadania na oRPC (events/disclosures/presentation/attempts z multipart)`.

### Task 8: Dekomisja legacy kid-router

**Files:**
- Delete: `apps/web/src/kid/kid-router.ts`, `apps/web/src/kid/kid-router.test.ts` (testy przeniesione/wchłonięte)
- Modify: `apps/web/src/app/api/v1/kid/[...path]/route.ts` (bez fallbacku)
- Test: e2e

- [ ] **Step 1:** Usuń fallback z catch-all kid; brak dopasowania → `not_found` jak dziś. **Step 2:** `corepack pnpm test:e2e` pełny zestaw kid + regresja kiosk (viewport, iframe) + dwie przeglądarki wg AGENTS.md. **Step 3:** `corepack pnpm typecheck && corepack pnpm build`. **Step 4:** Commit `refactor(web): pełne przejęcie kid API przez oRPC, usunięcie ręcznego routera`.

### Task 9: Klient kid-ui na OpenAPILink

**Files:**
- Modify: `packages/kid-ui/package.json` (deps: `@orpc/client`, `@orpc/openapi`, `@orpc/contract` — runtime import kontraktu z `@learning/contracts`), `packages/kid-ui/src/api/client.ts`
- Test: `packages/kid-ui/src/api/client.test.ts` (rozszerzenie istniejącego)

**Interfaces:**
- Consumes: `kidApiContract` z `@learning/contracts`; istniejący kontrakt modułu: sygnatura `createKidApiClient({baseUrl?, fetchImpl?})` BEZ zmian, typ `KidApi` bez zmian (port dla przyszłego hosta Capacitor).
- Produces: implementacja na `OpenAPILink(kidApiContract, {origin: baseUrl || undefined, url: '/api/v1/kid', fetch: fetchImpl})` (import z `@orpc/openapi/fetch`) z timeoutami 30 s / 45 s (`/end`) przez `AbortController` we wstrzykniętym fetch; błędy: **`customErrorResponseBodyDecoder`** na linku mapuje kopertę `{code, …}` na `ORPCError` (spike 7: bez dekodera klient dostaje `MalformedResponseError`), dalej normalizacja do istniejącego `KidApiError` (kod z koperty); `submitSpeech` buduje FormData jak dziś; `mediaUrl` bez zmian.

- [ ] **Step 1: Testy failujące** na istniejącym pliku: fake `fetchImpl` — (a) GET decks → URL `${base}/api/v1/kid/decks?childId=…`; (b) timeout 45 s na `end`; (c) odpowiedź błędu → `KidApiError.code === "validation"`; (d) **kluczowy test architektoniczny**: import modułu nie ciągnie Next.js (istniejący test granicy pakietu rozszerzony o brak `@orpc/server`). **Step 2:** FAIL. **Step 3:** Implementacja (moduł nadal bez runtime-zoda — kontrakt z contracts już go ma). **Step 4:** `corepack pnpm vitest run packages/kid-ui` + e2e kid. **Step 5:** Commit `feat(kid-ui): klient API na oRPC OpenAPILink (baseUrl/fetchImpl/timeout zachowane)`.

### Task 10: Parent cz. 1 — kontrakt+procedury: children, decks, drafts; przełączenie ekranów

**Files:**
- Create: `apps/web/src/parent/orpc-contract.ts`, `apps/web/src/orpc/parent-router.ts`
- Modify: `apps/web/src/parent/api.ts` (nowy klient), ekrany: `ChildrenPanel`/odpowiedniki, `DecksPanel.tsx`, `DeckEditor`/drafts (wg stanu faktycznego — wylistuj call sites: `grep -rn apiFetch apps/web/src/parent`)
- Delete (na końcu zadania): `apps/web/src/app/api/v1/parent/children/route.ts`, `children/[id]/route.ts`, `children/[id]/pronunciation/route.ts`
- Test: `apps/web/src/orpc/parent-router.test.ts`

**Interfaces:**
- Consumes: use-case'y children/decks/drafts z `parent-router.ts` (liste z Task oceny), schematy `@learning/contracts`, `parentSessionMiddleware`, `sameOriginMiddleware`.
- Produces: `parentApiContract` (cz. 1: `children.*`, `decks.*` w tym `generate` 202, `create` 201/200 dynamicznie, `cover` PUT obrazu przez `octet-stream`+`ReadableStream` z limitem 5 MB i anulowaniem — **`inputStructure: 'detailed'` obowiązkowo**, spike 5: `compact` z path params gubi strumieniowe body — i `request.signal` w context do anulowania, `cover/generate` binarna odpowiedź, `archive` 204, `draft` 201; `drafts.*` w tym `publish`, `assets/regenerate` 202, `assets/omit` 204); `parentClient: JsonifiedClient<RouterContractClient<typeof parentApiContract>> = createORPCClient(new OpenAPILink(...))` (import z `@orpc/openapi/fetch`, `customErrorResponseBodyDecoder` jak w Task 9) z `ApiCallError` zachowanym.

- [ ] **Step 1: Testy failujące** procedur: sesja rodzica wymagana na każdej (Review Focus #3), PATCH/POST/DELETE z obcym Origin odrzucone; `generate` → 202 `{generationRunId, deckId}`; cover 5 MB streaming: strumień ponad limit → anulowany reader, `validation` z polskim komunikatem (Review Focus #1); `cover/generate` → `Content-Type` obraza; `assets/omit` → 204. **Step 2:** FAIL. **Step 3:** Implementacja procedur + montaż w catch-all parent z fallthrough; usunięcie zmigrowanych gałęzi z `parent-router.ts`; przełączenie call sites wymienionych ekranów z `apiFetch` na `parentClient` (typy z kontraktu, bez `as`). **Step 4:** Vitest + e2e parent (dzieci, zestawy, edytor). **Step 5:** Commit `feat(web): parent children/decks/drafts na oRPC + typowany klient w ekranach`.

### Task 11: Parent cz. 2 — lekcje, werdykty, generation, assignments, progress, mock-tests, work-card

**Files:**
- Modify: `apps/web/src/parent/orpc-contract.ts`, `apps/web/src/orpc/parent-router.ts`, `apps/web/src/parent-router.ts` (reszta gałęzi), pozostałe ekrany (lista z `grep apiFetch`)
- Test: `apps/web/src/orpc/parent-router.test.ts` (rozszerzenie)

**Interfaces:**
- Consumes: pozostałe use-cases (lekcje: `createLesson` 202, `lesson-draft` 201, `regenerate` 202 z inline schematem przeniesionym do kontraktu jako `LessonRegenerateCommandSchema`; werdykty; `generation.retry`; `assignments` PUT/DELETE 204; `progress` GET z query childId+deckId; `mock-tests` dispatch lekcja/słówka; `work-card` z opcjonalnym `date`).
- Produces: komplet `parentApiContract`; puste `apiFetch` w repo.

- [ ] **Step 1: Testy failujące** wg wzorca Task 10 (statusy 202/201/204 — Review Focus #5; no-store na `mock-tests`/`work-card`/`lessons/progress`/`verdicts` — Review Focus #4; `progress` bez childId/deckId → `validation`). **Step 2:** FAIL. **Step 3:** Implementacja + przełączenie wszystkich pozostałych call sites. **Step 4:** Vitest + pełne e2e parent. **Step 5:** Commit `feat(web): parent lekcje/werdykty/generation/assignments/progress na oRPC`.

### Task 12: Auth bootstrap — login/logout/setup jako procedury

**Files:**
- Create: procedury w `apps/web/src/orpc/parent-router.ts` + wpisy kontraktu (`login` GET/POST, `logout` POST, `setup` POST)
- Delete: `apps/web/src/app/api/v1/parent/login/route.ts`, `logout/route.ts`, `setup/route.ts`
- Modify: `apps/web/src/parent/ParentApp.tsx` (auth na `parentClient`)
- Test: `apps/web/src/orpc/parent-router.test.ts` (rozszerzenie)

**Interfaces:**
- Consumes: `loginAndBuildCookie`, `requireParent`, logika setup z usuwanych plików.
- Produces: POST `login`/`logout` → `outputStructure: 'detailed'` z nagłówkiem `set-cookie` (HttpOnly, te same atrybuty co dziś); GET `login` → stan sesji; POST `setup` → tylko first-run; CSRF Origin na POST zachowany.

- [ ] **Step 1: Testy failujące:** (a) login poprawny → `set-cookie` z identycznymi atrybutami (test porównuje ciastko do wygenerowanego przez `loginAndBuildCookie`); (b) login na istniejącym PIN-ie przy skonfigurowanym setup → `conflict`; (c) logout czyści sesję; (d) setup po konfiguracji → odmowa. **Step 2:** FAIL. **Step 3:** Implementacja + przełączenie `ParentApp.tsx`; usunięcie plików route. **Step 4:** Vitest + e2e parent-flow (logowanie/wylogowanie/PIN). **Step 5:** Commit `feat(web): auth bootstrap rodzica na oRPC (set-cookie przez detailed output)`.

### Task 13: Dekomisja legacy parent-router i apiFetch

**Files:**
- Delete: `apps/web/src/parent/parent-router.ts`, `apps/web/src/parent/api.ts` (lub redukcja do modułu błędów `ApiCallError`)
- Modify: `apps/web/src/app/api/v1/parent/[...path]/route.ts` (bez fallbacku)
- Test: e2e

- [ ] **Step 1:** Usuń fallback; brak dopasowania → `not_found`. **Step 2:** `corepack pnpm typecheck && corepack pnpm build && corepack pnpm test:e2e` (pełny). **Step 3:** Commit `refactor(web): pełne przejęcie parent API przez oRPC, usunięcie ręcznego routera i apiFetch`.

### Task 14: Integracja learning-overview na procedurze

**Files:**
- Create: `apps/web/src/integrations/learning-overview-orpc.ts` (kontrakt+procedura)
- Modify: `apps/web/src/app/api/v1/integrations/learning-overview/route.ts` (montaż zamiast ręcznej obsługi)
- Test: `apps/web/src/integrations/learning-overview-orpc.test.ts`

**Interfaces:**
- Consumes: `getLearningOverview` (ten sam use-case co MCP — bez duplikacji), `LearningOverviewQuerySchema`/`LearningOverviewDtoSchema`, `requireLearningReadToken`, rate limiter.
- Produces: GET `/api/v1/integrations/learning-overview` na OpenAPIHandler z Bearer middleware i rate-limit; `schemaVersion` i eksport JSON Schema (`contracts:export-learning-overview`) bez zmian.

- [ ] **Step 1: Testy failujące:** (a) poprawny Bearer → DTO zgodne ze schematem; (b) brak/zelepy Bearer → `unauthorized`; (c) przekroczenie limitu → `rate_limited`/429 jak dziś; (d) metody inne niż GET → `not_found` (zachowanie obecne). **Step 2:** FAIL. **Step 3:** Implementacja; montaż. **Step 4:** Vitest + `corepack pnpm test:mcp` (jeśli dostępny) + test integracyjny endpointu. **Step 5:** Commit `feat(web): learning-overview na oRPC (Bearer + rate limit, ścieżka bez zmian)`.

### Task 15: Dokumentacja, spec OpenAPI, pełna weryfikacja, PR

**Files:**
- Modify: `docs/architecture.md` (§12: nota „API serwowane przez OpenAPIHandler oRPC; kontrakty w @learning/contracts — kid i w apps/web — parent"), `AGENTS.md` (wiersz w granicach kodu o kontraktach oRPC — do uzgodnienia z właścicielem w review PR), opcjonalnie Create: `apps/web/src/app/api/openapi.json/route.ts` (generator spec z `OpenAPIGenerator`)
- Test: pełna regresja

- [ ] **Step 1:** Aktualizacja dokumentacji (architecture.md; wpływ na MCP/SKILL.md: **brak zmian kontraktu** — uzasadnienie do opisu PR: ścieżki, DTO, semantyka bez zmian; `SKILL.md` nietknięty). **Step 2:** Opcjonalnie endpoint `/api/openapi.json` + test zgodności ze schematami contracts. **Step 3:** Pełna weryfikacja: `corepack pnpm test:unit && corepack pnpm test:integration && corepack pnpm test:e2e && corepack pnpm typecheck && corepack pnpm build` (+ kiosk regression). **Step 4:** Commit `docs(orpc): architektura po migracji + spec OpenAPI` i PR (opis: wpływ API→MCP→skill, wykonane sprawdzenia, wdrożenia po stronie konsumentów: **żadne** — Hermes/kiosk bez zmian).

---

## Ryzyka i rollback

- **Beta**: pin dokładny; podbicie beta osobny commit + pełna regresja; jeśli v2 GA wyjdzie w trakcie — wymiana pinu to jedno zadanie (deprecated aliases v1 istnieją, ale my używamy czystego API v2).
- **Kolejność wdrażania**: żadna zmiana nie zmienia formatu transmisji, więc web i klienci wdrażają się razem bez koordynacji z konsumentami zewnętrznymi (Hermes, kiosk, e2e).
- **Rollback**: każdy task to samodzielny commit; rollback = revert commitu (fallback strangler pozwala też wrócić pojedynczą grupę endpointów).
- **Największe ryzyko jakości**: Task 7 (multipart audio) i Task 12 (Set-Cookie) — tam wymagane pełne e2e ścieżek mowy i logowania przed przejściem dalej.
