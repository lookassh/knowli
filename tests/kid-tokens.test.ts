import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return readFileSync(new URL(`../packages/kid-ui/src/${relative}`, import.meta.url), "utf8");
}

const styles = read("styles.css");

const colorRoles = [
  "primary", "on-primary", "primary-container", "on-primary-container",
  "secondary", "on-secondary", "secondary-container", "on-secondary-container",
  "tertiary", "on-tertiary", "tertiary-container", "on-tertiary-container",
  "error", "on-error", "error-container", "on-error-container",
  "surface-dim", "surface", "surface-bright", "on-surface", "on-surface-variant",
  "surface-container-lowest", "surface-container-low", "surface-container", "surface-container-high",
  "surface-container-highest", "inverse-surface", "inverse-on-surface", "inverse-primary",
  "outline", "outline-variant",
];

const tokenBlock = /\.kid-theme,\s*\.kid-ui \{[^}]*\}/.exec(styles)?.[0] ?? "";

/* Resolves a token of the block to #rrggbb, following var(--x) chains inside the block. */
function resolveToken(name: string): string {
  let current = name;
  for (let depth = 0; depth < 8; depth += 1) {
    const match = new RegExp(`${current}:\\s*([^;]+);`).exec(tokenBlock);
    if (!match) throw new Error(`Missing token ${current}`);
    const value = match[1].trim();
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    if (!reference) {
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Token ${current} is not a hex color: ${value}`);
      return value.toLowerCase();
    }
    current = reference[1];
  }
  throw new Error(`Token chain too deep: ${name}`);
}

/* "on-surface" -> --md-sys-color-on-surface; "kid-color-warm" -> --kid-color-warm. */
function role(name: string): string {
  return resolveToken(name.startsWith("kid-") ? `--${name}` : `--md-sys-color-${name}`);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/* WCAG 2.x contrast ratio. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const legacyAliases: Record<string, string> = {
  "--kid-bg": "--md-sys-color-surface",
  "--kid-surface": "--md-sys-color-surface-container",
  "--kid-text": "--md-sys-color-on-surface",
  "--kid-muted": "--md-sys-color-on-surface-variant",
  "--kid-accent": "--md-sys-color-primary",
  "--kid-on-accent": "--md-sys-color-on-primary",
  // Decorative boundaries; interactive controls use --md-sys-color-outline directly.
  "--kid-line": "--md-sys-color-outline-variant",
  "--kid-soft": "--md-sys-color-surface-container-high",
  "--kid-good": "--kid-color-success",
  "--kid-good-bg": "--kid-color-success-container",
  "--kid-wrong": "--md-sys-color-error",
  "--kid-wrong-bg": "--md-sys-color-error-container",
  "--kid-warm": "--kid-color-warm-container",
};

/* Success has no M3 role: it is tertiary under a semantic name. */
const successAliases: Record<string, string> = {
  "--kid-color-success": "--md-sys-color-tertiary",
  "--kid-color-on-success": "--md-sys-color-on-tertiary",
  "--kid-color-success-container": "--md-sys-color-tertiary-container",
  "--kid-color-on-success-container": "--md-sys-color-on-tertiary-container",
};

describe("kid Material 3 tokens", () => {
  it("defines every M3 color role used by kid-ui", () => {
    for (const role of colorRoles) {
      expect(styles, role).toContain(`--md-sys-color-${role}:`);
    }
  });

  it("keeps legacy --kid-* color tokens as aliases of M3 roles", () => {
    for (const [legacy, role] of Object.entries(legacyAliases)) {
      expect(styles, legacy).toContain(`${legacy}: var(${role});`);
    }
  });

  it("maps the success aliases onto tertiary and defines the warm custom color group", () => {
    for (const [alias, role] of Object.entries(successAliases)) {
      expect(styles, alias).toContain(`${alias}: var(${role});`);
    }
    for (const token of ["warm", "on-warm", "warm-container", "on-warm-container"]) {
      expect(styles, token).toContain(`--kid-color-${token}:`);
    }
  });

  it("defines the shape and type scales", () => {
    for (const shape of ["none", "xs", "s", "m", "l", "xl", "xxl", "full"]) {
      expect(styles, shape).toContain(`--kid-shape-${shape}:`);
    }
    for (const type of ["display", "headline", "title", "title-sm", "body", "label", "label-sm"]) {
      expect(styles, type).toContain(`--kid-type-${type}-size:`);
      expect(styles, type).toContain(`--kid-type-${type}-weight:`);
      expect(styles, type).toContain(`--kid-type-${type}-line-height:`);
    }
  });

  it("keeps shared components on the shape and type scales", () => {
    const shared = [
      read("components/answer-controls.module.css"),
      read("components/SessionProgress.module.css"),
      read("components/ExerciseInstruction.module.css"),
      read("exercises/ExerciseFrame.module.css"),
      read("screens/ExerciseFeedbackDock.module.css"),
    ].join("\n");

    expect(shared).not.toMatch(/border-radius:\s*\d+px/);
    expect(shared).not.toMatch(/font-size:\s*[\d.]+rem/);
    expect(shared).toContain("var(--kid-shape-");
    expect(shared).toContain("var(--kid-type-");
  });

  it("styles ActionButton variants through M3 state layers and disabled tokens", () => {
    const controls = read("components/answer-controls.module.css");
    for (const variant of ["filled", "tonal", "outlined", "text"]) {
      expect(controls, variant).toContain(`:where([data-variant="${variant}"])`);
    }
    expect(controls).toContain("var(--kid-state-hover-opacity)");
    expect(controls).toContain("var(--kid-state-pressed-opacity)");
    expect(controls).toContain("var(--kid-color-disabled-container)");
    expect(controls).toContain("var(--kid-color-disabled-content)");
    expect(controls).not.toContain("opacity: 0.55");
  });

  it.each([
    ["on-surface", "surface"], ["on-surface", "surface-container"], ["on-surface", "surface-container-high"],
    ["on-surface-variant", "surface-container"], ["on-primary", "primary"],
    ["on-primary-container", "primary-container"], ["kid-color-on-header", "kid-color-header"],
    ["on-tertiary-container", "tertiary-container"], ["on-error-container", "error-container"],
    ["kid-color-on-warm-container", "kid-color-warm-container"],
    ["on-surface", "surface-container-highest"],
  ])("text %s on %s reaches 4.5:1", (fg, bg) => {
    expect(contrast(role(fg), role(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["outline", "surface"], ["outline", "surface-container"],
    ["primary", "surface-container"], ["kid-color-warm", "surface-container"],
    ["primary", "surface"],
  ])("graphic %s on %s reaches 3:1", (fg, bg) => {
    expect(contrast(role(fg), role(bg))).toBeGreaterThanOrEqual(3);
  });

  it("success differs from primary in lightness", () => {
    expect(contrast(role("tertiary"), role("primary"))).toBeGreaterThanOrEqual(1.15);
  });

  it("defines the header and font roles", () => {
    for (const name of ["--kid-color-header", "--kid-color-on-header", "--kid-font-display", "--kid-font-body"]) {
      expect(styles).toContain(`${name}:`);
    }
  });
});
