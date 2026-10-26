import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return readFileSync(new URL(`../packages/kid-ui/${relative}`, import.meta.url), "utf8");
}

function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.(ts|tsx|css)$/.test(entry.name) ? [url] : [];
  });
}

describe("kid-ui has no Mantine dependency", () => {
  it("does not declare Mantine packages", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    expect(Object.keys(declared).filter((name) => name.startsWith("@mantine/"))).toEqual([]);
  });

  it("does not reference Mantine in sources", () => {
    const offenders = sourceFiles(new URL("../packages/kid-ui/src/", import.meta.url))
      .filter((url) => /@mantine\/|mantine-/i.test(readFileSync(url, "utf8")))
      .map((url) => url.pathname);
    expect(offenders).toEqual([]);
  });
});
