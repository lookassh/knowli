import type { VocabularyItemInput } from "@learning/contracts";
import { computeTargetKey } from "../domain/target-key";
import { AppError } from "../errors";

/**
 * Payload item_revision: source, target, acceptedAnswers, example, visualType,
 * visualData, sourceLocale, targetLocale. Współdzielony przez moduły decks,
 * generation i media-reconciliation (reguły oceny zostają w skill_versions).
 */

export interface ItemPayload {
  source: string;
  target: string;
  acceptedAnswers: string[];
  example?: string;
  visualType: string;
  visualData?: Record<string, unknown>;
  sourceLocale: string;
  targetLocale: string;
}

export function buildPayload(item: VocabularyItemInput): Record<string, unknown> {
  return {
    source: item.source,
    target: item.target,
    acceptedAnswers: item.acceptedAnswers,
    ...(item.example === undefined ? {} : { example: item.example }),
    visualType: item.visualType,
    ...(item.visualData === undefined ? {} : { visualData: item.visualData }),
    sourceLocale: item.locales.source,
    targetLocale: item.locales.target,
  };
}

export function payloadToItem(payload: Record<string, unknown>): VocabularyItemInput {
  const p = payload as unknown as ItemPayload;
  return {
    source: p.source,
    target: p.target,
    acceptedAnswers: p.acceptedAnswers,
    ...(p.example === undefined ? {} : { example: p.example }),
    visualType: p.visualType as VocabularyItemInput["visualType"],
    ...(p.visualData === undefined ? {} : { visualData: p.visualData }),
    locales: { source: p.sourceLocale, target: p.targetLocale },
  };
}

/** Jedna para locale w zestawie i brak duplikatów celu. */
export function validateItems(items: VocabularyItemInput[]): void {
  const first = items[0]!.locales;
  if (items.some((i) => i.locales.source !== first.source || i.locales.target !== first.target)) {
    throw new AppError("validation", { message: "all items must share one locale pair" });
  }
  const seen = new Set<string>();
  for (const item of items) {
    const key = computeTargetKey(item.target, item.locales.target);
    if (seen.has(key)) {
      throw new AppError("validation", { message: `duplicate target: ${item.target}` });
    }
    seen.add(key);
  }
}
