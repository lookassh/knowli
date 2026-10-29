"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Menu,
  NativeSelect,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  messages,
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
import type { AssignmentTestSettings } from "./AssignmentTestGoalFields";
import DeckSessionTaskBudgetSettings from "./DeckSessionTaskBudgetSettings";
import type { EditorLeaveState } from "./useParentLeaveGuard";
import DeckConflictPanel, { type EditorConflict } from "./DeckConflictPanel";
import { DeckCoverSettings } from "./DeckCoverSettings";
import { ParentIcon } from "./ParentIcon";
import { runOnce } from "./run-once";
import { polishPlural } from "./deck-list-grouping";
import { formatFamilyDate } from "./family-date";
import { EditorActionBar, EditorAssignments, EditorErrorText } from "./EditorAssignments";
import "./deck-editor.css";

const VISUAL_TYPES: VisualType[] = ["image", "color", "number", "sequence", "none"];

/** Odpytywanie co sekundę tylko wtedy, gdy trwa generowanie albo media czekają. */
export function deckPollInterval(deck: DeckDto | undefined): number | false {
  if (!deck) return false;
  const generating = deck.generation?.state === "queued" || deck.generation?.state === "running";
  const visible = deck.draft ?? deck.published;
  const assetsPending = visible?.assets.some((asset) => asset.state === "pending") ?? false;
  return generating || assetsPending ? 1000 : false;
}

