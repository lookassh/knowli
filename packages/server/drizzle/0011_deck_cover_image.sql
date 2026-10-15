ALTER TABLE "learning_app"."media_assets" DROP CONSTRAINT "media_assets_kind_allowed";
--> statement-breakpoint
ALTER TABLE "learning_app"."media_assets" ADD CONSTRAINT "media_assets_kind_allowed" CHECK ("learning_app"."media_assets"."kind" in ('tts', 'illustration', 'deck_cover'));
--> statement-breakpoint
ALTER TABLE "learning_app"."decks" ADD COLUMN "cover_asset_id" uuid;
--> statement-breakpoint
ALTER TABLE "learning_app"."decks" ADD CONSTRAINT "decks_cover_asset_id_media_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "learning_app"."media_assets"("id");
--> statement-breakpoint
CREATE FUNCTION learning_app.guard_deck_cover_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cover_asset_id IS NOT NULL THEN
    IF NEW.kind <> 'vocabulary' OR NOT EXISTS (
      SELECT 1 FROM learning_app.media_assets
      WHERE id = NEW.cover_asset_id AND kind = 'deck_cover' AND state = 'ready'
    ) THEN
      RAISE EXCEPTION 'deck cover must reference a ready deck_cover asset on a vocabulary deck';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER decks_cover_asset_guard
  BEFORE INSERT OR UPDATE OF cover_asset_id, kind ON learning_app.decks
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_deck_cover_asset();
