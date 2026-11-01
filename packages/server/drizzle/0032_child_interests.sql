-- Zainteresowania dziecka (spec 2026-11-01 „Tematy zdań z zainteresowań dziecka”, §4.1):
-- do 5 krótkich tematów zdań, które rodzic wpisuje w profilu; generator lekcji gramatyki
-- może użyć ich w zdaniach przykładowych. Kolumna wyłącznie dla panelu rodzica (Kid DTO
-- jej nie czyta). Istniejące profile dostają pustą listę. Format elementów (długość, znaki)
-- pilnuje kontrakt `ChildInterestsSchema`; CHECK broni liczności i braku NULL-i w tablicy.
-- Ręcznie pisany SQL: snapshoty drizzle po 0017 są znanym długiem.
ALTER TABLE "learning_app"."child_profiles" ADD COLUMN "interests" text[] DEFAULT ARRAY[]::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "learning_app"."child_profiles" ADD CONSTRAINT "child_profiles_interests_valid" CHECK (cardinality("learning_app"."child_profiles"."interests") <= 5 and array_position("learning_app"."child_profiles"."interests", null) is null);
