import { describe, expect, it } from "vitest";
import { A, B, contextFor, gap, naChecks, open, stateWith } from "../testing/agent-admission-fixtures";
import type { LessonExerciseDraft } from "../types";
import { admitBatch, precheckBatch, submitExamples, type AdmitEntry } from "./admission";
import { poolOf, type LessonAgentState } from "./state";

const ctx = contextFor();

function submit(state: LessonAgentState, objectiveId: string, drafts: readonly LessonExerciseDraft[]) {
  const prechecked = precheckBatch(state, objectiveId, drafts, ctx);
  return admitBatch(state, objectiveId, prechecked, naChecks(drafts.length), ctx);
}

function acceptAll(state: LessonAgentState, objectiveId: string, drafts: readonly LessonExerciseDraft[]): LessonAgentState {
  const result = submit(state, objectiveId, drafts);
  for (const entry of result.results) expect(entry).toHaveProperty("accepted");
  return result.state;
}

function rejectionOf(entry: AdmitEntry | undefined) {
  if (entry === undefined || !("rejected" in entry)) throw new Error(`expected rejection, got ${JSON.stringify(entry)}`);
  return entry.rejected;
}

describe("przyjmowanie paczki — ujawnienia (tryb coverage)", () => {
  it("kandydat samodzielny równy przykładowi karty: leak_victim z tekstem polityki i przykładem", () => {
    const state = stateWith({ examples: { [A]: ["w 966 roku"] } });
    const rejection = rejectionOf(submit(state, A, [open(A, "Kiedy?", "w 966 roku")]).results[0]);
    expect(rejection.kind).toBe("leak");
    expect(rejection.code).toBe("leak_victim");
    expect(rejection.reasons[0]).toMatch(/^leak victim /);
    expect(rejection.reasons[0]).toContain('the card example "w 966 roku"');
  });

  it("stałe źródło (fixedSources) innego zagadnienia też ujawnia: leak_victim", () => {
    const state = stateWith({ fixedSources: { [B]: ["w 966 roku"] } });
    expect(rejectionOf(submit(state, A, [open(A, "Kiedy?", "w 966 roku")]).results[0]).code).toBe("leak_victim");
  });

  it("niesamodzielny kandydat ujawniający przyjęte samodzielne: leak_source z identyfikatorem ofiary", () => {
    const state = acceptAll(stateWith(), A, [open(A, "Rok chrztu?", "966")]);
    const rejection = rejectionOf(submit(state, A, [gap(A, "Chrzest Polski w roku ___.", "966")]).results[0]);
    expect(rejection).toMatchObject({ kind: "leak", code: "leak_source" });
    expect(rejection.reasons[0]).toMatch(/^leak source /);
    expect(rejection.reasons[0]).toContain('exercise ex1 "966"');
  });

  it("niesamodzielny kandydat ujawniający samodzielne fixed: leak_source", () => {
    const state = stateWith({ fixed: [open(A, "Rok chrztu?", "966")] });
    const rejection = rejectionOf(submit(state, A, [gap(A, "Chrzest Polski w roku ___.", "966")]).results[0]);
    expect(rejection.code).toBe("leak_source");
    expect(rejection.reasons[0]).toContain('an existing exercise "966"');
  });

  it("samodzielny z odpowiedzią przyjętego samodzielnego wcześniejszego w lekcji: leak_victim (miękkie)", () => {
    const state = acceptAll(stateWith(), A, [open(A, "Rok chrztu?", "966")]);
    const rejection = rejectionOf(submit(state, B, [open(B, "Rok, w którym rządził Mieszko?", "966")]).results[0]);
    expect(rejection.code).toBe("leak_victim");
    expect(rejection.reasons[0]).toContain('an earlier independent exercise "966"');
  });

  it("samodzielny wstawiony przed przyjętym samodzielnym z tą samą odpowiedzią (wcześniejsze zagadnienie): leak_source", () => {
    const state = acceptAll(stateWith(), B, [open(B, "Rok, w którym rządził Mieszko?", "966")]);
    const rejection = rejectionOf(submit(state, A, [open(A, "Rok chrztu?", "966")]).results[0]);
    expect(rejection.code).toBe("leak_source");
    expect(rejection.reasons[0]).toContain('exercise ex1 "966"');
  });

  it("ofiara ujawniona już przed kandydatem nie odrzuca kandydata", () => {
    const state = stateWith({ examples: { [A]: ["966"] }, fixed: [open(A, "Rok chrztu?", "966")] });
    const result = submit(state, A, [gap(A, "Chrzest Polski w roku ___.", "966")]);
    expect(result.results[0]).toEqual({ accepted: "ex1", sanitized: [], unchecked: false });
    expect(poolOf(result.state, A)).toHaveLength(1);
  });

  it("drugi kandydat paczki widzi pierwszego: ujawnienie wewnątrz paczki odpada już w precheckBatch", () => {
    const prechecked = precheckBatch(stateWith(), A, [open(A, "Rok chrztu?", "966"), gap(A, "Chrzest Polski w roku ___.", "966")], ctx);
    expect(prechecked.map((entry) => (entry.pass ? "pass" : entry.rejection.code))).toEqual(["pass", "leak_source"]);
  });

  describe("rodzina pytań otwartych (ta sama odpowiedź wzorcowa)", () => {
    const ANSWER = "w 966 roku";
    const member = (objectiveId: string, n: number, familyId?: string) => open(objectiveId, `Pytanie rodziny numer ${n}: kiedy był chrzest?`, ANSWER, familyId);

    it("ofiara: kolejne pytania tej samej rodziny przyjęte (w osobnych wywołaniach i w jednej paczce)", () => {
      const state = acceptAll(stateWith(), A, [member(A, 1, "f1")]);
      const next = acceptAll(state, A, [member(A, 2, "f1"), member(A, 3, "f1")]);
      expect(poolOf(next, A).map((entry) => entry.draft.prompt)).toHaveLength(3);
    });

    it("źródło: pytanie rodziny przed istniejącym pytaniem z tą samą nazwą rodziny w innym zagadnieniu — nadal leak_source", () => {
      // Ta sama nazwa rodziny w innym zagadnieniu to inna rodzina: wyjątek nie obejmuje kierunku źródła między zagadnieniami.
      const state = acceptAll(stateWith(), B, [member(B, 1, "f1")]);
      const rejection = rejectionOf(submit(state, A, [member(A, 2, "f1")]).results[0]);
      expect(rejection.code).toBe("leak_source");
    });

    it("źródło: pytanie rodziny przyjęte nie staje się nową ofiarą — późniejsze źródło niesamodzielne nadal leak_source", () => {
      const state = acceptAll(stateWith(), A, [member(A, 1, "f1"), member(A, 2, "f1")]);
      const rejection = rejectionOf(submit(state, A, [gap(A, "Chrzest Polski odbył się ___.", ANSWER)]).results[0]);
      expect(rejection.code).toBe("leak_source");
      // Obie ofiary (całą rodzinę) model dostaje w powodach.
      expect(rejection.reasons).toHaveLength(2);
    });

    it("inna rodzina albo brak rodziny w tym samym zagadnieniu: leak_victim (miękkie)", () => {
      const withFamily = acceptAll(stateWith(), A, [member(A, 1, "f1")]);
      expect(rejectionOf(submit(withFamily, A, [member(A, 2, "f2")]).results[0]).code).toBe("leak_victim");
      expect(rejectionOf(submit(withFamily, A, [member(A, 2)]).results[0]).code).toBe("leak_victim");
      const withoutFamily = acceptAll(stateWith(), A, [member(A, 1)]);
      expect(rejectionOf(submit(withoutFamily, A, [member(A, 2, "f1")]).results[0]).code).toBe("leak_victim");
    });

    it("źródło twarde: przykład karty równy odpowiedzi rodziny odrzuca każde pytanie rodziny (leak_victim)", () => {
      const state = stateWith({ examples: { [A]: [ANSWER] } });
      const result = submit(state, A, [member(A, 1, "f1"), member(A, 2, "f1")]);
      expect(result.results.map((entry) => rejectionOf(entry).code)).toEqual(["leak_victim", "leak_victim"]);
    });

    it("przykład karty zgłoszony po przyjęciu rodziny: odrzucony z oboma pytaniami rodziny jako ofiarami", () => {
      const state = acceptAll(stateWith(), A, [member(A, 1, "f1"), member(A, 2, "f1")]);
      const outcome = submitExamples(state, A, [ANSWER], ctx);
      expect(outcome.accepted).toBe(0);
      expect(outcome.errors).toHaveLength(2);
    });
  });
});
