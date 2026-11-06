-- Zestaw słówek (#299): czas ostatniego przejęcia runu przez worker
-- (`claimQueuedRun`). Run `deck` w `running` ponad 10 minut po przejęciu jest
-- utknięty (np. po awarii workera) i panel rodzica pozwala go ponowić. NULL —
-- run nieprzejęty albo przejęty przed migracją (w `running` — utknięty).
-- Ręcznie pisany SQL: snapshoty drizzle po 0017 są znanym długiem.
ALTER TABLE "learning_app"."generation_runs" ADD COLUMN "claimed_at" timestamp with time zone;
