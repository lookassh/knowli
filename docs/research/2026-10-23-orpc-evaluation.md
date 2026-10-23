# Ocena biblioteki oRPC dla Knowli / Umiem!

Data: 2026-10-23 · gałąź: `spike/orpc-evaluation` (z main 863089b) · charakter: analiza, bez zmian w kodzie produkcyjnym.

## Werdykt w skrócie

**Tak, oRPC da się użyć w Knowli** — jest technicznie zgodny ze stackiem (Next 15.5 App Router, React 19.3, Zod 4.6, TS 5.9, handlery na czystym Web `Request`/`Response`). Warto jednak wprowadzać go **punktowo, nie globalnie**:

1. **Najlepszy pierwszy krok: panel rodzica** (`apps/web/src/parent/*`) — nowy, wewnętrzny endpoint RPC obok istniejącego REST-u. Zero ryzyka dla publicznego kontraktu `/api/v1/*`, MCP i e2e.
2. **API dziecka (`/api/v1/kid`)** — możliwe przez workflow contract-first, ale niska wartość netto: klient kid-ui jest już typowany i walidowany schematami. Ewentualnie później, wyłącznie z zachowaniem istniejących ścieżek/statusów (wariant OpenAPIHandler).
3. **MCP** — oRPC umie serwować transport MCP, ale przebudowa ręcznie napisanego serwera (walidator, manifest, skill Hermesa) to rewrite bez zysku dla użytkownika. **Nie polecam.**
4. **Server Functions (`@orpc/next`)** — istnieją wyłącznie w linii **v2 beta**; odradzam w produkcji przed GA.

## Zgodność techniczna (zweryfikowane fakty)

