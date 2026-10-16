ALTER TABLE "learning_app"."reward_activity_settlements"
  ADD COLUMN "deck_id" uuid,
  ADD COLUMN "credited_milliseconds" bigint NOT NULL DEFAULT 0,
  ADD COLUMN "awarded_points" integer NOT NULL DEFAULT 0,
  ADD COLUMN "remainder_milliseconds" integer NOT NULL DEFAULT 0,
  ADD COLUMN "timezone" text NOT NULL DEFAULT 'Europe/Warsaw';
--> statement-breakpoint
UPDATE "learning_app"."reward_activity_settlements" AS settlements
SET "deck_id" = sessions."deck_id",
    "timezone" = COALESCE(sessions."context" ->> 'timezone', 'Europe/Warsaw')
FROM "learning_app"."learning_sessions" AS sessions
WHERE sessions."id" = settlements."session_id";
--> statement-breakpoint
ALTER TABLE "learning_app"."reward_activity_settlements" ALTER COLUMN "deck_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "learning_app"."reward_activity_settlements"
  ADD CONSTRAINT "reward_activity_settlement_reward_nonnegative"
  CHECK ("credited_milliseconds" >= 0 AND "awarded_points" >= 0 AND "remainder_milliseconds" >= 0 AND "remainder_milliseconds" < 60000);
--> statement-breakpoint
CREATE INDEX "reward_activity_settlement_child_deck_idx"
  ON "learning_app"."reward_activity_settlements" ("child_id", "deck_id");
