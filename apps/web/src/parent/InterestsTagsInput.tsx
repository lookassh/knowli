"use client";

import { useState, type ReactNode } from "react";
import { TagsInput } from "@mantine/core";
import { MAX_CHILD_INTERESTS, messages } from "@learning/contracts";
import { interestsError, parseInterestsInput } from "./children-forms";

/** Krótki komunikat po próbie dodania powtórzenia lub szóstego tematu (znika przy dalszym pisaniu). */
export type InterestNotice = "duplicate" | "limit";

export function useInterestNotice() {
  return useState<InterestNotice | null>(null);
}

/** Tekst komunikatu dla pola: błąd wpisu ma pierwszeństwo przed powtórzeniem i limitem. */
export function interestFieldMessage(value: readonly string[], notice: InterestNotice | null): string | null {
  return interestsError(value)
    ?? (notice === "duplicate" ? messages.children.interestsDuplicate : null)
    ?? (notice === "limit" ? messages.children.interestsLimit.replace("{max}", String(MAX_CHILD_INTERESTS)) : null);
}

interface InterestsTagsInputProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  notice: InterestNotice | null;
  onNoticeChange: (notice: InterestNotice | null) => void;
  disabled?: boolean;
  /** Notki pod polem; Mantine łączy je z polem przez `aria-describedby`. */
  description?: ReactNode;
  "data-testid"?: string;
}

/**
 * Pole tematów (zainteresowań) z limitem 5, normalizacją wpisów jak na serwerze oraz
 * komunikatami o błędzie, powtórzeniu i limicie. Wspólne dla profilu dziecka i formularza lekcji.
 */
export function InterestsTagsInput({
  label,
  value,
  onChange,
  notice,
  onNoticeChange,
  disabled,
  description,
  "data-testid": testId,
}: InterestsTagsInputProps) {
  return (
    <TagsInput
      size="md"
      label={label}
      data-testid={testId}
      disabled={disabled}
      maxTags={MAX_CHILD_INTERESTS}
      splitChars={[","]}
      description={description}
      // notki pod polem, przed komunikatem błędu
      inputWrapperOrder={["label", "input", "description", "error"]}
      error={interestFieldMessage(value, notice)}
      value={value}
      onChange={(next) => {
        const parsed = parseInterestsInput(next);
        // powtórzenie widoczne dopiero po normalizacji (np. podwójna spacja)
        onNoticeChange(next.length > value.length && parsed.length < next.length ? "duplicate" : null);
        onChange(parsed);
      }}
      // dalsze pisanie zdejmuje komunikat; czyszczenie pola po dodaniu tematu go nie rusza
      onSearchChange={(text) => { if (text.length > 0) onNoticeChange(null); }}
      onDuplicate={() => onNoticeChange("duplicate")}
      // zdarzenie przy zwykłym opuszczeniu pustego pola nie jest próbą dodania tematu
      onMaxTags={(text) => { if (text.trim().length > 0) onNoticeChange("limit"); }}
    />
  );
}
