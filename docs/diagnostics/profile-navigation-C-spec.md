---
title: 'Profil → zestawy: C1/C2, lekki zbiorczy odczyt lekcji'
type: 'refactor'
created: '2026-10-18'
status: 'in-progress'
route: 'dispatch'
baseline_commit: '5356529150a92bd782c6118ab52b49e4fcd905ae'
review_loop_iteration: 0
context:
  - 'C:/Users/looka/.codex/worktrees/b8a6/knowli/AGENTS.md'
  - 'C:/Users/looka/.codex/worktrees/b8a6/knowli/docs/diagnostics/2026-10-18-profile-navigation-repair-plan.md'
---

<frozen-after-approval reason="Właściciel zlecił pełną implementację z nadzorem">

## Intent

GPT Luna medium implementuje ograniczony etap C1/C2: usunięcie materializacji
kartkówki z odczytu dostępności i wspólny zbiorczy czytnik wartości lekcji.
Agent główny zintegruje go z listą po etapie projekcji. Nie zmieniać kid.ts,
schematu DB, migracji, skill-history ani plików innych agentów.

## Boundaries & Constraints

Zachować dotychczasowe liczniki, rekomendację, testGoals, requestedTaskCount,
bezpieczeństwo targetKey i granice SubjectModule. Reużyć istniejący czysty
planLessonMockTest. Lista nie generuje UUID, promptów/answerKey ani audio.
Start ponownie czyta aktualne dane pod istniejącą blokadą i materializuje plan.
Żaden test nie łączy się z prod. Bez commit/push/reset. RED → GREEN obowiązkowe.
Nie uruchamiać pełnej integracji równolegle z innym agentem; do celowanego runu
użyć unikalnego TEST_RUN_ID (sprawdź tests/test-run-config.ts), bo global-setup
usuwa kontenery z tym samym prefiksem. Omówić z nadzorcą przed większym runem.

## I/O & Edge-Case Matrix

| Scenariusz | Wejście | Wynik |
| --- | --- | --- |
| Bezpieczna porcja | dostępne ćwiczenia, cel lesson | dostępność zgodna z selekcją |
| Brak porcji | brak kwalifikujących ćwiczeń (np. tylko notice) | false |
| Znane targety | wszystkie ćwiczenia wcześniej ujawnione | zachowany fallback do widzianych, niewidziane mają pierwszeństwo |
| Bez celu | brak testGoals lesson | false, bez materializacji |
| Skala | 1/10/30 lekcji tego samego przedmiotu | stała liczba odczytów |
| Zmiana stanu | ujawnienie po odczycie listy przed startem | start respektuje świeży stan |

</frozen-after-approval>

## Code Map

- `packages/server/src/domain/lessons/mock-test-plan.ts`: czysty planLessonMockTest, wspólna selekcja.
- `packages/server/src/modules/lessons/lesson-mock-tests.ts`: hasSafeLessonMockPortion obecnie materializuje cały plan; createLessonMockTestPlan obsługuje start.
- `packages/server/src/modules/lessons/lesson-sessions.ts`: lessonDeckListValues i loadExercises pobierają więcej niż potrzeba, reużyć reguły.
- Nowy `packages/server/src/modules/lessons/lesson-deck-overview.ts`: zbiorcze metadane/pule/progress/exposed keys i wartości per deck/version.
- `tests/fixtures/lesson-world.ts`: richPool i istniejące fixture.
- Nowy `tests/integration/lesson-deck-overview.test.ts`: deterministyczna instrumentacja pool.query, zgodność i liczba odczytów.

## Tasks & Acceptance

- [ ] RED dowodzący dostępności bez materializacji i rosnącej liczby odczytów starej ścieżki.
- [ ] Wydzielić wspólną selekcję z materializacji, bez drugiego planera.
- [ ] Zaimplementować czytnik zbiorczy dla jawnej listy `{deckId, versionId, testDate, testGoals, mockTestTaskCount, lessonContext}` i jednego dziecka/now.
- [ ] Czytnik ma przyjmować wstrzykiwaną funkcję zbiorczego odczytu exposed target keys; do czasu integracji może mieć domyślny odczyt sealed events. Nadzorca podmieni wejście na projekcję B przed końcem.
- [ ] Pobierać lekkie pola rewizji (objective/type/targetKey/IDs), nie audio/prompty całej historii; reużyć konteksty już dostarczone.
- [ ] Udostępnić wyniki per deckId jako itemCount/independentlyRecalledCount/recommended/mockTestAvailable, bez eksportu do publicznych DTO.
- [ ] Testy macierzy + istniejące lesson-mock-tests/lesson-sessions, zapisać dowody w osobnym `docs/diagnostics/profile-navigation-C-progress.md`.

Given ten sam snapshot, when lista i start selekcjonują, then wybierają tę samą bezpieczną porcję.
Given 1/10/30 lekcji jednego przedmiotu, when używamy czytnika, then liczba SELECT nie rośnie liniowo.
Given odczyt dostępności, when wywołany, then nie materializuje promptów, kluczy i UUID.

## Implementation Notes

## Spec Change Log

Nadzorca skorygował zbyt mocny skrót „wszystkie exposed => false”: wymaganie 9.3
grammar-module i obecny planer stanowią, że niewidziane są preferowane, a widziane
są dopuszczalnym fallbackiem. Refaktor ma zachować tę semantykę. Przypadek braku
porcji dotyczy braku kwalifikujących ćwiczeń, nie samego ujawnienia wszystkich.

## Review Triage Log

## Verification

Celowane unit planera i integration nowych testów oraz lekcji. Nie używać timing
assertions w testach correctness. Raportować rzeczywisty RED/GREEN i braki.
