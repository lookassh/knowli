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

- [ ] Przypnij prywatne zależności w requirements zgodnie z Global Constraints; zainstaluj do lokalnego odizolowanego katalogu testowego/runtime-deps. Nie modyfikuj globalnego SDK/OAuth Hermesa.
- [ ] Przepisz obecny test stdio na rzeczywisty syntetyczny HTTP MCP server z przypiętym SDK Python; server rejestruje dokładnie jedno tool i zlicza initialize/list/call. Test już nie wymaga zmiennej `UMIEM_MCP_SOURCE` ani uruchomionego adaptera; bundle A4 wskazuje `UMIEM_CONSUMER_SOURCE`.

```python
overview = McpLearningClient(config).fetch(days=7, upcoming_test_days=14)
self.assertEqual(overview["schemaVersion"], 1)
self.assertEqual(overview["children"][0]["learningTime"]["seconds"], 1980)
self.assertEqual(server.tool_calls, [("umiem_get_learning_overview", {"days": 7, "upcomingTestDays": 14})])
```

- [ ] Testy fail-closed: brak token env, `${env:UMIEM_READ_TOKEN}` wspierane; HTTPS wymagane; loopback tylko jawnie w tests; old stdio-only config odrzucony jako niedostępny, bez automatycznego fallbacku. Przy `enabled=false` zero requestów, zero importów bundle wymagających pliku.
- [ ] Testy redirect: synthetic307 same-origin i cross-origin, 308, 302 -> unavailable i zero requestów do celu. Hook musi zatrzymać także samodzielną logikę SDK, nie tylko HTTPX follow_redirects.
- [ ] Testy HTTP401/403/429/503, isError, unsupported schema, uszkodzony fixture, brak/mismatch bundle, malformed JSON, >4MiB streaming bez Content-Length oraz >2MiB DTO -> LearningUnavailable. Nie zwracaj stale data ani pustej rodziny.
- [ ] Captured logs/stdout/stderr i str(exception) nie zawierają synthetic tokenu, imion/treści z nieprawidłowej odpowiedzi. Nie polegaj na samym try/except, jeżeli SDK zalogował payload wcześniej; skonfiguruj odpowiednie loggery klienta i httpx dla tego procesu bez zmiany innych integracji.
- [ ] Powolny initialize/call/cleanup -> błąd w granicy30s (w teście wstrzyknij krótszy timeout), socket i task zamknięte. StructuredContent preferowane, zgodny text JSON fallback walidowany identycznie.
- [ ] RED: `python -m unittest discover -s tests -p 'test_family_learning*.py'` w testowym środowisku z bundle; zapisz oczekiwane niepowodzenie nowej ścieżki, nie skip/import error.
- [ ] Zaimplementuj HTTP helper oraz `_fetch`: `async with http_client`, `async with streamable_http_client(url,http_client=http_client,terminate_on_close=False)`, `ClientSession`, initialize, jedno call_tool, walidacja. Brak server-side session oznacza brak DELETE w cleanup. Utrzymaj istniejące bezpieczne kody błędu.
- [ ] GREEN: oba nowe zestawy i istniejące learning context/report tests; commit `feat: read Umiem MCP through Streamable HTTP`.

### B2: Profil i instalator konsumenta bez adapter venv

**Files:** Modify `school-agent/scripts/family_notes_profile.py`, `tests/deploy_family_notes.py`, `tests/test_deploy_family_notes.py`, `tests/test_family_notes_contract.py`; Modify `school-agent/UMIEM-INTEGRATION.md`, `school-agent/AGENTS.md`, repo `AGENTS.md`, `school-agent/MARKDOWN-DEPLOYMENT.md`.

**Interfaces:** `family_profile_config(..., umiem=None)` zachowuje argumenty bazowe; HTTP options: `{mcp_url:str, consumer_root:str}`. `prepare(..., umiem=...)` przyjmuje `{mcp_url, consumer_release_root}`. CLI `--umiem-mcp-url` + archive `stage/umiem-consumer-release`, bez `--umiem-base-url`/`--umiem-token-file` dla nowej ścieżki. Pozostałe tryby instalatora zachowują zgodność. Stare opcje prowadzą do jasnego komunikatu migracyjnego, nie tworzą pozornie poprawnego profilu HTTP.

Manifest instalacji Umiem!: transport=`streamable-http`, mcp_url, consumer_commit i mapy SHA z A4, nigdy token/rozwinięte headers. Instalacja do `school-agent/umiem/consumers/<sourceCommit>`; skill do istniejącego `school-agent/skills/umiem-learning/SKILL.md`.

