import type { CSSProperties, ReactNode } from "react";
import { useKidViewport } from "./viewport";

export function KidPage({
  mode,
  children,
}: {
  mode: "flow" | "session";
  children: ReactNode;
}) {
  const viewport = useKidViewport();
  const zoomed = mode === "session" && viewport.zoomed;
  const session = mode === "session" && !zoomed;
  const style: CSSProperties | undefined = session && viewport.height !== null
    ? { height: `${viewport.height}px`, top: `${viewport.offsetTop}px` }
    : undefined;

  return (
    <div
      className={["kid-ui", "kid-page", session ? "kid-page--session" : "kid-page--flow"]
        .filter(Boolean)
        .join(" ")}
      data-testid={mode === "session" ? "kid-session-frame" : undefined}
      data-zoomed={zoomed ? "true" : "false"}
      style={style}
    >
      {children}
    </div>
  );
}
