# Rozbicie czasu nauki na dni w panelu rodzica — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before completion, use superpowers:requesting-code-review.

**Goal:** Rozszerzenie karty aktywności w panelu rodzica o 7 kafelków dziennych (od 6 dni temu do dzisiaj w strefie polskiej) z czasem nauki per dzień obok łącznego czasu z 7 dni.

**Architecture:** Rozszerzenie kontraktu `ActivitySummaryDto` o pole `daily: ActivityDailyStatDto[]`, wyliczenie 7 dni kalendarzowych w `packages/server/src/modules/reporting.ts` przy użyciu `buildReportPeriod` i agregacja sesji według daty rozpoczęcia w strefie `Europe/Warsaw`, oraz prezentacja kafelków w `apps/web/src/parent/ProgressPanel.tsx`.

**Tech Stack:** TypeScript (strict), Zod, Drizzle ORM, React / Next.js App Router, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-parent-dashboard-daily-study-time-design.md`

## Global Constraints

- Język interfejsu panelu rodzica: `pl-PL`, komunikaty w `packages/contracts/src/messages.ts`.
- Strefa czasowa dla dni kalendarzowych aktywności: `Europe/Warsaw`.
- Zasady liczenia czasu sesji: czas od `started_at` do ostatniej aktywności (`last_at`), obcięty do limitu sesji (`ACTIVITY_SESSION_CAP_MS = SESSION_TIME_LIMIT_MS + 60_000`).
- Schemat `learning-overview` dla integracji Hermes / MCP pozostaje niezmieniony (nie zależy od `ProgressDto`).
- TDD RED-GREEN dla każdego kroku.

## Review Focus

1. **Sesja na granicy północy:** Sesja przypisywana jest do dnia kalendarzowego wg `startedAt` w strefie `Europe/Warsaw`, co gwarantuje spójność z metryką `activeDays`.
2. **Pusty dzień w oknie:** Dzień bez sesji zwraca `activeSeconds: 0` oraz `sessions: 0`, a UI renderuje `—` (bez zaokrąglenia do 1 min).
3. **Zaokrąglanie czasu aktywnego:** Dla dnia z dodatnim czasem krótszym niż minuta, UI pokazuje `1 min` (zgodnie z `Math.max(1, Math.round(sec / 60))`), spójnie z sumarycznym czasem nauki.
4. **Niezmienność `learning-overview` / MCP:** Zmiany w `ActivitySummaryDto` nie mogą wpłynąć na wyeksportowany schemat JSON MCP ani na testy kontraktu integracji.
5. **Dostępność (a11y):** Każdy kafelek ma semantyczny `title` i `aria-label` wyjaśniający dzień, datę i czas nauki.

---

### Task 1: Kontrakty i katalog komunikatów (`packages/contracts`)

**Files:**
- Create: `packages/contracts/src/progress.test.ts`
- Modify: `packages/contracts/src/progress.ts:96-120`
- Modify: `packages/contracts/src/messages.ts:225-235`

**Interfaces:**
- Produces:
  - `ActivityDailyStatDtoSchema = z.object({ date: DaySchema, activeSeconds: z.number().int().nonnegative(), sessions: z.number().int().nonnegative() })`
  - `ActivityDailyStatDto = z.infer<typeof ActivityDailyStatDtoSchema>`
  - `ActivitySummaryDtoSchema` zawiera pole `daily: z.array(ActivityDailyStatDtoSchema)`
  - `messages.progress.activityToday = "Dziś"`
  - `messages.progress.activityNoTime = "—"`
  - `messages.progress.activityMinutesShort = "{minutes} min"`
  - `messages.progress.activityDailyAria = "{day}, {date}: {time}"`
  - `messages.progress.activityDailyAriaEmpty = "{day}, {date}: brak nauki"`
  - `messages.progress.weekdaysShort = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "So"]`

- [ ] **Step 1: Write the failing test**

W pliku `packages/contracts/src/progress.test.ts` napisać test weryfikujący parsowanie `ActivitySummaryDtoSchema`:
- payload z prawidłową tablicą `daily` przechodzi walidację,
- payload bez pola `daily` jest odrzucany,
- element `daily` z ujemnym czasem lub nieprawidłową datą jest odrzucany.

- [ ] **Step 2: Run test to verify it fails**

Uruchomić: `npx --yes pnpm@10.34.6 vitest run packages/contracts/src/progress.test.ts`
Oczekiwany wynik: FAIL (brak definicji / błąd walidacji braku `daily`).

- [ ] **Step 3: Implement contract and messages**

W `packages/contracts/src/progress.ts` dodać `ActivityDailyStatDtoSchema` i rozszerzyć `ActivitySummaryDtoSchema` o `daily: z.array(ActivityDailyStatDtoSchema)`.
W `packages/contracts/src/messages.ts` dodać komunikaty dla kafelków dziennych i skróty dni tygodnia.

- [ ] **Step 4: Run test to verify it passes**

Uruchomić: `npx --yes pnpm@10.34.6 vitest run packages/contracts/src/progress.test.ts`
Oczekiwany wynik: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/progress.ts packages/contracts/src/messages.ts packages/contracts/src/progress.test.ts
git commit -m "feat(contracts): dodanie daily do ActivitySummaryDto i etykiet kafelkow"
```

