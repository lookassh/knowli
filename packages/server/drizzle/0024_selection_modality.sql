-- Etap 4 przedmiotów szkolnych (trener precyzji): odpowiedź `selection` —
-- zbiór pojęć wskazanych w `lesson_keywords` (kolejność bez znaczenia).
ALTER TABLE "learning_app"."attempts" DROP CONSTRAINT "attempts_modality_allowed";
--> statement-breakpoint
ALTER TABLE "learning_app"."attempts" ADD CONSTRAINT "attempts_modality_allowed" CHECK ("learning_app"."attempts"."modality" in ('choice', 'text', 'audio', 'dont_remember', 'skip', 'sequence', 'selection'));
