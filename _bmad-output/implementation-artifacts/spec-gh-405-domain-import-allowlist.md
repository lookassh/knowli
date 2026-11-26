---
title: 'gh-405: test czystości domeny z białą listą importów pakietowych'
type: 'chore'
created: '2026-11-26'
status: 'done'
baseline_revision: '38fb246982dabd2be148fe69ef180c14272d2903'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      Biała lista dopuszcza cały moduł node:crypto, więc randomUUID/randomBytes przeszłyby mimo zasady jawnie przekazywanej losowości i id.
    evidence: |-
      Domena używa dziś tylko createHash (media-fingerprint, revision-impact, target-key); test sprawdza specyfikator, nie importowane symbole.
    location: >-
      packages/server/src/modules/module-boundaries.architecture.test.ts:96
    severity: medium
  - summary: >-
      Test czystości domeny nie wykrywa użycia process.env ani dynamicznych importów z wyliczanym specyfikatorem.
    evidence: |-
      Skan zbiera tylko literały specyfikatorów; dziś brak takich użyć w produkcyjnych plikach domeny (grep). Ograniczenie zapisane w AGENTS.md.
    location: >-
      packages/server/src/modules/module-boundaries.architecture.test.ts:49
    severity: low
---

<intent-contract>

## Intent

**Problem:** `domainViolations` w `packages/server/src/modules/module-boundaries.architecture.test.ts` pomija każdy specyfikator nie-względny, więc import `drizzle-orm`, `pg` czy SDK providera w `src/domain` przeszedłby niezauważony (poza wąsko chronionym `domain/lessons/agent`).

**Approach:** Specyfikatory pakietowe w domenie są dopuszczane wyłącznie z jawnej białej listy dokładnych nazw, obejmującej dzisiejsze użycia: `@learning/contracts`, `zod`, `node:crypto`. Każdy inny goły specyfikator (też `import type`, re-eksport, dynamiczny `import()`/`require`, podścieżki pakietu z listy) jest naruszeniem.

## Boundaries & Constraints

**Always:** zmiana tylko w teście architektury; dopasowanie dokładne (bez prefiksów); skan rzeczywistych plików domeny pozostaje zielony.

**Never:** zmiany kodu produkcyjnego (chyba że skan wykryje realne naruszenie); lista per plik; nowe zależności.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ORM w domenie | `domain/x.ts`: `import { eq } from "drizzle-orm";` | naruszenie | — |
| sterownik bazy | `domain/x.ts`: `import pg from "pg";` | naruszenie | — |
| import typu | `domain/x.ts`: `import type { Pool } from "pg";` | naruszenie | — |
| podścieżka | `domain/x.ts`: `import { x } from "@learning/contracts/internal";` | naruszenie | — |
| dozwolone | `@learning/contracts`, `zod`, `node:crypto`, `./y`, `../errors` | brak naruszeń | — |
| moduły/baza względnie | `domain/x.ts`: `import { db } from "../db/client";` | naruszenie (istniejąca reguła) | — |

</intent-contract>

## Code Map

- `packages/server/src/modules/module-boundaries.architecture.test.ts:94` -- `domainViolations`; linia 97 `if (!specifier.startsWith(".")) continue;` to luka.
- tamże `:159` -- skan rzeczywistych plików `src/domain` (bez `.test.ts`), używa `specifiersOf` (AST: import/export/import-equals/`import()`/`require`, łącznie z `import type`).
- Dzisiejsze gołe importy domeny (grep + skan AST): `@learning/contracts` (~30 plików), `zod` (`training-session-plan.ts`, `lessons/{calculation,closed-check,evaluate,pool-validation,raw-shape}.ts`), `node:crypto` (`media-fingerprint.ts`, `revision-impact.ts`, `target-key.ts`).
- `packages/server/src/domain/lessons/rules/rules.architecture.test.ts:69` -- osobny strażnik `domain/lessons/agent`; bez zmian.

## Tasks & Acceptance

**Execution:**
- `packages/server/src/modules/module-boundaries.architecture.test.ts` -- dodać `DOMAIN_PACKAGE_ALLOWLIST` i sprawdzać nim gołe specyfikatory w `domainViolations`; dodać `it.each` negatywnych i pozytywnych przypadków domeny z macierzy -- domknięcie strażnika.

