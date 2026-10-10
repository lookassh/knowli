import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { TestGoal, TaskDto } from "@learning/contracts";
import type { Services } from "../config";
import type { Tx } from "../db/client";
import { itemRevisions, learningSessions, sessionTasks } from "../db/schema";
import { buildMockTestPlan } from "../domain/mock-test-plan";
import type { MockTestCandidate, MockTestPlanSnapshot } from "../domain/mock-test-types";
import { computeTargetKey } from "../domain/target-key";
import { payloadToItem } from "./item-payload";
import { writeSealedEvent } from "./events";

export async function createMockTestPlan(tx: Tx, services: Services, input: { childId: string; deckVersionId: string; testGoals: TestGoal[]; testDate: string | null; requestedTaskCount: number }): Promise<MockTestPlanSnapshot> {
  const revisions = await tx.select().from(itemRevisions).where(eq(itemRevisions.deckVersionId, input.deckVersionId)).orderBy(asc(itemRevisions.position));
  const candidates: MockTestCandidate[] = [];
  for (const r of revisions) {
    const item = payloadToItem(r.payload);
    const data = await tx.execute<{ skill: TestGoal; skill_version_id: string; status: string | null; checked: boolean; known: boolean; audio: string | null }>(sql`
      select s.skill,s.skill_version_id,p.status,
        exists(select 1 from learning_app.assessments a where a.child_id=${input.childId} and a.skill_version_id=s.skill_version_id and a.skill=s.skill and a.independent and a.outcome<>'unassessed') as checked,
        exists(select 1 from learning_app.learning_events e
          join learning_app.session_tasks t on t.id=e.task_id
          join learning_app.item_revision_skills os on os.item_revision_id=t.item_revision_id and os.skill='recall'
          join learning_app.item_revision_skills cs on cs.item_revision_id=${r.id} and cs.skill='recall' and cs.skill_version_id=os.skill_version_id
          join learning_app.event_exposures x on x.event_id=e.id
          where e.child_id=${input.childId} and e.item_id=${r.itemId} and e.sealed and x.target_key=${computeTargetKey(item.target, item.locales.target)}) as known,
        (select ra.asset_id from learning_app.revision_assets ra join learning_app.media_assets m on m.id=ra.asset_id
          where ra.item_revision_id=${r.id} and ra.role='target_audio' and ra.state='approved' and m.state='ready' limit 1) as audio
      from learning_app.item_revision_skills s left join learning_app.child_skill_progress p on p.child_id=${input.childId} and p.skill_version_id=s.skill_version_id
      where s.item_revision_id=${r.id} and s.skill in ('recall','spelling','listening')`);
    candidates.push({ itemId: r.itemId, itemRevisionId: r.id, position: r.position, source: item.source, target: item.target,
      targetKey: computeTargetKey(item.target, item.locales.target), acceptedAnswers: item.acceptedAnswers, known: data.rows[0]?.known ?? false,
      audioAssetId: data.rows[0]?.audio ?? null, skills: Object.fromEntries(data.rows.map(s => [s.skill, { skillVersionId: s.skill_version_id,
        priority: !s.checked ? 0 : s.status === "practicing" || s.status === "needs_reconfirmation" ? 1 : 2 }])) });
  }
  return buildMockTestPlan({ ...input, candidates, newId: randomUUID });
}

export async function issueMockTestTask(tx: Tx, services: Services, session: typeof learningSessions.$inferSelect): Promise<TaskDto | null> {
  const tasks = await tx.select().from(sessionTasks).where(eq(sessionTasks.sessionId, session.id)).orderBy(asc(sessionTasks.ordinal));
  const active = tasks.find(t => t.state === "issued");
  if (active) return { taskId: active.id, sessionId: session.id, ordinal: active.ordinal, exerciseType: active.exerciseType as TaskDto["exerciseType"],
    direction: null, state: "issued", prompt: active.publicPrompt as TaskDto["prompt"], remainingAssessed: session.taskBudget - active.ordinal };
  const slot = session.mockTestPlan!.slots[tasks.length];
  if (!slot) return null;
  await tx.insert(sessionTasks).values({ id: slot.taskId, sessionId: session.id, childId: session.childId, deckVersionId: session.deckVersionId,
    itemRevisionId: slot.itemRevisionId, ordinal: tasks.length, exerciseType: slot.exerciseType, direction: null, state: "issued",
    publicPrompt: slot.prompt as unknown as Record<string, unknown>, answerKey: slot.answerKey as unknown as Record<string, unknown>,
    context: { reason: "mock-test" }, issuedAt: services.clock.now() });
  await writeSealedEvent(tx, { childId: session.childId, taskId: slot.taskId, itemId: slot.itemId, kind: "prompt_issued",
    stepId: `${slot.taskId}:prompt`, occurredAt: services.clock.now(), exposures: slot.exerciseType === "listening" ? [slot.targetKey] : [] });
  return { taskId: slot.taskId, sessionId: session.id, ordinal: tasks.length, exerciseType: slot.exerciseType,
    direction: null, state: "issued", prompt: slot.prompt, remainingAssessed: session.taskBudget - tasks.length };
}
