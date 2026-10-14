# Rozbicie czasu nauki na dni w panelu rodzica

**Status:** Zatwierdzona koncepcja UI/UX przez właściciela; specyfikacja techniczna przed planem implementacji.

## Cel

Rodzic w panelu postępów dziecka w karcie aktywności z ostatnich 7 dni widzi nie tylko łączny czas nauki, ale dokładne rozbicie czasu na poszczególne dni w formie 7 kafelków (od 6 dni temu do dzisiaj), co pozwala na natychmiastową ocenę regularności nauki (ciągów dni, przerw) oraz zaangażowania w dniu dzisiejszym.

## Zachowanie i interfejs (UI/UX)

1. **Podsumowanie i łączny czas:**
   - W karcie `Aktywność (ostatnie 7 dni)` pozostaje dotychczasowa informacja: `Czas nauki: X min`.
2. **Pasek 7 kafelków dni tygodnia:**
   - Bezpośrednio pod łącznym czasem nauki wyświetlany jest responsywny pasek 7 kafelków reprezentujących kolejne dni kalendarzowe (w strefie `Europe/Warsaw`), od najstarszego (6 dni temu) po lewej do bieżącego dnia po prawej.
   - **Górna etykieta kafelka:**
     - Dla bieżącego dnia: **Dziś** (z wyraźniejszym akcentem wizualnym).
     - Dla pozostałych dni: krótki skrót dnia tygodnia w języku polskim (np. `Cz`, `Pt`, `So`, `Nd`, `Pn`, `Wt`).
   - **Dolna wartość czasu kafelka:**
     - Dzień z nauką: np. `15 min` (lub `15m` przy ograniczonej szerokości, z subtelnym wyróżnieniem aktywności).
     - Dzień bez nauki: `—` (kafelek neutralny / wyszarzony).
   - **Dostępność i podpowiedź (`title` / `aria-label`):**
     - Każdy kafelek ma atrybut `title` oraz `aria-label` z pełną informacją, np. *„Środa, 14.10: 15 min nauki (2 podejścia)”* lub *„Wtorek, 13.10: brak nauki”*.
3. **Pozostałe metryki bez zmian:**
   - Pod paskiem kafelków pozostają: `Dni z nauką: X`, `Podejścia: Y`, lista zestawów z liczbą podejść, `Odpowiedzi: Z`, `Kliknięcia: W`.
   - Gdy dziecko nie ma żadnych sesji w oknie, karta zachowuje dotychczasowy stan pusty (`Brak rozpoczętej nauki w tym okresie.`).

## Architektura i kontrakty

1. **Kontrakt (`packages/contracts/src/progress.ts`):**
   - Dodajemy schemat pojedynczego dnia:
     ```ts
     export const ActivityDailyStatDtoSchema = z.object({
       date: DaySchema,
       activeSeconds: z.number().int().nonnegative(),
       sessions: z.number().int().nonnegative(),
     });
     export type ActivityDailyStatDto = z.infer<typeof ActivityDailyStatDtoSchema>;
     ```
   - Rozszerzamy `ActivitySummaryDtoSchema` o pole `daily`:
     ```ts
     export const ActivitySummaryDtoSchema = z.object({
       days: z.number().int().positive(),
       activeSeconds: z.number().int().nonnegative(),
       activeDays: z.number().int().nonnegative(),
       sessions: z.number().int().nonnegative(),
       answers: z.number().int().nonnegative(),
       interactions: z.number().int().nonnegative(),
       decks: z.array(ActivityDeckStatDtoSchema),
       daily: z.array(ActivityDailyStatDtoSchema),
     });
     ```
2. **Katalog komunikatów (`packages/contracts/src/messages.ts`):**
   - Dodajemy wpisy dla panelu postępów:
     - `activityToday`: `"Dziś"`,
     - `activityNoTime`: `"—"`,
     - `activityMinutesShort`: `"{minutes} min"`,
     - `activityDailyAria`: `"{day}, {date}: {time}"`,
     - `activityDailyAriaEmpty`: `"{day}, {date}: brak nauki"`.
   - Skróty dni tygodnia: `["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "So"]`.

