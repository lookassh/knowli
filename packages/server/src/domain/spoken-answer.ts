/** Boundary punctuation is ignored by spoken matching, while typed spelling stays strict. */
export function normalizeSpokenAnswerText(answer: string): string {
  return answer.normalize("NFC").trim().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "").trim();
}
