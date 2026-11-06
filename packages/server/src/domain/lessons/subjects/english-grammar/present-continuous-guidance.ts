import { ingVerbsByRule, STATE_VERBS, type IngRule } from "../english/ing-forms";
import { TIME_MARKER_LISTS } from "./time-markers";

/**
 * Teksty tematu Present Continuous dopisywane do opisów jego reguł w katalogu gramatyki
 * (`rules.ts`), więc trafiają do księgi reguł agenta tylko w tym temacie (jak wskazówki
 * „to be”). Listy czasowników i wskaźników pochodzą ze stałych walidatora, więc prompt nie
 * rozjedzie się z regułami odrzucania; `PC_GUIDANCE` to dydaktyka, której kod nie sprawdza.
 */

const verbs = (...rules: IngRule[]): string => ingVerbsByRule(rules).join(", ");

/**
 * Lista wskaźników czasu dla modelu według składni wpisów `TIME_MARKER_LISTS`:
 * wykrzyknienia („Look!”) tylko na początku zdania, frazy z „…” tylko na
 * początku tekstu, „N” to liczebnik.
 */
function markerText(entries: readonly string[]): string {
  const exclamations = entries.filter((entry) => entry.endsWith("!"));
  const starts = entries.filter((entry) => entry.endsWith("…"));
  const phrases = entries
    .filter((entry) => !entry.endsWith("!") && !entry.endsWith("…"))
    .map((entry) => entry.replace(/^N /, "<number> "));
  const parts = [phrases.join(", ")];
  if (exclamations.length > 0) parts.push(`${exclamations.join(" ")} only at the start of a sentence`);
  if (starts.length > 0) parts.push(`${starts.map((entry) => `${entry}?`).join(" / ")} only at the start of the text`);
  return parts.join("; ");
}

/** Tabela czasowników według reguł pisowni (dopisek `grammar.pc_ing_rule_not_allowed`). */
export const PC_VERB_LISTS =
  ` Plain verbs (also in the brackets of a gap and in a present simple answer): ${verbs("plain")}. ` +
  `Drop the final e: ${verbs("drop_e")}. Double the last consonant: ${verbs("double")}. ie becomes y: ${verbs("ie_to_y")}. ` +
  `Never use ${verbs("other")}.`;

/** Kolokacje „having/looking” wypisane ręcznie — test modułu sprawdza, że reguła czasowników stanu je przepuszcza. */
export const PC_COLLOCATIONS =
  "having breakfast, having lunch, having dinner, having a bath, having a shower, having fun, having a party, looking at, looking for";

/** Czasowniki stanu i dozwolone kolokacje (dopisek `grammar.pc_state_verb_ing`). */
export const PC_STATE_VERB_LIST = ` State verbs: ${[...STATE_VERBS].join(", ")}. Allowed collocations: ${PC_COLLOCATIONS}.`;

/** Wskaźniki „teraz” (dopisek `grammar.pc_now_marker_missing`). */
export const PC_NOW_MARKERS =
  ` Now markers: ${markerText(TIME_MARKER_LISTS.nowEn)}; in Polish: ${markerText(TIME_MARKER_LISTS.nowPl)}. ` +
  "A Polish exclamation counts only with ! (Cicho! Dziadek śpi., never Cicho, dziadek śpi.).";

/** Wskaźniki „zwykle” (dopisek `grammar.pc_usually_marker`). */
export const PC_USUALLY_MARKERS =
  ` Usually markers: ${markerText(TIME_MARKER_LISTS.usuallyEn)}; in Polish: ${markerText(TIME_MARKER_LISTS.usuallyPl)}.`;

/** Wskaźniki zakazane (dopisek `grammar.pc_forbidden_marker`). */
export const PC_FORBIDDEN_MARKERS = ` Forbidden markers: ${TIME_MARKER_LISTS.forbidden.join(", ")}.`;

/**
 * Wzór wyjaśnienia `explanationPl` cytowany we wskazówkach. Musi być jednym zdaniem
 * (`explanationTextErrors`), inaczej skopiowane wyjaśnienie zostałoby odrzucone.
 */
export const PC_EXPLANATION_EXAMPLE = "Every day mówi, że to zwykle, więc Ola reads.";

/**
 * Dydaktyka tematu (spec „Present Continuous” §2, §5.5, §5.6, §7.2; kod jej nie sprawdza) w dopisku
 * opisu `grammar.pc_tense_marker_missing`. Angielskie zdania z nawiasów sprawdza test modułu
 * (przechodzą walidator albo mają go oblać).
 */
export const PC_GUIDANCE =
  " Teaching hints for the present_continuous topic: the child learns WHEN to use the tense, so every exercise makes clear " +
  "that the action is happening right now (or, in the tense-choice objectives, usually). Polish often uses one verb for both " +
  "(Ola czyta), so the marker or the scene decides, never the Polish verb. " +
  "A short Polish scene in instructionPl is a good context: its own short sentence before the task (Cicho! Dziadek śpi. " +
  "Uzupełnij zdanie. with Grandpa ___ (sleep) on the sofa.); never use teraz, właśnie, zawsze or zwykle as words of the task " +
  "itself (never Teraz uzupełnij zdanie.), because there they are no marker. " +
  "In now_or_usually and now_or_usually_more about half of the exercises use a scene without an English marker " +
  "(Cicho! Dziadek śpi. / Gdzie jest tata? / Ola codziennie gra w piłkę.); never write the refrain teraz czy zwykle in an " +
  "instruction, because it has markers of both groups. Their lesson_choice options are the same verb in the two tenses " +
  "(reads / is reading), and each stem is a different frame with its own object or place (Ola ___ a comic., Grandpa ___ on the sofa.). " +
  "In now_or_usually_more a choice between whole questions has a short English context sentence without a gap as its stem " +
  "(Ola is at the tennis club.) and the time marker in both options. " +
  "now_or_usually also checks meaning: a lesson_choice with options exactly now and usually, instructionPl exactly " +
  "Kiedy to się dzieje? and a stem without a marker (Ola is reading a comic. → now; Ola reads comics. → usually); a present " +
  "simple stem there has a general plural object (Ola reads comics., not Ola reads a comic.). " +
  "A context sentence may use is or are without a verb (This is Ola., It is sunny.), but never a verb of the table as an " +
  "adjective after is (never The door is open.). " +
  "explanationPl names only verb forms that stand in this exercise (for She is cooking now. it says is cooking, never another " +
  `verb such as is reading), and in the tense-choice objectives also the marker or the scene (${PC_EXPLANATION_EXAMPLE}). ` +
  "A translation carries the Polish now marker into English (teraz → now, w tej chwili → at the moment, Patrz! → Look!) and " +
  "lists the other now markers the sentence allows as acceptedAnswers (Tom is drawing a horse now. with Tom is drawing a horse " +
  "right now. and Tom is drawing a horse at the moment.), never a variant without a marker. " +
  "The examples of each objective (shown to the child on its cards) follow the same rules: in affirmative, negative, questions " +
  "and ing_spelling present continuous sentences with a now marker; in the tense-choice objectives a pair with the same verb " +
  "(Ola is reading now. / Ola reads comics every day.). " +
  "Never copy an example from the objective's cards into an exercise: change at least the subject, the verb or the object. " +
  "Polish appears only in instructionPl, explanationPl and the lesson_open_answer prompt; stems, statements, options and answers " +
  "are in English (Polish names such as Ola are fine).";