---

### Task 2: Serwerowa agregacja per dzień kalendarzowy (`packages/server/src/modules/reporting.ts`)

**Files:**
- Modify: `tests/integration/reporting.test.ts:550-645`
- Modify: `packages/server/src/modules/reporting.ts:90-177`

**Interfaces:**
- Consumes:
  - `buildReportPeriod(now, timezone, days)` z `packages/server/src/domain/report-period.ts`
  - `ActivityDailyStatDto` z `@learning/contracts`
- Produces:
  - `readActivitySummary(services, childId): Promise<ActivitySummaryDto>` zwraca obiekt z polem `daily: ActivityDailyStatDto[]` o dokładnie 7 elementach w kolejności od 6 dni temu do dzisiaj.

- [ ] **Step 1: Write the failing integration test**

W `tests/integration/reporting.test.ts`:
- W teście aktywności zweryfikować, że `progress.activity.daily` ma dokładnie 7 elementów (`length === 7`),
- Daty w `daily` odpowiadają okresowi od 6 dni temu do dzisiaj,
- Sesje w konkretnych dniach przypisują `activeSeconds > 0` i `sessions > 0` do właściwych dat,
- Dni bez sesji mają `activeSeconds === 0` i `sessions === 0`,
- Suma `daily.reduce((sum, d) => sum + d.activeSeconds, 0)` równa się `progress.activity.activeSeconds`.

- [ ] **Step 2: Run test to verify it fails**

Uruchomić: `npx --yes pnpm@10.34.6 vitest run tests/integration/reporting.test.ts`
Oczekiwany wynik: FAIL (brak pola `daily` w obiekcie zwracanym przez `readActivitySummary`).

- [ ] **Step 3: Implement daily aggregation in `readActivitySummary`**

W `packages/server/src/modules/reporting.ts`:
- Zaimportować `buildReportPeriod` z `../domain/report-period`,
- Wywołać `const period = buildReportPeriod(services.clock.now().toISOString(), "Europe/Warsaw", ACTIVITY_WINDOW_DAYS)`,
- Dla każdego wiersza sesji wyznaczyć datę rozpoczęcia: `ACTIVITY_DAY_FORMAT.format(new Date(row.startedAt))` oraz obcięty czas aktywności,
- Zbudować mapę dzienną `Map<string, { activeMs: number; sessions: number }>()`,
- Zwrócić `daily: period.dates.map((date) => ({ date, activeSeconds: Math.round((dailyMap.get(date)?.activeMs ?? 0) / 1000), sessions: dailyMap.get(date)?.sessions ?? 0 }))`.

- [ ] **Step 4: Run test to verify it passes**

