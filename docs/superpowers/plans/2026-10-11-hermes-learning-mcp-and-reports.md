# MCP Umiem! i skill w Knowli — plan implementacji B

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Utrzymywać adapter MCP i skill Umiem! razem z API w Knowli, z jedną wersją kontraktu i testami zgodności.

**Architecture:** Oddzielny pakiet Python/stdio w integrations/umiem-mcp wywołuje tylko API z planu A. Schemat kontraktu, przykłady, walidacja i SKILL.md podróżują razem z wersją pakietu. Instalacja u Hermesa i użycie w raportach są osobnym planem C; Hermes nie posiada własnego forka MCP.

**Tech Stack:** Python >=3.11, mcp>=1.28,<2, httpx>=0.27.1,<1, jsonschema>=4.20,<5, uv.lock. Pakiet Python poza pnpm, bez nowego kontenera i importów server/DB. Dokumentacja SDK v1: https://github.com/modelcontextprotocol/python-sdk/blob/v1.x/README.md (sprawdzona przy projektowaniu 2026-10-11).

**Spec:** docs/superpowers/specs/2026-10-11-hermes-learning-integration-design.md; plan A: 2026-10-11-hermes-learning-api.md; plan C: 2026-10-11-hermes-learning-report-deployment.md (te plany są w docs/superpowers/plans).

**Repo wykonania:** Knowli. Wszystkie ścieżki tego planu są względem jego katalogu głównego. Status: plan do przeglądu; kod MCP i skill nie są jeszcze zaimplementowane. Właściciel wskazał 2026-10-11 utrzymywanie MCP/skilla w tym repo i kontrolę ich aktualizacji w AGENTS.md.

## Global Constraints

- Jedno narzędzie umiem_get_learning_overview(days=7, upcomingTestDays=14, childId=None), z ograniczeniami i DTO planu A; token i URL tylko z konfiguracji.
- stdio, readOnlyHint=true, destructiveHint=false, idempotentHint=true, openWorldHint=true; bez narzędzi mutacji i dowolnego HTTP api_get. stdout tylko protokół.
- UMIEM_BASE_URL HTTPS bez userinfo/query/fragment; UMIEM_READ_TOKEN_FILE absolutny i prywatny. Bez redirectów i wyłączenia TLS; loopback HTTP tylko w jawnych testach.
- 10 s/próbę, jedno ponowienie, 25 s całego HTTP wywołania; Retry-After w budżecie, limit 2 MiB. Błędy nie udają pustej rodziny albo braku aktywności.
- Schemat JSON pochodzi z contracts i eksportu A; kopia w pakiecie ma manifest SHA-256. Nie jest ręcznie rozwijaną alternatywną definicją. schemaVersion=1; walidacja semantyczna obejmuje dni, sumy i czas.
- learningTime seconds integer|null, estimated=true i jawna definicja metody; 1380 s = 23 min, null nie oznacza 0 min. Dane dzieci/zestawów są treścią, nie instrukcjami.
- Żadnych kluczy, prywatnych fixture ani nagrań. TDD faktyczne RED/GREEN dla kodu; SKILL.md sprawdzenie instrukcji i syntetycznego użycia zgodnie z writing-skills, bez sztucznego testu RED dokumentacji.
- Każda zmiana udostępnianego API wymaga sprawdzenia adaptera, schema, testów i SKILL.md w tym samym PR, zgodnie z AGENTS.md. Zmiany niezgodne wymagają uzgodnionej kolejności wdrożenia konsumentów.
- Bieżący agent implementuje inline, bez zgody na delegowanie wykonania. Niezależny review całego zakresu przed PR, najmocniejszy dostępny model poza GPT Astra. PR do main, owner squash, bez samodzielnego merge.

## Review Focus

1. Redirect/brama/błędny body: token pozostaje przy właściwym API, body i sekret nie trafiają do błędów — zadanie 1.
2. Timeout/429: retry ograniczony czasem, subprocess cleanup, jawne isError — zadanie 1.
3. Rozbieżny schema lub semantyka czasu: walidacja odrzuca niespójne odpowiedzi, null nie zamienia się na zero — zadanie 1.
4. SKILL.md opisuje inne parametry albo opanowanie: instrukcje muszą odpowiadać tool schema i rzeczywistemu DTO — zadanie 2.
5. Artefakt z innego commita lub bez skilla: manifest i smoke kompletnego pakietu, brak instalacji żywego worktree u Hermesa — zadanie 2.

