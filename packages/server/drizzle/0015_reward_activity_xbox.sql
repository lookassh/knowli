CREATE TABLE "learning_app"."reward_activity_xbox_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"child_id" uuid NOT NULL,
	"timezone" text NOT NULL,
	"local_date" text NOT NULL,
	"block_number" integer NOT NULL,
	"credited_seconds_at_creation" integer NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "reward_activity_xbox_block_child_fk" FOREIGN KEY ("child_id") REFERENCES "learning_app"."child_profiles"("id") ON DELETE CASCADE,
	CONSTRAINT "reward_activity_xbox_block_identity_valid" CHECK ("local_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "block_number" > 0),
	CONSTRAINT "reward_activity_xbox_block_duration" CHECK ("credited_seconds_at_creation" >= "block_number" * 1800),
	CONSTRAINT "reward_activity_xbox_block_identity" UNIQUE ("child_id", "timezone", "local_date", "block_number"),
	CONSTRAINT "reward_activity_xbox_block_id_child_unique" UNIQUE ("id", "child_id")
);
--> statement-breakpoint
CREATE INDEX "reward_activity_xbox_block_oldest_idx" ON "learning_app"."reward_activity_xbox_blocks" USING btree ("child_id", "local_date", "block_number");
--> statement-breakpoint
CREATE TABLE "learning_app"."reward_activity_xbox_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"child_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"timezone_snapshot" text NOT NULL,
	"local_date_snapshot" text NOT NULL,
	"block_number_snapshot" integer NOT NULL,
	"credited_seconds_snapshot" integer NOT NULL,
	"points_cost" integer DEFAULT 30 NOT NULL,
	"xbox_minutes" integer DEFAULT 15 NOT NULL,
	"requested_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "reward_activity_xbox_request_child_fk" FOREIGN KEY ("child_id") REFERENCES "learning_app"."child_profiles"("id") ON DELETE CASCADE,
	CONSTRAINT "reward_activity_xbox_request_block_child_fk" FOREIGN KEY ("block_id", "child_id") REFERENCES "learning_app"."reward_activity_xbox_blocks"("id", "child_id") ON DELETE CASCADE,
	CONSTRAINT "reward_activity_xbox_request_status" CHECK ("status" in ('pending','fulfilled','rejected')),
	CONSTRAINT "reward_activity_xbox_request_snapshot" CHECK ("points_cost" = 30 and "xbox_minutes" = 15 and "block_number_snapshot" > 0 and "credited_seconds_snapshot" >= 1800)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reward_activity_xbox_one_open_request_per_child" ON "learning_app"."reward_activity_xbox_requests" USING btree ("child_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE UNIQUE INDEX "reward_activity_xbox_block_reserved_once" ON "learning_app"."reward_activity_xbox_requests" USING btree ("block_id") WHERE "status" in ('pending','fulfilled');
--> statement-breakpoint
CREATE INDEX "reward_activity_xbox_request_child_time_idx" ON "learning_app"."reward_activity_xbox_requests" USING btree ("child_id", "requested_at");
