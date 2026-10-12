# Endpoint MCP HTTP w Knowli — plan A

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Standardowy endpoint `/api/mcp` z jednym narzędziem raportowym i bundle walidacji/skilla dla konsumentów.

**Architecture:** SDK MCP występuje tylko w adapterze apps/web. MCP i istniejący REST korzystają z `getLearningOverview`; autoryzacja i limit są współdzielone, a każdy transport MCP jest osobną instancją per request.

**Tech Stack:** `@modelcontextprotocol/sdk` dokładnie 1.32.1, istniejący Next.js/TypeScript/Zod, Vitest, PostgreSQL, Playwright; Python do istniejącego release workflow.

**Spec:** [Projekt](../specs/2026-10-12-umiem-mcp-streamable-http-design.md); [plan całości i bazy repo](2026-10-12-umiem-mcp-streamable-http.md).

## Global Constraints

- `/api/mcp`, Node.js, stateless/JSON, osobny server/transport per request; żadnego nowego kontenera ani migracji.
- Token `learning:read` dla każdego żądania; REST i MCP dzielą 60 requests/token/60 s/process, liczone raz.
- `days` 1–31/default 7, `upcomingTestDays` 1–90/default 14, opcjonalny UUID `childId`; jedno narzędzie, DTO `schemaVersion: 1`.
- Body 16 KiB, DTO 2 MiB, odpowiedź HTTP 4 MiB. Błąd nie jest pustym sukcesem; dane nie są obcinane.
- Origin dokładnie z `UMIEM_MCP_ALLOWED_ORIGINS`, bez wildcard; domyślnie odrzucaj obecny Origin, akceptuj jego brak.
- Dziedzicz całą specyfikację i zasady publikacji z planu całości. Testy są syntetyczne, bez modeli i produkcji.

## Review Focus

1. Równoległe requesty z tym samym id nie mogą mieszać tokenów ani wyników — A2.
2. Odwołanie po initialize musi blokować kolejne RPC — A3.
3. Streaming body bez Content-Length i JSON batch nie mogą ominąć ograniczenia pracy — A2.
4. JSON escaping i podwójna reprezentacja DTO nie mogą ominąć limitu HTTP — A1/A2.
5. GET/HEAD/DELETE oraz błędy negocjacji nie mogą trzymać transportu lub ujawnić danych — A2/A3.

## Pliki i odpowiedzialności

| Plik | Odpowiedzialność |
| --- | --- |
| `apps/web/src/integrations/learning-mcp-server.ts` | Rejestracja jednego tool i wynik/error bez zależności od HTTP |
| `apps/web/src/integrations/learning-mcp-route.ts` | Origin, bearer auth, body limit, lifecycle transportu, odpowiedzi HTTP |
| `apps/web/src/integrations/integration-read-limiter.ts` | Przeniesiony istniejący limiter, wspólny singleton REST/MCP |
| `apps/web/src/app/api/mcp/route.ts` | Cienkie złożenie adaptera z usługami Next.js |
| `integrations/umiem-mcp/package_consumer.py` | Release wyłącznie walidatora, kontraktu i skilla |
| `tests/integration/learning-mcp.test.ts` | Prawdziwa baza i przypadki użycia przez MCP |
| `tests/e2e/learning-mcp-http.spec.ts` | Rzeczywisty HTTP Next.js + standardowy klient SDK |

### A1: Narzędzie MCP używa istniejącego kontraktu

**Files:** Create `apps/web/src/integrations/learning-mcp-server.ts`, `apps/web/src/integrations/learning-mcp-server.test.ts`; Modify `apps/web/package.json`, `pnpm-lock.yaml`.

**Interfaces:** `createLearningMcpServer(readOverview: (query: LearningOverviewQuery) => Promise<LearningOverviewDto>, requestId: string): McpServer`. `readOverview` jest zależnością przekazaną per request; server nie zna raw tokenu, Services ani bazy. requestId pochodzi z granicy HTTP i odpowiada X-Request-Id; test in-memory przekazuje syntetyczny UUID. Wynik tool: `CallToolResult`, z `structuredContent` i text JSON zgodnymi ze specyfikacją. Eksportuj `MAX_OVERVIEW_BYTES=2097152` do adaptera HTTP.

- [ ] Dodaj przypięty SDK wyłącznie do `@learning/web`; użyj `npx --yes pnpm@10.34.6 install`, zapisz zmianę lockfile. Sprawdź importy server/mcp.js, server/webStandardStreamableHttp.js i client/index.js bez importowania SDK w domenie/kid-ui.
- [ ] Napisz testy przez `InMemoryTransport.createLinkedPair()` i standardowy `Client`; fixture z `integrations/umiem-mcp/tests/fixtures/learning-overview.example.json`, parsowana przez `LearningOverviewDtoSchema`.

