"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
  ActionIcon,
  Affix,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
  VisuallyHidden,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  messages,
  type ChildDto,
  type CreateEmptyDeckCommand,
  type DeckSummaryDto,
  type GenerationCommand,
} from "@learning/contracts";
import { callParent, ApiCallError, errorMessage, parentClient } from "./api";
import { isDefinitiveGenerationRejection, readGenerationAcceptance } from "./generation-request";
import DeckEditor from "./DeckEditor";
import LessonEditor from "./lessons/LessonEditor";
import NewLessonForm from "./lessons/NewLessonForm";
import ArchiveLessonDialog from "./lessons/ArchiveLessonDialog";
import NewMaterialDialog, { type NewMaterialStep } from "./NewMaterialDialog";
import NewVocabularyFromSource from "./sources/NewVocabularyFromSource";
import { DECK_STATE_TONE, filterByKind, groupDecksByState, polishPlural, type DeckKindFilter } from "./deck-list-grouping";
import { ParentIcon } from "./ParentIcon";
import type { ParentRoute } from "./parent-routes";
import { httpStatusOf, orpc } from "./query-client";
import { sourceRefreshOutcome } from "./sources/source-refresh";
import { sourceRoute } from "./sources/sources-state";
import type { EditorLeaveState } from "./useParentLeaveGuard";
import { formatFamilyDate } from "./family-date";
import "./decks-panel.css";

type DeckKind = "vocabulary" | "lesson";

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

/** Części meta wiersza zestawu: liczba pozycji, przypisane dzieci, najbliższy sprawdzian. */
function deckMetaParts(deck: DeckSummaryDto): string[] {
  const kind = deck.kind === "lesson" ? "lesson" : "vocabulary";
  const parts: string[] = [];
  if (deck.itemCount !== undefined) {
    const templates = messages.decks.itemCount[kind];
    parts.push(fill(templates[polishPlural(deck.itemCount)], { n: deck.itemCount }));
  }
  const assigned = deck.assignedChildren ?? [];
  if (assigned.length > 0) {
    const names = assigned.slice(0, 2).map((child) => child.displayName).join(", ");
    parts.push(assigned.length > 2 ? `${names}, ${fill(messages.decks.assignedMore, { n: assigned.length - 2 })}` : names);
    const nearest = assigned
      .map((child) => child.testDate)
      .filter((date): date is string => date !== null)
      .sort()
      .at(0);
    if (nearest) {
      parts.push(fill(messages.decks.testDateShort, { date: formatFamilyDate(nearest) }));
    }
  }
  return parts;
}

/**
 * Formularz nowej lekcji ze źródła (`/parent/lessons/new?source=…`): najpierw
 * odczyt źródła (tytuł, tekst do podglądu i jego rewizja treści), potem zwykły
 * formularz w trybie źródła; po konflikcie rewizji przy tworzeniu formularz
 * odczytuje źródło ponownie (`refetch()` nie odrzuca obietnicy przy błędzie,
 * więc formularz dostaje wynik odczytu i bez udanego nie wraca do tworzenia).
 * Źródło usunięte albo z niepełnego linku — komunikat i powrót do
 * listy źródeł (tam rodzic wybiera inne źródło).
 */
