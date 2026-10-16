import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { MeaningVisualView } from "./MeaningVisualView";
import { NumberVisual } from "./NumberVisual";
import { Visual } from "./Visual";

type Renderer = "Visual" | "MeaningVisualView";
type SvgElement = ReactElement<{ children?: ReactNode; viewBox?: string; role?: string; "aria-label"?: string; className?: string }>;
type TextElement = ReactElement<{ children?: ReactNode; x?: string; y?: string; textAnchor?: string; fontSize?: string; fontWeight?: string; fill?: string }>;

function renderNumber(renderer: Renderer, count: number): SvgElement {
  const rendered = renderer === "Visual"
    ? Visual({ text: String(count), visualType: "number", visualData: { count } }) as SvgElement
    : MeaningVisualView({ visual: { kind: "number", count }, mediaUrl: () => "" }) as SvgElement;
  if (rendered.type !== NumberVisual) throw new Error(`${renderer} should use NumberVisual`);
  return NumberVisual(rendered.props as { count: number; label: string }) as SvgElement;
}

describe("NumberVisual", () => {
  for (const renderer of ["Visual", "MeaningVisualView"] as const) {
    it.each([0, 1, 2, 10, 11, 20, 50])(`${renderer} renders %i as a centered digit`, (count) => {
      const svg = renderNumber(renderer, count);

      expect(svg.type).toBe("svg");
      expect(svg.props.role).toBe("img");
      expect(svg.props.viewBox).toBe("0 0 160 120");
      expect(svg.props.className).toContain("kid-visual-number");
      expect(svg.props.className).toContain("kid-visual-number--digit");
      expect(svg.props["aria-label"]).toBeTruthy();

      const children = Children.toArray(svg.props.children);
      expect(children).toHaveLength(1);

      const text = children[0] as TextElement;
      expect(isValidElement(text)).toBe(true);
      expect(text.type).toBe("text");
      expect(text.props.x).toBe("80");
      expect(text.props.y).toBe("84");
      expect(text.props.textAnchor).toBe("middle");
      expect(text.props.fontSize).toBe("88");
      expect(text.props.fontWeight).toBe("800");
      expect(text.props.fill).toBe("currentColor");
      expect(text.props.children).toBe(count);
    });
  }

  it("renders a digit even if display='apples' is passed for backwards compatibility", () => {
    const svg = NumberVisual({ count: 4, label: "4 elementy", display: "apples" }) as SvgElement;
    expect(svg.props.className).toContain("kid-visual-number--digit");
    const children = Children.toArray(svg.props.children);
    expect(children).toHaveLength(1);
    const text = children[0] as TextElement;
    expect(text.props.children).toBe(4);
  });

  it("formats zero with correct Polish accessibility label", () => {
    const visual = MeaningVisualView({ visual: { kind: "number", count: 0 }, mediaUrl: () => "" }) as ReactElement<{ count: number; label: string }>;
    expect(visual.props.label).toBe("0 elementów");
    const svg = NumberVisual(visual.props) as SvgElement;
    expect(svg.props["aria-label"]).toBe("0 elementów");
  });
});
