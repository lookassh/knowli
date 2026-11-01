import { UiAudioKeySchema, type UiAudioKey } from "@learning/contracts";
import { createDatabase, createServices, mediaSettingsFromEnv, regenerateUiAudio, withConfigDefaults } from "@learning/server";

/** Argumenty to klucze komunikatów Kid UI; nieznany klucz lub brak argumentów = błąd użycia. */
function parseKeys(args: readonly string[]): UiAudioKey[] {
  if (args.length === 0) throw new Error("Invalid arguments");
  return args.map((arg) => {
    const parsed = UiAudioKeySchema.safeParse(arg);
    if (!parsed.success) throw new Error("Invalid arguments");
    return parsed.data;
  });
}

async function main(): Promise<void> {
  const keys = parseKeys(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  const { db, pool } = createDatabase(databaseUrl);
  try {
    // Tylko zleca nową generację w kolejce media_assets; syntezę wykonuje worker.
    const result = await regenerateUiAudio(createServices({ db, media: mediaSettingsFromEnv(withConfigDefaults(process.env)) }), keys);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof Error && error.message === "DATABASE_URL is not configured") {
    process.stderr.write("DATABASE_URL is not configured\n");
  } else if (error instanceof Error && error.message === "Invalid arguments") {
    process.stderr.write("Usage: media:regenerate-ui-audio <klucz…>\n");
  } else {
    process.stderr.write("UI audio regeneration failed. Check the database and media settings.\n");
  }
  process.exitCode = 1;
});