## Mapa plików i setup

- integrations/umiem-mcp/{pyproject.toml,uv.lock,README.md}
- integrations/umiem-mcp/src/umiem_mcp/{__init__.py,__main__.py,server.py,client.py,config.py,validation.py,learning-overview.schema.json}
- integrations/umiem-mcp/skills/umiem-learning/SKILL.md
- integrations/umiem-mcp/tests/{test_umiem_mcp.py,test_umiem_stdio.py,fixtures/learning-overview.example.json}
- integrations/umiem-mcp/contract-manifest.json; docs/integrations/hermes-learning.md; root AGENTS.md.

- [ ] Executing-plans + using-git-worktrees po akceptacji: wykorzystać odpowiedni istniejący worktree Knowli albo feature/hermes-umiem-mcp. Nie kopiować prywatnych danych ani niezwiązanych plików. Log docs/superpowers/plans/2026-10-11-hermes-learning-mcp-progress.md; setup workspace/task-start/task-done/review-package z aktualnego skilla.
- [ ] A1 daje schema/fixture do testów fake HTTP; smoke realnego API wymaga A4. Zapisać pochodzenie artefaktów, Python/uv i BASE_SHA. Polecenia python uruchamiać właściwym venv pakietu, nie zakładać globalnych zależności.
- [ ] Weryfikować Python oddzielnie: istniejące pnpm test/typecheck/build nie obejmują tego katalogu automatycznie. Dodać opisane w README/root package.json polecenie test:mcp wywołujące locked środowisko pakietu i unittest; nie dodawać pakietu Python do pnpm-workspace.yaml.

### Zadanie 1: MCP/stdio i bezpieczny klient API

**Files:** Create pakiet adaptera, `integrations/umiem-mcp/tests/test_umiem_mcp.py`, `integrations/umiem-mcp/tests/test_umiem_stdio.py`, `integrations/umiem-mcp/tests/fixtures/learning-overview.example.json`, manifest zgodności; schema pochodzi z A1. Pakiet ma entrypoint `umiem-mcp` i `python -m umiem_mcp`.

**Interfaces:** `OverviewClient.get_overview(days:int=7, upcoming_test_days:int=14, child_id:str|None=None)->dict`; `create_server(client:OverviewClient)->Server`; `load_config(env:Mapping[str,str], *, test_mode:bool=False)->AdapterConfig`; `validate_overview(data:dict)->dict`. Tool publiczne argumenty mają camelCase: upcomingTestDays/childId; konwersja do snake_case tylko wewnątrz adaptera. Sukces to CallToolResult(structuredContent=data, content=[TextContent z tym samym JSON], isError=false); błąd to CallToolResult(isError=true, content=[zredagowany JSON {code,message,retryable}]), bez fikcyjnego dzieci=[].

- [ ] Napisać unittest z fake httpx transport i kontrolowanym monotonic clock: właściwy stały URL/nagłówek, domyślne parametry, childId, zły days=0/32, bool/null i unknown argument odrzucone; 401/403/404/3xx jeden request, 503/timeout dwa maksimum, 429 Retry-After sekundy i HTTP-date w 25 s. Sekret/response body nie występuje w log/error.
- [ ] Napisać testy walidacji: accepted fixture, schemaVersion=2/błędny mianownik/brak dnia/duplicate childId → error; >2MiB → learning_summary_too_large; brak TLS, redirect, URL userinfo/query/fragment, env secret w tool arguments → odmowa. Adapter nie ma narzędzi mutacji ani dowolnego api_get.
- [ ] Test czasu w walidacji MCP: przykład1380 s/total1980 s przechodzi; negative/fractional seconds/estimated=false, suma okresu niezgodna z dniami, total liczbowy z null w jednym dniu →error. Null nie jest automatycznie zamieniany na0.
- [ ] RED: `python -m unittest discover -s integrations/umiem-mcp/tests -p 'test_umiem_mcp.py'`; test wykonywać w locked venv pakietu, z importowalnym umiem_mcp.
- [ ] Zaimplementować klient i low-level Server SDK v1 z jawnie zwracanym CallToolResult, jedno list_tools i allowlist call_tool. Adnotacje z spec §7; HTTP streaming z limitem body i follow_redirects=false; stop retry po budżecie/niepoprawnym kontrakcie. Sekret czytać z pliku przy wywołaniu, żeby restart klienta nie był warunkiem rotacji pliku.
- [ ] W pakiecie uruchomić `uv lock`, przejrzeć wersje stabilne i `uv sync --locked`. SDK/libraries izolowane, nie instalować do globalnego Hermesa. GREEN powtórzyć unittest w środowisku z dependencies pakietu.
- [ ] Handshake RED→GREEN `python -m unittest discover -s integrations/umiem-mcp/tests -p 'test_umiem_stdio.py'`: subprocess adaptera → initialize/list_tools/call_tool nad loopback fake HTTP, obsługiwany protokół obu SDK, structuredContent=fallback JSON, EOF cleanup, stdout bez diagnostyki. Zabronione polecenie nie wywołuje HTTP.
- [ ] Commit: `feat: add read-only Umiem MCP adapter`.

