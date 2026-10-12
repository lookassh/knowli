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
- Status: UKOŃCZONE (commit d6abcc5)
- RED: 2 failed (brak spelling_hint w enum / pola spellingDiff), 3 negatywne przechodziły przez .strict() — poprawnie.
- GREEN: 5/5 nowy plik; całość unit 497/497 PASS.
- Do commita dołączono: .gitignore (.superpowers/) + ten dziennik.

### Task 2: Domena — compareSpelling
- Status: UKOŃCZONE
- RED: moduł nie istniał (no tests / import error).
- Odstępstwo od planu (klauzula planu o lokalizacji pigułek): poprawiono oczekiwania 4 testów —
  plan błędnie zliczał zgodne litery do pigułki („Wenesday"→given cały plain; „Widnesday"→pill tylko
  „i"/„e"; nie „Wi"/„We") oraz dystans „wendsday"=2 (nie 1: brak „e" + przestawienie „nd") i przykład
  progu „caat"→„cat"=1 (nie 2; zastąpiono „abt"→„cat"=2). Implementacja bez zmian; dystanse i liczba
  operacji zgodne z designem.
- GREEN: 8/8 PASS.


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
