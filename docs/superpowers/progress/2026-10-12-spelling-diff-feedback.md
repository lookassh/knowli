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
- Status: UKOŃCZONE
- Test akceptacyjny (RED dla zachowania potwierdzone w Taskach 1–4 unit/integration): PASS 1/1 (56,6 s),
  izolator UMIEM_TEST_RUN_ID=spelling-diff-1, port 24600. Asercje: diff niewidoczny przed odpowiedzią,
  widoczny po; given/expected zawierają wpis i target; pigułka widoczna; przycisk „Spróbuj jeszcze raz"
  (brak dodatkowych prób).
- Odstępstwo od planu: seedDue używa skill "recall" (wzorzec repo; Recall ocenia też pisownię), plan
  sugerował "spelling"; po openLearn wymagane kliknięcie kid-deck (jak w kid-flow.spec.ts).


### Task 7: Dokumentacja + pełna weryfikacja
- Status: UKOŃCZONE
- SPEC §12.8: akapit o diagnozie liter (próg, obwódka jako drugi kanał, oceny bez zmian, ujawnienie,
  przypadki bez diagnozy); §16: nowa pozycja na liście komunikatów.
- architecture.md: akapit o FeedbackDto.spellingHint dopisany w §12 (kontrakt API — tam gdzie opisano
  SessionSummaryDto); plan wskazywał §9, ale kontrakt DTO mieszka w §12 — dostosowano do struktury dokumentu.
- Pełna weryfikacja (dowody): unit 513/513 (60 plików); typecheck PASS; integration 186/186 (21 plików,
  Docker 29.7.2); e2e 9/9 (spelling-diff-feedback.spec.ts + kid-flow.spec.ts, izolator spelling-diff-1:24600);
  build PASS.

## Bramka review
- Status: WYKONANE + poprawki wdrożone
- Niezależny recenzent (subagent general-purpose; ZCode nie udostępnia mechanizmu wyboru modelu subagenta —
  odnotowane dostosowanie), zakres 4475e4a..5119c4e (7 commitów), wg szablonu requesting-code-review/code-reviewer.md.
  Recenzent zweryfikował algorytm testem własności (15 182 losowe pary vs referencyjna OSA: 0 niezgodności)
  i niezależnie uruchomił unit + typecheck. Werdykt: „With fixes" — 0 Critical, 1 Important, 6 Minor.
- Wdrożone (TDD, testy RED→GREEN):
  1. Important: superRefine sprawdza, że segmenty `expected` składają się na `correctText` (wymóg specu
     pominięty w planie Task 1; plan → implementacja poszły za planem — luka planu).
  2. Minor: aria komunikat bez rodzaju męskiego: „Twój zapis: {given}. Poprawnie: {expected}."
  3. Minor: guard casefold — litera zmieniająca długość przy toLowerCase (İ) wyłącza diagnozę (null).
  4. Minor: test jednostkowy pinujący correctText = najbliższy wariant („colour"), nie kanoniczny target.
- Odrzucone z uzasadnieniem:
  5. Minor (testy „brak diffu dla pustej/skip/dont_remember/mowy" w feedback.test.ts): ścieżki bramkowane
     w attempts.ts (modality text + spelling incorrect + typ ćwiczenia) i pokryte pośrednio istniejącymi
     testami integracyjnymi (attempts.test.ts: „Nie pamiętam"/„Pomiń", mock-tests.test.ts: feedback null).
     Wpis o odstępstwie spec→plan dopiero tutaj — uzupełnione.
  6. Minor (higiena commitów 910f901): rozwiązywana przez Squash and merge przy integracji (reguła repo).
- Rekomendacja recenzenta (commit spec+plan przed PR) odłożona do decyzji właściciela — polecenie
  „nie commituj planu" pozostaje w mocy.
- Weryfikacja po poprawkach: unit 516/516; typecheck PASS; integration attempts 17/17.

