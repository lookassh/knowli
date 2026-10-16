CREATE TABLE "learning_app"."reward_activity_settlements" (
  "id" uuid PRIMARY KEY NOT NULL,
  "child_id" uuid NOT NULL REFERENCES "learning_app"."child_profiles"("id") ON DELETE CASCADE,
  "session_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "completion_ref" uuid NOT NULL,
  "kind" text NOT NULL,
  "settled_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reward_activity_settlement_session_child_fk" FOREIGN KEY ("session_id", "child_id") REFERENCES "learning_app"."learning_sessions"("id", "child_id") ON DELETE CASCADE,
  CONSTRAINT "reward_activity_settlement_task_child_fk" FOREIGN KEY ("task_id", "child_id") REFERENCES "learning_app"."session_tasks"("id", "child_id") ON DELETE CASCADE,
  CONSTRAINT "reward_activity_settlement_kind" CHECK ("kind" in ('attempt', 'presentation')),
  CONSTRAINT "reward_activity_settlement_completion_unique" UNIQUE ("task_id", "completion_ref"),
  CONSTRAINT "reward_activity_settlement_id_child_unique" UNIQUE ("id", "child_id")
);
--> statement-breakpoint
CREATE TABLE "learning_app"."reward_activity_streams" (
  "id" uuid PRIMARY KEY NOT NULL,
  "child_id" uuid NOT NULL REFERENCES "learning_app"."child_profiles"("id") ON DELETE CASCADE,
  "session_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "policy_version" text NOT NULL,
  "last_sequence" integer NOT NULL,
  "last_signal_at" timestamptz NOT NULL,
  "last_interaction_at" timestamptz NOT NULL,
  "paused_reason" text,
  "playback_started_at" timestamptz,
  "active" boolean NOT NULL DEFAULT true,
  CONSTRAINT "reward_activity_stream_session_child_fk" FOREIGN KEY ("session_id", "child_id") REFERENCES "learning_app"."learning_sessions"("id", "child_id") ON DELETE CASCADE,
  CONSTRAINT "reward_activity_stream_task_child_fk" FOREIGN KEY ("task_id", "child_id") REFERENCES "learning_app"."session_tasks"("id", "child_id") ON DELETE CASCADE,
  CONSTRAINT "reward_activity_stream_sequence_positive" CHECK ("last_sequence" > 0),
  CONSTRAINT "reward_activity_stream_pause_reason" CHECK ("paused_reason" is null or "paused_reason" in ('background','blur','offline','idle','technical_wait','signal_timeout','task_changed','session_ended')),
  CONSTRAINT "reward_activity_stream_child_unique" UNIQUE ("id", "child_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reward_activity_one_stream_per_child" ON "learning_app"."reward_activity_streams" ("child_id") WHERE "active";
--> statement-breakpoint
CREATE INDEX "reward_activity_stream_session_idx" ON "learning_app"."reward_activity_streams" ("session_id");
--> statement-breakpoint
CREATE TABLE "learning_app"."reward_activity_playback_authorizations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "stream_id" uuid NOT NULL,
  "child_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "asset_duration_ms" integer NOT NULL,
  "authorized_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "started_at" timestamptz,
  "playback_limit_at" timestamptz,
  "ended_at" timestamptz,
  "revoked_at" timestamptz,
  CONSTRAINT "reward_activity_playback_stream_child_fk" FOREIGN KEY ("stream_id", "child_id") REFERENCES "learning_app"."reward_activity_streams"("id", "child_id") ON DELETE CASCADE,
  CONSTRAINT "reward_activity_playback_session_child_fk" FOREIGN KEY ("session_id", "child_id") REFERENCES "learning_app"."learning_sessions"("id", "child_id") ON DELETE CASCADE,
  CONSTRAINT "reward_activity_playback_task_child_fk" FOREIGN KEY ("task_id", "child_id") REFERENCES "learning_app"."session_tasks"("id", "child_id") ON DELETE CASCADE,
  CONSTRAINT "reward_activity_playback_times_ordered" CHECK ("ended_at" is null or ("started_at" is not null and "ended_at" >= "started_at")),
  CONSTRAINT "reward_activity_playback_duration_positive" CHECK ("asset_duration_ms" > 0)
);
--> statement-breakpoint
CREATE INDEX "reward_activity_playback_stream_idx" ON "learning_app"."reward_activity_playback_authorizations" ("stream_id", "authorized_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "reward_activity_one_pending_playback_authorization" ON "learning_app"."reward_activity_playback_authorizations" ("stream_id") WHERE "ended_at" is null and "revoked_at" is null;
--> statement-breakpoint
CREATE TABLE "learning_app"."reward_activity_pauses" (
  "id" uuid PRIMARY KEY NOT NULL,
  "stream_id" uuid NOT NULL,
  "child_id" uuid NOT NULL,
  "pause_reason" text NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  CONSTRAINT "reward_activity_pause_stream_child_fk" FOREIGN KEY ("stream_id", "child_id") REFERENCES "learning_app"."reward_activity_streams"("id", "child_id") ON DELETE CASCADE,
  CONSTRAINT "reward_activity_pause_reason" CHECK ("pause_reason" in ('background','blur','offline','idle','technical_wait','signal_timeout','task_changed','session_ended'))
);
--> statement-breakpoint
CREATE INDEX "reward_activity_pause_session_idx" ON "learning_app"."reward_activity_pauses" ("child_id", "occurred_at");
--> statement-breakpoint
CREATE TABLE "learning_app"."reward_activity_segments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "stream_id" uuid NOT NULL,
  "child_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "started_at" timestamptz NOT NULL,
  "ended_at" timestamptz NOT NULL,
  "pause_reason" text,
  "settlement_ref" uuid,
  CONSTRAINT "reward_activity_segment_stream_child_fk" FOREIGN KEY ("stream_id", "child_id") REFERENCES "learning_app"."reward_activity_streams"("id", "child_id") ON DELETE CASCADE,
  CONSTRAINT "reward_activity_segment_session_child_fk" FOREIGN KEY ("session_id", "child_id") REFERENCES "learning_app"."learning_sessions"("id", "child_id") ON DELETE CASCADE,
  CONSTRAINT "reward_activity_segment_task_child_fk" FOREIGN KEY ("task_id", "child_id") REFERENCES "learning_app"."session_tasks"("id", "child_id") ON DELETE CASCADE,
  CONSTRAINT "reward_activity_segment_settlement_child_fk" FOREIGN KEY ("settlement_ref", "child_id") REFERENCES "learning_app"."reward_activity_settlements"("id", "child_id") ON DELETE CASCADE,
  CONSTRAINT "reward_activity_segment_positive" CHECK ("ended_at" >= "started_at"),
  CONSTRAINT "reward_activity_segment_pause_reason" CHECK ("pause_reason" is null or "pause_reason" in ('background','blur','offline','idle','technical_wait','signal_timeout','task_changed','session_ended'))
);
--> statement-breakpoint
CREATE INDEX "reward_activity_segment_pending_idx" ON "learning_app"."reward_activity_segments" ("child_id", "task_id") WHERE "settlement_ref" IS NULL;
