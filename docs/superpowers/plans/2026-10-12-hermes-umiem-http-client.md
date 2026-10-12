# Hermes: klient Umiem! przez HTTP — plan B

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Rodzinny profil i Evening zużywają MCP `/api/mcp` przez HTTP, bez uruchamiania lokalnego adaptera.

**Architecture:** Native Hermes otrzymuje zwykłe url/headers. Istniejący reporter używa tego samego wpisu, `streamable_http_client` i walidatora z wydania Knowli; instalator kopiuje consumer bundle/skill oraz prywatne zależności.

**Tech Stack:** Python, mcp==1.30.0/httpx==0.28.1/jsonschema==4.26.0/tzdata==2026.5 w prywatnych runtime-deps, istniejące PyYAML/tiktoken, unittest.

**Spec:** [Projekt](../specs/2026-10-12-umiem-mcp-streamable-http-design.md); [plan całości](2026-10-12-umiem-mcp-streamable-http.md), [serwer i bundle A](2026-10-12-umiem-mcp-http-server.md).

**Repo root B:** `C:/Users/looka/.codex/worktrees/hermes-umiem-reports/Hermes-szkola`. Wszystkie ścieżki poniżej są względem tego repo, nie Knowli. Przed zmianami przeczytaj jego własne AGENTS.md i instrukcje school-agent.

## Global Constraints

- `mcp_servers.umiem.url` + `headers.Authorization="Bearer ${UMIEM_READ_TOKEN}"`, token dostępny w środowisku native usługi i reportera; YAML/repo nie zawierają sekretu.
- `learning.enabled`, `learning.consumer_root`; brak interpreter discovery, adapter_root i subprocess MCP w nowej ścieżce.
- Endpoint HTTPS bez userinfo/query/fragment; loopback HTTP wyłącznie przy `UMIEM_ALLOW_LOOPBACK_HTTP_FOR_TESTS=1` w izolowanym procesie testowym.
- 30 s na cały cykl z cleanup, HTTP 10 s, limit response 4 MiB strumieniowo i DTO 2 MiB; brak retry tools/call.
- Jedno tools/call w Evening, zero w Morning/Sync; receipt guards i limit kontekstu 4000 tokenów bez zmian.
- Własność/mode, drift guardy i inne konfiguracje zachowane; bez live cron/model/WhatsApp, globalnego pip install lub zmiany OAuth.

## Review Focus

1. Nierozwiązany placeholder sekretu: zero połączeń i brak wycieku wartości — B1.
2. Redirect 307/308, również same-origin: brak drugiego requestu ani wysłania tokenu — B1.
3. HTTP error/SDK logging/invalid JSON/oversized stream: unavailable bez prywatnej treści w logach — B1.
4. Drift prepare/install/activate i hash bundle: odmowa bez nadpisania aktualnego profilu — B2.
5. Receipt prepared/delivered/unknown, disabled oraz Morning/Sync: brak dodatkowego narzędzia — B3.

### B1: Klient HTTP i kontrola sekretu/odpowiedzi

**Files:** Modify `school-agent/scripts/family_learning_mcp.py`, `school-agent/markdown-requirements.txt`, `tests/test_family_learning_mcp.py`; Create `school-agent/scripts/family_learning_http.py`, `tests/test_family_learning_http.py`.

**Interfaces:**

- Publiczny `McpLearningClient(config_path: Path, *, timeout_seconds: float=30)` i `fetch(days:int=7, upcoming_test_days:int=14)->dict` pozostają zgodne z reporterem.
- `resolve_mcp_http_config(server:dict, environment:Mapping[str,str])->tuple[str,dict[str,str]]` w helperze: HTTPS URL, nagłówki z `${VAR}`/`${env:VAR}`, brak brakujących referencji/CRLF i brak literalnego sekretu w wyjątkach. Dopuszczony Authorization Bearer; brak placeholder oznacza błąd konfiguracji operatora, nie wpisywanie go do logu.
- `create_bounded_http_client(headers:dict[str,str], *, max_response_bytes:int=4194304)->httpx.AsyncClient`: TLS verification, timeout10s, response hook odmawia 3xx, transport stream wrapper przerywa po limicie niezależnie od Content-Length.
- Walidator importowany wyłącznie z `learning.consumer_root/src/umiem_mcp/validation.py`, po sprawdzeniu manifestu i skilla; nie kopiuj implementacji semantyki do reportera.

