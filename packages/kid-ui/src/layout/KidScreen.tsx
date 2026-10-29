"use client";

import type { HTMLAttributes, ReactElement, ReactNode, Ref } from "react";
import { HeaderWave } from "../illustrations/HeaderWave";
import classes from "./KidScreen.module.css";

export interface KidScreenProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

export interface KidScreenHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** `band` rysuje kolorowy pas sięgający krawędzi ekranu z falistą dolną krawędzią. */
  variant?: "plain" | "band";
  ref?: Ref<HTMLDivElement>;
}

export interface KidScreenContentProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

export interface KidScreenActionsProps extends HTMLAttributes<HTMLDivElement> {
  secondary?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

export function KidScreenHeader({ className, children, variant = "plain", ref, ...props }: KidScreenHeaderProps): ReactElement {
  if (variant === "band") {
    return (
      <div
        {...props}
        ref={ref}
        data-kid-header="band"
        className={[classes.header, classes.band, className].filter(Boolean).join(" ")}
      >
        {children}
        <HeaderWave className={classes.wave} />
      </div>
    );
  }
  return (
    <div {...props} ref={ref} className={[classes.header, className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
KidScreenHeader.displayName = "KidScreenHeader";

export function KidScreenContent({ className, ref, ...props }: KidScreenContentProps): ReactElement {
  return <div {...props} ref={ref} data-testid="kid-content" className={[classes.content, className].filter(Boolean).join(" ")} />;
}
KidScreenContent.displayName = "KidScreenContent";

export function KidScreenActions({ className, children, secondary, ref, ...props }: KidScreenActionsProps): ReactElement {
  return (
    <div {...props} ref={ref} className={[classes.actions, className].filter(Boolean).join(" ")}>
      <div data-testid="kid-primary-slot" className={classes.primary}>{children}</div>
      <div data-testid="kid-secondary-slot" className={classes.secondary}>{secondary}</div>
    </div>
  );
}
KidScreenActions.displayName = "KidScreenActions";

function KidScreenRoot({ className, ref, ...props }: KidScreenProps): ReactElement {
  const dataTestId = (props as Record<string, unknown>)["data-testid"] ?? "kid-screen";
  return (
    <div
      {...props}
      ref={ref}
      data-testid={dataTestId as string}
      data-kid-screen="true"
      className={[classes.root, className].filter(Boolean).join(" ")}
    />
  );
}
KidScreenRoot.displayName = "KidScreen";

export const KidScreen = Object.assign(KidScreenRoot, {
  Header: KidScreenHeader,
  Content: KidScreenContent,
  Actions: KidScreenActions,
});
