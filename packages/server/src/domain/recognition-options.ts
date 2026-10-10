import type { PlannedOption, ScheduleCandidate, SchedulePeer } from "./scheduler";
import type { ReadingDirection } from "./types";
import { computeTargetKey, normalizeTargetText } from "./target-key";

export interface RecognitionOptionsInput {
  target: ScheduleCandidate;
  peers: readonly SchedulePeer[];
  direction: ReadingDirection | "listening";
  reservedTargetKeys: readonly string[];
  rotateBy: number;
  preferredRevisionIds?: readonly string[];
}

export function buildRecognitionOptions(input: RecognitionOptionsInput): { options: PlannedOption[]; revealsTargetKeys: string[] } | null {
  const targetUsesSource = input.direction === "listening" || input.direction === "target_to_source";
  const expected = targetUsesSource
    ? new Set([normalizeTargetText(input.target.source)])
    : new Set([input.target.target, ...input.target.acceptedAnswers].map(normalizeTargetText));
  const reserved = new Set(input.reservedTargetKeys);
  const pool = input.peers
    .filter((peer) => peer.itemRevisionId !== input.target.itemRevisionId)
    .filter((peer) => {
      const keys = [peer.target, ...peer.acceptedAnswers].map((text) => computeTargetKey(text, peer.targetLocale));
      return !keys.some((key) => reserved.has(key));
    })
    .filter((peer) => {
      const variants = targetUsesSource ? [peer.source] : [peer.target, ...peer.acceptedAnswers];
      return !variants.some((text) => expected.has(normalizeTargetText(text)));
    });

  const preferred = input.preferredRevisionIds ?? [];
  const preferenceIndex = new Map(preferred.map((id, index) => [id, index]));
  pool.sort((a, b) => {
    const aIndex = preferenceIndex.get(a.itemRevisionId);
    const bIndex = preferenceIndex.get(b.itemRevisionId);
    if (aIndex !== undefined || bIndex !== undefined) return (aIndex ?? Number.MAX_SAFE_INTEGER) - (bIndex ?? Number.MAX_SAFE_INTEGER);
    return a.position - b.position;
  });
  const firstPreferred = pool.findIndex((peer) => preferenceIndex.has(peer.itemRevisionId));
  const rotateFrom = firstPreferred >= 0 ? firstPreferred : (pool.length === 0 ? 0 : input.rotateBy % pool.length);
  const ordered = pool.length === 0
    ? []
    : [...pool.slice(rotateFrom), ...pool.slice(0, rotateFrom)];

  const correctText = targetUsesSource ? input.target.source : input.target.target;
  const options: PlannedOption[] = [{ itemRevisionId: input.target.itemRevisionId, text: correctText, correct: true }];
  const used = new Set([normalizeTargetText(correctText)]);
  for (const peer of ordered) {
    if (options.length >= 3) break;
    const text = targetUsesSource ? peer.source : peer.target;
    const normalized = normalizeTargetText(text);
    if (used.has(normalized)) continue;
    used.add(normalized);
    options.push({ itemRevisionId: peer.itemRevisionId, text, correct: false });
  }
  if (used.size < 2) return null;

  const revealsTargetKeys = targetUsesSource
    ? [computeTargetKey(input.target.target, input.target.targetLocale)]
    : options.map((option) => {
        const item = option.correct ? input.target : input.peers.find((peer) => peer.itemRevisionId === option.itemRevisionId)!;
        return computeTargetKey(item.target, item.targetLocale);
      });
  return { options, revealsTargetKeys: [...new Set(revealsTargetKeys)] };
}
