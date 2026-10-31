-- Odczyt pełnego zdania ćwiczenia po odpowiedzi (gramatyka): nagranie
-- „feedback_audio” jako zasób rewizji ćwiczenia obok `target_audio`.
ALTER TABLE "learning_app"."revision_assets" DROP CONSTRAINT "revision_assets_role_allowed";
--> statement-breakpoint
ALTER TABLE "learning_app"."revision_assets" ADD CONSTRAINT "revision_assets_role_allowed" CHECK ("learning_app"."revision_assets"."role" in ('target_audio', 'example_audio', 'illustration', 'prompt_audio', 'feedback_audio'));