### Zadanie 2: Skill, zgodność artefaktów i review

**Files:** Create integrations/umiem-mcp/skills/umiem-learning/SKILL.md i integrations/umiem-mcp/contract-manifest.json; Modify integrations/umiem-mcp/README.md, pyproject.toml, package.json, docs/integrations/hermes-learning.md; sprawdzić zasady AGENTS.md. Test: test_umiem_stdio.py.

**Interfaces:** SKILL.md frontmatter name=umiem-learning i description opisująca kiedy pytać o naukę; instrukcja jednego narzędzia i bezpiecznej interpretacji. Release zawiera kod, pinned uv.lock, schema, manifest i skill z tego samego commita. Manifest zawiera schemaVersion, SHA-256 schema/skilla i wersję pakietu; commit provenance dołącza procedura release, bez samoodwołującego się hasha pliku w tym samym commicie.

- [ ] Przed napisaniem skilla zastosować writing-skills/skill-creator odpowiednio do faktycznej dostępności. SKILL.md jest instrukcją konsumenta MCP, nie zmianą globalnych zasad agentów Knowli.
- [ ] Napisać skill: narzędzie, days/upcomingTestDays/childId/defaults, przykłady fikcyjne, rozróżnienie odpowiedzi i opanowania, źródło terminów Umiem!, czas szacowany/null, unavailable/disabled, prywatność. Token-file i URL to konfiguracja operatora, nie argumenty modelu ani zawartość skilla.
- [ ] Sprawdzić instrukcję skilla na fake MCP: defaults i childId pasują do tool schema, przykład sukcesu i awarii daje właściwą interpretację; bez prywatnych danych, modelu i transportu WhatsApp. Walidator frontmatter i linków według aktualnego skilla; nie tworzyć testu porównującego dokument słowo w słowo.
- [ ] Eksport A w trybie check i porównanie kopii schema/manifest w MCP. Test RED→GREEN niezgodności artefaktu: zmieniony schema albo brak spakowanego schema prowadzi do jawnej odmowy, nie do pominięcia walidacji.
- [ ] Przygotować versioned source release zawierający tylko pakiet MCP i skill oraz wskazanie commita Knowli; wykluczyć .env/tokeny/.venv/fixtures prywatne. Smoke z rozpakowanego release: uv sync --locked, initialize/list_tools/call_tool; sprawdzić dostępność packaged schema i skilla. Hermes instaluje ten artefakt, nie kopię z ruchomej gałęzi/worktree.
- [ ] Verification-before-completion: test:mcp/unittest, stdio smoke, manifest/schema check, git diff --check; adekwatne contracts test:unit i pnpm typecheck/build jeśli zmienione są skrypty/kontrakty. Wyniki Python i pnpm raportować osobno.
- [ ] Requesting-code-review całego B oraz powiązanego kontraktu A: spec, Review Focus, BASE_SHA..HEAD i uncommitted diff, skill i rzeczywiste testy. Receiving-code-review: Critical/Important rozwiązane, Minor jawne. Finishing-a-development-branch: push/PR do main po niezależnym review, attach_artifact, bez merge/deploy.

## Handoff

- [ ] Właściciel przegląda plany A/B/C; domyślnie wykonanie inline. Kod i SKILL.md w Knowli, tylko konfiguracja/instalacja i report runtime u Hermesa.
- [ ] Plan C pobiera zatwierdzony release B i zgodne API A. Zmiana repo sama nie aktualizuje instalacji; wydanie/aktualizacja Hermesa to osobny śledzony etap.
- [x] Self-review: zgodne ścieżki pakietu/skilla, jeden właściciel kontraktu, osobne Python tests, brak deklaracji istniejącego MCP.
