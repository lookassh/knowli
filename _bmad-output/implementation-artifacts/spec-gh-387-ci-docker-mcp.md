---
title: 'CI buduje obrazy Dockera (web, worker) i uruchamia konsumenckie testy MCP'
type: 'chore'
created: '2026-11-26'
status: 'done'
baseline_revision: '9dc0d5b4376a66b776bf3b9e3da7f6b206a67833'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      Dryf packages/contracts -> docs/integrations/learning-overview.schema.json nie jest pilnowany testem w CI.
    evidence: |-
      Brak testu porównującego eksport contracts:export-learning-overview z docs; test:mcp porównuje tylko kopię konsumenta z docs.
    severity: low
---

<intent-contract>

## Intent

**Problem:** CI (`.github/workflows/ci.yml`) buduje web wyłącznie `pnpm build` poza Dockerem, więc układ standalone (`NEXT_STANDALONE=1` tylko w `deploy/Dockerfile`) i target `worker` nie są ćwiczone na PR; konsumencka kopia schematu i walidator Pythona Hermesa (`pnpm test:mcp`) nie biegną w CI wcale.

**Approach:** Dodać do `ci.yml` job `docker` (matrix `target: [web, worker]`, buildx bez push, cache GHA per target) oraz job `mcp` uruchamiający `pnpm test:mcp` przez `uv`.

## Boundaries & Constraints

**Always:** konwencje `ci.yml` — `actions/checkout` przypięty SHA z `persist-credentials: false`, `pnpm/action-setup` po SHA, `actions/setup-node@v7` z Node 22, `timeout-minutes`, polskie komentarze; akcje zewnętrzne (docker, astral) przypięte SHA z komentarzem wersji; `permissions: contents: read` (dziedziczone).

**Never:** push obrazu, logowanie do rejestru, zmiana `deploy/Dockerfile`, zmiana rulesetu/wymaganych checków, zmiana kontraktu MCP; nie dopinać nowych jobów do bramki `tests` (to zmienia znaczenie wymaganego checka — decyzja właściciela).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | PR z niezmienionym Dockerfile i kopią schematu | `docker (web)`, `docker (worker)`, `mcp` zielone | — |
| BROKEN_DOCKERFILE | błędna instrukcja w targecie worker/web | odpowiedni job `docker (...)` czerwony | build buildx kończy się błędem |
| SCHEMA_DRIFT | kopia `integrations/umiem-mcp/src/umiem_mcp/learning-overview.schema.json` ≠ `docs/integrations/learning-overview.schema.json` | job `mcp` czerwony | `unittest` zgłasza failure |

</intent-contract>

## Code Map

- `.github/workflows/ci.yml` -- jedyny workflow; wzorce kroków w jobie `check` (l. 36–68); nagłówek-komentarz opisuje joby.
- `deploy/Dockerfile` -- targety `web` (standalone Next) i `worker` (tsx + prod deps); tylko do odczytu.
- `package.json:14` -- `test:mcp` = `uv sync --locked ... && uv run ... python -m unittest discover`; nie wymaga `pnpm install`.
- `integrations/umiem-mcp/tests/test_umiem_contract.py:81` -- porównanie kopii schematu z `docs/integrations/...` (detektor dryfu).
- `integrations/umiem-mcp/tests/test_consumer_release.py` -- wymaga repo git (sourceCommit HEAD).
- `tests/ci-matrix.ts` -- parser sekcji jobów ci.yml (nagłówki `  <job>:`); nowe joby muszą mieć tę samą formę.
- `docs/architecture.md:392` -- opis CI; dopisać nowe joby i to, że nie są wymagane.

## Tasks & Acceptance

**Execution:**
- `.github/workflows/ci.yml` -- dodać joby `docker` i `mcp`, zaktualizować komentarz nagłówka -- kryterium #387.
- `docs/architecture.md` -- jedno zdanie o jobach `docker (web|worker)` i `mcp` (niewymagane) -- dokumentacja zgodna z CI.

**Acceptance Criteria:**
- Given PR do main, when CI startuje, then biegną joby `docker (web)`, `docker (worker)` i `mcp` i są zielone na niezmienionym kodzie.
- Given celowo zepsuty Dockerfile lub kopia schematu, when lokalnie `docker build --target ...` / `pnpm test:mcp`, then polecenie kończy się błędem (dowód RED, niezacommitowany).

## Review Triage Log

