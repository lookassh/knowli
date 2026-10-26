"use client";

import type { ReactElement, ReactNode } from "react";
import classes from "./kid-theme.module.css";

/** Own fixed night theme for the child UI; scoped to .kid-theme. */
export function KidThemeProvider({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className={`kid-theme ${classes.root}`} data-kid-theme="night">
      {children}
    </div>
  );
}
