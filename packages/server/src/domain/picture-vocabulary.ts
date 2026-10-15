import { isVisualDataValid, type VocabularyFormat, type VocabularyItemInput } from "@learning/contracts";
import { AppError } from "../errors";

/** Czy zatwierdzony element ma typ i dane wizualne dozwolone w zestawie obrazkowym. */
export function isPictureVocabularyItem(item: VocabularyItemInput): boolean {
  return (item.visualType === "image" || item.visualType === "color" || item.visualType === "number") &&
    isVisualDataValid(item.visualType, item.visualData, item.target);
}

/** Waliduje techniczną możliwość pokazania elementów bez tekstu; nie ocenia semantyki ilustracji. */
export function validateVocabularyFormatItems(
  format: VocabularyFormat,
  items: readonly VocabularyItemInput[],
): void {
  if (format === "picture" && items.some((item) => !isPictureVocabularyItem(item))) {
    throw new AppError("validation", { message: "Picture vocabulary requires a valid image, color, or number representation." });
  }
}
