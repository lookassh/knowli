import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parentTheme } from "./theme";

/** Statyczny HTML komponentu panelu z providerami Mantine i TanStack Query (testy jednostkowe). */
export function renderParentMarkup(element: ReactElement): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider theme={parentTheme}>{element}</MantineProvider>
    </QueryClientProvider>,
  );
}
