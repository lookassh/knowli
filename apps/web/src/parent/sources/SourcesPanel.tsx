"use client";

import { useEffect, useRef, useState } from "react";
import { Affix, Alert, Box, Button, Center, Group, Loader, Modal, Paper, Stack, Text, ThemeIcon, Title, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { messages, type SourceMaterialInput } from "@learning/contracts";
import { callParent, errorMessage, parentClient } from "../api";
import { ParentIcon } from "../ParentIcon";
import type { ParentRoute } from "../parent-routes";
import { httpStatusOf, orpc } from "../query-client";
import type { EditorLeaveState } from "../useParentLeaveGuard";
import SourceFields from "./SourceFields";
import SourcePage from "./SourcePage";
import {
  deckCountLabel,
  formatSourceDate,
  isUncertainFailure,
  newSourceCommand,
  sourceValuesValid,
  type SourceFormValues,
} from "./sources-state";
import "../decks-panel.css";
import "../deck-editor.css";
import "./sources-panel.css";

const COMPACT_QUERY = "(max-width: 37.49em)";
const EMPTY: SourceFormValues = { title: "", body: "" };
/** Limit czasu zapisu nowego źródła: po nim wynik jest niepewny, a ponowienie wysyła to samo polecenie. */
const CREATE_TIMEOUT_MS = 30_000;

export interface SourcesPanelProps {
  route: ParentRoute;
  onNavigate: (route: ParentRoute, options?: { replace?: boolean }) => void;
  registerEditorState: (state: EditorLeaveState) => void;
}

/**
 * Sekcja „Źródła” (design 2026-10-30 §3.4): lista źródeł z nowym źródłem,
 * a według adresu (`/parent/sources/{id}`) — strona źródła.
 */
export default function SourcesPanel({ route, onNavigate, registerEditorState }: SourcesPanelProps) {
  if (route.sourceId !== undefined) {
    return <SourcePage key={route.sourceId} sourceId={route.sourceId} onNavigate={onNavigate} registerEditorState={registerEditorState} />;
  }
  return <SourceList onNavigate={onNavigate} registerEditorState={registerEditorState} />;
}

/**
 * Lista źródeł (tytuł, data zmiany, liczba zestawów) i okno nowego źródła.
 * Zapis z kluczem idempotencji: niepewna odpowiedź zostawia polecenie do
 * ponowienia (ten sam `clientRequestId`), a pola są wtedy zablokowane —
 * ponowienie wysyła dokładnie to, co widać. Wpisany tekst chroni leave guard.
 */
function SourceList({ onNavigate, registerEditorState }: Omit<SourcesPanelProps, "route">) {
  const compact = useMediaQuery(COMPACT_QUERY, false, { getInitialValueInEffect: false }) ?? false;
  const queryClient = useQueryClient();
  const list = useQuery(orpc.sources.list.queryOptions());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [values, setValues] = useState<SourceFormValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<SourceMaterialInput | null>(null);
  const creatingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const create = useMutation({
    mutationFn: (command: SourceMaterialInput) =>
      callParent(() => parentClient.sources.create(command, { signal: AbortSignal.timeout(CREATE_TIMEOUT_MS) })),
  });
  const creating = create.isPending;
  const hasPending = pending.current !== null;
  const dirty = hasPending || values.title.trim() !== "" || values.body.trim() !== "";

  useEffect(() => {
    registerEditorState({ dirty, busy: creating });
  }, [registerEditorState, dirty, creating]);
  useEffect(() => () => registerEditorState({ dirty: false, busy: false }), [registerEditorState]);

  const submit = async (): Promise<void> => {
    if (creatingRef.current) return;
    let command = pending.current;
    if (!command) {
      if (!sourceValuesValid(values)) return;
      command = newSourceCommand(values);
      pending.current = command;
    }
    creatingRef.current = true;
    setError(null);
    try {
      const created = await create.mutateAsync(command);
      pending.current = null;
      void queryClient.invalidateQueries({ queryKey: orpc.sources.list.queryKey() });
      if (!mounted.current) return;
      setValues(EMPTY);
      setDialogOpen(false);
      // zapisane źródło nie jest już niezapisaną zmianą — przejście do jego strony nie pyta o wyjście
      registerEditorState({ dirty: false, busy: false });
      onNavigate({ section: "sources", sourceId: created.body.id });
    } catch (cause) {
      const status = httpStatusOf(cause);
      if (isUncertainFailure(status)) {
        if (mounted.current) setError(messages.sources.createUncertain);
      } else {
        pending.current = null;
        // 401: logowanie otwiera globalny handler, wpisany tekst zostaje
        if (status !== 401 && mounted.current) setError(errorMessage(cause));
      }
    } finally {
      creatingRef.current = false;
    }
  };

  const newSourceButton = (
    <Button
      size={compact ? "lg" : "md"}
      radius="lg"
      leftSection={<ParentIcon name="plus" />}
      data-testid="new-source-open"
      className={compact ? "pp-decks-fab" : undefined}
      onClick={() => setDialogOpen(true)}
    >
      {messages.sources.newSource}
    </Button>
  );

  const sources = list.data ?? [];

  return (
    <Stack component="section" gap="lg" data-testid="sources-panel">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Title order={1} fz={26}>{messages.sources.tab}</Title>
        {!compact && newSourceButton}
      </Group>

      {list.isPending && (
        <Center py="xl" role="status">
          <Group gap="sm"><Loader size="sm" /><Text>{messages.parentShell.loading}</Text></Group>
        </Center>
      )}
      {list.isError && (
        <Alert color="red" variant="light" role="alert" data-testid="sources-load-error">
          <Stack gap="sm" align="flex-start">
            <Text size="sm">{errorMessage(list.error)}</Text>
            <Button size="md" variant="light" color="red" onClick={() => void list.refetch()}>{messages.parentShell.retry}</Button>
          </Stack>
        </Alert>
      )}
      {list.isSuccess && sources.length === 0 && <Text className="pp-decks-muted" data-testid="sources-empty">{messages.sources.empty}</Text>}

      {sources.length > 0 && (
        <Stack gap="xs" component="ul" className="pp-decks-list">
          {sources.map((source, index) => (
            <Paper key={source.id} component="li" radius="lg" withBorder className="pp-decks-card">
              <UnstyledButton
                className="pp-decks-row"
                data-testid={`source-row-${index}`}
                data-source-id={source.id}
                onClick={() => onNavigate({ section: "sources", sourceId: source.id })}
              >
                <ThemeIcon size={40} radius="md" variant="light" color="teal" aria-hidden="true">
                  <ParentIcon name="file-text" className="pp-decks-kind-icon" />
                </ThemeIcon>
                <Box className="pp-decks-body">
                  <Text fw={600} className="pp-decks-title">{source.title}</Text>
                  <Text size="sm" className="pp-decks-muted">
                    {[messages.sources.updatedAt.replace("{date}", formatSourceDate(source.updatedAt)), deckCountLabel(source.deckCount)].join(" · ")}
                  </Text>
                </Box>
                <ParentIcon name="chevron-right" className="pp-decks-chevron" />
              </UnstyledButton>
            </Paper>
          ))}
        </Stack>
      )}

      {compact && (
        <Affix position={{ right: 16, bottom: "calc(88px + env(safe-area-inset-bottom))" }} zIndex={150}>
          {newSourceButton}
        </Affix>
      )}

      <Modal
        opened={dialogOpen}
        onClose={() => { if (!creatingRef.current) setDialogOpen(false); }}
        title={messages.sources.newSource}
        fullScreen={compact}
        centered
        radius={compact ? 0 : "lg"}
        size="lg"
        closeOnEscape={!creating}
        closeOnClickOutside={!creating}
        closeButtonProps={{ "aria-label": messages.sources.newSourceClose, "data-testid": "new-source-close", disabled: creating } as Record<string, unknown>}
        attributes={{ content: { "data-testid": "new-source-dialog" } }}
      >
        <Stack gap="md" className="pp-editor">
          <SourceFields values={values} onChange={setValues} disabled={creating || hasPending} autoFocusTitle />
          {error && (
            <Alert color="red" variant="light" role="alert" data-testid="api-error" icon={<ParentIcon name="alert-triangle" />}>
              {error}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button size="md" variant="default" data-testid="source-create-cancel" disabled={creating} onClick={() => setDialogOpen(false)}>
              {messages.sources.cancel}
            </Button>
            <Button
              size="md"
              data-testid="source-create-submit"
              leftSection={creating ? <Loader size={16} color="currentColor" /> : undefined}
              disabled={creating || (!hasPending && !sourceValuesValid(values))}
              onClick={() => void submit()}
            >
              {creating ? messages.sources.creating : hasPending ? messages.sources.retryCreate : messages.sources.create}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
