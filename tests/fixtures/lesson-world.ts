import { randomUUID } from "node:crypto";
import { computeTargetKey } from "@learning/server";
import type { testDatabase } from "../integration/helpers";

type Pool = ReturnType<typeof testDatabase>["pool"];

export interface LessonWorld {
  deckId: string;
  versionId: string;
  itemId: string;
  revisionId: string;
  objectiveSkillVersionId: string;
  subjectId: string;
  topicId: string;
  objectiveId: string;
  /** `target_key` ćwiczeń bogatej puli (tylko gdy `richPool`). */
  richKeys?: { notice: string; choice: string; gap: string; order: string };
}

export interface LessonWorldOptions {
  /** Przypisz lekcję temu dziecku (wymagane dla testów izolacji per dziecko). */
  childId?: string;
  /** Termin „sprawdzianu” lekcji z celem `lesson`, albo null. */
  testDate?: string | null;
  /**
   * Zasiej łańcuch oceny celu (`objective`): session_task(lesson_card) + attempt
   * + assessment skill='objective'. Służy do dowodu, że odbudowa postępu słówek
   * nie dotyka ocen celów. Wymaga `childId`. Domyślnie false.
   */
  withObjectiveAssessment?: boolean;
  /** Zegar — timestamp zdarzeń oceny; domyślnie now(). */
  now?: Date;
  /**
   * Zasiej bogatszą pulę ćwiczeń celu (notice + choice + gap + order) obok
   * domyślnego short_answer, z PRAWDZIWYMI `target_key` (computeTargetKey w
   * en-GB). Służy testom wydawania zadań, ekspozycji i selektora. Domyślnie false.
   */
  richPool?: boolean;
}

/**
 * Opublikowana lekcja utworzona WPROST w bazie (bez generacji): deck `lesson`
 * z `lesson_context` (przedmiot `english_grammar`, temat `present_simple` v1),
 * ćwiczenia `lesson_exercise` z rewizjami, `skill_versions`/`item_revision_skills`
 * dla umiejętności celu (`objective`) i opcjonalne przypisanie dziecku. Reużywalny
 * w kolejnych zadaniach warstwy lekcji. Pisze przez surową pulę pg, bo moduły
 * tworzenia lekcji (zadania 11+) jeszcze nie istnieją.
 */
