import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return readFileSync(new URL(`../packages/kid-ui/src/${relative}`, import.meta.url), "utf8");
}

const styles = read("styles.css");

const colorRoles = [
  "primary", "on-primary", "primary-container", "on-primary-container",
  "secondary-container", "on-secondary-container",
  "tertiary", "on-tertiary", "tertiary-container",
  "error", "on-error", "error-container",
  "surface", "on-surface", "on-surface-variant",
  "surface-container-lowest", "surface-container-low", "surface-container", "surface-container-high",
  "outline", "outline-variant",
];

const legacyAliases: Record<string, string> = {
  "--kid-bg": "--md-sys-color-surface",
  "--kid-surface": "--md-sys-color-surface-container",
  "--kid-text": "--md-sys-color-on-surface",
  "--kid-muted": "--md-sys-color-on-surface-variant",
  "--kid-accent": "--md-sys-color-primary",
  "--kid-on-accent": "--md-sys-color-on-primary",
  "--kid-line": "--md-sys-color-outline",
  "--kid-soft": "--md-sys-color-surface-container-high",
  "--kid-good": "--md-sys-color-tertiary",
  "--kid-good-bg": "--md-sys-color-tertiary-container",
  "--kid-wrong": "--md-sys-color-error",
  "--kid-wrong-bg": "--md-sys-color-error-container",
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
      expect(controls, variant).toContain(`[data-variant="${variant}"]`);
    }
    expect(controls).toContain("var(--kid-state-hover-opacity)");
    expect(controls).toContain("var(--kid-state-pressed-opacity)");
    expect(controls).toContain("var(--kid-color-disabled-container)");
    expect(controls).toContain("var(--kid-color-disabled-content)");
    expect(controls).not.toContain("opacity: 0.55");
  });
});
