import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { NumberVisual } from "./NumberVisual";
import { Visual } from "./Visual";

describe("Visual", () => {
  it("renders the supplied color as a solid square", () => {
    const svg = Visual({ text: "Red", visualType: "color", visualData: { color: "#ff0000" } }) as ReactElement<{ children: ReactNode }>;
    const rect = Children.toArray(svg.props.children)[0] as ReactElement<{ fill: string }>;

    expect(svg.type).toBe("svg");
    expect(rect.type).toBe("rect");
    expect(rect.props.fill).toBe("#ff0000");
  });

  it("delegates number art while preserving its label and validated count", () => {
    const visual = Visual({ text: "Eleven", visualType: "number", visualData: { count: 11 } }) as ReactElement<{ count: number; label: string }>;

    expect(visual.type).toBe(NumberVisual);
    expect(visual.props).toEqual({ count: 11, label: "Eleven" });
  });

  it("highlights Monday as the first of seven sequence positions", () => {
    const svg = Visual({ text: "Monday", visualType: "sequence", visualData: { position: 1, total: 7, sequenceStart: "Monday" } }) as ReactElement<{ children: ReactNode; "data-total": number; "data-sequence-start": string }>;
    const positions = Children.toArray(svg.props.children).filter((element) => isValidElement(element));
    const firstPosition = positions[0] as ReactElement<{ children: ReactNode; "data-position": number }>;
    const firstPositionChildren = Children.toArray(firstPosition.props.children);
    const firstRect = firstPositionChildren[0] as ReactElement<{ "aria-current"?: string }>;
    const firstLabel = firstPositionChildren[1] as ReactElement<{ children: ReactNode }>;

    expect(svg.props["data-total"]).toBe(7);
    expect(svg.props["data-sequence-start"]).toBe("Monday");
    expect(firstPosition.props["data-position"]).toBe(1);
    expect(firstRect.props["aria-current"]).toBe("step");
    expect(firstLabel.props.children).toBe("Mo");
  });

  it("highlights Thursday as the fourth position on a Monday-first week", () => {
    const svg = Visual({ text: "Thursday", visualType: "sequence", visualData: { position: 4, total: 7, sequenceStart: "Monday" } }) as ReactElement<{ children: ReactNode }>;
    const positions = Children.toArray(svg.props.children).filter((element) => isValidElement(element));
    const fourthPosition = positions[3] as ReactElement<{ children: ReactNode; "data-position": number }>;
    const fourthPositionChildren = Children.toArray(fourthPosition.props.children);
    const fourthRect = fourthPositionChildren[0] as ReactElement<{ "aria-current"?: string }>;
    const fourthLabel = fourthPositionChildren[1] as ReactElement<{ children: ReactNode }>;

    expect(fourthPosition.props["data-position"]).toBe(4);
    expect(fourthRect.props["aria-current"]).toBe("step");
    expect(fourthLabel.props.children).toBe("Th");
  });

  it("does not render a weekday sequence when its position contradicts the word", () => {
    expect(
      Visual({ text: "Monday", visualType: "sequence", visualData: { position: 2, total: 7, sequenceStart: "Monday" } }),
    ).toBeNull();
  });

  it("renders no guessed artwork when visual data is invalid", () => {
    expect(Visual({ text: "Eleven", visualType: "number", visualData: { count: 0 } })).toBeNull();
  });

  it("does not draw the wrong quantity for a known English number word", () => {
    expect(Visual({ text: "Eleven", visualType: "number", visualData: { count: 12 } })).toBeNull();
  });

  it("does not draw the wrong color for a known English color word", () => {
    expect(Visual({ text: "Red", visualType: "color", visualData: { color: "#0000ff" } })).toBeNull();
  });
});
