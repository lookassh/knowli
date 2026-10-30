"use client";

import { useEffect, useRef } from "react";
import { Alert, Button, Checkbox, Group, Loader, NativeSelect, NumberInput, Paper, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { messages, MAX_SCHOOL_MATERIAL_LENGTH, MAX_SCHOOL_SUBJECT_TITLE_LENGTH, MAX_SCHOOL_TOPIC_TITLE_LENGTH, type LessonCommand, type MaterialLessonCommand, type SchoolLessonCommand, type SubjectCatalogDto } from "@learning/contracts";
import { callParent, errorMessage, parentClient } from "../api";
import { isDefinitiveGenerationRejection, readLessonAcceptance } from "../generation-request";
import { ParentIcon } from "../ParentIcon";
import { httpStatusOf, orpc } from "../query-client";
import type { EditorLeaveState } from "../useParentLeaveGuard";
import "./lesson-panels.css";

const MATERIAL_MAX = 8000;
const POOL_MIN = 20;
const POOL_MAX = 120;
/** Zestawy tworzone z materiału (szkoła, rozdział) mają wyższy limit puli w kontrakcie (160). */
const MATERIAL_POOL_MAX = 160;
/**
 * Limit czasu polecenia utworzenia lekcji (serwer tylko przyjmuje je do kolejki).
 * Zawieszone żądanie nie trzyma blokady wyjścia bez końca: po limicie wynik jest
 * niepewny, a ponowienie wysyła to samo polecenie (ten sam clientRequestId).
 */
const CREATE_TIMEOUT_MS = 30_000;

/** Domyślna wielkość puli: większa z 60 i 12 × liczba reguł (requirements 2.1). */
export function defaultPoolSize(objectiveCount: number): number {
  const raw = Math.max(60, 12 * objectiveCount);
  return Math.min(POOL_MAX, Math.max(POOL_MIN, raw));
}

export interface NewLessonValues {
  subjectId: string;
  topicId: string;
  objectiveIds: string[];
  material: string;
  instruction: string;
  poolSize: number | string;
  poolSizeTouched: boolean;
  /** Nazwa przedmiotu od rodzica — tylko zestawy szkolne. */
  schoolSubjectName: string;
  /** Tytuł tematu (szkoła) albo rozdziału (przedmiot o stałym tytule) wpisany przez rodzica. */
  topicTitle: string;
}

/** Wartości startowe z katalogu: pierwszy przedmiot, pierwszy temat, wszystkie jego reguły. */
export function initialLessonValues(catalog: SubjectCatalogDto | undefined): NewLessonValues {
  const subject = catalog?.subjects[0];
  const topic = subject?.topics[0];
  const objectiveIds = topic?.objectives.map((o) => o.id) ?? [];
  return {
    subjectId: subject?.id ?? "",
    topicId: topic?.id ?? "",
    objectiveIds,
    material: "",
    instruction: "",
    poolSize: defaultPoolSize(objectiveIds.length),
    poolSizeTouched: false,
    schoolSubjectName: "",
    topicTitle: "",
  };
}

export type PendingLesson =
  | { kind: "catalog"; command: LessonCommand }
  | { kind: "school"; command: SchoolLessonCommand }
  | { kind: "material"; command: MaterialLessonCommand };

/**
 * Ścieżka tworzenia lekcji wybranego przedmiotu, wg katalogu: `catalog` — temat
 * i reguły z katalogu, `school` — z materiału z nazwą przedmiotu od rodzica,
 * `material` — z materiału dla przedmiotu o stałym tytule (np. rozdział angielskiego).
 */
export type LessonPath = PendingLesson["kind"];

export function lessonPathOf(catalog: SubjectCatalogDto | undefined, subjectId: string): LessonPath {
  const subject = catalog?.subjects.find((s) => s.id === subjectId);
  if (subject?.creation !== "material") return "catalog";
  return subject.subjectTitleRequired ? "school" : "material";
}

/**
 * Brak możliwości wysłania (przycisk wyłączony). Komunikat walidacji przy
 * kliknięciu daje `validationError` — wyłączony przycisk zwykle go uprzedza.
 */
export function canSubmitLesson(values: NewLessonValues, catalog: SubjectCatalogDto | undefined): boolean {
  const path = lessonPathOf(catalog, values.subjectId);
  const pool = values.poolSize;
  const poolValid = typeof pool === "number" && Number.isInteger(pool) && pool >= POOL_MIN && pool <= (path === "catalog" ? POOL_MAX : MATERIAL_POOL_MAX);
  const material = values.material.trim().length;
  if (!poolValid) return false;
  if (path !== "catalog") {
    const subjectName = values.schoolSubjectName.trim().length;
    const topicName = values.topicTitle.trim().length;
    return (path === "material" || (subjectName > 0 && subjectName <= MAX_SCHOOL_SUBJECT_TITLE_LENGTH))
      && topicName > 0 && topicName <= MAX_SCHOOL_TOPIC_TITLE_LENGTH
      && material > 0 && material <= MAX_SCHOOL_MATERIAL_LENGTH;
  }
  const subject = catalog?.subjects.find((s) => s.id === values.subjectId);
  const topic = subject?.topics.find((t) => t.id === values.topicId);
  return topic !== undefined && values.objectiveIds.length > 0 && material > 0 && material <= MATERIAL_MAX;
}

function validationError(values: NewLessonValues, path: LessonPath): string | null {
  const material = values.material.trim().length;
  if (path !== "catalog") {
    if ((path === "school" && values.schoolSubjectName.trim().length === 0) || values.topicTitle.trim().length === 0) return messages.lessons.schoolMaterialRequired;
    if (material === 0 || material > MAX_SCHOOL_MATERIAL_LENGTH) return messages.lessons.schoolMaterialRequired;
    return null;
  }
  if (values.objectiveIds.length === 0) return messages.lessons.objectivesRequired;
  if (material === 0 || material > MATERIAL_MAX) return messages.lessons.materialRequired;
  return null;
}

export function buildCommand(values: NewLessonValues, path: LessonPath): PendingLesson {
  const instruction = values.instruction.trim();
  const shared = {
    deckId: crypto.randomUUID(),
    material: values.material.trim(),
    ...(instruction ? { instruction } : {}),
    poolSize: Number(values.poolSize),
    clientRequestId: crypto.randomUUID(),
  };
  switch (path) {
    case "school":
      return { kind: "school", command: { ...shared, subjectTitlePl: values.schoolSubjectName.trim(), topicTitlePl: values.topicTitle.trim() } };
    case "material":
      return { kind: "material", command: { ...shared, subjectId: values.subjectId, topicTitlePl: values.topicTitle.trim() } };
    case "catalog":
      return { kind: "catalog", command: { ...shared, subjectId: values.subjectId, topicId: values.topicId, objectiveIds: [...values.objectiveIds] } };
  }
}

/**
 * Formularz nowej lekcji: przedmiot → temat (z katalogu) → reguły (domyślnie
 * wszystkie) → materiał (licznik, limit 8000) → instrukcja → wielkość puli;
 * przedmiot szkolny zamiast tematu i reguł ma nazwy wpisane przez rodzica,
 * a przedmiot o stałym tytule (rozdział angielskiego) — tylko tytuł rozdziału.
 * Wysyłka z kluczem idempotencji: niepewna odpowiedź zostawia polecenie do
 * ponowienia (to samo `deckId`), także po zmianie przedmiotu (W15). Wpisane
 * dane chroni leave guard; 401 obsługuje globalny handler (przy wpisanych
 * danych logowanie w oknie nad formularzem).
 */
export default function NewLessonForm({
  onCreated,
  onCancel,
  registerEditorState,
}: {
  onCreated: (deckId: string) => void;
  onCancel: () => void;
  registerEditorState: (state: EditorLeaveState) => void;
}) {
  const catalogQuery = useQuery(orpc.lessonCatalog.get.queryOptions());
  const catalog = catalogQuery.data;
  const form = useForm<NewLessonValues>({
    mode: "controlled",
    // Katalog już w pamięci podręcznej (lub wstawiony) ustawia wartości od pierwszego renderu.
    initialValues: initialLessonValues(catalog),
    // komunikat wysyłki (np. niepewne utworzenie) zostaje do następnego kliknięcia, także po zmianie przedmiotu
    clearInputErrorOnChange: false,
  });
  const pending = useRef<PendingLesson | null>(null);
  const creatingRef = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Katalog ustala wartości startowe — formularz bez zmian rodzica nie jest „brudny”.
  const { initialize } = form;
  useEffect(() => {
    if (catalog) initialize(initialLessonValues(catalog));
  }, [catalog, initialize]);

  const create = useMutation({
    mutationFn: (lesson: PendingLesson) => callParent(() => {
      const options = { signal: AbortSignal.timeout(CREATE_TIMEOUT_MS) };
      switch (lesson.kind) {
        case "school":
          return parentClient.lessons.createSchool(lesson.command, options);
        case "material":
          return parentClient.lessons.createFromMaterial(lesson.command, options);
        case "catalog":
          return parentClient.lessons.create(lesson.command, options);
      }
    }),
  });
  const creating = create.isPending;

  const values = form.getValues();
  const path = lessonPathOf(catalog, values.subjectId);
  const fromMaterial = path !== "catalog";
  const subject = catalog?.subjects.find((s) => s.id === values.subjectId);
  const topic = subject?.topics.find((t) => t.id === values.topicId);
  const materialMax = fromMaterial ? MAX_SCHOOL_MATERIAL_LENGTH : MATERIAL_MAX;
  const hasPending = pending.current !== null;
  const dirty = form.isDirty() || hasPending;

  // W trakcie wysyłania polecenia wyjście jest zablokowane (jak zapis w edytorach):
  // odpowiedź otwiera utworzoną lekcję, więc nawigacja w tej chwili by się z nią ścigała.
  useEffect(() => {
    registerEditorState({ dirty, busy: creating });
  }, [registerEditorState, dirty, creating]);
  useEffect(() => () => registerEditorState({ dirty: false, busy: false }), [registerEditorState]);

  const setObjectives = (objectiveIds: string[]) => {
    form.setValues((current) => ({
      objectiveIds,
      // domyślna pula podąża za liczbą reguł, dopóki rodzic jej ręcznie nie zmieni
      ...(current.poolSizeTouched ? {} : { poolSize: defaultPoolSize(objectiveIds.length) }),
    }));
  };
  const chooseSubject = (id: string) => {
    const firstTopic = catalog?.subjects.find((s) => s.id === id)?.topics[0];
    form.setFieldValue("subjectId", id);
    form.setFieldValue("topicId", firstTopic?.id ?? "");
    setObjectives(firstTopic?.objectives.map((o) => o.id) ?? []);
  };
  const chooseTopic = (id: string) => {
    form.setFieldValue("topicId", id);
    setObjectives(subject?.topics.find((t) => t.id === id)?.objectives.map((o) => o.id) ?? []);
  };
  const toggleObjective = (id: string) => {
    const current = form.getValues().objectiveIds;
    setObjectives(current.includes(id) ? current.filter((o) => o !== id) : [...current, id]);
  };

  const submit = async (): Promise<void> => {
    if (creatingRef.current) return;
    let lesson = pending.current;
    if (!lesson) {
      const invalid = validationError(values, path);
      if (invalid) {
        form.setFieldError("submit", invalid);
        return;
      }
      lesson = buildCommand(values, path);
      pending.current = lesson;
    }
    creatingRef.current = true;
    form.clearFieldError("submit");
    try {
      const acceptance = readLessonAcceptance(await create.mutateAsync(lesson));
      if (!acceptance) {
        if (mounted.current) form.setFieldError("submit", messages.lessons.createUncertain);
        return;
      }
      pending.current = null;
      if (!mounted.current) return;
      // utworzona lekcja nie jest już niezapisaną zmianą — przejście do edytora nie pyta o wyjście
      registerEditorState({ dirty: false, busy: false });
      onCreated(acceptance.deckId);
    } catch (cause) {
      if (isDefinitiveGenerationRejection(cause)) {
        pending.current = null;
        // 401: logowanie otwiera globalny handler, formularz zostaje
        if (httpStatusOf(cause) !== 401 && mounted.current) form.setFieldError("submit", errorMessage(cause));
      } else if (mounted.current) {
        form.setFieldError("submit", messages.lessons.createUncertain);
      }
    } finally {
      creatingRef.current = false;
    }
  };

  const submitError = form.errors.submit;
  const counterTemplate = fromMaterial ? messages.lessons.schoolMaterialCounter : messages.lessons.materialCounter;

  return (
    <Stack gap="md" data-testid="new-lesson-form" className="pp-editor pp-lesson-new">
      <div>
        <Button variant="subtle" size="md" px={4} className="pp-editor-back" data-testid="new-lesson-cancel" onClick={onCancel}
          leftSection={<ParentIcon name="chevron-left" />}>
          {messages.decks.backToList}
        </Button>
        <Title order={1} fz={{ base: 22, sm: 26 }} mt={6}>{messages.lessons.newLessonTitle}</Title>
      </div>

      {catalogQuery.isError && (
        <Alert color="red" variant="light" role="alert" data-testid="lesson-catalog-error">
          <Stack gap="sm" align="flex-start">
            <Text size="sm">{errorMessage(catalogQuery.error)}</Text>
            <Button size="md" variant="light" color="red" onClick={() => void catalogQuery.refetch()}>{messages.parentShell.retry}</Button>
          </Stack>
        </Alert>
      )}
      {catalogQuery.isPending && (
        <Group gap="sm" role="status"><Loader size="sm" /><Text>{messages.parentShell.loading}</Text></Group>
      )}

      {catalog && (
        <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="md">
              <NativeSelect
                size="md"
                id="lesson-subject"
                label={messages.lessons.subjectLabel}
                data-testid="lesson-subject"
                value={values.subjectId}
                disabled={creating}
                onChange={(e) => chooseSubject(e.currentTarget.value)}
                data={catalog.subjects.map((s) => ({ value: s.id, label: s.titlePl }))}
              />
              {path === "catalog" && (
                <NativeSelect
                  size="md"
                  id="lesson-topic"
                  label={messages.lessons.topicLabel}
                  data-testid="lesson-topic"
                  value={values.topicId}
                  disabled={creating}
                  onChange={(e) => chooseTopic(e.currentTarget.value)}
                  data={(subject?.topics ?? []).map((t) => ({ value: t.id, label: t.titlePl }))}
                />
              )}
              {path === "school" && (
                <>
                  <TextInput size="md" id="school-subject-name" label={messages.lessons.schoolSubjectNameLabel} data-testid="school-subject-name"
                    maxLength={MAX_SCHOOL_SUBJECT_TITLE_LENGTH} disabled={creating} {...form.getInputProps("schoolSubjectName")} />
                  <TextInput size="md" id="school-topic-name" label={messages.lessons.schoolTopicNameLabel} data-testid="school-topic-name"
                    maxLength={MAX_SCHOOL_TOPIC_TITLE_LENGTH} disabled={creating} {...form.getInputProps("topicTitle")} />
                </>
              )}
              {path === "material" && (
                <TextInput size="md" id="material-topic-name" label={messages.lessons.chapterTopicLabel} data-testid="material-topic-name"
                  maxLength={MAX_SCHOOL_TOPIC_TITLE_LENGTH} disabled={creating} {...form.getInputProps("topicTitle")} />
              )}
            </SimpleGrid>

            {fromMaterial ? (
              <Text size="sm" className="pp-editor-muted" data-testid="school-objectives-auto">{messages.lessons.schoolObjectivesAuto}</Text>
            ) : (
              <fieldset className="pp-lesson-objectives">
                <legend>{messages.lessons.objectivesLabel}</legend>
                <Stack gap="xs">
                  {(topic?.objectives ?? []).map((objective) => (
                    <Checkbox
                      key={objective.id}
                      size="md"
                      label={objective.titlePl}
                      data-testid={`lesson-objective-${objective.id}`}
                      checked={values.objectiveIds.includes(objective.id)}
                      disabled={creating}
                      onChange={() => toggleObjective(objective.id)}
                    />
                  ))}
                </Stack>
              </fieldset>
            )}

            <div>
              <Textarea
                size="md"
                label={fromMaterial ? messages.lessons.schoolMaterialLabel : messages.lessons.materialLabel}
                data-testid="lesson-material"
                autosize
                minRows={6}
                maxRows={16}
                maxLength={materialMax}
                placeholder={messages.lessons.materialPlaceholder}
                disabled={creating}
                aria-describedby="lesson-material-counter"
                {...form.getInputProps("material")}
              />
              {path === "school" && <Text size="sm" mt={6} className="pp-editor-muted" data-testid="school-material-hint">{messages.lessons.schoolMaterialHint}</Text>}
              {path === "material" && <Text size="sm" mt={6} className="pp-editor-muted" data-testid="material-hint">{messages.lessons.chapterMaterialHint}</Text>}
              <Text size="sm" mt={6} ta="right" className="pp-editor-muted" id="lesson-material-counter" data-testid="lesson-material-counter">
                {counterTemplate.replace("{n}", String(values.material.length))}
              </Text>
            </div>

            <TextInput size="md" label={messages.lessons.instructionLabel} data-testid="lesson-instruction" maxLength={500} disabled={creating}
              {...form.getInputProps("instruction")} />

            <NumberInput
              size="md"
              label={messages.lessons.poolSizeLabel}
              description={messages.lessons.poolSizeHint}
              data-testid="lesson-pool-size"
              className="pp-lesson-pool"
              min={POOL_MIN}
              max={fromMaterial ? MATERIAL_POOL_MAX : POOL_MAX}
              allowDecimal={false}
              allowNegative={false}
              clampBehavior="none"
              disabled={creating}
              value={values.poolSize}
              onChange={(value) => form.setValues({ poolSize: value, poolSizeTouched: true })}
            />

            {submitError && (
              <Alert color="red" variant="light" role="alert" data-testid="api-error" icon={<ParentIcon name="alert-triangle" />}>
                {submitError}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button
                size="md"
                className="pp-lesson-submit"
                data-testid="lesson-create-submit"
                leftSection={creating ? <Loader size={16} color="currentColor" /> : undefined}
                onClick={() => void submit()}
                disabled={creating || (!hasPending && !canSubmitLesson(values, catalog))}
              >
                {creating ? messages.lessons.creating : hasPending ? messages.lessons.retryCreate : messages.lessons.createLesson}
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
