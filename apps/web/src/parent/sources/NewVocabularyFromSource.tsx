"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Alert, Anchor, Button, Center, Group, Loader, NativeSelect, NumberInput, Paper, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  messages,
  MAX_DECK_ITEMS,
  MAX_GENERATION_INSTRUCTION_LENGTH,
  type GenerationCommand,
  type VocabularyFormat,
} from "@learning/contracts";
import { callParent, errorMessage, parentClient } from "../api";
import { readGenerationAcceptance } from "../generation-request";
import { classifyCreateFailure } from "../lessons/NewLessonForm";
import { ParentIcon } from "../ParentIcon";
import { routePath } from "../parent-routes";
import { plainClick } from "../plain-click";
import { httpStatusOf, orpc } from "../query-client";
import type { EditorLeaveState } from "../useParentLeaveGuard";
import "../deck-editor.css";
import "../lessons/lesson-panels.css";
import "./sources-panel.css";

/** Domyślna największa liczba słówek zestawu ze źródła (rodzic może zmienić w granicach 1–100). */
export const DEFAULT_SOURCE_VOCABULARY_ITEMS = 20;
/** Limit nazwy zestawu w kontrakcie polecenia generowania. */
const TITLE_MAX = 200;
/**
 * Limit czasu polecenia (serwer tylko przyjmuje je do kolejki). Po nim wynik
 * jest niepewny, a ponowienie wysyła to samo polecenie (ten sam klucz).
 */
const CREATE_TIMEOUT_MS = 30_000;

export interface VocabularyFromSourceValues {
  /** Nazwa zestawu; pusta — serwer nada tytuł źródła. */
  title: string;
  vocabularyFormat: VocabularyFormat;
  /** Wartość pola liczbowego (pusty tekst, gdy rodzic je wyczyścił). */
  maxItems: number | string;
  /** Zawężenie wyboru słów (np. „tylko pogoda”); puste — bez zawężenia. */
  instruction: string;
}

/** Źródło formularza: tytuł i tekst do podglądu oraz rewizja treści tego podglądu. */
export interface VocabularySource {
  id: string;
  title: string;
  body: string;
  bodyRevision: number;
}

/** Wartości startowe: nazwa zestawu = tytuł źródła, zestaw standardowy, 20 słówek, bez zawężenia. */
export function initialVocabularyValues(sourceTitle: string): VocabularyFromSourceValues {
  return {
    title: sourceTitle.trim().slice(0, TITLE_MAX),
    vocabularyFormat: "standard",
    maxItems: DEFAULT_SOURCE_VOCABULARY_ITEMS,
    instruction: "",
  };
}

/** Pola zgodne z kontraktem polecenia: 1–100 słówek, nazwa do 200, zawężenie do 500 znaków (po obcięciu spacji). */
export function canSubmitVocabulary(values: VocabularyFromSourceValues): boolean {
  const maxItems = values.maxItems;
  const maxItemsValid = typeof maxItems === "number" && Number.isInteger(maxItems) && maxItems >= 1 && maxItems <= MAX_DECK_ITEMS;
  return maxItemsValid
    && values.title.trim().length <= TITLE_MAX
    && values.instruction.trim().length <= MAX_GENERATION_INSTRUCTION_LENGTH;
}

/**
 * Odświeżenie źródła po konflikcie rewizji: `idle` — podgląd aktualny,
 * `refreshing` — trwa odczyt, `failed` — odczyt się nie udał (podgląd może być
 * nieaktualny, więc tworzenie czeka na ponowienie odczytu).
 */
export type SourceRefreshState = "idle" | "refreshing" | "failed";

export interface VocabularySubmitState {
  creating: boolean;
  sourceRefresh: SourceRefreshState;
  /** Źródło usunięto w innym oknie (404 przy tworzeniu albo odświeżeniu). */
  sourceMissing: boolean;
  /** Niepewne polecenie czeka na ponowienie — wysyłka ponawia je bez sprawdzania pól. */
  pending: boolean;
}

/**
 * „Utwórz zestaw” wyłączone: w trakcie wysyłki, dopóki podgląd po konflikcie
 * nie jest świeży, bez źródła (usunięte) albo z polami niezgodnymi z kontraktem.
 */
export function vocabularySubmitDisabled(values: VocabularyFromSourceValues, state: VocabularySubmitState): boolean {
  if (state.creating || state.sourceRefresh !== "idle" || state.sourceMissing) return true;
  return !state.pending && !canSubmitVocabulary(values);
}

/**
 * Polecenie zestawu ze źródła z nowym kluczem idempotencji. Niesie odwołanie
 * do źródła i rewizję treści wyświetlonego podglądu (serwer wybiera słowa
 * tylko z tego tekstu, inna rewizja to 409). Pustą nazwę i puste zawężenie
 * pomijamy — kontrakt nie przyjmuje pustych tekstów, a serwer nada tytuł źródła.
 */