- [x] Przypnij prywatne zależności w requirements zgodnie z Global Constraints; zainstaluj do lokalnego odizolowanego katalogu testowego/runtime-deps. Nie modyfikuj globalnego SDK/OAuth Hermesa.
- [x] Przepisz obecny test stdio na rzeczywisty syntetyczny HTTP MCP server z przypiętym SDK Python; server rejestruje dokładnie jedno tool i zlicza initialize/list/call. Test już nie wymaga zmiennej `UMIEM_MCP_SOURCE` ani uruchomionego adaptera; bundle A4 wskazuje `UMIEM_CONSUMER_SOURCE`.

```python
overview = McpLearningClient(config).fetch(days=7, upcoming_test_days=14)
self.assertEqual(overview["schemaVersion"], 1)
self.assertEqual(overview["children"][0]["learningTime"]["seconds"], 1980)
self.assertEqual(server.tool_calls, [("umiem_get_learning_overview", {"days": 7, "upcomingTestDays": 14})])
```

- [x] Testy fail-closed: brak token env, `${env:UMIEM_READ_TOKEN}` wspierane; HTTPS wymagane; loopback tylko jawnie w tests; old stdio-only config odrzucony jako niedostępny, bez automatycznego fallbacku. Przy `enabled=false` zero requestów, zero importów bundle wymagających pliku.
- [x] Testy redirect: synthetic302/307/308 same-origin i cross-origin -> brak follow-up requestu. Hook zatrzymuje również logikę klienta SDK.
- [x] Testy HTTP401/403/429/503, isError, unsupported schema, mismatch bundle, malformed JSON, strumieniowy limit odpowiedzi i >2MiB DTO -> LearningUnavailable bez starej/pustej rodziny.
- [x] Captured logs i str(exception) nie zawierają synthetic tokenu ani treści dziecka; HTTP/MCP błędy nie są logowane.
- [x] Powolny request przekracza krótki testowy deadline i kończy się unavailable. StructuredContent jest preferowane; tekstowy fallback jest walidowany.
- [x] RED/GREEN potwierdzone testami klienta z rozpakowanym bundle; odpowiednie błędy instalacji/cache naprawiono i zapisano w dzienniku.
- [x] Zaimplementuj HTTP helper oraz `_fetch`: `async with http_client`, `async with streamable_http_client(url,http_client=http_client,terminate_on_close=False)`, `ClientSession`, initialize, jedno call_tool, walidacja. Brak server-side session oznacza brak DELETE w cleanup. Utrzymaj istniejące bezpieczne kody błędu.
- [x] GREEN: HTTP/context/report suites przechodzą; commit `feat: read Umiem MCP through Streamable HTTP`.

### B2: Profil i instalator konsumenta bez adapter venv

**Files:** Modify `school-agent/scripts/family_notes_profile.py`, `tests/deploy_family_notes.py`, `tests/test_deploy_family_notes.py`, `tests/test_family_notes_contract.py`; Modify `school-agent/UMIEM-INTEGRATION.md`, `school-agent/AGENTS.md`, repo `AGENTS.md`, `school-agent/MARKDOWN-DEPLOYMENT.md`.

**Interfaces:** `family_profile_config(..., umiem=None)` zachowuje argumenty bazowe; HTTP options: `{mcp_url:str, consumer_root:str}`. `prepare(..., umiem=...)` przyjmuje `{mcp_url, consumer_release_root}`. CLI `--umiem-mcp-url` + archive `stage/umiem-consumer-release`, bez `--umiem-base-url`/`--umiem-token-file` dla nowej ścieżki. Pozostałe tryby instalatora zachowują zgodność. Stare opcje prowadzą do jasnego komunikatu migracyjnego, nie tworzą pozornie poprawnego profilu HTTP.

Manifest instalacji Umiem!: transport=`streamable-http`, mcp_url, consumer_commit i mapy SHA z A4, nigdy token/rozwinięte headers. Instalacja do `school-agent/umiem/consumers/<sourceCommit>`; skill do istniejącego `school-agent/skills/umiem-learning/SKILL.md`.

