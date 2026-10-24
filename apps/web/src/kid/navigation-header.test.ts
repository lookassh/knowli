import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileScreen } from "../../../../packages/kid-ui/src/screens/ProfileScreen";
import { DeckScreen } from "../../../../packages/kid-ui/src/screens/DeckScreen";
import { KidThemeProvider } from "../../../../packages/kid-ui/src/theme/KidThemeProvider";

describe("Akcje nagłówka / link do rodzica na ekranach nawigacyjnych (SPEC)", () => {
  it("ProfileScreen renderuje dostarczone akcje nagłówka", () => {
    const header = createElement("a", { href: "/parent", "data-testid": "kid-parent-link" }, "Strefa rodzica");
    const markup = renderToStaticMarkup(
      createElement(KidThemeProvider, null, createElement(ProfileScreen, {
        profiles: [],
        onSelect: () => undefined,
        headerActions: header,
      })),
    );
    expect(markup).toContain('href="/parent"');
    expect(markup).toContain("Strefa rodzica");
  });

  it("DeckScreen renderuje dostarczone akcje nagłówka", () => {
    const header = createElement("a", { href: "/parent", "data-testid": "kid-parent-link" }, "Strefa rodzica");
    const markup = renderToStaticMarkup(
      createElement(KidThemeProvider, null, createElement(DeckScreen, {
        decks: [],
        childName: "Adaś",
        microphone: false,
        micDenied: false,
        onToggleMicrophone: () => undefined,
        onStart: () => undefined,
        headerActions: header,
      })),
    );
    expect(markup).toContain('href="/parent"');
    expect(markup).toContain("Strefa rodzica");
  });
});
