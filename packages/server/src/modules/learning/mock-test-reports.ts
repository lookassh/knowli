import type {
  LessonMockTestReportDto,
  LessonMockTestSummaryDto,
  MockTestReportDto,
  MockTestSummaryDto,
} from "@learning/contracts";
import type { Services } from "../../config";
import { mockTestKindOfSession, readDeckKind } from "../materials";
import {
  getMockTestReport,
  listMockTests,
  readMockTestSummary,
} from "./mock-tests";
import {
  getLessonMockTestReport,
  listLessonMockTests,
  readLessonMockTestSummary,
} from "./lessons/lesson-mock-tests";

/** Routes a completed mock test report to its owning subject implementation. */
export async function getMockTestReportForSession(
  services: Services,
  sessionId: string,
): Promise<MockTestReportDto | LessonMockTestReportDto> {
  const kind = await mockTestKindOfSession(services.db, sessionId);
  return kind === "lesson"
    ? getLessonMockTestReport(services, sessionId)
    : getMockTestReport(services, sessionId);
}

/** Lists reports through the implementation that owns the deck kind. */
export async function listMockTestReportsForDeck(
  services: Services,
  childId: string,
  deckId: string,
): Promise<MockTestReportDto[] | LessonMockTestReportDto[]> {
  const kind = await readDeckKind(services.db, deckId);
  return kind === "lesson"
    ? listLessonMockTests(services, childId, deckId)
    : listMockTests(services, childId, deckId);
}

/** Reads the child-facing summary; the owner seals disclosures before returning it. */
export async function readMockTestSummaryForSession(
  services: Services,
  sessionId: string,
): Promise<MockTestSummaryDto | LessonMockTestSummaryDto> {
  const kind = await mockTestKindOfSession(services.db, sessionId);
  return kind === "lesson"
    ? readLessonMockTestSummary(services, sessionId)
    : readMockTestSummary(services, sessionId);
}
