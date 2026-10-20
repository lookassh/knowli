-- Konfigurowalny budżet zadań ocenianych sesji nauki per zestaw (domyślnie 20).
-- Kolumna jest konfiguracją runtime (jak assignments), nie treścią — mutacja
-- bez nowego szkicu wersji. CHECK 1–100 wzorowany na assignments_mock_test_count.
ALTER TABLE "learning_app"."decks" ADD COLUMN "session_task_budget" integer NOT NULL DEFAULT 20;
--> statement-breakpoint
ALTER TABLE "learning_app"."decks" ADD CONSTRAINT "decks_session_task_budget" CHECK ("learning_app"."decks"."session_task_budget" between 1 and 100);
--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ALTER COLUMN "task_budget" SET DEFAULT 20;
