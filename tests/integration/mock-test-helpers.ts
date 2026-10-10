import type { Services } from "@learning/server";
import { mockTestDeck as createWorld } from "../fixtures/mock-test-world";
import { testDatabase } from "./helpers";
export function mockTestDeck(services: Services, count = 4, known = true, words?: { source: string; target: string; acceptedAnswers?: string[] }[]) {
  return createWorld(services, testDatabase().pool, count, known, words);
}