function NewLessonFromSource({
  sourceId,
  onOpenSource,
  ...formProps
}: { sourceId: string; onOpenSource: (sourceId: string | null) => void } & Omit<ComponentProps<typeof NewLessonForm>, "source" | "onOpenSource" | "onSourceChanged">) {
  const query = useQuery(orpc.sources.get.queryOptions({ input: { sourceId } }));
  const source = query.data;
  if (source !== undefined) {
    return (
      <NewLessonForm
        source={{ id: source.id, title: source.title, body: source.body, bodyRevision: source.bodyRevision }}
        onOpenSource={onOpenSource}
        onSourceChanged={async () => sourceRefreshOutcome(await query.refetch())}
        {...formProps}
      />
    );
  }
  if (query.isPending) {
    return (
      <Center py="xl" role="status" data-testid="lesson-source-loading">
        <Group gap="sm"><Loader size="sm" /><Text>{messages.parentShell.loading}</Text></Group>
      </Center>
    );
  }
  const notFound = httpStatusOf(query.error) === 404;
  return (
    <Stack gap="md" align="flex-start" data-testid={notFound ? "lesson-source-not-found" : "lesson-source-error"}>
      <Alert color={notFound ? "gray" : "red"} variant="light" w="100%" role={notFound ? undefined : "alert"}>
        <Stack gap="sm" align="flex-start">
          <Text size="sm">{notFound ? messages.sources.notFound : errorMessage(query.error)}</Text>
          {!notFound && (
            <Button size="md" variant="light" color="red" onClick={() => void query.refetch()}>{messages.parentShell.retry}</Button>
          )}
        </Stack>
      </Alert>
      <Button variant="default" size="md" data-testid="lesson-source-back" leftSection={<ParentIcon name="chevron-left" />}
        onClick={() => onOpenSource(null)}>
        {messages.sources.backToList}
      </Button>
    </Stack>
  );
}

/**
 * Sekcja Zestawy: lista pogrupowana po stanie, tworzenie materiału oraz —
 * według adresu — edytor zestawu (`/parent/decks/{id}`), formularz nowej
 * lekcji (`/parent/lessons/new`, ze źródła: `?source=…&subject=…`) albo
 * nowego zestawu słówek ze źródła (`/parent/vocabulary/new?source=…`).
 */
