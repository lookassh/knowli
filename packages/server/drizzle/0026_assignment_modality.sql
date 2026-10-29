-- Etap 7 przedmiotów szkolnych: odpowiedź `assignment` — przypisania dziecka
-- w „Połącz w pary” (`lesson_match`) i „Pogrupuj” (`lesson_group`).
ALTER TABLE "learning_app"."attempts" DROP CONSTRAINT "attempts_modality_allowed";
--> statement-breakpoint
ALTER TABLE "learning_app"."attempts" ADD CONSTRAINT "attempts_modality_allowed" CHECK ("learning_app"."attempts"."modality" in ('choice', 'text', 'audio', 'dont_remember', 'skip', 'sequence', 'selection', 'assignment'));
