import type { ReactElement, ReactNode } from "react";
import { m } from "motion/react";
import { kidListenFailWobble, kidListenFailWobbleTransition } from "../motion/kid-motion";
import { IconActionButton, type IconActionButtonProps } from "./IconActionButton";
import { KidIcon } from "./KidIcon";

export interface ListenButtonProps extends Omit<IconActionButtonProps, "variant" | "priority" | "radius" | "children"> {
  /** `md` (48 px) wszędzie; `lg` (64 px) tylko gdy odsłuch jest samym bodźcem
   * (słowo do poznania, obrazek do nazwania, ujawnione słowo). */
  size?: "md" | "lg";
  /** Głośnik dla zwykłego odsłuchu, żółw dla wolnego („Posłuchaj wolniej”). */
  icon?: "volume" | "turtle";
  /** Klucz nieudanego odsłuchu: każda nowa wartość porusza raz ikoną (nie
   * przyciskiem — jego transformacją steruje ActionButton) i oznacza przycisk
   * `data-audio-failed`. */
  failKey?: number;
  /** Dodatki nad ikoną, np. `SoundRing` w trakcie odtwarzania. */
  children?: ReactNode;
}

/** Jedyny przycisk odsłuchu w Kid UI: ta sama ikona głośnika, wariant tonal
 * i kształt przycisków ikon, żeby odsłuch wyglądał wszędzie tak samo. */
export function ListenButton({ size = "md", icon = "volume", failKey, className, style, children, ...props }: ListenButtonProps): ReactElement {
  const side = size === "lg" ? 64 : 48;
  return (
    <IconActionButton
      {...props}
      variant="tonal"
      data-listen-size={size}
      data-audio-failed={failKey}
      className={["kid-listen", className].filter(Boolean).join(" ")}
      style={{ width: side, height: side, minWidth: side, minHeight: side, ...style }}
    >
      <m.span
        key={failKey ?? 0}
        className="kid-listen__icon"
        data-fail-key={failKey}
        animate={failKey ? kidListenFailWobble : undefined}
        transition={kidListenFailWobbleTransition}
      >
        <KidIcon name={icon} />
      </m.span>
      {children}
    </IconActionButton>
  );
}