| Warunek | Stan projektu | oRPC | Ocena |
| --- | --- | --- | --- |
| Next.js | 15.5.27 (App Router) | montowanie = zwykły route handler na Fetch API; jedyna uwaga dot. Next 16/Turbopack dotyczy opcjonalnej optymalizacji SSR | ✅ |
| React | 19.3.0 | klient jest framework-agnostyczny | ✅ |
| Zod | 4.6.5 (wszystkie pakiety) | oRPC używa Standard Schema v1, Zod 4 implementuje je natywnie; dodatkowo `@orpc/zod` | ✅ |
| TypeScript | 5.9.3 strict | wymaga ES2022 — OK | ✅ |
| Node | 22 | brak ograniczeń engines w `@orpc/server` 1.16.1 | ✅ |
| Kształt handlerów | `apps/web` używa surowego Web `Request`/`Response` (bez `next/server`) | dokładnie to, czego oczekuje adapter fetch oRPC | ✅ (spójne „z konstrukcji") |

**Wersjonowanie:** stabilna linia to **1.16.1**; dokumentacja na orpc.dev opisuje **v2 (2.0.0-beta.45)**. Przykłady składni z bloga/docs mogą się różnić od v1 — pilnując stabilności, należy pracować na 1.x i spodziewać się drobnych różnic nazw opcji względem dokumentacji v2.

## Mapa terenu (stan obecny, z badania)

- **REST**: dwa ręcznie pisane dispatchery catch-all — `apps/web/src/kid/kid-router.ts` (~16 endpointów) i `apps/web/src/parent/parent-router.ts` (~30 operacji) — dopasowanie `method + segment`, walidacja Zod na granicy (schematy z `@learning/contracts`), osobne pliki `route.ts` dla login/logout/setup/children/media/health/learning-overview. To de facto **hand-made RPC** — dokładnie warstwa, którą oRPC formalizuje.
- **Panel rodzica**: 100% client-side fetch przez `apps/web/src/parent/api.ts` — `apiFetch<T>` z rzutowaniem `as T`, ręczne stringi URL, brak cache/invalidacji, brak React Query/SWR, zero Server Actions. **Najsłabsze ogniwo i najlepszy kandydat.**
- **kid-ui**: `packages/kid-ui/src/api/client.ts` — jawnie zdefiniowane `KidApi`, konfigurowalne `baseUrl`/`fetchImpl`, walidacja odpowiedzi schematami z `@learning/contracts` (`parseWith` przyjmuje strukturalny `safeParse`, żeby moduł nie ciągnął zoda w runtime). Ograniczenie architektoniczne (AGENTS.md): kid-ui nie importuje Next.js ani kodu serwerowego (przyszły host Capacitor).
- **Kontrakty**: `@learning/contracts` = czysty Zod v4 + typy, dzielony jako workspace source import; do tego eksport JSON Schema dla learning-overview i katalog komunikatów błędów.
- **MCP**: `/api/mcp` → `apps/web/src/integrations/learning-mcp-*`, narzędzie `umiem_get_learning_overview` korzysta z tego samego use-casu co REST (bez duplikacji logiki).
- **Trzy reżimy autoryzacji**: kid (bez sesji, CSRF po Origin), parent (HttpOnly cookie + Origin), integracje/MCP (Bearer). W oRPC mapują się na middleware.
- **Ważne wyjątki poza „czystym JSON-em"**: multipart audio z limitem bajtów (`tasks/:id/attempts`), surowe body obrazu (cover, 5 MB), 202 dla przetwarzania mowy, 204 dla no-content — to kod krytyczny bezpieczeństwowo (nagrania tylko w pamięci).

## Gdzie i jak — rekomendacja

### A. Panel rodzica — pilotaż (rekomendowane)

**Co:** dodatkowy, wewnętrzny endpoint RPC dla panelu rodzica; publiczny REST `/api/v1/parent` pozostaje bez zmian.

**Jak (szkic):**

1. Zależności w `apps/web`: `@orpc/server`, `@orpc/contract`, `@orpc/client` (wersja 1.x stabilna).
2. Kontrakt procedur z użyciem **istniejących** schematów z `@learning/contracts` (workflow contract-first: `oc({ input, output })`).
3. Implementacja procedur w `apps/web/src/rpc/parent.ts` nad istniejącymi use-case'ami; `services` z `getServerServices()` przez kontekst.
4. Middleware oRPC odtwarzające obecne zabezpieczenia: `requireParentSession` (cookie) dla wszystkiego, `assertSameOrigin` dla mutacji.
5. Montowanie: catch-all `app/api/rpc/parent/[[...rest]]/route.ts` z `RPCHandler` (wzorzec z dokumentacji — jeden handler na wszystkie metody; brak dopasowania → 404).
6. Klient w panelu: `createORPCClient<RouterClient<...>>` + `RPCLink({ url: '/api/rpc/parent' })`; stopniowa wymiana `apiFetch` (zacząć od jednego panelu, np. Decks).
7. Opcjonalnie później: `@orpc/tanstack-query` — cache/invalidacja, której panel dziś nie ma (nowa zależność — decyzja osobno).
8. Mapowanie błędów: interceptor zamieniający `AppError` → `ORPCError` z zachowaniem kodów z koperty `{code, message, retryable, requestId}`.

**Zysk:** typowane end-to-end wywołania (koniec z `as T`), deklaratywne middleware zamiast powtarzanych wywołań w każdej gałęzi routera, mniej boilerplate'u przy dodawaniu endpointów, fundament pod React Query.

**Ryzyko:** niskie — zmiana dotyczy wyłącznie konsumenta wewnętrznego. Zgodnie z AGENTS.md: brak wpływu na udostępnione endpointy → brak zmian MCP/`SKILL.md` (odnotować w PR).

### B. API dziecka — możliwe, ale później i ostrożnie

- Ograniczenie „kid-ui bez Next.js/serwera" da się spełnić: **contract-first** — kontrakt procedur zdefiniowany tam, skąd kid-ui importuje typy (np. `@learning/contracts`), implementacja w `apps/web`; kid-ui robi **import wyłącznie typu** `RouterClient<RouterContract>` (znika w runtime), a klient `RPCLink`/`OpenAPILink` przyjmuje zwykły URL — pasuje do modelu `baseUrl`/Capacitor.
- Problem: `/api/v1/kid` to publiczny, kontraktowo testowany interfejs (e2e, kiosk, statusy 202/204, multipart z limitami, idempotentność ekspozycji). Zamiana protokołu na RPC zepsułaby ten kontrakt; wariant bezpieczny to `OpenAPIHandler` **serwujący te same ścieżki i statusy** — ale to przebudowa najbardziej safety-critical fragmentu API (nagrania dziecka) przy niewielkim zysku, bo klient już jest typowany i waliduje odpowiedzi.
- Rekomendacja: dopiero po sukcesie A, osobna decyzja, małymi krokami, z pełnym pokryciem e2e.

### C. MCP — nie teraz

oRPC potrafi serwować transport MCP, ale istniejący serwer ma semantyczny walidator, manifest kontraktu i skilla u Hermesa; przebudowa = ryzyko integracji bez korzyści. Zostawić jak jest.

### D. Server Functions (`@orpc/next`) — nie teraz

Dostępne tylko w v2 beta. Wdrożenie beta w produkcji prywatnej aplikacji rodzinnej jest nieuzasadnionym ryzykiem. Gdy v2 dojdzie do GA — można rozważyć dla panelu rodzica zamiast RPCHandler (dostaje się wtedy hooki z optimistic updates i typesafe errors).

## Czego nie robić

- Nie zamieniać całego `/api/v1/*` na oRPC „hurtem" — publiczny kontrakt, MCP, e2e i kiosk są przypięte do obecnych ścieżek, statusów i koperty błędów.
- Nie przenosić uploadu audio/obrazów do procedur RPC przy okazji pilotażu — limity bajtów i przetwarzanie w pamięci zostają na sprawdzonych ścieżkach.
- Nie wprowadzać React Query i oRPC jednym PR-em — najpierw typowane wywołania, cache osobno.

## Ile linii realnie znika (analiza 2026-10-23, dodatek)

Zmierzone pliki, których dotyczy migracja (wc -l, main 863089b):

| Plik | Linii | Los przy migracji |
| --- | --- | --- |
| `apps/web/src/parent/parent-router.ts` | 300 | → procedury oRPC ~230–260 |
| `apps/web/src/kid/kid-router.ts` | 205 | → procedury ~160–185 |
| `packages/kid-ui/src/api/client.ts` | 212 | → klient oRPC + klej ~90–120 |
| `apps/web/src/parent/api.ts` | 44 | → setup klienta ~12–15 |
| `packages/kid-ui/src/api/KidApi.ts` | 64 | → `type KidApi = RouterClient<...>` (1 linia, przy contract-first) |
| catch-all `route.ts` (kid + parent) | 42 | → mount oRPC ~18–35 |
| testy routerów/klienta | 148 | ~neutralnie |
| `apps/web/src/http/errors.ts` | 91 | zostaje (koperta błędów, pozostały REST) |
| **Razem dotknięte** | **958** | |

Struktura routerów wyjaśnia, dlaczego redukcja jest umiarkowana: ~25–35% linii to czysty boilerplate dispatchu (`method + segment`, ręczne wyciąganie query params, ręczna walidacja `kind`), ale ~40% to logika, która zostaje niezależnie od biblioteki: `readCappedJson` z limitem bajtów (21 linii), multipart audio z limitem strumienia (~30), streaming cover 5 MB z anulowaniem readera (~34), rozgałęzienia lekcja/słówka, mapowania błędów. Jądrem obu routerów są wywołania use-case'ów — te przenoszą się 1:1 do handlerów procedur.

Bilans per scenariusz:

| Scenariusz | Usuwane | Dodawane | Netto |
| --- | --- | --- | --- |
| A. Pilotaż panelu rodzica (addytywnie, REST zostaje) | ~30 (api.ts) | ~270–310 (router+mount+klient+middleware) | **+240–280** |
| A2. Pilotaż + wycofanie REST-owego catch-all rodzica | ~354 | ~280 | **≈ −70** |
| B. Kid API przez RPC + contract-first | ~499 | ~310–380 (kontrakt ~90–120 + implementacja + klej) | **≈ −120…−190** |
| A2+B (pełna migracja) | ~853 | ~590–660 | **≈ −190…−260** |

Wniosek: maksymalnie **~200–260 linii netto (~20–25% warstwy API, ~2% apps/web)** i tylko przy pełnej migracji obu routerów; sam rekomendowany pilotaż chwilowo **zwiększa** liczbę linii. Prawdziwa oszczędność jest krańcowa: dziś nowy endpoint to ~8–12 linii w routerze (warunki + walidacja + shaping) plus typ w kliencie, z oRPC ~5–8 linii w jednym miejscu i typ po stronie klienta darmowy. Jeśli celem jest redukcja LOC, oRPC tego nie kupi — uzasadnieniem jest type safety (koniec `as T` przy 61 wywołaniach `apiFetch`) i wspólne middleware.

## Źródła

- [oRPC — strona główna i dokumentacja](https://orpc.dev) (uwaga: docs opisują v2 beta)
- [Next.js Adapter — montowanie w route handler](https://orpc.dev/docs/adapters/next)
- [Integracja Next.js — server functions/hooks](https://orpc.dev/docs/integrations/next) (v2 beta)
- npm: `@orpc/server` dist-tags — latest **1.16.1**, beta **2.0.0-beta.45**

Mapa warstwy API: analiza kodu repo (kid-router.ts, parent-router.ts, security.ts, errors.ts, composition.ts, packages/kid-ui/src/api/*, packages/contracts, integrations/*) — 2026-10-23.

## Spike v2 — wyniki (2026-10-23, `@orpc/*@2.0.0-beta.45`)

> **Nota uzgodniona (2026-10-23):** wcześniejsza rekomendacja „pracować na 1.x, odradzam beta w produkcji" (sekcje „Werdykt w skrócie" i „Wersjonowanie" powyżej) pochodzi z etapu oceny, przed decyzją o migracji. Decyzją właściciela pełna migracja API idzie na **v2 beta z dokładnym pinem `2.0.0-beta.45`** (`docs/superpowers/plans/2026-10-23-orpc-v2-migration.md`); ten spike weryfikuje założenia dokładnie tej wersji.

Empiryczna weryfikacja założeń planu migracji (`docs/superpowers/plans/2026-10-23-orpc-v2-migration.md`): scratch `apps/web/src/orpc/spike.test.ts` (usunięty po zadaniu), 32 testy Vitest zielone + `tsc --noEmit` (apps/web) zielony. Metoda: `OpenAPIHandler` sterowany wprost Web `Request`/`Response`; przy rozbieżnościach docs↔runtime arbiterem były typy w zainstalowanym pakiecie.

### Potwierdzone nazwy opcji i importów

- **Importy**: `OpenAPIHandler`, `OpenAPILink` — **z `@orpc/openapi/fetch`** (główny index ich nie eksportuje); `openapi`, `JsonifiedClient`, `COMMON_ERROR_STATUS_MAP` — z `@orpc/openapi`; `os`, `implement`, `ORPCError` — z `@orpc/server`; `RequestLimitHandlerPlugin` — z `@orpc/server/plugins`; `createORPCClient` — z `@orpc/client`; `oc`, `RouterContractClient` — z `@orpc/contract`. Zod 4.6.5 współpracuje przez Standard Schema (bez `@orpc/zod`).
- **Meta**: `openapi({ method, path, prefix, successStatus, inputStructure, outputStructure, requestBodyHint, responseBodyHint, queryStyles, paramsStyles, … })` — wszystkie opcje istnieją pod tymi nazwami; `prefix` dokleja się do `path` (potwierdzone `/extra` + `/ping`).
- **Query (GET, compact)**: domyślna dekodacja bracket-notation; proste `?childId=…` przechodzi bez bracketów, ale wartości zostają **stringami** (liście nie są JSON-parsowane) — boolean wymaga `z.stringbool()` (uwaga: jej `z.input` to `string` — klient wysyła `"true"`) albo `queryStyles: {pole: 'json'}`.
- **`outputStructure: 'detailed'`**: procedura zwraca `{status, headers, body}`; `{status: 204, body: undefined}` → 204 z pustym body; `{status: 202, headers, body}` → 202 z nagłówkami; nagłówek `cache-control` małymi literami działa. Runtime wymaga dokładnie kluczy `status`/`headers`/`body` (nadmiarowe → TypeError).
- **`inputStructure: 'detailed'`**: wejście procedury to `{params, query, headers, body}`.
- **Błędy**: `new ORPCError(code, {message, data, cause})`; `errorStatusMap` w opcjach handlera (kod→status; nieznane kody → 400); własna treść przez **`customErrorResponseBodyEncoder`** (domyślnie `e.toJSON()` = `{code, message, data, defined}`) — koperta `{code, message, retryable, requestId}` wymuszona testem. **Klient**: własna koperta bez dekodera → `MalformedResponseError`; z **`customErrorResponseBodyDecoder`** (opcja `OpenAPILink`) → pełne okrążenie (`ORPCError` z `code: NOT_FOUND` i `data {retryable, requestId}`). Walidacja inputu → `ORPCError("BAD_REQUEST", {data: {issues}})` → 400 (encoder mapuje na `validation`).
- **`RequestLimitHandlerPlugin`** (nazwa v2; stary `BodyLimitPlugin` jest nadal reeksportowany jako alias z `@orpc/server/fetch`): odrzuca po `content-length` **przed przeczytaniem body**, a strumień bez nagłówka odrzuca po przekroczeniu `maxBodySize` (źródło pobiera ~limit + kilka chunków, nie całe 64 KB). Domyślnie `PAYLOAD_TOO_LARGE` → 413; remap `PAYLOAD_TOO_LARGE: 400` + encoder daje kopertę `validation`/400.
- **`requestBodyHint: 'octet-stream'` + `input: z.instanceof(ReadableStream)`**: działa **wyłącznie z `inputStructure: 'detailed'`** — przy `compact` z path params strumień jest GUBIONY (input zawiera tylko params; udowodnione testem). `request.signal` dostępny przez funkcję `context` (`handle(request, {prefix, context: (req) => ({…, signal: req.signal})})`); uwaga: łańcuch oRPC sam nie sprawdza zabortowanego sygnału przed wykonaniem procedury — abort musi honorować `fetch`. **Zakres spike'u:** potwierdzone zostało tylko **dostarczenie strumienia** do handlera i dostępność `request.signal`; wzorzec limitowanego odczytu z `reader.cancel()` (model cover 5 MB) nie był wykonywany w spike'u — autorytatywne pokrycie w testach Tasku 7 (multipart audio ponad limit odrzucony bez pełnego buforowania) i Tasku 10 (strumień cover ponad 5 MB anulowany).
- **`requestBodyHint: 'form-data'` + `z.instanceof(File)`**: multipart dochodzi jako instancja `File` (compact + params OK); brak wymaganego pola → walidacja input → 400 `validation`.
- **Klient**: `new OpenAPILink(contract, {origin, url, fetch, customErrorResponseBodyDecoder})` + `createORPCClient` — pełne koło klient↔handler na Web `Request`/`Response`; timeout przez `AbortController` we wstrzykniętym `fetch` odrzuca wywołanie. Typ `JsonifiedClient<RouterContractClient<typeof contract>>` kompiluje się i jest przypisywalny z `createORPCClient` (weryfikacja `tsc`, nie tylko runtime).

### A. Kompozycja `implement()` z builderem bazowym

`implement(contract, config?)` **nie przyjmuje buildera bazowego** — drugi parametr to wyłącznie `ProcedureConfig` (`disableInputValidation`/`disableOutputValidation`). Zwracany Implementer daje `$context<T>()` (no-op w runtime — deklaruje typ kontekstu), `$config()`, `use(middleware)`, `middleware()`, `router(impl)`, `lazy()`; per-procedurowe implementery są dostępne jako klucze (`implementer.sessions.next.handler(fn)`). Współdzielone middleware „baseOs" przenosi się przez `implement(kidApiContract).$context<Ctx>().use(appErrorMiddleware).use(…)` — middlewares z `.use()` na implementerze są doklejane przed handlerami każdej procedury w `.router()`. `os.$context()` (prawdziwy `baseOs`) zostaje dla procedur code-first i może współistieć w jednym routerze/`OpenAPIHandler` z procedurami z implementera (przetestowane). Kontrakt pojedynczej procedury: `implement(procContract).handler(fn)` (bez `.router()`).

### B. Implementacja i montaż poddrzew osobno (strangler)

**TAK.** Działa wzorzec potrzebny Taskom 5–7: implementuje się wybrane poddrzewa (`implement({decks: contract.decks}).$context<Ctx>().use(mw).router({decks: …})`) i scala w **jednym** `OpenAPIHandler` pod jednym prefixem (`{...subtreeA, tasks: subtreeB}`) — dopasowanie ścieżek idzie po `meta.path` z kontraktu, klucze routera są nieistotne. Procedury niezaimplementowane nie trafiają do indeksu → `handle()` zwraca `{matched: false}` → czysty sygnał fallbacku do legacy (przetestowane). Alternatywa `implement(fullContract).router(partial)` przechodzi w runtime, ale typ `ContractedRouter` wymaga kompletu (potrzebne `as any`). Szczegół implementacyjny: router z implementera to Proxy z ukrytym kontraktem — spread (`{...router}`) gubi ukryty kontrakt, ale same procedury (obiekty `Procedure` z meta i schematami kontraktu) działają samodzielnie.

### C. `RequestLimitHandlerPlugin` konfigurowalny per-route?

**NIE.** Opcje pluginu to wyłącznie `{maxBodySize: number}`; działa jako interceptor całego handlera (wszystkie procedury), bez filtra per-procedura. Filtr per-procedura istnieje tylko jako `filter` w opcjach handlera (`OpenAPIMatcherOptions`) i nie ogranicza zakresu pluginu. Wnioski dla planu: (1) różne limity per endpoint → pre-check `content-length` w middleware (nagłówki w context) + własny reader z limitem tam, gdzie trzeba odrzucić przed parsingiem; (2) plugin jako zabezpieczenie globalne catch-all (najostrzejszy rozsądny limit, np. audio) dla strumieni bez `content-length`; (3) status/koperta limitu przez `errorStatusMap` + `customErrorResponseBodyEncoder` (`PAYLOAD_TOO_LARGE` → 400/`validation`).

### Divergencje docs↔beta.45 i korekty planu

1. `implement()` nie komponuje się z `baseOs` — współdzielone middleware przez `.use()` na implementerze (korekta Tasków 2/5).
2. Query params zostają stringami — `KidDecksQuerySchema.microphoneEnabled` musi być `z.stringbool()`, nie `z.boolean()` (korekta Task 4).
3. octet-stream z path params wymusza `inputStructure: 'detailed'`; `compact` gubi strumień (korekta Task 10 — cover).
4. `RequestLimitHandlerPlugin` bez konfiguracji per-route — limity per endpoint na pre-checku `content-length` + reader z limitem; plugin tylko globalnie (korekta Tasków 6/7).
5. Własna koperta błędu wymaga po stronie klienta `customErrorResponseBodyDecoder`, inaczej `MalformedResponseError` zamiast `ORPCError` (korekta Tasków 9/10).
6. `OpenAPIHandler`/`OpenAPILink` importowane z `@orpc/openapi/fetch`, nie z głównego indexu.
