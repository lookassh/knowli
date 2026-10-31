import { describe, expect, it } from "vitest";
import { formsOf, stemsOf } from "./inflection";

describe("stemsOf — prosta odmiana angielska", () => {
  it.each([
    ["boots", ["boot"]],
    ["raining", ["rain", "raine"]],
    ["swimming", ["swimm", "swimme", "swim"]],
    ["parties", ["party", "parti", "partie"]],
    ["skating", ["skat", "skate"]],
    ["stopped", ["stopp", "stoppe", "stop"]],
    ["rained", ["rain", "raine"]],
    ["dresses", ["dress", "dresse"]],
    ["boxes", ["box", "boxe"]],
    ["tom's", ["tom"]],
  ])("„%s” → %j", (token, stems) => {
    expect(stemsOf(token)).toEqual(stems);
  });

  it("nie odcina -s po podwójnym s ani w dopełniaczu", () => {
    expect(stemsOf("dress")).toEqual([]);
    expect(stemsOf("tom's")).not.toContain("tom'");
  });

  it("pomija rdzenie krótsze niż 3 znaki", () => {
    expect(stemsOf("wing")).toEqual([]);
    expect(stemsOf("red")).toEqual([]);
    expect(stemsOf("ones")).toEqual(["one"]);
  });

  it("słowo bez końcówki nie ma rdzeni", () => {
    expect(stemsOf("category")).toEqual([]);
    expect(stemsOf("coat")).toEqual([]);
  });
});

describe("formsOf — formy porównania tokenu", () => {
  it("token i jego rdzenie", () => {
    expect(formsOf("coats")).toEqual(["coats", "coat"]);
    expect(formsOf("wearing")).toEqual(["wearing", "wear", "weare"]);
    expect(formsOf("coat")).toEqual(["coat"]);
  });

  it("rdzeń będący słowem funkcyjnym się nie liczy (thing → the, shed → she, noted → not)", () => {
    expect(stemsOf("thing")).toEqual(["the"]);
    expect(formsOf("thing")).toEqual(["thing"]);
    expect(formsOf("shed")).toEqual(["shed"]);
    expect(formsOf("noted")).toEqual(["noted", "note"]);
    expect(formsOf("cans")).toEqual(["cans"]);
  });

  it("samo słowo funkcyjne zostaje jako forma (dopasowanie dokładne)", () => {
    expect(formsOf("the")).toEqual(["the"]);
    expect(formsOf("is")).toEqual(["is"]);
  });
});
