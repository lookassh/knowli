import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* Kid UI follows Material 3 through tokens: colors are roles
   (--md-sys-color-*, --kid-color-*), sizes are the type scale
   (--kid-type-*), corners are the shape scale (--kid-shape-*). Only the
   token block in styles.css may hold literal values. */

const SRC = new URL("../packages/kid-ui/src/", import.meta.url);
const TOKEN_BLOCK_START = ".kid-theme,\n.kid-ui {\n";

function files(dir: URL, pattern: RegExp): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) return files(url, pattern);
    return pattern.test(entry.name) ? [url] : [];
  });
}

function relative(url: URL): string {
  return url.pathname.slice(SRC.pathname.length);
}

/** CSS of a file without comments and without the token block of styles.css. */
function styleRules(url: URL): string {
  const css = readFileSync(url, "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
  if (relative(url) !== "styles.css") return css;
  const start = css.indexOf(TOKEN_BLOCK_START);
  expect(start, "styles.css must define the M3 token block").toBeGreaterThanOrEqual(0);
  return css.slice(0, start) + css.slice(css.indexOf("\n}", start) + 2);
}

function declarations(css: string, property: string): string[] {
  return [...css.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, "g"))].map((match) => match[1]!.trim());
}

const withoutVars = (value: string) => value.replace(/var\([^()]*\)/g, "");
const LENGTH = /\d(?:px|rem|em)\b/;

describe("kid-ui design tokens", () => {
  const cssFiles = files(SRC, /\.css$/);

  it("uses color roles instead of literal colors", () => {
    const offenders = cssFiles.flatMap((url) => [...styleRules(url).matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)]
      .map((match) => `${relative(url)}: ${match[0]}`));
    expect(offenders).toEqual([]);
  });

  it("uses the type scale for font sizes", () => {
    const offenders = cssFiles.flatMap((url) => declarations(styleRules(url), "font-size")
      .filter((value) => LENGTH.test(withoutVars(value)))
      .map((value) => `${relative(url)}: font-size: ${value}`));
    expect(offenders).toEqual([]);
  });

  it("uses the shape scale for corners", () => {
    const offenders = cssFiles.flatMap((url) => declarations(styleRules(url), "border-radius")
      .filter((value) => LENGTH.test(withoutVars(value)))
      .map((value) => `${relative(url)}: border-radius: ${value}`));
    expect(offenders).toEqual([]);
  });

  it("keeps literal colors out of components (deterministic visuals excepted)", () => {
    const offenders = files(SRC, /\.tsx?$/)
      .filter((url) => !relative(url).startsWith("visuals/") && !/\.test\.tsx?$/.test(url.pathname))
      .flatMap((url) => [...readFileSync(url, "utf8").matchAll(/["'`]#[0-9a-fA-F]{3,8}["'`]/g)].map((match) => `${relative(url)}: ${match[0]}`));
    expect(offenders).toEqual([]);
  });
});
