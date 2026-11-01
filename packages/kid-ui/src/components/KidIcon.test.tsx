// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderKid } from "../test/render-kid";
import { KidIcon, type KidIconName } from "./KidIcon";

afterEach(cleanup);

describe("KidIcon", () => {
  it.each(["almost", "info", "turtle"] as const satisfies readonly KidIconName[])(
    "renders the %s icon as a decorative svg",
    (name) => {
      const { container } = renderKid(<KidIcon name={name} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(svg?.querySelectorAll("path, circle").length).toBeGreaterThanOrEqual(1);
    },
  );

  it("tags the svg with its icon name", () => {
    const { container } = renderKid(<KidIcon name="turtle" />);
    expect(container.querySelector("svg")?.getAttribute("data-icon")).toBe("turtle");
  });
});
