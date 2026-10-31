import { describe, expect, it } from "vitest";
import { messages } from "@learning/contracts";
import { ApiCallError } from "../api";
import { classifyCreateFailure, isFreshSourceRefresh, sourceRefreshOutcome } from "./source-refresh";

describe("source-refresh — wspólne reguły formularzy ze źródła", () => {
  it("odpowiedź tworzenia: zmienione źródło i usunięte źródło są ostateczne, inny konflikt — niepewny", () => {
    const changed = new ApiCallError("Konflikt.", "conflict", 409, { reason: "source_changed" });
    const otherConflict = new ApiCallError("Konflikt.", "conflict", 409);
    const missing = new ApiCallError("Nie znaleziono.", "not_found", 404);
    const invalid = new ApiCallError("Błąd.", "validation", 400);
    expect(classifyCreateFailure(changed, true)).toBe("source-changed");
    expect(classifyCreateFailure(missing, true)).toBe("source-missing");
    expect(classifyCreateFailure(invalid, true)).toBe("rejected");
    expect(classifyCreateFailure(new ApiCallError("Brak dostępu.", "forbidden", 403), true)).toBe("rejected");
    expect(classifyCreateFailure(new ApiCallError("", "unauthorized", 401), true)).toBe("rejected");
    // konflikt bez szczegółów zmienionego źródła nie daje komunikatu o zmianie — wynik pozostaje niepewny
    expect(classifyCreateFailure(otherConflict, true)).toBe("uncertain");
    expect(classifyCreateFailure(new ApiCallError("Konflikt.", "conflict", 409, { reason: "other" }), true)).toBe("uncertain");
    // bez źródła (wklejony tekst) te odpowiedzi nie dotyczą źródła
    expect(classifyCreateFailure(changed, false)).toBe("uncertain");
    expect(classifyCreateFailure(missing, false)).toBe("uncertain");
    expect(classifyCreateFailure(new TypeError("Failed to fetch"), true)).toBe("uncertain");
    expect(messages.sources.changedBeforeCreate).toBe("Źródło zmieniono w innym oknie. Sprawdź tekst i utwórz lekcję ponownie.");
  });

  it("wynik refetch(): 404 — źródło usunięte, inny błąd — nieudane (mimo starych danych), sukces — bieżąca rewizja", () => {
    const old = { bodyRevision: 3 };
    expect(sourceRefreshOutcome({ isError: true, error: new ApiCallError("Nie znaleziono.", "not_found", 404), data: old })).toEqual({ status: "missing" });
    expect(sourceRefreshOutcome({ isError: true, error: new ApiCallError("Błąd.", "internal", 500), data: old })).toEqual({ status: "failed" });
    expect(sourceRefreshOutcome({ isError: true, error: new TypeError("Failed to fetch"), data: old })).toEqual({ status: "failed" });
    expect(sourceRefreshOutcome({ isError: false, error: null, data: { bodyRevision: 4 } })).toEqual({ status: "refreshed", bodyRevision: 4 });
    expect(sourceRefreshOutcome({ isError: false, error: null, data: undefined })).toEqual({ status: "failed" });
  });

  it("świeże odświeżenie: tylko udany odczyt z rewizją inną niż odrzucona", () => {
    expect(isFreshSourceRefresh({ status: "refreshed", bodyRevision: 4 }, 3)).toBe(true);
    // ta sama rewizja co w odrzuconym poleceniu — podgląd wciąż nieaktualny
    expect(isFreshSourceRefresh({ status: "refreshed", bodyRevision: 3 }, 3)).toBe(false);
    expect(isFreshSourceRefresh({ status: "failed" }, 3)).toBe(false);
    expect(isFreshSourceRefresh({ status: "missing" }, 3)).toBe(false);
  });
});
