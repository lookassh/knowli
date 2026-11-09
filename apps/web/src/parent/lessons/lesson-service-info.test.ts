import { describe, expect, it } from "vitest";
import { messages, type SubjectCatalogDto } from "@learning/contracts";
import { subjectServiceInfo } from "./lesson-service-info";

type CatalogSubject = SubjectCatalogDto["subjects"][number];

const CHECK = "openrouter.ai · checker";
const school: CatalogSubject = {
  id: "school", titlePl: "Szkoła", creation: "material", subjectTitleRequired: true, topics: [],
};

describe("subjectServiceInfo (komunikaty o usługach generowania puli)", () => {
  it("wariant z materiałem: tekst drugiego modelu, bez komunikatu o ocenie pytań otwartych", () => {
    const info = subjectServiceInfo({ ...school, generationServices: ["openrouter.ai · a"], checkService: CHECK, checkServiceIncludesMaterial: true });
    expect(info.check).toBe(messages.lessons.checkServiceInfoWithMaterial.replace("{service}", CHECK));
    // Treść mówi, co sprawdza drugi model (bez podpowiedzi i próbnych odpowiedzi od etapu 5b), i zapewnia o danych dziecka.
    expect(info.check).toBe(
      `Podczas przygotowania lekcji drugi model (${CHECK}) sprawdza na próbę ćwiczenia zamknięte (wybór, dopasowanie, grupy, luki z bankiem, pojęcia kluczowe, kolejność). Dostaje ćwiczenia i materiał lekcji — nigdy imienia, wieku ani odpowiedzi dziecka.`,
    );
    expect(info).not.toHaveProperty("openCheck");
  });

  it("bez checkService oraz bez przedmiotu: check null, pozostałe pola bez zmian", () => {
    expect(subjectServiceInfo(school)).toMatchObject({ check: null });
    expect(subjectServiceInfo(undefined)).toEqual({ generationServices: null, themesService: null, generation: null, check: null });
  });

  it("wartość {service} z dolarem jest wstawiana dosłownie", () => {
    const info = subjectServiceInfo({ ...school, checkService: "h · m$&" });
    expect(info.check).toContain("h · m$&");
  });
});