export async function lessonWorld(pool: Pool, options: LessonWorldOptions = {}): Promise<LessonWorld> {
  const subjectId = "english_grammar";
  const topicId = "present_simple";
  const objectiveId = "english_grammar.present_simple.third_person_s";
  const now = options.now ?? new Date();

  const deckId = randomUUID();
  const versionId = randomUUID();
  const itemId = randomUUID();
  const revisionId = randomUUID();
  const skillVersionId = randomUUID();

  const lessonContext = JSON.stringify({
    subjectId,
    topicId,
    topicVersion: 1,
    objectiveIds: [objectiveId],
    poolSize: 20,
    examples: { [objectiveId]: ["He plays football."] },
    material: "Present simple: trzecia osoba liczby pojedynczej dodaje -s.",
    instruction: "Ćwicz -s w 3. osobie.",
  });

  await pool.query("insert into learning_app.decks (id, title, kind) values ($1, $2, 'lesson')", [deckId, "Present simple"]);
  // Najpierw szkic (draft), potem treść, dopiero na końcu publikacja — trigger
  // „Published revision is immutable” blokuje wstawianie rewizji do opublikowanej wersji.
  await pool.query(
    `insert into learning_app.deck_versions (id, deck_id, version_number, edit_number, state, title, lesson_context)
     values ($1, $2, 1, 1, 'draft', 'Present simple', $3::jsonb)`,
    [versionId, deckId, lessonContext],
  );
  await pool.query("insert into learning_app.learning_items (id, deck_id, kind) values ($1, $2, 'lesson_exercise')", [itemId, deckId]);
  await pool.query(
    `insert into learning_app.item_revisions (id, item_id, deck_id, deck_version_id, position, payload_version, payload, target_key)
     values ($1, $2, $3, $4, 0, 2, $5::jsonb, $6)`,
    [
      revisionId,
      itemId,
      deckId,
      versionId,
      JSON.stringify({ exerciseType: "lesson_short_answer", objectiveId, stem: "He ___ (play) football.", answer: "plays", acceptedAnswers: ["plays"], focus: ["plays"] }),
      `lesson-tk-${revisionId}`,
    ],
  );
  await pool.query(
    `insert into learning_app.skill_versions (id, item_id, skill, revision_number, criteria, criteria_hash)
     values ($1, $2, 'objective', 1, $3::jsonb, $4)`,
    [skillVersionId, itemId, JSON.stringify({ objectiveId }), `oc-${skillVersionId}`],
  );
  await pool.query(
    `insert into learning_app.item_revision_skills (item_revision_id, item_id, skill, skill_version_id)
     values ($1, $2, 'objective', $3)`,
    [revisionId, itemId, skillVersionId],
  );
  // Publikacja: state=published wymaga published_at; lesson_context niezmienny po publikacji.
  if (options.richPool) {
    await seedRichPool(pool, { deckId, versionId });
  }
  await pool.query(
    "update learning_app.deck_versions set state = 'published', published_at = $2 where id = $1",
    [versionId, now],
  );
  await pool.query("update learning_app.decks set published_version_id = $1 where id = $2", [versionId, deckId]);

  if (options.childId) {
    await pool.query(
      `insert into learning_app.assignments (id, child_id, deck_id, test_date, test_goals)
       values ($1, $2, $3, $4, $5)`,
      [
        randomUUID(),
        options.childId,
        deckId,
        options.testDate ?? null,
        options.testDate !== undefined && options.testDate !== null ? ["lesson"] : null,
      ],
    );
  }

  if (options.withObjectiveAssessment) {
    if (!options.childId) throw new Error("withObjectiveAssessment wymaga childId");
    const sessionId = randomUUID();
    const assignmentId = (
      await pool.query<{ id: string }>("select id from learning_app.assignments where child_id = $1 and deck_id = $2", [options.childId, deckId])
    ).rows[0]!.id;
    const policyId = (await pool.query<{ id: string }>("select id from learning_app.learning_policies limit 1")).rows[0]?.id ?? "learning-v1";
    // Sesja lekcji (ścieżka lekcji jest osobna; tu sesję i zadanie wkładamy wprost,
    // żeby ocena celu miała łańcuch FK task->attempt->assessment).
    await pool.query(
      `insert into learning_app.learning_sessions
         (id, child_id, assignment_id, deck_id, deck_version_id, policy_id, microphone_enabled, mode, state, task_budget, started_at, ended_at)
       values ($1, $2, $3, $4, $5, $6, false, 'training', 'ended', 12, $7, $7)`,
      [sessionId, options.childId, assignmentId, deckId, versionId, policyId, now],
    );
    const taskId = randomUUID();
    await pool.query(
      `insert into learning_app.session_tasks
         (id, session_id, child_id, deck_version_id, item_revision_id, ordinal, exercise_type, state, public_prompt, answer_key, issued_at)
       values ($1, $2, $3, $4, $5, 0, 'lesson_short_answer', 'answered', '{}'::jsonb, '{}'::jsonb, $6)`,
      [taskId, sessionId, options.childId, versionId, revisionId, now],
    );
    const attemptId = randomUUID();
    // Próba najpierw jako 'processing' (bez completed_at): trigger pozwala wstawić
    // oceny tylko przed finalizacją. Po wstawieniu oceny finalizujemy do 'completed'.
    await pool.query(
      `insert into learning_app.attempts
         (id, child_id, task_id, item_revision_id, client_attempt_id, request_hash, attempt_number, modality, state, context, policy_id, received_at)
       values ($1, $2, $3, $4, $5, 'h', 1, 'text', 'processing', '{}'::jsonb, $6, $7)`,
      [attemptId, options.childId, taskId, revisionId, randomUUID(), policyId, now],
    );
    await pool.query(
      `insert into learning_app.assessments
         (child_id, attempt_id, item_revision_id, skill, skill_version_id, outcome, independent, confirmation_eligible)
       values ($1, $2, $3, 'objective', $4, 'correct', true, true)`,
      [options.childId, attemptId, revisionId, skillVersionId],
    );
    await pool.query(
      "update learning_app.attempts set state = 'completed', completed_at = $2 where id = $1",
      [attemptId, now],
    );
    await pool.query(
      `insert into learning_app.child_objective_progress
         (child_id, subject_id, objective_id, topic_id, status, streak, projection_version)
       values ($1, $2, $3, $4, 'practicing', 1, 'proj-1')`,
      [options.childId, subjectId, objectiveId, topicId],
    );
  }

  return {
    deckId,
    versionId,
    itemId,
    revisionId,
    objectiveSkillVersionId: skillVersionId,
    subjectId,
    topicId,
    objectiveId,
    ...(options.richPool ? { richKeys: RICH_KEYS } : {}),
  };
}