- [ ] RED: profil bez umiem identyczny z baseline; HTTP wariant ma toolset `mcp-umiem`, URL i header placeholder, `learning.consumer_root`; brak command/args/adapter_root/token bytes. Root profile i inne MCP pozostają identyczne.
- [ ] Test pełnego `prepare -> install -> activate -> verify` na fake-root z prawdziwym rozpakowanym bundle A4 i prywatnym dependency staging: import walidatora działa, skill/manifest zgodne, nie wykonano `uv sync`/subprocess adaptera. Potwierdź zachowanie niezależnej konfiguracji, owner/mode i post-write hash.
- [ ] Test niezgodności SHA/schema/skill, symlink/private files w archive, zmiany config przed install i po write przed activate -> odmowa. Wyłączenie learning nie usuwa nowych receipt ani innych skill/MCP.
- [ ] Dokumentacja `UMIEM-INTEGRATION.md` kopiowana do workdir, aby odnośnik z zainstalowanego AGENTS działał; test fake-root sprawdza plik. Nie przenoś źródłowego adaptera stdio do nowego consumer directory.
- [ ] Usuń martwe ścieżki stdio z klienta/profilu/instalatora: command/args/env adaptera, adapter_root, wyszukiwanie interpretera/site-packages, subprocess, uv sync i instalację pełnego source release. W aktywnej dokumentacji jest jeden wariant HTTP. Nie usuwaj niczego z live hosta podczas lokalnej implementacji; ewentualne późniejsze sprzątanie instalacji jest ograniczone jej manifestem i następuje po potwierdzeniu HTTP.
- [ ] Weryfikacja CLI operacyjna sprawdza jedynie obecność referencji/środowiska, nie wypisuje sekretu. Nie zapisuj rozwiniętej konfiguracji/środowiska w backupie/manifestach/logu; istniejące sekrety innych integracji zachowują dotychczasowe granice dostępu.
- [ ] Implementacja minimalnych zmian profilu/installer; README opisuje URL `/api/mcp`, `${UMIEM_READ_TOKEN}`, źródło env wspólne dla native i reportera oraz restart/reconnect po rotacji.
- [ ] GREEN: `python -m unittest discover -s tests -p 'test_deploy_family_notes.py'` i `python -m unittest discover -s tests -p 'test_family_notes_contract.py'`. Selektywny commit `feat: install HTTP Umiem consumer profile and contract bundle`.

### B3: Report regresje, cross-language smoke i końcowy review

**Files:** Modify `tests/test_family_notes_reports.py` tylko gdy potrzebne nowe integracyjne asercje; Create `tests/smoke_umiem_http.py`; dzienniki postępu i dokumentacja z wynikami bez prywatnych payloadów.

**Interfaces:** `smoke_umiem_http.py --url <test-endpoint> --consumer-root <bundle>` zużywa token syntetyczny z env, wywołuje ten sam McpLearningClient co produkcyjny reporter i wypisuje tylko status/schemaVersion/liczby dzieci/dni. Skrypt odmawia bez jawnej flagi `UMIEM_SYNTHETIC_SMOKE=1`; nie wywołuje modelu/delivery.

- [ ] Test Evening z HTTP client: dokładnie jedno tools/call przed generacją, schema/metryki OK; isError/timeout -> unavailable i szkolny raport nadal powstaje; disabled ->disabled. Morning i Sync ->zero calls.
- [ ] Test prepared/delivered/unknown receipt i wznowienie istniejącego execution ->zero dodatkowych calls i brak nowego prywatnego magazynu danych. Sprawdź budżet4000 i zachowanie dzieci/dni/tests/learningTime przy kompaktowaniu.
- [ ] RED wymagany tylko gdy dodawane jest nowe zachowanie raportera. Jeśli dotychczasowy kod spełnia test, zapisz regresję bez sztucznego psucia go.
- [ ] Uruchom pełne Hermes unittest w izolowanym środowisku z rozpakowanym consumer bundle. Nie zaakceptuj skipów nowego HTTP clienta jako potwierdzenia kompatybilności.
- [ ] Uruchom cross-language smoke: prawdziwy Next.js z testową bazą i syntetycznym tokenem z A3 -> Python klient B1. Wynik ma przejść ten sam schema/semantykę co REST i TS client. Dostęp do aktualnego native Hermes oraz loadera profilu/skill na hoście zapisuj jako niezweryfikowany do etapu operacyjnego.
- [ ] Knowli: `test:unit`, `test:integration`, nowe i odpowiednie E2E, `test:mcp`, `contracts:export-learning-overview --check`, `typecheck`, `build`; Hermes: pełne unittest; oba repo: `git diff --check`. Broader full E2E uzasadnione zmianą route/shared limiter; unikaj równoległych konfliktów runnerów.
- [ ] `requesting-code-review`: jeden dedykowany reviewer najmocniejszego dostępnego modelu poza rodziną Astra; pełny diff obu repo od baz z planu całości, spec, oba plany, niescommitowane zmiany, test evidence/odstępstwa. `receiving-code-review`: rozwiąż Critical/Important; odłóż Minor jawnie. Review i poprawki zapisz w dzienniku.
- [ ] Po poprawkach wykonaj odpowiednie regresje i końcową weryfikację, commit wyników/testów. `finishing-a-development-branch`: dopiero na końcu aktualizuj PR #48, jeżeli nadal open dla tej gałęzi; inaczej utwórz PR dla nowej gałęzi. PR opisuje finalny HTTP feature, wyniki i wpływ API -> MCP -> skill -> Hermes. Załącz utworzony/aktualizowany PR do czatu.
- [ ] Hermes bez remote: zachowaj lokalne commity i jawnie zgłoś brak publikacji; nie twórz samodzielnie nowego repo z prywatnymi materiałami. Żadnego merge do main, live tokenu, Coolify deploy lub cron run bez odpowiedniego polecenia właściciela.

## Późniejsze wdrożenie, poza tą implementacją

Po osobnym poleceniu operacyjnym: wdroż zaakceptowany HTTP build Knowli, użyj istniejącej prywatnej bramy HTTPS, skonfiguruj env token w procesach usług, zainstaluj consumer bundle/profile jako service user, potwierdź native initialize/list/call i skill registry bez prywatnego model call. Dopiero naturalny Evening potwierdzi delivery; nie używaj live cron run jako testu.