```ts
expect((await client.listTools()).tools.map(t => t.name))
  .toEqual(["umiem_get_learning_overview"]);
const result = await client.callTool({ name: "umiem_get_learning_overview", arguments: {} });
expect(readOverview).toHaveBeenCalledWith({ days: 7, upcomingTestDays: 14 });
expect(result.structuredContent).toEqual(overview);
expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual(overview);
```

- [ ] Dodaj przypadki: granice 1/31 i 1/90; childId; `days="7"`, bool, null childId, nieznane pole/tool -> brak wywołania readOverview; schema wejścia z defaults i outputSchema; read-only adnotacje. Awaria readOverview nie tworzy children=[], a błąd nie ujawnia tokenu/SQL zawartych w synthetic exception.
- [ ] Dodaj DTO z tekstem rozrastającym się po JSON encoding; >2097152 bajtów -> `isError=true`, code `learning_summary_too_large`, bez częściowego DTO. Zwykły fixture ma czas 1980 s i trzy dni bez zmiany znaczenia.
- [ ] RED: `npx --yes pnpm@10.34.6 test:unit apps/web/src/integrations/learning-mcp-server.test.ts`; potwierdź brak nowej implementacji, nie błąd konfiguracji/importu SDK.
- [ ] Zaimplementuj rejestrację narzędzia z istniejącymi schematami; waliduj args i wynik runtime. Przetłumacz błędy domeny na bezpieczny tool error z requestId, bez dowolnego tekstu wyjątku. Nie duplikuj algorytmu learning-overview.
- [ ] GREEN: powtórz test i `typecheck`; zapisz wyniki w dzienniku. Selektywny commit `feat: add learning overview MCP tool for web`.

### A2: Bezpieczny HTTP boundary i transport per request

**Files:** Create `apps/web/src/integrations/learning-mcp-route.ts`, `apps/web/src/integrations/learning-mcp-route.test.ts`, `apps/web/src/integrations/integration-read-limiter.ts`, `apps/web/src/integrations/integration-read-limiter.test.ts`, `apps/web/src/app/api/mcp/route.ts`; Modify `apps/web/src/integrations/learning-overview-route.ts`, `.env.example`.

**Interfaces:**

```ts
type LearningMcpDependencies = {
  authenticate(rawToken: string): Promise<IntegrationPrincipal>;
  readOverview(query: LearningOverviewQuery, rawToken: string): Promise<LearningOverviewDto>;
  limiter: IntegrationReadLimiter;
  allowedOrigins: ReadonlySet<string>;
  now(): number;
};
handleLearningMcpRequest(request: Request, deps: LearningMcpDependencies): Promise<Response>;
createLearningMcpDependencies(services: Services, allowedOrigins: ReadonlySet<string>): LearningMcpDependencies;
readMcpAllowedOrigins(env: NodeJS.ProcessEnv): ReadonlySet<string>;
```

`IntegrationReadLimiter` zachowuje dotychczasowe metody `consume` i `retryAfterSeconds`; REST zachowuje re-export klasy dla istniejących testów/importów. Singleton `learningOverviewLimiter` znajduje się w nowym wspólnym module. Composition używa `requireLearningReadToken(services.db, token)`; `readOverview` wywołuje `getLearningOverview(services, query, token)` bez callbacku ponownego naliczenia.