const RICH_ANSWER_LOCALE = "en-GB";
/** Odpowiedzi kanoniczne bogatej puli — stałe, by test znał ich `target_key`. */
const RICH_ANSWERS = {
  notice: "plays",
  choice: "plays",
  gap: "goes",
  gap2: "watches",
  gap3: "reads",
  order: "she plays football",
  transform: "she plays",
} as const;
/** `target_key` każdego ćwiczenia bogatej puli (computeTargetKey w en-GB). */
export const RICH_KEYS = {
  notice: computeTargetKey(RICH_ANSWERS.notice, RICH_ANSWER_LOCALE),
  choice: computeTargetKey(RICH_ANSWERS.choice, RICH_ANSWER_LOCALE),
  gap: computeTargetKey(RICH_ANSWERS.gap, RICH_ANSWER_LOCALE),
  gap2: computeTargetKey(RICH_ANSWERS.gap2, RICH_ANSWER_LOCALE),
  gap3: computeTargetKey(RICH_ANSWERS.gap3, RICH_ANSWER_LOCALE),
  order: computeTargetKey(RICH_ANSWERS.order, RICH_ANSWER_LOCALE),
  transform: computeTargetKey(RICH_ANSWERS.transform, RICH_ANSWER_LOCALE),
} as const;

/**
 * Dodaje do szkicu (przed publikacją) cztery ćwiczenia celu obok short_answer:
 * notice (intro), choice (guided), gap (productive), order (guided). Każde ma
 * własny `learning_item`, `skill_version` (objective), rewizję z payloadem
 * payload_version 2 i PRAWDZIWY `target_key`. Pozwala testom wydawania zadań
 * zobaczyć kartę → notice → ćwiczenie oraz ekspozycje per typ.
 */
