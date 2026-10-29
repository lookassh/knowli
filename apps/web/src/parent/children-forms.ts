/** Czysta logika formularzy sekcji Dzieci (bez Reacta i Mantine — testowalna w Node). */
import { messages, type ChildDto, type ChildPatch } from "@learning/contracts";

export interface EditValues {
  displayName: string;
  avatarKey: string;
  recordingMode: ChildDto["recordingMode"];
  canRead: boolean;
}

/** Zmienione pola profilu; imię porównujemy po przycięciu spacji. */
export function childPatch(child: ChildDto, values: EditValues): ChildPatch {
  const name = values.displayName.trim();
  return {
    ...(name !== child.displayName.trim() ? { displayName: name } : {}),
    ...(values.avatarKey !== child.avatarKey ? { avatarKey: values.avatarKey } : {}),
    ...(values.recordingMode !== child.recordingMode ? { recordingMode: values.recordingMode } : {}),
    ...(values.canRead !== child.canRead ? { canRead: values.canRead } : {}),
  };
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
