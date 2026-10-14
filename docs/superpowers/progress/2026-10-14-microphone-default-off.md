# Postęp: mikrofon domyślnie wyłączony

Zakres: domyślnie wyłączony mikrofon przed startem dowolnego zestawu. Jawne włączenie przełącznikiem przed startem pozwala nagrywać w tej sesji. Bez zmian API, DTO, bazy ani reguł uczenia.

## Checklista workflow

- [x] Sprawdzono aktualny stan Git, istniejący worktree oraz zakres kontrolera Kid UI.
- [x] Sprawdzono i zastosowano dostępne skillsy Superpowers z cache wtyczki: brainstorming (zakres bounded i wybór globalnego defaultu), test-driven-development (RED→GREEN), requesting-code-review, verification-before-completion i finishing-a-development-branch. Początkowe sprawdzenie tylko katalogu głównego skills nie znalazło ich; później odnaleziono je w plugin cache.
- [x] Uzgodniono zakres z właścicielem: domyślnie wyłączony we wszystkich zestawach, włączenie przed startem pozostaje dostępne.
- [x] Sprawdzono istniejące `node_modules`; katalogu brakowało. Skrypt worktree skopiował `.env` i wykonał `corepack pnpm install --prefer-offline --frozen-lockfile`.
- [x] Baseline: `corepack pnpm vitest run packages/kid-ui/src/session/session-controller.test.ts --config vitest.unit.config.ts` — 45/45 GREEN.
- [x] TDD RED: nowy test zaobserwował `microphone: true` zamiast oczekiwanego `false` (1 failed, 45 passed).
- [x] Minimalna zmiana implementacji i GREEN: kontroler uruchamia nowe sesje z `microphoneEnabled=false` domyślnie; istniejący przełącznik nadal pozwala włączyć mikrofon przed startem.
- [x] Celowany test kontrolera: 46/46 GREEN.
- [x] Wszystkie testy jednostkowe Kid UI: 18 plików, 166/166 GREEN.
- [x] Pełny `corepack pnpm test:unit` — 107 plików, 1067/1067 GREEN.
- [x] Pełny `corepack pnpm test:integration` — 37 plików, 361/361 GREEN.
- [x] Pełny `corepack pnpm typecheck` — GREEN.
- [x] Pełny `corepack pnpm build` — GREEN.
- [x] `corepack pnpm exec tsc --noEmit -p packages/kid-ui/tsconfig.json` — GREEN.
- [x] Celowane E2E: `kid-decks-layout.spec.ts` i trzy ścieżki z `kid-flow.spec.ts` — 4/4 GREEN.
- [x] Pełny `corepack pnpm exec playwright test` — 166/166 GREEN (7 min).
- [x] `git diff --check` — GREEN.
- [x] Niezależny review całego diffu przez recenzenta (`gpt-6.1-sol`, poza Astra) — No findings.

## Dowody i decyzje

- Użytkownik zlecił push gałęzi i PR do `main`; bazą jest `origin/main` SHA `6faf2793d21e8cf98dcbd7cc655ccebc008393f6`.
- Pełny lokalny zestaw E2E zakończył się wynikiem 166/166; CI PR będzie sprawdzone po utworzeniu PR.
- Wykonane E2E obejmują start domyślny, sesję mowy z opt-in, odmowę uprawnienia oraz zamknięcie nagrywania przy wyjściu.
- Review wskazał, by nie wykluczać PR wyłącznie ze względu na mały zakres; dziennik poprawiono tak, by odzwierciedlał niewykonany workflow i jego przyczynę.