### 2026-11-26 — Review pass
- verdicts: 17 findings — high 0, medium 1, low 5, false 6, maybe-false 0 (+5 rejected out-of-intent descriptive points)
- findings:
  - `[false]` `[reject]` (intent) Gating reading: jobs not required — intent/koordynator: nie zmieniać rulesetu, zaproponować w PR.
  - `[false]` `[reject]` (intent) Runtime smoke (obraz nie jest uruchamiany) — intent mówi „docker build”; brakujący standalone/target i tak barwi build (RED lokalnie).
  - `[low]` `[defer]` (intent) Dryf `packages/contracts` → `docs/integrations/learning-overview.schema.json` niepilnowany testem — istniejąca luka, poza zakresem; follow-up w PR.
  - `[false]` `[reject]` (intent) Brak dowodu uruchomienia — RED/GREEN lokalnie udokumentowane niżej, CI na PR.
  - `[false]` `[reject]` (intent) setup-node bez SHA — konwencja pliku.
  - `[false]` `[reject]` (edge) docker (web) bez DATABASE_URL — lokalny `docker build --target web` przeszedł (exit 0).
  - `[medium]` `[patch]` (edge+blind) cache-to mode=max na każdym PR wypiera 10 GB cache GHA, błąd eksportu barwi build — zapis tylko na push do main, `ignore-error=true`.
  - `[low]` `[reject]` (edge+blind) Python niepinowany — uv.lock + requires-python>=3.11; dryf runnera mało prawdopodobny, dodatkowa konfiguracja.
  - `[false]` `[reject]` (edge) Claim „zielone” bez runu — lokalnie zielone, CI na PR.
  - `[low]` `[reject]` (blind) Obraz nie uruchamiany — jak wyżej (intent).
  - `[low]` `[reject]` (blind) Zepsuty Dockerfile może trafić na prod — decyzja właściciela; pytanie w opisie PR.
  - `[low]` `[reject]` (blind) Brak testu strażnika needs bramek — nadmiarowe.
  - `[low]` `[patch]` (blind) Brak lokalnych odpowiedników w docs/agents/testing.md — dopisano linię.
  - `[low]` `[patch]` (blind) Zbędny setup-node w mcp — usunięty.
  - `[low]` `[patch]` (blind) Komentarz mcp wylicza zawartość testów — skrócony.
  - (verification-gap) brak luk.

## Design Notes

Przypięte akcje (zweryfikowane `gh api`, 2026-11-26):
- `docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1`
- `docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0`
- `astral-sh/setup-uv@68559e99cc807c1eb7e9238fd43a15bba460eec2 # v10.3.3` (`enable-cache: true`, `cache-dependency-glob: integrations/umiem-mcp/uv.lock`)

Job `docker`: nazwa `docker (${{ matrix.target }})`, `fail-fast: false`, `context: .`, `file: deploy/Dockerfile`, `push: false`, cache `type=gha` ze `scope` per target. Job `mcp`: checkout + pnpm/setup-node jak w `check` (bez `cache: pnpm` i bez `pnpm install` — skrypt nie potrzebuje node_modules) + setup-uv, potem `pnpm test:mcp`.

## Verification

**Commands:**
- `pnpm test:mcp` -- expected: OK (8 testów)
- `docker build -f deploy/Dockerfile --target web .` oraz `--target worker` -- expected: sukces
- `corepack pnpm vitest run tests/e2e/spec-projects.test.ts tests/integration-buckets.test.ts` -- expected: parser ci.yml nadal zielony
- po pushu `gh pr checks` -- expected: nowe joby zielone

## Auto Run Result

Status: done
- Zmiana: `.github/workflows/ci.yml` — joby `docker (web|worker)` (buildx, bez push, cache GHA czytany zawsze, zapisywany tylko na main) i `mcp` (`pnpm test:mcp` przez uv); `docs/architecture.md`, `docs/agents/testing.md` — opis i lokalne odpowiedniki.
- Patche: 1 medium, 3 low. Deferred: dryf contracts→docs (low). Odrzucone: patrz triage.
- Weryfikacja: `pnpm test:mcp` OK (8); RED: zepsuta kopia schematu → exit 1; `docker build --target web|worker` OK lokalnie; RED: zepsuty Dockerfile (worker `RUN test -f` brak pliku, web brak `.next/standalone-missing`) → exit 1; parser ci.yml 54/54.
- Ryzyka: pierwszy run CI (gha cache, pnpm/action-setup bez setup-node).
- followup_review_recommended: false (brak high, 1 medium).
