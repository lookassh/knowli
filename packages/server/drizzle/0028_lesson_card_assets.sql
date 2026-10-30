-- Nagrania „Posłuchaj karty” (design szkoły §12.2): karta nauki żyje
-- w `lesson_context.dynamicTopic` wersji, a nie w rewizji ćwiczenia, więc jej
-- nagranie wiąże się z wersją przez (zagadnienie, numer karty). Bez stanu
-- decyzji — nagranie nie jest decyzją rodzica. Wiersze opublikowanej wersji
-- są niezmienne, jak `revision_assets`.
CREATE TABLE "learning_app"."lesson_card_assets" (
	"deck_version_id" uuid NOT NULL,
	"objective_id" text NOT NULL,
	"card_index" integer NOT NULL,
	"asset_id" uuid,
	"expected_fingerprint" text NOT NULL,
	CONSTRAINT "lesson_card_assets_pk" PRIMARY KEY("deck_version_id","objective_id","card_index"),
	CONSTRAINT "lesson_card_assets_card_index_nonnegative" CHECK ("learning_app"."lesson_card_assets"."card_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "learning_app"."lesson_card_assets" ADD CONSTRAINT "lesson_card_assets_deck_version_id_deck_versions_id_fk" FOREIGN KEY ("deck_version_id") REFERENCES "learning_app"."deck_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_app"."lesson_card_assets" ADD CONSTRAINT "lesson_card_assets_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "learning_app"."media_assets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "lesson_card_assets_asset_idx" ON "learning_app"."lesson_card_assets" USING btree ("asset_id");
--> statement-breakpoint
CREATE FUNCTION learning_app.guard_lesson_card_asset_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_version uuid;
  new_version uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_version := OLD.deck_version_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_version := NEW.deck_version_id; END IF;
  -- Blokada wiersza wersji serializuje edycję i publikację (jak guard_revision_change).
  PERFORM 1 FROM learning_app.deck_versions WHERE id IN (old_version,new_version) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM learning_app.deck_versions WHERE id IN (old_version,new_version) AND state='published')
    THEN RAISE EXCEPTION 'Published lesson card asset is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER lesson_card_assets_immutable BEFORE INSERT OR UPDATE OR DELETE ON learning_app.lesson_card_assets
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_lesson_card_asset_change();
