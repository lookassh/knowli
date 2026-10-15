import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { MeaningVisualView } from "./MeaningVisualView";
import { NumberVisual } from "./NumberVisual";
import { Visual } from "./Visual";

type Renderer = "Visual" | "MeaningVisualView";
type SvgElement = ReactElement<{ children?: ReactNode; viewBox?: string; role?: string; "aria-label"?: string; className?: string }>;
type AppleElement = ReactElement<{ transform?: string; "data-testid"?: string; children?: ReactNode }>;

function renderNumber(renderer: Renderer, count: number): SvgElement {
  const rendered = renderer === "Visual"
    ? Visual({ text: String(count), visualType: "number", visualData: { count } }) as SvgElement
    : MeaningVisualView({ visual: { kind: "number", count }, mediaUrl: () => "" }) as SvgElement;
  if (rendered.type !== NumberVisual) throw new Error(`${renderer} should use NumberVisual`);
  return NumberVisual(rendered.props as { count: number; label: string }) as SvgElement;
}

function apples(svg: SvgElement): AppleElement[] {
  return Children.toArray(svg.props.children).filter((element): element is AppleElement => {
    if (!isValidElement(element)) return false;
    return (element.props as { "data-testid"?: string })["data-testid"] === "kid-number-apple";
  });
}

function appleBounds(apple: AppleElement) {
  const transform = apple.props.transform?.match(/^translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)$/);
  if (!transform) throw new Error(`Unexpected apple transform: ${apple.props.transform}`);
  const [, xText, yText, scaleText] = transform;
  const x = Number(xText);
  const y = Number(yText);
  const scale = Number(scaleText);
  return { left: x, top: y, right: x + 24 * scale, bottom: y + 28 * scale, scale };
}

describe("NumberVisual", () => {
  for (const renderer of ["Visual", "MeaningVisualView"] as const) {
    it.each([1, 2, 3, 10, 11, 50])(`${renderer} draws exactly %i apples`, (count) => {
      const svg = renderNumber(renderer, count);
      const renderedApples = apples(svg);

      expect(svg.type).toBe("svg");
      expect(svg.props.role).toBe("img");
      expect(svg.props["aria-label"]).toBeTruthy();
      expect(renderedApples).toHaveLength(count);
      expect(renderedApples.every((apple) => Children.toArray(apple.props.children).some((shape) =>
        isValidElement(shape) && shape.type === "path"))).toBe(true);
    });
  }

  it("renders a numeral in choice tiles without changing the default apple visualization", () => {
    const defaultVisual = MeaningVisualView({ visual: { kind: "number", count: 4 }, mediaUrl: () => "" });
    const tile = MeaningVisualView({ visual: { kind: "number", count: 4 }, mediaUrl: () => "", numberDisplay: "digit" });
    expect(defaultVisual.type).toBe(NumberVisual);
    expect((defaultVisual.props as { display?: string }).display).toBe("apples");
    expect(tile.type).toBe(NumberVisual);
    const svg = NumberVisual(tile.props as { count: number; label: string; display?: "apples" | "digit" }) as SvgElement;
    expect(svg.props.className).toContain("--digit");
    expect(Children.toArray(svg.props.children)).toHaveLength(1);
    const numeral = Children.toArray(svg.props.children)[0] as ReactElement<{ children: number }>;
    expect(numeral.props.children).toBe(4);
  });

  it("centers one large apple in the SVG viewBox", () => {
    const svg = renderNumber("MeaningVisualView", 1);
    expect(svg.props.viewBox).toBe("0 0 160 120");
    const [apple] = apples(svg);
    expect(apple).toBeDefined();
    const bounds = appleBounds(apple!);

    expect(bounds.left + (24 * bounds.scale) / 2).toBeCloseTo(80);
    expect(bounds.top + (28 * bounds.scale) / 2).toBeCloseTo(60);
    expect(28 * bounds.scale).toBeGreaterThanOrEqual(100);
  });

  it("centers an incomplete final row of apples", () => {
    const boxes = apples(renderNumber("Visual", 11)).map(appleBounds);
    const lastRow = boxes.filter((box) => box.top === Math.max(...boxes.map((candidate) => candidate.top)));

    expect(lastRow).toHaveLength(1);
    expect(lastRow[0]!.left + (24 * lastRow[0]!.scale) / 2).toBeCloseTo(80);
  });

  it.each([1, 2, 3, 10, 11, 50])("keeps %i apples inside the viewBox without overlap", (count) => {
    const svg = renderNumber("Visual", count);
    const renderedApples = apples(svg);
    expect(renderedApples).toHaveLength(count);
    const boxes = renderedApples.map(appleBounds);

    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(160);
      expect(box.bottom).toBeLessThanOrEqual(120);
    }
    for (let first = 0; first < boxes.length; first += 1) {
      for (let second = first + 1; second < boxes.length; second += 1) {
        const a = boxes[first]!;
        const b = boxes[second]!;
        const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(overlaps, `apples ${first + 1} and ${second + 1} overlap at count ${count}`).toBe(false);
      }
    }
  });
});
