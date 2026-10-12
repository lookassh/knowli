# Dziennik postępu — feedback pisowni z diffem liter (issue #9)

- Plan: `docs/superpowers/plans/2026-10-12-spelling-diff-feedback.md`
- Spec: `docs/superpowers/specs/2026-10-12-spelling-diff-feedback-design.md`
- Worktree: `~/.zcode/worktrees/knowli/spelling-diff-feedback`, gałąź `feature/spelling-diff-feedback`, baza `4475e4a` (main po PR #49).
- Tryb: wykonanie przez bieżącego agenta (`superpowers:executing-plans`), zgodnie z AGENTS.md.

Dostosowania platformowe (brakujące skrypty): instalacja superpowers 6.3.0 nie zawiera skryptów
`workspace/task-start`, `task-done`, `review-package`. Równoważne kroki: ten dziennik (star/done z
dowodami), checklisty TodoWrite w sesji, a pakiet review przygotowany wg szablonu
`requesting-code-review/code-reviewer.md` (cel, spec+plan, Review Focus, zakres BASE..HEAD, wyniki
testów, odstępstwa).

Środowisko: pnpm przez `"$(npm prefix -g)/pnpm.cmd"`; testy integracyjne/e2e wymagają Dockera
(`docker info`); e2e filtrowane `pnpm exec playwright test <plik>`; przy równoległych sesjach
izolator `UMIEM_TEST_RUN_ID`/`UMIEM_E2E_PORT`.

## Baseline

- 2026-10-11: `pnpm install` OK; `pnpm test:unit` 492/492 PASS.

## Zadania

### Task 1: Kontrakt — spellingDiff w FeedbackDto + komunikaty
- Status: DO WYKONANIA

### Task 2: Domena — compareSpelling
- Status: DO WYKONANIA

### Task 3: Domena — chooseFeedback + ekspozycje
- Status: DO WYKONANIA

### Task 4: Serwer — attempts.ts liczy diff
- Status: DO WYKONANIA

### Task 5: Kid UI — pigułki
- Status: DO WYKONANIA

### Task 6: E2E — scenka literówki
- Status: DO WYKONANIA

### Task 7: Dokumentacja + pełna weryfikacja
- Status: DO WYKONANIA
