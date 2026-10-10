# Review: kompaktowe podsumowanie próbnej kartkówki (2026-10-10)

## Zakres

Gałąź `feature/mock-summary-compact` (worktree `.zcode/worktrees/knowli/mock-summary-compact`), base `5d1e88d` (main).

Zatwierdzony design (bounded, brainstorming w czacie, właściciel 2026-10-10):
- nagłówek wyniku „X/Y · Z%" + gwiazdki (maks. 6, po jednej za każdą 1/6 drogi — zmiana właściciela z pierwotnych 5),
- próg koloru nagłówka: ≥80% zielony, 50–79% bursztyn, <50% czerwony (paleta istniejąca w kid-ui),
- słowo zaliczone ⟺ wszystkie sprawdzone umiejętności poprawne; pomyłka → czerwony wiersz; tylko skipped/unassessed/not_tested → neutralny,
- kompaktowe wiersze słów zamiast dużych kart; druga linia pastylek tylko przy wynikach mieszanych/niesprawdzonych,
- bez zmian DTO/API; nowe komunikaty w messages.ts; SPEC §6 + §19.1 — wyjątek dla wyniku ukończonej próby.

## Commity

- `3e70238` feat: score mock test summary words with six-star rating (TDD: RED → GREEN, 10 testów)
- `97f6fba` feat: compact colored review rows and score header for mock test summary (+ e2e asercje)
- `19c2fc9` docs: allow finished mock test score in kid review (SPEC §6, §19.1)
- `cf1d08d` fix: extract and test review badge rules, guard empty results, type skill labels (poprawki po review)
- `aa9e7da` test: e2e green summary path with audio replay wiring (poprawki po review)

## Przebieg review

Niezależny subagent-recenzent (general-purpose, model sesji GLM-5.3 max — najmocniejszy dostępny
w tym środowisku; rodzina GPT Astra nie występuje w katalogu modeli, więc wykluczenie z AGENTS jest
spełnione; klient ZCode nie udostępnia przełącznika modelu subagenta — wybrany model = model sesji).

### Runda 1 (head 19c2fc9)

Werdykt: **With fixes**.

- **Important 1**: reguła widoczności pastylek bez pokrycia testowego → przyjęta. Ekstrakcja
  `mockTestSolutionDetail` do mock-test-score.ts + 4 testy jednostkowe (TDD RED→GREEN) + nowy test
  e2e ścieżki pozytywnej (3/3 · 100%, 6 gwiazdek, tone good, data-status="correct").
- **Minor 2**: podwójne wywołanie `solutionDetail` + pusty `<p>` przy `results: []` → przyjęta.
  Guard `{type:"none"}` + pojedyncze wyliczenie do `const detail`.
- **Minor 3**: `mockTestSkill` typowane `Record<string, string>` → przyjęta. Teraz
  `Record<TestGoal, string>` (import typu z kontraktów).
- **Minor 4**: e2e nie klika odsłuchu w omówieniu → przyjęta z odstępstwem: klik i oczekiwanie na
  re-read `mock-test-summary` (wpięcie przycisku); asercja „brak alertu" niemożliwa, bo media e2e
  mają fake'owe bajty (1024 B, provider fake) i przeglądarka ich nie dekoduje (aplikacja słusznie
  pokazuje offline), a Next dev overlay dodaje własny element `role=alert`. Odtworzenie audio
  zweryfikowane tylko wizualnie — ograniczenie środowiska zgodne z zasadą zadania 0.

### Runda 2 (head aa9e7da) — weryfikacja poprawek

Werdykt: **Yes — ready to merge**. Wszystkie 4 uwagi uznane za rozwiązane (1 Important + 3 Minor),
bez nowych Critical/Important. Recenzent potwierdził m.in. pokrycie testowe `mockTestSolutionDetail`
(łącznie 14 testów modułu; samodzielnie uruchomił unit 14/14, e2e ścieżkę pozytywną 1/1 i typecheck),
guard na puste `results`, poprawne typowanie i sensowne odstępstwo w punkcie 4 (fake media jako
ograniczenie e2e; wpięcie odsłuchu potwierdzone empirycznie w logach drugiego GET /mock-test-summary).

Nowy drobiazg poniżej progu blokowania (Minor, bez działania): w teście e2e asercja
`expect.poll(...).not.toBe(previous)` zakłada zmianę tekstu `kid-source` między zadaniami — przy
hipotetycznych duplikatach słów w decku test by zawisł; obecny deck ma słowa unikalne.

## Wyniki sprawdzeń (stan po poprawkach, head aa9e7da)

- `pnpm test:unit`: **394/394** (46 plików; +14 nowych w mock-test-score.test.ts)
- `pnpm test:e2e`: **67/67** (cały suit; +1 test ścieżki pozytywnej; uruchomione po finalnym stanie kodu)
- `pnpm typecheck`: czysty (6 projektów)
- `pnpm build`: ✓ Compiled successfully
- `git diff --check`: czysty
- Wizualnie: screenshot 390×844 (4/6 · 67% bursztyn, 4 gwiazdki, 6 wierszy na ekranie,
  zielony/czerwony/neutralny z ✓/✗/–, okrągłe 🔊) — zweryfikowany analizą obrazu

## Niezweryfikowane / odstępstwa

- Fizyczne odtworzenie audio w omówieniu nie jest asertowane w e2e (fake bytes); przycisk jest
  pokryty przez asercję re-read omówienia i przez weryfikację wizualną.
- Odporność interfejsu na przyszłe wartości `TestGoal` poza mapami komunikatów pozostała
  `Record<string, string>` w starych mapach (poza zakresem tego zadania).
