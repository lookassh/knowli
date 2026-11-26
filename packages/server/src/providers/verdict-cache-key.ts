import { createHash } from "node:crypto";

/**
 * Klucz cache `lesson_verdicts.prompt_version` (#384): `{wersja}:{hash}`, gdzie hash
 * obejmuje wszystko, co zmienia werdykt poza odpowiedzią dziecka (model, opcje
 * pośrednika, wyrenderowany prompt systemowy z rolą i definicją „almost” przedmiotu).
 * Zmiana modelu w env albo profilu przedmiotu unieważnia cache bez ręcznego bumpa;
 * wersja zostaje prefiksem, po którym panel rodzica wybiera bieżące werdykty.
 */
export function verdictCacheKey(version: string, parts: readonly unknown[]): string {
  return `${version}:${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16)}`;
}
