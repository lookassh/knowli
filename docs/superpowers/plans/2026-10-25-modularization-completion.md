# Domknięcie modularyzacji: etapy 8–12 — zapis realizacji

Data: 2026-10-25. Branch: `feature/task-completion-refactor`, baza etapów 1–7:
`5819ad8`. Spec: `docs/superpowers/specs/2026-10-24-modular-monolith-design.md`.

## Review etapów 1–7 (Codex) względem `main`

Równoległe review pięciu obszarów + krytyk falsyfikujący (Workflow, 2026-10-25).
Werdykt: żaden etap nie jest zepsuty; brak behawioralnych must-fix. Potwierdzono
m.in. równoważność reguły zakończenia zadania i materializacji z kodem sprzed
wydzielenia, tę samą transakcję i kolejność zapisu ekspozycji przy wydawaniu
zadań, usunięcie bezpośredniego cyklu `generation ↔ lesson-drafts` oraz brak
zmian formatu API (`packages/contracts` bez diffu względem `main`).

Ustalenia niskiej wagi, domknięte w tym domknięciu: słabszy guard czystości
`task-completion` (brak zakazu globali), omijalne sprawdzenie aliasu w guardzie
routerów kartkówek, dosłowny zakaz `.transaction` bez `execute`, nieaktualne
komentarze o „dispatchu w routerach”, publiczne klasyfikatory
`readDeckKind`/`mockTestKindOfSession` bez konsumentów.

## Zrealizowane etapy

| Etap | Zakres | Korzyść |
| --- | --- | --- |
| 8 | `enqueueGenerationRun`, `claimQueuedRun`, `markRun`, `supersedeLessonRuns` → nowy `modules/materials/generation-runs.ts`; `lesson-drafts` i `lesson-api` przestają importować `generation.ts` | Moduł lekcji nie zależy od wykonawcy słówek; jeden właściciel cyklu życia runów |
| 9 | `RESUME_WINDOW_MS`, `SESSION_TIME_LIMIT_MS`, `sessionTimeLimitMs` → czyste `domain/session-limits.ts` (+ test granic) | `reporting` i `attempts` nie importują już `sessions.ts` |
| 10 | `buildLessonSummaryObjectives` + `objectiveTitle` → `learning/lessons/lesson-sessions.ts` | Podsumowanie sesji wraca do właściciela cyklu sesji; `sessions` nie importuje `lesson-attempts` |
| 11 | `getPronunciationSettings`, `updatePronunciationBands` → nowy `learning/learning-settings.ts` | `profiles.ts` to czysta tożsamość profilu (family); polityka nauki ma właściciela w obszarze nauki, zapis nadal w jednej transakcji |
| 12 | Grupowanie `modules/{materials,learning,family,reporting}` (68 plików), barrele `index.ts` obszarów, importy między obszarami tylko przez barrel, test granic `module-boundaries.architecture.test.ts` | Jedna mapa odpowiedzialności zgodna z designem; kierunki zależności egzekwowane testem AST, nie konwencją |

Przydział lekcji w etapie 12: autorstwo/generowanie/nadzór →
`materials/lessons/` (`lesson-api`, `lesson-drafts`, `lesson-supervision`,
`lesson-generation-*`), silnik sesji/prób/kartkówek → `learning/lessons/`
(`lesson-sessions`, `lesson-attempts`, `lesson-mock-tests`,
`lesson-materialize`, `lesson-deck-overview`). `SubjectModule` i rejestr
przedmiotów bez zmian.

Zasady zachowania z designu utrzymane we wszystkich etapach: te same funkcje
przenoszone dosłownie (bez zmiany SQL, kolejności blokad, momentu zegara/UUID
i liczby wywołań providerów), pomocnicy uczestniczą w istniejącej transakcji
koordynatora, publiczne nazwy `@learning/server` zachowane (wyjątek:
usunięte z root eksportu nieużywane `readDeckKind`/`mockTestKindOfSession`;
pozostają dostępne w barrelu `materials`).

## Weryfikacja (worktree `task-completion-refactor`, 2026-10-25)

- `pnpm test:unit` — 174 pliki, 1846 testów PASS (baseline na `5819ad8`:
  172 pliki / 1816; przyrost to testy `session-limits`, granic obszarów
  i wzmocnione próbki guardów).
- `pnpm test:integration` — 52 pliki, 498 PASS + 2 skipped (PostgreSQL 17
  z Dockera, pełny zestaw, 298 s).
