import { createHash } from "node:crypto";

/**
 * target_key — tożsamość ujawnianego angielskiego celu (architecture.md §9.2):
 * hash tekstu po Unicode NFC, przycięciu zewnętrznych spacji, lowercase
 * i dołączeniu locale. Warianty mają własne klucze; bez dopasowania rozmytego.
 */
export function normalizeTargetText(text: string): string {
  return text.normalize("NFC").trim().toLowerCase();
}

export function computeTargetKey(text: string, locale: string): string {
  return createHash("sha256")
    .update(`${normalizeTargetText(text)}|${locale}`)
    .digest("hex");
}
