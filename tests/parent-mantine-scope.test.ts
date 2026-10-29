import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Mantine należy wyłącznie do panelu rodzica (plan 2026-10-29-parent-ui-mantine):
 * komponenty w `apps/web/src/parent`, style i providery w layoucie `app/parent`.
 * Kid UI (`packages/kid-ui`) pilnuje osobno `kid-no-mantine.test.ts`.
 */

const WEB_SRC = new URL("../apps/web/src/", import.meta.url);

function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.(ts|tsx|css)$/.test(entry.name) ? [url] : [];
  });
}

function relative(url: URL): string {
  return fileURLToPath(url).slice(fileURLToPath(WEB_SRC).length).replaceAll("\\", "/");
}

const files = sourceFiles(WEB_SRC).map((url) => ({ path: relative(url), text: readFileSync(url, "utf8") }));

describe("Mantine stays inside the parent panel", () => {
  it("is imported only by parent panel sources", () => {
    const offenders = files
      .filter((file) => /from "@mantine\/|import "@mantine\//.test(file.text))
      .map((file) => file.path)
      .filter((path) => !path.startsWith("parent/") && !path.startsWith("app/parent/"));
    expect(offenders).toEqual([]);
  });

  it("loads its global styles only in the parent route layout", () => {
    const styleImports = files
      .filter((file) => /import "@mantine\/[^"]+\.css"/.test(file.text))
      .map((file) => file.path);
    expect(styleImports).toEqual(["app/parent/layout.tsx"]);
  });
});
