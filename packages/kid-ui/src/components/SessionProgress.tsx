import type { ReactElement } from "react";
import { messages } from "@learning/contracts";
import { format } from "../format";
import classes from "./SessionProgress.module.css";

export function SessionProgress({ remaining }: { remaining: number | null }): ReactElement | null {
  if (remaining === null) return null;

  return (
    <span className={[classes.root, "kid-remaining"].join(" ")} data-testid="kid-remaining">
      {format(messages.kid.remaining, { n: remaining })}
    </span>
  );
}
