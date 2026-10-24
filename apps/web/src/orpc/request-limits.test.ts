import { AppError } from "@learning/server";
import { describe, expect, it } from "vitest";
import { readCappedJson } from "./request-limits";

/**
 * Test jednostkowy przeniesionego z kid/kid-router.ts czytnika JSON z limitem
 * bajtów (raport aktywności). Ścieżka oRPC parsuje ciała sama, więc czytnik
 * trzyma tutaj swoją semantykę limitów: pre-check content-length, limit bajtów
 * po odczycie, puste ciało = null, zepsuty JSON = walidacja.
 */

const CAP = 16;

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/kid/sessions/22222222-2222-4222-8222-222222222222/end", {
    method: "POST",
    body,
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  });
}

describe("readCappedJson", () => {
  it("zwraca null dla pustego ciała (koniec sesji bez raportu)", async () => {
    await expect(readCappedJson(post(""), CAP)).resolves.toBeNull();
  });

  it("parsuje poprawne ciało mieszczące się w limicie", async () => {
    await expect(readCappedJson(post('{"a":1}'), CAP)).resolves.toEqual({ a: 1 });
  });

  it("odrzuca content-length ponad limit przed odczytem ciała", async () => {
    await expect(
      readCappedJson(post("{}", { "content-length": String(CAP + 1) }), CAP),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("odrzuca ciało ponad limit bez content-length (bajty UTF-8, nie UTF-16)", async () => {
    // 6 znaków wielobajtowych = 12 bajtów UTF-8 mimo length 6; drugi przykład
    // przekracza limit dopiero po zliczeniu bajtów.
    await expect(readCappedJson(post('"ąćęłńś"'), CAP)).resolves.toBe("ąćęłńś");
    await expect(readCappedJson(post(`"${"ą".repeat(CAP)}"`), CAP)).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("odrzuca zepsuty JSON jako błąd walidacji", async () => {
    await expect(readCappedJson(post("{oops"), CAP)).rejects.toBeInstanceOf(AppError);
    await expect(readCappedJson(post("{oops"), CAP)).rejects.toMatchObject({ code: "validation" });
  });
});
