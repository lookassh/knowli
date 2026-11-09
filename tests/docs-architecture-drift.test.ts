import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

const DOCS = ["AGENTS.md", "docs/architecture.md", "docs/folder-structure.md"] as const;

describe("current architecture docs do not describe removed mechanisms (#406)", () => {
  it("does not present Graphile Worker as the queue (no such dependency in code)", () => {
    const offenders = DOCS.filter((path) => /graphile/i.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it("does not attribute Mantine to Kid UI entries in folder-structure", () => {
    const offenders = read("docs/folder-structure.md")
      .split(/\r?\n/)
      .filter((line) => /kid-ui|KidThemeProvider|KidScreen/.test(line) && /mantine/i.test(line));
    expect(offenders).toEqual([]);
  });

  it("does not list the nonexistent packages/server/src/db/queries directory", () => {
    expect(existsSync(new URL("../packages/server/src/db/queries", import.meta.url))).toBe(false);
    expect(read("docs/folder-structure.md")).not.toContain("packages/server/src/db/queries/");
  });

  it("documents the own polling queue over generation tables", () => {
    const architecture = read("docs/architecture.md");
    expect(architecture).toMatch(/polling/i);
    expect(architecture).toContain("generation_runs");
    expect(architecture).toMatch(/claim/i);
    expect(architecture).toMatch(/lease/i);
  });

  it("code has no graphile dependency to back the old wording", () => {
    const manifests = ["package.json", "apps/worker/package.json", "packages/server/package.json"]
      .filter((path) => existsSync(new URL(`../${path}`, import.meta.url)));
    const offenders = manifests.filter((path) => /graphile/i.test(read(path)));
    expect(offenders).toEqual([]);
    expect(readdirSync(new URL("../packages/server/src/db", import.meta.url))).not.toContain("queries");
  });
});

describe("AGENTS.md fits the Codex project-doc budget", () => {
  it("stays under 32 KiB (Codex silently truncates project_doc_max_bytes, default 32 KiB)", () => {
    const bytes = readFileSync(new URL("../AGENTS.md", import.meta.url)).byteLength;
    expect(bytes).toBeLessThan(32 * 1024);
  });
});
