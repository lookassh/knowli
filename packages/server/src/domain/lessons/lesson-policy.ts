/**
 * Konfiguracja polityki lekcji (design „Selektor zadań”, „Generowanie puli”).
 * Jedno miejsce na parametry: selektor i generator czytają je stąd, a testy
 * strojenia podają własną politykę. Bez literałów rozsianych po selektorze.
 */

/** Docelowy rozkład etapów w generowanej puli (sumuje się do 1). */
export interface StageMix {
  readonly guided: number;
  readonly productive: number;
  readonly independent: number;
}

/** Minimalna liczba ćwiczeń na etap w puli (walidacja puli, zadanie 6). */
export interface PoolMinimums {
  readonly guided: number;
  readonly productive: number;
  readonly independent: number;
}

/** Parametry rozmiaru puli: `clamp(max(base, perObjective × n), min, max)`. */
export interface PoolSizeConfig {
  readonly base: number;
  readonly perObjective: number;
  readonly min: number;
  readonly max: number;
}

/** Polityka lekcji — wszystkie parametry selektora i generatora w jednym typie. */
export interface LessonPolicy {
  /** Kolejne poprawne na etapie, po których cel awansuje na następny etap. */
  readonly advanceAfterCorrect: number;
  /** Ile nowych celów można wprowadzić w jednej sesji. */
  readonly maxNewObjectivesPerSession: number;
  /** Ile cykli wsparcia na jeden cel w jednej sesji. */
  readonly supportCyclesPerObjectivePerSession: number;
  /** Docelowy rozkład etapów (używany później przez generator puli). */
  readonly stageMix: StageMix;
  /** Minimalna liczność etapów w puli (zadanie 6). */
  readonly poolMinimums: PoolMinimums;
  /** Parametry rozmiaru puli. */
  readonly defaultPoolSize: PoolSizeConfig;
}

export const DEFAULT_LESSON_POLICY: LessonPolicy = {
  advanceAfterCorrect: 2,
  maxNewObjectivesPerSession: 2,
  supportCyclesPerObjectivePerSession: 1,
  stageMix: { guided: 0.35, productive: 0.45, independent: 0.2 },
  poolMinimums: { guided: 3, productive: 4, independent: 2 },
  defaultPoolSize: { base: 60, perObjective: 12, min: 20, max: 120 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Rozmiar puli dla `objectiveCount` celów: `clamp(max(base, perObjective × n))`.
 * Parametry z `policy.defaultPoolSize` (domyślnie z `DEFAULT_LESSON_POLICY`),
 * więc żaden literał rozmiaru nie żyje w selektorze.
 */
export function defaultPoolSize(
  objectiveCount: number,
  config: PoolSizeConfig = DEFAULT_LESSON_POLICY.defaultPoolSize,
): number {
  const { base, perObjective, min, max } = config;
  return clamp(Math.max(base, perObjective * objectiveCount), min, max);
}
