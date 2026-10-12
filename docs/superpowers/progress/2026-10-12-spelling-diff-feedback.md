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
- Status: UKOŃCZONE
- RED: 3 failed (2× spelling_hint, 1× exposure keys wariantu).
- Odstępstwo (błąd w planie, poprawka w teście): exposure test przekazywał surowy tekst jako
  canonicalTargetKey; wzorzec repo wymaga computeTargetKey(...). Implementacja bez zmian.
- GREEN: feedback.test.ts 17/17; cała domena 220/220 PASS.


### Task 4: Serwer — attempts.ts liczy diff
- Status: UKOŃCZONE
- RED: 1 failed (kind=incorrect), 16 starych PASS (brak regresji).
- Implementacja: diff liczony tylko dla modality=text + spelling incorrect + typ ćwiczenia
  (recall/spelling/letter_completion); przekazywany do chooseFeedback; mock_test nadal bez feedbacku.
- GREEN: 17/17 PASS (Docker 29.7.2).


### Task 5: Kid UI — pigułki
- Status: UKOŃCZONE
- RED: brak modułu spelling-diff-view.
- Render: AnswerFeedback (spelling_hint w feedbackText/feedbackTone + blok kid-spelling-diff z wierszami
  kid-spelling-given/expected i pigułkami kid-spelling-pill); aria przez istniejącą klasę .kid-visually-hidden
  (plan zakładał kid-sr-only — repo ma własną klasę, użyto jej). Kolory pigułek: given #1d4ed8/#eaf1ff (niebieski
  język retry), expected #1c5c2e/#e3f4e3 (identyczne z .kid-fragment--good) — konwencja literalnych kolorów pliku.
- Odstępstwo (typecheck): best w compareSpelling przepisany z unii null na inicjalizację pierwszym kandydatem
  (TS18047); zachowanie bez zmian.
- GREEN: screens 41/41; typecheck całego repo PASS.

### Task 6: E2E — scenka literówki
- Status: DO WYKONANIA

### Task 7: Dokumentacja + pełna weryfikacja
- Status: DO WYKONANIA