- `pnpm typecheck` (6 tsconfigów) — PASS. `pnpm build` — PASS.
- E2E (Playwright, pełny zestaw): pierwszy przebieg 226 PASS / 11 FAIL —
  wszystkie porażki okazały się kolizją zasobów z równoległą sesją agenta na
  tej samej maszynie (współdzielone domyślne porty 24500/24611 i nazwa
  kontenera; w logu `EADDRINUSE`, testy trafiały na cudzy serwer i jego bazę).
  Powtórka wszystkich 8 plików z porażkami z unikalnym
  `UMIEM_TEST_RUN_ID=modcompl-24813` i `UMIEM_E2E_PORT=24813`: 68/68 PASS.
  Wniosek: brak porażek E2E przypisywalnych tej zmianie; przy równoległych
  pracach na maszynie zawsze ustawiać unikalne `UMIEM_TEST_RUN_ID`.
- Graf importów `packages/server/src` po zmianach: brak cykli runtime;
  pozostają dwa cykle wyłącznie typowe sprzed refaktoryzacji
  (`policies/registry ↔ db/client` przez `import type Executor` oraz trójka
  `domain/scheduler ↔ recognition-options ↔ picture-recognition-options`
  przez typy).
- `git diff --check` — PASS.

API → MCP → skill: bez zmian. Diff względem `main` dla `packages/contracts`,
`apps/web/src/integrations` i `integrations/umiem-mcp` wynosi 0; operacja
`getLearningOverview`, jej dane, autoryzacja i interpretacja (w tym wyłączenie
lekcji z raportu Hermesa) są nietknięte, więc regeneracja schematu MCP ani
aktualizacja `SKILL.md` nie są potrzebne. Żaden endpoint, DTO, status HTTP
ani nagłówek się nie zmienił.

## Świadomie pozostawione powiązania

- `config.ts` i `providers/generation-env.ts` importują bezpośrednio
  `materials/lessons/lesson-generation-policy` (typ polityki + parsowanie env).
  To zależność infrastruktury od obszaru materiałów; kandydat na przeniesienie
  typu do `domain/lessons` albo `policies/` w osobnym, małym etapie. Barrel
  `materials` jest tu celowo nieużyty (config ładuje się przed modułami).
- Testy integracyjne i `providers/fake.test.ts` importują kilka plików
  wewnętrznych obszarów bezpośrednio (np. `learning/events`,
  `learning/learning-snapshot`). Jawnie nazwany dług testowy; produkcyjni
  klienci (web, worker) korzystają wyłącznie z `@learning/server`.
- `packages/server/src/index.ts` nadal eksportuje infrastrukturę wymaganą
  przez obecnych klientów (konfiguracja, `createDatabase`, `schema`, fabryki
  providerów i fake'ów) — zgodnie z designem zawężenie tej powierzchni jest
  osobną decyzją kontraktową, nie częścią porządkowania modułów.
- `materials/lessons/lesson-supervision.ts` łączy odczyt postępu celów,
  nadzór nad werdyktami i akceptację wariantu materiału; podział na odczyt
  (reporting) i korektę materiału (materials) dopiero przy kolejnej zmianie
  w tym pliku.

## Co jest przenośne, a co nie

Przenośne (czyste reguły na zwykłych danych, chronione testami granic):
domenowe reguły oceniania, samodzielności, schedulera, zakończenia zadania,
materializacji promptu/klucza, limitów sesji oraz cały silnik lekcji oparty
o `SubjectModule`. Wymiana hosta lub bazy nadal wymaga przepisania adapterów:
zapytań Drizzle i transakcji w plikach wykonawczych obszarów, triggerów
i migracji, transportu oRPC/MCP oraz składania procesów web/worker. Sam układ
katalogów tego nie zmienia — zmniejsza jedynie liczbę miejsc, które trzeba
zrozumieć, aby taką wymianę przeprowadzić.

## Proponowane kolejne małe etapy

1. Dom dla typu polityki generowania lekcji poza `materials`
   (`lesson-generation-policy`), aby `config`/providery nie zależały od obszaru.
2. Podział `lesson-supervision.ts` przy najbliższej zmianie funkcjonalnej.
3. Decyzja właściciela o zawężeniu eksportów infrastruktury w `index.ts`
   (osobny kontrakt dla testów) — bez pośpiechu, wartość głównie porządkowa.
4. Osobna, produktowa decyzja ws. zachowanej osobliwości materializacji:
   identyfikatory opcji wyprowadzane z mapy po tekście opcji (duplikaty
   tekstów zwijają się do ostatniego ID) — zachowanie sprzed refaktoryzacji,
   odnotowane w review, niezmieniane przy okazji porządków.
