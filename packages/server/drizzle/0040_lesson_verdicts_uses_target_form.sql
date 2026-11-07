-- Etap 3 oceny odpowiedzi (#360): czy werdykt grader-v2 stwierdził użycie formy
-- ćwiczonej w celu. `false` przy poprawnej odpowiedzi = wynik „bez ćwiczonej
-- formy” (nieoceniony, zadanie zamknięte); trafienie w cache daje ten sam wynik.
-- NULL — wiersze sprzed migracji (grader-v1, nieczytane pod nową wersją promptu)
-- i werdykty szkolne. Ręcznie pisany SQL: snapshoty drizzle po 0017 są znanym długiem.
ALTER TABLE "learning_app"."lesson_verdicts" ADD COLUMN "uses_target_form" boolean;
