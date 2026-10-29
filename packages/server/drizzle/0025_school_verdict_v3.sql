-- Etap 6 przedmiotów szkolnych (werdykt school-grader-v3, design §9.1):
-- fragmenty niezwiązane z pytaniem i pary pomylonych pojęć w cache werdyktów.
-- Domyślne puste listy: wpisy gramatyki (v1) i szkoły v2 zostają bez nowych danych.
ALTER TABLE "learning_app"."lesson_verdicts" ADD COLUMN "off_topic_fragments" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "learning_app"."lesson_verdicts" ADD COLUMN "confused_concepts" jsonb DEFAULT '[]'::jsonb NOT NULL;
