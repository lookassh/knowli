// @vitest-environment jsdom
import type { ReactElement } from "react";
import { render, act, cleanup, fireEvent, screen, type RenderOptions, type RenderResult } from "@testing-library/react";
import { KidThemeProvider } from "../theme/KidThemeProvider";

export function renderKid(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">): RenderResult {
  if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
  return render(ui, { wrapper: KidThemeProvider, ...options });
}

export { act, cleanup, fireEvent, screen };
