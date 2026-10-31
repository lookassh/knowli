-- Źródła (materiał źródłowy rodzica) i odnośnik zestawu do źródła
-- (design 2026-10-30 „Angielski — rozdział”, §3.1). Ręcznie pisany SQL: snapshoty
-- drizzle po 0017 są znanym długiem, więc nie są generowane.
--
-- source_materials: wklejony tekst rozdziału. title 1–120 i body 1–16000 znaków
-- (limit MAX_SCHOOL_MATERIAL_LENGTH) odzwierciedlają walidację Zod po trim.
-- client_request_id jest unikalny (idempotencja tworzenia); request_hash to skrót
-- tytułu i treści z pierwszego żądania. Dwie rewizje: revision rośnie przy każdej
-- zmianie (kontrola współbieżności edycji), body_revision — tylko przy zmianie
-- treści (wersja kopiowanego tekstu; zmiana samego tytułu nie oznacza zestawów
-- jako utworzonych ze starszej wersji).
CREATE TABLE "learning_app"."source_materials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"body_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_materials_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "source_materials_title_length" CHECK (length("title") between 1 and 120),
	CONSTRAINT "source_materials_body_length" CHECK (length("body") between 1 and 16000),
	CONSTRAINT "source_materials_revision_positive" CHECK ("revision" >= 1),
	CONSTRAINT "source_materials_body_revision_positive" CHECK ("body_revision" >= 1)
);
--> statement-breakpoint
-- decks: pochodzenie zestawu — źródło i rewizja treści (body_revision) skopiowanego
-- tekstu. Usunięcie źródła zeruje odnośnik (ON DELETE SET NULL), treść zestawu i
-- skopiowana rewizja zostają; oba CHECK-i przepuszczają taki wiersz. UPDATE
-- wywołany przez klucz obcy nie rusza kolumn kind ani cover_asset_id, więc
-- decks_cover_asset_guard (0011, INSERT OR UPDATE OF cover_asset_id, kind) się nie
-- uruchamia, a decks_kind_immutable (0007, BEFORE UPDATE bez listy kolumn)
-- uruchamia się i przepuszcza wiersz, bo kind się nie zmienia.
ALTER TABLE "learning_app"."decks" ADD COLUMN "source_material_id" uuid;
--> statement-breakpoint
ALTER TABLE "learning_app"."decks" ADD COLUMN "source_material_revision" integer;
--> statement-breakpoint
ALTER TABLE "learning_app"."decks" ADD CONSTRAINT "decks_source_material_id_source_materials_id_fk" FOREIGN KEY ("source_material_id") REFERENCES "learning_app"."source_materials"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_app"."decks" ADD CONSTRAINT "decks_source_material_revision_positive" CHECK ("learning_app"."decks"."source_material_revision" is null or "learning_app"."decks"."source_material_revision" >= 1);
--> statement-breakpoint
ALTER TABLE "learning_app"."decks" ADD CONSTRAINT "decks_source_material_revision_required" CHECK ("learning_app"."decks"."source_material_id" is null or "learning_app"."decks"."source_material_revision" is not null);
--> statement-breakpoint
CREATE INDEX "decks_source_material_idx" ON "learning_app"."decks" USING btree ("source_material_id") WHERE "learning_app"."decks"."source_material_id" is not null;
