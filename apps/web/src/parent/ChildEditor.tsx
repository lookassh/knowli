"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { messages, type ChildDto, type ChildPatch, type PronunciationSettingsDto } from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";
import { ParentIcon } from "./ParentIcon";
import { AVATARS, avatarEmoji } from "./avatars";

function PronunciationSettings({ childId }: { childId: string }) {
  const [settings, setSettings] = useState<PronunciationSettingsDto | null>(null);
  const [good, setGood] = useState("");
  const [almost, setAlmost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await apiFetch<PronunciationSettingsDto>("GET", `/api/v1/parent/children/${childId}/pronunciation`);
    setSettings(data);
    if (data.thresholds) {
      setGood(String(data.thresholds.correctMinScore));
      setAlmost(String(data.thresholds.partialMinScore));
    }
  }, [childId]);

  useEffect(() => {
    load().catch((cause) => setError(errorMessage(cause)));
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("PUT", `/api/v1/parent/children/${childId}/pronunciation`, {
        correctMinScore: Number(good),
        partialMinScore: Number(almost),
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <p className="hint">…</p>;
  return (
    <section className="card" data-testid="child-pronunciation-settings">
      <h3>{messages.children.pronunciationTitle}</h3>
      {!settings.pronunciationAvailable || !settings.thresholds ? (
        <p>{messages.children.pronunciationUnavailable}</p>
      ) : (
        <>
          <label>
            {messages.children.pronunciationThresholdGood}
            <input
              data-testid="child-threshold-good"
              type="number"
              min={0}
              max={100}
              value={good}
              onChange={(event) => setGood(event.target.value)}
            />
          </label>
          <label>
            {messages.children.pronunciationThresholdAlmost}
            <input
              data-testid="child-threshold-almost"
              type="number"
              min={0}
              max={100}
              value={almost}
              onChange={(event) => setAlmost(event.target.value)}
            />
          </label>
          <button type="button" data-testid="child-settings-save" onClick={save} disabled={busy}>
            {messages.children.pronunciationSave}
          </button>
          <h4>{messages.children.pronunciationAttemptsTitle}</h4>
          <ul className="plain" data-testid="child-attempts">
            {settings.attempts.length === 0 && <li>{messages.children.pronunciationEmpty}</li>}
            {settings.attempts.map((attempt, index) => (
              <li data-testid="child-attempt-row" key={`${attempt.attemptedAt}-${index}`}>
                {attempt.word} — {Math.round(attempt.score)} ({
                  attempt.band === "correct"
                    ? messages.children.pronunciationBandCorrect
                    : attempt.band === "partial"
                      ? messages.children.pronunciationBandPartial
                      : messages.children.pronunciationBandBelow
                }) · {attempt.attemptedAt}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

/** Edycja zachowuje historię; tylko usunięcie profilu kasuje dane nauki. */
export default function ChildEditor({
  childrenList,
  onChanged,
}: {
  childrenList: ChildDto[];
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]!.key);
  const [birthYear, setBirthYear] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openSettings, setOpenSettings] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChildDto | null>(null);
  const [editName, setEditName] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [editRecordingMode, setEditRecordingMode] = useState<ChildDto["recordingMode"]>("hold");
  const [editCanRead, setEditCanRead] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const editLock = useRef(false);
  const editNameRef = useRef<HTMLInputElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocus = useRef<string | null>(null);

  useEffect(() => {
    if (editing) editNameRef.current?.focus();
  }, [editing?.id]);

  useEffect(() => {
    if (editing && !childrenList.some((child) => child.id === editing.id)) {
      setEditing(null);
      setEditError(null);
    }
  }, [childrenList, editing]);

  useEffect(() => {
    if (!editing && !editBusy && restoreFocus.current) {
      editButtons.current.get(restoreFocus.current)?.focus();
      restoreFocus.current = null;
    }
  }, [editing, editBusy]);

  const startEdit = (child: ChildDto) => {
    if (editLock.current) return;
    setEditing(child);
    setEditName(child.displayName);
    setEditAvatar(child.avatarKey);
    setEditRecordingMode(child.recordingMode);
    setEditCanRead(child.canRead);
    setEditError(null);
    setEditStatus(null);
  };

  const cancelEdit = () => {
    if (editLock.current) return;
    restoreFocus.current = editing?.id ?? null;
    setEditing(null);
    setEditError(null);
  };

  const trimmedName = editName.trim();
  const nameChanged = editing !== null && trimmedName !== editing.displayName.trim();
  const editChanged = editing !== null && (nameChanged || editAvatar !== editing.avatarKey || editRecordingMode !== editing.recordingMode || editCanRead !== editing.canRead);

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || editLock.current || !trimmedName || !editChanged) return;
    const patch: ChildPatch = {
      ...(nameChanged ? { displayName: trimmedName } : {}),
      ...(editAvatar !== editing.avatarKey ? { avatarKey: editAvatar } : {}),
      ...(editRecordingMode !== editing.recordingMode ? { recordingMode: editRecordingMode } : {}),
      ...(editCanRead !== editing.canRead ? { canRead: editCanRead } : {}),
    };
    editLock.current = true;
    setEditBusy(true);
    setEditError(null);
    setEditStatus(null);
    try {
      await apiFetch<ChildDto>("PATCH", `/api/v1/parent/children/${editing.id}`, patch);
      restoreFocus.current = editing.id;
      setEditing(null);
      setEditStatus(messages.children.saved);
      try {
        await onChanged();
      } catch {
        setEditStatus(messages.children.savedRefreshFailed);
      }
    } catch (cause) {
      setEditError(errorMessage(cause));
    } finally {
      editLock.current = false;
      setEditBusy(false);
    }
  };

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("POST", "/api/v1/parent/children", {
        displayName: name,
        avatarKey: avatar,
        ...(birthYear ? { birthYear: Number(birthYear) } : {}),
      });
      setName("");
      setBirthYear("");
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (childId: string) => {
    if (editLock.current && editing?.id === childId) return;
    if (!window.confirm(messages.children.removeConfirm)) {
      return;
    }
    setError(null);
    try {
      await apiFetch("DELETE", `/api/v1/parent/children/${childId}`);
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const avatarCounts = new Map<string, number>();
  for (const child of childrenList) avatarCounts.set(child.avatarKey, (avatarCounts.get(child.avatarKey) ?? 0) + 1);

  return (
    <section>
      <div className="pp-pagehead">
        <h2 className="pp-pagehead-title">{messages.children.title}</h2>
      </div>
      {editStatus && <p role="status">{editStatus}</p>}
      {childrenList.length === 0 && <p className="pp-empty">{messages.children.empty}</p>}
      <ul className="pp-plain pp-children-grid">
        {childrenList.map((child, index) => (
          <li className="pp-child-card" key={child.id} data-testid={`child-row-${index}`}>
            <div className="pp-child-avatar" aria-hidden="true">{avatarEmoji(child.avatarKey)}</div>
            <div className="pp-child-name">{child.displayName}</div>
            <div className="pp-child-meta">
              {child.birthYear ? `ur. ${child.birthYear}` : ""}
              {child.birthYear ? " · " : ""}
              {messages.children.recordingMode}:{" "}
              {child.recordingMode === "hold" ? messages.children.recordingModeHold : messages.children.recordingModeToggle}
            </div>
            {avatarCounts.get(child.avatarKey)! > 1 && <p className="info" data-testid={`duplicate-avatar-warning-${index}`}>{messages.children.duplicateAvatarWarning}</p>}
            <div className="pp-child-actions">
              <a
                className="pp-btn pp-btn-primary pp-child-learn"
                data-testid="child-learn-link"
                href={`/kids/${child.id}/learn`}
              >
                <ParentIcon name="play" />
                {messages.children.startLearning}
              </a>
              <div className="pp-child-row2">
                <button
                  type="button"
                  className="pp-btn pp-btn-quiet pp-btn-sm"
                  data-testid="child-edit"
                  ref={(button) => { if (button) editButtons.current.set(child.id, button); else editButtons.current.delete(child.id); }}
                  aria-expanded={editing?.id === child.id}
                  aria-controls={`child-edit-form-${child.id}`}
                  disabled={editBusy}
                  onClick={() => editing?.id === child.id ? cancelEdit() : startEdit(child)}
                >
                  <ParentIcon name="pencil" />
                  {messages.children.edit}
                </button>
                <button
                  type="button"
                  className="pp-btn pp-btn-quiet pp-btn-sm"
                  data-testid={`child-settings-${index}`}
                  aria-expanded={openSettings === child.id}
                  onClick={() => setOpenSettings(openSettings === child.id ? null : child.id)}
                >
                  <ParentIcon name="mic" />
                  {messages.children.pronunciationTitle}
                </button>
              </div>
              <button
                type="button"
                className="pp-btn pp-btn-ghost pp-btn-sm pp-btn-danger"
                disabled={editBusy && editing?.id === child.id}
                onClick={() => remove(child.id)}
              >
                {messages.children.remove}
              </button>
            </div>
            {editing?.id === child.id && (
              <form id={`child-edit-form-${child.id}`} className="pp-child-edit-form" onSubmit={saveEdit}>
                <div className="grid-2">
                  <label>
                    {messages.children.displayName}
                    <input ref={editNameRef} data-testid="child-edit-name" value={editName} maxLength={80}
                      disabled={editBusy} onChange={(event) => setEditName(event.target.value)} />
                  </label>
                  <div>
                    <label htmlFor={`child-edit-avatar-${child.id}`}>{messages.children.avatar}</label>
                    <select id={`child-edit-avatar-${child.id}`} data-testid="child-edit-avatar" value={editAvatar} disabled={editBusy}
                      onChange={(event) => setEditAvatar(event.target.value)}>
                      {!AVATARS.some((option) => option.key === editAvatar) && <option value={editAvatar}>🙂</option>}
                      {AVATARS.map((option) => <option key={option.key} value={option.key}>{option.emoji}</option>)}
                    </select>
                  </div>
                </div>
                <div className="row">
                  <label htmlFor={`child-edit-recording-mode-${child.id}`}>{messages.children.recordingMode}</label>
                  <select id={`child-edit-recording-mode-${child.id}`} data-testid="child-edit-recording-mode" value={editRecordingMode} disabled={editBusy}
                    onChange={(event) => setEditRecordingMode(event.target.value as ChildDto["recordingMode"])}>
                    <option value="hold">{messages.children.recordingModeHold}</option>
                    <option value="toggle">{messages.children.recordingModeToggle}</option>
                  </select>
                </div>
                <label className="row">
                  <input data-testid="child-edit-can-read" type="checkbox" checked={!editCanRead} disabled={editBusy}
                    onChange={(event) => setEditCanRead(!event.target.checked)} />
                  {messages.children.canRead}
                </label>
                <div className="row">
                  <button type="submit" data-testid="child-edit-save" disabled={editBusy || !trimmedName || !editChanged}>
                    {messages.children.save}
                  </button>
                  <button type="button" data-testid="child-edit-cancel" disabled={editBusy} onClick={cancelEdit}>
                    {messages.children.cancel}
                  </button>
                </div>
                {editError && <p className="error" role="alert">{editError}</p>}
              </form>
            )}
            {openSettings === child.id && <PronunciationSettings childId={child.id} />}
          </li>
        ))}
      </ul>
      <section className="pp-child-card pp-add-child">
        <div className="pp-add-child-title">
          <ParentIcon name="plus" />
          {messages.children.add}
        </div>
        <div className="grid-2">
          <label>
            {messages.children.displayName}
            <input data-testid="child-name" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            {messages.children.avatar}
            <select data-testid="child-avatar" value={avatar} onChange={(event) => setAvatar(event.target.value)}>
              {AVATARS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.emoji}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          {messages.children.birthYear}
          <input
            data-testid="child-year"
            type="number"
            min={1900}
            max={2200}
            value={birthYear}
            onChange={(event) => setBirthYear(event.target.value)}
          />
        </label>
        <button type="button" data-testid="child-add" className="pp-btn pp-btn-quiet" onClick={add} disabled={busy || name.length === 0}>
          {messages.children.add}
        </button>
        {error && (
          <p className="error" data-testid="api-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </section>
  );
}
