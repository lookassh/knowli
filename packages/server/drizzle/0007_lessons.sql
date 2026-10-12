CREATE TABLE "learning_app"."child_objective_progress" (
	"child_id" uuid NOT NULL,
	"subject_id" text NOT NULL,
	"objective_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"status" text NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"next_review_at" timestamp with time zone,
	"last_independent_at" timestamp with time zone,
	"projection_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "child_objective_progress_pk" PRIMARY KEY("child_id","subject_id","objective_id"),
	CONSTRAINT "child_objective_progress_status_allowed" CHECK ("learning_app"."child_objective_progress"."status" in ('unseen', 'practicing', 'needs_confirmation', 'needs_reconfirmation', 'mastered')),
	CONSTRAINT "child_objective_progress_streak_nonnegative" CHECK ("learning_app"."child_objective_progress"."streak" >= 0)
);
--> statement-breakpoint
CREATE TABLE "learning_app"."lesson_verdicts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_revision_id" uuid NOT NULL,
	"normalized_answer" text NOT NULL,
	"prompt_version" text NOT NULL,
	"grader_model" text NOT NULL,
	"verdict" text NOT NULL,
	"error_category" text,
	"fragments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"parent_decision" text,
	"parent_decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_verdicts_cache_key_unique" UNIQUE("item_revision_id","normalized_answer","prompt_version"),
	CONSTRAINT "lesson_verdicts_verdict_allowed" CHECK ("learning_app"."lesson_verdicts"."verdict" in ('correct', 'almost', 'incorrect')),
	CONSTRAINT "lesson_verdicts_parent_decision_allowed" CHECK ("learning_app"."lesson_verdicts"."parent_decision" is null or "learning_app"."lesson_verdicts"."parent_decision" in ('confirmed', 'overridden_correct', 'overridden_incorrect')),
	CONSTRAINT "lesson_verdicts_parent_decision_pairing" CHECK (("learning_app"."lesson_verdicts"."parent_decision" is null) = ("learning_app"."lesson_verdicts"."parent_decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "learning_app"."assignments" DROP CONSTRAINT "assignments_test_goals";--> statement-breakpoint
ALTER TABLE "learning_app"."attempts" DROP CONSTRAINT "attempts_modality_allowed";--> statement-breakpoint
ALTER TABLE "learning_app"."generation_runs" DROP CONSTRAINT "generation_runs_kind_allowed";--> statement-breakpoint
ALTER TABLE "learning_app"."generation_runs" DROP CONSTRAINT "generation_runs_kind_shape";--> statement-breakpoint
ALTER TABLE "learning_app"."generation_runs" DROP CONSTRAINT "generation_runs_deck_without_lease";--> statement-breakpoint
ALTER TABLE "learning_app"."session_tasks" DROP CONSTRAINT "session_tasks_completed_only_exposure";--> statement-breakpoint
ALTER TABLE "learning_app"."deck_versions" ADD COLUMN "lesson_context" jsonb;--> statement-breakpoint
ALTER TABLE "learning_app"."child_objective_progress" ADD CONSTRAINT "child_objective_progress_child_id_child_profiles_id_fk" FOREIGN KEY ("child_id") REFERENCES "learning_app"."child_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_app"."lesson_verdicts" ADD CONSTRAINT "lesson_verdicts_item_revision_id_item_revisions_id_fk" FOREIGN KEY ("item_revision_id") REFERENCES "learning_app"."item_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "child_objective_progress_due_idx" ON "learning_app"."child_objective_progress" USING btree ("child_id","next_review_at");--> statement-breakpoint
CREATE INDEX "lesson_verdicts_revision_idx" ON "learning_app"."lesson_verdicts" USING btree ("item_revision_id");--> statement-breakpoint
ALTER TABLE "learning_app"."assignments" ADD CONSTRAINT "assignments_test_goals" CHECK ("learning_app"."assignments"."test_goals" is null or (cardinality("learning_app"."assignments"."test_goals") between 1 and 3 and "learning_app"."assignments"."test_goals" <@ array['recall','spelling','listening','lesson']::text[] and cardinality(array_positions("learning_app"."assignments"."test_goals", 'recall')) <= 1 and cardinality(array_positions("learning_app"."assignments"."test_goals", 'spelling')) <= 1 and cardinality(array_positions("learning_app"."assignments"."test_goals", 'listening')) <= 1 and cardinality(array_positions("learning_app"."assignments"."test_goals", 'lesson')) <= 1 and array_position("learning_app"."assignments"."test_goals", null) is null and (array_position("learning_app"."assignments"."test_goals", 'lesson') is null or "learning_app"."assignments"."test_goals" = array['lesson']::text[])));--> statement-breakpoint
ALTER TABLE "learning_app"."attempts" ADD CONSTRAINT "attempts_modality_allowed" CHECK ("learning_app"."attempts"."modality" in ('choice', 'text', 'audio', 'dont_remember', 'skip', 'sequence'));--> statement-breakpoint
ALTER TABLE "learning_app"."decks" ADD CONSTRAINT "decks_kind_allowed" CHECK ("learning_app"."decks"."kind" in ('vocabulary', 'lesson'));--> statement-breakpoint
ALTER TABLE "learning_app"."generation_runs" ADD CONSTRAINT "generation_runs_kind_allowed" CHECK ("learning_app"."generation_runs"."kind" in ('deck', 'lesson', 'tts', 'illustration'));--> statement-breakpoint
ALTER TABLE "learning_app"."generation_runs" ADD CONSTRAINT "generation_runs_kind_shape" CHECK (("learning_app"."generation_runs"."kind" in ('deck', 'lesson') and "learning_app"."generation_runs"."deck_version_id" is not null and "learning_app"."generation_runs"."expected_edit_number" is not null and "learning_app"."generation_runs"."asset_id" is null) or ("learning_app"."generation_runs"."kind" in ('tts', 'illustration') and "learning_app"."generation_runs"."asset_id" is not null and "learning_app"."generation_runs"."deck_version_id" is null and "learning_app"."generation_runs"."expected_edit_number" is null));--> statement-breakpoint
ALTER TABLE "learning_app"."generation_runs" ADD CONSTRAINT "generation_runs_deck_without_lease" CHECK ("learning_app"."generation_runs"."kind" not in ('deck', 'lesson') or "learning_app"."generation_runs"."lease_token" is null);--> statement-breakpoint
ALTER TABLE "learning_app"."learning_items" ADD CONSTRAINT "learning_items_kind_allowed" CHECK ("learning_app"."learning_items"."kind" in ('vocabulary', 'lesson_exercise'));--> statement-breakpoint
ALTER TABLE "learning_app"."session_tasks" ADD CONSTRAINT "session_tasks_completed_only_exposure" CHECK ("learning_app"."session_tasks"."state" <> 'completed' or "learning_app"."session_tasks"."exercise_type" in ('exposure', 'lesson_card'));--> statement-breakpoint
-- Triggery warstwy lekcji (dopisane ręcznie, jak w 0004_mock_tests.sql).
-- Komunikaty RAISE EXCEPTION krótkie, po angielsku, bez danych użytkownika.
--
-- decks.kind jest niezmienny po utworzeniu; pozostałe kolumny można edytować.
CREATE FUNCTION learning_app.guard_deck_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'Deck kind is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER decks_kind_immutable BEFORE UPDATE ON learning_app.decks
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_deck_kind();
--> statement-breakpoint
-- learning_items.kind musi być zgodny z decks.kind:
-- vocabulary <-> vocabulary, lesson <-> lesson_exercise.
CREATE FUNCTION learning_app.guard_item_kind_matches_deck() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deck_kind text;
BEGIN
  SELECT kind INTO deck_kind FROM learning_app.decks WHERE id = NEW.deck_id;
  IF deck_kind = 'vocabulary' AND NEW.kind <> 'vocabulary' THEN
    RAISE EXCEPTION 'Learning item kind must match a vocabulary deck';
  END IF;
  IF deck_kind = 'lesson' AND NEW.kind <> 'lesson_exercise' THEN
    RAISE EXCEPTION 'Learning item kind must match a lesson deck';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_items_kind_matches_deck BEFORE INSERT OR UPDATE ON learning_app.learning_items
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_item_kind_matches_deck();
--> statement-breakpoint
-- deck_versions.lesson_context: wymagany dla zestawów lesson, zabroniony dla
-- vocabulary. Niezmienność po publikacji egzekwuje istniejący trigger
-- deck_versions_immutable (guard_published_version) z 0001 — każda zmiana
-- opublikowanej wersji jest już odrzucana ('Published version is immutable').
CREATE FUNCTION learning_app.guard_deck_version_lesson_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deck_kind text;
BEGIN
  SELECT kind INTO deck_kind FROM learning_app.decks WHERE id = NEW.deck_id;
  IF deck_kind = 'lesson' AND NEW.lesson_context IS NULL THEN
    RAISE EXCEPTION 'Lesson deck version requires lesson_context';
  END IF;
  IF deck_kind = 'vocabulary' AND NEW.lesson_context IS NOT NULL THEN
    RAISE EXCEPTION 'Vocabulary deck version must not carry lesson_context';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER deck_versions_lesson_context BEFORE INSERT OR UPDATE ON learning_app.deck_versions
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_deck_version_lesson_context();
--> statement-breakpoint
-- assignments.test_goals: cel 'lesson' tylko dla zestawów lesson; cele słówek
-- (recall/spelling/listening) tylko dla zestawów vocabulary. Membership,
-- krotność i wzajemne wykluczenie 'lesson' pilnuje CHECK assignments_test_goals.
CREATE FUNCTION learning_app.guard_assignment_test_goals_kind() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deck_kind text;
BEGIN
  IF NEW.test_goals IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT kind INTO deck_kind FROM learning_app.decks WHERE id = NEW.deck_id;
  IF 'lesson' = ANY(NEW.test_goals) AND deck_kind <> 'lesson' THEN
    RAISE EXCEPTION 'Lesson test goal requires a lesson deck';
  END IF;
  IF NEW.test_goals && array['recall','spelling','listening']::text[] AND deck_kind <> 'vocabulary' THEN
    RAISE EXCEPTION 'Vocabulary test goals require a vocabulary deck';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assignments_test_goals_kind BEFORE INSERT OR UPDATE ON learning_app.assignments
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_assignment_test_goals_kind();