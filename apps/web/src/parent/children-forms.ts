/** Czysta logika formularzy sekcji Dzieci (bez Reacta i Mantine — testowalna w Node). */
import {
  isValidChildInterest,
  MAX_CHILD_INTEREST_LENGTH,
  messages,
  normalizeChildInterest,
  type ChildDto,
  type ChildPatch,
} from "@learning/contracts";

export interface EditValues {
  displayName: string;
  avatarKey: string;
  recordingMode: ChildDto["recordingMode"];
  canRead: boolean;
  interests: string[];
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** Zmienione pola profilu; imię porównujemy po przycięciu spacji. */
export function childPatch(child: ChildDto, values: EditValues): ChildPatch {
  const name = values.displayName.trim();
  return {
    ...(name !== child.displayName.trim() ? { displayName: name } : {}),
    ...(values.avatarKey !== child.avatarKey ? { avatarKey: values.avatarKey } : {}),
    ...(values.recordingMode !== child.recordingMode ? { recordingMode: values.recordingMode } : {}),
    ...(values.canRead !== child.canRead ? { canRead: values.canRead } : {}),
    ...(!sameList(values.interests, child.interests) ? { interests: values.interests } : {}),
  };
}

/**
 * Lista z pola tematów: normalizuje wpisy (jak serwer), pomija puste i powtórzenia
 * (bez względu na wielkość liter). Niepoprawne wpisy zostają — formularz pokazuje błąd
 * zamiast po cichu je gubić.
 */
export function parseInterestsInput(entries: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeChildInterest(entry);
    const key = normalized.toLowerCase();
    if (normalized.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

/** Komunikat dla listy tematów z niepoprawnym wpisem (zapis wtedy nieaktywny) albo `null`. */
export function interestsError(interests: readonly string[]): string | null {
  return interests.every(isValidChildInterest)
    ? null
    : messages.children.interestsInvalid.replace("{max}", String(MAX_CHILD_INTEREST_LENGTH));
}

export interface ThresholdValues {
  good: number | string;
  almost: number | string;
}

function isThreshold(value: number | string): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

/** Walidacja progów jak w kontrakcie (`PronunciationThresholdsSchema`), z polskimi komunikatami. */
export function validateThresholds(values: ThresholdValues): Partial<Record<keyof ThresholdValues, string>> {
  const errors: Partial<Record<keyof ThresholdValues, string>> = {};
  if (!isThreshold(values.good)) errors.good = messages.children.pronunciationThresholdRange;
  if (!isThreshold(values.almost)) errors.almost = messages.children.pronunciationThresholdRange;
  if (!errors.good && !errors.almost && Number(values.good) <= Number(values.almost)) {
    errors.good = messages.children.pronunciationThresholdOrder;
  }
  return errors;
}
