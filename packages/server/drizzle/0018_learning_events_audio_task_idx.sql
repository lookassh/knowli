CREATE INDEX "learning_events_audio_task_occurred_idx"
  ON "learning_app"."learning_events" USING btree ("task_id", "occurred_at")
  WHERE "kind" = 'audio_issued' AND "sealed" = true;
