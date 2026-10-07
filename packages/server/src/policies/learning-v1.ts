import type { Policy } from "../domain/types";

/**
 * Polityka początkowa learning-v1 — odwzorowuje reguły startowe SPEC §18
 * i architecture.md §9.3: 300 sekund od ujawnienia, trzy ostatnie kwalifikujące
 * sukcesy, potwierdzenie innego dnia i po co najmniej 12 godzinach, dwa błędy
 * przed wsparciem. Wartości są ustawieniami do kalibracji, nie wynikiem badań.
 *
 * `pronunciationBands` jest celowo pusty: pasma wymowy zależą od providera
 * i wymagają próby technicznej (zadanie 0 / SPEC §18 — bez uniwersalnego
 * progu dla wszystkich usług).
 */
export const LEARNING_V1_POLICY: Policy = {
  version: "learning-v1",
  independenceAfterSeconds: 300,
  successStreakRequired: 3,
  confirmationMinHours: 12,
  supportAfterFailures: 2,
  readingDirections: ["target_to_source", "source_to_target"],
  pronunciationBands: {},
};
