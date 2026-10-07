CREATE SCHEMA "learning_app";
--> statement-breakpoint
CREATE TABLE "learning_app"."assessments" (
	"child_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"item_revision_id" uuid NOT NULL,
	"skill" text NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"independent" boolean NOT NULL,
	"confirmation_eligible" boolean NOT NULL,
	"provider" text,
	"provider_model" text,
	"provider_policy_version" text,
	"score" numeric,
	"score_scale" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "assessments_pk" PRIMARY KEY("attempt_id","skill"),
	CONSTRAINT "assessments_outcome_allowed" CHECK ("learning_app"."assessments"."outcome" in ('correct', 'incorrect', 'unassessed')),
	CONSTRAINT "assessments_unassessed_no_score" CHECK ("learning_app"."assessments"."outcome" <> 'unassessed' or ("learning_app"."assessments"."score" is null and not "learning_app"."assessments"."confirmation_eligible")),
	CONSTRAINT "assessments_score_needs_provider" CHECK ("learning_app"."assessments"."score" is null or ("learning_app"."assessments"."provider" is not null and "learning_app"."assessments"."score_scale" is not null))
);
--> statement-breakpoint
CREATE TABLE "learning_app"."assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"child_id" uuid NOT NULL,
	"deck_id" uuid NOT NULL,
	"test_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_child_deck_unique" UNIQUE("child_id","deck_id"),
	CONSTRAINT "assignments_id_child_deck_unique" UNIQUE("id","child_id","deck_id")
);
--> statement-breakpoint
CREATE TABLE "learning_app"."attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"child_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"item_revision_id" uuid NOT NULL,
	"client_attempt_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"modality" text NOT NULL,
	"state" text NOT NULL,
	"answer" jsonb,
	"context" jsonb NOT NULL,
	"feedback" jsonb,
	"policy_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "attempts_child_client_id_unique" UNIQUE("child_id","client_attempt_id"),
	CONSTRAINT "attempts_task_number_unique" UNIQUE("task_id","attempt_number"),
	CONSTRAINT "attempts_id_revision_unique" UNIQUE("id","item_revision_id"),
	CONSTRAINT "attempts_id_child_unique" UNIQUE("id","child_id"),
	CONSTRAINT "attempts_modality_allowed" CHECK ("learning_app"."attempts"."modality" in ('choice', 'text', 'audio', 'dont_remember', 'skip')),
	CONSTRAINT "attempts_state_allowed" CHECK ("learning_app"."attempts"."state" in ('processing', 'completed')),
	CONSTRAINT "attempts_number_positive" CHECK ("learning_app"."attempts"."attempt_number" > 0),
	CONSTRAINT "attempts_completed_iff_completed_at" CHECK (("learning_app"."attempts"."state" = 'completed') = ("learning_app"."attempts"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "learning_app"."child_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"avatar_key" text NOT NULL,
	"birth_year" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "child_profiles_display_name_length" CHECK (length("learning_app"."child_profiles"."display_name") between 1 and 80),
	CONSTRAINT "child_profiles_birth_year_range" CHECK ("learning_app"."child_profiles"."birth_year" is null or "learning_app"."child_profiles"."birth_year" between 1900 and 2200)
);
--> statement-breakpoint
CREATE TABLE "learning_app"."child_skill_progress" (
	"child_id" uuid NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"status" text NOT NULL,
	"independent_success_streak" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"delayed_confirmation_at" timestamp with time zone,
	"projection_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "child_skill_progress_pk" PRIMARY KEY("child_id","skill_version_id"),
	CONSTRAINT "child_skill_progress_status_allowed" CHECK ("learning_app"."child_skill_progress"."status" in ('unseen', 'practicing', 'needs_confirmation', 'mastered')),
	CONSTRAINT "child_skill_progress_streak_nonnegative" CHECK ("learning_app"."child_skill_progress"."independent_success_streak" >= 0)
);
--> statement-breakpoint
CREATE TABLE "learning_app"."deck_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deck_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"edit_number" integer DEFAULT 1 NOT NULL,
	"state" text NOT NULL,
	"title" text NOT NULL,
	"source_locale" text DEFAULT 'pl-PL' NOT NULL,
	"target_locale" text DEFAULT 'en-GB' NOT NULL,
	"generation_prompt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "deck_versions_version_number_unique" UNIQUE("deck_id","version_number"),
	CONSTRAINT "deck_versions_id_deck_unique" UNIQUE("id","deck_id"),
	CONSTRAINT "deck_versions_version_positive" CHECK ("learning_app"."deck_versions"."version_number" > 0),
	CONSTRAINT "deck_versions_edit_number_positive" CHECK ("learning_app"."deck_versions"."edit_number" > 0),
	CONSTRAINT "deck_versions_state_allowed" CHECK ("learning_app"."deck_versions"."state" in ('draft', 'review', 'published')),
	CONSTRAINT "deck_versions_published_iff_published_at" CHECK (("learning_app"."deck_versions"."state" = 'published') = ("learning_app"."deck_versions"."published_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "learning_app"."decks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'vocabulary' NOT NULL,
	"published_version_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_app"."event_exposures" (
	"child_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"target_key" text NOT NULL,
	CONSTRAINT "event_exposures_pk" PRIMARY KEY("event_id","target_key")
);
--> statement-breakpoint
CREATE TABLE "learning_app"."family_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"timezone" text DEFAULT 'Europe/Warsaw' NOT NULL,
	CONSTRAINT "family_settings_single_row" CHECK ("learning_app"."family_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "learning_app"."generation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deck_version_id" uuid,
	"expected_edit_number" integer,
	"asset_id" uuid,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"state" text NOT NULL,
	"input" jsonb NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "generation_runs_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "generation_runs_kind_allowed" CHECK ("learning_app"."generation_runs"."kind" in ('deck', 'tts', 'illustration')),
	CONSTRAINT "generation_runs_state_allowed" CHECK ("learning_app"."generation_runs"."state" in ('queued', 'running', 'succeeded', 'failed', 'superseded')),
	CONSTRAINT "generation_runs_attempts_nonnegative" CHECK ("learning_app"."generation_runs"."attempts" >= 0),
	CONSTRAINT "generation_runs_expected_edit_positive" CHECK ("learning_app"."generation_runs"."expected_edit_number" is null or "learning_app"."generation_runs"."expected_edit_number" > 0),
	CONSTRAINT "generation_runs_lease_pairing" CHECK (("learning_app"."generation_runs"."lease_token" is null) = ("learning_app"."generation_runs"."lease_until" is null)),
	CONSTRAINT "generation_runs_kind_shape" CHECK (("learning_app"."generation_runs"."kind" = 'deck' and "learning_app"."generation_runs"."deck_version_id" is not null and "learning_app"."generation_runs"."expected_edit_number" is not null and "learning_app"."generation_runs"."asset_id" is null) or ("learning_app"."generation_runs"."kind" in ('tts', 'illustration') and "learning_app"."generation_runs"."asset_id" is not null and "learning_app"."generation_runs"."deck_version_id" is null and "learning_app"."generation_runs"."expected_edit_number" is null)),
	CONSTRAINT "generation_runs_deck_without_lease" CHECK ("learning_app"."generation_runs"."kind" <> 'deck' or "learning_app"."generation_runs"."lease_token" is null)
);
--> statement-breakpoint
CREATE TABLE "learning_app"."item_revision_skills" (
	"item_revision_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"skill" text NOT NULL,
	"skill_version_id" uuid NOT NULL,
	CONSTRAINT "item_revision_skills_pk" PRIMARY KEY("item_revision_id","skill"),
	CONSTRAINT "item_revision_skills_revision_skill_version_unique" UNIQUE("item_revision_id","skill","skill_version_id")
);
--> statement-breakpoint
CREATE TABLE "learning_app"."item_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"deck_id" uuid NOT NULL,
	"deck_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"payload_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"target_key" text NOT NULL,
	CONSTRAINT "item_revisions_version_item_unique" UNIQUE("deck_version_id","item_id"),
	CONSTRAINT "item_revisions_version_position_unique" UNIQUE("deck_version_id","position"),
	CONSTRAINT "item_revisions_id_item_unique" UNIQUE("id","item_id"),
	CONSTRAINT "item_revisions_id_version_unique" UNIQUE("id","deck_version_id"),
	CONSTRAINT "item_revisions_position_nonnegative" CHECK ("learning_app"."item_revisions"."position" >= 0),
	CONSTRAINT "item_revisions_payload_version_positive" CHECK ("learning_app"."item_revisions"."payload_version" > 0),
	CONSTRAINT "item_revisions_payload_object" CHECK (jsonb_typeof("learning_app"."item_revisions"."payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "learning_app"."learning_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"child_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"client_event_id" uuid,
	"sealed" boolean DEFAULT false NOT NULL,
	"step_id" text NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "learning_events_child_client_id_unique" UNIQUE("child_id","client_event_id"),
	CONSTRAINT "learning_events_id_child_unique" UNIQUE("id","child_id"),
	CONSTRAINT "learning_events_kind_allowed" CHECK ("learning_app"."learning_events"."kind" in ('contact', 'prompt_issued', 'audio_issued', 'hint_issued', 'feedback_issued', 'display_confirmed', 'audio_played', 'presentation_completed'))
);
--> statement-breakpoint
CREATE TABLE "learning_app"."learning_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deck_id" uuid NOT NULL,
	"kind" text DEFAULT 'vocabulary' NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "learning_items_id_deck_unique" UNIQUE("id","deck_id")
);
--> statement-breakpoint
CREATE TABLE "learning_app"."learning_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_policies_config_object" CHECK (jsonb_typeof("learning_app"."learning_policies"."config") = 'object')
);
--> statement-breakpoint
CREATE TABLE "learning_app"."learning_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"child_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"deck_id" uuid NOT NULL,
	"deck_version_id" uuid NOT NULL,
	"policy_id" text NOT NULL,
	"microphone_enabled" boolean NOT NULL,
	"state" text NOT NULL,
	"task_budget" integer DEFAULT 12 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "learning_sessions_id_child_unique" UNIQUE("id","child_id"),
	CONSTRAINT "learning_sessions_id_version_unique" UNIQUE("id","deck_version_id"),
	CONSTRAINT "learning_sessions_state_allowed" CHECK ("learning_app"."learning_sessions"."state" in ('active', 'completed', 'ended')),
	CONSTRAINT "learning_sessions_budget_positive" CHECK ("learning_app"."learning_sessions"."task_budget" > 0),
	CONSTRAINT "learning_sessions_active_iff_not_ended" CHECK (("learning_app"."learning_sessions"."state" = 'active') = ("learning_app"."learning_sessions"."ended_at" is null))
);
--> statement-breakpoint
CREATE TABLE "learning_app"."media_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"generation_number" integer DEFAULT 1 NOT NULL,
	"state" text NOT NULL,
	"storage_key" text,
	"content_sha256" text,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"mime_type" text,
	"byte_count" bigint,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_fingerprint_generation_unique" UNIQUE("fingerprint","generation_number"),
	CONSTRAINT "media_assets_kind_allowed" CHECK ("learning_app"."media_assets"."kind" in ('tts', 'illustration')),
	CONSTRAINT "media_assets_generation_positive" CHECK ("learning_app"."media_assets"."generation_number" > 0),
	CONSTRAINT "media_assets_state_allowed" CHECK ("learning_app"."media_assets"."state" in ('pending', 'ready', 'failed')),
	CONSTRAINT "media_assets_byte_count_nonnegative" CHECK ("learning_app"."media_assets"."byte_count" is null or "learning_app"."media_assets"."byte_count" >= 0),
	CONSTRAINT "media_assets_lease_pairing" CHECK (("learning_app"."media_assets"."lease_token" is null) = ("learning_app"."media_assets"."lease_until" is null)),
	CONSTRAINT "media_assets_ready_complete" CHECK ("learning_app"."media_assets"."state" <> 'ready' or ("learning_app"."media_assets"."storage_key" is not null and "learning_app"."media_assets"."mime_type" is not null and "learning_app"."media_assets"."byte_count" is not null and "learning_app"."media_assets"."content_sha256" is not null and "learning_app"."media_assets"."lease_token" is null))
);
--> statement-breakpoint
CREATE TABLE "learning_app"."parent_credentials" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"password_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_credentials_single_row" CHECK ("learning_app"."parent_credentials"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "learning_app"."parent_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "parent_sessions_expires_after_creation" CHECK ("learning_app"."parent_sessions"."expires_at" > "learning_app"."parent_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "learning_app"."revision_assets" (
	"item_revision_id" uuid NOT NULL,
	"role" text NOT NULL,
	"asset_id" uuid,
	"expected_fingerprint" text NOT NULL,
	"state" text NOT NULL,
	CONSTRAINT "revision_assets_pk" PRIMARY KEY("item_revision_id","role"),
	CONSTRAINT "revision_assets_role_allowed" CHECK ("learning_app"."revision_assets"."role" in ('target_audio', 'example_audio', 'illustration')),
	CONSTRAINT "revision_assets_state_allowed" CHECK ("learning_app"."revision_assets"."state" in ('pending', 'approved', 'omitted')),
	CONSTRAINT "revision_assets_approved_has_asset" CHECK ("learning_app"."revision_assets"."state" <> 'approved' or "learning_app"."revision_assets"."asset_id" is not null),
	CONSTRAINT "revision_assets_only_illustration_omitted" CHECK ("learning_app"."revision_assets"."state" <> 'omitted' or "learning_app"."revision_assets"."role" = 'illustration')
);
--> statement-breakpoint
CREATE TABLE "learning_app"."session_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"deck_version_id" uuid NOT NULL,
	"item_revision_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"exercise_type" text NOT NULL,
	"direction" text,
	"state" text NOT NULL,
	"public_prompt" jsonb NOT NULL,
	"answer_key" jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_tasks_session_ordinal_unique" UNIQUE("session_id","ordinal"),
	CONSTRAINT "session_tasks_id_child_unique" UNIQUE("id","child_id"),
	CONSTRAINT "session_tasks_id_revision_unique" UNIQUE("id","item_revision_id"),
	CONSTRAINT "session_tasks_ordinal_nonnegative" CHECK ("learning_app"."session_tasks"."ordinal" >= 0),
	CONSTRAINT "session_tasks_state_allowed" CHECK ("learning_app"."session_tasks"."state" in ('issued', 'answered', 'completed', 'skipped')),
	CONSTRAINT "session_tasks_completed_only_exposure" CHECK ("learning_app"."session_tasks"."state" <> 'completed' or "learning_app"."session_tasks"."exercise_type" = 'exposure'),
	CONSTRAINT "session_tasks_answered_never_exposure" CHECK ("learning_app"."session_tasks"."state" <> 'answered' or "learning_app"."session_tasks"."exercise_type" <> 'exposure')
);
--> statement-breakpoint
CREATE TABLE "learning_app"."skill_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"skill" text NOT NULL,
	"revision_number" integer NOT NULL,
	"criteria" jsonb NOT NULL,
	"criteria_hash" text NOT NULL,
	"predecessor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_versions_item_skill_revision_unique" UNIQUE("item_id","skill","revision_number"),
	CONSTRAINT "skill_versions_id_item_skill_unique" UNIQUE("id","item_id","skill"),
	CONSTRAINT "skill_versions_revision_positive" CHECK ("learning_app"."skill_versions"."revision_number" > 0),
	CONSTRAINT "skill_versions_criteria_object" CHECK (jsonb_typeof("learning_app"."skill_versions"."criteria") = 'object')
);
--> statement-breakpoint
ALTER TABLE "learning_app"."assessments" ADD CONSTRAINT "assessments_child_id_child_profiles_id_fk" FOREIGN KEY ("child_id") REFERENCES "learning_app"."child_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."assessments" ADD CONSTRAINT "assessments_attempt_child_fk" FOREIGN KEY ("attempt_id","child_id") REFERENCES "learning_app"."attempts"("id","child_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."assessments" ADD CONSTRAINT "assessments_attempt_revision_fk" FOREIGN KEY ("attempt_id","item_revision_id") REFERENCES "learning_app"."attempts"("id","item_revision_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."assessments" ADD CONSTRAINT "assessments_revision_skill_fk" FOREIGN KEY ("item_revision_id","skill","skill_version_id") REFERENCES "learning_app"."item_revision_skills"("item_revision_id","skill","skill_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."assignments" ADD CONSTRAINT "assignments_child_id_child_profiles_id_fk" FOREIGN KEY ("child_id") REFERENCES "learning_app"."child_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."assignments" ADD CONSTRAINT "assignments_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "learning_app"."decks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."attempts" ADD CONSTRAINT "attempts_child_id_child_profiles_id_fk" FOREIGN KEY ("child_id") REFERENCES "learning_app"."child_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."attempts" ADD CONSTRAINT "attempts_policy_id_learning_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "learning_app"."learning_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."attempts" ADD CONSTRAINT "attempts_task_child_fk" FOREIGN KEY ("task_id","child_id") REFERENCES "learning_app"."session_tasks"("id","child_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."attempts" ADD CONSTRAINT "attempts_task_revision_fk" FOREIGN KEY ("task_id","item_revision_id") REFERENCES "learning_app"."session_tasks"("id","item_revision_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."child_skill_progress" ADD CONSTRAINT "child_skill_progress_child_id_child_profiles_id_fk" FOREIGN KEY ("child_id") REFERENCES "learning_app"."child_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."child_skill_progress" ADD CONSTRAINT "child_skill_progress_skill_version_id_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "learning_app"."skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."deck_versions" ADD CONSTRAINT "deck_versions_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "learning_app"."decks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."decks" ADD CONSTRAINT "published_version_belongs_to_deck" FOREIGN KEY ("published_version_id","id") REFERENCES "learning_app"."deck_versions"("id","deck_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."event_exposures" ADD CONSTRAINT "event_exposures_child_id_child_profiles_id_fk" FOREIGN KEY ("child_id") REFERENCES "learning_app"."child_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."event_exposures" ADD CONSTRAINT "event_exposures_event_fk" FOREIGN KEY ("event_id","child_id") REFERENCES "learning_app"."learning_events"("id","child_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."generation_runs" ADD CONSTRAINT "generation_runs_deck_version_id_deck_versions_id_fk" FOREIGN KEY ("deck_version_id") REFERENCES "learning_app"."deck_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."generation_runs" ADD CONSTRAINT "generation_runs_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "learning_app"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."item_revision_skills" ADD CONSTRAINT "item_revision_skills_revision_fk" FOREIGN KEY ("item_revision_id","item_id") REFERENCES "learning_app"."item_revisions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."item_revision_skills" ADD CONSTRAINT "item_revision_skills_skill_version_fk" FOREIGN KEY ("skill_version_id","item_id","skill") REFERENCES "learning_app"."skill_versions"("id","item_id","skill") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."item_revisions" ADD CONSTRAINT "item_revisions_item_fk" FOREIGN KEY ("item_id","deck_id") REFERENCES "learning_app"."learning_items"("id","deck_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."item_revisions" ADD CONSTRAINT "item_revisions_deck_version_fk" FOREIGN KEY ("deck_version_id","deck_id") REFERENCES "learning_app"."deck_versions"("id","deck_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_events" ADD CONSTRAINT "learning_events_child_id_child_profiles_id_fk" FOREIGN KEY ("child_id") REFERENCES "learning_app"."child_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_events" ADD CONSTRAINT "learning_events_item_id_learning_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "learning_app"."learning_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_events" ADD CONSTRAINT "learning_events_task_child_fk" FOREIGN KEY ("task_id","child_id") REFERENCES "learning_app"."session_tasks"("id","child_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_items" ADD CONSTRAINT "learning_items_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "learning_app"."decks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD CONSTRAINT "learning_sessions_child_id_child_profiles_id_fk" FOREIGN KEY ("child_id") REFERENCES "learning_app"."child_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD CONSTRAINT "learning_sessions_policy_id_learning_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "learning_app"."learning_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD CONSTRAINT "learning_sessions_assignment_fk" FOREIGN KEY ("assignment_id","child_id","deck_id") REFERENCES "learning_app"."assignments"("id","child_id","deck_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD CONSTRAINT "learning_sessions_deck_version_fk" FOREIGN KEY ("deck_version_id","deck_id") REFERENCES "learning_app"."deck_versions"("id","deck_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."revision_assets" ADD CONSTRAINT "revision_assets_item_revision_id_item_revisions_id_fk" FOREIGN KEY ("item_revision_id") REFERENCES "learning_app"."item_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."revision_assets" ADD CONSTRAINT "revision_assets_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "learning_app"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."session_tasks" ADD CONSTRAINT "session_tasks_session_child_fk" FOREIGN KEY ("session_id","child_id") REFERENCES "learning_app"."learning_sessions"("id","child_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."session_tasks" ADD CONSTRAINT "session_tasks_session_version_fk" FOREIGN KEY ("session_id","deck_version_id") REFERENCES "learning_app"."learning_sessions"("id","deck_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."session_tasks" ADD CONSTRAINT "session_tasks_revision_fk" FOREIGN KEY ("item_revision_id","deck_version_id") REFERENCES "learning_app"."item_revisions"("id","deck_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."skill_versions" ADD CONSTRAINT "skill_versions_item_id_learning_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "learning_app"."learning_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessments_skill_history_idx" ON "learning_app"."assessments" USING btree ("skill_version_id","attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_processing_attempt_per_task" ON "learning_app"."attempts" USING btree ("task_id") WHERE "learning_app"."attempts"."state" = 'processing';--> statement-breakpoint
CREATE INDEX "attempts_stale_idx" ON "learning_app"."attempts" USING btree ("received_at") WHERE "learning_app"."attempts"."state" = 'processing';--> statement-breakpoint
CREATE INDEX "child_skill_due_idx" ON "learning_app"."child_skill_progress" USING btree ("child_id","next_review_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_editable_version_per_deck" ON "learning_app"."deck_versions" USING btree ("deck_id") WHERE "learning_app"."deck_versions"."state" in ('draft', 'review');--> statement-breakpoint
CREATE INDEX "event_exposures_target_idx" ON "learning_app"."event_exposures" USING btree ("target_key","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_run_per_asset" ON "learning_app"."generation_runs" USING btree ("asset_id") WHERE "learning_app"."generation_runs"."asset_id" is not null;--> statement-breakpoint
CREATE INDEX "generation_runs_state_idx" ON "learning_app"."generation_runs" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "learning_events_contact_idx" ON "learning_app"."learning_events" USING btree ("child_id","item_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_session_per_child" ON "learning_app"."learning_sessions" USING btree ("child_id") WHERE "learning_app"."learning_sessions"."state" = 'active';--> statement-breakpoint
CREATE INDEX "learning_sessions_child_time_idx" ON "learning_app"."learning_sessions" USING btree ("child_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "parent_sessions_expiry_idx" ON "learning_app"."parent_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_issued_task_per_session" ON "learning_app"."session_tasks" USING btree ("session_id") WHERE "learning_app"."session_tasks"."state" = 'issued';