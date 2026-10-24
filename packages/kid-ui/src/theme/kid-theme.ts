import { createTheme, type MantineThemeOverride } from "@mantine/core";

export const kidTokens = {
  background: "#080d1c",
  surface: "#17223d",
  border: "#2c3d5e",
  accent: "#8dd5ff",
  text: "#f0f5ff",
  muted: "#afbed8",
  good: "#79d3a0",
  goodBackground: "#183b32",
  wrong: "#ff8f91",
  wrongBackground: "#492b38",
} as const;

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
