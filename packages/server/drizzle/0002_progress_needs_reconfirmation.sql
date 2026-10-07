-- Zadanie 7: status „do ponownego potwierdzenia” po błędzie/„Nie pamiętam”
-- w niezależnym sprawdzaniu opanowanej umiejętności (SPEC §18.5). Historia
-- pozostaje; odzyskanie mastered wymaga ponownego spełnienia warunków.
ALTER TABLE learning_app.child_skill_progress
  DROP CONSTRAINT child_skill_progress_status_allowed;
--> statement-breakpoint
ALTER TABLE learning_app.child_skill_progress
  ADD CONSTRAINT child_skill_progress_status_allowed
  CHECK (status IN ('unseen','practicing','needs_confirmation','needs_reconfirmation','mastered'));
