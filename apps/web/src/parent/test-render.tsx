import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parentTheme } from "./theme";

/**
 * Statyczny HTML komponentu panelu z providerami Mantine i TanStack Query (testy jednostkowe).
 * Test może podać własny klient zapytań z wstawionymi danymi (`setQueryData`), by wyrenderować
 * ekran z wczytanym odczytem — renderowanie statyczne nie wykonuje zapytań ani efektów.
 */
export function renderParentMarkup(element: ReactElement, queryClient: QueryClient = new QueryClient()): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={parentTheme}>{element}</MantineProvider>
    </QueryClientProvider>,
  );
}
