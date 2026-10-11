import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exportLearningOverviewJsonSchema } from "@learning/contracts";

async function main(): Promise<void> {
  const outputPath = resolve("docs/integrations/learning-overview.schema.json");
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...exportLearningOverviewJsonSchema(),
  };
  const contents = `${JSON.stringify(schema, null, 2)}\n`;

  if (process.argv.includes("--check")) {
    let existing: string;
    try {
      existing = await readFile(outputPath, "utf8");
    } catch {
      throw new Error(`Missing generated contract schema: ${outputPath}`);
    }
    if (existing !== contents) throw new Error(`Generated contract schema is stale: ${outputPath}`);
    console.log("Learning overview JSON Schema is up to date.");
    return;
  }
  await mkdir(resolve("docs/integrations"), { recursive: true });
  await writeFile(outputPath, contents, "utf8");
  console.log(`Wrote ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Contract schema export failed");
  process.exitCode = 1;
});
