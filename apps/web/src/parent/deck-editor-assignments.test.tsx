import { describe, expect, it, vi } from "vitest";
import React from "react";
import { messages, type AssignmentDto } from "@learning/contracts";
import { DeckAssignmentsList } from "./DeckAssignmentsList";

function nodes(element: React.ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!React.isValidElement(element)) return [];
  const node = element as React.ReactElement<Record<string, unknown>>;
  const rendered =
    typeof node.type === "function"
      ? (node.type as (props: Record<string, unknown>) => React.ReactNode)(node.props)
      : (node.props.children as React.ReactNode);
  return [{ type: node.type, props: node.props }, ...nodes(rendered)];
}

describe("DeckAssignmentsList", () => {
  const sampleAssignments: AssignmentDto[] = [
    {
      childId: "10000000-0000-4000-8000-000000000001",
      displayName: "Ala",
      testDate: "2026-10-30",
      testGoals: ["recall"],
      mockTestTaskCount: 10,
      active: true,
    },
    {
      childId: "10000000-0000-4000-8000-000000000002",
      displayName: "Bartek",
      testDate: null,
      testGoals: null,
      mockTestTaskCount: 10,
      active: true,
    },
  ];

  it("renderuje listę przypisanych dzieci wraz z przyciskami usunięcia", () => {
    const onUnassign = vi.fn();
    const rendered = nodes(
      <DeckAssignmentsList assignments={sampleAssignments} onUnassign={onUnassign} />,
    );

    expect(rendered.some((n) => n.props["data-testid"] === "assignment-row-0")).toBe(true);
    expect(rendered.some((n) => n.props["data-testid"] === "assignment-row-1")).toBe(true);

    const btn0 = rendered.find((n) => n.props["data-testid"] === "unassign-submit-0");
    const btn1 = rendered.find((n) => n.props["data-testid"] === "unassign-submit-1");

    expect(btn0).toBeDefined();
    expect(btn1).toBeDefined();
    expect(btn0?.props.children).toBe(messages.decks.unassign);

    (btn0?.props.onClick as () => void)();
    expect(onUnassign).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000001");
  });
});
