import type { RuleCatalog } from "./catalog";

/**
 * Katalog reguł rdzenia (spec katalogu reguł §2.2): kontrakt, kształt rekordu
 * agenta, pola wspólne i reguły typów z `pool-validation.ts`, rachunki,
 * `explanationPl`. Wypełniany w kolejnych zadaniach.
 *
 * Bez importu wartości z `./catalog` (cykl przez `ENGINE_CATALOGS`): katalog
 * deklaruje się przez `satisfies RuleCatalog`, a id sprawdza `defineRules`
 * przy składaniu `ENGINE_CATALOGS`. Liczby w opisach biorą się ze stałych
 * kontraktu albo `./limits`.
 */
export const CORE_RULES = {} as const satisfies RuleCatalog;
