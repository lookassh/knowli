"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { apiFetch, errorMessage } from "./api";
import type { EditorLeaveState } from "./useParentLeaveGuard";
import DeckConflictPanel, { type EditorConflict } from "./DeckConflictPanel";

const VISUAL_TYPES: VisualType[] = ["image", "color", "number", "sequence", "none"];

/** DTO używa "approved", katalog komunikatów kluczem "ready". */
function mediaStateText(catalogue: Record<string, string>, state: string): string {
  return catalogue[state === "approved" ? "ready" : state] ?? "";
}

/**
 * Przegląd i edycja jednego zestawu: szkic z generacji, poprawki słów
 * i wariantów, podgląd audio/obrazów, świadome pominięcie obrazu, publikacja
 * i przypisania dzieci. Polling prowadzi dalej po odświeżeniu strony;
 * kosztowna regeneracja wymaga zawsze jawnego kliknięcia.
 */
export default function DeckEditor({
  deckId,
  childrenList,
  onBack,
  onEditorStateChange,
  onAuthExpired,
}: {
  deckId: string;
  childrenList: ChildDto[];
  onBack: () => void;
  onEditorStateChange: (state: EditorLeaveState) => void;
  onAuthExpired: () => void;
}) {
  const [deck, setDeck] = useState<DeckDto | null>(null);
  const [form, setForm] = useState<EditableDeckForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [conflict, setConflict] = useState<EditorConflict | null>(null);
  const [remoteApplied, setRemoteApplied] = useState(false);
  const [assignDates, setAssignDates] = useState<Record<string, string>>({});
  const dirty = useRef(false);
  const conflictActive = useRef(false);
  const busyRef = useRef(false);
  const baseSnapshot = useRef<EditorSnapshot | null>(null);
  const baseRevisionIds = useRef(new Map<string, string>());
  const loadVersion = useRef(0);
  const deckIdRef = useRef(deckId);
  deckIdRef.current = deckId;
  const newKey = useCallback(() => crypto.randomUUID(), []);
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

  const load = useCallback(async (): Promise<boolean> => {
    const requestVersion = ++loadVersion.current;
    try {
      const result = await apiFetch<DeckDto>("GET", `/api/v1/parent/decks/${deckId}`);
      if (requestVersion === loadVersion.current && deckIdRef.current === deckId && !dirty.current && !conflictActive.current) {
        setDeck(result);
        return true;
      }
      return true;
    } catch (cause) {
      if (requestVersion === loadVersion.current && deckIdRef.current === deckId && !dirty.current && !conflictActive.current) {
        setError(errorMessage(cause));
      }
      return false;
    }
  }, [deckId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshConflict = useCallback(async (local: EditorSnapshot) => {
    conflictActive.current = true;
    setConflict({ local, remote: null, loadError: null });
    try {
      const remote = await apiFetch<DeckDto>("GET", `/api/v1/parent/decks/${deckId}`);
      setConflict((current) => current ? { ...current, remote, loadError: null } : current);
      setError(null);
    } catch {
      setConflict((current) => current ? { ...current, loadError: messages.decks.conflictLoadFailed } : current);
      setError(messages.decks.conflictDetected);
    }
  }, [deckId]);

  const applyRemoteConflict = async (remote: DeckDto) => {
    setBusyState(true);
    setError(null);
    try {
      let current = remote;
      if (!current.draft && current.published) {
        await apiFetch("POST", `/api/v1/parent/decks/${deckId}/draft`);
        current = await apiFetch<DeckDto>("GET", `/api/v1/parent/decks/${deckId}`);
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
  const assetsPending = active?.assets.some((asset) => asset.state === "pending") ?? false;
  useEffect(() => {
    if (!generating && !assetsPending) {
      return;
    }
    const timer = setInterval(() => {
      void load();
    }, 1000);
    return () => clearInterval(timer);
  }, [generating, assetsPending, load]);

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

  useEffect(() => () => {
    loadVersion.current += 1;
  }, [deckId]);

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
      const saved = await apiFetch<DraftDto>("PATCH", `/api/v1/parent/drafts/${snapshot.draftId}`, toDraftPatch(snapshot));
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
      await apiFetch("POST", `/api/v1/parent/drafts/${draft.id}/publish`, {
        expectedEditNumber: draft.editNumber,
      });
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
      await apiFetch("POST", `/api/v1/parent/decks/${deckId}/archive`);
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
      await apiFetch("POST", `/api/v1/parent/decks/${deckId}/draft`);
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
    setError(null);
    try {
      await apiFetch("POST", `/api/v1/parent/generation/${deck.generation.id}/retry`);
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
      await apiFetch("POST", `/api/v1/parent/drafts/${draft.id}/assets/regenerate`, {
        itemRevisionId,
        role,
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const omitIllustration = async (itemRevisionId: string) => {
    if (!draft) {
      return;
    }
    setError(null);
    try {
      await apiFetch("POST", `/api/v1/parent/drafts/${draft.id}/assets/omit`, { itemRevisionId });
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
      await apiFetch("PUT", `/api/v1/parent/assignments/${childId}/${deckId}`, {
        testDate: assignDates[childId] || null,
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
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
          {messages.decks.generationFailed}{" "}
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
        <label>
          {messages.decks.titleLabel}
          <input
            data-testid="editor-title"
            value={form.title}
            disabled={!editable || busy}
            onChange={(event) => mutate("title", event.target.value)}
          />
        </label>
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
            <label>
              {messages.decks.visualLabel}
              <select
                data-testid={`item-visual-${index}`}
                value={item.visualType}
                disabled={!editable || busy}
                onChange={(event) => changeVisual(index, event.target.value as VisualType)}
              >
                {VISUAL_TYPES.map((type) => (
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
                  {editable && illustration.state !== "omitted" && (
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
              <span>{child.displayName}</span>
              <input
                type="date"
                data-testid={`assign-date-${index}`}
                aria-label={`${messages.decks.assignDate} ${child.displayName}`}
                value={assignDates[child.id] ?? ""}
                onChange={(event) =>
                  setAssignDates((current) => ({ ...current, [child.id]: event.target.value }))
                }
              />
              <button type="button" data-testid={`assign-submit-${index}`} onClick={() => assign(child.id)}>
                {messages.decks.assign}
              </button>
            </div>
          ))}
          <ul className="plain">
            {deck.assignments.map((assignment, index) => (
              <li key={assignment.childId} data-testid={`assignment-row-${index}`}>
                {assignment.displayName} — {assignment.testDate ?? messages.decks.noDate}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
