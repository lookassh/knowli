import type { ReactElement, ReactNode } from "react";
import { IconActionButton, type IconActionButtonProps } from "./IconActionButton";
import { KidIcon } from "./KidIcon";

export interface ListenButtonProps extends Omit<IconActionButtonProps, "variant" | "priority" | "radius" | "children"> {
  /** `md` (48 px) wszędzie; `lg` (64 px) tylko gdy odsłuch jest samym bodźcem
   * (słowo do poznania, obrazek do nazwania, ujawnione słowo). */
  size?: "md" | "lg";
  /** Dodatki nad ikoną, np. `SoundRing` w trakcie odtwarzania. */
  children?: ReactNode;
}

/** Jedyny przycisk odsłuchu w Kid UI: ta sama ikona głośnika, wariant tonal
 * i kształt przycisków ikon, żeby odsłuch wyglądał wszędzie tak samo. */
export function ListenButton({ size = "md", className, style, children, ...props }: ListenButtonProps): ReactElement {
  const side = size === "lg" ? 64 : 48;
  return (
    <IconActionButton
      {...props}
      variant="tonal"
      data-listen-size={size}
      className={["kid-listen", className].filter(Boolean).join(" ")}
      style={{ width: side, height: side, minWidth: side, minHeight: side, ...style }}
    >
      <KidIcon name="volume" />
      {children}
    </IconActionButton>
  );
}
