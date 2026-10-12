# Umiem! MCP Streamable HTTP — plan całości

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Udostępnić MCP Umiem! pod URL HTTPS z tokenem Bearer i używać go w rodzinnym raporcie Hermesa bez lokalnego serwera stdio.

**Architecture:** Endpoint `/api/mcp` działa w istniejącym `apps/web` i wywołuje ten sam przypadek użycia co REST. Hermes używa Streamable HTTP; wersjonowany pakiet konsumenta dostarcza wyłącznie walidację i skill.

**Tech Stack:** Next.js/Node.js/TypeScript, MCP TS SDK 1.32.1, Zod 4, Vitest/PostgreSQL/Playwright; Python MCP 1.30.0/httpx, unittest, prywatne runtime-deps.

**Spec:** [Projekt HTTP](../specs/2026-10-12-umiem-mcp-streamable-http-design.md).

## Status, tryb i lokalizacja

- [x] Uzgodniony kierunek: MCP Streamable HTTP wewnątrz `apps/web`.
- [x] Inspekcja bieżących źródeł, SDK i oficjalnej konfiguracji Hermesa.
- [x] Lokalna specyfikacja i dwa zależne plany wykonawcze; przegląd własny dokumentów.
- [ ] Przegląd i akceptacja dokumentów przez właściciela przed implementacją HTTP.
- [ ] Wykonanie inline przez bieżącego agenta, zgodnie z dotychczasowym trybem; brak zgody na delegację implementacji.
- [ ] Niezależny końcowy review całego zakresu przez najmocniejszy dostępny model spoza GPT Astra, obsługa uwag i końcowa weryfikacja.
- [ ] PR z ukończoną implementacją; scalanie przez właściciela, Squash and merge.

Knowli: `C:/Users/looka/.codex/worktrees/hermes-mcp-contract-docs/knowli`, baza planu `fa2fcb6d485472505f7cbedc6a63670635850450`. Hermes: `C:/Users/looka/.codex/worktrees/hermes-umiem-reports/Hermes-szkola`, baza `48fc60f8e5989041928cd70c6c5287078af48153`. Przed wykonaniem ponownie sprawdź HEAD/status/PR #48: jeśli gałąź została scalona, dobierz nową bazę i worktree, zamiast nadpisywać nowe main. Hermes nie ma obecnie remote; jego publikacja wymaga istniejącego zdalnego repo albo jawnie wskazanego miejsca, lokalny commit nie jest PR.

## Global Constraints

- Wszystkie ograniczenia liczbowe i granice specyfikacji obowiązują obie części planu; dokumenty nie uprawniają do live wdrożenia.
- `/api/mcp`, runtime Node.js, JSON/stateless/per-request; HTTPS + `learning:read`, bez cookie auth i sesji MCP.
- Narzędzie `umiem_get_learning_overview`; days 1–31/default 7, upcomingTestDays 1–90/default 14, opcjonalny UUID childId; `schemaVersion: 1`.
- Body 16 KiB; DTO 2 MiB; pełne HTTP 4 MiB; rate 60 requests/token/60 s/process; reporter 30 s całość, HTTP 10 s, kontekst 4000 tokenów.
- Bez mikroserwisu, Redis, migracji bazy, OAuth, zmiany reguł uczenia, prywatnych fixtures i nowych wywołań modeli.
- Nie zmieniaj ukończonych dzienników/planów A/B/C tak, aby wyglądały na pierwotnie HTTP. Nowy dziennik opisuje rzeczywistą migrację.
- Docelowo tylko Streamable HTTP: usuń poprzedni serwer stdio i jego instalację/konfigurację, zachowaj REST API, DTO, walidację semantyczną, skill i logikę raportów. Nie zostawiaj opcjonalnego drugiego wariantu MCP.
- Nie commituj/pushuj samych tych dokumentów. Materiały wejdą do końcowego PR implementacji po review.

## Review Focus

