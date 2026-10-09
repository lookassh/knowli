-- Polityka nauki per dziecko (design 2026-10-09): profil wskazuje własną
-- wersję polityki (np. pasma wymowy); null = bieżąca wersja globalna.
ALTER TABLE "learning_app"."child_profiles" ADD COLUMN "policy_id" text;--> statement-breakpoint
ALTER TABLE "learning_app"."child_profiles" ADD CONSTRAINT "child_profiles_policy_id_learning_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "learning_app"."learning_policies"("id") ON DELETE no action ON UPDATE no action;
