CREATE INDEX "reward_activity_segment_settlement_idx" ON "learning_app"."reward_activity_segments" USING btree ("settlement_ref") WHERE "settlement_ref" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "learning_app"."child_reward_projection" (
	"child_id" uuid PRIMARY KEY NOT NULL REFERENCES "learning_app"."child_profiles"("id") ON DELETE CASCADE,
	"earned_points" integer DEFAULT 0 NOT NULL,
	"credited_milliseconds" bigint DEFAULT 0 NOT NULL,
	"remainder_milliseconds" integer DEFAULT 0 NOT NULL,
	"qualified_packs" integer DEFAULT 0 NOT NULL,
	"consumed_packs" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "child_reward_projection_nonnegative" CHECK ("earned_points" >= 0 and "credited_milliseconds" >= 0 and "remainder_milliseconds" >= 0 and "remainder_milliseconds" < 60000 and "qualified_packs" >= 0 and "consumed_packs" >= 0)
);--> statement-breakpoint
CREATE TABLE "learning_app"."deck_reward_projection" (
	"child_id" uuid NOT NULL REFERENCES "learning_app"."child_profiles"("id") ON DELETE CASCADE,
	"deck_id" uuid NOT NULL REFERENCES "learning_app"."decks"("id") ON DELETE CASCADE,
	"earned_points" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_reward_projection_child_id_deck_id_pk" PRIMARY KEY("child_id","deck_id"),
	CONSTRAINT "deck_reward_projection_nonnegative" CHECK ("earned_points" >= 0)
);--> statement-breakpoint
CREATE TABLE "learning_app"."reward_day_projection" (
	"child_id" uuid NOT NULL REFERENCES "learning_app"."child_profiles"("id") ON DELETE CASCADE,
	"timezone" text NOT NULL,
	"local_date" text NOT NULL,
	"credited_milliseconds" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_day_projection_child_id_timezone_local_date_pk" PRIMARY KEY("child_id","timezone","local_date"),
	CONSTRAINT "reward_day_projection_nonnegative" CHECK ("credited_milliseconds" >= 0 and "local_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);--> statement-breakpoint
WITH segment_days AS (
  SELECT s.child_id, tz.timezone, a.started_at, a.ended_at, d.local_timestamp::date AS local_date
  FROM "learning_app"."reward_activity_segments" a
  JOIN "learning_app"."learning_sessions" s ON s.id = a.session_id
  JOIN "learning_app"."reward_activity_settlements" settlement ON settlement.id = a.settlement_ref
  CROSS JOIN LATERAL (
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM pg_timezone_names WHERE lower(name) = lower(NULLIF(s.context->>'timezone', ''))
    ) THEN NULLIF(s.context->>'timezone', '') ELSE 'Europe/Warsaw' END AS timezone
  ) tz
  CROSS JOIN LATERAL generate_series(
    (a.started_at AT TIME ZONE tz.timezone)::date::timestamp,
    (a.ended_at AT TIME ZONE tz.timezone)::date::timestamp,
    interval '1 day'
  ) AS d(local_timestamp)
  WHERE a.settlement_ref IS NOT NULL
)
INSERT INTO "learning_app"."reward_day_projection" (child_id, timezone, local_date, credited_milliseconds)
SELECT child_id, timezone, local_date::text,
       SUM(GREATEST(0, EXTRACT(EPOCH FROM (
         LEAST(ended_at, ((local_date + 1)::date::timestamp AT TIME ZONE timezone))
         - GREATEST(started_at, (local_date::timestamp AT TIME ZONE timezone))
       )) * 1000))::bigint
FROM segment_days
GROUP BY child_id, timezone, local_date
HAVING SUM(GREATEST(0, EXTRACT(EPOCH FROM (
         LEAST(ended_at, ((local_date + 1)::date::timestamp AT TIME ZONE timezone))
         - GREATEST(started_at, (local_date::timestamp AT TIME ZONE timezone))
       )) * 1000)) > 0;--> statement-breakpoint
INSERT INTO "learning_app"."child_reward_projection" (child_id, earned_points, credited_milliseconds, remainder_milliseconds, qualified_packs, consumed_packs)
SELECT c.id, COALESCE((SELECT SUM(awarded_points) FROM "learning_app"."reward_activity_settlements" WHERE child_id=c.id),0)::int,
       COALESCE((SELECT SUM(credited_milliseconds) FROM "learning_app"."reward_activity_settlements" WHERE child_id=c.id),0)::bigint,
       (COALESCE((SELECT SUM(credited_milliseconds) FROM "learning_app"."reward_activity_settlements" WHERE child_id=c.id),0)::bigint % 60000)::int,
       COALESCE((SELECT SUM(floor(credited_milliseconds::numeric / 1800000)) FROM "learning_app"."reward_day_projection" WHERE child_id=c.id),0)::int,
       (SELECT COUNT(*)::int FROM "learning_app"."reward_activity_xbox_requests" WHERE child_id=c.id AND status IN ('pending','fulfilled'))
FROM "learning_app"."child_profiles" c;--> statement-breakpoint
INSERT INTO "learning_app"."deck_reward_projection" (child_id, deck_id, earned_points)
SELECT child_id, deck_id, SUM(awarded_points)::int FROM "learning_app"."reward_activity_settlements" GROUP BY child_id, deck_id;--> statement-breakpoint
UPDATE "learning_app"."learning_sessions" SET state='ended', ended_at=COALESCE(ended_at, now()) WHERE mode='daily_round' AND state='active';--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD CONSTRAINT "learning_sessions_no_active_daily_round" CHECK (mode <> 'daily_round' OR state <> 'active');--> statement-breakpoint
UPDATE "learning_app"."reward_activity_playback_authorizations" a SET revoked_at=now() FROM "learning_app"."learning_sessions" s WHERE a.session_id=s.id AND s.mode='daily_round' AND a.revoked_at IS NULL AND a.ended_at IS NULL;--> statement-breakpoint
UPDATE "learning_app"."reward_activity_streams" st SET active=false, paused_reason='session_ended', playback_started_at=NULL FROM "learning_app"."learning_sessions" s WHERE st.session_id=s.id AND s.mode='daily_round' AND st.active=true;--> statement-breakpoint