- [x] RED: profil bez umiem zachowuje baseline; HTTP wariant ma toolset `mcp-umiem`, URL, header placeholder, `learning.consumer_root` i nie zawiera stdio config. Pozostałe serwery zachowane.
- [x] Test pełnego `prepare -> install -> activate -> verify` na fake-root z bundle A4 i prywatnym dependency staging: manifest/skille/hash zgodne, brak venv/subprocess adaptera, inne MCP i konfiguracje zachowane.
- [x] Testy SHA/schema/skill mismatch, plików prywatnych, drift profilu, zachowania receipt i niezależnych MCP; detekcja symlink jest wdrożona, ale nie uruchomiona osobno na Windows.
- [x] Dokumentacja `UMIEM-INTEGRATION.md` jest kopiowana do workdir; test fake-root sprawdza bajty pliku. Consumer bundle nie zawiera serwera stdio.
- [x] Usunięto martwą ścieżkę stdio z aktywnego klienta/profilu/instalatora i dokumentacji. Historyczne notatki/plany pozostają zapisem wcześniejszego stanu; nic live nie było usuwane.
- [x] Profil/manifest nie zapisuje tokenu ani rozwiniętego nagłówka; stare opcje CLI zwracają komunikat migracyjny.
- [x] Dokumentacja opisuje URL `/api/mcp`, `${UMIEM_READ_TOKEN}`, bundle i rotację; testy installer/contract przechodzą. Commit `feat: install HTTP Umiem consumer profile and contract bundle`.

### B3: Report regresje, cross-language smoke i końcowy review

**Files:** Modify `tests/test_family_notes_reports.py` tylko gdy potrzebne nowe integracyjne asercje; Create `tests/smoke_umiem_http.py`; dzienniki postępu i dokumentacja z wynikami bez prywatnych payloadów.

**Interfaces:** `smoke_umiem_http.py --url <test-endpoint> --consumer-root <bundle>` zużywa token syntetyczny z env, wywołuje ten sam McpLearningClient co produkcyjny reporter i wypisuje tylko status/schemaVersion/liczby dzieci/dni. Skrypt odmawia bez jawnej flagi `UMIEM_SYNTHETIC_SMOKE=1`; nie wywołuje modelu/delivery.

- [x] Test Evening konfigurowanego HTTP clienta: jedno wywołanie przed generacją i retry receipt bez ponownego klienta; błąd/timeout, disabled i Morning nie blokują/nie wykonują odczytu. Sync nie używa tego reportera.
- [x] Test prepared/delivered/unknown receipt, wznowienia execution, limitu4000 i zachowania dzieci/dat/testów/czasu przy kompakcji.
- [x] Nie zmieniono zachowania reportera poza zachowaniem bezpiecznego kodu błędu limitu; nowe asercje regresyjne potwierdzają istniejącą semantykę.
- [x] Pełne Hermes unittest z rzeczywistym rozpakowanym consumer bundle: 134/134, bez skipów nowych testów.
- [x] Cross-language smoke przez prawdziwy Next.js i testowy PostgreSQL z krótkotrwałym tokenem syntetycznym: Python klient zwrócił status/schema/counts bez prywatnych wartości. Native Hermes/host pozostaje niezweryfikowany operacyjnie.
- [ ] Knowli: `test:unit`, `test:integration`, nowe i odpowiednie E2E, `test:mcp`, `contracts:export-learning-overview --check`, `typecheck`, `build`; Hermes: pełne unittest; oba repo: `git diff --check`. Broader full E2E uzasadnione zmianą route/shared limiter; unikaj równoległych konfliktów runnerów.
- [ ] `requesting-code-review`: jeden dedykowany reviewer najmocniejszego dostępnego modelu poza rodziną Astra; pełny diff obu repo od baz z planu całości, spec, oba plany, niescommitowane zmiany, test evidence/odstępstwa. `receiving-code-review`: rozwiąż Critical/Important; odłóż Minor jawnie. Review i poprawki zapisz w dzienniku.
- [ ] Po poprawkach wykonaj odpowiednie regresje i końcową weryfikację, commit wyników/testów. `finishing-a-development-branch`: dopiero na końcu aktualizuj PR #48, jeżeli nadal open dla tej gałęzi; inaczej utwórz PR dla nowej gałęzi. PR opisuje finalny HTTP feature, wyniki i wpływ API -> MCP -> skill -> Hermes. Załącz utworzony/aktualizowany PR do czatu.
- [ ] Hermes bez remote: zachowaj lokalne commity i jawnie zgłoś brak publikacji; nie twórz samodzielnie nowego repo z prywatnymi materiałami. Żadnego merge do main, live tokenu, Coolify deploy lub cron run bez odpowiedniego polecenia właściciela.

## Późniejsze wdrożenie, poza tą implementacją

Po osobnym poleceniu operacyjnym: wdroż zaakceptowany HTTP build Knowli, użyj istniejącej prywatnej bramy HTTPS, skonfiguruj env token w procesach usług, zainstaluj consumer bundle/profile jako service user, potwierdź native initialize/list/call i skill registry bez prywatnego model call. Dopiero naturalny Evening potwierdzi delivery; nie używaj live cron run jako testu.