1. Ten sam JSON-RPC id u równoległych klientów: brak mieszania principal, tokenu lub payloadu — część A, zadanie A2.
2. Odwołany token po initialize i wspólny limit REST/MCP: następna operacja blokowana, każde HTTP liczone raz — A2/A3.
3. Brak Content-Length, JSON batch lub nieznany Origin: limit/odmowa przed pracą domenową — A2.
4. Redirect 307/308 i nieustawiona zmienna sekretu: brak przekazania tokenu i brak pustego sukcesu — B1.
5. Wznowienie Evening, disabled oraz drift instalatora: brak drugiego tools/call i brak nadpisania nowej konfiguracji — B2/B3.

## Kolejność

1. [Część A — serwer HTTP i pakiet konsumenta](2026-10-12-umiem-mcp-http-server.md): A1 → A2 → A3 → A4.
2. [Część B — Hermes przez HTTP](2026-10-12-hermes-umiem-http-client.md): B1 → B2 → B3, po ustaleniu endpointu/narzędzia z A i formatu bundle z A4. Testy B mogą używać syntetycznego serwera MCP; końcowy smoke łączy faktyczne A i B.
3. Końcowe sprawdzenia obu części, jeden niezależny review całości, poprawki i końcowa publikacja implementacji. Nie dodawaj reviewerów po każdym zadaniu inline.

## Kryteria ukończenia implementacji

- [ ] Standardowy klient TS i przypięty klient Python wykonują initialize/list_tools/call_tool na rzeczywistym Next.js; lista zawiera dokładnie jedno narzędzie, wynik przechodzi kontrakt.
- [ ] Brak tokenu, odwołanie, brak scope, rate limit, niewłaściwy Origin, błędne RPC, rozmiar i awaria bazy mają sprawdzone odpowiedzi.
- [ ] REST zachowuje publiczny kontrakt; MCP nie wymaga nowego kontenera, portu ani migracji.
- [ ] Hermes native config używa url/headers; reporter HTTP nie uruchamia lokalnego MCP i zachowuje Evening/Morning/Sync oraz receipt guardy.
- [ ] Nie ma executable entry point stdio, serwera/clienta REST w Python adapterze, starego release serwera ani aktywnych instrukcji instalacji stdio; testy kontraktu przeniesiono i zachowano.
- [ ] Pełny smoke instalatora obejmuje rozpakowany consumer bundle, import walidatora, hash skilla i profil fake-root; brak adapter venv.
- [ ] Istniejące testy adekwatne do zmian, schema export check, typecheck/build i diff check mają aktualne dowody; niestabilność środowiska nie jest raportowana jako wynik produktu.
- [ ] Dokumentacja/AGENTS.md wyjaśniają nowe źródła: HTTP adapter w apps/web, kontrakty w packages/contracts, skill/walidator/release w integrations/umiem-mcp.
- [ ] Niezależny reviewer obejmuje pełny diff Knowli i Hermes wraz z niezacommitowanymi zmianami; Critical/Important rozwiązane, Minor odłożone z uzasadnieniem.

Live dostępność API/MCP w Coolify, wersja Hermesa na hoście, native skill i naturalny Evening są późniejszym etapem operacyjnym, nie dowodem uzyskanym przez ten plan.

## Dziennik wykonania i samokontrola planu

Przy wykonaniu załóż `2026-10-12-umiem-mcp-http-progress.md` w Knowli i powiązany dziennik w Hermes; użyj workspace/task-start/task-done/review-package z `executing-plans` lub udokumentowanych odpowiedników dla Windows. Zapisuj RED/GREEN, zakresy commitów, faktyczne wyniki i odstępstwa. Kompakcja nie resetuje postępu.

Przegląd własny: każdy wymóg specyfikacji ma zadanie A/B; oba plany używają tej samej nazwy tool, limitów, consumer_root i env; każdy Review Focus ma przypisane testy; nie ma zgody na implementację/deploy ukrytej w statusie. Testy aplikacji nie były uruchamiane podczas samego planowania.
