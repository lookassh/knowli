-- Reguły niezmienności i zabezpieczenia z docs/schema.sql (projekt 1.2).
-- Historie kasujemy tylko przez usunięcie profilu; wersji kryteriów, polityk
-- i opublikowanych materiałów nie edytujemy. Wszystko jawnie w schemacie
-- learning_app, bez zmiany search_path.
INSERT INTO learning_app.family_settings (id, timezone) VALUES (1, 'Europe/Warsaw');
--> statement-breakpoint
-- Kompozytowy self-FK wyjęty z definicji Drizzle (cykl self-referencji
-- nieinferowalny w TS); semantyka identyczna z docs/schema.sql.
ALTER TABLE learning_app.skill_versions
  ADD CONSTRAINT skill_versions_predecessor_fk
  FOREIGN KEY (predecessor_id, item_id, skill)
  REFERENCES learning_app.skill_versions(id, item_id, skill);
--> statement-breakpoint
CREATE FUNCTION learning_app.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Immutable row in %', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_policies_immutable BEFORE UPDATE OR DELETE ON learning_app.learning_policies
  FOR EACH ROW EXECUTE FUNCTION learning_app.reject_change();
--> statement-breakpoint
CREATE TRIGGER skill_versions_immutable BEFORE UPDATE OR DELETE ON learning_app.skill_versions
  FOR EACH ROW EXECUTE FUNCTION learning_app.reject_change();
--> statement-breakpoint
CREATE FUNCTION learning_app.guard_published_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'published' THEN RAISE EXCEPTION 'Published version is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER deck_versions_immutable BEFORE UPDATE OR DELETE ON learning_app.deck_versions
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_published_version();
--> statement-breakpoint
CREATE FUNCTION learning_app.guard_revision_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_version uuid; new_version uuid;
BEGIN
  IF TG_TABLE_NAME = 'item_revisions' THEN
    IF TG_OP <> 'INSERT' THEN old_version := OLD.deck_version_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_version := NEW.deck_version_id; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      SELECT deck_version_id INTO old_version FROM learning_app.item_revisions WHERE id=OLD.item_revision_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT deck_version_id INTO new_version FROM learning_app.item_revisions WHERE id=NEW.item_revision_id;
    END IF;
  END IF;
  -- Blokada wiersza wersji serializuje edycję i publikację.
  PERFORM 1 FROM learning_app.deck_versions WHERE id IN (old_version,new_version) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM learning_app.deck_versions WHERE id IN (old_version,new_version) AND state='published')
    THEN RAISE EXCEPTION 'Published revision is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER item_revisions_immutable BEFORE INSERT OR UPDATE OR DELETE ON learning_app.item_revisions
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_revision_change();
--> statement-breakpoint
CREATE TRIGGER item_revision_skills_immutable BEFORE INSERT OR UPDATE OR DELETE ON learning_app.item_revision_skills
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_revision_change();
--> statement-breakpoint
CREATE TRIGGER revision_assets_immutable BEFORE INSERT OR UPDATE OR DELETE ON learning_app.revision_assets
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_revision_change();
--> statement-breakpoint
CREATE FUNCTION learning_app.guard_completed_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='completed' THEN RAISE EXCEPTION 'Completed attempt is immutable'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','answer','feedback','completed_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','answer','feedback','completed_at']) THEN
    RAISE EXCEPTION 'Attempt identity and qualification context are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER attempts_immutable_after_completion BEFORE UPDATE ON learning_app.attempts
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_completed_attempt();
--> statement-breakpoint
-- Usunięcie profilu ma nadal działać przez CASCADE.
CREATE TRIGGER assessments_no_update BEFORE UPDATE ON learning_app.assessments
  FOR EACH ROW EXECUTE FUNCTION learning_app.reject_change();
