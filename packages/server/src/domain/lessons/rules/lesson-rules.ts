import type { RuleCatalog } from "./catalog";

/**
 * Katalog reguł lekcji (spec katalogu reguł §2.2): reguły całej puli
 * (`validatePool`), limity zagadnienia, ujawnienia odpowiedzi i kontrole
 * modelami. Wypełniany w kolejnych zadaniach.
 *
 * Bez importu wartości z `./catalog` (cykl przez `ENGINE_CATALOGS`): katalog
 * deklaruje się przez `satisfies RuleCatalog`, a id sprawdza `defineRules`
 * przy składaniu `ENGINE_CATALOGS`.
 */
export const LESSON_RULES = {} as const satisfies RuleCatalog;
