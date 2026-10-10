import { UuidSchema } from "@learning/contracts";
import { createDatabase, createServices, rebuildProgress } from "@learning/server";

function parseArgs(args: readonly string[]): { childId?: string; apply: boolean } {
  let childId: string | undefined;
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--child") {
      if (childId !== undefined || args[index + 1] === undefined) throw new Error("Invalid arguments");
      childId = UuidSchema.parse(args[index + 1]);
      index += 1;
    } else {
      throw new Error("Invalid arguments");
    }
  }
  return { ...(childId === undefined ? {} : { childId }), apply };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  const { db, pool } = createDatabase(databaseUrl);
  try {
    const report = await rebuildProgress(createServices({ db }), options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof Error && error.message === "DATABASE_URL is not configured") {
    process.stderr.write("DATABASE_URL is not configured\n");
  } else if (error instanceof Error && error.message === "Invalid arguments") {
    process.stderr.write("Usage: progress:rebuild [--child <UUID>] [--apply]\n");
  } else {
    process.stderr.write("Progress rebuild failed. Check the database and supplied child ID.\n");
  }
  process.exitCode = 1;
});
