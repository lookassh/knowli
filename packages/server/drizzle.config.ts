import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Generowanie migracji nie łączy się z bazą; wartość potrzebna dopiero
    // dla poleceń działających na bazie (migrate/push).
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/knowli",
  },
});
