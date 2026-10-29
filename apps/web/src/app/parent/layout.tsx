import "./layers.css";
import "@mantine/core/styles.layer.css";
import "@mantine/notifications/styles.layer.css";
import { ColorSchemeScript } from "@mantine/core";
import { ParentProviders } from "@/parent/ParentProviders";
import { PARENT_COLOR_SCHEME_KEY } from "@/parent/color-scheme-key";

/**
 * Layout panelu rodzica: style Mantine (w warstwie CSS `mantine`) i providery
 * ładowane tylko pod `/parent`, żeby nie dotykały Kid UI. Skrypt schematu
 * ustawia `data-mantine-color-scheme` na `<html>` przed pierwszym malowaniem
 * przy pełnym wejściu na `/parent`; przy nawigacji klienckiej robi to
 * `MantineProvider`.
 */
export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ColorSchemeScript defaultColorScheme="auto" localStorageKey={PARENT_COLOR_SCHEME_KEY} />
      <ParentProviders>{children}</ParentProviders>
    </>
  );
}
