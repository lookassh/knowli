---
title: 'gh-242: puste stany panelu rodzica z następnym krokiem; prawdziwy komunikat w Postępach'
type: 'bugfix'
created: '2026-11-26'
status: 'done'
baseline_revision: '38fb246982dabd2be148fe69ef180c14272d2903'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/docs/agents/testing.md']
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Puste Zestawy, Źródła i Karta pracy pokazują sam tekst bez działania, a Postępy pokazują ten sam komunikat „brak opublikowanych zestawów” także rodzicowi bez profili dzieci (fałszywa diagnoza).

**Approach:** Postępy rozróżniają przyczynę (brak dzieci przed brakiem zestawów, zachowany wariant „same lekcje”) i każdy pusty stan dostaje jeden przycisk CTA (Mantine `Button`) prowadzący istniejącą nawigacją panelu do działania, które go usuwa.

## Boundaries & Constraints

**Always:** teksty w `messages.ts` (sekcje parent: `progress`, `decks`, `sources`, `workCard`); nawigacja przez istniejące `onNavigate`/`navigate` (leave guard); kolejność diagnozy: dziecko → materiał.

**Never:** nie ruszaj sekcji `kid` w `messages.ts`; bez zmian API/DTO; bez nowej checklisty pierwszych kroków (opcjonalna — pominięta, opisana w PR); bez zmian `ChildEditor` (pusty stan już ma formularz dodawania na tej samej stronie).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Brak dzieci | children=[], dowolne decks | Postępy: „Nie masz jeszcze profilu dziecka…”, CTA „Dodaj dziecko” → sekcja Dzieci | — |
| Brak zestawów | children≥1, brak opublikowanych słówek i lekcji | Postępy: komunikat o zestawach, CTA → Zestawy | — |
| Same lekcje | children≥1, tylko opublikowane lekcje | dotychczasowy `lessonsOnly`, CTA → Zestawy | — |
| Pusta lista zestawów | decks=[] | tekst + CTA „Nowy materiał” otwiera dialog nowego materiału | — |
| Puste źródła | sources=[] | tekst + CTA „Nowe źródło” otwiera dialog | — |
| Karta pracy bez dzieci | children=[] | tekst + CTA „Dodaj dziecko” → Dzieci | — |

</intent-contract>

## Code Map

- `apps/web/src/parent/ProgressPanel.tsx:229-238` -- warunek `childrenList.length === 0 || published.length === 0`; dodać prop `onNavigate(section)`.
- `apps/web/src/parent/ParentApp.tsx:218,222` -- przekazać `onNavigate` do ProgressPanel i WorkCardPanel (`navigate({ section })`).
- `apps/web/src/parent/DecksPanel.tsx:512` -- pusty stan; `openNewMaterial` już istnieje.
- `apps/web/src/parent/sources/SourcesPanel.tsx:203` -- pusty stan; `setDialogOpen(true)`.
- `apps/web/src/parent/WorkCardPanel.tsx:229-236` -- pusty stan bez dzieci.
- `packages/contracts/src/messages.ts` -- `progress.empty` (l.314), `decks.empty` (l.116), `sources`, `workCard.emptyChildren` (l.462).
- `tests/e2e/progress-panel.spec.ts` -- wzorzec route-mock (`mocked` w `spec-projects.ts:77`); test „same lekcje” l.246.

## Tasks & Acceptance

**Execution:**
- `tests/e2e/progress-panel.spec.ts` -- dopisać testy: brak dzieci i brak zestawów (różne teksty, CTA przenosi na właściwą zakładkę) -- RED najpierw.
- `packages/contracts/src/messages.ts` -- `progress.noChildren`, `progress.toChildren`, `progress.toDecks`, `workCard.toChildren` (lub wspólne), `decks.emptyCta`, `sources.emptyCta`.
- `apps/web/src/parent/ProgressPanel.tsx`, `WorkCardPanel.tsx`, `ParentApp.tsx`, `DecksPanel.tsx`, `sources/SourcesPanel.tsx` -- CTA.
- `apps/web/src/parent/sources/sources-panel.test.tsx` -- jeśli trzeba, asercja CTA.

**Acceptance Criteria:**
- Given rodzic bez dzieci, when otwiera Postępy, then widzi komunikat o braku dziecka (nie o zestawach) i po kliknięciu CTA jest w sekcji Dzieci.
- Given dziecko i brak opublikowanych zestawów, when otwiera Postępy, then widzi komunikat o zestawach i CTA przenosi do Zestawów.
- Given pusta lista zestawów/źródeł, when klika CTA, then otwiera się dialog tworzenia.

## Verification

**Commands:**
- `pnpm exec playwright test tests/e2e/progress-panel.spec.ts` (UMIEM_E2E_WEB_MODE=dev) -- nowe testy zielone
- `pnpm check` -- zielone
- `pnpm test:e2e:shards --base-port=25700` -- zielone

**Order (RED-GREEN, required by the owner):** write the new E2E tests first and run them before touching production code; record in your report that they fail (and why), then implement until green. Single spec without build (PowerShell): `$env:UMIEM_E2E_WEB_MODE='dev'; corepack pnpm exec playwright test tests/e2e/progress-panel.spec.ts --project=mocked`. If the dev server loops on „Compiled”, delete `apps/web/.next/dev`. Do not commit; do not touch the `kid` section of `messages.ts` (another session edits it).

## Review Triage Log

- Pass 1 (fresh-context reviewer + ponytail-review): 0 high, 0 medium, 5 low.
  - Duplicate CTA next to header button (Decks/Sources) — reject: the issue asks for a CTA inside the empty state; no strict-mode test conflict (grepped).
  - Only archived lessons → "Nie masz jeszcze zestawów." — defer: pre-existing message, out of scope; described in PR.
  - Kind filter with no matches shows nothing — defer: pre-existing, filtered view is not an empty panel.
  - Test gaps (lessons-only + no children; unit CTA click) — reject: existing E2E covers lessons-only; new E2E covers clicks.
  - Copy "profilu dziecka" vs "profili dzieci" — reject: both correct.

## Auto Run Result

Status: done
