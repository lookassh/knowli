import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Zadanie generowania lekcji (`probe:chapter`): materiał z `tests/probes/fixtures`, env sondy, opcjonalne „+N”. */
export type GenerationTask = {
  kind: "generation";
  id: string;
  subject: "school" | "chapter" | "grammar";
  material: string;
  env: Record<string, string>;
  addCount?: number;
};

/** Zadanie kontroli zamkniętych na ćwiczeniach wzorcowych (`probe:gold`). */
export type GoldTask = { kind: "gold"; id: string; fixture: string };

export type BenchTask = GenerationTask | GoldTask;

/** Domyślna liczba powtórzeń zadań generowania (jak bieg potwierdzający etapu 5). */
export const DEFAULT_REPS = 2;

// Te same materiały i env co biegi etapów 4–5 (sha256 materiałów zgodne ze zrzutami w `~/knowli-probes`).
// Present Simple i Present Continuous dzielą jeden materiał z oboma czasami, tak jak w etapie 4.
export const SUITE: readonly BenchTask[] = [
  { kind: "generation", id: "school-plant-parts", subject: "school", material: "school-plant-parts.txt", env: { UMIEM_PROBE_SCHOOL_SUBJECT: "Przyroda", UMIEM_PROBE_TOPIC: "Części rośliny i ich zadania" } },
  { kind: "generation", id: "school-baptism-poland", subject: "school", material: "school-baptism-poland.txt", env: { UMIEM_PROBE_SCHOOL_SUBJECT: "Historia", UMIEM_PROBE_TOPIC: "Chrzest Polski" } },
  { kind: "generation", id: "chapter-clothes-weather", subject: "chapter", material: "chapter-clothes-weather.txt", env: {}, addCount: 3 },
  { kind: "generation", id: "chapter-home-rooms", subject: "chapter", material: "chapter-home-rooms.txt", env: {}, addCount: 3 },
  { kind: "generation", id: "chapter-food-likes", subject: "chapter", material: "chapter-food-likes.txt", env: {}, addCount: 3 },
  { kind: "generation", id: "grammar-to-be", subject: "grammar", material: "grammar-to-be.txt", env: { UMIEM_PROBE_GRAMMAR_TOPIC: "to_be" }, addCount: 3 },
  { kind: "generation", id: "grammar-present-simple", subject: "grammar", material: "grammar-present-tenses.txt", env: { UMIEM_PROBE_GRAMMAR_TOPIC: "present_simple" }, addCount: 3 },
  { kind: "generation", id: "grammar-present-continuous", subject: "grammar", material: "grammar-present-tenses.txt", env: { UMIEM_PROBE_GRAMMAR_TOPIC: "present_continuous" }, addCount: 3 },
  { kind: "gold", id: "gold-chapter", fixture: "closed-check-gold-stage5.json" },
  { kind: "gold", id: "gold-school", fixture: "closed-check-gold-school.json" },
];

export const fixturePath = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

export const sha256Of = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

export function taskById(id: string): BenchTask {
  const task = SUITE.find((item) => item.id === id);
  if (task === undefined) throw new Error(`nieznane zadanie ${id} (znane: ${SUITE.map((item) => item.id).join(", ")})`);
  return task;
}
