// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderKid } from "../test/render-kid";
import { EmptyScene } from "./EmptyScene";
import { HeaderWave } from "./HeaderWave";
import { PROFILE_AVATAR_KEYS, ProfileAvatar } from "./ProfileAvatar";

afterEach(cleanup);

describe("illustrations", () => {
  it.each(PROFILE_AVATAR_KEYS)("renders the %s avatar", (key) => {
    const { container } = renderKid(<ProfileAvatar avatarKey={key} />);
    expect(container.querySelector(`svg[data-avatar="${key}"]`)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("falls back for an unknown avatar key", () => {
    const { container } = renderKid(<ProfileAvatar avatarKey="dragon" />);
    expect(container.querySelector('svg[data-avatar="fallback"]')).not.toBeNull();
  });

  it("scales the avatar with size", () => {
    const { container } = renderKid(<ProfileAvatar avatarKey="fox" size={96} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("96");
    expect(svg?.getAttribute("height")).toBe("96");
  });

  it("paints the wave with the current text color", () => {
    const { container } = renderKid(<HeaderWave />);
    expect(container.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders a decorative empty scene", () => {
    const { container } = renderKid(<EmptyScene />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