export function buildVocabularyCommand(values: VocabularyFromSourceValues, source: { id: string; bodyRevision: number }): GenerationCommand {
  const title = values.title.trim();
  const instruction = values.instruction.trim();
  return {
    sourceMaterialId: source.id,
    expectedSourceRevision: source.bodyRevision,
    vocabularyFormat: values.vocabularyFormat,
    maxItems: Number(values.maxItems),
    idempotencyKey: crypto.randomUUID(),
    ...(title ? { title } : {}),
    ...(instruction ? { instruction } : {}),
  };
}

/**
 * Wynik ponownego odczytu źródła: `fresh` — świeży tekst i rewizja, `missing` —
 * źródło usunięto (404), `failed` — inny błąd (dane w pamięci mogą być stare).
 * Odczyt TanStack (`refetch`) kończy się bez wyjątku także po błędzie, więc
 * rozstrzyga stan wyniku, nie samo zakończenie obietnicy.
 */
export type SourceRefreshOutcome = "fresh" | "missing" | "failed";

export function sourceRefreshOutcome(result: { isError: boolean; error: unknown }): SourceRefreshOutcome {
  if (!result.isError) return "fresh";
  return httpStatusOf(result.error) === 404 ? "missing" : "failed";
}

/**
 * Formularz nowego zestawu słówek ze źródła (design 2026-10-30 §6.2): tytuł
 * i podgląd tekstu źródła tylko do odczytu (jak w formularzu lekcji), nazwa
 * zestawu, rodzaj, najwięcej słówek i opcjonalne zawężenie. Słowa wybiera
 * serwer wyłącznie z tekstu źródła — zawężenie ich nie dodaje.
 *
 * Niepewny wynik (sieć, 5xx, limit czasu) zostawia polecenie do ponowienia tym
 * samym kluczem, a pola są do tego czasu zablokowane (ponowienie wysyła to, co
 * widać). Źródło usunięte w innym oknie (404) wyłącza tworzenie. Tekst zmieniony
 * w innym oknie (409 `source_changed`) odświeża podgląd; „Utwórz zestaw” wraca
 * dopiero ze świeżym tekstem — nieudany odczyt pokazuje komunikat z ponowieniem
 * odczytu. Wpisane dane chroni leave guard; 401 obsługuje globalny handler.
 */
