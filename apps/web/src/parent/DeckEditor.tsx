"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  messages,
  AssignmentPutSchema,
  type ChildDto,
  type DeckDto,
  type DraftDto,
  type VisualType,
} from "@learning/contracts";
import {
  createEditorSnapshot,
  createNewEditableItem,
  sameEditableItem,
  toDraftPatch,
  type EditableDeckForm,
  type EditorSnapshot,
} from "./deck-editor-state";
import { callParent, errorMessage, parentClient } from "./api";
import { orpc } from "./query-client";
import AssignmentTestGoalFields, { type AssignmentTestSettings } from "./AssignmentTestGoalFields";
import DeckSessionTaskBudgetSettings from "./DeckSessionTaskBudgetSettings";
import type { EditorLeaveState } from "./useParentLeaveGuard";
import DeckConflictPanel, { type EditorConflict } from "./DeckConflictPanel";
import { DeckCoverSettings } from "./DeckCoverSettings";
import { DeckAssignmentsList } from "./DeckAssignmentsList";

const VISUAL_TYPES: VisualType[] = ["image", "color", "number", "sequence", "none"];

/** Odpytywanie co sekundę tylko wtedy, gdy trwa generowanie albo media czekają. */
export function deckPollInterval(deck: DeckDto | undefined): number | false {
  if (!deck) return false;
  const generating = deck.generation?.state === "queued" || deck.generation?.state === "running";
  const visible = deck.draft ?? deck.published;
  const assetsPending = visible?.assets.some((asset) => asset.state === "pending") ?? false;
  return generating || assetsPending ? 1000 : false;
}

/** DTO używa "approved", katalog komunikatów kluczem "ready". */
function mediaStateText(catalogue: Record<string, string>, state: string): string {
  return catalogue[state === "approved" ? "ready" : state] ?? "";
}

/**
 * Przegląd i edycja jednego zestawu: szkic z generacji, poprawki słów
 * i wariantów, podgląd audio/obrazów, świadome pominięcie obrazu, publikacja
 * i przypisania dzieci. Polling prowadzi dalej po odświeżeniu strony;
 * kosztowna regeneracja wymaga zawsze jawnego kliknięcia.
 *
 * Dane (plan 2026-10-29-parent-ui-mantine, faza 5a): `decks.get` przez
 * TanStack Query z `refetchInterval`, polecenia przez jedną mutację (401 łapie
 * globalny handler, po sukcesie odświeża się lista zestawów). Stan `deck`
 * pozostaje lokalną bazą formularza: odczyt z zapytania trafia do niej tylko
 * bez niezapisanych zmian i bez konfliktu wersji.
 */
