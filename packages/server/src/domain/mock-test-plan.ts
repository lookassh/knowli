import type { TestGoal } from "@learning/contracts";
import type { MockTestCandidate, MockTestPlanSnapshot, MockTestSlot } from "./mock-test-types";

export function buildMockTestPlan(input: { testGoals: TestGoal[]; testDate: string | null; requestedTaskCount: number; candidates: readonly MockTestCandidate[]; newId: () => string }): MockTestPlanSnapshot {
  const writtenGoals = input.testGoals.filter(g => g !== "listening");
  const scope = input.candidates.map(c => ({ itemId: c.itemId, itemRevisionId: c.itemRevisionId, position: c.position,
    source: c.source, target: c.target, skills: Object.fromEntries(input.testGoals.map(g => [g, c.skills[g]?.skillVersionId])),
    unavailable: {} as Partial<Record<TestGoal, string>> }));
  const scopes = new Map(scope.map(s => [s.itemId, s]));
  const sort = (goals: TestGoal[]) => (a: MockTestCandidate, b: MockTestCandidate) =>
    Math.min(...goals.map(g => a.skills[g]?.priority ?? 2)) - Math.min(...goals.map(g => b.skills[g]?.priority ?? 2)) || a.position - b.position || a.itemId.localeCompare(b.itemId);
  const written: MockTestSlot[] = [], listening: MockTestSlot[] = [];
  for (const c of input.candidates) {
    if (!c.known) {
      for (const g of input.testGoals) scopes.get(c.itemId)!.unavailable[g] = "not_known";
    }
  }
  if (writtenGoals.length) for (const c of input.candidates.filter(c => c.known).sort(sort(writtenGoals))) {
    written.push({ taskId: input.newId(), itemId: c.itemId, itemRevisionId: c.itemRevisionId, targetKey: c.targetKey,
      audioAssetId: c.audioAssetId,
      exerciseType: "recall", goals: writtenGoals, prompt: { kind: "recall", prompt: c.source },
      answerKey: { exerciseType: "recall", target: c.target, acceptedAnswers: c.acceptedAnswers } });
  }
  if (input.testGoals.includes("listening")) for (const c of input.candidates.filter(c => c.known).sort(sort(["listening"]))) {
    const seen = new Set([c.source.normalize("NFC").trim().toLowerCase()]);
    const alternatives = input.candidates.filter(x => x.known && x.itemId !== c.itemId).filter(x => {
      const text = x.source.normalize("NFC").trim().toLowerCase();
      if (seen.has(text)) return false; seen.add(text); return true;
    }).slice(0, 3);
    if (!c.audioAssetId || !alternatives.length) {
      scopes.get(c.itemId)!.unavailable.listening = c.audioAssetId ? "insufficient_options" : "missing_audio";
      continue;
    }
    const opts = [c, ...alternatives].map(x => ({ id: input.newId(), text: x.source, revisionId: x.itemRevisionId }));
    const correctOptionId = opts[0]!.id;
    opts.sort((a, b) => a.id.localeCompare(b.id));
    listening.push({ taskId: input.newId(), itemId: c.itemId, itemRevisionId: c.itemRevisionId, targetKey: c.targetKey,
      audioAssetId: c.audioAssetId,
      exerciseType: "listening", goals: ["listening"], prompt: { kind: "listening", options: opts.map(({ id, text }) => ({ id, text })), audioAssetId: c.audioAssetId },
      answerKey: { exerciseType: "listening", target: c.target, acceptedAnswers: c.acceptedAnswers,
        correctOptionId, optionItemRevisionIds: Object.fromEntries(opts.map(o => [o.id, o.revisionId])) } });
  }
  const n = input.requestedTaskCount;
  let w = Math.min(written.length, listening.length && writtenGoals.length ? Math.ceil(n / 2) : n);
  let l = Math.min(listening.length, writtenGoals.length ? Math.floor(n / 2) : n);
  let left = n - w - l;
  const moreWritten = Math.min(left, written.length - w); w += moreWritten; left -= moreWritten;
  l += Math.min(left, listening.length - l);
  return { version: 1, testGoals: input.testGoals, testDate: input.testDate, requestedTaskCount: n,
    scope, slots: [...written.slice(0, w), ...listening.slice(0, l)] };
}
