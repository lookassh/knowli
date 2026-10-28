-- Etap 2 przedmiotów szkolnych: wymiar precyzji i elementy werdyktu v2 w cache.
-- Kolumny nullable / z domyślnymi pustymi listami: wpisy gramatyki (werdykt v1)
-- zostają bez wymiaru szkolnego i bez migracji wstecznej.
ALTER TABLE "learning_app"."lesson_verdicts" ADD COLUMN "precision" text;
--> statement-breakpoint
ALTER TABLE "learning_app"."lesson_verdicts" ADD COLUMN "matched_elements" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "learning_app"."lesson_verdicts" ADD COLUMN "missing_elements" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "learning_app"."lesson_verdicts" ADD COLUMN "incorrect_statements" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "learning_app"."lesson_verdicts" ADD COLUMN "redundant_fragments" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "learning_app"."lesson_verdicts" ADD CONSTRAINT "lesson_verdicts_precision_allowed" CHECK ("precision" is null or "precision" in ('concise', 'verbose', 'unfocused'));
