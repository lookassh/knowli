import { messages } from "@learning/contracts";

export function formatVisualCountLabel(count: number): string {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  const noun = count === 1
    ? messages.kid.visualItemSingular
    : lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)
      ? messages.kid.visualItemFew
      : messages.kid.visualItemMany;
  return `${count} ${noun}`;
}