3. **Logika serwera (`packages/server/src/modules/reporting.ts`):**
   - Wykorzystujemy istniejący mechanizm okresu raportowego z `report-period.ts` (`buildReportPeriod(services.clock.now().toISOString(), "Europe/Warsaw", ACTIVITY_WINDOW_DAYS)`), który wyznacza 7 dni kalendarzowych `dates: string[]` w formacie `YYYY-MM-DD`.
   - Dla każdej sesji rozpoczętej w oknie określamy jej dzień rozpoczęcia w strefie `Europe/Warsaw` za pomocą `ACTIVITY_DAY_FORMAT.format(new Date(row.startedAt))`.
   - Czas aktywności sesji liczony jest identycznie jak dotąd:
     `duration = Math.min(new Date(row.lastActivity).getTime() - new Date(row.startedAt).getTime(), ACTIVITY_SESSION_CAP_MS)`.
   - Agregujemy czas i liczbę sesji per dzień kalendarzowy.
   - Wynikowe `daily` zawiera dokładnie 7 elementów w kolejności chronologicznej (od `from` do `to`).
   - Suma `daily.map(d => d.activeSeconds)` jest zgodna z ogólnym `activeSeconds`.
   - `activeDays` odpowiada liczbie dni w `daily`, gdzie `sessions > 0`.

4. **Klient (`apps/web/src/parent/ProgressPanel.tsx` i CSS):**
   - Komponent renderuje listę kafelków w `div[data-testid="progress-activity-daily"]`.
   - Każdy kafelek ma `data-testid="progress-activity-day-<date>"`.
   - Stylowanie wykorzystuje istniejące klasy lub semantyczny CSS panelu rodzica (grid/flex, zaokrąglone rogi, delikatne tło dla dni z czasem > 0).

## Wpływ na MCP i integracje (API → MCP → Skill)

- Raport `GET /api/v1/integrations/learning-overview` oraz narzędzie MCP korzystają ze schematu `LearningOverviewDtoSchema` (zdefiniowanego w `learning-overview.ts`), a nie z `ProgressDto`.
- Rozszerzenie `ActivitySummaryDto` dotyczy wyłącznie endpointu panelu rodzica (`GET /api/v1/parent/progress`).
- W ramach weryfikacji uruchamiamy testy MCP i eksportera schematu (`pnpm test:mcp`, `contracts:export-learning-overview --check`), aby potwierdzić brak regresji i zachowanie szczelności.

## Kryteria akceptacji

1. W karcie aktywności wyświetla się 7 kafelków odpowiadających ostatnim 7 dniom kalendarzowym w strefie polskiej.
2. Ostatni kafelek ma etykietę „Dziś” i pokazuje dzisiejszy czas nauki.
3. Dni bez sesji pokazują wartość „—” i nie są wyróżnione jako aktywne.
4. Czas w poszczególnych kafelkach sumuje się do łącznego czasu nauki z ostatnich 7 dni (z uwzględnieniem zaokrągleń do pełnych minut).
5. Wszystkie testy jednostkowe, integracyjne (`reporting.test.ts`), E2E (`progress-panel.spec.ts`), typecheck i build przechodzą pomyślnie.

## Weryfikacja

- `packages/contracts`: testy parsowania schematu z polem `daily`.
- `tests/integration/reporting.test.ts`: weryfikacja 7 wpisów w `daily`, poprawności przypisania sesji do dni i zerowych wartości dla dni pustych.
- `tests/e2e/progress-panel.spec.ts`: test widoku rodzica potwierdzający wyrenderowanie 7 kafelków, etykiety „Dziś” oraz odpowiednich czasów.
- Końcowe `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e` i `pnpm build`.
