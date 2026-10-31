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
import { ParentIcon } from "../ParentIcon";
import { routePath } from "../parent-routes";
import { plainClick } from "../plain-click";
import { httpStatusOf, orpc } from "../query-client";
import type { EditorLeaveState } from "../useParentLeaveGuard";
import { classifyCreateFailure, isFreshSourceRefresh, sourceRefreshOutcome, type SourceRefreshOutcome } from "./source-refresh";
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
 * `refreshing` — trwa odczyt, `failed` — odczyt się nie udał albo przyniósł
 * odrzuconą rewizję (podgląd może być nieaktualny, więc tworzenie czeka na
 * ponowienie odczytu).
 */
export type SourceRefreshState = "idle" | "refreshing" | "failed";

export interface VocabularySubmitState {
  creating: boolean;
  sourceRefresh: SourceRefreshState;
  /** Źródło usunięto w innym oknie (404 przy tworzeniu albo odświeżeniu). */
  sourceMissing: boolean;
  /** Niepewne polecenie czeka na ponowienie — wysyłka ponawia je bez sprawdzania pól. */
  pending: boolean;
  /** Rewizja treści wyświetlanego podglądu. */
  sourceRevision: number;
  /** Rewizja odrzucona przez serwer (409) — podgląd z nią jest nieaktualny; `null` — bez konfliktu. */
  staleRevision: number | null;
}

/**
 * „Utwórz zestaw” wyłączone: w trakcie wysyłki, dopóki podgląd po konflikcie
 * nie jest świeży (odczyt trwa, nie udał się albo podgląd ma wciąż odrzuconą
 * rewizję), bez źródła (usunięte) albo z polami niezgodnymi z kontraktem.
 */