/** Kolor odznaki stanu medium (zmienne --pp-status-* z motywu). */
function mediaTone(state: string): "success" | "info" | "danger" | "neutral" {
  if (state === "approved") return "success";
  if (state === "pending") return "info";
  if (state === "failed") return "danger";
  return "neutral";
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
  // błędy przy sekcji, której dotyczą (szkic 5b): okładka, liczba pytań, media karty, przypisanie dziecka
  const [coverError, setCoverError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<{ key: string; message: string } | null>(null);
  const [assignErrors, setAssignErrors] = useState<Record<string, string>>({});
  const setAssignError = (childId: string, message: string | null) =>
    setAssignErrors((current) => {
      const next = { ...current };
      if (message) next[childId] = message; else delete next[childId];
      return next;
    });
  const compact = useMediaQuery("(max-width: 37.49em)", false, { getInitialValueInEffect: false });
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
      setCoverError(messages.decks.coverTooLarge);
      return false;
    }
    const requestDeckId = deck.id;
    const contentType = file.type || ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[file.name.split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream");
    setCoverBusy(true);
    setCoverError(null);
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
      setCoverError(errorMessage(cause));
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
    setCoverError(null);
    try {
      await run(() => parentClient.decks.clearCover({ deckId }));
      if (deckIdRef.current === requestDeckId) {
        setDeck((current) => current?.id === requestDeckId ? { ...current, coverAssetId: null } : current);
      }
    } catch (cause) {
      setCoverError(errorMessage(cause));
    } finally {
      setCoverBusy(false);
    }
  };
  const generateCover = async () => {
    if (!deck) return;
    const requestDeckId = deck.id;
    clearGeneratedCover();
    const requestToken = coverGenerationToken.current;
    setCoverBusy(true); setCoverGenerating(true); setCoverError(null);
    try {
      const output = await run(() => parentClient.decks.generateCover({ deckId: requestDeckId }));
      const blob = output.body;
      if (deckIdRef.current !== requestDeckId || coverGenerationToken.current !== requestToken) return;
      const mimeType = typeof output.headers?.["content-type"] === "string" ? output.headers["content-type"] : blob.type;
      const objectUrl = URL.createObjectURL(blob);
      const file = new File([blob], `generated-cover.${mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1]}`, { type: mimeType });
      generatedCoverRef.current = { objectUrl, file };
      setGeneratedCover(generatedCoverRef.current);
    } catch (cause) { if (deckIdRef.current === requestDeckId && coverGenerationToken.current === requestToken) setCoverError(errorMessage(cause)); }
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

  // Odczyt zestawu (TanStack Query). Odpowiedź trafia do lokalnej bazy
  // formularza w chwili nadejścia — w funkcji zapytania, z warunkami dawnego
  // `load()` sprawdzanymi wtedy, a nie w efekcie po renderze (efekt nie
  // odpaliłby się przy danych identycznych z pamięcią podręczną i widziałby
  // stan `dirty` z późniejszej chwili). Odpowiedź anulowanego odczytu
  // (`refetch()` po poleceniu anuluje trwające odpytanie) nie trafia nigdzie,
  // jak dawniej dzięki wersji żądania.
  const manualLoads = useRef(0);
  const arrival = useRef({ data: (_: DeckDto) => {}, error: (_: unknown) => {} });
  arrival.current = {
    data: (result) => {
      if (!dirty.current && !conflictActive.current) setDeck(result);
    },
    // błąd odczytu po poleceniu obsługuje samo polecenie (np. „zapisano, ale
    // nie udało się odświeżyć”); tu tylko pierwszy odczyt i odpytywanie
    error: (cause) => {
      if (manualLoads.current === 0 && !dirty.current && !conflictActive.current) setError(errorMessage(cause));
    },
  };
  const deckOptions = orpc.decks.get.queryOptions({ input: { deckId } });
  const baseQueryFn = deckOptions.queryFn!;
  const deckQuery = useQuery({
    ...deckOptions,
    queryFn: async (context) => {
      try {
        const result = await baseQueryFn(context);
        if (!context.signal.aborted) arrival.current.data(result);
        return result;
      } catch (cause) {
        if (!context.signal.aborted) arrival.current.error(cause);
        throw cause;
      }
    },
    retry: false,
    // ponowne otwarcie zestawu zaczyna od świeżego odczytu, nie od pamięci podręcznej
    gcTime: 0,
    // Odstęp liczony z lokalnej bazy formularza (jak dawny setInterval): przy
    // niezapisanych zmianach baza jest zamrożona, więc odpytywanie trwa, dopóki
    // pokazany stan ma oczekujące media — odpowiedzi nie zmieniają jednak bazy.
    refetchInterval: deckPollInterval(deck ?? undefined),
    refetchIntervalInBackground: true,
  });

  /** Ponowny odczyt po poleceniu; `false` = odczyt się nie udał (dane mogły się zmienić). */
  const { refetch } = deckQuery;
  const load = useCallback(async (): Promise<boolean> => {
    manualLoads.current += 1;
    try {
      const result = await refetch();
      if (!result.isError) return true;
      if (!dirty.current && !conflictActive.current) setError(errorMessage(result.error));
      return false;
    } finally {
      manualLoads.current -= 1;
    }
  }, [refetch]);

  /**
   * Świeży odczyt zestawu poza bazą formularza (porównanie przy konflikcie).
   * Trwające odpytanie jest najpierw anulowane — inaczej `fetchQuery` zwróciłby
   * jego (starszą) odpowiedź zamiast nowego odczytu.
   */
  const fetchRemote = useCallback(async () => {
    const options = orpc.decks.get.queryOptions({ input: { deckId } });
    await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
    return queryClient.fetchQuery({ ...options, retry: false, staleTime: 0, gcTime: 0 });
  }, [queryClient, deckId]);

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
      // nowe klucze kart po zapisie: błąd mediów sprzed zapisu nie wisi pod inną kartą
      setMediaError(null);
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

  const regenerate = async (itemRevisionId: string, role: "target_audio" | "illustration", itemKey: string) => {
    if (!draft) {
      return;
    }
    setMediaError(null);
    try {
      await run(() => parentClient.drafts.regenerateAsset({
        draftId: draft.id,
        itemRevisionId,
        role,
      }));
      await load();
    } catch (cause) {
      setMediaError({ key: itemKey, message: errorMessage(cause) });
    }
  };

  const omitIllustration = async (itemRevisionId: string, itemKey: string) => {
    if (!draft || draft.vocabularyFormat === "picture") {
      return;
    }
    setMediaError(null);
    try {
      await run(() => parentClient.drafts.omitAsset({ draftId: draft.id, itemRevisionId }));
      await load();
    } catch (cause) {
      setMediaError({ key: itemKey, message: errorMessage(cause) });
    }
  };

  const playAsset = (assetId: string) => {
    const audio = new Audio(`/api/v1/media/${assetId}`);
    void audio.play().catch(() => undefined);
  };

  const assign = async (childId: string) => {
    setAssignError(childId, null);
    try {
      await run(() => parentClient.assignments.put({
        childId,
        deckId,
        testDate: (assignDates[childId] ?? deck?.assignments.find(a => a.childId === childId)?.testDate) || null,
        ...assignmentSettings(childId),
      }));
      await load();
    } catch (cause) {
      setAssignError(childId, errorMessage(cause));
    }
  };

  const unassign = async (childId: string) => {
    setAssignError(childId, null);
    setUnassigningChildId(childId);
    try {
      await run(() => parentClient.assignments.remove({ childId, deckId }));
      await load();
    } catch (cause) {
      setAssignError(childId, errorMessage(cause));
    } finally {
      setUnassigningChildId(null);
    }
  };

  const assetOf = (revisionId: string, role: string) =>
    active?.assets.find((asset) => asset.itemRevisionId === revisionId && asset.role === role) ?? null;

  // okna potwierdzeń żyją nad edytorem (ModalsProvider): wyjście z edytora
  // (np. „wstecz”) zamyka je, żeby nie zarchiwizować opuszczonego zestawu
  const confirmIds = useRef<string[]>([]);
  useEffect(() => () => {
    for (const id of confirmIds.current) modals.close(id);
  }, []);

  const confirmArchive = () => {
    confirmIds.current.push(modals.openConfirmModal({
      title: messages.decks.archiveConfirmTitle,
      centered: true,
      radius: "lg",
      children: <Text size="sm">{messages.decks.archiveConfirm}</Text>,
      labels: { confirm: messages.decks.archive, cancel: messages.decks.archiveCancel },
      confirmProps: { color: "red", size: "md", "data-testid": "archive-confirm" } as Record<string, unknown>,
      cancelProps: { size: "md", variant: "default", "data-autofocus": true } as Record<string, unknown>,
      onConfirm: runOnce(() => { void archive(); }),
    }));
  };

  const confirmUnassign = (childId: string) => {
    confirmIds.current.push(modals.openConfirmModal({
      title: messages.decks.unassignTitle,
      centered: true,
      radius: "lg",
      children: <Text size="sm">{messages.decks.unassignConfirm}</Text>,
      labels: { confirm: messages.decks.unassign, cancel: messages.decks.archiveCancel },
      confirmProps: { color: "red", size: "md", "data-testid": "unassign-confirm" } as Record<string, unknown>,
      cancelProps: { size: "md", variant: "default", "data-autofocus": true } as Record<string, unknown>,
      onConfirm: runOnce(() => { void unassign(childId); }),
    }));
  };

  const publishBlocked = editable && (isDirty || (draft?.items.length ?? 0) === 0);
  const showActionBar = editable || (deck?.state === "published" && !draft);
  const itemCount = form?.items.length ?? 0;
  const errorAlert = <EditorErrorText error={error ?? ""} />;

  const settings = deck && (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
      <Paper withBorder radius="lg" p="md">
        <DeckCoverSettings coverAssetId={deck.coverAssetId} busy={coverBusy} generating={coverGenerating} generatedPreview={generatedCover?.objectUrl ?? null}
          error={coverError}
          onUpload={(file) => { void uploadCover(file); }} onRemove={() => { void removeCover(); }} onGenerate={() => { void generateCover(); }}
          onAcceptGenerated={() => { void acceptGeneratedCover(); }} onRejectGenerated={clearGeneratedCover} />
      </Paper>
      <Paper withBorder radius="lg" p="md">
        <DeckSessionTaskBudgetSettings
          deckId={deckId}
          value={sessionBudgetEdit ?? deck.sessionTaskBudget}
          edited={sessionBudgetEdit !== null}
          archived={deck.state === "archived"}
          busy={settingsBusy}
          error={settingsError}
          onChange={(value) => { setSettingsError(null); setSessionBudgetEdit(value); }}
          onBusyChange={setSettingsBusy}
          onSaved={(savedDeckId, saved) => {
            // deckId żądania (z chwili kliknięcia zapisu), nie bieżący widok:
            // nawigacja do innego zestawu w locie nie wbije cudzej wartości.
            setSessionBudgetEdit(null);
            setDeck((current) =>
              current && current.id === savedDeckId ? { ...current, sessionTaskBudget: saved } : current,
            );
          }}
          onError={setSettingsError}
        />
      </Paper>
    </SimpleGrid>
  );

  return (
    <div className="pp-editor">
      <Button component="button" variant="subtle" size="md" px={4} className="pp-editor-back" data-testid="editor-back" onClick={onBack}
        leftSection={<ParentIcon name="chevron-left" />}>
        {messages.decks.backToList}
      </Button>
      <Group align="flex-start" gap="xs" wrap="nowrap" mt={4}>
        <Title order={1} fz={{ base: 22, sm: 26 }} className="pp-editor-title">{deck?.title ?? ""}</Title>
        {editable && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size={44} radius="md" aria-label={messages.decks.deckActions} data-testid="deck-menu">
                <ParentIcon name="more-vertical" />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item color="red" leftSection={<ParentIcon name="archive" />} data-testid="archive-deck"
                disabled={busy || conflict !== null} onClick={confirmArchive}>
                {messages.decks.archive}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      <Group gap="xs" mt={6} mb="md" className="pp-editor-meta">
        {deck?.state === "published" && (
          <span className="pp-status-badge" data-tone="success" data-testid="publish-status">{messages.decks.published}</span>
        )}
        {draft && deck?.state === "published" && <span className="pp-status-badge" data-tone="warning">{messages.decks.states.draft}</span>}
        {deck?.state === "archived" && <span className="pp-status-badge">{messages.decks.states.archived}</span>}
        {form && (
          <Text size="sm" className="pp-editor-muted" data-testid="vocabulary-format">
            {messages.decks.vocabularyFormatLabel}: {form.vocabularyFormat === "picture"
              ? messages.decks.pictureVocabulary
              : messages.decks.standardVocabulary}
            {form.vocabularyFormat === "picture" && ` — ${messages.decks.pictureEditorHint}`}
          </Text>
        )}
      </Group>

      <Stack gap="md">
        {generating && (
          <Alert color="blue" variant="light" data-testid="generation-banner" icon={<Loader size="xs" />}>
            {messages.decks.generating}
          </Alert>
        )}
        {deck?.generation?.state === "failed" && (
          <Alert color="red" variant="light" data-testid="generation-failed">
            <Stack gap="xs" align="flex-start">
              <Text size="sm">{deck.generation.errorCode === "no_picture_material" ? messages.decks.noPictureMaterial : messages.decks.generationFailed}</Text>
              <Button size="md" variant="default" data-testid="generation-retry" leftSection={<ParentIcon name="refresh" />} onClick={retry}>
                {messages.decks.retryGeneration}
              </Button>
            </Stack>
          </Alert>
        )}
        {error && !showActionBar && errorAlert}

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
          <TextInput
            size="md"
            label={messages.decks.titleLabel}
            data-testid="editor-title"
            className="pp-editor-titlefield"
            value={form.title}
            disabled={!editable || busy}
            onChange={(event) => mutate("title", event.currentTarget.value)}
          />
        )}

        {form && (
          <Group justify="space-between" align="baseline" mt="xs">
            <Title order={2} fz="lg">{messages.decks.wordsTitle}</Title>
            <Text size="sm" className="pp-editor-muted">{messages.decks.itemCount.vocabulary![polishPlural(itemCount)]!.replace("{n}", String(itemCount))}</Text>
          </Group>
        )}

        {form?.items.map((item, index) => {
          const original = baseSnapshot.current?.form.items.find((baseItem) => baseItem.clientKey === item.clientKey);
          const itemUnchanged = original !== undefined && sameEditableItem(item, original);
          const revisionId = itemUnchanged && item.id ? baseRevisionIds.current.get(item.id) ?? "" : "";
          const targetAudio = assetOf(revisionId, "target_audio");
          const exampleAudio = assetOf(revisionId, "example_audio");
          const illustration = assetOf(revisionId, "illustration");
          const canOmit = editable && form.vocabularyFormat !== "picture" && illustration !== null && illustration.state !== "omitted";
          const hasMenu = targetAudio !== null || exampleAudio !== null || editable;
          const imageReady = illustration?.state === "approved" && illustration.assetId;
          return (
            <Paper withBorder radius="lg" p="md" key={item.clientKey} data-testid={`item-card-${index}`} className="pp-editor-item" component="article">
              <Group gap="sm" wrap="nowrap" className="pp-editor-item-head">
                <span className="pp-editor-num" aria-hidden="true">{index + 1}</span>
                <Text fw={600} className="pp-editor-item-summary">
                  {item.source || "…"} → <span lang="en-GB">{item.target || "…"}</span>
                </Text>
                {hasMenu && (
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="gray" size={44} radius="md" data-testid={`item-menu-${index}`}
                        aria-label={messages.decks.itemActions.replace("{n}", String(index + 1))}>
                        <ParentIcon name="more-vertical" />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {targetAudio && (
                        <Menu.Item leftSection={<ParentIcon name="volume" />} data-testid={`item-play-${index}`}
                          disabled={!(targetAudio.state === "approved" && targetAudio.assetId)}
                          onClick={() => targetAudio.assetId && playAsset(targetAudio.assetId)}>
                          {messages.decks.listen}
                        </Menu.Item>
                      )}
                      {exampleAudio && (
                        <Menu.Item leftSection={<ParentIcon name="volume" />} data-testid={`item-play-example-${index}`}
                          disabled={!(exampleAudio.state === "approved" && exampleAudio.assetId)}
                          onClick={() => exampleAudio.assetId && playAsset(exampleAudio.assetId)}>
                          {messages.decks.listenExample}
                        </Menu.Item>
                      )}
                      {editable && (targetAudio || illustration) && <Menu.Divider />}
                      {editable && isDirty && (targetAudio || illustration) && <Menu.Label>{messages.decks.saveBeforePublish}</Menu.Label>}
                      {editable && targetAudio && (
                        <Menu.Item leftSection={<ParentIcon name="refresh" />} data-testid={`item-regen-audio-${index}`}
                          disabled={busy || isDirty} onClick={() => regenerate(revisionId, "target_audio", item.clientKey)}>
                          {messages.decks.regenerateAudio}
                        </Menu.Item>
                      )}
                      {editable && illustration && (
                        <Menu.Item leftSection={<ParentIcon name="refresh" />} data-testid={`item-regen-image-${index}`}
                          disabled={busy || isDirty} onClick={() => regenerate(revisionId, "illustration", item.clientKey)}>
                          {messages.decks.regenerateImage}
                        </Menu.Item>
                      )}
                      {canOmit && (
                        <Menu.Item leftSection={<ParentIcon name="image-off" />} data-testid={`item-omit-image-${index}`}
                          disabled={busy || isDirty} onClick={() => omitIllustration(revisionId, item.clientKey)}>
                          {messages.decks.omitImage}
                        </Menu.Item>
                      )}
                      {editable && <Menu.Divider />}
                      {editable && (
                        <Menu.Item color="red" leftSection={<ParentIcon name="trash-2" />} data-testid={`item-remove-${index}`}
                          disabled={busy || itemCount <= 1} onClick={() => removeItem(index)}>
                          {messages.decks.removeItem}
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>

              <div className="pp-editor-item-body">
                <div className="pp-editor-media">
                  {imageReady && (
                    <img className="pp-editor-image" data-testid={`item-image-${index}`} src={`/api/v1/media/${illustration.assetId}`} alt={item.target} />
                  )}
                  <div className="pp-editor-badges">
                    {editable && !itemUnchanged && (
                      <span className="pp-status-badge" data-tone="warning">{messages.decks.changedMediaAfterSave}</span>
                    )}
                    {targetAudio && (
                      <span className="pp-status-badge" data-tone={mediaTone(targetAudio.state)} data-testid={`item-audio-state-${index}`}>
                        {mediaStateText(messages.decks.audioState, targetAudio.state)}
                      </span>
                    )}
                    {exampleAudio && (
                      <span className="pp-status-badge" data-tone={mediaTone(exampleAudio.state)} data-testid={`item-example-audio-state-${index}`}>
                        {messages.decks.exampleLabel} · {mediaStateText(messages.decks.audioState, exampleAudio.state)}
                      </span>
                    )}
                    {illustration && (
                      <span className="pp-status-badge" data-tone={mediaTone(illustration.state)} data-testid={`item-image-state-${index}`}>
                        {mediaStateText(messages.decks.imageState, illustration.state)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="pp-editor-fields">
                  <TextInput size="md" label={messages.decks.sourceLabel} data-testid={`item-source-${index}`} value={item.source}
                    disabled={!editable || busy} onChange={(event) => mutate("source", event.currentTarget.value, index)} />
                  <TextInput size="md" label={messages.decks.targetLabel} data-testid={`item-target-${index}`} value={item.target} lang="en-GB"
                    disabled={!editable || busy} onChange={(event) => mutate("target", event.currentTarget.value, index)} />
                  <TextInput size="md" label={messages.decks.acceptedLabel} data-testid={`item-accepted-${index}`} value={item.accepted}
                    disabled={!editable || busy} onChange={(event) => mutate("accepted", event.currentTarget.value, index)} />
                  <NativeSelect size="md" label={messages.decks.visualLabel} data-testid={`item-visual-${index}`} value={item.visualType}
                    disabled={!editable || busy} onChange={(event) => changeVisual(index, event.currentTarget.value as VisualType)}
                    data={VISUAL_TYPES.filter((type) => form.vocabularyFormat !== "picture" || ["image", "color", "number"].includes(type))
                      .map((type) => ({ value: type, label: messages.decks.visualTypes[type]! }))} />
                  <TextInput size="md" label={messages.decks.exampleLabel} data-testid={`item-example-${index}`} value={item.example} lang="en-GB"
                    className="pp-editor-wide" disabled={!editable || busy} onChange={(event) => mutate("example", event.currentTarget.value, index)} />
                  {item.visualType === "image" && item.example.trim().length > 0 && (
                    <Checkbox size="md" className="pp-editor-wide" label={messages.decks.exampleInImage} data-testid={`item-example-in-image-${index}`}
                      checked={item.visualData?.includeExampleInImage === true} disabled={!editable || busy}
                      onChange={(event) => toggleExampleInImage(index, event.currentTarget.checked)} />
                  )}
                </div>
              </div>
              {mediaError?.key === item.clientKey && (
                <Alert color="red" variant="light" role="alert" mt="sm" data-testid={`item-error-${index}`}>{mediaError.message}</Alert>
              )}
            </Paper>
          );
        })}

        {editable && itemCount === 0 && !generating && (
          <Text className="pp-editor-muted" data-testid="empty-draft">{messages.decks.emptyDraft}</Text>
        )}
        {editable && (
          <Button size="md" variant="default" className="pp-editor-add" data-testid="add-item" onClick={addItem} disabled={busy}
            leftSection={<ParentIcon name="plus" />}>
            {messages.decks.addItem}
          </Button>
        )}

        {settings && (
          compact ? (
            <Accordion variant="separated" radius="lg" className="pp-editor-settings">
              <Accordion.Item value="settings">
                <Accordion.Control>
                  <Text fw={600}>{messages.decks.settingsTitle}</Text>
                  <Text size="sm" className="pp-editor-muted">
                    {deck?.coverAssetId ? messages.decks.coverSummarySet : messages.decks.coverSummaryNone}
                    {" · "}{messages.decks.sessionTaskBudget}: {sessionBudgetEdit ?? deck?.sessionTaskBudget}
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>{settings}</Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          ) : (
            <>
              <Title order={2} fz="lg" mt="md">{messages.decks.settingsTitle}</Title>
              {settings}
            </>
          )
        )}

        {deck?.state === "published" && (
          <>
            <Title order={2} fz="lg" mt="md">{messages.decks.assignTitle}</Title>
            <EditorAssignments
              kind="vocabulary"
              childrenList={childrenList}
              assignments={deck.assignments}
              dates={assignDates}
              errors={assignErrors}
              unassigningChildId={unassigningChildId}
              settings={assignmentSettings}
              warning={(child, index) => child.canRead === false && deck.published?.vocabularyFormat !== "picture" && (
                <Alert color="yellow" variant="light" data-testid={`non-reader-assignment-warning-${index}`}>
                  {messages.decks.nonReaderStandardAssignment}
                </Alert>
              )}
              onDateChange={(childId, value) => setAssignDates((current) => ({ ...current, [childId]: value }))}
              onSettingsChange={(childId, value) => setAssignSettings((current) => ({ ...current, [childId]: value }))}
              onAssign={(childId) => void assign(childId)}
              onUnassign={confirmUnassign}
            />
          </>
        )}
      </Stack>

      {showActionBar && (
        <EditorActionBar
          error={error}
          blockedReason={publishBlocked
            ? (isDirty && itemCount > 0 ? `${messages.decks.unsavedChanges} · ${messages.decks.saveBeforePublish}` : messages.decks.emptyPublish)
            : null}
          editable={editable}
          isDirty={isDirty}
          busy={busy}
          testIds={{ save: "save-items", publish: "publish-deck" }}
          saveDisabled={busy || (conflict !== null && !remoteApplied)}
          publishDisabled={busy || isDirty || conflict !== null || (draft?.items.length ?? 0) === 0}
          onSave={() => void save()}
          onPublish={() => void publish()}
          onNewVersion={() => void startNewVersion()}
        />
      )}
    </div>
  );
}