Uruchomić: `npx --yes pnpm@10.34.6 vitest run tests/integration/reporting.test.ts`
Oczekiwany wynik: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/reporting.ts tests/integration/reporting.test.ts
git commit -m "feat(server): obliczanie 7-dniowej aktywnosci dziennej w panelu postepow"
```

---

### Task 3: Prezentacja kafelków w panelu rodzica (`apps/web/src/parent/ProgressPanel.tsx`)

**Files:**
- Modify: `tests/e2e/progress-panel.spec.ts`
- Modify: `apps/web/src/parent/ProgressPanel.tsx:120-150`
- Modify: `apps/web/src/styles/` (jeśli potrzebne dodatkowe klasy pomocnicze dla kafelków)

**Interfaces:**
- Consumes:
  - `progress.activity.daily: ActivityDailyStatDto[]`
  - `messages.progress`
- Produces:
  - Renderowanie kontenera `data-testid="progress-activity-daily"`
  - Renderowanie 7 kafelków `data-testid="progress-activity-day-${date}"`
  - Etykieta `Dziś` na ostatnim kafelku
  - Wartość `X min` dla dni z `activeSeconds > 0` i `—` dla pustych dni

- [ ] **Step 1: Write the failing E2E test assertions**

W `tests/e2e/progress-panel.spec.ts`:
- Zaktualizować fixture `report.activity` o 7-elementową tablicę `daily` z różnymi czasami (w tym dzień pusty i dzień dzisiejszy),
- Dodać asercję sprawdzającą:
  - widoczność kontenera `[data-testid="progress-activity-daily"]`,
  - obecność 7 kafelków,
  - zawartość kafelka dzisiejszego (etykieta „Dziś”),
  - zawartość kafelka nieaktywnego („—”).

- [ ] **Step 2: Run test to verify it fails**

Uruchomić: `npx --yes pnpm@10.34.6 test:e2e tests/e2e/progress-panel.spec.ts`
Oczekiwany wynik: FAIL (brak elementu `progress-activity-daily`).

- [ ] **Step 3: Implement daily tiles in `ProgressPanel.tsx`**

W `apps/web/src/parent/ProgressPanel.tsx`:
- Bezpośrednio pod `progress-activity-time` dodać sekcję kafelków `progress-activity-daily`,
- Dla każdego elementu `daily` obliczyć:
  - czy to dzisiejszy dzień (np. `index === progress.activity.daily.length - 1`),
  - etykietę dnia tygodnia na podstawie daty (`new Date(d.date + "T12:00:00Z").getDay()`) i `messages.progress.weekdaysShort`,
  - sformatowany czas: `d.activeSeconds > 0 ? fill(messages.progress.activityMinutesShort, { minutes: Math.max(1, Math.round(d.activeSeconds / 60)) }) : messages.progress.activityNoTime`,
  - atrybut `title` i `aria-label` opisujący dzień, datę i czas,
- Zastosować estetyczny, responsywny styl kafelków (grid lub flex z równomiernym rozkładem 7 kolumn).

- [ ] **Step 4: Run test to verify it passes**

Uruchomić: `npx --yes pnpm@10.34.6 test:e2e tests/e2e/progress-panel.spec.ts`
Oczekiwany wynik: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/parent/ProgressPanel.tsx tests/e2e/progress-panel.spec.ts
git commit -m "feat(web): prezentacja kafelkow aktywnosci 7 dni w panelu rodzica"
```

---

### Task 4: Końcowa weryfikacja i testy regresji (Bramka jakościowa)

**Files:**
- Weryfikacja całego repozytorium

**Steps:**
- [ ] **Step 1: Uruchomienie typecheck**
  `npx --yes pnpm@10.34.6 typecheck`
- [ ] **Step 2: Uruchomienie testów jednostkowych**
  `npx --yes pnpm@10.34.6 test:unit`
- [ ] **Step 3: Uruchomienie testów integracyjnych**
  `npx --yes pnpm@10.34.6 test:integration`
- [ ] **Step 4: Uruchomienie testów E2E**
  `npx --yes pnpm@10.34.6 test:e2e`
- [ ] **Step 5: Weryfikacja braku wpływu na MCP i `learning-overview`**
  `npx --yes pnpm@10.34.6 test:mcp` oraz sprawdzenie spójności schematu JSON:
  `node apps/worker/node_modules/tsx/dist/cli.mjs scripts/export-learning-overview-schema.ts --check`
- [ ] **Step 6: Uruchomienie buildu produkcyjnego**
  `npx --yes pnpm@10.34.6 build`
- [ ] **Step 7: Przegląd kodu (requesting-code-review)**
  Zgodnie z AGENTS.md uruchomić procedurę przeglądu przed zakończeniem prac.
