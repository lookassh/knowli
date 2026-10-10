ALTER TABLE "learning_app"."assignments" ADD COLUMN "test_goals" text[];--> statement-breakpoint
ALTER TABLE "learning_app"."assignments" ADD COLUMN "mock_test_task_count" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD COLUMN "mode" text DEFAULT 'training' NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD COLUMN "mock_test_plan" jsonb;--> statement-breakpoint
ALTER TABLE "learning_app"."assignments" ADD CONSTRAINT "assignments_mock_test_count" CHECK ("learning_app"."assignments"."mock_test_task_count" between 1 and 100);--> statement-breakpoint
ALTER TABLE "learning_app"."assignments" ADD CONSTRAINT "assignments_test_goals" CHECK ("learning_app"."assignments"."test_goals" is null or (cardinality("learning_app"."assignments"."test_goals") between 1 and 3 and "learning_app"."assignments"."test_goals" <@ array['recall','spelling','listening']::text[] and cardinality(array_positions("learning_app"."assignments"."test_goals", 'recall')) <= 1 and cardinality(array_positions("learning_app"."assignments"."test_goals", 'spelling')) <= 1 and cardinality(array_positions("learning_app"."assignments"."test_goals", 'listening')) <= 1 and array_position("learning_app"."assignments"."test_goals", null) is null));--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD CONSTRAINT "learning_sessions_mode_plan" CHECK (("learning_app"."learning_sessions"."mode" = 'training' and "learning_app"."learning_sessions"."mock_test_plan" is null) or ("learning_app"."learning_sessions"."mode" = 'mock_test' and "learning_app"."learning_sessions"."mock_test_plan" is not null));--> statement-breakpoint
CREATE FUNCTION learning_app.guard_mock_test_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mode IS DISTINCT FROM OLD.mode OR NEW.mock_test_plan IS DISTINCT FROM OLD.mock_test_plan THEN
    RAISE EXCEPTION 'Session mode and mock test plan are immutable';
  END IF;
  IF OLD.context ? 'mockTestReport' AND (NEW.context->'mockTestReport') IS DISTINCT FROM (OLD.context->'mockTestReport') THEN
    RAISE EXCEPTION 'Closed mock test report is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_sessions_mock_plan BEFORE UPDATE ON learning_app.learning_sessions FOR EACH ROW EXECUTE FUNCTION learning_app.guard_mock_test_plan();
