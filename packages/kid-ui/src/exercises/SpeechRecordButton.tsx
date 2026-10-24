import { useEffect, useReducer, useRef } from "react";
import { UnstyledButton } from "@mantine/core";
import { messages } from "@learning/contracts";
import type { RecordingModeDto } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { reduceRecordingGesture, type GestureOwner, type GestureState } from "./recording-gesture";

type RecordingPhase = "idle" | "preparing" | "starting" | "recording" | "stopping";

export interface SpeechRecordButtonProps {
  phase: RecordingPhase;
  ready: boolean;
  disabled: boolean;
  level: number | null;
  notice?: string | null;
  mode: RecordingModeDto;
  onPrepare(): void;
  onStart(): void;
  onStop(): void;
  onCancel(): void;
}

const initialGesture: GestureState = { owner: null, active: false };

function keyOwner(key: string): GestureOwner | null {
  if (key === " " || key === "Spacebar") return { kind: "key", key: "Space" };
  if (key === "Enter") return { kind: "key", key: "Enter" };
  return null;
}

/** Shared hold-to-speak control with an accessible click/toggle alternative. */
export function SpeechRecordButton({ phase, ready, disabled, level, notice = null, mode, onPrepare, onStart, onStop, onCancel }: SpeechRecordButtonProps) {
  const [gesture, dispatch] = useReducer(
    (state: GestureState, event: Parameters<typeof reduceRecordingGesture>[1]) => reduceRecordingGesture(state, event).state,
    initialGesture,
  );
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const blocked = disabled || (phase !== "idle" && phase !== "recording");

  useEffect(() => {
    if (phase === "idle") dispatch({ type: "settled" });
  }, [phase]);

  function act(event: Parameters<typeof reduceRecordingGesture>[1]): void {
    const staleAfterIdle = event.type === "start" && phaseRef.current === "idle" && gesture.active;
    const currentGesture = staleAfterIdle ? initialGesture : gesture;
    const result = reduceRecordingGesture(currentGesture, event);
    if (staleAfterIdle) dispatch({ type: "settled" });
    dispatch(event);
    if (result.action === "start") onStart();
    else if (result.action === "stop") onStop();
    else if (result.action === "cancel") onCancel();
  }

  function begin(owner: GestureOwner): void {
    if (blocked || phaseRef.current !== "idle") return;
    if (!ready) {
      onPrepare();
      return;
    }
    act({ type: "start", owner });
  }

  function release(owner: GestureOwner): void {
    act({ type: "release", owner });
  }

  function cancel(owner?: GestureOwner): void {
    act({ type: "cancel", ...(owner === undefined ? {} : { owner }) });
  }

  function toggle(): void {
    if (blocked) return;
    // Automatyczny start nie ma właściciela gestu. Pierwszy klik zatrzymuje
    // rzeczywiście trwające nagranie, zamiast ponownie żądać startu.
    if (phase === "recording" && !gesture.active) {
      onStop();
      return;
    }
    if (phase === "idle" && !ready) {
      onPrepare();
      return;
    }
    if (phase === "idle" || phase === "recording") act({ type: "toggle" });
  }

  const levelValue = level === null ? null : Math.round(Math.max(0, Math.min(1, level)) * 100);
  const active = phase === "starting" || phase === "recording" || phase === "stopping";
  const nativeDisabled = disabled || (phase !== "idle" && phase !== "recording" && phase !== "starting");
  const status = phase === "preparing" ? messages.kid.recordingPrepare
    : phase === "starting" ? messages.kid.recordingStarting
          : phase === "recording" ? messages.kid.recordingListen
        : phase === "stopping" ? messages.kid.recordingFinishing
          : ready ? null : messages.kid.recordingPermission;
  const label = phase === "recording" ? messages.kid.recordingListen
    : !ready && phase === "idle" ? messages.kid.recordingEnableMic
      : mode === "hold" ? messages.kid.recordHold
        : phase === "starting" ? messages.kid.recordingStarting : messages.kid.record;

  return (
    <div className="kid-record-controls" data-testid="kid-record-controls">
      <UnstyledButton
        type="button"
        className="kid-primary kid-record-button"
        data-testid="kid-record"
        data-ready={ready}
        data-phase={phase}
        aria-pressed={phase === "recording"}
        disabled={nativeDisabled}
        aria-disabled={blocked}
        onPointerDown={(event) => {
          if (mode === "hold" && !disabled && !gesture.active &&
              (event.pointerType !== "mouse" || event.button === 0) &&
              (phase === "starting" || phase === "recording")) {
            event.preventDefault();
            if (phase === "starting") onCancel();
            else onStop();
            return;
          }
          if (mode !== "hold" || blocked || gesture.active || (event.pointerType === "mouse" && event.button !== 0)) return;
          event.preventDefault();
          if (!ready) {
            onPrepare();
            return;
          }
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture may be unavailable in a test host */ }
          begin({ kind: "pointer", id: event.pointerId });
        }}
        onPointerUp={(event) => {
          if (mode === "hold") release({ kind: "pointer", id: event.pointerId });
        }}
        onPointerCancel={(event) => {
          if (mode === "hold") cancel({ kind: "pointer", id: event.pointerId });
        }}
        onLostPointerCapture={(event) => {
          if (mode === "hold") cancel({ kind: "pointer", id: event.pointerId });
        }}
        onKeyDown={(event) => {
          if (mode !== "hold") return;
          const owner = keyOwner(event.key);
          if (!owner) return;
          event.preventDefault();
          // Autostart nie należy do gestu klawisza: puszczenie Space/Enter
          // nie może przypadkiem zamienić ciszy w wysłaną próbę.
          if (phase !== "idle") return;
          if (!ready && phase === "idle") {
            if (!event.repeat) onPrepare();
            return;
          }
          act({ type: "start", owner, repeat: event.repeat });
        }}
        onKeyUp={(event) => {
          if (mode !== "hold") return;
          const owner = keyOwner(event.key);
          if (owner) {
            event.preventDefault();
            release(owner);
          }
        }}
        onBlur={() => {
          if (gesture.owner?.kind === "key") cancel(gesture.owner);
        }}
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" && (gesture.active || phase === "starting" || phase === "recording")) {
            event.preventDefault();
            if (gesture.active) act({ type: "escape" });
            else onCancel();
          }
        }}
        onClick={(event) => {
          event.preventDefault();
          if (mode === "toggle") toggle();
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <KidIcon name="microphone" />
        <span>{label}</span>
      </UnstyledButton>
      {(notice ?? status) !== null && <p className="kid-record-status" role="status" data-testid="kid-record-status">{notice ?? status}</p>}
      {active && (
        <div className="kid-recording" data-testid="kid-recording" role="status"><KidIcon name="microphone" /> {messages.kid.recording}</div>
      )}
      {levelValue !== null && phase === "recording" && (
        <div className="kid-input-level" data-testid="kid-input-level" role="meter" aria-label={messages.kid.recordingLevel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={levelValue}>
          <span style={{ width: `${levelValue}%` }} />
        </div>
      )}
    </div>
  );
}
