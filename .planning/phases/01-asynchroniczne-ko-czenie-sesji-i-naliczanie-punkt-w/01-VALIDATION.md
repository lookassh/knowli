---
phase: "01"
slug: "asynchroniczne-ko-czenie-sesji-i-naliczanie-punkt-w"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-21"
---

# Faza 1 — strategia walidacji

> Kontrakt walidacji dla asynchronicznego kończenia sesji i naliczania punktów.

## Infrastruktura testowa

| Właściwość | Wartość |
|---|---|
| Framework | Vitest 4.1.11 oraz Playwright |
| Konfiguracja | `vitest.unit.config.ts`; konfiguracja E2E projektu |
| Szybki zestaw | `corepack pnpm vitest run --config vitest.unit.config.ts packages/server/src/modules/session-activity.test.ts packages/server/src/modules/sessions.test.ts packages/kid-ui/src/api/client.test.ts packages/kid-ui/src/session/session-controller.test.ts packages/kid-ui/src/screens/reward-summary.test.tsx apps/web/src/kid/kid-router.test.ts` |
| Pełne sprawdzenia | `corepack pnpm test:unit` oraz `corepack pnpm typecheck`; E2E: `corepack pnpm playwright test tests/e2e/kid-activity-lifecycle.spec.ts` |
| Szacowany czas | Szybki zestaw celowany: poniżej 30 s (szacunek, niezmierzony); E2E zależy od przygotowania środowiska |

## Częstotliwość próbkowania

- Po każdym zadaniu testowym: uruchomić jego celowany zestaw z wiersza poniżej.
- Po każdej fali: uruchomić pełne sprawdzenia jednostkowe i typecheck.
- Przed `$gsd-verify-work`: pełny zestaw odpowiedni dla zmian ma być zielony.
- Maksymalna latencja celowanej informacji zwrotnej: 30 s.

## Mapa weryfikacji zadań

| Zadanie | Plan | Fala | Wymaganie | Zagrożenie | Bezpieczne zachowanie | Typ | Polecenie | Plik istnieje | Status |
|---|---|---:|---|---|---|---|---|---|---|
| 01-01-01 | 01-01 | 1 | ASYNC-01, ASYNC-03 | T-01-01, T-01-02 | Jedna ocena i atomowe punkty; prywatny payload | unit | `corepack pnpm vitest run --config vitest.unit.config.ts packages/server/src/modules/session-activity.test.ts packages/server/src/modules/sessions.test.ts` | Tak | ⬜ pending |
| 01-02-01 | 01-02 | 2 | ASYNC-04 | T-01-03, T-01-04 | Autoryzowany odczyt, UUID, no-store, publiczne DTO, bez skutków ubocznych | HTTP + unit | `corepack pnpm vitest run --config vitest.unit.config.ts apps/web/src/kid/kid-router.test.ts packages/kid-ui/src/api/client.test.ts packages/server/src/modules/session-activity.test.ts` | Częściowo; test routera utworzy zadanie 01-02 | ⬜ pending |
| 01-03-01 | 01-03 | 3 | ASYNC-02, ASYNC-03 | T-01-05, T-01-06, T-01-07 | Odtworzenie tylko minimalnego identyfikatora i właściwego profilu; jeden timer | unit | `corepack pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/session/activity-draft-store.test.ts packages/kid-ui/src/session/session-controller.test.ts` | Tak | ⬜ pending |
| 01-04-01 | 01-04 | 4 | ASYNC-01, ASYNC-02, ASYNC-04 | T-01-08, T-01-09, T-01-10 | UI nie blokuje; brak ujawnienia danych oceny i brak ekspozycji punktów przez MCP | unit + E2E | `corepack pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/screens/reward-summary.test.tsx`; `corepack pnpm playwright test tests/e2e/kid-activity-lifecycle.spec.ts` | Tak | ⬜ pending |

## Wymagania fali 0

Istniejąca infrastruktura obejmuje wszystkie wymagania; plan 01-02 tworzy brakujący test routera w ramach zadania RED przed dodaniem trasy. Nie instalować nowego frameworka ani zależności.

## Weryfikacje ręczne

| Zachowanie | Wymaganie | Dlaczego ręczne | Kroki |
|---|---|---|---|
| Brak | — | Wszystkie zachowania tej fazy mają zaplanowane testy automatyczne; zgodność mowy i urządzeń nie jest zmieniana w tym zakresie. | — |

## Podpis walidacji

- [ ] Każde zadanie ma automatyczne sprawdzenie.
- [ ] Ciągłość próbkowania: brak trzech kolejnych zadań bez automatycznej weryfikacji.
- [x] Nowe braki testów mają jawne zadanie RED; nie wymagają osobnej fali 0.
- [ ] Polecenia nie używają trybu watch.
- [ ] `nyquist_compliant: true` po wykonaniu i walidacji.

**Akceptacja:** oczekuje na wykonanie fazy.
