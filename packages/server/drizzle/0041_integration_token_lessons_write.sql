-- Lekcje pisane przez agenta (docs/integrations/lesson-authoring.md): drugi zakres tokenów integracji
-- `lessons:write` i dokładnie jeden zakres na token (bez łączenia odczytu postępów z pisaniem lekcji).
-- Powtórzony zakres zwijamy do jednego; token bez zakresu nie miał żadnego dostępu (403), więc znika
-- zamiast blokować nowy warunek.
-- Ręcznie pisany SQL: snapshoty drizzle po 0017 są znanym długiem.
UPDATE "learning_app"."integration_tokens" SET "scopes" = ARRAY(SELECT DISTINCT "scope" FROM unnest("scopes") AS "scope") WHERE cardinality("scopes") > 1;--> statement-breakpoint
DELETE FROM "learning_app"."integration_tokens" WHERE cardinality("scopes") <> 1;--> statement-breakpoint
ALTER TABLE "learning_app"."integration_tokens" ALTER COLUMN "scopes" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "learning_app"."integration_tokens" DROP CONSTRAINT "integration_tokens_scopes_allowed";--> statement-breakpoint
ALTER TABLE "learning_app"."integration_tokens" ADD CONSTRAINT "integration_tokens_scopes_allowed" CHECK ("learning_app"."integration_tokens"."scopes" <@ ARRAY['learning:read', 'lessons:write']::text[]);--> statement-breakpoint
ALTER TABLE "learning_app"."integration_tokens" ADD CONSTRAINT "integration_tokens_single_scope" CHECK (cardinality("learning_app"."integration_tokens"."scopes") = 1);
