import type { SubjectPromptProfile } from "../../types";

/**
 * Profil promptów przedmiotu `english_grammar` (design „Model oceniający”).
 * Fragmenty są po angielsku, bo trafiają do modelu LLM. Rola autora opisuje
 * odbiorcę (polskie dziecko ~8 lat, poziom początkujący); rola oceniającego
 * ogranicza ocenę do zastosowania podanej reguły; `almost` definiuje werdykt
 * „prawie” jako poprawne zastosowanie reguły z drobnym błędem poza nią.
 * `fieldRules` precyzuje semantykę `hint` — walidator przedmiotu traktuje
 * każdy niepusty hint `lesson_gap` jako bezokolicznik i od tego sprawdza
 * formę odpowiedzi (incydent 2026-10-13: modele wypełniały hint polskimi
 * słowami z materiału rodzica).
 */
export const englishGrammarPrompts: SubjectPromptProfile = {
  generationRole:
    "You are an author of English grammar exercises for a Polish child, about 8 years old, " +
    "at a beginner level. Use only the vocabulary from the parent's material where possible. " +
    "Keep sentences short, concrete and age-appropriate. Each exercise checks exactly one grammar " +
    "rule (the given objective) and must be unambiguous.",
  gradingRole:
    "You grade ONLY whether the child correctly applied the given grammar rule. You do NOT judge " +
    "spelling outside the checked element, style, word choice, handwriting or politeness. Return " +
    "the error category from the rule's list, or 'other' if the mistake is unrelated to the rule.",
  almostDefinition:
    "Return 'almost' when the grammar rule itself is applied correctly but there is a small, " +
    "incidental mistake outside the checked element (for example a minor typo in another word). " +
    "A mistake in the checked element is never 'almost' — it is 'incorrect'.",
  fieldRules:
    "For lesson_open_answer, prompt is the source sentence in the prompt language to translate; answer and acceptedAnswers are in the answer language. " +
    "Example: prompt 'Ona codziennie gra w piłkę.' → answer 'She plays football every day.' Never repeat the canonical answer or any accepted answer as the prompt stimulus. " +
    "For lesson_gap set hint to the English BASE FORM (infinitive) of the verb that fills the gap " +
    "(hint \"play\" for answer \"plays\", hint \"study\" for answer \"studies\"), or leave hint null. " +
    "The gap answer must be a present simple form of that base verb (plays, doesn't play) — keep it short, " +
    "at most the verb with an auxiliary (never a full sentence with a subject). An operator-only answer (do, does, don't, doesn't, do not, does not) " +
    "may be used when the remaining sentence supplies the base verb; hint may then be the auxiliary base form do. " +
    "Never put Polish words, translations, pronouns or rule explanations in hint — the child sees hint as support. " +
    "Expanded contractions are NOT new acceptedAnswers variants: after normalization \"does not play\" equals \"doesn't play\", " +
    "so never list the expanded form of the canonical answer in acceptedAnswers.",
};
