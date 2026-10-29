// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { within } from "@testing-library/react";
import { cleanup, renderKid, screen } from "../test/render-kid";
import { Chip } from "./Chip";
import { RowList, RowListItem } from "./RowList";

afterEach(cleanup);

describe("RowList", () => {
  it("renders rows with title, description and trailing action", () => {
    renderKid(
      <RowList aria-label="Zestawy">
        <RowListItem title="Kolory" description="10 słów" trailing={<span>→</span>} />
      </RowList>,
    );
    const list = screen.getByRole("list", { name: "Zestawy" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(list.textContent).toContain("Kolory");
    expect(list.textContent).toContain("10 słów");
    expect(list.textContent).toContain("→");
  });

  it("renders leading and below content and tolerates omitted slots", () => {
    renderKid(
      <RowList aria-label="Wyniki">
        <RowListItem title="Sam tytuł" />
        <RowListItem leading={<span>L</span>} title="Pełny" below={<span>pod spodem</span>} />
      </RowList>,
    );
    const items = within(screen.getByRole("list", { name: "Wyniki" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe("Sam tytuł");
    expect(items[1]!.textContent).toContain("L");
    expect(items[1]!.textContent).toContain("pod spodem");
  });
});

describe("Chip", () => {
  it("marks the chip tone", () => {
    renderKid(<Chip tone="warm" data-testid="c">Kartkówka: 4 lis</Chip>);
    expect(screen.getByTestId("c").getAttribute("data-tone")).toBe("warm");
  });

  it("defaults to neutral and renders children", () => {
    renderKid(<Chip data-testid="c" icon="calendar">Dziś</Chip>);
    const chip = screen.getByTestId("c");
    expect(chip.getAttribute("data-tone")).toBe("neutral");
    expect(chip.textContent).toBe("Dziś");
    expect(chip.querySelector("svg")).not.toBeNull();
  });
});
