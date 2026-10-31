-- Słówka ze źródła (design 2026-10-30 „Angielski — rozdział”, §6.2): liczba
-- elementów odrzuconych przy walidacji per element zestawu słówek z tekstu źródła
-- (spoza tekstu, niepoprawne, duplikaty). Wersja słówek nie ma lesson_context,
-- więc licznik żyje w runie i trafia do GenerationDto.rejectedCount. NULL — run
-- bez walidacji per element (tryb „z opisu”, lekcje, media) albo niezakończony.
-- Ręcznie pisany SQL: snapshoty drizzle po 0017 są znanym długiem.
ALTER TABLE "learning_app"."generation_runs" ADD COLUMN "rejected_count" integer;
--> statement-breakpoint
ALTER TABLE "learning_app"."generation_runs" ADD CONSTRAINT "generation_runs_rejected_count_nonnegative" CHECK ("learning_app"."generation_runs"."rejected_count" is null or "learning_app"."generation_runs"."rejected_count" >= 0);
