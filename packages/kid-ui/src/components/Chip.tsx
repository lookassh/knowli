import type { HTMLAttributes, ReactElement } from "react";
import { KidIcon, type KidIconName } from "./KidIcon";
import styles from "./Chip.module.css";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "warm";
  icon?: KidIconName;
}

export function Chip({ tone = "neutral", icon, className, children, ...span }: ChipProps): ReactElement {
  return (
    <span {...span} className={[styles.chip, className].filter(Boolean).join(" ")} data-tone={tone}>
      {icon ? <KidIcon name={icon} className={styles.icon} /> : null}
      {children}
    </span>
  );
}
