import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { messages } from "@learning/contracts";
import { cssZoomOf } from "../layout/css-zoom";
import { useKidPageViewport } from "../layout/viewport";
import { IconActionButton } from "./IconActionButton";
import { KidIcon } from "./KidIcon";

export interface MicrophoneSettingsButtonProps {
  microphone: boolean;
  micDenied: boolean;
  onToggleMicrophone: (on: boolean) => void;
}

/** Ustawienie odpowiedzi głosowych dostępne przed rozpoczęciem nauki. */
export function MicrophoneSettingsButton({
  microphone,
  micDenied,
  onToggleMicrophone,
}: MicrophoneSettingsButtonProps): ReactElement {
  const [opened, setOpened] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [panelPosition, setPanelPosition] = useState<CSSProperties>();
  const viewport = useKidPageViewport();
  const label = microphone ? messages.kid.microphoneSettingsOn : messages.kid.microphoneSettingsOff;

  const positionPanel = useCallback(() => {
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button || !panel || viewport.width === null || viewport.height === null) return;

    // Położenie liczymy w px ekranu (prostokąty, rozmiar okna). Odstęp 8 px i marginesy bezpieczne są w px
    // wewnętrznych, więc rosną z zoomem dużego okna, a długości position: fixed zoom mnoży jeszcze raz.
    const zoom = cssZoomOf(button);
    const buttonRect = button.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const styles = window.getComputedStyle(button);
    const inset = (name: string) => Math.max(16, Number.parseFloat(styles.getPropertyValue(name)) || 0) * zoom;
    const left = Math.max(inset("--kid-safe-left"), Math.min(buttonRect.left, viewport.width - panelRect.width - inset("--kid-safe-right")));
    const viewportTop = viewport.offsetTop;
    const top = Math.max(viewportTop + inset("--kid-safe-top"), Math.min(buttonRect.bottom + 8 * zoom, viewportTop + viewport.height - panelRect.height - inset("--kid-safe-bottom")));
    const panelZoom = cssZoomOf(panel);
    setPanelPosition({ position: "fixed", left: left / panelZoom, top: top / panelZoom });
    // The zoom is read from the DOM, but viewport.scale re-runs the placement when only the scale changes
    // (e.g. the pointer type changes while the window keeps its size).
  }, [viewport.width, viewport.height, viewport.offsetTop, viewport.scale]);

  useLayoutEffect(() => {
    if (!opened) return;
    positionPanel();
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    visualViewport?.addEventListener("resize", positionPanel);
    visualViewport?.addEventListener("scroll", positionPanel);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
      visualViewport?.removeEventListener("resize", positionPanel);
      visualViewport?.removeEventListener("scroll", positionPanel);
    };
  }, [opened, microphone, micDenied, positionPanel]);

  useEffect(() => {
    if (!opened) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpened(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpened(false);
      buttonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [opened]);

  return (
    <div ref={rootRef} className="kid-microphone-settings-anchor">
        <IconActionButton
          ref={buttonRef}
          className="kid-icon-button"
          data-testid="kid-mic-settings"
          aria-label={label}
          aria-expanded={opened}
          aria-controls={panelId}
          onClick={() => setOpened((value) => {
            if (!value) setPanelPosition(undefined);
            return !value;
          })}
        >
          <KidIcon name={microphone ? "microphone" : "microphone-off"} />
        </IconActionButton>
        {opened && <section
          ref={panelRef}
          className="kid-microphone-settings"
          data-testid="kid-mic-settings-panel"
          id={panelId}
          role="dialog"
          aria-label={messages.kid.microphoneSettingsTitle}
          style={panelPosition}
        >
          <h2 className="kid-microphone-settings__title">{messages.kid.microphoneSettingsTitle}</h2>
          <label className="kid-toggle" data-testid="kid-mic-toggle">
            <input
              type="checkbox"
              checked={microphone}
              onChange={(event) => onToggleMicrophone(event.currentTarget.checked)}
            />
            <span className="kid-toggle__track" aria-hidden="true"><span className="kid-toggle__knob" /></span>
            <span>{messages.kid.microphone}</span>
          </label>
          <p className="kid-microphone-hint" data-testid="kid-microphone-hint">
            {messages.kid.microphoneLearningHint}
          </p>
          {micDenied && <p className="kid-hint" data-testid="kid-mic-denied-hint">{messages.kid.microphoneDeniedHint}</p>}
        </section>}
    </div>
  );
}
