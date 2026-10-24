"use client";

import { useRef, type ReactElement, type ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import classes from "./kid-theme.module.css";
import { kidTheme } from "./kid-theme";

export function KidThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <MantineProvider
      theme={kidTheme}
      forceColorScheme="dark"
      cssVariablesSelector=".kid-theme"
      getRootElement={() => rootRef.current ?? undefined}
      deduplicateCssVariables={false}
    >
      <div
        ref={rootRef}
        className={`kid-theme ${classes.root}`}
        data-mantine-color-scheme="dark"
        data-kid-theme="night"
      >
        {children}
      </div>
    </MantineProvider>
  );
}
