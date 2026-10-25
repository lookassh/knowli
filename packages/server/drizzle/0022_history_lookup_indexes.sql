CREATE INDEX "assessments_child_skill_idx"
  ON "learning_app"."assessments" USING btree ("child_id", "skill_version_id", "skill");
--> statement-breakpoint
CREATE INDEX "attempts_child_received_idx"
  ON "learning_app"."attempts" USING btree ("child_id", "received_at" DESC);
--> statement-breakpoint
CREATE INDEX "attempts_item_revision_idx"
  ON "learning_app"."attempts" USING btree ("item_revision_id");
--> statement-breakpoint
CREATE INDEX "session_tasks_child_issued_idx"
  ON "learning_app"."session_tasks" USING btree ("child_id", "issued_at");
--> statement-breakpoint
CREATE INDEX "session_tasks_revision_issued_idx"
  ON "learning_app"."session_tasks" USING btree ("item_revision_id", "issued_at");
--> statement-breakpoint
CREATE INDEX "learning_events_child_occurred_idx"
  ON "learning_app"."learning_events" USING btree ("child_id", "occurred_at" DESC);
--> statement-breakpoint
CREATE INDEX "event_exposures_child_target_idx"
  ON "learning_app"."event_exposures" USING btree ("child_id", "target_key");
