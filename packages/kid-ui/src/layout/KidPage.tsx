import type { CSSProperties, ReactNode } from "react";
import { KidViewportProvider, useKidViewport } from "./viewport";

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
    <KidViewportProvider viewport={{ width: viewport.width, height: viewport.height, offsetTop: viewport.offsetTop, zoomed: viewport.zoomed, scale: viewport.scale }}>
      <div
        className={["kid-ui", "kid-page", session ? "kid-page--session" : "kid-page--flow"]
          .filter(Boolean)
          .join(" ")}
        data-testid={mode === "session" ? "kid-session-frame" : undefined}
        data-zoomed={zoomed ? "true" : "false"}
        data-viewport-short={session && viewport.height !== null && viewport.height <= 700 ? "true" : undefined}
        data-viewport-very-short={session && viewport.height !== null && viewport.height <= 479 ? "true" : undefined}
        style={style}
      >
        {children}
      </div>
    </KidViewportProvider>
  );
}
