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

const withoutBlockComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
/** TypeScript without comments; `//` after a colon is kept so URLs in strings survive. */
const withoutTsComments = (source: string) => withoutBlockComments(source).replace(/(?<!:)\/\/.*$/gm, "");

/** Raw window-unit lengths (`100vh`, `50DVW`, a template literal's `${n}vh`). `css` is expected without comments already. */
function rawViewportUnits(source: string, kind: "css" | "ts"): string[] {
  const code = kind === "ts" ? withoutTsComments(source) : source;
  return [...code.matchAll(/(?:\d+(?:\.\d+)?|\})(?:[sld])?v(?:h|w|i|b|min|max)\b/gi)].map((match) => match[0]);
}

/** Typed registrations (`@property`, `CSS.registerProperty`) that would break the zoom-aware tokens. `css` is raw, token block included. */
function typedTokenRegistrations(css: string, ts: string): string[] {
  return [
    ...withoutBlockComments(css).matchAll(/@property\s+--kid-(?:vh|dvh|svh|vw|zoom)\b/g),
    ...withoutTsComments(ts).matchAll(/\bCSS\.registerProperty\b/g),
  ].map((match) => match[0]);
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

  it("uses the type scale for font weights", () => {
    const offenders = cssFiles.flatMap((url) => declarations(styleRules(url), "font-weight")
      .filter((value) => !/^var\(--kid-type-[a-z-]+-weight\)$/.test(value))
      .map((value) => `${relative(url)}: font-weight: ${value}`));
    expect(offenders).toEqual([]);
  });

  it("sets text upright, because Nunito ships no italic (browsers would slant it synthetically)", () => {
    const offenders = cssFiles.flatMap((url) => declarations(styleRules(url), "font-style")
      .filter((value) => value !== "normal")
      .map((value) => `${relative(url)}: font-style: ${value}`));
    expect(offenders).toEqual([]);
  });

  it("keeps the font shorthand to inherit, so it cannot bypass the weight and style rules", () => {
    const offenders = cssFiles.flatMap((url) => declarations(styleRules(url), "font")
      .filter((value) => value !== "inherit")
      .map((value) => `${relative(url)}: font: ${value}`));
    expect(offenders).toEqual([]);
  });

  it("uses the shape scale for corners", () => {
    const offenders = cssFiles.flatMap((url) => declarations(styleRules(url), "border-radius")
      .filter((value) => LENGTH.test(withoutVars(value)))
      .map((value) => `${relative(url)}: border-radius: ${value}`));
    expect(offenders).toEqual([]);
  });

  it("catches raw window units in CSS and in TypeScript, template-literal interpolations and uppercase included", () => {
    expect(rawViewportUnits("height: 100VH", "css")).toEqual(["100VH"]);
    expect(rawViewportUnits("min-height: 12.5dvh; width: 50vw", "css")).toEqual(["12.5dvh", "50vw"]);
    expect(rawViewportUnits("`${n}vh`", "ts")).toEqual(["}vh"]);
    expect(rawViewportUnits("const h = `${Math.round(n)}dvh`;", "ts")).toEqual(["}dvh"]);
    // Comments never count, and a token reference is not a raw unit.
    expect(rawViewportUnits("/* 100vh */ // 80vh\nconst a = 1;", "ts")).toEqual([]);
    expect(rawViewportUnits("height: calc(100 * var(--kid-vh));", "css")).toEqual([]);
  });

  it("uses zoom-aware viewport tokens instead of raw viewport units", () => {
    /* KidPage scales the whole page with CSS zoom on large windows, which
       multiplies viewport units by the scale. Only --kid-vh/-dvh/-svh/-vw
       (they divide by --kid-zoom) may carry a window-relative length. */
    const fromCss = cssFiles.flatMap((url) => rawViewportUnits(styleRules(url), "css").map((hit) => `${relative(url)}: ${hit}`));
    const fromTs = files(SRC, /\.tsx?$/)
      .filter((url) => !/\.test\.tsx?$/.test(url.pathname))
      .flatMap((url) => rawViewportUnits(readFileSync(url, "utf8"), "ts").map((hit) => `${relative(url)}: ${hit}`));
    expect([...fromCss, ...fromTs]).toEqual([]);
  });

  it("catches typed registrations of the window-unit tokens and --kid-zoom", () => {
    expect(typedTokenRegistrations("@property --kid-vh { syntax: '<length>'; }", "")).toEqual(["@property --kid-vh"]);
    expect(typedTokenRegistrations("@property  --kid-zoom{inherits:true}", "")).toEqual(["@property  --kid-zoom"]);
    expect(typedTokenRegistrations("", "CSS.registerProperty({ name: '--kid-dvh' });")).toEqual(["CSS.registerProperty"]);
    expect(typedTokenRegistrations("", "window.CSS.registerProperty({ name: '--kid-zoom' });")).toEqual(["CSS.registerProperty"]);
    // Other properties and comments about the rule are not registrations.
    expect(typedTokenRegistrations("@property --other { syntax: '*'; }", "")).toEqual([]);
    expect(typedTokenRegistrations("/* Not registered with @property --kid-zoom */", "// CSS.registerProperty is not used")).toEqual([]);
  });

  it("never registers the window-unit tokens or --kid-zoom as typed properties", () => {
    /* A registered --kid-zoom (or a token that reads it) would substitute at
       the :root rule instead of the element that declares the token, so the
       tokens would stop dividing by the page's own zoom. The token block is
       kept: it is raw CSS, not styleRules. */
    const css = cssFiles.map((url) => readFileSync(url, "utf8")).join("\n");
    const ts = files(SRC, /\.tsx?$/)
      .filter((url) => !/\.test\.tsx?$/.test(url.pathname))
      .map((url) => readFileSync(url, "utf8"))
      .join("\n");
    expect(typedTokenRegistrations(css, ts)).toEqual([]);
  });

  it("defines the window-unit tokens by dividing through --kid-zoom, keeping each unit kind", () => {
    const styles = readFileSync(new URL("styles.css", SRC), "utf8");
    const defined = [...styles.matchAll(/--kid-(vh|dvh|svh|vw):\s*([^;]+);/g)].map((match) => `${match[1]}: ${match[2]}`);
    expect(defined).toEqual(["vh", "dvh", "svh", "vw"].map((unit) => `${unit}: calc(1${unit} / var(--kid-zoom, 1))`));
  });

  it("keeps literal colors out of components (deterministic visuals and illustrations excepted)", () => {
    const offenders = files(SRC, /\.tsx?$/)
      .filter((url) => !relative(url).startsWith("visuals/") && !relative(url).startsWith("illustrations/") && !/\.test\.tsx?$/.test(url.pathname))
      .flatMap((url) => [...readFileSync(url, "utf8").matchAll(/["'`]#[0-9a-fA-F]{3,8}["'`]/g)].map((match) => `${relative(url)}: ${match[0]}`));
    expect(offenders).toEqual([]);
  });

  it("loads only local kid fonts", () => {
    const css = readFileSync(new URL("../apps/web/src/kid-fonts.css", import.meta.url), "utf8");
    expect(css).toContain('url("/fonts/kid/Nunito.ttf")');
    expect(css).not.toMatch(/fonts\.googleapis|Manrope|Fredoka/);
  });

  it("applies the display font to headings and the main action, the body font to the root", () => {
    const theme = readFileSync(new URL("theme/kid-theme.module.css", SRC), "utf8");
    expect(theme).toContain("font-family: var(--kid-font-body)");
    const headings = readFileSync(new URL("theme/kid-theme.css", SRC), "utf8");
    expect(headings).toMatch(/\.kid-theme h1,[^{]*\.kid-theme h3\s*\{[^}]*font-family: var\(--kid-font-display\)/);
    const action = readFileSync(new URL("components/answer-controls.module.css", SRC), "utf8");
    expect(action).toMatch(/\.action\[data-variant="filled"\]\[data-size="lg"\]\s*\{[^}]*font-family: var\(--kid-font-display\)/);
  });

  it("sets every role in Nunito, which covers Polish diacritics (Fredoka lacks ą ć ę ń ś ź ż)", () => {
    const styles = readFileSync(new URL("styles.css", SRC), "utf8");
    expect(styles).toMatch(/--kid-font-display: KnowliKidNunito,/);
    expect(styles).toMatch(/--kid-font-body: KnowliKidNunito,/);
    const offenders = cssFiles.flatMap((url) => declarations(styleRules(url), "font-family")
      .filter((value) => !/^(?:var\(--kid-font-(?:display|body)\)|inherit|ui-monospace, monospace)$/.test(value))
      .map((value) => `${relative(url)}: font-family: ${value}`));
    expect(offenders).toEqual([]);
  });
});
