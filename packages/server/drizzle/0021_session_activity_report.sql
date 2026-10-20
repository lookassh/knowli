ALTER TABLE "learning_app"."child_profiles" ADD COLUMN "reward_points" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "learning_app"."child_profiles" ADD COLUMN "reward_remainder_ms" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "learning_app"."child_profiles" ADD CONSTRAINT "child_profiles_reward_nonnegative" CHECK ("learning_app"."child_profiles"."reward_points" >= 0 AND "learning_app"."child_profiles"."reward_remainder_ms" >= 0 AND "learning_app"."child_profiles"."reward_remainder_ms" < 60000);--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD COLUMN "activity_report" jsonb;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD COLUMN "activity_report_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD COLUMN "activity_review_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD COLUMN "activity_report_hash" text;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD COLUMN "activity_review" jsonb;--> statement-breakpoint
CREATE INDEX "learning_sessions_activity_expiry_idx" ON "learning_app"."learning_sessions" ("activity_report_expires_at") WHERE "learning_app"."learning_sessions"."activity_report_expires_at" IS NOT NULL;--> statement-breakpoint
DO $$
DECLARE
  per_child_mismatches integer;
  remainder_out_of_range integer;
BEGIN
  -- Kontrola zgodności ledgera i projekcji PER DZIECKO przed przeniesieniem
  -- dorobku: globalne sumy mogłyby znosić przeciwstawne rozjazdy. Brak wiersza
  -- po którejś stronie oznacza zero (legalny stan: projekcja 0 bez settlementów
  -- albo settlementy 0 bez wiersza projekcji). Przy jakiejkolwiek rzeczywistej
  -- różnicy migracja kończy się błędem PRZED DROP (D02), bez zgadywania salda.
  SELECT count(*) INTO per_child_mismatches
  FROM (SELECT child_id, sum(awarded_points)::bigint AS points
        FROM learning_app.reward_activity_settlements GROUP BY child_id) ledger
  FULL OUTER JOIN learning_app.child_reward_projection projection USING (child_id)
  WHERE coalesce(ledger.points, 0) IS DISTINCT FROM coalesce(projection.earned_points, 0);
  IF per_child_mismatches > 0 THEN
    RAISE EXCEPTION 'reward migration aborted: ledger points differ from projection points for % children', per_child_mismatches;
  END IF;
  SELECT count(*) INTO remainder_out_of_range FROM learning_app.child_reward_projection
    WHERE remainder_milliseconds < 0 OR remainder_milliseconds >= 60000;
  IF remainder_out_of_range > 0 THEN
    RAISE EXCEPTION 'reward migration aborted: % profiles have remainder outside 0..59999', remainder_out_of_range;
  END IF;
END
$$;--> statement-breakpoint
UPDATE "learning_app"."child_profiles" AS cp
SET reward_points = crp.earned_points,
    reward_remainder_ms = crp.remainder_milliseconds
FROM "learning_app"."child_reward_projection" AS crp
WHERE crp.child_id = cp.id;--> statement-breakpoint
UPDATE "learning_app"."learning_sessions"
SET context = (context - 'summary') || jsonb_build_object('summary', (context->'summary') - 'reward')
WHERE context ? 'summary'
  AND jsonb_typeof(context->'summary') = 'object'
  AND (context->'summary') ? 'reward';--> statement-breakpoint
UPDATE "learning_app"."learning_sessions"
SET activity_report_expires_at = now()
WHERE activity_report_expires_at IS NULL;--> statement-breakpoint
DROP TABLE "learning_app"."reward_activity_xbox_requests";--> statement-breakpoint
DROP TABLE "learning_app"."reward_activity_xbox_blocks";--> statement-breakpoint
DROP TABLE "learning_app"."reward_activity_segments";--> statement-breakpoint
DROP TABLE "learning_app"."reward_activity_pauses";--> statement-breakpoint
DROP TABLE "learning_app"."reward_activity_playback_authorizations";--> statement-breakpoint
DROP TABLE "learning_app"."reward_activity_streams";--> statement-breakpoint
DROP TABLE "learning_app"."reward_activity_settlements";--> statement-breakpoint
DROP TABLE "learning_app"."deck_reward_projection";--> statement-breakpoint
DROP TABLE "learning_app"."reward_day_projection";--> statement-breakpoint
DROP TABLE "learning_app"."child_reward_projection";
