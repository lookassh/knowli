-- Zachowaj stare wiersze do jawnego backfillu z historii. Nie przypisuj ich
-- automatycznie do bieżącej polityki profilu.
ALTER TABLE learning_app.child_profiles
  ADD COLUMN learning_projection_version text DEFAULT 'proj-3';
--> statement-breakpoint
UPDATE learning_app.child_profiles
   SET learning_projection_version = NULL;
--> statement-breakpoint
ALTER TABLE learning_app.child_skill_progress
  RENAME TO child_skill_progress_legacy;
--> statement-breakpoint
ALTER TABLE learning_app.child_skill_progress_legacy
  RENAME CONSTRAINT child_skill_progress_pk TO child_skill_progress_legacy_pk;
--> statement-breakpoint
ALTER TABLE learning_app.child_skill_progress_legacy
  RENAME CONSTRAINT child_skill_progress_status_allowed TO child_skill_progress_legacy_status_allowed;
--> statement-breakpoint
ALTER TABLE learning_app.child_skill_progress_legacy
  RENAME CONSTRAINT child_skill_progress_streak_nonnegative TO child_skill_progress_legacy_streak_nonnegative;
--> statement-breakpoint
ALTER TABLE learning_app.child_skill_progress_legacy
  RENAME CONSTRAINT child_skill_progress_child_id_child_profiles_id_fk TO child_skill_progress_legacy_child_id_child_profiles_id_fk;
--> statement-breakpoint
ALTER TABLE learning_app.child_skill_progress_legacy
  RENAME CONSTRAINT child_skill_progress_skill_version_id_skill_versions_id_fk TO child_skill_progress_legacy_skill_version_id_skill_versions_id_fk;
--> statement-breakpoint
ALTER INDEX learning_app.child_skill_due_idx
  RENAME TO child_skill_due_legacy_idx;
--> statement-breakpoint
CREATE TABLE learning_app.child_skill_progress (
  child_id uuid NOT NULL,
  skill_version_id uuid NOT NULL,
  policy_id text NOT NULL,
  status text NOT NULL,
  independent_success_streak integer NOT NULL DEFAULT 0,
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  delayed_confirmation_at timestamptz,
  first_issued_at timestamptz,
  has_qualifying_assessment boolean NOT NULL DEFAULT false,
  projection_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT child_skill_progress_pk PRIMARY KEY (child_id, skill_version_id, policy_id),
  CONSTRAINT child_skill_progress_status_allowed CHECK (status in ('unseen', 'practicing', 'needs_confirmation', 'needs_reconfirmation', 'mastered')),
  CONSTRAINT child_skill_progress_streak_nonnegative CHECK (independent_success_streak >= 0),
  CONSTRAINT child_skill_progress_child_id_child_profiles_id_fk FOREIGN KEY (child_id) REFERENCES learning_app.child_profiles(id) ON DELETE CASCADE,
  CONSTRAINT child_skill_progress_skill_version_id_skill_versions_id_fk FOREIGN KEY (skill_version_id) REFERENCES learning_app.skill_versions(id),
  CONSTRAINT child_skill_progress_policy_id_learning_policies_id_fk FOREIGN KEY (policy_id) REFERENCES learning_app.learning_policies(id)
);
--> statement-breakpoint
CREATE INDEX child_skill_due_idx ON learning_app.child_skill_progress (child_id, next_review_at);
--> statement-breakpoint
CREATE INDEX child_skill_policy_idx ON learning_app.child_skill_progress (child_id, policy_id, skill_version_id);
--> statement-breakpoint
CREATE TABLE learning_app.child_target_exposures (
  child_id uuid NOT NULL,
  target_key text NOT NULL,
  first_exposure_at timestamptz NOT NULL,
  last_exposure_at timestamptz NOT NULL,
  CONSTRAINT child_target_exposures_pk PRIMARY KEY (child_id, target_key),
  CONSTRAINT child_target_exposures_child_id_child_profiles_id_fk FOREIGN KEY (child_id) REFERENCES learning_app.child_profiles(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX child_target_exposures_target_idx ON learning_app.child_target_exposures (target_key, child_id);
