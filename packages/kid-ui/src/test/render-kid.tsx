// @vitest-environment jsdom
import type { ReactElement } from "react";
import { render, act, cleanup, fireEvent, screen, type RenderOptions, type RenderResult } from "@testing-library/react";
import { KidThemeProvider } from "../theme/KidThemeProvider";

export function renderKid(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">): RenderResult {
  return render(ui, { wrapper: KidThemeProvider, ...options });
}

export { act, cleanup, fireEvent, screen };