--> statement-breakpoint
CREATE FUNCTION learning_app.guard_ready_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='ready' THEN RAISE EXCEPTION 'Ready media is immutable; create a new generation'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER media_ready_immutable BEFORE UPDATE OR DELETE ON learning_app.media_assets
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_ready_asset();
--> statement-breakpoint
CREATE FUNCTION learning_app.guard_task_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') THEN
    RAISE EXCEPTION 'Issued task snapshot is immutable';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND OLD.state <> 'issued' THEN
    RAISE EXCEPTION 'Terminal task cannot be reopened';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER session_tasks_snapshot BEFORE UPDATE ON learning_app.session_tasks
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_task_snapshot();
--> statement-breakpoint
CREATE FUNCTION learning_app.guard_assessment_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt_state text;
BEGIN
  SELECT state INTO attempt_state FROM learning_app.attempts WHERE id=NEW.attempt_id FOR UPDATE;
  IF attempt_state IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'Assessments may only be inserted before attempt finalization';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assessments_insert_guard BEFORE INSERT ON learning_app.assessments
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_assessment_insert();
--> statement-breakpoint
-- Ujawnienie tworzymy wraz z pełną listą target_key, następnie seal w tej samej transakcji.
CREATE FUNCTION learning_app.guard_event_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sealed OR NOT NEW.sealed OR
      (to_jsonb(NEW)-'sealed') IS DISTINCT FROM (to_jsonb(OLD)-'sealed') THEN
    RAISE EXCEPTION 'Event permits only one sealing transition';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER learning_events_seal BEFORE UPDATE ON learning_app.learning_events
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_event_seal();
--> statement-breakpoint
CREATE FUNCTION learning_app.require_sealed_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM learning_app.learning_events WHERE id=NEW.id AND NOT sealed) THEN
    RAISE EXCEPTION 'Event must be sealed before commit';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER learning_events_sealed_at_commit AFTER INSERT OR UPDATE ON learning_app.learning_events
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION learning_app.require_sealed_event();
--> statement-breakpoint
CREATE FUNCTION learning_app.guard_exposure_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_sealed boolean;
BEGIN
  SELECT sealed INTO event_sealed FROM learning_app.learning_events WHERE id=NEW.event_id FOR UPDATE;
  IF event_sealed IS DISTINCT FROM false THEN RAISE EXCEPTION 'Cannot extend sealed disclosure'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER event_exposures_insert_guard BEFORE INSERT ON learning_app.event_exposures
  FOR EACH ROW EXECUTE FUNCTION learning_app.guard_exposure_insert();
--> statement-breakpoint
CREATE TRIGGER event_exposures_no_update BEFORE UPDATE ON learning_app.event_exposures
  FOR EACH ROW EXECUTE FUNCTION learning_app.reject_change();
--> statement-breakpoint
-- Kontrolowane usuwanie wyłącznie przez CASCADE po DELETE profilu.
-- Brak flagi sesji SQL pozwalającej aplikacji wyłączyć ochronę.
CREATE FUNCTION learning_app.guard_history_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM learning_app.child_profiles WHERE id=OLD.child_id) THEN
    RAISE EXCEPTION 'Delete the child profile to erase learning history';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sessions_delete_guard BEFORE DELETE ON learning_app.learning_sessions FOR EACH ROW EXECUTE FUNCTION learning_app.guard_history_delete();
--> statement-breakpoint
CREATE TRIGGER tasks_delete_guard BEFORE DELETE ON learning_app.session_tasks FOR EACH ROW EXECUTE FUNCTION learning_app.guard_history_delete();
--> statement-breakpoint
CREATE TRIGGER attempts_delete_guard BEFORE DELETE ON learning_app.attempts FOR EACH ROW EXECUTE FUNCTION learning_app.guard_history_delete();
--> statement-breakpoint
CREATE TRIGGER assessments_delete_guard BEFORE DELETE ON learning_app.assessments FOR EACH ROW EXECUTE FUNCTION learning_app.guard_history_delete();
--> statement-breakpoint
CREATE TRIGGER events_delete_guard BEFORE DELETE ON learning_app.learning_events FOR EACH ROW EXECUTE FUNCTION learning_app.guard_history_delete();
--> statement-breakpoint
CREATE TRIGGER exposures_delete_guard BEFORE DELETE ON learning_app.event_exposures FOR EACH ROW EXECUTE FUNCTION learning_app.guard_history_delete();