export function NewVocabularyForm({
  source,
  onCreated,
  onOpenSource,
  onSourceChanged,
  registerEditorState,
}: {
  source: VocabularySource;
  onCreated: (deckId: string) => void;
  /** Strona źródła (`sourceId` — „Wróć do źródła”) albo lista źródeł (`null` — „Zmień źródło”, źródło usunięte). */
  onOpenSource: (sourceId: string | null) => void;
  /** Ponowny odczyt źródła po konflikcie rewizji (odświeża podgląd i rewizję w `source`). */
  onSourceChanged: () => Promise<SourceRefreshOutcome>;
  registerEditorState: (state: EditorLeaveState) => void;
}) {
  const form = useForm<VocabularyFromSourceValues>({
    mode: "controlled",
    initialValues: initialVocabularyValues(source.title),
  });
  const pending = useRef<GenerationCommand | null>(null);
  const creatingRef = useRef(false);
  const mounted = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sourceMissing, setSourceMissing] = useState(false);
  const [sourceRefresh, setSourceRefresh] = useState<SourceRefreshState>("idle");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const create = useMutation({
    mutationFn: (command: GenerationCommand) => callParent(() =>
      parentClient.decks.generate(command, { signal: AbortSignal.timeout(CREATE_TIMEOUT_MS) })),
  });
  const creating = create.isPending;

  const values = form.getValues();
  const hasPending = pending.current !== null;
  const dirty = form.isDirty() || hasPending;

  // W trakcie wysyłki wyjście jest zablokowane: odpowiedź otwiera utworzony zestaw.
  useEffect(() => {
    registerEditorState({ dirty, busy: creating });
  }, [registerEditorState, dirty, creating]);
  useEffect(() => () => registerEditorState({ dirty: false, busy: false }), [registerEditorState]);

  const refreshSource = async (): Promise<void> => {
    setSourceRefresh("refreshing");
    let outcome: SourceRefreshOutcome;
    try {
      outcome = await onSourceChanged();
    } catch {
      outcome = "failed";
    }
    if (!mounted.current) return;
    if (outcome === "fresh") {
      // podgląd pokazuje bieżący tekst — ponowne „Utwórz zestaw” go potwierdza
      setSourceRefresh("idle");
      setSubmitError(messages.sources.changedBeforeCreateVocabulary);
    } else if (outcome === "missing") {
      setSourceRefresh("idle");
      setSourceMissing(true);
      setSubmitError(messages.sources.notFound);
    } else {
      setSourceRefresh("failed");
      setSubmitError(messages.sources.refreshFailed);
    }
  };

  const submit = async (): Promise<void> => {
    if (creatingRef.current || sourceRefresh !== "idle" || sourceMissing) return;
    let command = pending.current;
    if (!command) {
      if (!canSubmitVocabulary(values)) return;
      command = buildVocabularyCommand(values, source);
      pending.current = command;
    }
    creatingRef.current = true;
    setSubmitError(null);
    try {
      const acceptance = readGenerationAcceptance(await create.mutateAsync(command));
      if (!acceptance) {
        if (mounted.current) setSubmitError(messages.decks.generationUncertain);
        return;
      }
      pending.current = null;
      if (!mounted.current) return;
      // utworzony zestaw nie jest już niezapisaną zmianą — przejście do edytora nie pyta o wyjście
      registerEditorState({ dirty: false, busy: false });
      onCreated(acceptance.deckId);
    } catch (cause) {
      const failure = classifyCreateFailure(cause, true);
      if (failure === "uncertain") {
        if (mounted.current) setSubmitError(messages.decks.generationUncertain);
        return;
      }
      // Odpowiedź ostateczna: serwer sprawdza wcześniejsze polecenie z tym kluczem przed
      // odczytem źródła, więc zestaw nie powstał — następna wysyłka buduje nowe polecenie.
      pending.current = null;
      if (!mounted.current) return;
      if (failure === "source-missing") {
        setSourceMissing(true);
        setSubmitError(messages.sources.notFound);
      } else if (failure === "source-changed") {
        setSubmitError(messages.sources.changedBeforeCreateVocabulary);
        await refreshSource();
      } else if (httpStatusOf(cause) !== 401) {
        // 401: logowanie otwiera globalny handler, formularz zostaje
        setSubmitError(errorMessage(cause));
      }
    } finally {
      creatingRef.current = false;
    }
  };

  const disabled = vocabularySubmitDisabled(values, { creating, sourceRefresh, sourceMissing, pending: hasPending });
  // ponowienie niepewnego polecenia wysyła dokładnie to, co widać
  const fieldsLocked = creating || hasPending;

  const changeSourceHref = routePath({ section: "sources" });
  const changeSource = (event: MouseEvent) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    onOpenSource(null);
  };
  const back = sourceMissing
    ? { label: messages.sources.backToList, onClick: () => onOpenSource(null) }
    : { label: messages.sources.backToSource, onClick: () => onOpenSource(source.id) };

  return (
    <Stack gap="md" data-testid="new-vocabulary-form" className="pp-editor">
      <div>
        <Button variant="subtle" size="md" px={4} className="pp-editor-back" data-testid="new-vocabulary-cancel" onClick={back.onClick}
          leftSection={<ParentIcon name="chevron-left" />}>
          {back.label}
        </Button>
        <Title order={1} fz={{ base: 22, sm: 26 }} mt={6}>{messages.sources.newVocabularyTitle}</Title>
      </div>

      <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled) void submit();
          }}
        >
          <Stack gap="md">
            <div data-testid="new-vocabulary-source" className="pp-lesson-source">
              <Group justify="space-between" align="center" gap="xs" wrap="wrap">
                <Text fw={600} size="sm" id="new-vocabulary-source-title" className="pp-lesson-source-title">
                  {messages.sources.fromSource.replace("{title}", source.title)}
                </Text>
                <Anchor href={changeSourceHref} size="sm" className="pp-lesson-source-change" data-testid="new-vocabulary-source-change" onClick={changeSource}>
                  {messages.sources.changeSource}
                </Anchor>
              </Group>
              {/* tekst źródła tylko do podglądu — słowa wybieramy wyłącznie z niego */}
              <Textarea
                size="md"
                readOnly
                autosize
                maxRows={12}
                value={source.body}
                className="pp-source-preview"
                data-testid="new-vocabulary-source-preview"
                aria-labelledby="new-vocabulary-source-title"
              />
            </div>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="md">
              <TextInput size="md" id="new-vocabulary-title" label={messages.decks.titleLabel} data-testid="new-vocabulary-title"
                maxLength={TITLE_MAX} disabled={fieldsLocked} {...form.getInputProps("title")} />
              <NativeSelect
                size="md"
                id="new-vocabulary-format"
                label={messages.decks.vocabularyFormatLabel}
                data-testid="new-vocabulary-format"
                disabled={fieldsLocked}
                data={[
                  { value: "standard", label: messages.decks.standardVocabulary },
                  { value: "picture", label: messages.decks.pictureVocabulary },
                ]}
                {...form.getInputProps("vocabularyFormat")}
              />
            </SimpleGrid>

            <NumberInput
              size="md"
              id="new-vocabulary-max-items"
              label={messages.sources.vocabularyMaxItemsLabel}
              description={messages.sources.vocabularyMaxItemsHint}
              data-testid="new-vocabulary-max-items"
              className="pp-lesson-pool"
              min={1}
              max={MAX_DECK_ITEMS}
              allowDecimal={false}
              allowNegative={false}
              clampBehavior="none"
              disabled={fieldsLocked}
              {...form.getInputProps("maxItems")}
            />

            <TextInput
              size="md"
              id="new-vocabulary-instruction"
              label={messages.sources.vocabularyInstructionLabel}
              description={messages.sources.vocabularyInstructionHint}
              placeholder={messages.sources.vocabularyInstructionPlaceholder}
              data-testid="new-vocabulary-instruction"
              maxLength={MAX_GENERATION_INSTRUCTION_LENGTH}
              disabled={fieldsLocked}
              {...form.getInputProps("instruction")}
            />

            {submitError && (
              <Alert color="red" variant="light" role="alert" data-testid="new-vocabulary-error" icon={<ParentIcon name="alert-triangle" />}>
                <Stack gap={4} align="flex-start">
                  <span>{submitError}</span>
                  {sourceRefresh === "failed" && (
                    <Button size="md" variant="light" color="red" mt={4} leftSection={<ParentIcon name="refresh" />}
                      data-testid="new-vocabulary-refresh-retry" onClick={() => void refreshSource()}>
                      {messages.parentShell.retry}
                    </Button>
                  )}
                  {sourceMissing && (
                    <Anchor href={changeSourceHref} size="sm" className="pp-lesson-source-change" data-testid="new-vocabulary-source-missing-change" onClick={changeSource}>
                      {messages.sources.changeSource}
                    </Anchor>
                  )}
                </Stack>
              </Alert>
            )}
            <Group justify="flex-end">
              <Button
                type="submit"
                size="md"
                className="pp-lesson-submit"
                data-testid="new-vocabulary-submit"
                leftSection={creating || sourceRefresh === "refreshing" ? <Loader size={16} color="currentColor" /> : undefined}
                disabled={disabled}
              >
                {creating
                  ? messages.sources.creatingVocabulary
                  : hasPending
                    ? messages.decks.retryGenerationRequest
                    : messages.sources.createVocabularySubmit}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </Stack>
  );
}

