ALTER TABLE "learning_app"."child_profiles" ADD COLUMN "can_read" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_app"."deck_versions" ADD COLUMN "vocabulary_format" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_app"."deck_versions" ADD CONSTRAINT "deck_versions_vocabulary_format_allowed" CHECK ("learning_app"."deck_versions"."vocabulary_format" in ('standard', 'picture'));
--> statement-breakpoint
CREATE FUNCTION learning_app.guard_vocabulary_format_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.vocabulary_format = 'picture'
     AND EXISTS (SELECT 1 FROM learning_app.decks WHERE id = NEW.deck_id AND kind = 'lesson') THEN
    RAISE EXCEPTION 'Lesson versions must use standard vocabulary format';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER deck_versions_vocabulary_format_kind
  BEFORE INSERT OR UPDATE OF vocabulary_format, deck_id ON learning_app.deck_versions
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_vocabulary_format_kind();
