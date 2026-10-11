CREATE TABLE "learning_app"."integration_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "integration_tokens_name_length" CHECK (length("learning_app"."integration_tokens"."name") between 1 and 120),
	CONSTRAINT "integration_tokens_scopes_allowed" CHECK ("learning_app"."integration_tokens"."scopes" <@ ARRAY['learning:read']::text[])
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_tokens_hash_idx" ON "learning_app"."integration_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "integration_tokens_revoked_idx" ON "learning_app"."integration_tokens" USING btree ("revoked_at");