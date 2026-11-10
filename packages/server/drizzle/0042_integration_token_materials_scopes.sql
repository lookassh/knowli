-- Materiały redagowane przez agenta (docs/integrations/lesson-authoring.md): zakresy tokenów integracji
-- `materials:write` (lekcje, zestawy słówek, źródła, nagrania) i `materials:publish` (publikacja, archiwizacja).
-- Decyzja właściciela 2026-11-10: jeden token może mieć kilka zakresów (wybór przy wydaniu), więc warunek
-- „dokładnie jeden” z 0041 zastępuje „co najmniej jeden”. Istniejące tokeny zostają bez zmian.
-- Ręcznie pisany SQL: snapshoty drizzle po 0017 są znanym długiem.
ALTER TABLE "learning_app"."integration_tokens" DROP CONSTRAINT "integration_tokens_scopes_allowed";--> statement-breakpoint
ALTER TABLE "learning_app"."integration_tokens" ADD CONSTRAINT "integration_tokens_scopes_allowed" CHECK ("learning_app"."integration_tokens"."scopes" <@ ARRAY['learning:read', 'lessons:write', 'materials:write', 'materials:publish']::text[]);--> statement-breakpoint
ALTER TABLE "learning_app"."integration_tokens" DROP CONSTRAINT "integration_tokens_single_scope";--> statement-breakpoint
ALTER TABLE "learning_app"."integration_tokens" ADD CONSTRAINT "integration_tokens_scopes_nonempty" CHECK (cardinality("learning_app"."integration_tokens"."scopes") >= 1);
