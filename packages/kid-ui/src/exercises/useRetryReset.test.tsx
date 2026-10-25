// @vitest-environment jsdom
import { useState, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRetryReset } from "./useRetryReset";

function Probe({ docked, onReset }: { docked: boolean; onReset: () => void }): ReactElement {
  useRetryReset(docked ? <span>dock</span> : undefined, onReset);
  return <p>{docked ? "feedback" : "task"}</p>;
}

describe("useRetryReset", () => {
  it("resets exactly once when the dock disappears for the same task", () => {
    const onReset = vi.fn();
    const { rerender } = render(<Probe docked={false} onReset={onReset} />);
    expect(onReset).not.toHaveBeenCalled();
    rerender(<Probe docked onReset={onReset} />);
    expect(onReset).not.toHaveBeenCalled();
    rerender(<Probe docked={false} onReset={onReset} />);
    expect(onReset).toHaveBeenCalledTimes(1);
    rerender(<Probe docked={false} onReset={onReset} />);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("clears a text draft kept by a mounted view", () => {
    function Draft({ docked }: { docked: boolean }): ReactElement {
      const [text, setText] = useState("cat");
      useRetryReset(docked ? <span>dock</span> : undefined, () => setText(""));
      return <p data-testid="draft">{text}</p>;
    }
    const { rerender } = render(<Draft docked={false} />);
    rerender(<Draft docked />);
    expect(screen.getByTestId("draft").textContent).toBe("cat");
    rerender(<Draft docked={false} />);
    expect(screen.getByTestId("draft").textContent).toBe("");
  });
});
