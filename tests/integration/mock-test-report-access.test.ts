import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createChild,
  endSession,
  getMockTestReportForSession,
  listMockTestReportsForDeck,
  nextTask,
  readMockTestSummaryForSession,
  startSession,
  submitAttempt,
  upsertAssignment,
  type AppError,
} from "@learning/server";
import { lessonWorld } from "../fixtures/lesson-world";
import { handleKidApi, buildTestServices, testDatabase, truncateCoreTables } from "./helpers";
import { mockTestDeck } from "./mock-test-helpers";

const { pool } = testDatabase();
beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.child_objective_progress, learning_app.lesson_verdicts,
    learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
    learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
    learning_app.deck_versions, learning_app.decks cascade`);
});
afterAll(() => pool.end());

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await expect(promise).rejects.toMatchObject({ code } satisfies Partial<AppError>);
}

async function setup(kind: "vocabulary" | "lesson") {
  const { services, clock } = buildTestServices();
  if (kind === "vocabulary") {
    const deck = await mockTestDeck(services, 4);
    await upsertAssignment(services, deck.childId, deck.deckId, null, {
      testGoals: ["recall", "spelling"], mockTestTaskCount: 2,
    });
    const session = await startSession(services, {
      childId: deck.childId, deckId: deck.deckId, microphoneEnabled: false, mode: "mock_test",
    });
    return { ...deck, services, clock, session, kind };
  }
  const child = await createChild(services, { displayName: "Próba", avatarKey: "fox" });
  const lesson = await lessonWorld(pool, {
    childId: child.id, richPool: true, testDate: "2026-10-20", now: clock.now(),
  });
  const session = await startSession(services, {
    childId: child.id, deckId: lesson.deckId, microphoneEnabled: false, mode: "mock_test",
  });
  return { childId: child.id, deckId: lesson.deckId, services, clock, session, kind };
}

describe.each(["vocabulary", "lesson"] as const)("raport kartkówki: %s", (kind) => {
  it("zachowuje utrwalony raport i listę bez ujawniania rozwiązań rodzicowi", async () => {
    const world = await setup(kind);
    const task = await nextTask(world.services, world.session.sessionId);
    expect(task).not.toBeNull();
    await submitAttempt(world.services, {
      taskId: task!.taskId, clientAttemptId: randomUUID(), modality: "skip",
    });
    await endSession(world.services, world.session.sessionId);

    const report = await getMockTestReportForSession(world.services, world.session.sessionId);
    expect(report.sessionId).toBe(world.session.sessionId);
    expect(await getMockTestReportForSession(world.services, world.session.sessionId)).toEqual(report);
    expect(await listMockTestReportsForDeck(world.services, world.childId, world.deckId)).toContainEqual(report);
    expect((await pool.query(
      `select id from learning_app.learning_events where task_id=$1 and kind='feedback_issued'`,
      [task!.taskId],
    )).rows).toHaveLength(0);
  });

  it("Kid HTTP pieczętuje wyłącznie wydane rozwiązanie przed każdym odczytem", async () => {
    const world = await setup(kind);
    const task = await nextTask(world.services, world.session.sessionId);
    expect(task).not.toBeNull();
    await endSession(world.services, world.session.sessionId);

    const request = () => handleKidApi(new Request(
      `http://localhost/api/v1/kid/sessions/${world.session.sessionId}/mock-test-summary`,
    ), world.services);
    const firstResponse = await request();
    const first = await firstResponse.json();
    world.clock.advanceMs(1_000);
    const secondResponse = await request();
    const second = await secondResponse.json();
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("cache-control")).toContain("no-store");
    expect(secondResponse.status).toBe(200);
    expect(second).toEqual(first);
    expect(first.solutions).toHaveLength(1);
    expect(first.solutions[0].taskId).toBe(task!.taskId);

    const events = (await pool.query<{ stepId: string; targetKey: string; sealed: boolean }>(
      `select e.step_id as "stepId", x.target_key as "targetKey", e.sealed
         from learning_app.learning_events e join learning_app.event_exposures x on x.event_id=e.id
        where e.task_id=$1 and e.kind='feedback_issued' order by e.occurred_at`, [task!.taskId],
    )).rows;
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.sealed)).toBe(true);
    const pinned = (await pool.query<{ plan: { slots: Array<{ taskId: string; targetKey: string }> } }>(
      `select mock_test_plan as plan from learning_app.learning_sessions where id=$1`,
      [world.session.sessionId],
    )).rows[0]!.plan.slots.find((slot) => slot.taskId === task!.taskId)!;
    expect(events.map((event) => event.targetKey)).toEqual([pinned.targetKey, pinned.targetKey]);
    const projection = (await pool.query<{ lastExposureAt: Date }>(
      `select last_exposure_at as "lastExposureAt"
         from learning_app.child_target_exposures where child_id=$1 and target_key=$2`,
      [world.childId, events[0]!.targetKey],
    )).rows[0]!;
    expect(projection.lastExposureAt.toISOString()).toBe(world.clock.now().toISOString());
    expect((await pool.query(
      `select e.id from learning_app.learning_events e
       join learning_app.session_tasks t on t.id=e.task_id
       where t.session_id=$1 and e.kind='feedback_issued' and e.task_id<>$2`,
      [world.session.sessionId, task!.taskId],
    )).rows).toHaveLength(0);
  });

  it("utrzymuje granicę 600000 ms i zamyka niepełną kartkówkę po jej przekroczeniu", async () => {
    const world = await setup(kind);
    await nextTask(world.services, world.session.sessionId);
    world.clock.advanceMs(600_000);
    await expectCode(getMockTestReportForSession(world.services, world.session.sessionId), "conflict");
    await expectCode(readMockTestSummaryForSession(world.services, world.session.sessionId), "conflict");
    expect(await listMockTestReportsForDeck(world.services, world.childId, world.deckId)).toEqual([]);
    world.clock.advanceMs(1);
    const report = await getMockTestReportForSession(world.services, world.session.sessionId);
    expect(report).toMatchObject({ complete: false });
    expect(await getMockTestReportForSession(world.services, world.session.sessionId)).toEqual(report);
  });
});

it("zachowuje not_found dla nieznanej/treningowej sesji i [] dla pustej listy", async () => {
  const { services } = buildTestServices();
  const deck = await mockTestDeck(services, 2);
  const training = await startSession(services, {
    childId: deck.childId, deckId: deck.deckId, microphoneEnabled: false,
  });
  await expectCode(getMockTestReportForSession(services, randomUUID()), "not_found");
  await expectCode(readMockTestSummaryForSession(services, randomUUID()), "not_found");
  await expectCode(getMockTestReportForSession(services, training.sessionId), "not_found");
  await expectCode(readMockTestSummaryForSession(services, training.sessionId), "not_found");
  await expectCode(listMockTestReportsForDeck(services, deck.childId, randomUUID()), "not_found");
  expect(await listMockTestReportsForDeck(services, deck.childId, deck.deckId)).toEqual([]);
});
