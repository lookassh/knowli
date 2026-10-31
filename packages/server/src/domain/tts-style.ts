/** Rola komunikatu lub nagrania lekcji, od której zależy styl wypowiedzi TTS (spec tonu TTS §2.1). */
export type TtsRoleStyle =
  | "ui_praise" | "ui_gentle" | "ui_guidance" | "ui_closing"
  | "lesson_question" | "lesson_card";

/** Semantyczny styl wypowiedzi; zdanie dla modelu dobiera profil przy adapterze. Etap B doda tony. */
export type TtsStyle = TtsRoleStyle;
