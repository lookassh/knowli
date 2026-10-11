/** Skala gwiazdek postępu: maksymalnie 6, po jednej za każdą szóstą drogi (100%/6 ≈ 16,7%). */
export const MASTERY_STAR_MAX = 6;

/**
 * Gwiazdki liczymy z całkowitego ułamka, nie z zaokrąglonego procentu:
 * 5/6 słów osiąga próg piątej gwiazdki dokładnie, a float po zaokrągleniu
 * gubiłby tę granicę.
 */
export function starsForFraction(known: number, total: number): number {
  return total <= 0 ? 0 : Math.min(MASTERY_STAR_MAX, Math.floor((known * MASTERY_STAR_MAX) / total));
}
