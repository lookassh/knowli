import { createTheme, type MantineThemeOverride } from "@mantine/core";

export const kidTheme: MantineThemeOverride = createTheme({
  fontFamily: "KnowliKidManrope, sans-serif",
  headings: { fontFamily: "KnowliKidManrope, sans-serif", fontWeight: "800" },
  primaryColor: "sky",
  primaryShade: { light: 6, dark: 4 },
  colors: {
    sky: [
      "#e4f5ff", "#ceebff", "#b5e0ff", "#a3dbff", "#8dd5ff",
      "#78c7f4", "#6cbae8", "#4599c6", "#26769f", "#15516f",
    ],
  },
  defaultRadius: 26,
  autoContrast: true,
});
