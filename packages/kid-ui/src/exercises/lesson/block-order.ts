import type { LessonItem } from "@learning/contracts";

/**
 * Czysty stan układania klocków dla `lesson_order` (design „Typy ćwiczeń i
 * etapy”): dotknięcie klocka w puli przenosi go do zdania w kolejności
 * dotknięć; dotknięcie klocka w zdaniu cofa go do puli na pierwotną pozycję
 * katalogową. „Sprawdź” jest aktywne dopiero po ułożeniu wszystkich klocków.
 * Logika jest bez Reacta, żeby można ją było przetestować bez DOM i żeby
 * widok pozostał cienki.
 */
export interface BlockState {
  /** Pełny katalog klocków w kolejności zadania (niezmienny). */
  readonly all: readonly LessonItem[];
  /** Klocki ułożone w zdaniu, w kolejności dotknięć dziecka. */
  readonly placed: readonly LessonItem[];
  /** Klocki wciąż w puli, w kolejności katalogowej. */
  readonly pool: readonly LessonItem[];
}

export function blockState(items: readonly LessonItem[]): BlockState {
  return { all: items, placed: [], pool: items };
}

export function placedIds(state: BlockState): string[] {
  return state.placed.map((item) => item.id);
}

/** Dotknięcie klocka w puli: dołącza do zdania; nie-element puli nic nie zmienia. */
export function addBlock(state: BlockState, id: string): BlockState {
  const item = state.pool.find((candidate) => candidate.id === id);
  if (item === undefined) return state;
  const placed = [...state.placed, item];
  return { all: state.all, placed, pool: poolFor(state.all, placed) };
}

/** Dotknięcie w zdaniu: cofa klocek z pozycji `index` do puli (pozycja katalogowa). */
export function removeAt(state: BlockState, index: number): BlockState {
  if (index < 0 || index >= state.placed.length) return state;
  const placed = state.placed.filter((_, position) => position !== index);
  return { all: state.all, placed, pool: poolFor(state.all, placed) };
}

export function isComplete(state: BlockState): boolean {
  return state.all.length > 0 && state.placed.length === state.all.length;
}

/** Pula = katalog bez klocków już ułożonych, zachowuje kolejność katalogową. */
function poolFor(all: readonly LessonItem[], placed: readonly LessonItem[]): LessonItem[] {
  const placedSet = new Set(placed.map((item) => item.id));
  return all.filter((item) => !placedSet.has(item.id));
}