async function seedRichPool(pool: Pool, version: { deckId: string; versionId: string }): Promise<void> {
  const objectiveId = "english_grammar.present_simple.third_person_s";
  const exercises: { position: number; payload: Record<string, unknown>; answer: string }[] = [
    {
      position: 1,
      answer: RICH_ANSWERS.notice,
      payload: {
        exerciseType: "lesson_notice",
        objectiveId,
        instructionPl: "Dotknij słowa z końcówką -s.",
        noticeSegments: [["She", "plays", "football."]],
        answer: RICH_ANSWERS.notice,
        acceptedAnswers: [RICH_ANSWERS.notice],
        focus: [RICH_ANSWERS.notice],
        correctOption: "plays",
      },
    },
    {
      position: 2,
      answer: RICH_ANSWERS.choice,
      payload: {
        exerciseType: "lesson_choice",
        objectiveId,
        instructionPl: "Wybierz poprawną formę.",
        stem: "She ___ football.",
        options: [
          { id: "o-play", text: "play" },
          { id: "o-plays", text: "plays" },
        ],
        answer: RICH_ANSWERS.choice,
        acceptedAnswers: [RICH_ANSWERS.choice],
        focus: [RICH_ANSWERS.choice],
        correctOption: "plays",
      },
    },
    {
      position: 3,
      answer: RICH_ANSWERS.gap,
      payload: {
        exerciseType: "lesson_gap",
        objectiveId,
        instructionPl: "Uzupełnij lukę.",
        stem: "He ___ (go) to school.",
        answer: RICH_ANSWERS.gap,
        acceptedAnswers: [RICH_ANSWERS.gap],
        focus: [RICH_ANSWERS.gap],
      },
    },
    {
      position: 4,
      answer: RICH_ANSWERS.order,
      payload: {
        exerciseType: "lesson_order",
        objectiveId,
        instructionPl: "Ułóż zdanie.",
        items: [
          { id: "i-she", text: "She" },
          { id: "i-plays", text: "plays" },
          { id: "i-football", text: "football" },
        ],
        answer: RICH_ANSWERS.order,
        acceptedAnswers: [RICH_ANSWERS.order],
        focus: ["plays"],
      },
    },
    {
      position: 5,
      answer: RICH_ANSWERS.transform,
      payload: {
        exerciseType: "lesson_transform",
        objectiveId,
        instructionPl: "Zamień na twierdzenie.",
        statement: "Does she play?",
        answer: RICH_ANSWERS.transform,
        acceptedAnswers: [RICH_ANSWERS.transform],
        // odpowiedź dwuwyrazowa, element sprawdzany to tylko „plays” — literówka
        // w „she” jest POZA focus, więc dopasowanie daje minor_typo (lesson_almost).
        focus: ["plays"],
      },
    },
    {
      // Drugie ćwiczenie produktywne (lesson_gap) z OSOBNYM itemId i target_key —
      // daje trzeci deterministycznie oceniany niezależny element celu, potrzebny
      // do opanowania (`successStreakRequired=3` na RÓŻNYCH ćwiczeniach).
      position: 6,
      answer: RICH_ANSWERS.gap2,
      payload: {
        exerciseType: "lesson_gap",
        objectiveId,
        instructionPl: "Uzupełnij lukę.",
        stem: "She ___ (watch) TV.",
        answer: RICH_ANSWERS.gap2,
        acceptedAnswers: [RICH_ANSWERS.gap2],
        focus: [RICH_ANSWERS.gap2],
      },
    },
    {
      // Czwarte ćwiczenie produktywne (osobny itemId/target_key): pozwala w DRUGIEJ
      // sesji wykonać potwierdzający niezależny sukces na NOWYM, różnym ćwiczeniu,
      // które wchodzi do okna opanowania — bez tego potwierdzenie padłoby na powtórkę.
      position: 7,
      answer: RICH_ANSWERS.gap3,
      payload: {
        exerciseType: "lesson_gap",
        objectiveId,
        instructionPl: "Uzupełnij lukę.",
        stem: "He ___ (read) books.",
        answer: RICH_ANSWERS.gap3,
        acceptedAnswers: [RICH_ANSWERS.gap3],
        focus: [RICH_ANSWERS.gap3],
      },
    },
  ];

  for (const ex of exercises) {
    const exItemId = randomUUID();
    const exRevisionId = randomUUID();
    const exSkillVersionId = randomUUID();
    await pool.query("insert into learning_app.learning_items (id, deck_id, kind) values ($1, $2, 'lesson_exercise')", [exItemId, version.deckId]);
    await pool.query(
      `insert into learning_app.item_revisions (id, item_id, deck_id, deck_version_id, position, payload_version, payload, target_key)
       values ($1, $2, $3, $4, $5, 2, $6::jsonb, $7)`,
      [
        exRevisionId,
        exItemId,
        version.deckId,
        version.versionId,
        ex.position,
        JSON.stringify({ ...ex.payload, answerLocale: RICH_ANSWER_LOCALE, promptLocale: "pl-PL" }),
        computeTargetKey(ex.answer, RICH_ANSWER_LOCALE),
      ],
    );
    await pool.query(
      `insert into learning_app.skill_versions (id, item_id, skill, revision_number, criteria, criteria_hash)
       values ($1, $2, 'objective', 1, $3::jsonb, $4)`,
      [exSkillVersionId, exItemId, JSON.stringify({ objectiveId }), `oc-${exSkillVersionId}`],
    );
    await pool.query(
      `insert into learning_app.item_revision_skills (item_revision_id, item_id, skill, skill_version_id)
       values ($1, $2, 'objective', $3)`,
      [exRevisionId, exItemId, exSkillVersionId],
    );
  }
}