- [ ] Napisz testy Request/Response z fake authenticate/readOverview, prawdziwym SDK i kontrolowanym zegarem. Helper testowy buduje POST z `Accept: application/json, text/event-stream`, Content-Type JSON i wersją protokołu; fixture jest ten sam co A1.
- [ ] Test `anonymous_and_cookie_only_requests_are_401`: POST/list/initialize oraz GET bez bearer -> 401, WWW-Authenticate, no-store; `readOverview` nie wykonany. Scope ->403, database connection exception w auth ->503, brak SQL/tokenu w body/logach.
- [ ] Test `origin_is_checked_before_auth_and_body`: brak Origin dopuszczony; nieznany, `null`, wildcard/niepoprawna konfiguracja odmowa; poprawny HTTPS origin na liście dopuszczony. Nie generuj Access-Control-Allow-Origin.
- [ ] Test `streamed_body_limit_and_single_rpc`: >16384 bajtów z brakującym i zaniżonym Content-Length ->413, body reader zamknięty; batch ->400, malformed JSON -> błąd parse SDK, zero odczytów overview. Złe Content-Type/Accept/wspierana i niewspierana wersja według SDK.
- [ ] Test `shared_limit_counts_each_http_once`: initialize/ping/notifications/list/call naliczane raz; pozostałe sloty wykorzystane przez REST tego samego principal ->429/Retry-After; inny token niezależny; po 60000ms ponowny odczyt działa.
- [ ] Test równoległy dwóch tokenów i identycznego RPC id, z opóźnionymi różnymi wynikami: każdy wynik trafia do własnego requestu. Brak tokenu/principal w globalnym singletonie, brak Mcp-Session-Id.
- [ ] Test `unsupported_methods_and_cleanup`: auth GET/HEAD/DELETE/PUT/PATCH/OPTIONS ->405/Allow POST; no-store zawsze. server/transport zamknięte po success, SDK error, domenowym error i anulowaniu; JSON response pozostaje czytelna po cleanup. Cały encoded HTTP >4194304 bajtów -> mały bezpieczny tool error z zachowaniem RPC id.
- [ ] RED: `npx --yes pnpm@10.34.6 test:unit apps/web/src/integrations/learning-mcp-route.test.ts apps/web/src/integrations/integration-read-limiter.test.ts`; zapis dowodu.
- [ ] Zaimplementuj limiter extraction, boundary, ograniczony reader i lifecycle; dopisz `UMIEM_MCP_ALLOWED_ORIGINS` w env example bez prawdziwego hosta/sekretu. Cienka route tworzy dependencies przez `getServerServices`, rejestruje wszystkie wymienione metody bez dodatkowych endpointów.
- [ ] GREEN: powtórz testy wraz z istniejącymi `learning-overview-route.test.ts`, `typecheck`; commit `feat: expose authenticated Streamable HTTP MCP endpoint`.

### A3: PostgreSQL i standardowy klient przez prawdziwy Next.js

**Files:** Create `tests/integration/learning-mcp.test.ts`, `tests/e2e/learning-mcp-http.spec.ts`; use existing helpers/world/test-run-config. Nie twórz drugiego testowego backendu.

**Interfaces:** Endpoint A2 i narzędzie A1; test integracyjny składa deps z rzeczywistymi Services, a E2E łączy `Client` + `StreamableHTTPClientTransport` z adresem Next.js.

- [ ] Napisz testy: syntetyczny token wydany istniejącym CLI/use case, initialize/list/call -> DTO równe REST dla tego samego zegara i query; brak autoryzacji Parent/Kid przez token MCP; dla dzieci o identycznym imieniu UUID pozostają osobno; days=3, czas/practice/version/testDate przechodzą kontrakt.
- [ ] Odwołaj token po initialize; tools/list i tools/call ->401; read-only use case reautoryzuje w transakcji. Token bez scope ->403. Symulacja przejściowej awarii/query timeout w narzędziu daje isError, nie empty success.
- [ ] Test standardowego cyklu bez session id: initialize -> notifications/initialized -> tools/list -> tools/call -> ping; GET/DELETE405 nie blokują klienta. Unsupported version ->400; każdy request poza initialize ma negocjowany nagłówek.
- [ ] RED: uruchom nową asercję brakującej ścieżki w A2 przed domknięciem tej ścieżki. Jeżeli wszystkie testy przechodzą od razu na A1/A2, zapisz je jako testy regresji, bez fikcyjnego dowodu RED i bez psucia działającego kodu.
- [ ] Napraw tylko potwierdzone rozbieżności. Integracyjne: `npx --yes pnpm@10.34.6 test:integration tests/integration/learning-mcp.test.ts`; E2E: `npx --yes pnpm@10.34.6 exec playwright test tests/e2e/learning-mcp-http.spec.ts tests/e2e/learning-overview-api.spec.ts`.
- [ ] Docker Desktop musi być dostępny. Przy innych sesjach użyj istniejących izolatorów `UMIEM_TEST_RUN_ID`, `UMIEM_E2E_PORT`, `UMIEM_WORKER_HEALTH_PORT`; nie uruchamiaj kilku przebiegów na tych samych portach/bazie.
- [ ] Zapisz wyniki i commit `test: verify learning MCP HTTP and REST compatibility`.

### A4: Pakiet konsumenta, skill i dokumentacja nowej granicy

