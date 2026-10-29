#!/usr/bin/env node
/**
 * Kid UI "Zatoka" palette generator (dark only).
 *
 * Prints the color lines of the token block in packages/kid-ui/src/styles.css
 * (`--md-sys-color-*` and `--kid-color-*warm*`). Regenerate the whole block
 * with this script and paste the output instead of hand-tuning single roles;
 * tests/kid-tokens.test.ts guards the resulting contrast.
 *
 * Usage: node scripts/kid-palette.mjs
 */
import {
  DynamicScheme,
  MaterialDynamicColors,
  TonalPalette,
  hexFromArgb,
} from "@material/material-color-utilities";

/* Variant.TONAL_SPOT; the enum is not exported from the 0.3.0 entry point. */
const VARIANT_TONAL_SPOT = 2;

/* Parameters: [hue, chroma]. */
const PRIMARY = [240, 40];
const SECONDARY = [240, 16];
const TERTIARY = [150, 36];
const NEUTRAL = [225, 10];
const NEUTRAL_VARIANT = [225, 16];
const ERROR = [25, 56];
const WARM = [75, 40];

/* Tertiary doubles as success. M3 puts primary and tertiary at the same tone
   (T80), so their luminance is identical; success is shifted to T70 to differ
   from primary in lightness, not only in hue. */
const TERTIARY_TONES = { tertiary: 70, onTertiary: 20, tertiaryContainer: 30, onTertiaryContainer: 90 };
/* Warm group tones, as in the M3 dark spec for accents. */
const WARM_TONES = { warm: 80, onWarm: 20, warmContainer: 30, onWarmContainer: 90 };

const palette = ([hue, chroma]) => TonalPalette.fromHueAndChroma(hue, chroma);

const scheme = new DynamicScheme({
  sourceColorArgb: palette(PRIMARY).keyColor.toInt(),
  variant: VARIANT_TONAL_SPOT,
  contrastLevel: 0,
  isDark: true,
  primaryPalette: palette(PRIMARY),
  secondaryPalette: palette(SECONDARY),
  tertiaryPalette: palette(TERTIARY),
  neutralPalette: palette(NEUTRAL),
  neutralVariantPalette: palette(NEUTRAL_VARIANT),
});
scheme.errorPalette = palette(ERROR);

/* CSS role name -> MaterialDynamicColors member. */
const roles = {
  primary: "primary", "on-primary": "onPrimary",
  "primary-container": "primaryContainer", "on-primary-container": "onPrimaryContainer",
  secondary: "secondary", "on-secondary": "onSecondary",
  "secondary-container": "secondaryContainer", "on-secondary-container": "onSecondaryContainer",
  tertiary: "tertiary", "on-tertiary": "onTertiary",
  "tertiary-container": "tertiaryContainer", "on-tertiary-container": "onTertiaryContainer",
  error: "error", "on-error": "onError",
  "error-container": "errorContainer", "on-error-container": "onErrorContainer",
  "surface-dim": "surfaceDim", surface: "surface", "surface-bright": "surfaceBright",
  "on-surface": "onSurface", "on-surface-variant": "onSurfaceVariant",
  "surface-container-lowest": "surfaceContainerLowest", "surface-container-low": "surfaceContainerLow",
  "surface-container": "surfaceContainer", "surface-container-high": "surfaceContainerHigh",
  "surface-container-highest": "surfaceContainerHighest",
  "inverse-surface": "inverseSurface", "inverse-on-surface": "inverseOnSurface",
  "inverse-primary": "inversePrimary",
  outline: "outline", "outline-variant": "outlineVariant",
};

const lines = [];
for (const [name, member] of Object.entries(roles)) {
  const argb = member in TERTIARY_TONES
    ? scheme.tertiaryPalette.tone(TERTIARY_TONES[member])
    : MaterialDynamicColors[member].getArgb(scheme);
  lines.push(`--md-sys-color-${name}: ${hexFromArgb(argb)};`);
}

const warm = palette(WARM);
for (const [token, tone] of [
  ["warm", WARM_TONES.warm], ["on-warm", WARM_TONES.onWarm],
  ["warm-container", WARM_TONES.warmContainer], ["on-warm-container", WARM_TONES.onWarmContainer],
]) {
  lines.push(`--kid-color-${token}: ${hexFromArgb(warm.tone(tone))};`);
}

console.log(lines.join("\n"));