export default function DecksPanel({
  route,
  decks,
  childrenList,
  onChanged,
  registerEditorState,
  onAuthExpired,
  onNavigate,
}: {
  route: ParentRoute;
  decks: DeckSummaryDto[];
  childrenList: ChildDto[];
  onChanged: () => Promise<void>;
  registerEditorState: (state: EditorLeaveState) => void;
  onAuthExpired: () => void;
  onNavigate: (route: ParentRoute, options?: { replace?: boolean }) => void;
}) {
  const compact = useMediaQuery("(max-width: 37.49em)", false, { getInitialValueInEffect: false }) ?? false;
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [vocabularyFormat, setVocabularyFormat] = useState<"standard" | "picture">("standard");
  const [generating, setGenerating] = useState(false);
  const [creatingEmpty, setCreatingEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [newMaterialOpen, setNewMaterialOpen] = useState(false);
  const [newMaterialStep, setNewMaterialStep] = useState<NewMaterialStep>("menu");
  const [kindFilter, setKindFilter] = useState<DeckKindFilter>("all");
  const [archiveLesson, setArchiveLesson] = useState<DeckSummaryDto | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null);
  // Potwierdzony zapis pozostaje widoczny także po nieudanym odświeżeniu listy.
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(new Set());
  const archiveBusyRef = useRef(false);
  const archiveFilter = useRef<HTMLInputElement>(null);
  const archiveTrigger = useRef<HTMLElement | null>(null);
  const pendingEmptyCommand = useRef<CreateEmptyDeckCommand | null>(null);
  const creatingEmptyRef = useRef(false);
  const pendingGenerationCommand = useRef<GenerationCommand | null>(null);
  const generatingRef = useRef(false);
  // Rodzaj zestawów utworzonych w tej sesji panelu — lista może się jeszcze nie odświeżyć.
  const knownKinds = useRef(new Map<string, DeckKind>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Powrót z edytora lub formularza lekcji albo słówek ze źródła do listy odświeża listę (jak dawny „Wróć”).
  const editorOpen = route.deckId !== undefined || route.newLesson === true || route.newVocabulary === true;
  const wasEditorOpen = useRef(editorOpen);
  useEffect(() => {
    if (wasEditorOpen.current && !editorOpen) void onChanged().catch(() => undefined);
    wasEditorOpen.current = editorOpen;
  }, [editorOpen, onChanged]);

  // Zestaw spoza listy w pamięci (utworzony w innym oknie, link ze strony źródła, stary link):
  // przed komunikatem „Nie ma takiego zestawu” jedno odświeżenie listy z ładowaniem.
  const routeDeckId = route.deckId;
  const routeDeckKnown = routeDeckId === undefined
    || knownKinds.current.has(routeDeckId)
    || decks.some((deck) => deck.deckId === routeDeckId);
  const [deckLookup, setDeckLookup] = useState<{ deckId: string; done: boolean } | null>(null);
  const lookedUpDeck = useRef<string | null>(null);
  useEffect(() => {
    if (routeDeckId === undefined) {
      lookedUpDeck.current = null;
      return;
    }
    if (routeDeckKnown || lookedUpDeck.current === routeDeckId) return;
    lookedUpDeck.current = routeDeckId;
    setDeckLookup({ deckId: routeDeckId, done: false });
    void onChanged()
      .catch(() => undefined)
      .finally(() => {
        if (mounted.current) setDeckLookup((current) => (current?.deckId === routeDeckId ? { deckId: routeDeckId, done: true } : current));
      });
  }, [routeDeckId, routeDeckKnown, onChanged]);

  const openDeck = (deckId: string, kind: DeckKind, options?: { replace?: boolean }) => {
    knownKinds.current.set(deckId, kind);
    onNavigate({ section: "decks", deckId }, options);
  };
  const openList = () => onNavigate({ section: "decks" });

  const archive = async () => {
    if (!archiveLesson || archiveBusyRef.current) return;
    archiveBusyRef.current = true;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await callParent(() => parentClient.decks.archive({ deckId: archiveLesson.deckId }));
      if (!mounted.current) return;
      setArchivedIds((current) => new Set([...current, archiveLesson.deckId]));
      setArchiveLesson(null);
      try {
        await onChanged();
      } catch (cause) {
        if (!mounted.current) return;
        if ((cause as { status?: number }).status === 401) onAuthExpired();
        else setArchiveNotice(messages.lessons.archiveRefreshFailed);
      }
    } catch (cause) {
      if (!mounted.current) return;
      if ((cause as { status?: number }).status === 401) onAuthExpired();
      else setArchiveError(cause instanceof ApiCallError ? errorMessage(cause) : messages.lessons.archiveFailed);
    } finally {
      archiveBusyRef.current = false;
      if (mounted.current) setArchiveBusy(false);
    }
  };

  const visibleDecks = decks
    .map((deck) => archivedIds.has(deck.deckId) ? { ...deck, state: "archived" as const } : deck)
    .filter((deck) => showArchived || deck.kind !== "lesson" || deck.state !== "archived");

  // Stan niepewnego polecenia żyje poza modalem: ponowne otwarcie wraca do
  // formularza z przyciskiem ponowienia, zanim polecenie zostanie rozstrzygnięte.
  const openNewMaterial = () => {
    setNewMaterialStep(
      pendingGenerationCommand.current !== null
        ? "generate"
        : pendingEmptyCommand.current !== null
          ? "empty"
          : "menu",
    );
    setNewMaterialOpen(true);
  };

  const generate = async () => {
    if (generatingRef.current || creatingEmptyRef.current) {
      return;
    }
    generatingRef.current = true;
    setGenerating(true);
    setError(null);
    const command = pendingGenerationCommand.current ?? {
      prompt: prompt.trim(),
      idempotencyKey: crypto.randomUUID(),
      vocabularyFormat,
      ...(title.trim() ? { title: title.trim() } : {}),
    };
    pendingGenerationCommand.current = command;
    try {
      const response = await callParent(() => parentClient.decks.generate(command));
      const acceptance = readGenerationAcceptance(response);
      if (!acceptance) {
        if (mounted.current) setError(messages.decks.generationUncertain);
        return;
      }
      pendingGenerationCommand.current = null;
      if (mounted.current) {
        setPrompt("");
        setTitle("");
        setVocabularyFormat("standard");
        setNewMaterialOpen(false);
        openDeck(acceptance.deckId, "vocabulary");
        void onChanged().catch(() => undefined);
      }
    } catch (cause) {
      if (isDefinitiveGenerationRejection(cause)) {
        pendingGenerationCommand.current = null;
        if ((cause as { status?: number }).status === 401) {
          if (mounted.current) onAuthExpired();
          return;
        }
        if (mounted.current) setError(errorMessage(cause));
      } else if (mounted.current) {
        setError(messages.decks.generationUncertain);
      }
    } finally {
      generatingRef.current = false;
      if (mounted.current) setGenerating(false);
    }
  };

  const createEmpty = async () => {
    if (creatingEmptyRef.current || generatingRef.current || pendingGenerationCommand.current !== null) {
      return;
    }
    creatingEmptyRef.current = true;
    setCreatingEmpty(true);
    setError(null);
    const command = pendingEmptyCommand.current ?? {
      deckId: crypto.randomUUID(),
      ...(title.trim() ? { title: title.trim() } : {}),
    };
    pendingEmptyCommand.current = command;

    try {
      const created = await callParent(() => parentClient.decks.create(command));
      pendingEmptyCommand.current = null;
      setPrompt("");
      setTitle("");
      setNewMaterialOpen(false);
      openDeck(created.body.deckId, "vocabulary");
      // Utworzenie już się powiodło; problem odświeżenia listy nie może wyglądać
      // jak błąd tworzenia i nie może uruchomić nowego UUID przy kolejnym kliknięciu.
      void onChanged().catch(() => undefined);
    } catch (cause) {
      if ((cause as { code?: string }).code === "validation") {
        // Błąd walidacji jest definitywny, więc rodzic może poprawić tytuł;
        // tylko niepewny wynik sieciowy powinien zachować poprzednie polecenie.
        pendingEmptyCommand.current = null;
      }
      setError(errorMessage(cause));
    } finally {
      creatingEmptyRef.current = false;
      setCreatingEmpty(false);
    }
  };

  if (route.deckId !== undefined) {
    const deckId = route.deckId;
    const kind = knownKinds.current.get(deckId)
      ?? decks.find((deck) => deck.deckId === deckId)?.kind;
    if (kind === undefined) {
      if (!routeDeckKnown && !(deckLookup?.deckId === deckId && deckLookup.done)) {
        return (
          <Center py="xl" role="status" data-testid="deck-loading">
            <Group gap="sm"><Loader size="sm" /><Text>{messages.parentShell.loading}</Text></Group>
          </Center>
        );
      }
      return (
        <Stack gap="md" align="flex-start" data-testid="deck-not-found">
          <Alert color="gray" variant="light" w="100%">{messages.decks.notFound}</Alert>
          <Button variant="default" size="md" onClick={openList}>{messages.decks.backToList}</Button>
        </Stack>
      );
    }
    return kind === "lesson" ? (
      <LessonEditor
        key={deckId}
        deckId={deckId}
        childrenList={childrenList}
        onEditorStateChange={registerEditorState}
        onBack={openList}
        onOpenSource={(sourceId) => onNavigate({ section: "sources", sourceId })}
        onArchived={() => {
          // jak archiwizacja z listy: lekcja znika od razu, nieudane odświeżenie listy daje komunikat
          setArchivedIds((current) => new Set([...current, deckId]));
          setArchiveNotice(null);
          openList();
          void onChanged().catch((cause: unknown) => {
            if (mounted.current && (cause as { status?: number }).status !== 401) setArchiveNotice(messages.lessons.archiveRefreshFailed);
          });
        }}
      />
    ) : (
      <DeckEditor
        key={deckId}
        deckId={deckId}
        childrenList={childrenList}
        onEditorStateChange={registerEditorState}
        onBack={openList}
        onOpenSource={(sourceId) => onNavigate(sourceRoute(sourceId))}
      />
    );
  }

  if (route.newVocabulary && route.sourceId !== undefined) {
    return (
      <NewVocabularyFromSource
        key={route.sourceId}
        sourceId={route.sourceId}
        registerEditorState={registerEditorState}
        onOpenSource={(sourceId) => onNavigate(sourceRoute(sourceId))}
        onCreated={(createdDeckId) => {
          // formularz znika z historii — „wstecz” z nowego zestawu prowadzi do strony źródła, nie do formularza
          openDeck(createdDeckId, "vocabulary", { replace: true });
          void onChanged().catch(() => undefined);
          // nowy zestaw na liście zestawów źródła
          void queryClient.invalidateQueries({ queryKey: orpc.sources.key() });
        }}
      />
    );
  }

  if (route.newLesson) {
    const formProps = {
      registerEditorState,
      initialSubjectId: route.subjectId,
      onCancel: openList,
      onCreated: (createdDeckId: string) => {
        // formularz znika z historii — „wstecz” z nowej lekcji prowadzi do listy, nie do pustego formularza
        openDeck(createdDeckId, "lesson", { replace: true });
        void onChanged().catch(() => undefined);
        // nowy zestaw na liście zestawów źródła
        if (route.sourceId !== undefined) void queryClient.invalidateQueries({ queryKey: orpc.sources.key() });
      },
    };
    if (route.sourceId !== undefined) {
      return (
        <NewLessonFromSource
          key={route.sourceId}
          sourceId={route.sourceId}
          onOpenSource={(sourceId) => onNavigate(sourceRoute(sourceId))}
          {...formProps}
        />
      );
    }
    return <NewLessonForm key={route.subjectId ?? ""} {...formProps} />;
  }

  const pendingGeneration = pendingGenerationCommand.current !== null;
  const groups = groupDecksByState(filterByKind(visibleDecks, kindFilter));
  let rowIndex = 0;

  const newMaterialButton = (
    <Button
      size={compact ? "lg" : "md"}
      radius="lg"
      leftSection={<ParentIcon name="plus" />}
      data-testid="new-material-open"
      onClick={openNewMaterial}
      className={compact ? "pp-decks-fab" : undefined}
    >
      {messages.decks.newMaterial}
    </Button>
  );

  return (
    <Stack component="section" gap="lg">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Title order={1} fz={26}>{messages.decks.title}</Title>
        {!compact && newMaterialButton}
      </Group>

      <Group gap="md" wrap="wrap" justify="space-between">
        <Group
          gap={4}
          p={4}
          wrap="nowrap"
          w={compact ? "100%" : undefined}
          className="pp-decks-segmented"
          data-testid="deck-kind-filter"
          role="group"
          aria-label={messages.decks.kindFilterLabel}
        >
          {(["all", "vocabulary", "lesson"] as const).map((kind) => (
            <Button
              key={kind}
              size="md"
              radius="md"
              variant={kindFilter === kind ? "default" : "subtle"}
              color="gray"
              aria-pressed={kindFilter === kind}
              onClick={() => setKindFilter(kind)}
              className="pp-decks-segment"
              px="sm"
              style={compact ? { flex: "1 1 0", minWidth: 0 } : undefined}
            >
              {messages.decks.kindFilter[kind]}
            </Button>
          ))}
        </Group>
        {decks.some((deck) => deck.kind === "lesson") && (
          <Checkbox
            ref={archiveFilter}
            size="md"
            label={messages.lessons.showArchived}
            checked={showArchived}
            onChange={(event) => setShowArchived(event.currentTarget.checked)}
          />
        )}
      </Group>

      {archiveNotice && <Text role="status">{archiveNotice}</Text>}
      {visibleDecks.length === 0 && <Text className="pp-decks-muted">{messages.decks.empty}</Text>}

      {groups.map((group) => (
        <Stack key={group.id} component="section" gap="xs" data-testid={`deck-group-${group.id}`}>
          <Group gap="xs">
            <Title order={2} fz="sm" tt="uppercase" className="pp-decks-group-label">
              {messages.decks.groups[group.id]}
            </Title>
            <Badge variant="light" color="gray" size="sm" radius="xl">{group.decks.length}</Badge>
          </Group>
          <Stack gap="xs" component="ul" className="pp-decks-list">
            {group.decks.map((deck) => {
              const index = rowIndex++;
              const kind: DeckKind = deck.kind === "lesson" ? "lesson" : "vocabulary";
              const metaParts = deckMetaParts(deck);
              return (
                <Paper key={deck.deckId} component="li" radius="lg" withBorder className="pp-decks-card">
                  <UnstyledButton
                    className="pp-decks-row"
                    data-testid={`deck-row-${index}`}
                    data-deck-id={deck.deckId}
                    onClick={() => openDeck(deck.deckId, kind)}
                  >
                    <ThemeIcon size={40} radius="md" variant="light" color={kind === "lesson" ? "violet" : "brand"} aria-hidden="true">
                      <ParentIcon name={kind === "lesson" ? "graduation-cap" : "book-open"} className="pp-decks-kind-icon" />
                    </ThemeIcon>
                    <Box className="pp-decks-body">
                      <Text fw={600} className="pp-decks-title">{deck.title}</Text>
                      <Text size="sm" className="pp-decks-muted">
                        <VisuallyHidden data-testid={`deck-kind-${index}`}>{messages.lessons.kindLabel[kind]}</VisuallyHidden>
                        {metaParts.join(" · ")}
                      </Text>
                      <span className="pp-status-badge" data-tone={DECK_STATE_TONE[deck.state]}>
                        {messages.decks.states[deck.state]}
                      </span>
                    </Box>
                    <ParentIcon name="chevron-right" className="pp-decks-chevron" />
                  </UnstyledButton>
                  {deck.kind === "lesson" && deck.state !== "archived" && (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size={44}
                      radius="md"
                      className="pp-decks-remove"
                      disabled={archiveBusy}
                      aria-label={messages.lessons.archiveLabel.replace("{title}", deck.title)}
                      onClick={(event) => {
                        archiveTrigger.current = event.currentTarget;
                        setArchiveError(null);
                        setArchiveNotice(null);
                        setArchiveLesson(deck);
                      }}
                    >
                      <ParentIcon name="trash-2" />
                    </ActionIcon>
                  )}
                </Paper>
              );
            })}
          </Stack>
        </Stack>
      ))}

      {compact && (
        <Affix position={{ right: 16, bottom: "calc(88px + env(safe-area-inset-bottom))" }} zIndex={150}>
          {newMaterialButton}
        </Affix>
      )}

      <NewMaterialDialog
        open={newMaterialOpen}
        fullScreen={compact}
        step={newMaterialStep}
        onStepChange={setNewMaterialStep}
        onRequestClose={() => setNewMaterialOpen(false)}
        title={title}
        onTitleChange={setTitle}
        vocabularyFormat={vocabularyFormat}
        onVocabularyFormatChange={setVocabularyFormat}
        prompt={prompt}
        onPromptChange={setPrompt}
        generating={generating}
        pendingGeneration={pendingGeneration}
        createDisabled={
          newMaterialStep === "generate"
            ? generating || creatingEmpty || creatingEmptyRef.current || (!pendingGeneration && prompt.trim().length === 0)
            : generating || creatingEmpty || pendingGeneration
        }
        onGenerate={generate}
        creatingEmpty={creatingEmpty}
        pendingEmpty={pendingEmptyCommand.current !== null}
        onCreateEmpty={createEmpty}
        onLesson={() => {
          setNewMaterialOpen(false);
          onNavigate({ section: "decks", newLesson: true });
        }}
        error={error}
      />

      <ArchiveLessonDialog
        lesson={archiveLesson}
        busy={archiveBusy}
        error={archiveError}
        onConfirm={() => { void archive(); }}
        onCancel={() => { if (!archiveBusyRef.current) setArchiveLesson(null); }}
        onClosed={() => {
          // fokus wraca do kosza, a gdy wiersz zniknął (lekcja w archiwum) — do filtra archiwum
          if (archiveTrigger.current?.isConnected) archiveTrigger.current.focus();
          else archiveFilter.current?.focus();
        }}
      />
    </Stack>
  );
}
