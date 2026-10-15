import type { MeaningVisual } from "@learning/contracts";
import { computeTargetKey, normalizeTargetText } from "./target-key";
import type { PlannedOption } from "./scheduler";

export interface PictureRecognitionItem {
  itemRevisionId: string;
  position: number;
  source: string;
  target: string;
  targetLocale: string;
  acceptedAnswers: readonly string[];
  visual: MeaningVisual;
}

export interface PictureChoiceOption extends PlannedOption {
  visual: MeaningVisual;
}

function visualKey(visual: MeaningVisual): string {
  switch (visual.kind) {
    case "image": return `image:${visual.imageAssetId}`;
    case "color": return `color:${visual.color.toLowerCase()}`;
    case "number": return `number:${visual.count}`;
  }
}

function answerKeys(item: PictureRecognitionItem): string[] {
  return [item.target, ...item.acceptedAnswers].map((answer) => computeTargetKey(answer, item.targetLocale));
}

/** Deterministyczny wybór wizualnych opcji; Tasowanie następuje przy materializacji promptu. */
export function buildPictureRecognitionOptions(input: {
  target: PictureRecognitionItem;
  peers: readonly PictureRecognitionItem[];
  reservedTargetKeys: readonly string[];
  rotateBy: number;
}): { options: PictureChoiceOption[]; revealsTargetKeys: string[] } | null {
  const reserved = new Set(input.reservedTargetKeys);
  const targetAnswers = new Set(answerKeys(input.target));
  const usedAnswers = new Set(targetAnswers);
  const usedLabels = new Set([normalizeTargetText(input.target.source)]);
  const usedVisuals = new Set([visualKey(input.target.visual)]);
  const choices: PictureChoiceOption[] = [{
    itemRevisionId: input.target.itemRevisionId,
    text: input.target.source,
    correct: true,
    visual: input.target.visual,
  }];
  const pool = input.peers
    .filter((peer) => peer.itemRevisionId !== input.target.itemRevisionId)
    .filter((peer) => !answerKeys(peer).some((key) => reserved.has(key)))
    .slice()
    .sort((left, right) => left.position - right.position);
  if (pool.length > 0) {
    const rotate = ((input.rotateBy % pool.length) + pool.length) % pool.length;
    pool.push(...pool.splice(0, rotate));
  }
  const revealsTargetKeys = new Set(answerKeys(input.target));
  for (const peer of pool) {
    if (choices.length >= 4) break;
    const variants = answerKeys(peer);
    const label = normalizeTargetText(peer.source);
    const visual = visualKey(peer.visual);
    if (variants.some((key) => usedAnswers.has(key)) || usedLabels.has(label) || usedVisuals.has(visual)) continue;
    choices.push({ itemRevisionId: peer.itemRevisionId, text: peer.source, correct: false, visual: peer.visual });
    variants.forEach((key) => { usedAnswers.add(key); revealsTargetKeys.add(key); });
    usedLabels.add(label);
    usedVisuals.add(visual);
  }
  if (choices.length < 2) return null;
  return { options: choices, revealsTargetKeys: [...revealsTargetKeys] };
}