**Files:** Create `integrations/umiem-mcp/package_consumer.py`, `integrations/umiem-mcp/tests/test_consumer_release.py`, `integrations/umiem-mcp/tests/test_umiem_contract.py`; Modify `integrations/umiem-mcp/pyproject.toml`, `integrations/umiem-mcp/uv.lock`, `integrations/umiem-mcp/src/umiem_mcp/__init__.py`, `integrations/umiem-mcp/skills/umiem-learning/SKILL.md`, `integrations/umiem-mcp/src/umiem_mcp/contract-manifest.json`, `integrations/umiem-mcp/README.md`, `docs/integrations/hermes-learning.md`, `docs/architecture.md`, `docs/folder-structure.md`, `docs/implementation-plan.md`, właściwa sekcja MCP w `AGENTS.md`. Remove po przeniesieniu znaczących testów: `integrations/umiem-mcp/src/umiem_mcp/__main__.py`, `server.py`, `client.py`, `config.py`, `integrations/umiem-mcp/package_release.py`, `integrations/umiem-mcp/tests/test_umiem_stdio.py`, `test_umiem_mcp.py`.

**Interfaces:** `make_consumer_release(output_dir: Path) -> Path`. ZIP root `umiem-consumer/`; dokładnie `src/umiem_mcp/__init__.py`, `validation.py`, `learning-overview.schema.json`, `contract-manifest.json`, `skills/umiem-learning/SKILL.md`, `RELEASE-MANIFEST.json`. Manifest: package=`umiem-consumer`, version=`0.2.0`, sourceCommit pełny HEAD, contractCommit, schemaVersion=1, files map relative path -> SHA256 dla pięciu plików danych (bez samego manifestu). Bez .venv, serwera stdio, client.py, tokenów, .env i symlinków.

- [ ] RED: testuje listę członków archive, SHA i commit, odmowę niezgodnego schema/skilla, izolowane rozpakowanie i import `umiem_mcp.validation`; istniejąca syntetyczna fixture przechodzi semantyczną walidację. Komenda `npx --yes pnpm@10.34.6 test:mcp` ma uruchamiać ten test.
- [ ] Przenieś klasę `ContractTests` z `test_umiem_mcp.py` do `test_umiem_contract.py` bez osłabienia asercji: czas, wersje zestawów, nakładające się liczniki, niespójne dane, rozmiar i hash bundle. Testy usuwanego klienta/konfiguracji/stdio zastępują nowe testy HTTP w A/B. Dopiero potem usuń wymienione pliki stdio i stare pakowanie.
- [ ] Zaimplementuj paczkowanie konsumenta bez zewnętrznych service/API calls. W pyproject zmień nazwę na `umiem-consumer`, wersję na `0.2.0`, usuń executable `umiem-mcp` i serwerowe mcp/httpx z production dependencies. Zachowaj jsonschema/tzdata; SDK MCP/httpx potrzebne wyłącznie testom umieść w grupie hermes-test, nie w instalowanym bundle. Regeneruj uv.lock i zaktualizuj opis __init__.py na walidator kontraktu. Source bundle twórz z committed, clean release inputs, nie z ruchomego dirty worktree.
- [ ] Skill wymienia standardowy remote endpoint w instrukcji operatora; interpretacja danych i nazwa narzędzia pozostają zgodne. Użyj `writing-skills` przed zmianą skilla, aktualizuj hash w manifeście i sprawdź konsumenta na fixture/fake MCP.
- [ ] Dokumentacja i AGENTS: źródło HTTP server w `apps/web/src/integrations`, schema w contracts, skill/walidator w `integrations/umiem-mcp`; zmiany API nadal wymagają oceny MCP/SKILL.md. Usuń aktywne instrukcje serwera stdio i jego instalacji; zastąp je jednym wariantem HTTP. Historycznych dzienników nie przepisuj. Zapisz procesowe ograniczenie limiter oraz config URL/headers z `${UMIEM_READ_TOKEN}`, bez sekretów. Zachowaj aktualne instrukcje właściciela o PR dopiero po implementacji; starsza wersja AGENTS w worktree nie może przywrócić automatycznego dokumentacyjnego PR ani nadpisać zmian właściciela w głównym checkout.
- [ ] GREEN: `test:mcp`, `contracts:export-learning-overview --check`, `test:unit`, `typecheck`, `build`, `git diff --check`. Nie aktualizuj kontraktu ręcznie niezależnie od exporter; upewnij się, że Python kopia schema jest identyczna.
- [ ] Commit `feat: package HTTP MCP consumer contract and skill`; po commicie zbuduj bundle i wykonaj smoke z rozpakowanego archive. Przekaż bundle i manifest części B; zapisz SHA/commit, bez sekretów.

## Handoff

A nie kończy całego feature'u: wykonaj B, smoke rzeczywistego serwera z Python klientem, pełny niezależny review i końcową publikację wg planu całości. Nie twórz PR po samym zapisaniu tego planu.
