import type { MeaningVisual as MeaningVisualDto } from "@learning/contracts";
import { messages } from "@learning/contracts";
import { formatVisualCountLabel } from "./visual-labels";
import { NumberVisual } from "./NumberVisual";

/** Stimulus visuals stay still on purpose: the task pane already animates
 * the entrance, and a second fade/scale on the image itself (worse while
 * its bytes are still loading) reads as a double flicker. */
export function MeaningVisualView({ visual, mediaUrl, numberDisplay = "digit" }: { visual: MeaningVisualDto; mediaUrl: (id: string) => string; numberDisplay?: "apples" | "digit" }) {
  switch (visual.kind) {
    case "image":
      return <img className="kid-illustration" src={mediaUrl(visual.imageAssetId)} alt="" data-testid="kid-illustration" decoding="async" />;
    case "color":
      return <svg className="kid-visual" viewBox="0 0 96 96" role="img" aria-label={messages.kid.visualColorLabel}><rect x="8" y="8" width="80" height="80" rx="12" fill={visual.color} /></svg>;
    case "number":
      return <NumberVisual count={visual.count} label={formatVisualCountLabel(visual.count)} display={numberDisplay} />;
  }
}
