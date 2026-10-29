import type { Assignment, LessonItem } from "@learning/contracts";

/**
 * Czysty stan „Połącz w pary” i „Pogrupuj” (design szkoły §10.5): bez Reacta,
 * żeby reguły stukania dało się przetestować bez DOM, a widoki pozostały
 * cienkie. Odpowiedź to przypisania `itemId → targetId`; co jest poprawne,
 * wie wyłącznie serwer.
 */

/** „Połącz w pary”: lewe elementy z miejscem na prawy, pula prawych i aktywne miejsce. */
export interface MatchState {
  readonly left: readonly LessonItem[];
  readonly right: readonly LessonItem[];
  /** Prawy element przypisany do lewego (id lewego → id prawego). */
  readonly placed: ReadonlyMap<string, string>;
  /** Miejsce, do którego trafi następny dotknięty prawy element. */
  readonly active: string | null;
}

export function matchState(left: readonly LessonItem[], right: readonly LessonItem[]): MatchState {
  return { left, right, placed: new Map(), active: left[0]?.id ?? null };
}

/** Pula: prawe elementy jeszcze nieprzypisane, w kolejności zadania. */
export function matchPool(state: MatchState): LessonItem[] {
  const used = new Set(state.placed.values());
  return state.right.filter((item) => !used.has(item.id));
}

export function rightOf(state: MatchState, leftId: string): LessonItem | null {
  const rightId = state.placed.get(leftId);
  return rightId === undefined ? null : state.right.find((item) => item.id === rightId) ?? null;
}

/** Dotknięcie miejsca: staje się aktywne; zajęte miejsce oddaje element do puli. */
export function selectSlot(state: MatchState, leftId: string): MatchState {
  if (!state.left.some((item) => item.id === leftId)) return state;
  const placed = new Map(state.placed);
  placed.delete(leftId);
  return { ...state, placed, active: leftId };
}

/**
 * Dotknięcie prawego elementu z puli: trafia do aktywnego miejsca, a aktywne
 * staje się następne puste (w kolejności lewej kolumny, potem od początku).
 */
export function placeRight(state: MatchState, rightId: string): MatchState {
  if (state.active === null || !matchPool(state).some((item) => item.id === rightId)) return state;
  const placed = new Map(state.placed);
  placed.set(state.active, rightId);
  const start = state.left.findIndex((item) => item.id === state.active);
  const order = [...state.left.slice(start + 1), ...state.left.slice(0, start + 1)];
  return { ...state, placed, active: order.find((item) => !placed.has(item.id))?.id ?? null };
}

export function matchComplete(state: MatchState): boolean {
  return state.left.length > 0 && state.left.every((item) => state.placed.has(item.id));
}

export function matchAssignments(state: MatchState): Assignment[] {
  return state.left.flatMap((item) => {
    const targetId = state.placed.get(item.id);
    return targetId === undefined ? [] : [{ itemId: item.id, targetId }];
  });
}

/** „Pogrupuj”: grupy, elementy, przypisania i aktywna grupa. */
export interface GroupState {
  readonly groups: readonly LessonItem[];
  readonly items: readonly LessonItem[];
  /** Grupa elementu (id elementu → id grupy). */
  readonly placed: ReadonlyMap<string, string>;
  readonly active: string | null;
}

export function groupState(groups: readonly LessonItem[], items: readonly LessonItem[]): GroupState {
  return { groups, items, placed: new Map(), active: groups[0]?.id ?? null };
}

export function groupPool(state: GroupState): LessonItem[] {
  return state.items.filter((item) => !state.placed.has(item.id));
}

/** Elementy grupy w kolejności dotknięć. */
export function itemsIn(state: GroupState, groupId: string): LessonItem[] {
  return [...state.placed.entries()]
    .filter(([, target]) => target === groupId)
    .map(([itemId]) => state.items.find((item) => item.id === itemId))
    .filter((item): item is LessonItem => item !== undefined);
}

export function selectGroup(state: GroupState, groupId: string): GroupState {
  return state.groups.some((group) => group.id === groupId) ? { ...state, active: groupId } : state;
}

/** Dotknięcie elementu z puli: trafia do aktywnej grupy. */
export function addToGroup(state: GroupState, itemId: string): GroupState {
  if (state.active === null || !groupPool(state).some((item) => item.id === itemId)) return state;
  const placed = new Map(state.placed);
  placed.set(itemId, state.active);
  return { ...state, placed };
}

/** Dotknięcie elementu w grupie: wraca do puli. */
export function removeFromGroup(state: GroupState, itemId: string): GroupState {
  if (!state.placed.has(itemId)) return state;
  const placed = new Map(state.placed);
  placed.delete(itemId);
  return { ...state, placed };
}

export function groupComplete(state: GroupState): boolean {
  return state.items.length > 0 && state.items.every((item) => state.placed.has(item.id));
}

export function groupAssignments(state: GroupState): Assignment[] {
  return state.items.flatMap((item) => {
    const targetId = state.placed.get(item.id);
    return targetId === undefined ? [] : [{ itemId: item.id, targetId }];
  });
}