/**
 * Nowy zestaw słówek ze źródła (`/parent/vocabulary/new?source=…`): najpierw
 * odczyt źródła (tytuł, tekst do podglądu i jego rewizja treści), potem
 * formularz; po konflikcie rewizji formularz odczytuje źródło ponownie. Źródło
 * usunięte albo z niepełnego linku — komunikat i powrót do listy źródeł.
 */
export default function NewVocabularyFromSource({
  sourceId,
  onOpenSource,
  onCreated,
  registerEditorState,
}: {
  sourceId: string;
  onOpenSource: (sourceId: string | null) => void;
  onCreated: (deckId: string) => void;
  registerEditorState: (state: EditorLeaveState) => void;
}) {
  const query = useQuery(orpc.sources.get.queryOptions({ input: { sourceId } }));
  const source = query.data;
  if (source !== undefined) {
    return (
      <NewVocabularyForm
        source={{ id: source.id, title: source.title, body: source.body, bodyRevision: source.bodyRevision }}
        onCreated={onCreated}
        onOpenSource={onOpenSource}
        onSourceChanged={async () => sourceRefreshOutcome(await query.refetch())}
        registerEditorState={registerEditorState}
      />
    );
  }
  if (query.isPending) {
    return (
      <Center py="xl" role="status" data-testid="new-vocabulary-loading">
        <Group gap="sm"><Loader size="sm" /><Text>{messages.parentShell.loading}</Text></Group>
      </Center>
    );
  }
  const notFound = httpStatusOf(query.error) === 404;
  return (
    <Stack gap="md" align="flex-start" data-testid={notFound ? "new-vocabulary-not-found" : "new-vocabulary-load-error"}>
      <Alert color={notFound ? "gray" : "red"} variant="light" w="100%" role={notFound ? undefined : "alert"}>
        <Stack gap="sm" align="flex-start">
          <Text size="sm">{notFound ? messages.sources.notFound : errorMessage(query.error)}</Text>
          {!notFound && (
            <Button size="md" variant="light" color="red" data-testid="new-vocabulary-load-retry" onClick={() => void query.refetch()}>
              {messages.parentShell.retry}
            </Button>
          )}
        </Stack>
      </Alert>
      <Button variant="default" size="md" data-testid="new-vocabulary-back" leftSection={<ParentIcon name="chevron-left" />}
        onClick={() => onOpenSource(null)}>
        {messages.sources.backToList}
      </Button>
    </Stack>
  );
}
