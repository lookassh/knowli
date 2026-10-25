import { Paper, Switch, Text, Title } from "@mantine/core";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { messages } from "@learning/contracts";
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
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPosition, setPanelPosition] = useState<CSSProperties>();
  const viewport = useKidPageViewport();
  const label = microphone ? messages.kid.microphoneSettingsOn : messages.kid.microphoneSettingsOff;

  const positionPanel = () => {
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button || !panel || viewport.width === null || viewport.height === null) return;

    const buttonRect = button.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const styles = window.getComputedStyle(button);
    const inset = (name: string) => Math.max(16, Number.parseFloat(styles.getPropertyValue(name)) || 0);
    const left = Math.max(inset("--kid-safe-left"), Math.min(buttonRect.left, viewport.width - panelRect.width - inset("--kid-safe-right")));
    const viewportTop = viewport.offsetTop;
    const top = Math.max(viewportTop + inset("--kid-safe-top"), Math.min(buttonRect.bottom + 8, viewportTop + viewport.height - panelRect.height - inset("--kid-safe-bottom")));
    setPanelPosition({ position: "fixed", left, top });
  };

  useLayoutEffect(() => {
    if (!opened) return;
    positionPanel();
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [opened, microphone, micDenied, viewport.width, viewport.height]);

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
        {opened && <Paper
          ref={panelRef}
          className="kid-microphone-settings"
          data-testid="kid-mic-settings-panel"
          id={panelId}
          role="dialog"
          aria-label={messages.kid.microphoneSettingsTitle}
          style={panelPosition}
          withBorder
        >
          <Title order={2} className="kid-microphone-settings__title">{messages.kid.microphoneSettingsTitle}</Title>
          <Switch
            className="kid-toggle"
            data-testid="kid-mic-toggle"
            checked={microphone}
            label={messages.kid.microphone}
            onChange={(event) => onToggleMicrophone(event.currentTarget.checked)}
          />
          <Text className="kid-microphone-hint" data-testid="kid-microphone-hint">
            {messages.kid.microphoneLearningHint}
          </Text>
          {micDenied && <Text className="kid-hint" data-testid="kid-mic-denied-hint">{messages.kid.microphoneDeniedHint}</Text>}
        </Paper>}
    </div>
  );
}