**Acceptance Criteria:**
- Given obecna reguła, when uruchomię nowe negatywne przypadki, then padają (RED).
- Given biała lista, when uruchomię `*.architecture.test.ts` w `packages/server`, then wszystkie przechodzą, a skan rzeczywistej domeny jest pusty.
- Given nowy plik domeny z importem pakietu spoza listy, when uruchomię test, then zgłasza naruszenie z nazwą specyfikatora.

## Spec Change Log

## Review Triage Log

### 2026-11-26 — Review pass
- verdicts: 13 findings — high 0, medium 2, low 6, false 5, maybe-false 0
- findings:
  - `medium` `patch` AGENTS.md:70 twierdzi, że test sprawdza tylko importy względne — poprawione zdanie (polityka repo: nowe reguły w dokumentacji ma pierwszeństwo przed regułą skilla o odraczaniu plików agentowych); docs-architecture-drift zielony.
  - `low` `patch` negatywne przypadki asertowały tylko niepusty wynik — dodana kolumna oczekiwanego specyfikatora i `toContainEqual(stringContaining)`.
  - `medium` `defer` node:crypto dopuszcza randomUUID — przedtem dopuszczony był każdy pakiet; zawężenie do symboli to nowa reguła poza intencją.
  - `low` `defer` process.env niewykrywany — poza zakresem importów; dziś brak użyć.
  - `false` `reject` filtr testów `.test.ts` vs `.test.tsx/.spec.ts` — takich plików w domenie brak; gdyby powstały, test głośno pada, co jest poprawnym zachowaniem.
  - `low` `patch` brak wierszy `"crypto"` i `import type` z dozwolonego pakietu — dodane.
  - `low` `defer` dynamiczny import z nie-literałem — istniejące ograniczenie `specifiersOf`, zgrupowane z wpisem process.env.
  - `low` `reject` `declare module "pg"` / `/// <reference types>` — mało prawdopodobne w domenie, poprawka dodaje gałęzie.
  - `false` `reject` „RED liczy 8 zamiast 7” — przebieg RED pokazał 7 padających; `../db/client` świadomie pokrywa starą regułę.
  - `false` `reject` twierdzenie o domknięciu dla dynamicznych importów — to samo co wpis wyżej o nie-literałach (duplikat).
  - `false` `reject` odczyt per plik (B) — intencja mówi o białej liście specyfikatorów; odczyt A spełnia „nowy pakiet wymaga wpisu”.
  - `false` `reject` odczyt C2 (pliki testowe) — istniejący skan świadomie pomija testy, które importują vitest/typescript.
  - `low` `reject` open question o plikach .mts/.js w domenie — sprawdzone: domena ma tylko .ts/.tsx.

## Verification

**Commands:**
- `corepack pnpm vitest run packages/server/src/modules/module-boundaries.architecture.test.ts` -- expected: zielone po zmianie, czerwone negatywne przypadki przed nią.
- `corepack pnpm vitest run packages/server --testNamePattern . ` ograniczone do `*.architecture.test.ts` -- expected: zielone.
- `pnpm check` -- expected: zielone.

## Auto Run Result

- Zmiana: `DOMAIN_PACKAGE_ALLOWLIST` (`@learning/contracts`, `zod`, `node:crypto`, dokładne nazwy) w `domainViolations`; 9 negatywnych i 6 pozytywnych przypadków; poprawione zdanie AGENTS.md.
- Pliki: `packages/server/src/modules/module-boundaries.architecture.test.ts` (reguła + przypadki), `AGENTS.md` (opis strażnika).
- Review: 3 łatki (low/medium), 2 odroczone, 8 odrzuconych z uzasadnieniem w logu.
- followup_review_recommended: false (brak łatek high, jedna medium).
- Weryfikacja: RED — 7 nowych przypadków pada na starej regule; GREEN — plik 34/34, wszystkie `*.architecture.test.ts` w packages/server 107/107, `pnpm check` typecheck+unit zielone (5735 testów), build zielony przy drugim uruchomieniu (pierwsze przerwał `SecurityFatalError` Next 16.4.3, niezależny od zmiany).
- Ryzyko: brak w kodzie produkcyjnym; ograniczenia strażnika w odroczonych.

