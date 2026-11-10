-- Materiały redagowane przez agenta (docs/integrations/lesson-authoring.md): zakresy tokenów integracji
-- `materials:write` (lekcje, zestawy słówek, źródła, nagrania) i `materials:publish` (publikacja, archiwizacja).
-- Nadal dokładnie jeden zakres na token; istniejące tokeny `learning:read` i `lessons:write` bez zmian.
-- Ręcznie pisany SQL: snapshoty drizzle po 0017 są znanym długiem.
ALTER TABLE "learning_app"."integration_tokens" DROP CONSTRAINT "integration_tokens_scopes_allowed";--> statement-breakpoint
ALTER TABLE "learning_app"."integration_tokens" ADD CONSTRAINT "integration_tokens_scopes_allowed" CHECK ("learning_app"."integration_tokens"."scopes" <@ ARRAY['learning:read', 'lessons:write', 'materials:write', 'materials:publish']::text[]);
