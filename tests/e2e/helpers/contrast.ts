import { expect, type Locator, type Page } from "@playwright/test";

/** Computed rgb() of a Kid UI color token, so assertions survive palette regeneration. */
export async function kidTokenColor(page: Page, token: `--${string}`): Promise<string> {
  return page.locator(".kid-ui").first().evaluate((root, name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    root.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

/** WCAG contrast of an element's own text color against its own background. */
export async function ownColorContrast(element: Locator): Promise<{ ratio: number; color: string; background: string; backgroundLuminance: number }> {
  return element.evaluate((node) => {
    const style = getComputedStyle(node);
    const luminance = (color: string) => {
      const [red, green, blue] = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
    };
    const text = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return {
      ratio: (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05),
      color: style.color,
      background: style.backgroundColor,
      backgroundLuminance: background,
    };
  });
}

/** Readable text on a dark container of the forced night theme. */
export async function expectReadableOnDarkContainer(element: Locator): Promise<void> {
  const contrast = await ownColorContrast(element);
  expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
  expect(contrast.backgroundLuminance, `light container in the night theme: ${JSON.stringify(contrast)}`).toBeLessThan(0.2);
}
