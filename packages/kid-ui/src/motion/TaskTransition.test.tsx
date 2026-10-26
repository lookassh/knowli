// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { TaskTransition } from "./TaskTransition";

afterEach(cleanup);

describe("TaskTransition", () => {
  it("reports pane mounts in order, once per task", async () => {
    const onPaneMount = vi.fn();
    const view = (taskId: string) => (
      <TaskTransition taskId={taskId} onPaneMount={onPaneMount}>
        <p>{taskId}</p>
      </TaskTransition>
    );
    const { rerender } = render(view("task-a"));
    expect(onPaneMount.mock.calls).toEqual([["task-a"]]);

    rerender(view("task-b"));
    await waitFor(() => expect(screen.getByText("task-b")).toBeTruthy());
    expect(onPaneMount.mock.calls).toEqual([["task-a"], ["task-b"]]);
    expect(screen.getByTestId("kid-task-transition").hasAttribute("inert")).toBe(false);
  });
});