export function vocabularySubmitDisabled(values: VocabularyFromSourceValues, state: VocabularySubmitState): boolean {
  if (state.creating || state.sourceRefresh !== "idle" || state.sourceMissing) return true;
  if (state.staleRevision !== null && state.sourceRevision === state.staleRevision) return true;
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
 * Formularz nowego zestawu słówek ze źródła (design 2026-10-30 §6.2): tytuł
 * i podgląd tekstu źródła tylko do odczytu (jak w formularzu lekcji), nazwa
 * zestawu, rodzaj, najwięcej słówek i opcjonalne zawężenie. Słowa wybiera
 * serwer wyłącznie z tekstu źródła — zawężenie ich nie dodaje.
 *
 * Niepewny wynik (sieć, 5xx, limit czasu) zostawia polecenie do ponowienia tym
 * samym kluczem, a pola są do tego czasu zablokowane (ponowienie wysyła to, co
 * widać). Źródło usunięte w innym oknie (404) wyłącza tworzenie. Tekst zmieniony
 * w innym oknie (409 `source_changed`) odświeża podgląd; „Utwórz zestaw” wraca
 * dopiero po odczycie z rewizją treści inną niż odrzucona — nieudany odczyt
 * (także z tą samą rewizją) pokazuje komunikat z ponowieniem odczytu. Nazwa
 * zestawu, której rodzic nie zmienił, podąża za tytułem odświeżonego źródła.
 * Wpisane dane chroni leave guard; 401 obsługuje globalny handler.
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
  // trwa ponowny odczyt źródła po konflikcie rewizji
  const [refreshing, setRefreshing] = useState(false);
  // odczyt się nie udał (albo przyniósł odrzuconą rewizję): komunikat z „Spróbuj ponownie”
  const [refreshFailed, setRefreshFailed] = useState(false);
  // rewizja treści odrzucona przez serwer (409): tworzenie czeka, aż `source` przyniesie nową
  const [staleRevision, setStaleRevision] = useState<number | null>(null);
  const sourceRefresh: SourceRefreshState = refreshing ? "refreshing" : refreshFailed ? "failed" : "idle";
  const sourceOutdated = staleRevision !== null && source.bodyRevision === staleRevision;
  // po „Spróbuj ponownie” fokus trafia na następny krok: ponowienie, odświeżony tekst albo „Zmień źródło”
  const refocusAfterRetry = useRef(false);
  const retryRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const missingChangeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Domyślna nazwa zestawu (tytuł źródła) podąża za odświeżonym źródłem, dopóki
  // rodzic jej nie zmienił; niepewne polecenie czeka na ponowienie z tym, co widać.
  const appliedSourceTitle = useRef(source.title);
  useEffect(() => {
    if (appliedSourceTitle.current === source.title) return;
    appliedSourceTitle.current = source.title;
    if (pending.current !== null || form.isDirty("title")) return;
    const title = initialVocabularyValues(source.title).title;
    form.setInitialValues({ ...form.getInitialValues(), title });
    form.setFieldValue("title", title);
  }, [source.title, form]);

  useEffect(() => {
    if (refreshing || !refocusAfterRetry.current) return;
    refocusAfterRetry.current = false;
    (refreshFailed ? retryRef.current : sourceMissing ? missingChangeRef.current : previewRef.current)?.focus();
  }, [refreshing, refreshFailed, sourceMissing]);

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

  /**
   * Ponowny odczyt źródła po konflikcie rewizji. Tworzenie wraca dopiero po
   * udanym odczycie z rewizją treści inną niż odrzucona (`stale`); odczyt
   * nieudany albo z tą samą rewizją zostawia komunikat z „Spróbuj ponownie”,
   * a 404 — stan usuniętego źródła.
   */
  const refreshSource = async (stale: number | null): Promise<void> => {
    setRefreshing(true);
    let outcome: SourceRefreshOutcome = { status: "failed" };
    try {
      outcome = await onSourceChanged();
    } catch {
      // odczyt zgłoszony wyjątkiem to także nieudane odświeżenie
    }
    if (!mounted.current) return;
    setRefreshing(false);
    if (outcome.status === "missing") {
      setRefreshFailed(false);
      setSourceMissing(true);
      setSubmitError(messages.sources.notFound);
    } else if (isFreshSourceRefresh(outcome, stale)) {
      // podgląd pokazuje bieżący tekst — ponowne „Utwórz zestaw” go potwierdza
      setRefreshFailed(false);
      setSubmitError(messages.sources.changedBeforeCreateVocabulary);
    } else {
      setRefreshFailed(true);
      setSubmitError(messages.sources.refreshFailed);
    }
  };

  const submit = async (): Promise<void> => {
    if (creatingRef.current || sourceRefresh !== "idle" || sourceMissing || sourceOutdated) return;
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
        // rewizja z odrzuconego polecenia — podgląd z nią jest nieaktualny
        const stale = command.expectedSourceRevision ?? source.bodyRevision;
        setSubmitError(messages.sources.changedBeforeCreateVocabulary);
        setStaleRevision(stale);
        await refreshSource(stale);
      } else if (httpStatusOf(cause) !== 401) {
        // 401: logowanie otwiera globalny handler, formularz zostaje
        setSubmitError(errorMessage(cause));
      }
    } finally {
      creatingRef.current = false;
    }
  };

  const disabled = vocabularySubmitDisabled(values, {
    creating, sourceRefresh, sourceMissing, pending: hasPending, sourceRevision: source.bodyRevision, staleRevision,
  });
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
                ref={previewRef}
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
                  {/* zostaje w trakcie ponownego odczytu (stan ładowania), żeby nie gubić fokusu */}
                  {refreshFailed && !sourceMissing && (
                    <Button ref={retryRef} size="md" variant="light" color="red" mt={4} leftSection={<ParentIcon name="refresh" />}
                      data-testid="new-vocabulary-refresh-retry" loading={refreshing}
                      onClick={() => {
                        refocusAfterRetry.current = true;
                        void refreshSource(staleRevision);
                      }}>
                      {messages.parentShell.retry}
                    </Button>
                  )}
                  {sourceMissing && (
                    <Anchor ref={missingChangeRef} href={changeSourceHref} size="sm" className="pp-lesson-source-change"
                      data-testid="new-vocabulary-source-missing-change" onClick={changeSource}>
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
                leftSection={creating || refreshing ? <Loader size={16} color="currentColor" /> : undefined}
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