export default function DeckEditor({
  deckId,
  childrenList,
  onBack,
  onEditorStateChange,
}: {
  deckId: string;
  childrenList: ChildDto[];
  onBack: () => void;
  onEditorStateChange: (state: EditorLeaveState) => void;
}) {
  const [deck, setDeck] = useState<DeckDto | null>(null);
  const [form, setForm] = useState<EditableDeckForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [conflict, setConflict] = useState<EditorConflict | null>(null);
  const [remoteApplied, setRemoteApplied] = useState(false);
  const [assignDates, setAssignDates] = useState<Record<string, string>>({});
  const [assignSettings, setAssignSettings] = useState<Record<string, AssignmentTestSettings>>({});
  const [unassigningChildId, setUnassigningChildId] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  // Budżet sesji nauki (decks.session_task_budget): null = bez lokalnej zmiany,
  // wartość z DTO obowiązuje. Zapis osobnym PATCH, poza szkicem wersji.
  const [sessionBudgetEdit, setSessionBudgetEdit] = useState<number | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [generatedCover, setGeneratedCover] = useState<{ objectUrl: string; file: File } | null>(null);
  const generatedCoverRef = useRef<{ objectUrl: string; file: File } | null>(null);
  const coverGenerationToken = useRef(0);
  const [coverGenerating, setCoverGenerating] = useState(false);
  const assignmentSettings = (childId: string): AssignmentTestSettings => {
    const existing = deck?.assignments.find(a => a.childId === childId);
    return assignSettings[childId] ?? { testGoals: existing?.testGoals ?? null, mockTestTaskCount: existing?.mockTestTaskCount ?? 10 };
  };
  const dirty = useRef(false);
  const conflictActive = useRef(false);
  const busyRef = useRef(false);
  const baseSnapshot = useRef<EditorSnapshot | null>(null);
  const baseRevisionIds = useRef(new Map<string, string>());
  const deckIdRef = useRef(deckId);
  deckIdRef.current = deckId;
  const newKey = useCallback(() => crypto.randomUUID(), []);
  const queryClient = useQueryClient();

  // Polecenia edytora idą przez mutację TanStack: 401 obsługuje globalny
  // handler (logowanie w oknie przy niezapisanych zmianach), a sukces odświeża
  // listę zestawów. Każde wywołanie ma własną obietnicę i obsługę błędu.
  const command = useMutation({
    mutationFn: (call: () => Promise<unknown>) => callParent(call),
    // w tle — polecenie nie czeka na pobranie listy (zwrócona obietnica wstrzymałaby mutateAsync)
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: orpc.decks.list.queryKey() }); },
  });
  const { mutateAsync } = command;
  const run = useCallback(<T,>(call: () => Promise<T>): Promise<T> => mutateAsync(call) as Promise<T>, [mutateAsync]);

  const clearGeneratedCover = () => {
    coverGenerationToken.current += 1;
    const current = generatedCoverRef.current;
    if (current) URL.revokeObjectURL(current.objectUrl);
    generatedCoverRef.current = null;
    setGeneratedCover(null);
  };

  useEffect(() => {
    clearGeneratedCover();
    setCoverBusy(false);
    setCoverGenerating(false);
    setSessionBudgetEdit(null);
  }, [deckId]);

  useEffect(() => () => {
    const current = generatedCoverRef.current;
    if (current) URL.revokeObjectURL(current.objectUrl);
  }, []);

  const uploadCover = async (file: File | undefined, acceptingProposal = false): Promise<boolean> => {
    if (!file || !deck) return false;
    if (!acceptingProposal) clearGeneratedCover();
    if (file.size > 5 * 1024 * 1024) {
      setError(messages.decks.coverTooLarge);
      return false;
    }
    const requestDeckId = deck.id;
    const contentType = file.type || ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[file.name.split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream");
    setCoverBusy(true);
    setError(null);
    try {
      const result = await run(() => parentClient.decks.setCover({
        params: { deckId },
        headers: { "content-type": contentType },
        // File (Blob) przepuszczany przez serializator linku; serwer czyta
        // strumień z limitem 5 MB i anulowaniem (kontrakt: octet-stream).
        body: file,
      }));
      if (deckIdRef.current === requestDeckId) {
        setDeck((current) => current?.id === requestDeckId ? { ...current, coverAssetId: result.coverAssetId } : current);
      }
      if (acceptingProposal) clearGeneratedCover();
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setCoverBusy(false);
    }
  };

  const removeCover = async () => {
    if (!deck) return;
    clearGeneratedCover();
    const requestDeckId = deck.id;
    setCoverBusy(true);
    setError(null);
    try {
      await run(() => parentClient.decks.clearCover({ deckId }));
      if (deckIdRef.current === requestDeckId) {
        setDeck((current) => current?.id === requestDeckId ? { ...current, coverAssetId: null } : current);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCoverBusy(false);
    }
  };
  const generateCover = async () => {
    if (!deck) return;
    const requestDeckId = deck.id;
    clearGeneratedCover();
    const requestToken = coverGenerationToken.current;
    setCoverBusy(true); setCoverGenerating(true); setError(null);
    try {
      const output = await run(() => parentClient.decks.generateCover({ deckId: requestDeckId }));
      const blob = output.body;
      if (deckIdRef.current !== requestDeckId || coverGenerationToken.current !== requestToken) return;
      const mimeType = typeof output.headers?.["content-type"] === "string" ? output.headers["content-type"] : blob.type;
      const objectUrl = URL.createObjectURL(blob);
      const file = new File([blob], `generated-cover.${mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1]}`, { type: mimeType });
      generatedCoverRef.current = { objectUrl, file };
      setGeneratedCover(generatedCoverRef.current);
    } catch (cause) { if (deckIdRef.current === requestDeckId && coverGenerationToken.current === requestToken) setError(errorMessage(cause)); }
    finally { if (deckIdRef.current === requestDeckId && coverGenerationToken.current === requestToken) { setCoverBusy(false); setCoverGenerating(false); } }
  };
  const acceptGeneratedCover = async () => {
    if (!generatedCover) return;
    await uploadCover(generatedCover.file, true);
  };
  const setBusyState = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
    onEditorStateChange({ dirty: dirty.current, busy: value });
  };
  const markDirty = () => {
    dirty.current = true;
    setIsDirty(true);
    onEditorStateChange({ dirty: true, busy: busyRef.current });
  };

  useEffect(() => {
    onEditorStateChange({ dirty: isDirty || conflict !== null, busy });
    return () => onEditorStateChange({ dirty: false, busy: false });
  }, [onEditorStateChange, isDirty, busy, conflict]);

  // Odczyt zestawu. Bez ponowień: błąd pokazujemy od razu, a trwające
  // generowanie i tak odpyta serwer ponownie za sekundę.
  // Odstęp liczony z lokalnej bazy formularza (jak dawny setInterval): przy
  // niezapisanych zmianach baza jest zamrożona, więc odpytywanie trwa, dopóki
  // pokazany stan ma oczekujące media — odpowiedzi nie zmieniają jednak bazy.
  const deckQuery = useQuery({
    ...orpc.decks.get.queryOptions({ input: { deckId } }),
    retry: false,
    refetchInterval: deckPollInterval(deck ?? undefined),
  });

  // nowe dane zasilają bazę formularza tylko bez niezapisanych zmian i konfliktu
  useEffect(() => {
    if (deckQuery.data && !dirty.current && !conflictActive.current) setDeck(deckQuery.data);
  }, [deckQuery.data]);

  // Błąd odczytu po poleceniu obsługuje samo polecenie (np. „zapisano, ale nie
  // udało się odświeżyć”); efekt pokazuje tylko błędy pierwszego odczytu i odpytywania.
  const manualLoads = useRef(0);
  const handledErrorAt = useRef(0);
  useEffect(() => {
    if (!deckQuery.error || manualLoads.current > 0 || deckQuery.errorUpdatedAt === handledErrorAt.current) return;
    if (!dirty.current && !conflictActive.current) setError(errorMessage(deckQuery.error));
  }, [deckQuery.error, deckQuery.errorUpdatedAt]);

  /** Ponowny odczyt po poleceniu; `false` = odczyt się nie udał (dane mogły się zmienić). */
  const { refetch } = deckQuery;
  const load = useCallback(async (): Promise<boolean> => {
    manualLoads.current += 1;
    try {
      const result = await refetch();
      if (!result.isError) return true;
      handledErrorAt.current = result.errorUpdatedAt;
      if (!dirty.current && !conflictActive.current) setError(errorMessage(result.error));
      return false;
    } finally {
      manualLoads.current -= 1;
    }
  }, [refetch]);

  /** Świeży odczyt zestawu poza bazą formularza (porównanie przy konflikcie wersji). */
  const fetchRemote = useCallback(
    () => queryClient.fetchQuery({ ...orpc.decks.get.queryOptions({ input: { deckId } }), retry: false, staleTime: 0 }),
    [queryClient, deckId],
  );

  const refreshConflict = useCallback(async (local: EditorSnapshot) => {
    conflictActive.current = true;
    setConflict({ local, remote: null, loadError: null });
    try {
      const remote = await fetchRemote();
      setConflict((current) => current ? { ...current, remote, loadError: null } : current);
      setError(null);
    } catch {
      setConflict((current) => current ? { ...current, loadError: messages.decks.conflictLoadFailed } : current);
      setError(messages.decks.conflictDetected);
    }
  }, [fetchRemote]);

  const applyRemoteConflict = async (remote: DeckDto) => {
    setBusyState(true);
    setError(null);
    try {
      let current = remote;
      if (!current.draft && current.published) {
        await run(() => parentClient.decks.createDraft({ deckId }));
        current = await fetchRemote();
      }
      if (!current.draft) {
        setConflict((existing) => existing ? { ...existing, remote: current, loadError: messages.decks.conflictNotFound } : existing);
        return;
      }
      const snapshot = createEditorSnapshot(current.draft, newKey);
      baseSnapshot.current = snapshot;
      baseRevisionIds.current = new Map(current.draft.items.flatMap((item) => item.id ? [[item.id, item.revisionId] as const] : []));
      setDeck(current);
      setForm(snapshot.form);
      dirty.current = false;
      setIsDirty(false);
      setRemoteApplied(true);
      setConflict((existing) => existing ? { ...existing, remote: current, loadError: null } : existing);
    } catch (cause) {
      setConflict((existing) => existing ? { ...existing, loadError: errorMessage(cause) } : existing);
    } finally {
      setBusyState(false);
    }
  };

  const finishConflict = (remote: DeckDto) => {
    conflictActive.current = false;
    const latest = remote.draft ?? remote.published;
    setDeck(remote);
    if (remote.draft && latest) {
      baseSnapshot.current = createEditorSnapshot(remote.draft, newKey);
      baseRevisionIds.current = new Map(remote.draft.items.flatMap((item) => item.id ? [[item.id, item.revisionId] as const] : []));
      setForm(baseSnapshot.current.form);
    } else if (latest) {
      baseSnapshot.current = null;
      setForm(createEditorSnapshot(latest, newKey).form);
    } else {
      baseSnapshot.current = null;
      setForm(null);
    }
    dirty.current = false;
    setIsDirty(false);
    setRemoteApplied(false);
    setConflict(null);
    setError(null);
  };

  const draft = deck?.draft ?? null;
  const active = draft ?? deck?.published ?? null;
  const editable = draft !== null;

  const generating = deck?.generation?.state === "queued" || deck?.generation?.state === "running";

  // formularz podąża za widoczną wersją (szkic albo opublikowana do wglądu),
  // dopóki rodzic nie zaczął pisać
  useEffect(() => {
    if (!active || dirty.current) {
      return;
    }
    if (draft) {
      baseSnapshot.current = createEditorSnapshot(draft, newKey);
      baseRevisionIds.current = new Map(draft.items.flatMap((item) => item.id ? [[item.id, item.revisionId] as const] : []));
      setForm(baseSnapshot.current.form);
    } else {
      setForm(createEditorSnapshot(active, newKey).form);
    }
  }, [active, draft, newKey]);

  const mutate = (field: "source" | "target" | "accepted" | "example" | "title", value: string, index?: number) => {
    markDirty();
    setForm((current) => {
      if (!current) {
        return current;
      }
      if (field === "title") {
        return { ...current, title: value };
      }
      const items = current.items.map((item, position) =>
        position === index ? { ...item, [field]: value } : item,
      );
      return { ...current, items };
    });
  };

  const changeVisual = (index: number, visualType: VisualType) => {
    markDirty();
    setForm((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item, position) =>
              position === index ? { ...item, visualType } : item,
            ),
          }
        : current,
    );
  };

  // flaga promptu obrazka: zmiana zapisuje się z formularzem, a nowy
  // fingerprint zleci regenerację ilustracji dopiero po „Zapisz"
  const toggleExampleInImage = (index: number, checked: boolean) => {
    markDirty();
    setForm((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item, position) =>
              position === index
                ? { ...item, visualData: { ...item.visualData, includeExampleInImage: checked } }
                : item,
            ),
          }
        : current,
    );
  };

  // nowy element ląduje na końcu listy; bez id serwer tworzy learning_item
  // z kluczami umiejętności v1 i zleca media w tej samej transakcji zapisu
  const addItem = () => {
    markDirty();
    setForm((current) => {
      if (!current) {
        return current;
      }
      const locales = current.items[0]?.locales ?? { source: "pl-PL", target: "en-GB" };
      return {
        ...current,
        items: [...current.items, createNewEditableItem(locales, newKey)],
      };
    });
  };

  // usunięcie jest częścią formularza: obowiązuje dopiero po „Zapisz",
  // cofnięcie = wyjście bez zapisu; ostatniej karty nie da się usunąć
  const removeItem = (index: number) => {
    markDirty();
    setForm((current) =>
      current ? { ...current, items: current.items.filter((_, position) => position !== index) } : current,
    );
  };

  const save = async () => {
    const currentBase = baseSnapshot.current;
    if (!draft || !form || !currentBase || busyRef.current || !dirty.current || currentBase.draftId !== draft.id || (conflict !== null && !remoteApplied)) {
      return;
    }
    // pusta karta lub tytuł odrzuciłyby cały PATCH po stronie Zoda; blokujemy
    // lokalnie polskim komunikatem, żeby zapis innych poprawek nie utknął
    if (form.title.trim().length === 0) {
      setError(messages.decks.titleIncomplete);
      return;
    }
    if (form.items.length > 0 && form.items.some((item) => item.source.trim().length === 0 || item.target.trim().length === 0)) {
      setError(messages.decks.itemIncomplete);
      return;
    }
    const snapshot = { ...currentBase, form: structuredClone(form) };
    busyRef.current = true;
    setBusyState(true);
    setError(null);
    try {
      const saved = await run(() => parentClient.drafts.edit({ draftId: snapshot.draftId, ...toDraftPatch(snapshot) }));
      baseSnapshot.current = createEditorSnapshot(saved, newKey);
      baseRevisionIds.current = new Map(saved.items.flatMap((item) => item.id ? [[item.id, item.revisionId] as const] : []));
      setForm(baseSnapshot.current.form);
      dirty.current = false;
      onEditorStateChange({ dirty: false, busy: true });
      setIsDirty(false);
      setDeck((current) => current ? { ...current, draft: saved, title: saved.title } : current);
      setConflict((current) => current?.remote
        ? { ...current, remote: { ...current.remote, draft: saved, title: saved.title }, loadError: null }
        : current);
      if (!(await load())) {
        setError(messages.decks.savedRefreshFailed);
      }
    } catch (cause) {
      if (["conflict", "immutable"].includes((cause as { code?: string }).code ?? "")) {
        const localSnapshot = { ...snapshot, form: structuredClone(form) };
        setError(messages.decks.conflictDetected);
        setRemoteApplied(false);
        void refreshConflict(localSnapshot);
      } else {
        setError(errorMessage(cause));
        // wygasła sesja (401): globalny handler otwiera logowanie nad edytorem, formularz zostaje
      }
    } finally {
      setBusyState(false);
    }
  };

  const publish = async () => {
    if (!draft || busy || isDirty || conflict !== null || draft.items.length === 0) {
      return;
    }
    setBusyState(true);
    setError(null);
    try {
      await run(() => parentClient.drafts.publish({
        draftId: draft.id,
        expectedEditNumber: draft.editNumber,
      }));
      dirty.current = false;
      setIsDirty(false);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyState(false);
    }
  };

  const archive = async () => {
    setBusyState(true);
    setError(null);
    try {
      await run(() => parentClient.decks.archive({ deckId }));
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyState(false);
    }
  };

  // edycja opublikowanego materiału zaczyna się od nowego szkicu (SPEC §84):
  // opublikowana wersja prowadzi sesje dziecka do czasu publikacji nowej
  const startNewVersion = async () => {
    setBusyState(true);
    setError(null);
    try {
      await run(() => parentClient.decks.createDraft({ deckId }));
      dirty.current = false;
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyState(false);
    }
  };

  const retry = async () => {
    if (!deck?.generation) {
      return;
    }
    const runId = deck.generation.id;
    setError(null);
    try {
      await run(() => parentClient.generation.retry({ runId }));
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const regenerate = async (itemRevisionId: string, role: "target_audio" | "illustration") => {
    if (!draft) {
      return;
    }
    setError(null);
    try {
      await run(() => parentClient.drafts.regenerateAsset({
        draftId: draft.id,
        itemRevisionId,
        role,
      }));
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const omitIllustration = async (itemRevisionId: string) => {
    if (!draft || draft.vocabularyFormat === "picture") {
      return;
    }
    setError(null);
    try {
      await run(() => parentClient.drafts.omitAsset({ draftId: draft.id, itemRevisionId }));
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const playAsset = (assetId: string) => {
    const audio = new Audio(`/api/v1/media/${assetId}`);
    void audio.play().catch(() => undefined);
  };

  const assign = async (childId: string) => {
    setError(null);
    try {
      await run(() => parentClient.assignments.put({
        childId,
        deckId,
        testDate: (assignDates[childId] ?? deck?.assignments.find(a => a.childId === childId)?.testDate) || null,
        ...assignmentSettings(childId),
      }));
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const unassign = async (childId: string) => {
    if (!window.confirm(messages.decks.unassignConfirm)) return;
    setError(null);
    setUnassigningChildId(childId);
    try {
      await run(() => parentClient.assignments.remove({ childId, deckId }));
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setUnassigningChildId(null);
    }
  };

  const assetOf = (revisionId: string, role: string) =>
    active?.assets.find((asset) => asset.itemRevisionId === revisionId && asset.role === role) ?? null;

  return (
    <section>
      <div className="row space">
        <button type="button" data-testid="editor-back" onClick={onBack}>
          {messages.decks.back}
        </button>
        <h2>{deck?.title ?? ""}</h2>
        {deck?.state === "published" && (
          <span className="badge ok" data-testid="publish-status">
            {messages.decks.published}
          </span>
        )}
      </div>

      {generating && (
        <p className="info" data-testid="generation-banner">
          {messages.decks.generating}
        </p>
      )}
      {deck?.generation?.state === "failed" && (
        <p className="error" data-testid="generation-failed">
          {deck.generation.errorCode === "no_picture_material" ? messages.decks.noPictureMaterial : messages.decks.generationFailed}{" "}
          <button type="button" onClick={retry}>
            {messages.decks.retryGeneration}
          </button>
        </p>
      )}
      {error && (
        <p className="error" data-testid="api-error" role="alert">
          {error}
        </p>
      )}

      {deck && (
        <DeckCoverSettings coverAssetId={deck.coverAssetId} busy={coverBusy} generating={coverGenerating} generatedPreview={generatedCover?.objectUrl ?? null}
          onUpload={(file) => { void uploadCover(file); }} onRemove={() => { void removeCover(); }} onGenerate={() => { void generateCover(); }}
          onAcceptGenerated={() => { void acceptGeneratedCover(); }} onRejectGenerated={() => setGeneratedCover(null)} />
      )}

      {deck && (
        <DeckSessionTaskBudgetSettings
          deckId={deckId}
          value={sessionBudgetEdit ?? deck.sessionTaskBudget}
          edited={sessionBudgetEdit !== null}
          archived={deck.state === "archived"}
          busy={settingsBusy}
          onChange={setSessionBudgetEdit}
          onBusyChange={setSettingsBusy}
          onSaved={(savedDeckId, saved) => {
            // deckId żądania (z chwili kliknięcia zapisu), nie bieżący widok:
            // nawigacja do innego zestawu w locie nie wbije cudzej wartości.
            setSessionBudgetEdit(null);
            setDeck((current) =>
              current && current.id === savedDeckId ? { ...current, sessionTaskBudget: saved } : current,
            );
          }}
          onError={setError}
        />
      )}

      {conflict && (
        <DeckConflictPanel
          conflict={conflict}
          busy={busy}
          onRetry={() => void refreshConflict(conflict.local)}
          onLoadRemote={(remote) => void applyRemoteConflict(remote)}
          onDismissComparison={finishConflict}
        />
      )}

      {form && (
        <>
          <p data-testid="vocabulary-format">
            {messages.decks.vocabularyFormatLabel}: {form.vocabularyFormat === "picture"
              ? messages.decks.pictureVocabulary
              : messages.decks.standardVocabulary}
            {form.vocabularyFormat === "picture" && ` — ${messages.decks.pictureEditorHint}`}
          </p>
          <label>
            {messages.decks.titleLabel}
            <input
              data-testid="editor-title"
              value={form.title}
              disabled={!editable || busy}
              onChange={(event) => mutate("title", event.target.value)}
            />
          </label>
        </>
      )}

      {form?.items.map((item, index) => {
        const original = baseSnapshot.current?.form.items.find((baseItem) => baseItem.clientKey === item.clientKey);
        const itemUnchanged = original !== undefined && sameEditableItem(item, original);
        const revisionId = itemUnchanged && item.id ? baseRevisionIds.current.get(item.id) ?? "" : "";
        const targetAudio = assetOf(revisionId, "target_audio");
        const exampleAudio = assetOf(revisionId, "example_audio");
        const illustration = assetOf(revisionId, "illustration");
        return (
          <article className="card" key={item.clientKey} data-testid={`item-card-${index}`}>
            {editable && (
              <div className="row">
                <button
                  type="button"
                  data-testid={`item-remove-${index}`}
                  disabled={busy || (form?.items.length ?? 0) <= 1}
                  onClick={() => removeItem(index)}
                >
                  {messages.decks.removeItem}
                </button>
              </div>
            )}
            <div className="grid-2">
              <label>
                {messages.decks.sourceLabel}
                <input
                  data-testid={`item-source-${index}`}
                  value={item.source}
                  disabled={!editable || busy}
                  onChange={(event) => mutate("source", event.target.value, index)}
                />
              </label>
              <label>
                {messages.decks.targetLabel}
                <input
                  data-testid={`item-target-${index}`}
                  value={item.target}
                  disabled={!editable || busy}
                  onChange={(event) => mutate("target", event.target.value, index)}
                />
              </label>
            </div>
            <label>
              {messages.decks.acceptedLabel}
              <input
                data-testid={`item-accepted-${index}`}
                value={item.accepted}
                disabled={!editable || busy}
                onChange={(event) => mutate("accepted", event.target.value, index)}
              />
            </label>
            <label>
              {messages.decks.exampleLabel}
              <input
                data-testid={`item-example-${index}`}
                value={item.example}
                disabled={!editable || busy}
                onChange={(event) => mutate("example", event.target.value, index)}
              />
            </label>
            {item.visualType === "image" && item.example.trim().length > 0 && (
              <label>
                <input
                  type="checkbox"
                  data-testid={`item-example-in-image-${index}`}
                  checked={item.visualData?.includeExampleInImage === true}
                  disabled={!editable || busy}
                  onChange={(event) => toggleExampleInImage(index, event.target.checked)}
                />
                {messages.decks.exampleInImage}
              </label>
            )}
            <label>
              {messages.decks.visualLabel}
              <select
                data-testid={`item-visual-${index}`}
                value={item.visualType}
                disabled={!editable || busy}
                onChange={(event) => changeVisual(index, event.target.value as VisualType)}
              >
                {VISUAL_TYPES.filter((type) =>
                  form.vocabularyFormat !== "picture" || ["image", "color", "number"].includes(type),
                ).map((type) => (
                  <option key={type} value={type}>
                    {messages.decks.visualTypes[type]}
                  </option>
                ))}
              </select>
            </label>

            {targetAudio && (
              <div className="row">
                <span data-testid={`item-audio-state-${index}`}>
                  {mediaStateText(messages.decks.audioState, targetAudio.state)}
                </span>
                <button
                  type="button"
                  data-testid={`item-play-${index}`}
                  disabled={!(targetAudio.state === "approved" && targetAudio.assetId)}
                  onClick={() => targetAudio.assetId && playAsset(targetAudio.assetId)}
                >
                  {messages.decks.listen}
                </button>
                {editable && (
                  <button
                    type="button"
                    data-testid={`item-regen-audio-${index}`}
                    disabled={busy || isDirty}
                    onClick={() => regenerate(revisionId, "target_audio")}
                  >
                    {messages.decks.regenerateAudio}
                  </button>
                )}
              </div>
            )}
            {exampleAudio && (
              <div className="row">
                <span data-testid={`item-example-audio-state-${index}`}>
                  {mediaStateText(messages.decks.audioState, exampleAudio.state)}
                </span>
                <button
                  type="button"
                  data-testid={`item-play-example-${index}`}
                  disabled={!(exampleAudio.state === "approved" && exampleAudio.assetId)}
                  onClick={() => exampleAudio.assetId && playAsset(exampleAudio.assetId)}
                >
                  {messages.decks.listen}
                </button>
              </div>
            )}
            {illustration && (
              <div>
                {illustration.state === "approved" && illustration.assetId && (
                  <img
                    className="illustration"
                    data-testid={`item-image-${index}`}
                    src={`/api/v1/media/${illustration.assetId}`}
                    alt={item.target}
                  />
                )}
                <div className="row">
                  <span data-testid={`item-image-state-${index}`}>
                    {mediaStateText(messages.decks.imageState, illustration.state)}
                  </span>
                  {editable && form.vocabularyFormat !== "picture" && illustration.state !== "omitted" && (
                    <button
                      type="button"
                      data-testid={`item-omit-image-${index}`}
                      disabled={busy || isDirty}
                      onClick={() => omitIllustration(revisionId)}
                    >
                      {messages.decks.omitImage}
                    </button>
                  )}
                  {editable && (
                    <button
                      type="button"
                      data-testid={`item-regen-image-${index}`}
                      disabled={busy || isDirty}
                      onClick={() => regenerate(revisionId, "illustration")}
                    >
                      {messages.decks.regenerateImage}
                    </button>
                  )}
                </div>
              </div>
            )}
          </article>
        );
      })}

      {editable && (
        form?.items.length === 0 && !generating ? (
          <p className="info" data-testid="empty-draft">{messages.decks.emptyDraft}</p>
        ) : null
      )}

      {editable && (
        <div className="row">
          <button type="button" data-testid="add-item" onClick={addItem} disabled={busy}>
            {messages.decks.addItem}
          </button>
        </div>
      )}

      {deck?.state === "published" && !draft && (
        <div className="row">
          <button type="button" data-testid="new-version" onClick={startNewVersion} disabled={busy}>
            {messages.decks.newVersion}
          </button>
        </div>
      )}

      {editable && (
        <div className="row">
          <button type="button" data-testid="save-items" onClick={save} disabled={busy || (conflict !== null && !remoteApplied)}>
            {messages.decks.save}
          </button>
          <button type="button" data-testid="publish-deck" onClick={publish} disabled={busy || isDirty || conflict !== null || (draft?.items.length ?? 0) === 0}>
            {messages.decks.publish}
          </button>
          <button type="button" data-testid="archive-deck" onClick={archive} disabled={busy || conflict !== null}>
            {messages.decks.archive}
          </button>
        </div>
      )}

      {editable && (isDirty || (draft?.items.length ?? 0) === 0) && (
        <p className="info" data-testid="publish-blocked-reason">
          {isDirty && (form?.items.length ?? 0) > 0 ? messages.decks.saveBeforePublish : messages.decks.emptyPublish}
        </p>
      )}

      {deck?.state === "published" && (
        <section className="card">
          <h3>{messages.decks.assignTitle}</h3>
          {childrenList.map((child, index) => (
            <div className="row space" key={child.id} data-testid={`assign-row-${index}`}>
              <span data-child-id={child.id}>{child.displayName}</span>
              {child.canRead === false && deck.published?.vocabularyFormat !== "picture" && <p className="info" data-testid={`non-reader-assignment-warning-${index}`}>{messages.decks.nonReaderStandardAssignment}</p>}
              <input
                type="date"
                data-testid={`assign-date-${index}`}
                aria-label={`${messages.decks.assignDate} ${child.displayName}`}
                value={assignDates[child.id] ?? deck.assignments.find(a => a.childId === child.id)?.testDate ?? ""}
                onChange={(event) =>
                  setAssignDates((current) => ({ ...current, [child.id]: event.target.value }))
                }
              />
              <button type="button" data-testid={`assign-submit-${index}`} disabled={!AssignmentPutSchema.safeParse({ testDate: null, ...assignmentSettings(child.id) }).success} onClick={() => assign(child.id)}>
                {messages.decks.assign}
              </button>
              <AssignmentTestGoalFields {...assignmentSettings(child.id)} onChange={value => setAssignSettings(current => ({ ...current, [child.id]: value }))} />
            </div>
          ))}
          <DeckAssignmentsList assignments={deck.assignments} onUnassign={unassign} busyChildId={unassigningChildId} />
        </section>
      )}
    </section>
  );
}
