ALTER TABLE "learning_app"."learning_sessions" ADD COLUMN "training_plan" jsonb;--> statement-breakpoint
ALTER TABLE "learning_app"."learning_sessions" ADD CONSTRAINT "learning_sessions_training_plan_mode" CHECK ("learning_app"."learning_sessions"."training_plan" is null or ("learning_app"."learning_sessions"."mode" = 'training' and "learning_app"."learning_sessions"."mock_test_plan" is null));
--> statement-breakpoint
CREATE FUNCTION learning_app.guard_training_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.training_plan IS NOT NULL AND NEW.training_plan IS DISTINCT FROM OLD.training_plan THEN
    RAISE EXCEPTION 'Training session plan is immutable';
  END IF;
  IF OLD.training_plan IS NULL AND NEW.training_plan IS NOT NULL AND
     (NEW.mode <> 'training' OR NEW.state <> 'active' OR EXISTS (
       SELECT 1 FROM learning_app.session_tasks WHERE session_id = OLD.id
     )) THEN
    RAISE EXCEPTION 'Training session plan can only be attached before issuing tasks';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_sessions_training_plan_immutable BEFORE UPDATE ON learning_app.learning_sessions FOR EACH ROW EXECUTE FUNCTION learning_app.guard_training_plan();
